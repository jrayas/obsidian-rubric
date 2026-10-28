import { domainOf, typeFor } from './core/domain-overrides';
import { Notice, Plugin, normalizePath } from 'obsidian';
import type { TFile } from 'obsidian';
import { STARTER_PACK } from './pack';
import { SchemaService } from './obsidian/schema-service';
import { confirm } from './obsidian/modals';
import { NoteService } from './obsidian/note-service';
import { AutoSync } from './obsidian/auto-sync';
import { BodyAccess } from './obsidian/body-access';
import { showBodySections } from './obsidian/body-demo';
import { bodyEditorExtension } from './obsidian/body-editor';
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
import { SchemaPresets } from './obsidian/schema-presets';
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
  /** Reads and edits note bodies; holds the body handlers. Nothing uses it yet. */
  body!: BodyAccess;
  /** Named copies of the schema folder, and the zip export. */
  presets!: SchemaPresets;
  private stamper!: ModifiedStamper;
  private settingTab: RubricSettingTab | null = null;
  watcher!: ChangeWatcher;
  private readonly shownOnce = new Set<string>();
  private statusEl: HTMLElement | null = null;

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
    this.body = new BodyAccess(this);
    this.presets = new SchemaPresets(this);
    this.registerEditorExtension(bodyEditorExtension(this));
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
    this.settingTab = new RubricSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.statusEl = this.addStatusBarItem();
    this.registerDomEvent(this.statusEl, 'click', () => void this.toggleActive());
    this.updateStatus();
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
      id: 'toggle-active',
      name: 'Toggle automation on or off',
      callback: () => void this.toggleActive(),
    });

    this.addCommand({
      id: 'choose-schema',
      name: 'Choose schema for this note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md' || !this.schemas.pack) return false;
        if (!checking && this.requireOn()) void this.notes.promptForSchema(file, this.notes.context(file).match);
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
        if (!checking && this.requireOn()) void this.convertActive(file);
        return true;
      },
    });
    this.addCommand({
      id: 'create-note-from-schema',
      name: 'Create note from schema',
      callback: () => {
        if (this.requireOn()) openCreateNote(this);
      },
    });
    this.addCommand({
      id: 'save-schema-preset',
      name: 'Save schema as preset',
      callback: () => void this.presets.save(),
    });
    this.addCommand({
      id: 'apply-schema-preset',
      name: 'Apply schema preset',
      callback: () =>
        void this.presets.pick().then(async (p) => {
          if (p) await this.presets.apply(p.slug);
        }),
    });
    this.addCommand({
      id: 'export-schema-zip',
      name: 'Export schema as zip',
      callback: () => void this.presets.exportZip(),
    });
    this.addCommand({
      id: 'body-show-sections',
      name: 'Body access: show sections',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!this.settings.debugBodyAccess || !file || file.extension !== 'md') return false;
        if (!checking) void showBodySections(this);
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
        this.stamper.start();
        this.known.start();
        this.autoSync.start();
        this.watcher.start();
        void this.presets.refresh().then(() => this.refreshSettings());
        this.syncLayer();
        if (!this.settings.enabled) {
          this.notifyOnce('off-at-start', 'Rubric is off, so it will not change or ask about your notes. Turn it on in its settings, or click its item in the status bar.');
        }
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

  /** Redraw the settings page if it is open (a list on it changed). */
  refreshSettings(): void {
    this.settingTab?.update();
  }

  /** Forget retired IDs, so their numbers can be issued again where nothing higher is in use. */
  async releaseRetired(ids: string[]): Promise<void> {
    const gone = new Set(ids);
    this.settings.retiredIds = this.settings.retiredIds.filter((id) => !gone.has(id));
    await this.saveSettings();
    this.refreshSettings();
  }

  /** Called by the settings page after a setting that needs a side effect changes. */
  async onSettingChanged(key: keyof RubricSettings): Promise<void> {
    await this.saveSettings();
    if (key === 'commandsOnly') this.syncLayer();
    if (key === 'enabled') this.onActiveChanged();
    if (key === 'writePreviews' && this.settings.writePreviews) void this.previews.sync();
  }

  /** Is the master switch on? Everything that changes a note on its own, or asks about one, checks this first. */
  isOn(): boolean {
    return this.settings.enabled;
  }

  /** For something the user asked for that needs the switch on: say so and return false when it is off. */
  requireOn(): boolean {
    if (this.settings.enabled) return true;
    new Notice('Rubric is off, so it will not change notes. Turn it on in its settings, or click its item in the status bar.');
    return false;
  }

  async toggleActive(): Promise<void> {
    this.settings.enabled = !this.settings.enabled;
    await this.onSettingChanged('enabled');
  }

  /** The switch changed (settings page, command or status bar): drop pending work when it went off, and say what happened. */
  private onActiveChanged(): void {
    if (!this.settings.enabled) {
      // Stamps and prompts that were waiting for a quiet moment are dropped, not postponed. A write already running finishes.
      this.stamper.stop();
      this.watcher.stop();
    }
    this.updateStatus();
    new Notice(this.settings.enabled ? 'Rubric is on.' : 'Rubric is off. It will not change or ask about your notes.');
  }

  private updateStatus(): void {
    const el = this.statusEl;
    if (!el) return;
    const on = this.settings.enabled;
    el.setText(on ? 'Rubric: on' : 'Rubric: off');
    el.setAttribute('aria-label', on ? 'Rubric is on. Click to turn it off.' : 'Rubric is off. Click to turn it on.');
    el.addClass('rubric-status');
    el.toggleClass('rubric-status-off', !on);
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
