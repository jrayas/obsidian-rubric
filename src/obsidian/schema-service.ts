import { Notice, normalizePath } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import { detectSchemaFolder, isInSchemaFolder } from '../core/folder-detect';
import type { FolderDetection } from '../core/folder-detect';
import { loadSchemaPack } from '../core/schema-loader';
import type { Problem, SchemaPack } from '../core/schema-types';
import type { RubricSettings } from '../settings';
import { PREVIEW_FOLDER } from '../core/schema-preview';
import { RubricSource, folderSignature, listRootFolders } from './vault-source';

export interface SchemaStatus {
  detection: FolderDetection;
  /** Problems from the most recent load attempt. */
  problems: Problem[];
  /** True when the current pack is an older good copy because the latest load failed. */
  usingLastGood: boolean;
  loadedAt: number | null;
}

const POLL_MS = 2500;
const DEBOUNCE_MS = 400;

/**
 * Owns the loaded schema pack. Keeps the last good copy when a reload fails, reloads on change
 * (vault events for a visible folder, polling for a hidden one) and on demand.
 */
export class SchemaService {
  pack: SchemaPack | null = null;
  status: SchemaStatus = {
    detection: { folder: '_schema', exists: false, hidden: false, warnings: [] },
    problems: [],
    usingLastGood: false,
    loadedAt: null,
  };

  private readonly listeners = new Set<() => void>();
  private timer: number | null = null;
  private lastSignature = '';
  private lastNoticeKey = '';
  private reloading: Promise<void> | null = null;
  private pending = false;

  constructor(
    private readonly app: App,
    private readonly plugin: Plugin,
    private readonly getSettings: () => RubricSettings,
  ) {}

  /** Subscribe to pack/status changes. Returns an unsubscribe function. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get folder(): string {
    return this.status.detection.folder;
  }

  /** Start watching. Call from onLayoutReady. */
  async start(): Promise<void> {
    await this.reload('startup');
    const { vault } = this.app;
    const maybe = (path: string) => {
      if (!this.status.detection.hidden && isInSchemaFolder(path, this.folder) && !this.isPreviewPath(path)) this.schedule();
    };
    this.plugin.registerEvent(vault.on('create', (f) => maybe(f.path)));
    this.plugin.registerEvent(vault.on('modify', (f) => maybe(f.path)));
    this.plugin.registerEvent(vault.on('delete', (f) => maybe(f.path)));
    this.plugin.registerEvent(vault.on('rename', (f, old) => {
      maybe(f.path);
      maybe(old);
    }));
    // A hidden folder fires no vault events, so poll it.
    this.plugin.registerInterval(window.setInterval(() => void this.poll(), POLL_MS));
  }

  /** The generated preview files never trigger a reload. */
  private isPreviewPath(path: string): boolean {
    return normalizePath(path).toLowerCase().startsWith(normalizePath(`${this.folder}/${PREVIEW_FOLDER}/`).toLowerCase());
  }

  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.reload('change');
    }, DEBOUNCE_MS);
  }

  private async poll(): Promise<void> {
    if (!this.status.detection.hidden || !this.status.detection.exists) return;
    const sig = await folderSignature(this.app, this.folder, PREVIEW_FOLDER);
    if (sig !== this.lastSignature) {
      this.lastSignature = sig;
      await this.reload('change');
    }
  }

  /** Reload now. Concurrent calls are merged so the latest files are always read last. */
  reload(reason: 'startup' | 'change' | 'manual'): Promise<void> {
    if (this.reloading) {
      this.pending = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      try {
        do {
          this.pending = false;
          await this.doReload(reason);
        } while (this.pending);
      } finally {
        this.reloading = null;
      }
    })();
    return this.reloading;
  }

  private async doReload(reason: 'startup' | 'change' | 'manual'): Promise<void> {
    const settings = this.getSettings();
    const detection = detectSchemaFolder(settings.schemaFolder, await listRootFolders(this.app));
    const problems: Problem[] = detection.warnings.map((message) => ({
      severity: 'warning' as const,
      code: 'folder-ambiguous',
      file: detection.folder,
      message,
    }));

    if (!detection.exists) {
      problems.push({
        severity: 'error',
        code: 'folder-missing',
        file: detection.folder,
        message: `Schema folder "${detection.folder}" was not found. Create it and copy the schema files into it; they load as soon as they appear.`,
      });
      this.publish(detection, problems, this.pack !== null, reason);
      return;
    }

    const source = new RubricSource(this.app, detection.folder);
    const result = await loadSchemaPack(source, { pluginVersion: this.plugin.manifest.version });
    problems.push(...result.problems);
    if (result.pack) {
      this.pack = result.pack;
      this.publish(detection, problems, false, reason);
    } else {
      this.publish(detection, problems, this.pack !== null, reason);
    }
    if (detection.hidden) this.lastSignature = await folderSignature(this.app, detection.folder, PREVIEW_FOLDER);
  }

  private publish(detection: FolderDetection, problems: Problem[], usingLastGood: boolean, reason: string): void {
    this.status = { detection, problems, usingLastGood, loadedAt: Date.now() };
    const errors = problems.filter((p) => p.severity === 'error');
    const key = JSON.stringify(errors.map((p) => [p.file, p.line, p.message]));
    if (errors.length > 0 && key !== this.lastNoticeKey) {
      const first = errors[0];
      if (first) {
        const where = first.line ? `${first.file}:${first.line}` : first.file;
        const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : '';
        const keep = usingLastGood ? ' Still using the last good copy.' : '';
        new Notice(`Schema problem in ${where}: ${first.message}${more}.${keep}`, 10000);
      }
    } else if (errors.length === 0 && this.lastNoticeKey !== '' && this.lastNoticeKey !== '[]') {
      new Notice('Schemas reloaded.');
    } else if (reason === 'manual' && errors.length === 0) {
      new Notice('Schemas reloaded.');
    }
    this.lastNoticeKey = key;
    for (const fn of this.listeners) fn();
  }

  /** Full vault path of a file inside the schema folder. */
  path(rel: string): string {
    return normalizePath(`${this.folder}/${rel}`);
  }
}
