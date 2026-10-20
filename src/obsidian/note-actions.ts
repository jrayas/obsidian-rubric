import { Notice } from 'obsidian';
import type { TFile } from 'obsidian';
import { planConversion } from '../core/convert';
import { planCompletion } from '../core/create';
import { desiredOrder, editFrontmatter, readFrontmatter } from '../core/frontmatter';
import type { Frontmatter } from '../core/frontmatter';
import { describeChanges } from '../core/preview';
import type { ResolvedType } from '../core/schema-types';
import type VaultSchemaPlugin from '../main';
import { preview } from './preview-modal';

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

  /** Rule 8: preview, then convert. Values that no longer apply go to `archived_fields`; nothing is deleted. */
  async convert(file: TFile, to: ResolvedType, from?: ResolvedType | null): Promise<boolean> {
    const { plugin } = this;
    const loaded = await this.load(file);
    if (!loaded) return false;
    const source = from ?? plugin.notes.context(file, loaded.fm).type;
    if (!source) {
      new Notice('This note has no schema yet. Choose one first.');
      return false;
    }
    if (source.name === to.name) {
      new Notice(`The note is already a ${to.name}.`);
      return false;
    }
    const plan = planConversion(loaded.fm, source, to, new Date());
    const dry = editFrontmatter(loaded.text, plan.apply, { order: (k) => desiredOrder(k, to), forceOrder: true });
    const lines = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    const ok = await preview(plugin.app, {
      title: `Convert “${file.basename}” from ${source.name} to ${to.name}?`,
      sections: [
        { heading: 'Added with defaults', lines: lines(plan.added) },
        { heading: 'Kept in archived_fields (not deleted)', lines: lines(plan.archived) },
        { heading: 'All changes', lines: describeChanges(dry.changes) },
      ],
      confirmText: 'Convert',
    });
    if (!ok) return false;
    plugin.watcher.acceptType(file.path, to.name);
    const outcome = await plugin.queue.editExact(file, loaded.text, { mutate: plan.apply, forceOrder: true });
    if (outcome.error) {
      plugin.watcher.acceptType(file.path, source.name);
      new Notice(outcome.error);
      return false;
    }
    new Notice(`Converted “${file.basename}” to ${to.name}.`);
    return true;
  }

  /** Give a note everything its type needs (type, schema, ID, created, modified, defaults), after a preview. */
  async complete(file: TFile, type: ResolvedType): Promise<boolean> {
    const { plugin } = this;
    const loaded = await this.load(file);
    if (!loaded) return false;
    const allocated: string[] = [];
    const plan = planCompletion(loaded.fm, type, {
      name: file.basename,
      now: new Date(),
      fileCreated: new Date(file.stat.ctime),
      allocateId: (year) => {
        const id = plugin.ids.allocate(type.prefix, year);
        allocated.push(id);
        return id;
      },
    });
    if (Object.keys(plan.added).length === 0) {
      new Notice(`“${file.basename}” already has everything a ${type.name} needs.`);
      return false;
    }
    const dry = editFrontmatter(loaded.text, plan.apply, { order: (k) => desiredOrder(k, type), forceOrder: true });
    const ok = await preview(plugin.app, {
      title: `Add ${type.name} properties to “${file.basename}”?`,
      lead: 'Existing values are not changed.',
      sections: [{ heading: 'Added', lines: describeChanges(dry.changes) }],
      confirmText: 'Add properties',
    });
    if (!ok) {
      for (const id of allocated) plugin.ids.release(id);
      return false;
    }
    const outcome = await plugin.queue.editExact(file, loaded.text, { mutate: plan.apply, forceOrder: true });
    if (outcome.error) {
      for (const id of allocated) plugin.ids.release(id);
      new Notice(outcome.error);
      return false;
    }
    return true;
  }
}
