import { Notice } from 'obsidian';
import { applyFixToText, runVaultCheck } from '../core/note-check';
import type { Finding, Fix, NoteInput, VaultReport } from '../core/note-check';
import type RubricPlugin from '../main';

export interface Progress {
  done: number;
  total: number;
}

const yieldToUi = () => new Promise<void>((r) => window.setTimeout(r, 0));

/** Runs the vault check and applies approved fixes. The scan changes nothing. */
export class VaultCheckService {
  constructor(private readonly plugin: RubricPlugin) {}

  /** Scan every managed note and run the eleven checks. Reads files; writes nothing. */
  async run(onProgress?: (p: Progress) => void): Promise<VaultReport> {
    const { plugin } = this;
    const pack = plugin.schemas.pack;
    if (!pack) throw new Error('No schemas are loaded.');
    const files = plugin.app.vault.getMarkdownFiles();
    const notes: NoteInput[] = [];
    for (const [i, f] of files.entries()) {
      const ctx = plugin.notes.context(f);
      if (ctx.verdict.managed && ctx.type) {
        notes.push({ path: f.path, basename: f.basename, text: await plugin.app.vault.read(f), ctime: f.stat.ctime, type: ctx.type });
      }
      if (i % 25 === 24) {
        onProgress?.({ done: i + 1, total: files.length });
        await yieldToUi();
      }
    }
    onProgress?.({ done: files.length, total: files.length });
    const folders = plugin.app.vault
      .getAllFolders(false)
      .map((f) => f.path)
      .filter((p) => !p.split('/')[0]?.startsWith('.') && p.split('/')[0]?.toLowerCase() !== plugin.schemas.folder.toLowerCase());
    const settings = plugin.settings;
    const report = runVaultCheck(
      { pack, now: new Date(), usedIds: plugin.ids.usedIds(), retiredIds: settings.retiredIds, known: settings.index },
      notes,
      { folderPaths: folders, schemaProblems: plugin.schemas.status.problems },
    );
    // first sight of notes the index has not seen yet
    plugin.known.scan();
    return report;
  }

  /** Apply one approved fix. Returns an error message, or null when it was written. */
  async apply(finding: Finding, fix: Fix): Promise<string | null> {
    const { plugin } = this;
    if (fix.kind === 'vocabulary' && fix.vocabulary) {
      await plugin.vocabulary.addTerm(fix.vocabulary.name, fix.vocabulary.term, fix.vocabulary.domain);
      return null;
    }
    if (fix.kind === 'index' && fix.accept) {
      plugin.known.accept(finding.path, fix.accept);
      return null;
    }
    const file = plugin.app.vault.getFileByPath(finding.path);
    if (!file) return 'The note no longer exists.';
    if (fix.kind === 'text' && fix.transform) {
      const out = await plugin.queue.textExact(file, finding.baseText, fix.transform);
      return out.error ?? null;
    }
    if (fix.kind === 'frontmatter' && fix.mutate) {
      const out = await plugin.queue.editExact(file, finding.baseText, { mutate: fix.mutate, forceOrder: fix.forceOrder === true });
      if (out.error) return out.error;
      if (fix.retire?.length) {
        plugin.settings.retiredIds.push(...fix.retire.filter((id) => !plugin.settings.retiredIds.includes(id)));
        await plugin.saveSettings();
      }
      return null;
    }
    return 'Nothing to apply.';
  }

  /** What the fix would write, exactly (used by tests and the preview). */
  preview(finding: Finding, fix: Fix, type: NoteInput['type']): string {
    return applyFixToText(finding.baseText, type, fix);
  }

  /** Apply many fixes one after another with progress, yielding so the app stays responsive. */
  async applyAll(items: { finding: Finding; fix: Fix }[], onProgress: (p: Progress, failed: number) => void): Promise<{ applied: number; failed: string[] }> {
    const failed: string[] = [];
    let applied = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as { finding: Finding; fix: Fix };
      const err = await this.apply(it.finding, it.fix);
      if (err) failed.push(`${it.finding.basename}: ${err}`);
      else applied++;
      onProgress({ done: i + 1, total: items.length }, failed.length);
      if (i % 5 === 4) await yieldToUi();
    }
    if (failed.length > 0) new Notice(`${failed.length} of ${items.length} changes were skipped (the notes changed since the check).`);
    return { applied, failed };
  }
}
