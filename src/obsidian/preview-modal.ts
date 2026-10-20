import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';

export interface PreviewSection {
  heading: string;
  lines: string[];
}

export interface PreviewOptions {
  title: string;
  lead?: string;
  sections: PreviewSection[];
  confirmText?: string;
  cancelText?: string;
}

/** Shows exactly what will change and waits for approval. Resolves true on confirm. */
export class PreviewModal extends Modal {
  private result = false;
  private readonly done: (ok: boolean) => void;
  readonly promise: Promise<boolean>;

  constructor(app: App, private readonly opts: PreviewOptions) {
    super(app);
    let resolve: (ok: boolean) => void = () => undefined;
    this.promise = new Promise<boolean>((r) => (resolve = r));
    this.done = resolve;
  }

  onOpen(): void {
    const { contentEl, opts } = this;
    this.setTitle(opts.title);
    if (opts.lead) contentEl.createEl('p', { text: opts.lead });
    for (const section of opts.sections) {
      if (section.lines.length === 0) continue;
      contentEl.createEl('p', { cls: 'vschema-preview-heading', text: section.heading });
      const pre = contentEl.createEl('pre', { cls: 'vschema-preview' });
      pre.setText(section.lines.join('\n'));
    }
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(opts.confirmText ?? 'Apply').setCta().onClick(() => {
          this.result = true;
          this.close();
        }),
      )
      .addButton((b) => b.setButtonText(opts.cancelText ?? 'Not now').onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    this.done(this.result);
  }
}

export function preview(app: App, opts: PreviewOptions): Promise<boolean> {
  const m = new PreviewModal(app, opts);
  m.open();
  return m.promise;
}

/** Pick one of a list of values (for example an allowed status). Resolves to the value, or null. */
export class ValueChoiceModal extends Modal {
  private result: string | null = null;
  private readonly done: (v: string | null) => void;
  readonly promise: Promise<string | null>;

  constructor(app: App, private readonly title: string, private readonly lead: string, private readonly values: string[]) {
    super(app);
    let resolve: (v: string | null) => void = () => undefined;
    this.promise = new Promise<string | null>((r) => (resolve = r));
    this.done = resolve;
  }

  onOpen(): void {
    this.setTitle(this.title);
    this.contentEl.createEl('p', { text: this.lead });
    const row = new Setting(this.contentEl);
    for (const v of this.values) {
      row.addButton((b) =>
        b.setButtonText(v).onClick(() => {
          this.result = v;
          this.close();
        }),
      );
    }
    new Setting(this.contentEl).addButton((b) => b.setButtonText('Not now').onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    this.done(this.result);
  }
}

export function chooseValue(app: App, title: string, lead: string, values: string[]): Promise<string | null> {
  const m = new ValueChoiceModal(app, title, lead, values);
  m.open();
  return m.promise;
}
