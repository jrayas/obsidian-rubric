import { TFile } from 'obsidian';
import { readFrontmatter } from '../core/frontmatter';
import type { Frontmatter } from '../core/frontmatter';
import { applyPick, lockNote, optionsFor } from '../core/options';
import type { OptionItem, OptionList, OptionValue } from '../core/options';
import type { PropertyDef, ResolvedType } from '../core/schema-types';
import type VaultSchemaPlugin from '../main';

export type SessionLoad =
  | { kind: 'ready'; def: PropertyDef; type: ResolvedType; list: OptionList }
  | { kind: 'locked'; def: PropertyDef | undefined; note: string }
  | { kind: 'unavailable'; message: string };

/** Link text as written in a note: `[[Name]]`, or `[[Name#Heading]]`. */
const wiki = (name: string) => `[[${name}]]`;

function linkName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const m = /^\[\[([^\]|#]+)/.exec(value);
  return m?.[1]?.trim() ?? '';
}

/**
 * Everything needed to offer and save the options of one property of one note: used by the picker
 * window and by the popover in the Properties area.
 */
export class OptionSession {
  constructor(
    private readonly plugin: VaultSchemaPlugin,
    readonly file: TFile,
    readonly key: string,
  ) {}

  private async currentFrontmatter(): Promise<Frontmatter> {
    const text = await this.plugin.app.vault.cachedRead(this.file);
    try {
      return readFrontmatter(text) ?? {};
    } catch {
      return {};
    }
  }

  async load(): Promise<SessionLoad> {
    const { plugin } = this;
    const pack = plugin.schemas.pack;
    if (!pack) return { kind: 'unavailable', message: 'No schemas are loaded.' };
    const fm = await this.currentFrontmatter();
    const ctx = plugin.notes.context(this.file, fm);
    if (!ctx.verdict.managed) return { kind: 'unavailable', message: 'This note is outside the managed scope.' };
    if (!ctx.type) return { kind: 'unavailable', message: 'This note has no schema. Use “Choose schema for this note”.' };
    const def = ctx.type.byName.get(this.key) ?? [...ctx.type.byName.values()].find((p) => p.name.toLowerCase() === this.key.toLowerCase());
    const note = lockNote(this.key, def);
    if (note) return { kind: 'locked', def, note };
    if (!def) return { kind: 'unavailable', message: `The ${ctx.type.name} schema has no property “${this.key}”.` };
    const list = this.buildList(def, fm[def.name]);
    if (!list) return { kind: 'unavailable', message: `“${def.name}” has no fixed list of values.` };
    return { kind: 'ready', def, type: ctx.type, list };
  }

  private buildList(def: PropertyDef, current: unknown): OptionList | null {
    const pack = this.plugin.schemas.pack;
    if (!pack) return null;
    const list = optionsFor(def, current, pack);
    if (list?.linkTarget) list.items = this.linkItems(list.linkTarget, current);
    return list;
  }

  /** Notes of the target type, as options. */
  private linkItems(target: string, current: unknown): OptionItem[] {
    const have = new Set((Array.isArray(current) ? current : [current]).map(linkName).filter((n) => n.length > 0));
    const names = new Map<string, number>();
    const items: OptionItem[] = [];
    for (const f of this.plugin.app.vault.getMarkdownFiles()) {
      if (f.path === this.file.path) continue;
      const ctx = this.plugin.notes.context(f);
      if (ctx.type?.name !== target) continue;
      names.set(f.basename, (names.get(f.basename) ?? 0) + 1);
      items.push({ value: wiki(f.basename), label: f.basename, checked: have.has(f.basename), synonyms: [] });
    }
    return items.sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Save a pick through the write queue and return the refreshed list. */
  async pick(value: OptionValue): Promise<OptionList | null> {
    const loaded = await this.load();
    if (loaded.kind !== 'ready') return null;
    const { def, list } = loaded;
    const pack = this.plugin.schemas.pack;
    if (!pack) return null;
    const fm = await this.currentFrontmatter();
    const next = applyPick(def, fm[def.name], list, value, pack);
    const outcome = await this.plugin.queue.set(this.file, { [def.name]: next });
    if (outcome.error) {
      this.plugin.notify(`Could not save “${def.name}”: ${outcome.error}`);
      return list;
    }
    return this.buildList(def, next);
  }
}
