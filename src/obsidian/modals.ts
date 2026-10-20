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
