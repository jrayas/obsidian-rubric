import { Editor, EditorSuggest, TFile } from 'obsidian';
import type { EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo } from 'obsidian';
import { stringify } from 'yaml';
import { filterOptions, optionsFor } from '../core/options';
import type { OptionList, OptionValue } from '../core/options';
import type { PropertyDef } from '../core/schema-types';
import type VaultSchemaPlugin from '../main';

interface Suggestion {
  value: OptionValue;
  label: string;
  viaSynonym?: string;
}

type Form = 'scalar' | 'flow' | 'block';

interface Pending {
  def: PropertyDef;
  list: OptionList;
  form: Form;
}

/** Autocomplete in source mode: suggests schema values after `key: ` or inside a list under it. */
export class SchemaValueSuggest extends EditorSuggest<Suggestion> {
  private pending: Pending | null = null;

  constructor(private readonly plugin: VaultSchemaPlugin) {
    super(plugin.app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    this.pending = null;
    if (!file || !this.plugin.schemas.pack || this.plugin.settings.commandsOnly) return null;
    // The cursor must be inside the frontmatter block.
    if (editor.getLine(0).trim() !== '---' || cursor.line === 0) return null;
    for (let i = 1; i < cursor.line; i++) if (/^(---|\.\.\.)\s*$/.test(editor.getLine(i))) return null;
    if (/^(---|\.\.\.)\s*$/.test(editor.getLine(cursor.line))) return null;

    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    let key = '';
    let query = '';
    let form: Form = 'scalar';
    const flow = /^([^\s#:-][^:]*):\s*\[(.*)$/.exec(before);
    const scalar = /^([^\s#:-][^:]*):\s+(.*)$/.exec(before);
    const block = /^\s+-\s+(.*)$/.exec(before);
    if (flow?.[1] !== undefined && flow[2] !== undefined) {
      key = flow[1].trim();
      query = (flow[2].split(',').pop() ?? '').trimStart();
      form = 'flow';
    } else if (scalar?.[1] !== undefined && scalar[2] !== undefined) {
      key = scalar[1].trim();
      query = scalar[2];
      form = 'scalar';
    } else if (block?.[1] !== undefined) {
      query = block[1];
      form = 'block';
      for (let line = cursor.line - 1; line > 0; line--) {
        const m = /^([^\s#:-][^:]*):/.exec(editor.getLine(line));
        if (m?.[1]) {
          key = m[1].trim();
          break;
        }
      }
    }
    if (!key) return null;

    const ctx = this.plugin.notes.context(file);
    if (!ctx.type || !ctx.verdict.managed) return null;
    const def = ctx.type.byName.get(key);
    const pack = this.plugin.schemas.pack;
    if (!def || !pack) return null;
    const list = optionsFor(def, ctx.frontmatter?.[key], pack);
    if (!list || list.linkTarget) return null; // link lists are offered by the picker, not inline
    this.pending = { def, list, form };
    return { start: { line: cursor.line, ch: cursor.ch - query.length }, end: cursor, query };
  }

  getSuggestions(context: EditorSuggestContext): Suggestion[] {
    const p = this.pending;
    if (!p) return [];
    return filterOptions(p.list, context.query).map((f) => ({
      value: f.item.value,
      label: f.item.label,
      ...(f.viaSynonym ? { viaSynonym: f.viaSynonym } : {}),
    }));
  }

  renderSuggestion(s: Suggestion, el: HTMLElement): void {
    el.createSpan({ text: s.label });
    if (s.viaSynonym) el.createSpan({ cls: 'vschema-option-note', text: ` matches ${s.viaSynonym}` });
  }

  selectSuggestion(s: Suggestion): void {
    const ctx = this.context;
    const p = this.pending;
    if (!ctx || !p) return;
    const text = stringify(s.value).trim();
    // A list-typed key typed as plain text becomes a one-item list.
    const insert = p.def.type === 'list' && p.form === 'scalar' ? `[${text}]` : text;
    ctx.editor.replaceRange(insert, ctx.start, ctx.end);
    this.close();
  }
}
