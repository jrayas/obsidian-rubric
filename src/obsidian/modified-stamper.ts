import { Notice, TFile } from 'obsidian';
import { formatLocal, decideStamp, fingerprint } from '../core/timestamps';
import type { NoteState } from '../core/timestamps';
import { readFrontmatter } from '../core/frontmatter';
import type RubricPlugin from '../main';

/** Quiet period after the last change before `modified` is stamped. */
export const STAMP_DELAY_MS = 1500;

/**
 * Keeps `created` and `modified` honest (rule 5). `modified` is the only thing this plugin writes without asking.
 * It follows any change to the file, whatever the cause (an edit here, another tool, a sync arrival) and ignores
 * moves, breadcrumb rewrites and this plugin's own writes.
 */
export class ModifiedStamper {
  private readonly baseline = new Map<string, NoteState>();
  private readonly timers = new Map<string, number>();
  private chain: Promise<void> = Promise.resolve();
  private waiting = 0;
  private finished = 0;
  private progress: Notice | null = null;

  constructor(private readonly plugin: RubricPlugin) {}

  /** Register events and take a baseline of every managed note. Call from onLayoutReady. */
  start(): void {
    const { vault } = this.plugin.app;
    const p = this.plugin;
    p.registerEvent(vault.on('modify', (f) => { if (f instanceof TFile) void this.onModify(f); }));
    p.registerEvent(vault.on('create', (f) => { if (f instanceof TFile) void this.remember(f); }));
    p.registerEvent(vault.on('rename', (f, old) => {
      const b = this.baseline.get(old);
      if (b) {
        this.baseline.delete(old);
        this.baseline.set(f.path, b);
      }
      const t = this.timers.get(old);
      if (t !== undefined) {
        this.timers.delete(old);
        this.timers.set(f.path, t);
      }
      this.plugin.queue.ledger.rename(old, f.path);
    }));
    p.registerEvent(vault.on('delete', (f) => {
      this.baseline.delete(f.path);
      this.cancel(f.path);
    }));
    void this.scan();
  }

  stop(): void {
    for (const t of this.timers.values()) window.clearTimeout(t);
    this.timers.clear();
  }

  private async scan(): Promise<void> {
    const files = this.plugin.app.vault.getMarkdownFiles();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f && !this.baseline.has(f.path)) await this.remember(f);
      if (i % 40 === 39) await new Promise<void>((r) => window.setTimeout(r, 0)); // stay responsive on big vaults
    }
  }

  private async remember(file: TFile): Promise<void> {
    if (file.extension !== 'md' || this.baseline.has(file.path)) return;
    try {
      const { fp, modified } = fingerprint(await this.plugin.app.vault.cachedRead(file));
      if (!this.baseline.has(file.path)) this.baseline.set(file.path, { fp, modified });
    } catch {
      /* unreadable now; the next event will take the baseline */
    }
  }

  private cancel(path: string): void {
    const t = this.timers.get(path);
    if (t !== undefined) window.clearTimeout(t);
    this.timers.delete(path);
  }

  /** Does the note already carry plugin-managed properties? Only those get a stamp (never a lone `modified`). */
  private isManagedNote(text: string): boolean {
    try {
      const fm = readFrontmatter(text);
      return !!fm && ('id' in fm || 'created' in fm || 'modified' in fm);
    } catch {
      return false;
    }
  }

  private async onModify(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;
    const text = await this.plugin.app.vault.read(file);
    const after = fingerprint(text);
    if (this.plugin.queue.ledger.consume(file.path, text)) {
      // our own write: it never counts, and it becomes the new baseline
      this.baseline.set(file.path, after);
      this.cancel(file.path);
      return;
    }
    if (!this.plugin.settings.stampModified) {
      this.baseline.set(file.path, after);
      return;
    }
    // Master switch off: nothing is stamped. The baseline stays as it was, so the next change after it is switched
    // on is compared with how the note was before.
    if (!this.plugin.isOn()) return;
    const ctx = this.plugin.notes.context(file);
    if (!ctx.verdict.managed || !ctx.type || !this.isManagedNote(text)) {
      this.baseline.set(file.path, after);
      return;
    }
    const before = this.baseline.get(file.path);
    const decision = decideStamp({ ownWrite: false, before, after });
    if (decision.action === 'none') {
      this.baseline.set(file.path, after);
      if (decision.reason !== 'unchanged') this.cancel(file.path);
      return;
    }
    // Stamp after a short pause once changes stop, not on every keystroke. The baseline stays as it was
    // before the burst so the decision at the end sees the whole burst.
    this.cancel(file.path);
    this.timers.set(
      file.path,
      window.setTimeout(() => {
        this.timers.delete(file.path);
        this.enqueue(file);
      }, STAMP_DELAY_MS),
    );
  }

  /**
   * Stamps run one after another. When many notes change in a burst (a find and replace, a folder reorganisation)
   * and batch mode is on, a single progress notice shows instead of a flurry of writes.
   */
  private enqueue(file: TFile): void {
    this.waiting++;
    // notes whose quiet period has not ended yet are part of the same burst
    if (this.waiting + this.timers.size > 10 && this.plugin.settings.batchMode && !this.progress) this.progress = new Notice('', 0);
    this.chain = this.chain
      .then(() => this.stamp(file))
      .catch(() => undefined)
      .finally(() => {
        this.finished++;
        this.progress?.setMessage(`Stamping modified: ${this.finished} of ${this.waiting + this.timers.size} notes…`);
        if (this.finished >= this.waiting && this.timers.size === 0) {
          this.progress?.hide();
          this.progress = null;
          this.waiting = 0;
          this.finished = 0;
        }
      });
  }

  private async stamp(file: TFile): Promise<void> {
    if (!this.plugin.app.vault.getFileByPath(file.path)) return;
    const text = await this.plugin.app.vault.read(file);
    const after = fingerprint(text);
    const decision = decideStamp({ ownWrite: false, before: this.baseline.get(file.path), after });
    if (decision.action !== 'stamp') {
      this.baseline.set(file.path, after);
      return;
    }
    const stamp = formatLocal(new Date());
    const outcome = await this.plugin.queue.edit(file, {
      keepOrder: true,
      mutate: (fm) => {
        fm.modified = stamp;
      },
    });
    if (outcome.error) return; // not valid YAML right now: leave the note alone
    this.baseline.set(file.path, fingerprint(await this.plugin.app.vault.read(file)));
  }
}
