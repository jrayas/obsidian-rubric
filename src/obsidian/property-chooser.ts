import { Notice, SuggestModal } from 'obsidian';
import type RubricPlugin from '../main';
import { OptionPickerModal } from './picker-modal';
import { OptionSession } from './option-session';

interface Choice {
  key: string;
  /** The current value, or the property's description. */
  hint: string;
}

const show = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Pick a property of the open note from a list, then pick its value in the picker window. Needs no focused property
 * and no keyboard, so it is how options are offered on a phone or tablet (the command palette takes the focus away).
 */
class PropertyChoiceModal extends SuggestModal<Choice> {
  constructor(private readonly plugin: RubricPlugin, private readonly choices: Choice[], private readonly onPick: (key: string) => void) {
    super(plugin.app);
    this.setPlaceholder('Choose a property');
  }

  getSuggestions(query: string): Choice[] {
    const q = query.trim().toLowerCase();
    return this.choices.filter((c) => c.key.toLowerCase().includes(q));
  }

  renderSuggestion(c: Choice, el: HTMLElement): void {
    el.createDiv({ text: c.key });
    if (c.hint) el.createEl('small', { text: c.hint, cls: 'rubric-choice-hint' });
  }

  onChooseSuggestion(c: Choice): void {
    this.onPick(c.key);
  }
}

/** The command "Choose a property to edit". */
export async function choosePropertyToEdit(plugin: RubricPlugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  if (!file || file.extension !== 'md') {
    new Notice('Open a note first.');
    return;
  }
  const ctx = plugin.notes.context(file);
  if (!ctx.verdict.managed) {
    new Notice('This note is outside the managed scope.');
    return;
  }
  if (!ctx.type) {
    new Notice('This note has no schema yet. Choose one first.');
    return;
  }
  const choices: Choice[] = [];
  for (const def of ctx.type.properties) {
    const loaded = await new OptionSession(plugin, file, def.name).load();
    if (loaded.kind === 'ready') choices.push({ key: def.name, hint: show(ctx.frontmatter?.[def.name]) || def.description || '' });
  }
  if (choices.length === 0) {
    new Notice(`The ${ctx.type.name} schema has no properties with a fixed list of values.`);
    return;
  }
  new PropertyChoiceModal(plugin, choices, (key) => new OptionPickerModal(plugin, file, key).open()).open();
}
