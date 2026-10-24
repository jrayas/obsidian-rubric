import { domainOf, typeFor } from './core/domain-overrides';
import { Notice, Plugin } from 'obsidian';
import type { TFile } from 'obsidian';
import { SchemaService } from './obsidian/schema-service';
import { NoteService } from './obsidian/note-service';
import { AutoSync } from './obsidian/auto-sync';
import { ChangeWatcher } from './obsidian/change-watcher';
import { openCreateNote } from './obsidian/create-note';
import { IdService } from './obsidian/id-service';
import { KnownIndex } from './obsidian/known-index';
import { ModifiedStamper } from './obsidian/modified-stamper';
import { NoteActions } from './obsidian/note-actions';
import { OptionPickerModal } from './obsidian/picker-modal';
import { PreviewWriter } from './obsidian/preview-writer';
import { PropertiesLayer } from './obsidian/properties-layer';
import { RegistryStore } from './obsidian/registry-store';
import { SchemaValueSuggest } from './obsidian/source-suggest';
import { propertyUnderFocus } from './obsidian/target-property';
import { openVaultCheck } from './obsidian/vault-check-view';
import { VocabularyStore } from './obsidian/vocabulary-store';
import { WriteQueue } from './obsidian/write-queue';
import { askSchemaChoice } from './obsidian/choice-modals';
import { RubricSettingTab } from './obsidian/settings-tab';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';
import type { RubricSettings } from './settings';

export default class RubricPlugin extends Plugin {
  settings: RubricSettings = { ...DEFAULT_SETTINGS };
  schemas!: SchemaService;
  registry!: RegistryStore;
  notes!: NoteService;
  queue!: WriteQueue;
  layer!: PropertiesLayer;
  ids!: IdService;
  known!: KnownIndex;
  autoSync!: AutoSync;
  previews!: PreviewWriter;
  actions!: NoteActions;
  vocabulary!: VocabularyStore;
  private stamper!: ModifiedStamper;
  watcher!: ChangeWatcher;
  private readonly shownOnce = new Set<string>();

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.schemas = new SchemaService(this.app, this, () => this.settings);
    this.registry = new RegistryStore(this.app, this.schemas);
    this.notes = new NoteService(this.app, this, this.schemas, this.registry, () => this.settings, () => this.saveSettings());
    this.queue = new WriteQueue(this.app, (file, fm) => {
      const pack = this.schemas.pack;
      const ctx = this.notes.context(file, fm);
      return ctx.type ?? (pack && typeof fm.type === 'string' ? (typeFor(pack, fm.type, domainOf(fm)) ?? null) : null);
    });
    this.layer = new PropertiesLayer(this);
    this.ids = new IdService(this.app, () => this.settings);
    this.actions = new NoteActions(this);
    this.vocabulary = new VocabularyStore(this.app, this.schemas);
    this.known = new KnownIndex(this);
    this.autoSync = new AutoSync(this);
    this.previews = new PreviewWriter(this);
    this.stamper = new ModifiedStamper(this);
    this.watcher = new ChangeWatcher(this);
    this.notes.applyType = (file, type) => this.applyType(file, type);
    this.notes.fillNew = async (file, type, action) => {
      const done = await this.actions.complete(file, type, { silent: action === 'fill' });
      if (done) await this.autoSync.afterFill(file);
    };
    this.addSettingTab(new RubricSettingTab(this.app, this));
    this.registerEditorSuggest(new SchemaValueSuggest(this));

    this.addCommand({
      id: 'reload-schemas',
      name: 'Reload schemas',
      callback: () => void this.schemas.reload('manual'),
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
      id: 'check-vault',
      name: 'Check vault',
      callback: () => openVaultCheck(this),
    });
    this.addCommand({
      id: 'convert-note-type',
      name: 'Convert this note to another type',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md' || !this.schemas.pack) return false;
        if (!checking) void this.convertActive(file);
        return true;
      },
    });
    this.addCommand({
      id: 'create-note-from-schema',
      name: 'Create note from schema',
      callback: () => openCreateNote(this),
    });
    this.addCommand({
      id: 'show-all-options',
      name: 'Show all options for this property',
      callback: () => this.showAllOptions(),
    });

    this.app.workspace.onLayoutReady(() => {
      void this.schemas.start().then(() => {
        this.notes.start();
        this.stamper.start();
        this.known.start();
        this.autoSync.start();
        this.watcher.start();
        this.syncLayer();
      });
    });
    this.register(this.schemas.onChange(() => {
      this.layer.refreshCovered();
      this.previews.schedule();
    }));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Called by the settings page after a setting that needs a side effect changes. */
  async onSettingChanged(key: keyof RubricSettings): Promise<void> {
    await this.saveSettings();
    if (key === 'commandsOnly') this.syncLayer();
    if (key === 'writePreviews' && this.settings.writePreviews) void this.previews.sync();
  }

  /** Install or remove the Properties-area layer to match the "commands only" setting. */
  syncLayer(): void {
    if (this.settings.commandsOnly) this.layer.uninstall();
    else this.layer.install();
  }

  onunload(): void {
    this.layer?.uninstall();
    this.stamper?.stop();
    this.known?.stop();
    this.previews?.stop();
    this.watcher?.stop();
  }

  /** A schema was chosen for one note without remembering the folder: give the note what its type needs. */
  private async applyType(file: TFile, typeName: string): Promise<void> {
    const pack = this.schemas.pack;
    const type = pack ? typeFor(pack, typeName, domainOf(this.notes.frontmatterOf(file))) : undefined;
    if (type) await this.actions.complete(file, type);
  }

  private async convertActive(file: TFile): Promise<void> {
    const pack = this.schemas.pack;
    if (!pack) return;
    const current = this.notes.context(file).type;
    if (!current) {
      new Notice('This note has no schema yet. Choose one first.');
      return;
    }
    const choice = await askSchemaChoice(this.app, {
      title: `Convert “${file.basename}”`,
      lead: `The note is a ${current.name}. Which type should it become?`,
      types: pack.typeNames.filter((t) => t !== current.name),
      allowUnmanaged: false,
      applyText: 'Preview',
    });
    const to = choice?.type ? typeFor(pack, choice.type, domainOf(this.notes.frontmatterOf(file))) : null;
    if (to) await this.actions.convert(file, to, current);
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
}
