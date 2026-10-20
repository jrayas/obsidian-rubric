import { TFile } from 'obsidian';
import { readFrontmatter } from '../core/frontmatter';
import type { Frontmatter } from '../core/frontmatter';
import { baseName, breadcrumbFromPath, nameAfterRename } from '../core/name-sync';
import type VaultSchemaPlugin from '../main';

const SETTLE_MS = 400;

/**
 * Two opt-in follow-ups after a note is renamed or moved (both silent, both only touch one property):
 *  - `name` follows the file name, but only if it was empty or the plugin filled it;
 *  - `breadcrumb` follows the real folder, for people who do not use a breadcrumb plugin.
 * Neither renames or moves a file.
 */
export class AutoSync {
  constructor(private readonly plugin: VaultSchemaPlugin) {}

  start(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on('rename', (f, oldPath) => {
        if (!(f instanceof TFile) || f.extension !== 'md') return;
        window.setTimeout(() => void this.afterRename(f, oldPath), SETTLE_MS);
      }),
    );
  }

  private async read(file: TFile): Promise<Frontmatter | undefined> {
    try {
      return readFrontmatter(await this.plugin.app.vault.read(file)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async afterRename(file: TFile, oldPath: string): Promise<void> {
    const { plugin } = this;
    if (!this.plugin.app.vault.getFileByPath(file.path)) return;
    const fm = await this.read(file);
    const ctx = plugin.notes.context(file, fm ?? {});
    if (!ctx.verdict.managed || !ctx.type || !fm) return;
    const settings = plugin.settings;
    const changes: Record<string, unknown> = {};

    if (settings.syncName) {
      const next = nameAfterRename(fm, baseName(oldPath), file.basename);
      if (next !== null) changes.name = next;
    }
    if (settings.breadcrumbFromFolder && ctx.type.byName.has('breadcrumb')) {
      const crumb = breadcrumbFromPath(file.path);
      if (crumb !== null && fm.breadcrumb !== crumb) changes.breadcrumb = crumb;
    }
    if (Object.keys(changes).length === 0) return;
    // Changing an existing value must not reorder the note; adding a missing key puts it where the schema wants it.
    const addsKey = Object.keys(changes).some((k) => !(k in fm));
    await plugin.queue.edit(file, {
      keepOrder: !addsKey,
      mutate: (d) => {
        for (const [k, v] of Object.entries(changes)) d[k] = v;
      },
    });
  }

  /** After the plugin fills a new note: give it its breadcrumb too, if that setting is on. */
  async afterFill(file: TFile): Promise<void> {
    const { plugin } = this;
    if (!plugin.settings.breadcrumbFromFolder) return;
    const fm = await this.read(file);
    const type = plugin.notes.context(file, fm ?? {}).type;
    const crumb = breadcrumbFromPath(file.path);
    if (!fm || !type?.byName.has('breadcrumb') || crumb === null || fm.breadcrumb === crumb) return;
    await plugin.queue.edit(file, { keepOrder: 'breadcrumb' in fm, mutate: (d) => void (d.breadcrumb = crumb) });
  }
}
