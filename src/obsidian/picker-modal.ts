import { Modal } from 'obsidian';
import type { TFile } from 'obsidian';
import type RubricPlugin from '../main';
import { OptionListView } from './option-list';
import { OptionSession } from './option-session';

/** The small picker window: the primary path, which needs no Properties-area hook. */
export class OptionPickerModal extends Modal {
  constructor(
    private readonly plugin: RubricPlugin,
    private readonly file: TFile,
    private readonly key: string,
  ) {
    super(plugin.app);
  }

  async onOpen(): Promise<void> {
    const session = new OptionSession(this.plugin, this.file, this.key);
    const loaded = await session.load();
    this.setTitle(this.key);
    const { contentEl } = this;
    if (loaded.kind === 'locked') {
      contentEl.createEl('p', { text: loaded.note, cls: 'rubric-lock-note' });
      return;
    }
    if (loaded.kind === 'unavailable') {
      contentEl.createEl('p', { text: loaded.message });
      return;
    }
    contentEl.createEl('p', {
      cls: 'rubric-picker-lead',
      text: `${loaded.type.name} · ${loaded.list.mode === 'multi' ? 'tick several; each change saves at once' : 'pick one; it saves at once'}`,
    });
    const view = new OptionListView(contentEl, loaded.list, { onPick: (v) => session.pick(v) }, { filterable: true, label: this.key });
    view.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
