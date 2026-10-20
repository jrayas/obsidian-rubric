import { Modal, Notice, Setting } from 'obsidian';
import type { Finding, Fix, GlobalFinding, VaultReport } from '../core/note-check';
import type VaultSchemaPlugin from '../main';
import { confirm } from './modals';
import { VaultCheckService } from './vault-check';

/** The report window: one list, every fix behind a button, nothing written until a button is pressed. */
export class VaultCheckModal extends Modal {
  private report: VaultReport | null = null;
  private readonly service: VaultCheckService;
  private busy = false;
  private summaryEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private progressEl!: HTMLElement;

  constructor(private readonly plugin: VaultSchemaPlugin) {
    super(plugin.app);
    this.service = new VaultCheckService(plugin);
  }

  onOpen(): void {
    this.setTitle('Vault check');
    this.modalEl.addClass('mod-vschema-check');
    const { contentEl } = this;
    this.summaryEl = contentEl.createDiv({ cls: 'vschema-check-summary', attr: { role: 'status' } });
    this.progressEl = contentEl.createDiv({ cls: 'vschema-progress' });
    new Setting(contentEl).addButton((b) => b.setButtonText('Run again').onClick(() => void this.run()));
    this.bodyEl = contentEl.createDiv({ cls: 'vschema-check-body' });
    void this.run();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.bodyEl.empty();
    this.summaryEl.setText('Scanning…');
    try {
      this.report = await this.service.run((p) => this.summaryEl.setText(`Scanning… ${p.done} of ${p.total} notes`));
      this.render();
    } catch (e) {
      this.summaryEl.setText(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  private setProgress(text: string): void {
    this.progressEl.setText(text);
  }

  private needing(): number {
    return new Set(this.report?.findings.map((f) => f.path)).size;
  }

  private render(): void {
    const r = this.report;
    if (!r) return;
    this.bodyEl.empty();
    const need = this.needing();
    const globals = r.globalFindings.length;
    this.summaryEl.setText(
      `${r.scanned} notes scanned · ${need === 0 ? 'none need you' : `${need} need you`}${globals > 0 ? ` · ${globals} schema or folder ${globals === 1 ? 'issue' : 'issues'}` : ''}`,
    );

    if (globals > 0) {
      const sec = this.bodyEl.createDiv({ cls: 'vschema-section' });
      sec.createEl('h4', { text: 'Schema and folders' });
      for (const g of r.globalFindings) this.renderGlobal(sec, g);
    }

    this.renderMigrationBatches();

    const byPath = new Map<string, Finding[]>();
    for (const f of r.findings) byPath.set(f.path, [...(byPath.get(f.path) ?? []), f]);
    for (const [path, list] of byPath) {
      const sec = this.bodyEl.createDiv({ cls: 'vschema-section' });
      const title = sec.createEl('h4');
      const link = title.createEl('a', { text: list[0]?.basename ?? path, cls: 'vschema-note-link', attr: { href: '#' } });
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const file = this.plugin.app.vault.getFileByPath(path);
        if (file) void this.plugin.app.workspace.getLeaf(false).openFile(file);
      });
      for (const f of list) this.renderFinding(sec, f);
    }
    if (r.findings.length === 0 && globals === 0) this.bodyEl.createEl('p', { text: 'Nothing to fix.', cls: 'vschema-empty' });
  }

  private renderGlobal(parent: HTMLElement, g: GlobalFinding): void {
    const row = parent.createDiv({ cls: 'vschema-finding' });
    row.createSpan({ cls: `vschema-sev is-${g.severity}`, text: g.severity === 'problem' ? 'Problem' : 'Warning' });
    const where = g.file ? ` (${g.line ? `${g.file}:${g.line}` : g.file})` : '';
    row.createSpan({ cls: 'vschema-finding-msg', text: ` ${g.message}${where}` });
  }

  private renderFinding(parent: HTMLElement, f: Finding): void {
    const row = parent.createDiv({ cls: 'vschema-finding', attr: { 'data-code': f.code } });
    row.createSpan({ cls: `vschema-sev is-${f.severity}`, text: f.severity === 'problem' ? 'Problem' : 'Warning' });
    row.createSpan({ cls: 'vschema-finding-msg', text: ` ${f.message}` });
    const only = f.fixes.length === 1 ? f.fixes[0] : undefined;
    if (only && only.diff.length > 1) row.createEl('pre', { cls: 'vschema-preview', text: only.diff.join('\n') });
    if (f.fixes.length > 0) {
      const buttons = row.createDiv({ cls: 'vschema-fixes' });
      for (const fix of f.fixes) {
        const btn = buttons.createEl('button', { text: fix.label, cls: 'vschema-fix', attr: { title: fix.diff.join('\n') } });
        btn.addEventListener('click', () => void this.applyOne(f, fix, row, btn));
      }
    }
  }

  private async applyOne(f: Finding, fix: Fix, row: HTMLElement, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    const err = await this.service.apply(f, fix);
    if (err) {
      row.createDiv({ cls: 'vschema-error', text: err, attr: { role: 'alert' } });
      return;
    }
    if (this.report) this.report.findings = this.report.findings.filter((x) => x !== f);
    this.render();
  }

  /** "Migrate all N notes of a type": one approval, progress, every note written from its own previewed diff. */
  private renderMigrationBatches(): void {
    const r = this.report;
    if (!r) return;
    const groups = new Map<string, Finding[]>();
    for (const f of r.findings) {
      if (f.code !== 'old-schema') continue;
      const type = this.plugin.notes.context(this.plugin.app.vault.getFileByPath(f.path) ?? ({ path: f.path } as never)).type?.name;
      if (type) groups.set(type, [...(groups.get(type) ?? []), f]);
    }
    for (const [type, list] of groups) {
      if (list.length < 2) continue;
      new Setting(this.bodyEl)
        .setName(`Migrate all ${type} notes (${list.length})`)
        .setDesc('Applies each note’s previewed change below. Nothing else is touched.')
        .addButton((b) =>
          b.setButtonText('Apply to all').onClick(async () => {
            const ok = await confirm(this.plugin.app, `Migrate ${list.length} ${type} notes?`, [
              `Each note gets the schema 1 → 2 migration shown under its name in this report.`,
              'Anything a flat property cannot hold is kept in archived_fields.',
            ], 'Migrate');
            if (ok) await this.migrateBatch(list);
          }),
        );
    }
  }

  private async migrateBatch(list: Finding[]): Promise<void> {
    const items = list.flatMap((finding) => {
      const fix = finding.fixes[0];
      return fix ? [{ finding, fix }] : [];
    });
    const result = await this.service.applyAll(items, (p, failed) =>
      this.setProgress(`Migrating ${p.done} of ${p.total}…${failed > 0 ? ` (${failed} skipped)` : ''}`),
    );
    const done = new Set(items.filter((_, i) => i < items.length).map((x) => x.finding));
    if (this.report) this.report.findings = this.report.findings.filter((x) => !done.has(x) || result.failed.some((m) => m.startsWith(x.basename + ':')));
    this.setProgress(`Migrated ${result.applied} of ${items.length}.`);
    new Notice(`Migrated ${result.applied} of ${items.length} notes.`);
    this.render();
  }
}

export function openVaultCheck(plugin: VaultSchemaPlugin): void {
  if (!plugin.schemas.pack) {
    new Notice('No schemas are loaded yet.');
    return;
  }
  new VaultCheckModal(plugin).open();
}
