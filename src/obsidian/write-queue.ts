import type { App, TFile } from 'obsidian';
import { contentHash } from '../core/hash';
import { FrontmatterError, desiredOrder, editFrontmatter } from '../core/frontmatter';
import type { Frontmatter, KeyChange } from '../core/frontmatter';
import type { ResolvedType } from '../core/schema-types';

export interface WriteOutcome {
  /** True when the file was actually written. */
  written: boolean;
  changes: KeyChange[];
  /** Set when the frontmatter could not be edited (nothing was written). */
  error?: string;
}

export interface QueuedEdit {
  mutate: (fm: Frontmatter) => void;
  /** Reorder the properties after this edit (module order, own fields, created and modified last). */
  forceOrder?: boolean;
}

interface Pending {
  file: TFile;
  edits: QueuedEdit[];
  resolvers: ((o: WriteOutcome) => void)[];
}

/** Remembers the content of this plugin's own writes so the modify event they cause can be ignored. */
export class OwnWriteLedger {
  private readonly hashes = new Map<string, Set<string>>();

  record(path: string, text: string): void {
    const set = this.hashes.get(path) ?? new Set<string>();
    set.add(contentHash(text));
    this.hashes.set(path, set);
  }

  /** True once if `text` is what we last wrote to `path`. */
  consume(path: string, text: string): boolean {
    const set = this.hashes.get(path);
    const h = contentHash(text);
    if (!set?.has(h)) return false;
    set.delete(h);
    if (set.size === 0) this.hashes.delete(path);
    return true;
  }

  rename(from: string, to: string): void {
    const set = this.hashes.get(from);
    if (set) {
      this.hashes.delete(from);
      this.hashes.set(to, set);
    }
  }
}

/**
 * The only place that changes a note's frontmatter. One queue per note: edits that arrive close together
 * are merged into a single write. Each write is one atomic `vault.process`, compares first (an unchanged note
 * is never rewritten) and keeps the file's line endings.
 */
export class WriteQueue {
  readonly ledger = new OwnWriteLedger();
  private readonly pending = new Map<string, Pending>();
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly app: App,
    /** Which schema governs a note's final frontmatter (decides property order). */
    private readonly typeFor: (file: TFile, fm: Frontmatter) => ResolvedType | null,
  ) {}

  edit(file: TFile, edit: QueuedEdit): Promise<WriteOutcome> {
    return new Promise((resolve) => {
      const entry = this.pending.get(file.path) ?? { file, edits: [], resolvers: [] };
      entry.edits.push(edit);
      entry.resolvers.push(resolve);
      this.pending.set(file.path, entry);
      const prev = this.running.get(file.path) ?? Promise.resolve();
      const next = prev.then(() => this.flush(file.path));
      this.running.set(file.path, next);
      void next.finally(() => {
        if (this.running.get(file.path) === next) this.running.delete(file.path);
      });
    });
  }

  /** Convenience: set or remove single properties. `undefined` removes. */
  set(file: TFile, values: Record<string, unknown>): Promise<WriteOutcome> {
    return this.edit(file, {
      mutate: (fm) => {
        for (const [k, v] of Object.entries(values)) {
          if (v === undefined) delete fm[k];
          else fm[k] = v;
        }
      },
    });
  }

  private async flush(path: string): Promise<void> {
    const entry = this.pending.get(path);
    if (!entry) return; // already merged into an earlier flush
    this.pending.delete(path);
    const outcome: WriteOutcome = { written: false, changes: [] };
    try {
      const file = this.app.vault.getFileByPath(path) ?? entry.file;
      let lastDraft: Frontmatter = {};
      await this.app.vault.process(file, (text) => {
        const result = editFrontmatter(
          text,
          (fm) => {
            for (const e of entry.edits) e.mutate(fm);
            lastDraft = fm;
          },
          {
            order: (keys) => {
              const type = this.typeFor(file, lastDraft);
              return type ? desiredOrder(keys, type) : keys;
            },
            forceOrder: entry.edits.some((e) => e.forceOrder === true),
          },
        );
        outcome.changes = result.changes;
        if (result.changed) {
          outcome.written = true;
          this.ledger.record(path, result.text);
        }
        return result.text;
      });
    } catch (e) {
      outcome.written = false;
      outcome.error = e instanceof FrontmatterError ? `The properties are not valid YAML: ${e.message}` : e instanceof Error ? e.message : String(e);
    }
    for (const r of entry.resolvers) r(outcome);
  }
}
