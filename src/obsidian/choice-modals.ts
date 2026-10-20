import { FuzzySuggestModal, Modal, Setting } from 'obsidian';
import type { App, TFolder } from 'obsidian';

export interface SchemaChoice {
  /** A type name, or null to leave the note unmanaged. */
  type: string | null;
  remember: boolean;
}

export interface SchemaChoiceOptions {
  title: string;
  /** Text under the title, e.g. which folder or note this is about. */
  lead: string;
  types: string[];
  allowUnmanaged: boolean;
  /** Show the "remember" tick box; text names what is remembered. */
  rememberText?: string;
  rememberDefault?: boolean;
  applyText?: string;
}

/**
 * "Which schema should this note use?" dialog. Resolves to a choice, or null for "Not now"
 * (including closing the dialog).
 */
export class SchemaChoiceModal extends Modal {
  private choice: string | null | undefined;
  private remember: boolean;
  private result: SchemaChoice | null = null;
  private readonly done: (r: SchemaChoice | null) => void;
  readonly promise: Promise<SchemaChoice | null>;

  constructor(app: App, private readonly opts: SchemaChoiceOptions) {
    super(app);
    this.remember = opts.rememberDefault ?? true;
    let resolve: (r: SchemaChoice | null) => void = () => undefined;
    this.promise = new Promise<SchemaChoice | null>((r) => (resolve = r));
    this.done = resolve;
  }

  onOpen(): void {
    const { contentEl, opts } = this;
    this.setTitle(opts.title);
    contentEl.createEl('p', { text: opts.lead });
    const list = contentEl.createDiv({ cls: 'vschema-choice-list', attr: { role: 'radiogroup' } });
    const add = (value: string | null, label: string) => {
      const row = list.createEl('label', { cls: 'vschema-choice' });
      const input = row.createEl('input', { type: 'radio', attr: { name: 'vschema-choice' } });
      row.createSpan({ text: label });
      input.addEventListener('change', () => {
        this.choice = value;
        apply.setDisabled(false);
      });
    };
    for (const t of opts.types) add(t, t);
    if (opts.allowUnmanaged) add(null, 'Leave unmanaged');

    let apply!: { setDisabled(v: boolean): unknown };
    const footer = new Setting(contentEl);
    if (opts.rememberText) {
      footer.setName(opts.rememberText).addToggle((t) => t.setValue(this.remember).onChange((v) => (this.remember = v)));
      footer.addExtraButton((b) => b.setIcon('info').setTooltip('Stored in the schema folder so you are not asked again'));
    }
    new Setting(contentEl)
      .addButton((b) => {
        apply = b;
        b.setButtonText(opts.applyText ?? 'Apply').setCta().setDisabled(true).onClick(() => {
          if (this.choice === undefined) return;
          this.result = { type: this.choice, remember: this.remember };
          this.close();
        });
      })
      .addButton((b) => b.setButtonText('Not now').onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    this.done(this.result);
  }
}

export function askSchemaChoice(app: App, opts: SchemaChoiceOptions): Promise<SchemaChoice | null> {
  const modal = new SchemaChoiceModal(app, opts);
  modal.open();
  return modal.promise;
}

/** Pick a vault folder (used for scope rules). */
export class FolderPickerModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private readonly exclude: (path: string) => boolean,
    private readonly onChoose: (path: string) => void,
  ) {
    super(app);
    this.setPlaceholder('Type a folder name');
  }

  getItems(): string[] {
    return this.app.vault
      .getAllFolders(false)
      .map((f: TFolder) => f.path)
      .filter((p) => !this.exclude(p));
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onChoose(item);
  }
}

export interface MappingEdit {
  folders: string[];
  type: string;
}

/** Edit one "folders -> type" mapping. */
export class MappingModal extends Modal {
  private folders: string;
  private type: string;
  private result: MappingEdit | null = null;
  private readonly done: (r: MappingEdit | null) => void;
  readonly promise: Promise<MappingEdit | null>;

  constructor(app: App, private readonly types: string[], initial: MappingEdit | null) {
    super(app);
    this.folders = initial?.folders.join(', ') ?? '';
    this.type = initial?.type ?? types[0] ?? '';
    let resolve: (r: MappingEdit | null) => void = () => undefined;
    this.promise = new Promise<MappingEdit | null>((r) => (resolve = r));
    this.done = resolve;
  }

  onOpen(): void {
    this.setTitle('Folder mapping');
    new Setting(this.contentEl)
      .setName('Root folders')
      .setDesc('Separate several folders with commas.')
      .addText((t) => t.setValue(this.folders).onChange((v) => (this.folders = v)));
    new Setting(this.contentEl).setName('Schema').addDropdown((d) => {
      for (const t of this.types) d.addOption(t, t);
      d.setValue(this.type).onChange((v) => (this.type = v));
    });
    new Setting(this.contentEl)
      .addButton((b) =>
        b.setButtonText('Save').setCta().onClick(() => {
          const folders = this.folders
            .split(',')
            .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
            .filter((s) => s.length > 0 && !s.includes('/'));
          if (folders.length === 0) return;
          this.result = { folders, type: this.type };
          this.close();
        }),
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    this.done(this.result);
  }
}

export function editMapping(app: App, types: string[], initial: MappingEdit | null): Promise<MappingEdit | null> {
  const modal = new MappingModal(app, types, initial);
  modal.open();
  return modal.promise;
}
