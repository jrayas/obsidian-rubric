import { Notice } from 'obsidian';
import type { TFile } from 'obsidian';
import { planConversion } from '../core/convert';
import { planCompletion } from '../core/create';
import { bodyOf, desiredOrder, editFrontmatter, readFrontmatter } from '../core/frontmatter';
import type { Frontmatter } from '../core/frontmatter';
import { describeChanges } from '../core/preview';
import type { KeyChange } from '../core/frontmatter';
import type { ResolvedType } from '../core/schema-types';
import type VaultSchemaPlugin from '../main';
import { preview } from './preview-modal';

export interface PlannedConversion {
  file: TFile;
  /** The text the plan was made from; the write checks the note still equals it. */
  text: string;
  source: ResolvedType;
  to: ResolvedType;
  plan: ReturnType<typeof planConversion>;
  changes: KeyChange[];
}

/** Previewed, approved changes to one note: convert its type, complete it with the properties its type needs. */
export class NoteActions {
  constructor(private readonly plugin: VaultSchemaPlugin) {}

  private async load(file: TFile): Promise<{ text: string; fm: Frontmatter } | null> {
    const text = await this.plugin.app.vault.read(file);
    try {
      return { text, fm: readFrontmatter(text) ?? {} };
    } catch (e) {
      new Notice(`The properties of “${file.basename}” are not valid YAML, so nothing was changed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** Work out a conversion and what it would write, without showing or writing anything. */
  async planConvert(file: TFile, to: ResolvedType, from?: ResolvedType | null): Promise<PlannedConversion | null> {
    const loaded = await this.load(file);
    if (!loaded) return null;
    const source = from ?? this.plugin.notes.context(file, loaded.fm).type;
    if (!source || source.name === to.name) return null;
    const plan = planConversion(loaded.fm, source, to, new Date());
    const dry = editFrontmatter(loaded.text, plan.apply, { order: (k) => desiredOrder(k, to), forceOrder: true });
    return { file, text: loaded.text, source, to, plan, changes: dry.changes };
  }

  /** Write a planned conversion. The note must still equal the text the plan was made from. */
  async applyConversion(p: PlannedConversion): Promise<string | null> {
    const { plugin } = this;
    plugin.watcher.acceptType(p.file.path, p.to.name);
    const outcome = await plugin.queue.editExact(p.file, p.text, { mutate: p.plan.apply, forceOrder: true });
    if (outcome.error) {
      plugin.watcher.acceptType(p.file.path, p.source.name);
      return outcome.error;
    }
    return null;
  }

  /** Rule 8: preview, then convert. Values that no longer apply go to `archived_fields`; nothing is deleted. */
  async convert(file: TFile, to: ResolvedType, from?: ResolvedType | null): Promise<boolean> {
    const { plugin } = this;
    const planned = await this.planConvert(file, to, from);
    if (!planned) {
      const cur = from ?? plugin.notes.context(file).type;
      new Notice(!cur ? 'This note has no schema yet. Choose one first.' : `The note is already a ${to.name}.`);
      return false;
    }
    const lines = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    const ok = await preview(plugin.app, {
      title: `Convert “${file.basename}” from ${planned.source.name} to ${to.name}?`,
      sections: [
        { heading: 'Added with defaults', lines: lines(planned.plan.added) },
        { heading: 'Kept in archived_fields (not deleted)', lines: lines(planned.plan.archived) },
        { heading: 'All changes', lines: describeChanges(planned.changes) },
      ],
      confirmText: 'Convert',
    });
    if (!ok) return false;
    const err = await this.applyConversion(planned);
    if (err) {
      new Notice(err);
      return false;
    }
    new Notice(`Converted “${file.basename}” to ${to.name}.`);
    return true;
  }

  /** Give a note everything its type needs (type, schema, ID, created, modified, defaults), after a preview. */
  async complete(file: TFile, type: ResolvedType, options: { silent?: boolean } = {}): Promise<boolean> {
    const { plugin } = this;
    const loaded = await this.load(file);
    if (!loaded) return false;
    const allocated: string[] = [];
    const plan = planCompletion(loaded.fm, type, {
      name: file.basename,
      now: new Date(),
      fileCreated: new Date(file.stat.ctime),
      folder: file.parent?.path === '/' ? '' : (file.parent?.path ?? ''),
      ...(plugin.settings.useSchemaTemplates && plugin.schemas.pack?.templates.get(type.name) ? { template: plugin.schemas.pack.templates.get(type.name) } : {}),
      allocateId: (year) => {
        const id = plugin.ids.allocate(type.prefix, year);
        allocated.push(id);
        return id;
      },
    });
    const dry = editFrontmatter(loaded.text, plan.apply, { order: (k) => desiredOrder(k, type), forceOrder: true, ...(plan.body ? { body: plan.body } : {}) });
    if (Object.keys(plan.added).length === 0 && !dry.changed) {
      if (!options.silent) new Notice(`“${file.basename}” already has everything a ${type.name} needs.`);
      return false;
    }
    const ok = options.silent
      ? true
      : await preview(plugin.app, {
      title: `Add ${type.name} properties to “${file.basename}”?`,
      lead: 'Existing values are not changed.',
      sections: [
        { heading: 'Added', lines: describeChanges(dry.changes) },
        ...(plan.templateBody !== null && plan.body && plan.body(bodyOf(loaded.text)) !== bodyOf(loaded.text) ? [{ heading: 'Template body inserted (the note was empty)', lines: plan.templateBody.trim().split('\n').slice(0, 12) }] : []),
      ],
      confirmText: 'Add properties',
    });
    if (!ok) {
      for (const id of allocated) plugin.ids.release(id);
      return false;
    }
    const outcome = await plugin.queue.editExact(file, loaded.text, { mutate: plan.apply, forceOrder: true, ...(plan.body ? { body: plan.body } : {}) });
    if (outcome.error) {
      for (const id of allocated) plugin.ids.release(id);
      if (!options.silent) new Notice(outcome.error);
      return false;
    }
    return true;
  }
}
