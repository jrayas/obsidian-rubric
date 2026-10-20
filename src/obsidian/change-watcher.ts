import { Notice, TFile } from 'obsidian';
import { checkTags } from '../core/tags';
import { matchNote } from '../core/matcher';
import { validateValue } from '../core/validate';
import type { PropertyDef, ResolvedType } from '../core/schema-types';
import type VaultSchemaPlugin from '../main';
import { confirm } from './modals';
import type { PlannedConversion } from './note-actions';
import { chooseValue, preview } from './preview-modal';

const QUIET_MS = 1500;
const RENAME_WINDOW_MS = 10_000;
/** After the last moved note, wait this long for the rest of a folder reorganisation. */
const SETTLE_MS = 2500;

/**
 * Asks about the things the spec says must ask: tag synonyms and unknown tags (rule 6), an invalid status
 * (rule 7) and a change of type (rule 8). It looks only at notes the user is working on (open in a pane),
 * because Obsidian cannot tell a sync arrival from a local edit and "notes that arrive through sync never
 * trigger prompts" (decisions D-34). Prompts run one at a time, and a refused prompt is not repeated for
 * the same state.
 */
export class ChangeWatcher {
  private readonly timers = new Map<string, number>();
  private readonly lastType = new Map<string, string>();
  private readonly lastCrumb = new Map<string, string>();
  private readonly renamedAt = new Map<string, number>();
  private readonly dismissed = new Set<string>();
  private busy: Promise<void> = Promise.resolve();
  private readonly candidates = new Map<string, { file: TFile; from: ResolvedType; to: ResolvedType }>();
  private candidateTimer: number | null = null;
  /** Switch the prompts off (used by the real-app test suite so unrelated checks are not interrupted). */
  enabled = true;

  constructor(private readonly plugin: VaultSchemaPlugin) {}

  start(): void {
    const { metadataCache, vault } = this.plugin.app;
    // Trackers for every note, so the first edit after start can be compared with how the note was.
    for (const f of vault.getMarkdownFiles()) this.track(f, metadataCache.getFileCache(f)?.frontmatter);
    this.plugin.registerEvent(
      metadataCache.on('changed', (file, _data, cache) => {
        if (file.extension !== 'md') return;
        this.schedule(file, cache.frontmatter);
      }),
    );
    this.plugin.registerEvent(
      vault.on('rename', (f, old) => {
        if (!(f instanceof TFile)) return;
        this.renamedAt.set(f.path, Date.now());
        const t = this.lastType.get(old);
        if (t !== undefined) {
          this.lastType.delete(old);
          this.lastType.set(f.path, t);
        }
        const c = this.lastCrumb.get(old);
        if (c !== undefined) {
          this.lastCrumb.delete(old);
          this.lastCrumb.set(f.path, c);
        }
      }),
    );
  }

  /** The plugin itself is about to give a note this type (a conversion): do not treat it as the user's edit. */
  acceptType(path: string, typeName: string): void {
    this.lastType.set(path, typeName);
  }

  stop(): void {
    for (const t of this.timers.values()) window.clearTimeout(t);
    this.timers.clear();
    if (this.candidateTimer !== null) window.clearTimeout(this.candidateTimer);
  }

  private track(file: TFile, fm: Record<string, unknown> | undefined): void {
    if (typeof fm?.type === 'string') this.lastType.set(file.path, fm.type);
    else this.lastType.delete(file.path);
    if (typeof fm?.breadcrumb === 'string') this.lastCrumb.set(file.path, fm.breadcrumb);
    else this.lastCrumb.delete(file.path);
  }

  private schedule(file: TFile, fm: Record<string, unknown> | undefined): void {
    const prev = this.timers.get(file.path);
    if (prev !== undefined) window.clearTimeout(prev);
    this.timers.set(
      file.path,
      window.setTimeout(() => {
        this.timers.delete(file.path);
        this.busy = this.busy.then(() => this.evaluate(file, fm)).catch(() => undefined);
      }, QUIET_MS),
    );
  }

  /** The note is open in a pane: the user is working on it. */
  private isBeingEdited(file: TFile): boolean {
    const { workspace } = this.plugin.app;
    if (workspace.getActiveFile()?.path === file.path) return true;
    return workspace.getLeavesOfType('markdown').some((l) => (l.view as { file?: TFile | null }).file?.path === file.path);
  }

  private async evaluate(file: TFile, _fm: Record<string, unknown> | undefined): Promise<void> {
    const { plugin } = this;
    const pack = plugin.schemas.pack;
    if (!pack || !this.plugin.app.vault.getFileByPath(file.path)) return;
    const fm = plugin.notes.frontmatterOf(file);
    if (!this.enabled) {
      this.track(file, plugin.notes.frontmatterOf(file));
      return;
    }
    const prevType = this.lastType.get(file.path);
    const prevCrumb = this.lastCrumb.get(file.path);
    this.track(file, fm);
    if (!fm) return;

    // A first breadcrumb segment that now belongs to another schema, right after a move. Collected for every note
    // (not only open ones) so a folder reorganisation is handled once, as a batch.
    const crumb = typeof fm.breadcrumb === 'string' ? fm.breadcrumb : '';
    const typeNow = typeof fm.type === 'string' ? (pack.types.get(fm.type) ?? null) : null;
    const moved = Date.now() - (this.renamedAt.get(file.path) ?? 0) < RENAME_WINDOW_MS;
    if (typeNow && crumb && crumb !== prevCrumb && moved && plugin.notes.context(file).verdict.managed) {
      const hit = matchNote(pack, { path: 'x.md', frontmatter: { breadcrumb: crumb } }, { mode: 'auto', noMatch: 'unmanaged' });
      const to = hit.kind === 'matched' ? pack.types.get(hit.type) : undefined;
      if (to && to.name !== typeNow.name && !this.dismissed.has(`convert:${file.path}:${typeNow.name}>${to.name}`)) {
        this.candidates.set(file.path, { file, from: typeNow, to });
        this.scheduleFlush();
      }
    }

    if (!this.isBeingEdited(file)) return;

    const ctx = plugin.notes.context(file);
    if (!ctx.verdict.managed) return;
    const type = typeNow;

    // the `type` property changed to another schema
    if (type && prevType && prevType !== type.name) {
      const from = pack.types.get(prevType);
      const key = `convert:${file.path}:${prevType}>${type.name}`;
      if (from && !this.dismissed.has(key)) {
        if (!(await plugin.actions.convert(file, type, from))) this.dismissed.add(key);
        return;
      }
    }

    if (!ctx.type) return;
    await this.checkTags(file, ctx.type, fm);
    await this.checkStatus(file, ctx.type, fm);
  }

  private scheduleFlush(): void {
    if (this.candidateTimer !== null) window.clearTimeout(this.candidateTimer);
    this.candidateTimer = window.setTimeout(() => {
      this.candidateTimer = null;
      this.busy = this.busy.then(() => this.flushCandidates()).catch(() => undefined);
    }, SETTLE_MS);
  }

  /** One window for a reorganisation of many notes; a single moved note keeps its own prompt. */
  private async flushCandidates(): Promise<void> {
    const { plugin } = this;
    const list = [...this.candidates.values()].filter((c) => plugin.notes.frontmatterOf(c.file)?.type === c.from.name);
    this.candidates.clear();
    if (!this.enabled || list.length === 0) return;
    if (list.length === 1 || !plugin.settings.batchMode) {
      for (const c of list) {
        if (!this.isBeingEdited(c.file)) continue;
        if (!(await plugin.actions.convert(c.file, c.to, c.from))) this.dismissed.add(`convert:${c.file.path}:${c.from.name}>${c.to.name}`);
      }
      return;
    }
    await this.batchConvert(list);
  }

  private async batchConvert(list: { file: TFile; from: ResolvedType; to: ResolvedType }[]): Promise<void> {
    const { plugin } = this;
    const planned: PlannedConversion[] = [];
    for (const c of list) {
      const p = await plugin.actions.planConvert(c.file, c.to, c.from);
      if (p) planned.push(p);
    }
    if (planned.length === 0) return;
    const groups = new Map<string, PlannedConversion[]>();
    for (const p of planned) groups.set(`${p.source.name} → ${p.to.name}`, [...(groups.get(`${p.source.name} → ${p.to.name}`) ?? []), p]);
    const ok = await preview(plugin.app, {
      title: `Convert ${planned.length} notes?`,
      lead: 'Their breadcrumbs now point at other schemas. Values that no longer apply are kept in archived_fields; nothing is deleted.',
      sections: [...groups.entries()].map(([heading, items]) => ({
        heading: `${heading} (${items.length})`,
        lines: items.map((p) => `${p.file.basename}: +${Object.keys(p.plan.added).length} added, ${Object.keys(p.plan.archived).length} archived`),
      })),
      confirmText: `Convert ${planned.length} notes`,
    });
    if (!ok) {
      for (const p of planned) this.dismissed.add(`convert:${p.file.path}:${p.source.name}>${p.to.name}`);
      return;
    }
    const progress = new Notice('', 0);
    let failed = 0;
    for (const [i, p] of planned.entries()) {
      progress.setMessage(`Converting ${i + 1} of ${planned.length}…`);
      const err = await plugin.actions.applyConversion(p);
      if (err) failed++;
      if (i % 5 === 4) await new Promise<void>((r) => window.setTimeout(r, 0));
    }
    progress.hide();
    new Notice(`Converted ${planned.length - failed} of ${planned.length} notes.`);
  }

  private async checkTags(file: TFile, type: ResolvedType, fm: Record<string, unknown>): Promise<void> {
    const { plugin } = this;
    const pack = plugin.schemas.pack;
    if (!pack) return;
    for (const def of type.properties) {
      if (def.type !== 'list' || def.items !== 'term' || !def.vocabulary) continue;
      const vocab = pack.vocabularies.get(def.vocabulary);
      if (!vocab || fm[def.name] === undefined) continue;
      const issues = checkTags(fm[def.name], vocab);

      if (def.normalise && issues.replacements.length > 0) {
        const key = `syn:${file.path}:${JSON.stringify(issues.replacements)}`;
        if (!this.dismissed.has(key)) {
          const ok = await preview(plugin.app, {
            title: `Replace tag synonyms in “${file.basename}”?`,
            sections: [{ heading: 'Old → new', lines: issues.replacements.map((r) => `${r.from} → ${r.to}`) }],
            confirmText: 'Replace',
          });
          if (!ok) this.dismissed.add(key);
          else {
            const out = await plugin.queue.edit(file, {
              mutate: (draft) => {
                draft[def.name] = checkTags(draft[def.name], vocab).normalised;
              },
            });
            if (out.error) new Notice(out.error);
          }
        }
      }

      if (def.strict && issues.unknown.length > 0) {
        for (const tag of issues.unknown) {
          const key = `unknown:${file.path}:${tag}`;
          if (this.dismissed.has(key)) continue;
          const ok = await confirm(plugin.app, `Add “${tag}” to the tags vocabulary?`, [
            `“${tag}” is not in the controlled vocabulary used by ${file.basename}.`,
            'Adding it writes one line to the vocabulary file in the schema folder.',
          ], 'Add to vocabulary', 'Cancel');
          if (!ok) this.dismissed.add(key);
          else await plugin.vocabulary.addTerm(def.vocabulary, tag);
        }
      }
    }
  }

  private async checkStatus(file: TFile, type: ResolvedType, fm: Record<string, unknown>): Promise<void> {
    const def: PropertyDef | undefined = type.byName.get('status');
    const value = fm.status;
    if (!def || value === undefined || value === null || value === '') return;
    const issue = validateValue(def, value);
    if (!issue) return;
    const shown = typeof value === 'string' ? value : JSON.stringify(value);
    const key = `status:${file.path}:${shown}`;
    if (this.dismissed.has(key)) return;
    const allowed = def.values ?? [];
    const choice = await chooseValue(this.plugin.app, `“${shown}” is not a ${type.name} status`, `Choose one of the allowed values for “${file.basename}”.`, allowed);
    if (choice === null) {
      this.dismissed.add(key);
      return;
    }
    const out = await this.plugin.queue.edit(file, {
      mutate: (draft) => {
        draft.status = choice;
      },
    });
    if (out.error) new Notice(out.error);
  }
}
