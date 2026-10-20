import { Notice, Plugin, normalizePath } from 'obsidian';
import { STARTER_PACK } from './pack';
import { SchemaService } from './obsidian/schema-service';
import { confirm } from './obsidian/modals';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';
import type { VaultSchemaSettings } from './settings';

export default class VaultSchemaPlugin extends Plugin {
  settings: VaultSchemaSettings = { ...DEFAULT_SETTINGS };
  schemas!: SchemaService;

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.schemas = new SchemaService(this.app, this, () => this.settings);

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

    this.app.workspace.onLayoutReady(() => {
      void this.schemas.start();
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Show the schema folder in the system file manager (Finder or Explorer). */
  private openSchemaFolder(): void {
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
  private async installStarterPack(): Promise<void> {
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
