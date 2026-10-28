import { FuzzySuggestModal, Notice, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { describeDiff, diffFiles, isBundlePath, isNoChange, makePreset, parsePreset, presetSlug, serialisePreset } from '../core/schema-bundle';
import { formatLocal } from '../core/timestamps';
import { makeZip } from '../core/zip';
import type RubricPlugin from '../main';
import { confirm, promptText } from './modals';
import { preview } from './preview-modal';

export interface PresetInfo {
  slug: string;
  name: string;
  /** ISO time it was saved. */
  created: string;
  fileCount: number;
}

const BACKUP_PREFIX = 'Before applying';

/**
 * Presets (named copies of the whole schema folder) and the zip export. Presets live in the plugin's own folder, one
 * JSON file each, so the schema loader never sees them. The generated `preview/` folder is never part of either.
 * Applying a preset first saves the current schema as a backup preset, and shows exactly what will change.
 */
export class SchemaPresets {
  items: PresetInfo[] = [];

  constructor(private readonly plugin: RubricPlugin) {}

  private get app(): App {
    return this.plugin.app;
  }

  private get dir(): string {
    const base = this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
    return normalizePath(`${base}/presets`);
  }

  private fileOf(slug: string): string {
    return normalizePath(`${this.dir}/${slug}.json`);
  }

  /** Every schema file as schema-folder-relative path -> text. */
  async readSchemaFolder(): Promise<Map<string, string>> {
    const adapter = this.app.vault.adapter;
    const root = normalizePath(this.plugin.schemas.folder);
    const out = new Map<string, string>();
    if (!(await adapter.exists(root))) return out;
    const walk = async (dir: string): Promise<void> => {
      const listed = await adapter.list(dir);
      for (const f of listed.files) {
        const rel = f.slice(root.length + 1);
        if (isBundlePath(rel)) out.set(rel, await adapter.read(f));
      }
      for (const d of listed.folders) {
        const rel = d.slice(root.length + 1);
        if (rel === 'preview') continue;
        await walk(d);
      }
    };
    await walk(root);
    return out;
  }

  async refresh(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const items: PresetInfo[] = [];
    if (await adapter.exists(this.dir)) {
      for (const f of (await adapter.list(this.dir)).files) {
        if (!f.endsWith('.json')) continue;
        const parsed = parsePreset(await adapter.read(f));
        if (parsed.ok) {
          items.push({ slug: f.split('/').pop()?.replace(/\.json$/, '') ?? '', name: parsed.preset.name, created: parsed.preset.created, fileCount: Object.keys(parsed.preset.files).length });
        }
      }
    }
    this.items = items.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async write(name: string, files: Map<string, string>): Promise<string> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
    const slug = presetSlug(name);
    await adapter.write(this.fileOf(slug), serialisePreset(makePreset(name, files, new Date(), this.plugin.manifest.version)));
    return slug;
  }

  /** Save the schema folder as a preset. Asks for a name unless one is given; asks before replacing a preset of the same name. */
  async save(given?: string): Promise<string | null> {
    const files = await this.readSchemaFolder();
    if (files.size === 0) {
      new Notice(`There are no schema files in "${this.plugin.schemas.folder}" to save.`);
      return null;
    }
    const name = given ?? (await promptText(this.app, 'Save schema as a preset', `Saves the ${files.size} schema files in "${this.plugin.schemas.folder}" under a name. Notes are not part of it.`, 'Preset name'));
    if (!name) return null;
    await this.refresh();
    const clash = this.items.find((p) => p.slug === presetSlug(name));
    if (clash && !(await confirm(this.app, 'Replace this preset?', [`A preset called “${clash.name}” already exists. Saving replaces it with the schema as it is now.`], 'Replace'))) return null;
    const slug = await this.write(name, files);
    await this.refresh();
    this.plugin.refreshSettings();
    new Notice(`Saved the schema as the preset “${name.trim()}” (${files.size} files).`);
    return slug;
  }

  /** Put a preset's files in the schema folder, after a preview and after saving the current schema as a backup preset. */
  async apply(slug: string): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    const file = this.fileOf(slug);
    if (!(await adapter.exists(file))) {
      new Notice('That preset no longer exists.');
      return false;
    }
    const parsed = parsePreset(await adapter.read(file));
    if (!parsed.ok) {
      new Notice(parsed.error);
      return false;
    }
    const target = new Map(Object.entries(parsed.preset.files));
    const current = await this.readSchemaFolder();
    const diff = diffFiles(current, target);
    if (isNoChange(diff)) {
      new Notice(`The schema is already the same as the preset “${parsed.preset.name}”.`);
      return false;
    }
    const ok = await preview(this.app, {
      title: `Apply the preset “${parsed.preset.name}”`,
      lead: `This makes "${this.plugin.schemas.folder}" match the preset: files are added, replaced and removed as listed. Your current schema is saved first as a preset called “${BACKUP_PREFIX} …”, so you can go back. Notes are not touched.`,
      sections: describeDiff(diff, current, target),
      confirmText: 'Apply preset',
      cancelText: 'Cancel',
    });
    if (!ok) return false;

    // What is written is what was shown: if the schema changed while the window was open, do nothing.
    const again = await this.readSchemaFolder();
    if (JSON.stringify([...again].sort()) !== JSON.stringify([...current].sort())) {
      new Notice('The schema files changed while the preview was open. Nothing was applied; try again.');
      return false;
    }
    const stamp = formatLocal(new Date()).replace('T', ' ');
    const backupName = `${BACKUP_PREFIX} “${parsed.preset.name}” ${stamp}`;
    try {
      if (current.size > 0) await this.write(backupName, current);
      const root = normalizePath(this.plugin.schemas.folder);
      if (!(await adapter.exists(root))) await adapter.mkdir(root);
      for (const rel of [...diff.added, ...diff.changed]) {
        let cur = root;
        for (const part of rel.split('/').slice(0, -1)) {
          cur = `${cur}/${part}`;
          if (!(await adapter.exists(cur))) await adapter.mkdir(cur);
        }
        await adapter.write(normalizePath(`${root}/${rel}`), target.get(rel) ?? '');
      }
      for (const rel of diff.removed) await adapter.remove(normalizePath(`${root}/${rel}`));
    } catch (e) {
      new Notice(`Applying the preset stopped part way: ${e instanceof Error ? e.message : String(e)}. Apply the preset “${backupName}” to go back.`, 15000);
      await this.refresh();
      this.plugin.refreshSettings();
      return false;
    }
    await this.plugin.schemas.reload('manual');
    await this.refresh();
    this.plugin.refreshSettings();
    new Notice(`Applied the preset “${parsed.preset.name}”. The previous schema is saved as “${backupName}”.`, 10000);
    return true;
  }

  async remove(slug: string): Promise<void> {
    const info = this.items.find((p) => p.slug === slug);
    if (!(await confirm(this.app, 'Delete this preset?', [`The preset “${info?.name ?? slug}” is deleted. The schema folder is not changed.`], 'Delete'))) return;
    const adapter = this.app.vault.adapter;
    if (await adapter.exists(this.fileOf(slug))) await adapter.remove(this.fileOf(slug));
    await this.refresh();
    this.plugin.refreshSettings();
  }

  /** Pick a preset by name. */
  async pick(): Promise<PresetInfo | null> {
    await this.refresh();
    if (this.items.length === 0) {
      new Notice('There are no saved presets yet. Save the schema as a preset first.');
      return null;
    }
    return new Promise((resolve) => {
      let chosen: PresetInfo | null = null;
      const items = this.items;
      const modal = new (class extends FuzzySuggestModal<PresetInfo> {
        getItems(): PresetInfo[] {
          return items;
        }
        getItemText(p: PresetInfo): string {
          return p.name;
        }
        onChooseItem(p: PresetInfo): void {
          chosen = p;
        }
        onClose(): void {
          super.onClose();
          // onChooseItem runs after onClose, so wait a moment before answering.
          window.setTimeout(() => resolve(chosen), 0);
        }
      })(this.app);
      modal.setPlaceholder('Choose a preset');
      modal.open();
    });
  }

  /** Write every schema file into one zip in the vault's top folder. Returns its path, or null when there is nothing to export. */
  async exportZip(): Promise<string | null> {
    const files = await this.readSchemaFolder();
    if (files.size === 0) {
      new Notice(`There are no schema files in "${this.plugin.schemas.folder}" to export.`);
      return null;
    }
    const folder = this.plugin.schemas.folder;
    const enc = new TextEncoder();
    const zip = makeZip(
      [...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([rel, text]) => ({ path: `${folder}/${rel}`, data: enc.encode(text) })),
      new Date(),
    );
    const adapter = this.app.vault.adapter;
    const stamp = formatLocal(new Date()).replace('T', ' ').replace(':', '');
    let path = normalizePath(`Rubric schema ${stamp}.zip`);
    for (let n = 2; await adapter.exists(path); n++) path = normalizePath(`Rubric schema ${stamp} (${n}).zip`);
    await adapter.writeBinary(path, zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer);
    new Notice(`Exported ${files.size} schema files to “${path}”.`, 10000);
    return path;
  }
}
