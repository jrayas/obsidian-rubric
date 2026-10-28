import { Notice, PluginSettingTab } from 'obsidian';
import type { App, SettingDefinitionItem } from 'obsidian';
import { DEFAULT_SCHEMA_FOLDER, HIDDEN_SCHEMA_FOLDER, isInSchemaFolder } from '../core/folder-detect';
import { nameKey } from '../core/normalise';
import { reviewRetired } from '../core/retired-ids';
import { formatLocal } from '../core/timestamps';
import type { MatchingMode, ScopeMode } from '../core/schema-types';
import { FolderPickerModal, askSchemaChoice, editMapping } from './choice-modals';
import { confirm } from './modals';
import type { RubricSettings } from '../settings';
import type RubricPlugin from '../main';

type FolderChoice = typeof DEFAULT_SCHEMA_FOLDER | typeof HIDDEN_SCHEMA_FOLDER | 'custom';

export class RubricSettingTab extends PluginSettingTab {
  /** True once the user picked "Custom folder" in the dropdown, until a name is typed. */
  private customPicked = false;
  private unsubscribe: (() => void) | null = null;

  constructor(app: App, private readonly plugin: RubricPlugin) {
    super(app, plugin);
  }

  hide(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.hide();
  }

  private folderChoice(): FolderChoice {
    const f = this.plugin.settings.schemaFolder;
    if (this.customPicked) return 'custom';
    if (f === DEFAULT_SCHEMA_FOLDER || f === HIDDEN_SCHEMA_FOLDER) return f;
    return 'custom';
  }

  getControlValue(key: string): unknown {
    const schemas = this.plugin.schemas;
    switch (key) {
      case 'folderChoice':
        return this.folderChoice();
      case 'matchingMode':
        return schemas.pack?.folders.mode ?? 'combined';
      case 'scopeMode':
        return schemas.pack?.scope.mode ?? 'exclude';
      default:
        return this.plugin.settings[key as keyof RubricSettings];
    }
  }

  setControlValue(key: string, value: unknown): void | Promise<void> {
    const { plugin } = this;
    if (key === 'folderChoice') {
      if (value === 'custom') {
        this.customPicked = true;
        this.update();
        return;
      }
      this.customPicked = false;
      plugin.settings.schemaFolder = String(value);
      return this.persistAndReload();
    }
    if (key === 'matchingMode') return plugin.registry.setMatchingMode(value as MatchingMode);
    if (key === 'scopeMode') return plugin.registry.setScopeMode(value as ScopeMode);
    (plugin.settings as unknown as Record<string, unknown>)[key] = value;
    if (key === 'schemaFolder') return this.persistAndReload();
    return plugin.onSettingChanged(key as keyof RubricSettings);
  }

  private async persistAndReload(): Promise<void> {
    await this.plugin.saveSettings();
    await this.plugin.schemas.reload('manual');
    this.update();
  }

  private statusText(): string {
    const { status, pack } = this.plugin.schemas;
    const errors = status.problems.filter((p) => p.severity === 'error');
    if (!status.detection.exists) return `Folder "${status.detection.folder}" not found.`;
    const counts = pack
      ? `${pack.types.size} types · ${pack.modules.size} modules · ${pack.vocabularies.size} vocab`
      : 'no schemas loaded';
    if (errors.length > 0) return `${status.usingLastGood ? 'Using last good copy: ' : ''}${counts} · ${errors.length} error${errors.length > 1 ? 's' : ''}`;
    return `Found: ${counts}`;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const { plugin } = this;
    if (!this.unsubscribe) this.unsubscribe = plugin.schemas.onChange(() => this.update());
    const pack = plugin.schemas.pack;
    const scopeMode = (): ScopeMode => pack?.scope.mode ?? 'exclude';

    // Group mappings by type for display: "Knowledge, Wiki -> kb".
    const byType = new Map<string, string[]>();
    for (const m of pack?.folders.mappings ?? []) byType.set(m.type, [...(byType.get(m.type) ?? []), m.folder]);
    const mappingGroups = [...byType.entries()];

    const schemaFolderRoot = (path: string) => isInSchemaFolder(path, plugin.schemas.folder);
    const scopeList = (list: 'exclude' | 'include'): SettingDefinitionItem => {
      const entries = pack?.scope[list] ?? [];
      return {
        type: 'list',
        heading: list === 'exclude' ? 'Excluded folders' : 'Included folders',
        visible: () => list === 'exclude' || scopeMode() === 'include-only',
        emptyState: list === 'exclude' ? 'No folders are excluded.' : 'No folders are included yet.',
        items: entries.map((f) => ({ name: f })),
        onDelete: (i) => {
          const folder = entries[i];
          if (folder !== undefined) void plugin.registry.removeScopeFolder(list, folder);
        },
        addItem: {
          name: 'Add folder',
          action: () =>
            new FolderPickerModal(this.app, schemaFolderRoot, (p) => void plugin.registry.addScopeFolder(list, p)).open(),
        },
      };
    };

    const presets = plugin.presets.items;
    const retired = reviewRetired(plugin.settings.retiredIds, plugin.settings.retiredIds.length > 0 ? [...plugin.ids.usedIds(), ...plugin.ids.usedUniqueIds()] : []);

    const problems = plugin.schemas.status.problems;
    const conflicts = pack?.folders.conflicts ?? [];

    return [
      {
        type: 'group',
        heading: 'Switch',
        items: [
          {
            name: 'Turn on Rubric',
            desc: 'While this is off, Rubric never changes a note and never asks about one: no modified stamps, no filling of new notes, no prompts, conversions or fixes. It still loads and checks your schema files, reports problems, runs Check vault and offers option lists. Turn it on when your schema is ready.',
            control: { type: 'toggle', key: 'enabled' },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Schema folder',
        items: [
          {
            name: 'Name',
            desc: 'The folder in your vault that holds the schema files. A name starting with a dot is hidden from Obsidian but still read; use "Reload schemas" after editing it elsewhere.',
            control: {
              type: 'dropdown',
              key: 'folderChoice',
              options: { [DEFAULT_SCHEMA_FOLDER]: DEFAULT_SCHEMA_FOLDER, [HIDDEN_SCHEMA_FOLDER]: HIDDEN_SCHEMA_FOLDER, custom: 'Custom folder' },
            },
          },
          {
            name: 'Custom folder name',
            visible: () => this.folderChoice() === 'custom',
            control: {
              type: 'text',
              key: 'schemaFolder',
              validate: (v: string) => (!v.trim() || /[\\/:*?"<>|]/.test(v) ? 'Use a single folder name without / \\ : * ? " < > |' : undefined),
            },
          },
          {
            name: 'Status',
            render: (setting) => {
              setting.setName('Status').setDesc(this.statusText());
            },
          },
          {
            name: 'Write property previews to the schema folder',
            desc: 'Generated read-only files in the preview folder inside the schema folder: what a new note of each type starts with. Rewritten whenever the schema changes; never read back.',
            control: { type: 'toggle', key: 'writePreviews' },
          },
          { name: 'Reload schemas', desc: 'Read the schema files again now.', action: () => void plugin.schemas.reload('manual') },
          { name: 'Open schema folder', desc: 'Show the folder in your file manager.', action: () => plugin.openSchemaFolder() },
          { name: 'Install starter schema pack', desc: 'Create the starter files that are missing. Never overwrites.', action: () => void plugin.installStarterPack() },
        ],
      },
      {
        type: 'group',
        heading: 'Matching',
        items: [
          {
            name: 'Mode',
            desc: 'Combined: type, then breadcrumb, then folder, then ask. Auto: breadcrumb and folder only. Manual: only the type and mapped folders. Stored in registry/folders.yaml.',
            control: { type: 'dropdown', key: 'matchingMode', options: { combined: 'Combined', auto: 'Auto', manual: 'Manual' } },
          },
          {
            name: 'No match',
            control: { type: 'dropdown', key: 'noMatch', options: { ask: 'Ask me', unmanaged: 'Leave unmanaged' } },
          },
          {
            name: 'Remember my answer as a folder mapping',
            control: { type: 'toggle', key: 'rememberAnswer' },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Scope',
        items: [
          {
            name: 'Mode',
            desc: 'Exclude always wins. The schema folder is always excluded. Stored in registry/scope.yaml.',
            control: { type: 'dropdown', key: 'scopeMode', options: { exclude: 'Everything except excluded', 'include-only': 'Only included folders' } },
          },
        ],
      },
      scopeList('exclude'),
      scopeList('include'),
      {
        type: 'group',
        heading: 'Properties area',
        items: [
          { name: 'Click', desc: 'Click into a value for autocomplete from the note’s schema.' },
          {
            name: 'Hold key',
            desc: 'Hold this key while a property is focused to show every allowed value. Option on Mac, Alt on Windows.',
            control: {
              type: 'dropdown',
              key: 'holdKey',
              options: { Alt: 'Option / Alt', Shift: 'Shift', Control: 'Control', Meta: 'Command / Windows' },
            },
          },
          {
            name: 'Hold delay',
            desc: 'Milliseconds to hold before the list appears.',
            control: { type: 'number', key: 'holdDelayMs', min: 0, max: 2000, step: 10 },
          },
          {
            name: 'Always hide the list on release',
            desc: 'By default the list stays open if the pointer is over it when you let go.',
            control: { type: 'toggle', key: 'alwaysHideOnRelease' },
          },
          { name: 'Latched list hotkey', desc: 'Set a hotkey for “Show all options for this property” in Obsidian’s hotkey settings.' },
          { name: 'Show hint on focus', control: { type: 'toggle', key: 'showHint' } },
          {
            name: 'Commands only',
            desc: 'Turn off the Properties area features. The commands and pickers still work.',
            control: { type: 'toggle', key: 'commandsOnly' },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Automation',
        items: [
          { name: 'Stamp modified silently', control: { type: 'toggle', key: 'stampModified' } },
          {
            name: 'Batch mode when many notes change',
            desc: 'Wait for a burst of changes to settle, then process them once.',
            control: { type: 'toggle', key: 'batchMode' },
          },
          {
            name: 'When a note is created in a mapped folder',
            desc: 'Fill automatically adds the schema properties (ID, created, defaults) without asking. Ask shows a preview first. Only new notes without an ID are touched; notes that arrive through sync and excluded folders are left alone.',
            control: { type: 'dropdown', key: 'onCreate', options: { ask: 'Ask with a preview', fill: 'Fill automatically', nothing: 'Do nothing' } },
          },
          {
            name: 'Wait before filling a new note (milliseconds)',
            desc: 'Gives Obsidian’s Templates plugin (or another plugin) time to finish first. Only missing properties are added; nothing already written is changed.',
            visible: () => this.plugin.settings.onCreate !== 'nothing',
            control: { type: 'number', key: 'createDelayMs', min: 700, max: 30000, step: 100 },
          },
          {
            name: 'Keep the name property in step with the file name',
            desc: 'After a rename, name follows the file name only if it was empty or filled by this plugin. A name you wrote is never overwritten.',
            control: { type: 'toggle', key: 'syncName' },
          },
          {
            name: 'Set breadcrumb from the folder',
            desc: 'Writes the real folder path to breadcrumb when a note is created or moved. Turn on only if you do not use a breadcrumb plugin, because two writers will fight.',
            control: { type: 'toggle', key: 'breadcrumbFromFolder' },
          },
          {
            name: 'Ask about changes in',
            desc: 'Notes you have open (default), or every note. Notes that arrive through sync can look like edits, so "every note" may ask about them.',
            control: { type: 'dropdown', key: 'promptScope', options: { open: 'Open notes only', all: 'Every note' } },
          },
          { name: 'Ask about tag synonyms and unknown tags', control: { type: 'toggle', key: 'promptTags' } },
          { name: 'Ask about an invalid status', control: { type: 'toggle', key: 'promptStatus' } },
          { name: 'Ask when the type changes', control: { type: 'toggle', key: 'promptTypeChange' } },
          { name: 'Ask when the domain changes', desc: 'Offers to issue the unique ID again for the new domain. The old one is kept in archived_fields.', control: { type: 'toggle', key: 'promptDomainChange' } },
        ],
      },
      {
        type: 'group',
        heading: 'Note bodies',
        items: [
          {
            name: 'Allow Rubric to edit note bodies',
            desc: 'The kill switch for body access. Off: no body handler runs and no body is written; reading a body is always allowed. Nothing in Rubric edits bodies yet, and a type must also opt in with body: { enabled: true } in its schema file.',
            control: { type: 'toggle', key: 'allowBodyEdits' },
          },
          {
            name: 'Log body access',
            desc: 'Writes to the developer console which handler changed which note, and adds the command "Body access: show sections".',
            control: { type: 'toggle', key: 'debugBodyAccess' },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Schema presets and export',
        items: [
          {
            name: 'Save the schema as a preset',
            desc: 'Keeps a named copy of every file in the schema folder (not the generated previews, not your notes). Applying a preset later shows what will change and saves your current schema first.',
            action: () => void plugin.presets.save(),
          },
          {
            name: 'Export the schema as a zip',
            desc: 'Writes the schema folder to one zip file in the top folder of your vault, to share or keep.',
            action: () => void plugin.presets.exportZip(),
          },
        ],
      },
      {
        type: 'list',
        heading: 'Saved presets',
        emptyState: 'No presets saved yet.',
        items: presets.map((p) => ({
          name: p.name,
          desc: `${p.fileCount} files${p.created ? ` · saved ${formatLocal(new Date(p.created)).replace('T', ' ')}` : ''}. Select to apply.`,
          action: () => void plugin.presets.apply(p.slug),
        })),
        onDelete: (i) => {
          const p = presets[i];
          if (p) void plugin.presets.remove(p.slug);
        },
      },
      {
        type: 'group',
        heading: 'About retired IDs',
        items: [
          {
            name: 'What retiring does',
            desc: 'An ID is retired when a note is renumbered, so the old number is never handed out again. The next number is one more than the highest used or retired number of that type and year, so releasing an ID only frees its number when nothing higher is in use. Release one only if no note, link or outside record still refers to it.',
          },
          {
            name: 'Release all retired IDs',
            desc: retired.length === 0 ? 'None are retired.' : `Forgets all ${retired.length} retired IDs.`,
            visible: () => retired.length > 0,
            action: () => void this.releaseRetired(retired.map((r) => r.id)),
          },
        ],
      },
      {
        type: 'list',
        heading: 'Retired IDs',
        emptyState: 'No IDs are retired.',
        items: retired.map((r) => ({ name: r.id, desc: r.detail })),
        onDelete: (i) => {
          const r = retired[i];
          if (r) void this.releaseRetired([r.id]);
        },
      },
      {
        type: 'list',
        heading: 'Folder mapping',
        emptyState: 'No folders are mapped to a schema yet.',
        items: mappingGroups.map(([type, folders]) => ({
          name: `${folders.join(', ')} → ${type}`,
          desc: 'Select to edit.',
          action: () => void this.editMappingGroup(type, folders),
        })),
        onDelete: (i) => {
          const group = mappingGroups[i];
          if (group) void this.removeMappingGroup(group[1]);
        },
        addItem: { name: 'Add mapping', action: () => void this.editMappingGroup(null, []) },
      },
      {
        type: 'group',
        heading: 'Problems',
        items:
          problems.length === 0
            ? [{ name: 'None', desc: 'No schema errors, conflicts or bad YAML.' }]
            : [
                ...conflicts.map((c) => ({
                  name: `Folder “${c.folder}” has several owners`,
                  desc: `Claimed by ${c.types.join(', ')}. Select to choose the owner.`,
                  action: () => void this.resolveConflict(c.folder, c.types),
                })),
                ...problems
                  .filter((p) => p.code !== 'folder-conflict')
                  .map((p) => ({
                    name: `${p.severity === 'error' ? 'Error' : 'Warning'}: ${p.line ? `${p.file}:${p.line}` : p.file}`,
                    desc: p.message,
                  })),
              ],
      },
    ];
  }

  private async releaseRetired(ids: string[]): Promise<void> {
    const one = ids.length === 1;
    const ok = await confirm(
      this.app,
      one ? 'Release this ID?' : `Release ${ids.length} retired IDs?`,
      [
        one ? `${ids[0] ?? ''} will be forgotten, so its number can be issued again if nothing higher is in use.` : 'They will be forgotten, so their numbers can be issued again where nothing higher is in use.',
        'Do this only if no note, link or outside record still refers to them.',
      ],
      'Release',
    );
    if (ok) await this.plugin.releaseRetired(ids);
  }

  private async editMappingGroup(type: string | null, folders: string[]): Promise<void> {
    const { plugin } = this;
    const types = plugin.schemas.pack?.typeNames ?? [];
    if (types.length === 0) {
      new Notice('Load a schema pack first.');
      return;
    }
    const result = await editMapping(this.app, types, type ? { folders, type } : null);
    if (!result) return;
    const keep = new Set(result.folders.map(nameKey));
    for (const f of folders) if (!keep.has(nameKey(f))) await plugin.registry.removeMapping(f);
    for (const f of result.folders) await plugin.registry.setMapping(f, result.type);
  }

  private async removeMappingGroup(folders: string[]): Promise<void> {
    for (const f of folders) await this.plugin.registry.removeMapping(f);
  }

  private async resolveConflict(folder: string, types: string[]): Promise<void> {
    const choice = await askSchemaChoice(this.app, {
      title: `Which schema owns ${folder}/?`,
      lead: `More than one schema claims "${folder}". The others will be removed from the folder mapping.`,
      types,
      allowUnmanaged: false,
      applyText: 'Set owner',
    });
    if (choice?.type) await this.plugin.registry.setMapping(folder, choice.type);
  }
}
