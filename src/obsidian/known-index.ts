import { TFile } from 'obsidian';
import type RubricPlugin from '../main';

/**
 * The small local index of known IDs and first-seen creation times (check 9). A note's `id` and `created` are
 * locked but nothing stops another tool changing them; comparing with what was first seen finds that.
 * The index follows this plugin's own changes and renames, and is saved with the settings.
 */
export class KnownIndex {
  private saveTimer: number | null = null;

  constructor(private readonly plugin: RubricPlugin) {}

  private get entries() {
    return this.plugin.settings.index;
  }

  start(): void {
    const { vault, metadataCache } = this.plugin.app;
    this.plugin.registerEvent(vault.on('rename', (f, old) => {
      const e = this.entries[old];
      if (e) {
        delete this.entries[old];
        this.entries[f.path] = e;
        this.dirty();
      }
    }));
    this.plugin.registerEvent(vault.on('delete', (f) => {
      if (this.entries[f.path]) {
        delete this.entries[f.path];
        this.dirty();
      }
    }));
    // a note with no entry yet: first sight
    this.plugin.registerEvent(metadataCache.on('changed', (f) => this.observe(f)));
    this.plugin.queue.onIdentityWritten = (path, id, created) => this.record(path, id, created);
    window.setTimeout(() => this.scan(), 3000);
  }

  stop(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    void this.plugin.saveSettings();
  }

  /** Record what is first seen for every managed note that has no entry. Reads the metadata cache only. */
  scan(): void {
    for (const f of this.plugin.app.vault.getMarkdownFiles()) this.observe(f);
  }

  private observe(file: TFile): void {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.entries[file.path]) return;
    const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    const id = typeof fm?.id === 'string' ? fm.id : undefined;
    const created = typeof fm?.created === 'string' ? fm.created : undefined;
    if (id === undefined && created === undefined) return;
    if (!this.plugin.notes.context(file).type) return;
    this.entries[file.path] = { ...(id !== undefined ? { id } : {}), ...(created !== undefined ? { created } : {}) };
    this.dirty();
  }

  /** The plugin itself wrote an ID or a created time: that is the new known value. */
  record(path: string, id: string | undefined, created: string | undefined): void {
    const e = this.entries[path] ?? {};
    if (id !== undefined) e.id = id;
    if (created !== undefined) e.created = created;
    this.entries[path] = e;
    this.dirty();
  }

  /** Accept a changed value as the new known one. */
  accept(path: string, v: { id?: string; created?: string }): void {
    this.record(path, v.id, v.created);
  }

  private dirty(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.plugin.saveSettings();
    }, 5000);
  }
}
