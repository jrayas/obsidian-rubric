import { Modal, Notice, Setting, normalizePath } from 'obsidian';
import { newNoteFrontmatter } from '../core/create';
import { checkFileName } from '../core/fs-names';
import { desiredOrder, editFrontmatter } from '../core/frontmatter';
import { insertBodyIfEmpty, useTemplate } from '../core/templates';
import type VaultSchemaPlugin from '../main';

/** "Create note from schema": pick a type, a name and a folder; the note is created with an ID and every default. */
export class CreateNoteModal extends Modal {
  private type: string;
  private name = '';
  private folder = '';
  private errorEl: HTMLElement | null = null;
  private folderSetting: Setting | null = null;

  constructor(private readonly plugin: VaultSchemaPlugin) {
    super(plugin.app);
    this.type = plugin.schemas.pack?.typeNames[0] ?? '';
  }

  private foldersFor(type: string): string[] {
    return (this.plugin.schemas.pack?.folders.mappings ?? []).filter((m) => m.type === type).map((m) => m.folder);
  }

  onOpen(): void {
    const pack = this.plugin.schemas.pack;
    if (!pack) {
      this.contentEl.createEl('p', { text: 'No schemas are loaded.' });
      return;
    }
    this.setTitle('Create note from schema');
    this.folder = this.foldersFor(this.type)[0] ?? '';
    new Setting(this.contentEl).setName('Type').addDropdown((d) => {
      for (const t of pack.typeNames) d.addOption(t, t);
      d.setValue(this.type).onChange((v) => {
        this.type = v;
        this.folder = this.foldersFor(v)[0] ?? '';
        this.renderFolder();
      });
    });
    new Setting(this.contentEl).setName('Name').addText((t) => {
      t.setPlaceholder('Note name').onChange((v) => {
        this.name = v;
        this.validate();
      });
      window.setTimeout(() => t.inputEl.focus(), 0);
      t.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void this.submit();
      });
    });
    this.folderSetting = new Setting(this.contentEl).setName('Folder');
    this.renderFolder();
    this.errorEl = this.contentEl.createDiv({ cls: 'vschema-error', attr: { role: 'alert' } });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Create').setCta().onClick(() => void this.submit()))
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  private renderFolder(): void {
    const s = this.folderSetting;
    if (!s) return;
    s.controlEl.empty();
    const mapped = this.foldersFor(this.type);
    s.addDropdown((d) => {
      for (const f of mapped) d.addOption(f, f);
      d.addOption('', 'Vault root');
      d.setValue(this.folder).onChange((v) => (this.folder = v));
    });
  }

  private validate(): string | null {
    const msg = checkFileName(this.name);
    const clash = !msg && this.plugin.app.vault.getAbstractFileByPath(this.pathFor());
    const text = this.name.length === 0 ? null : (msg ?? (clash ? 'A note with this name already exists there.' : null));
    this.errorEl?.setText(text ?? '');
    return this.name.length === 0 ? 'A name is required.' : text;
  }

  private pathFor(): string {
    return normalizePath(`${this.folder ? this.folder + '/' : ''}${this.name}.md`);
  }

  private async submit(): Promise<void> {
    const problem = this.validate();
    if (problem) {
      this.errorEl?.setText(problem);
      return;
    }
    const { plugin } = this;
    const type = plugin.schemas.pack?.types.get(this.type);
    if (!type) return;
    const path = this.pathFor();
    try {
      const file = await plugin.ids.exclusive(async () => {
        const now = new Date();
        const id = plugin.ids.allocate(type.prefix, now.getFullYear());
        const fm = newNoteFrontmatter(type, { name: this.name, id, now });
        // the type's template: starting values replace the defaults, and its body is the new note's text
        const tpl = plugin.settings.useSchemaTemplates ? plugin.schemas.pack?.templates.get(type.name) : undefined;
        const use = useTemplate(tpl, type, { name: this.name, id, type: type.name, now, folder: this.folder });
        for (const [k, v] of Object.entries(use.values)) fm[k] = v;
        const text = editFrontmatter(
          '',
          (draft) => {
            for (const [k, v] of Object.entries(fm)) draft[k] = v;
          },
          { order: (keys) => desiredOrder(keys, type), body: (b) => insertBodyIfEmpty(b, use.body) },
        ).text;
        if (this.folder && !plugin.app.vault.getFolderByPath(this.folder)) await plugin.app.vault.createFolder(this.folder);
        plugin.queue.ledger.record(path, text);
        return plugin.app.vault.create(path, text);
      });
      this.close();
      await plugin.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      this.errorEl?.setText(e instanceof Error ? e.message : String(e));
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function openCreateNote(plugin: VaultSchemaPlugin): void {
  if (!plugin.schemas.pack) {
    new Notice('No schemas are loaded yet.');
    return;
  }
  new CreateNoteModal(plugin).open();
}
