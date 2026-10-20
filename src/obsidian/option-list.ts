import { setIcon } from 'obsidian';
import { filterOptions } from '../core/options';
import type { OptionItem, OptionList, OptionValue } from '../core/options';

export interface OptionListHandlers {
  /** Save a pick; resolves to the refreshed list so ticks move. */
  onPick: (value: OptionValue) => Promise<OptionList | null>;
}

export interface OptionListSettings {
  /** Show a filter box and handle the keyboard (arrows, Enter, Space). */
  filterable: boolean;
  label: string;
}

/**
 * The list of allowed values: filter box, ticks, mouse and keyboard. Used by the picker window and
 * by the popover in the Properties area, so both behave the same.
 */
export class OptionListView {
  readonly el: HTMLElement;
  private filterEl: HTMLInputElement | null = null;
  private listEl: HTMLElement;
  private active = 0;
  private visible: { item: OptionItem; viaSynonym?: string }[] = [];
  private busy = false;
  private externalQuery = '';

  constructor(
    parent: HTMLElement,
    private list: OptionList,
    private readonly handlers: OptionListHandlers,
    private readonly settings: OptionListSettings,
  ) {
    this.el = parent.createDiv({ cls: 'vschema-options' });
    if (settings.filterable) {
      this.filterEl = this.el.createEl('input', {
        type: 'text',
        cls: 'vschema-filter',
        attr: { placeholder: 'Type to filter', 'aria-label': `Filter ${settings.label}` },
      });
      this.filterEl.addEventListener('input', () => {
        this.active = 0;
        this.render();
      });
      this.filterEl.addEventListener('keydown', (e) => this.onKey(e));
    }
    this.listEl = this.el.createDiv({
      cls: 'vschema-option-list',
      attr: { role: 'listbox', 'aria-label': settings.label, ...(list.mode === 'multi' ? { 'aria-multiselectable': 'true' } : {}) },
    });
    this.render();
  }

  focus(): void {
    this.filterEl?.focus();
  }

  /** Filter by text typed elsewhere (the property field), for lists without their own filter box. */
  setQuery(query: string): void {
    this.externalQuery = query;
    this.active = 0;
    this.render();
  }

  /** Number of options currently shown. */
  get count(): number {
    return this.visible.length;
  }

  moveActive(delta: 1 | -1): void {
    const n = this.visible.length;
    if (n === 0) return;
    this.active = (this.active + delta + n) % n;
    this.render();
  }

  pickActive(): Promise<void> {
    const v = this.visible[this.active];
    return v ? this.pick(v.item.value) : Promise.resolve();
  }

  setList(list: OptionList): void {
    this.list = list;
    this.render();
  }

  private render(): void {
    this.visible = filterOptions(this.list, this.filterEl ? this.filterEl.value : this.externalQuery);
    if (this.active >= this.visible.length) this.active = Math.max(0, this.visible.length - 1);
    this.listEl.empty();
    if (this.visible.length === 0) {
      this.listEl.createDiv({ cls: 'vschema-option-empty', text: this.list.items.length === 0 ? 'Nothing to choose from.' : 'No match.' });
      return;
    }
    this.visible.forEach((v, i) => {
      const row = this.listEl.createDiv({
        cls: 'vschema-option',
        attr: { role: 'option', 'aria-selected': String(v.item.checked) },
      });
      row.toggleClass('is-active', i === this.active);
      row.toggleClass('is-checked', v.item.checked);
      const mark = row.createSpan({ cls: 'vschema-check' });
      if (v.item.checked) setIcon(mark, 'check');
      row.createSpan({ cls: 'vschema-option-label', text: v.item.label });
      if (v.viaSynonym) row.createSpan({ cls: 'vschema-option-note', text: `matches ${v.viaSynonym}` });
      // mousedown keeps focus where it was (the property field) while the list handles the click
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => void this.pick(v.item.value));
    });
    this.listEl.children[this.active]?.scrollIntoView({ block: 'nearest' });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.moveActive(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void this.pickActive();
    } else if (e.key === ' ' && this.list.mode === 'multi') {
      e.preventDefault();
      const v = this.visible[this.active];
      if (v) void this.pick(v.item.value);
    }
  }

  async pick(value: OptionValue): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const next = await this.handlers.onPick(value);
      if (next) this.setList(next);
    } finally {
      this.busy = false;
    }
  }
}
