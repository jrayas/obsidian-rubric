import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';

/** A plain yes/no dialog. Resolves true when confirmed. */
export class ConfirmModal extends Modal {
  private result = false;
  private readonly done: (ok: boolean) => void;
  readonly promise: Promise<boolean>;

  constructor(
    app: App,
    private readonly title: string,
    private readonly lines: string[],
    private readonly confirmText = 'Apply',
    private readonly cancelText = 'Cancel',
  ) {
    super(app);
    let resolve: (ok: boolean) => void = () => undefined;
    this.promise = new Promise<boolean>((r) => (resolve = r));
    this.done = resolve;
  }

  onOpen(): void {
    this.setTitle(this.title);
    for (const line of this.lines) this.contentEl.createEl('p', { text: line });
    new Setting(this.contentEl)
      .addButton((b) =>
        b.setButtonText(this.confirmText).setCta().onClick(() => {
          this.result = true;
          this.close();
        }),
      )
      .addButton((b) => b.setButtonText(this.cancelText).onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    this.done(this.result);
  }
}

export function confirm(app: App, title: string, lines: string[], confirmText?: string, cancelText?: string): Promise<boolean> {
  const modal = new ConfirmModal(app, title, lines, confirmText, cancelText);
  modal.open();
  return modal.promise;
}

/** Ask for one line of text. Resolves to the trimmed text, or null when cancelled or left empty. */
export class TextPromptModal extends Modal {
  private result: string | null = null;
  private value = '';
  private readonly done: (v: string | null) => void;
  readonly promise: Promise<string | null>;

  constructor(
    app: App,
    private readonly title: string,
    private readonly lead: string,
    private readonly placeholder: string,
    private readonly confirmText: string,
    private readonly initial: string,
  ) {
    super(app);
    let resolve: (v: string | null) => void = () => undefined;
    this.promise = new Promise<string | null>((r) => (resolve = r));
    this.done = resolve;
    this.value = initial;
  }

  onOpen(): void {
    this.setTitle(this.title);
    if (this.lead) this.contentEl.createEl('p', { text: this.lead });
    const submit = () => {
      this.result = this.value.trim() === '' ? null : this.value.trim();
      this.close();
    };
    new Setting(this.contentEl).addText((t) => {
      t.setPlaceholder(this.placeholder).setValue(this.initial).onChange((v) => (this.value = v));
      t.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          submit();
        }
      });
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(this.confirmText).setCta().onClick(submit))
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    this.done(this.result);
  }
}

export function promptText(app: App, title: string, lead: string, placeholder: string, confirmText = 'Save', initial = ''): Promise<string | null> {
  const m = new TextPromptModal(app, title, lead, placeholder, confirmText, initial);
  m.open();
  return m.promise;
}
