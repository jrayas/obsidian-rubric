import { normalizePath } from 'obsidian';
import { PREVIEW_FOLDER, PREVIEW_MARKER, renderAllPreviews } from '../core/schema-preview';
import type RubricPlugin from '../main';

/**
 * Keeps `<schema folder>/preview/<type>.yaml` in step with the loaded schema. The files are generated and read-only
 * by convention; nothing ever reads them back. A file is written only when its text really changed, so this never
 * causes a reload loop, and the schema watcher ignores the preview folder anyway.
 */
export class PreviewWriter {
  private timer: number | null = null;
  private running = false;
  private again = false;

  constructor(private readonly plugin: RubricPlugin) {}

  /** Ask for a refresh soon (several schema changes in a row make one refresh). */
  schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, 600);
  }

  stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  async sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.write();
      } while (this.again);
    } catch (e) {
      console.debug('[rubric] could not write the property previews:', e);
    } finally {
      this.running = false;
    }
  }

  private async write(): Promise<void> {
    const { plugin } = this;
    const { schemas, settings } = plugin;
    const pack = schemas.pack;
    const st = schemas.status;
    // Only from a schema that loaded cleanly now: never describe a stale copy as if it were current.
    if (!settings.writePreviews || !pack || st.usingLastGood || st.problems.some((p) => p.severity === 'error') || !st.detection.exists) return;
    const adapter = plugin.app.vault.adapter;
    const dir = normalizePath(`${schemas.folder}/${PREVIEW_FOLDER}`);
    const files = renderAllPreviews(pack);
    const ensureDir = async (d: string): Promise<void> => {
      if (!(await adapter.exists(d))) await adapter.mkdir(d);
    };
    await ensureDir(dir);
    for (const [name, text] of files) {
      const path = normalizePath(`${dir}/${name}`);
      const parent = path.split('/').slice(0, -1).join('/');
      if (parent !== dir) await ensureDir(parent);
      const current = (await adapter.exists(path)) ? await adapter.read(path) : null;
      if (current !== text) await adapter.write(path, text);
    }
    await this.removeStale(dir, dir, files);
  }

  /** A type or domain that no longer exists: remove only files this plugin generated, and folders left empty. */
  private async removeStale(root: string, dir: string, files: Map<string, string>): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    const listed = await adapter.list(dir);
    for (const f of listed.files) {
      const rel = f.slice(root.length + 1);
      if (files.has(rel) || !rel.endsWith('.yaml')) continue;
      const text = await adapter.read(f);
      if (text.startsWith(PREVIEW_MARKER)) await adapter.remove(f);
    }
    for (const sub of listed.folders) {
      await this.removeStale(root, sub, files);
      const left = await adapter.list(sub);
      if (left.files.length === 0 && left.folders.length === 0) await adapter.rmdir(sub, false);
    }
  }
}
