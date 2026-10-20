import { Notice, Plugin, normalizePath } from 'obsidian';
import { STARTER_PACK } from './pack';
import { SchemaService } from './obsidian/schema-service';
import { confirm } from './obsidian/modals';
import { NoteService } from './obsidian/note-service';
import { OptionPickerModal } from './obsidian/picker-modal';
import { PropertiesLayer } from './obsidian/properties-layer';
import { RegistryStore } from './obsidian/registry-store';
import { SchemaValueSuggest } from './obsidian/source-suggest';
import { propertyUnderFocus } from './obsidian/target-property';
import { WriteQueue } from './obsidian/write-queue';
import { VaultSchemaSettingTab } from './obsidian/settings-tab';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';
import type { VaultSchemaSettings } from './settings';

export default class VaultSchemaPlugin extends Plugin {
  settings: VaultSchemaSettings = { ...DEFAULT_SETTINGS };
  schemas!: SchemaService;
  registry!: RegistryStore;
  notes!: NoteService;
  queue!: WriteQueue;
  layer!: PropertiesLayer;
  private readonly shownOnce = new Set<string>();

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.schemas = new SchemaService(this.app, this, () => this.settings);
    this.registry = new RegistryStore(this.app, this.schemas);
    this.notes = new NoteService(this.app, this, this.schemas, this.registry, () => this.settings, () => this.saveSettings());
    this.queue = new WriteQueue(this.app, (file, fm) => {
      const pack = this.schemas.pack;
      const ctx = this.notes.context(file, fm);
      return ctx.type ?? (pack && typeof fm.type === 'string' ? (pack.types.get(fm.type) ?? null) : null);
    });
    this.layer = new PropertiesLayer(this);
    this.addSettingTab(new VaultSchemaSettingTab(this.app, this));
    this.registerEditorSuggest(new SchemaValueSuggest(this));

    this.addCommand({
      id: 'reload-schemas',
      name: 'Reload schemas',
      callback: () => void this.schemas.reload('manual'),
    });
    this.addCommand({
      id: 'open-schema-folder',
      name: 'Open schema folder',
      callback: () => this.openSchemaFolder(),
    });
    this.addCommand({
      id: 'install-starter-schemas',
      name: 'Install starter schema pack',
      callback: () => void this.installStarterPack(),
    });

    this.addCommand({
      id: 'choose-schema',
      name: 'Choose schema for this note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md' || !this.schemas.pack) return false;
        if (!checking) void this.notes.promptForSchema(file, this.notes.context(file).match);
        return true;
      },
    });

    this.addCommand({
      id: 'show-all-options',
      name: 'Show all options for this property',
      callback: () => this.showAllOptions(),
    });

    this.app.workspace.onLayoutReady(() => {
      void this.schemas.start().then(() => {
        this.notes.start();
        this.syncLayer();
      });
    });
    this.register(this.schemas.onChange(() => this.layer.refreshCovered()));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Called by the settings page after a setting that needs a side effect changes. */
  async onSettingChanged(key: keyof VaultSchemaSettings): Promise<void> {
    await this.saveSettings();
    if (key === 'commandsOnly') this.syncLayer();
  }

  /** Install or remove the Properties-area layer to match the "commands only" setting. */
  syncLayer(): void {
    if (this.settings.commandsOnly) this.layer.uninstall();
    else this.layer.install();
  }

  onunload(): void {
    this.layer?.uninstall();
  }

  /** Show a notice. */
  notify(message: string): void {
    new Notice(message);
  }

  /** Show a notice only the first time `id` is seen in this session. */
  notifyOnce(id: string, message: string): void {
    if (this.shownOnce.has(id)) return;
    this.shownOnce.add(id);
    new Notice(message);
  }

  /** The command and hotkey target: latch the list of the focused property, or open the picker window. */
  private showAllOptions(): void {
    if (this.layer.installed && this.layer.toggleFocused()) return;
    const target = propertyUnderFocus(this.app);
    if (!target) {
      new Notice('Click into a property first.');
      return;
    }
    new OptionPickerModal(this, target.file, target.key).open();
  }

  /** Show the schema folder in the system file manager (Finder or Explorer). */
  openSchemaFolder(): void {
    const folder = this.schemas.folder;
    const adapter = this.app.vault.adapter as { getFullPath?: (p: string) => string };
    const full = adapter.getFullPath?.(normalizePath(folder));
    const req = (window as unknown as { require?: (m: string) => { shell?: { openPath(p: string): Promise<string> } } }).require;
    const shell = req?.('electron')?.shell;
    if (full && shell) {
      void shell.openPath(full);
    } else {
      new Notice(`Schema folder: ${folder}`);
    }
  }

  /** Create the starter pack files that do not exist yet. Never overwrites. Asks first. */
  async installStarterPack(): Promise<void> {
    const folder = this.schemas.folder;
    const adapter = this.app.vault.adapter;
    const missing: string[] = [];
    for (const rel of Object.keys(STARTER_PACK)) {
      if (!(await adapter.exists(normalizePath(`${folder}/${rel}`)))) missing.push(rel);
    }
    if (missing.length === 0) {
      new Notice(`The starter schema pack is already in ${folder}. Nothing to create.`);
      return;
    }
    const ok = await confirm(
      this.app,
      'Install starter schema pack?',
      [
        `This creates ${missing.length} files in "${folder}/". Existing files are never overwritten.`,
        missing.join(', '),
      ],
      'Create files',
    );
    if (!ok) return;
    for (const rel of missing) {
      const path = normalizePath(`${folder}/${rel}`);
      const dir = path.split('/').slice(0, -1).join('/');
      if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
      await adapter.write(path, STARTER_PACK[rel] ?? '');
    }
    new Notice(`Created ${missing.length} schema files in ${folder}.`);
    await this.schemas.reload('manual');
  }
}
