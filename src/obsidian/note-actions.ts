import { Notice } from 'obsidian';
import type { TFile } from 'obsidian';
import { planConversion } from '../core/convert';
import { planCompletion } from '../core/create';
import { domainFromFolder, domainOf, typeFor } from '../core/domain-overrides';
import { UNIQUE_ID, applyUniqueId, planUniqueId } from '../core/unique-id';
import { desiredOrder, editFrontmatter, readFrontmatter } from '../core/frontmatter';
import type { Frontmatter } from '../core/frontmatter';
import { describeChanges } from '../core/preview';
import type { KeyChange } from '../core/frontmatter';
import type { ResolvedType } from '../core/schema-types';
import type RubricPlugin from '../main';
import { preview } from './preview-modal';

export interface PlannedConversion {
  file: TFile;
  /** The text the plan was made from; the write checks the note still equals it. */
  text: string;
  source: ResolvedType;
  to: ResolvedType;
  plan: ReturnType<typeof planConversion>;
  changes: KeyChange[];
  /** Unique IDs reserved for this plan; give them back when the plan is not carried out. */
  reserved: string[];
}

/** Previewed, approved changes to one note: convert its type, complete it with the properties its type needs. */
export class NoteActions {
  constructor(private readonly plugin: RubricPlugin) {}

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
    const reserved: string[] = [];
    const plan = planConversion(loaded.fm, source, to, new Date(), {
      allocateUnique: (typePrefix, domainPrefix, year) => {
        const id = this.plugin.ids.allocateUnique(typePrefix, domainPrefix, year);
        reserved.push(id);
        return id;
      },
    });
    const dry = editFrontmatter(loaded.text, plan.apply, { order: (k) => desiredOrder(k, to), forceOrder: true });
    return { file, text: loaded.text, source, to, plan, changes: dry.changes, reserved };
  }

  /** A plan that will not be carried out: give back its reserved unique IDs. */
  discard(p: PlannedConversion): void {
    for (const id of p.reserved) this.plugin.ids.release(id);
  }

  /** Write a planned conversion. The note must still equal the text the plan was made from. */
  async applyConversion(p: PlannedConversion): Promise<string | null> {
    const { plugin } = this;
    if (!plugin.isOn()) return 'Rubric is off.';
    plugin.watcher.acceptType(p.file.path, p.to.name);
    const outcome = await plugin.queue.editExact(p.file, p.text, { mutate: p.plan.apply, forceOrder: true });
    if (outcome.error) {
      plugin.watcher.acceptType(p.file.path, p.source.name);
      this.discard(p);
      return outcome.error;
    }
    // The unique ID the note had is kept in archived_fields and never handed out again.
    const old = p.plan.archived[UNIQUE_ID];
    if (typeof old === 'string' && !plugin.settings.retiredIds.includes(old)) {
      plugin.settings.retiredIds.push(old);
      await plugin.saveSettings();
      plugin.refreshSettings();
    }
    return null;
  }

  /** Rule 8: preview, then convert. Values that no longer apply go to `archived_fields`; nothing is deleted. */
  async convert(file: TFile, to: ResolvedType, from?: ResolvedType | null): Promise<boolean> {
    const { plugin } = this;
    if (!plugin.requireOn()) return false;
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
    if (!ok) {
      this.discard(planned);
      return false;
    }
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
    if (!plugin.requireOn()) return false;
    const loaded = await this.load(file);
    if (!loaded) return false;
    const allocated: string[] = [];
    // A note with no domain takes it from its folder (Knowledge/maths/ is maths), and is completed with that domain's
    // defaults: its section, kinds and added properties.
    const pack = plugin.schemas.pack;
    const folderDomain = domainOf(loaded.fm) === undefined && pack ? domainFromFolder(pack.domainFolder, file.path) : undefined;
    if (folderDomain && pack) type = typeFor(pack, type.name, folderDomain) ?? type;
    const plan = planCompletion(loaded.fm, type, {
      name: file.basename,
      now: new Date(),
      fileCreated: new Date(file.stat.ctime),
      ...(folderDomain ? { domain: folderDomain } : {}),
      allocateId: (year) => {
        const id = plugin.ids.allocate(type.prefix, year);
        allocated.push(id);
        return id;
      },
      allocateUnique: (typePrefix, domainPrefix, year) => {
        const id = plugin.ids.allocateUnique(typePrefix, domainPrefix, year);
        allocated.push(id);
        return id;
      },
    });
    if (Object.keys(plan.added).length === 0) {
      if (!options.silent) new Notice(`“${file.basename}” already has everything a ${type.name} needs.`);
      return false;
    }
    const dry = editFrontmatter(loaded.text, plan.apply, { order: (k) => desiredOrder(k, type), forceOrder: true });
    const ok = options.silent
      ? true
      : await preview(plugin.app, {
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
      if (!options.silent) new Notice(outcome.error);
      return false;
    }
    return true;
  }

  /**
   * The note's domain changed: issue its unique ID again for the new domain, after a preview. The old value is kept in
   * `archived_fields` and never handed out again. Returns true when it was written.
   */
  async reissueUniqueId(file: TFile, type: ResolvedType): Promise<boolean> {
    const { plugin } = this;
    if (!plugin.requireOn()) return false;
    const loaded = await this.load(file);
    if (!loaded) return false;
    const reserved: string[] = [];
    const created = typeof loaded.fm.created === 'string' ? loaded.fm.created : '';
    const year = Number(/^(\d{4})/.exec(created)?.[1] ?? new Date().getFullYear());
    const now = new Date();
    const change = planUniqueId(loaded.fm, type, (typePrefix, domainPrefix, y) => {
      const id = plugin.ids.allocateUnique(typePrefix, domainPrefix, y);
      reserved.push(id);
      return id;
    }, year);
    if (!change) return false;
    const mutate = (fm: Frontmatter): void => applyUniqueId(fm, change, type, now);
    const dry = editFrontmatter(loaded.text, mutate, { order: (k) => desiredOrder(k, type), forceOrder: true });
    const ok = await preview(plugin.app, {
      title: `Issue a new unique ID for “${file.basename}”?`,
      lead: change.from !== undefined
        ? `The domain changed, so the unique ID ${change.from} no longer fits. The old one is kept in archived_fields and not used again. The ID (id) does not change.`
        : 'The note has no unique ID yet.',
      sections: [{ heading: 'Changes', lines: describeChanges(dry.changes) }],
      confirmText: 'Issue new unique ID',
    });
    if (!ok) {
      for (const id of reserved) plugin.ids.release(id);
      return false;
    }
    const outcome = await plugin.queue.editExact(file, loaded.text, { mutate, forceOrder: true });
    if (outcome.error) {
      for (const id of reserved) plugin.ids.release(id);
      new Notice(outcome.error);
      return false;
    }
    if (change.from !== undefined && !plugin.settings.retiredIds.includes(change.from)) {
      plugin.settings.retiredIds.push(change.from);
      await plugin.saveSettings();
    }
    new Notice(`Unique ID for “${file.basename}” is now ${change.to}.`);
    return true;
  }
}
