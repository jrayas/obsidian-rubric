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
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    for (const [name, text] of files) {
      const path = normalizePath(`${dir}/${name}`);
      const current = (await adapter.exists(path)) ? await adapter.read(path) : null;
      if (current !== text) await adapter.write(path, text);
    }
    // A type that no longer exists: remove only files this plugin generated.
    const listed = await adapter.list(dir);
    for (const f of listed.files) {
      const name = f.split('/').pop() ?? '';
      if (files.has(name) || !name.endsWith('.yaml')) continue;
      const text = await adapter.read(f);
      if (text.startsWith(PREVIEW_MARKER)) await adapter.remove(f);
    }
  }
}
