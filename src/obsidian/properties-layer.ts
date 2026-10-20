/**
 * THE ONLY FILE THAT TOUCHES UNDOCUMENTED OBSIDIAN INTERNALS.
 *
 * Obsidian has no public API for customising the Properties area. This layer uses the technique the
 * "Nested Frontmatter Properties" plugin uses: wrap `app.metadataTypeManager.getTypeInfo` so the widget
 * Obsidian chose for a schema-covered property is replaced by a decorated copy of itself. The copy renders
 * the original widget (native editing is untouched) and then attaches the hold-to-show list, the latched list,
 * the ▾ button and the focus hint.
 *
 * Rules (spec "Safety rules"): every access is feature-detected; any failure switches the layer off with one
 * notice and no repeated errors; the "commands only" setting never installs it. The commands and the picker
 * window do not depend on this file.
 */
import { MarkdownView, Notice, Platform, setIcon } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { holdStep, isModifierHeld } from '../core/hold-state';
import type { HoldEffect, HoldInput, HoldState } from '../core/hold-state';
import { isLocked, lockNote, optionsFor } from '../core/options';
import type VaultSchemaPlugin from '../main';
import type { HoldKey } from '../settings';
import { OptionListView } from './option-list';
import { OptionSession } from './option-session';

interface RenderContext {
  key: string;
  sourcePath: string;
  [k: string]: unknown;
}
interface WidgetLike {
  render: (el: HTMLElement, data: unknown, ctx: RenderContext) => unknown;
  [k: string]: unknown;
}
interface TypeInfo {
  expected: WidgetLike | null;
  inferred: WidgetLike;
}
interface MetadataCacheLike {
  getFrontmatterPropertyValuesForKey?: (key: string) => unknown[];
  getTags?: () => Record<string, number>;
}
interface TypeManagerLike {
  getTypeInfo: (this: TypeManagerLike, key: string, value: unknown) => TypeInfo;
  registeredTypeWidgets: Record<string, WidgetLike>;
}

const HOLD_LABEL: Record<string, string> = { Alt: Platform.isMacOS ? 'Option' : 'Alt', Shift: 'Shift', Control: 'Control', Meta: Platform.isMacOS ? 'Command' : 'Windows' };

/** Why the layer cannot run, or null when every internal it needs is present. */
export function detectPropertiesLayer(app: App): string | null {
  const mtm = (app as unknown as { metadataTypeManager?: Partial<TypeManagerLike> }).metadataTypeManager;
  if (!mtm) return 'metadataTypeManager is missing';
  if (typeof mtm.getTypeInfo !== 'function') return 'getTypeInfo is missing';
  if (typeof mtm.registeredTypeWidgets !== 'object' || mtm.registeredTypeWidgets === null) return 'registeredTypeWidgets is missing';
  try {
    const probe = mtm.getTypeInfo.call(mtm as TypeManagerLike, 'vschema-probe', 'x') as TypeInfo | undefined;
    if (typeof probe?.inferred?.render !== 'function') return 'widgets have no render function';
  } catch (e) {
    return `getTypeInfo threw: ${e instanceof Error ? e.message : String(e)}`;
  }
  return null;
}

export class PropertiesLayer {
  private mtm: TypeManagerLike | null = null;
  private original: TypeManagerLike['getTypeInfo'] | null = null;
  private patched: TypeManagerLike['getTypeInfo'] | null = null;
  private active = false;
  private failed = false;
  private readonly wrapped = new WeakMap<WidgetLike, WidgetLike>();
  private readonly fields = new Map<string, FieldController>();
  /** Lost-key-release safety (any event without the hold key's flag counts as a release). Only the test suite turns it off. */
  releaseSafety = true;
  /** The field whose list is open right now, so the hotkey can close it from inside the popover. */
  openField: FieldController | null = null;
  private covered = new Set<string>();
  private cacheRestore: (() => void) | null = null;
  private eventsRegistered = false;

  constructor(private readonly plugin: VaultSchemaPlugin) {}

  get installed(): boolean {
    return this.active;
  }

  /** Install if every internal is present. Returns false (and says so once) otherwise. */
  install(): boolean {
    if (this.active) return true;
    const problem = detectPropertiesLayer(this.plugin.app);
    if (problem) {
      this.plugin.notifyOnce('layer-unavailable', 'Properties area features are unavailable in this Obsidian version. The commands and the picker window still work.');
      console.debug('[vault-schema] properties layer unavailable:', problem);
      return false;
    }
    const mtm = (this.plugin.app as unknown as { metadataTypeManager: TypeManagerLike }).metadataTypeManager;
    this.mtm = mtm;
    this.original = mtm.getTypeInfo;
    const handle = (manager: TypeManagerLike, key: string, value: unknown): TypeInfo => {
      const info = (this.original as TypeManagerLike['getTypeInfo']).call(manager, key, value);
      if (!this.active) return info;
      try {
        return this.decorateInfo(info, key);
      } catch (e) {
        this.fail(e);
        return info;
      }
    };
    this.patched = function (this: TypeManagerLike, key: string, value: unknown): TypeInfo {
      return handle(this, key, value);
    };
    this.refreshCovered();
    mtm.getTypeInfo = this.patched;
    this.muteNativeSuggestions();
    this.active = true;
    this.failed = false;
    this.registerEvents();
    this.refreshOpenViews();
    this.scheduleReconcile();
    return true;
  }

  private registerEvents(): void {
    if (this.eventsRegistered) return;
    this.eventsRegistered = true;
    const { workspace, metadataCache } = this.plugin.app;
    const go = () => this.scheduleReconcile();
    this.plugin.registerEvent(workspace.on('file-open', go));
    this.plugin.registerEvent(workspace.on('active-leaf-change', go));
    this.plugin.registerEvent(workspace.on('layout-change', go));
    this.plugin.registerEvent(metadataCache.on('changed', go));
  }

  /** Remove the wrapper and every control we added. Safe to call twice. */
  uninstall(): void {
    const wasActive = this.active;
    this.active = false;
    if (this.mtm && this.patched && this.mtm.getTypeInfo === this.patched && this.original) {
      this.mtm.getTypeInfo = this.original;
    } // else another plugin wrapped after us: our wrapper stays but is a pass-through now
    for (const f of this.fields.values()) f.destroy();
    this.fields.clear();
    this.openField = null;
    this.cacheRestore?.();
    this.cacheRestore = null;
    if (wasActive) this.refreshOpenViews();
  }

  /**
   * Obsidian's own value suggestions list the values found elsewhere in the vault and would sit on top of the
   * note's schema values (and take Enter and Escape). They read their values from the metadata cache when the field
   * gains focus, so those two reads return nothing when the active element is a decorated field with a schema list
   * for that key. Skipped when the functions are absent.
   */
  private muteNativeSuggestions(): void {
    const cache = this.plugin.app.metadataCache as unknown as MetadataCacheLike;
    const origValues = cache.getFrontmatterPropertyValuesForKey;
    const origTags = cache.getTags;
    if (typeof origValues !== 'function' || typeof origTags !== 'function') return;
    const patchedValues = function (this: unknown, key: string): unknown[] {
      return layerMuted(key) ? [] : origValues.call(this, key);
    };
    const patchedTags = function (this: unknown): Record<string, number> {
      return layerMuted('tags') ? {} : origTags.call(this);
    };
    const layerMuted = (key: string): boolean => {
      const row = activeDocument.activeElement?.closest<HTMLElement>('.metadata-property.vschema-has-list');
      return row?.dataset.propertyKey?.toLowerCase() === key.toLowerCase();
    };
    cache.getFrontmatterPropertyValuesForKey = patchedValues;
    cache.getTags = patchedTags;
    this.cacheRestore = () => {
      if (cache.getFrontmatterPropertyValuesForKey === patchedValues) cache.getFrontmatterPropertyValuesForKey = origValues;
      if (cache.getTags === patchedTags) cache.getTags = origTags;
    };
  }

  /** The property names any schema defines; only these keys are decorated. */
  refreshCovered(): void {
    const names = new Set<string>();
    for (const t of this.plugin.schemas.pack?.types.values() ?? []) for (const p of t.properties) names.add(p.name.toLowerCase());
    this.covered = names;
  }

  /** Latch or unlatch the list of the focused field. Returns false when no decorated field has focus. */
  toggleFocused(): boolean {
    const focus = activeDocument.activeElement;
    if (this.openField?.owns(focus)) {
      this.openField.input({ type: 'hotkey' });
      return true;
    }
    const row = focus?.closest<HTMLElement>('.metadata-property');
    if (!row) return false;
    for (const controller of this.fields.values()) {
      if (controller.row === row) {
        controller.input({ type: 'hotkey' });
        return true;
      }
    }
    return false;
  }

  private fail(e: unknown): void {
    if (this.failed) return;
    this.failed = true;
    console.error('[vault-schema] properties layer error, switching it off:', e);
    new Notice('Properties area features were switched off after an error. The commands and the picker window still work.');
    this.uninstall();
  }

  private decorateInfo(info: TypeInfo, key: string): TypeInfo {
    if (!this.covered.has(key.toLowerCase())) return info;
    return {
      ...info,
      expected: info.expected ? this.wrap(info.expected) : info.expected,
      inferred: this.wrap(info.inferred),
    };
  }

  private wrap(w: WidgetLike): WidgetLike {
    const cached = this.wrapped.get(w);
    if (cached) return cached;
    const render = (el: HTMLElement, data: unknown, ctx: RenderContext): unknown => {
      const instance = w.render(el, data, ctx);
      if (this.active) {
        try {
          this.decorateField(el, ctx, instance);
        } catch (e) {
          this.fail(e);
        }
      }
      return instance;
    };
    const copy = Object.create(w, { render: { value: render, writable: true, configurable: true, enumerable: true } }) as WidgetLike;
    this.wrapped.set(w, copy);
    // `expected` and `inferred` are compared by identity somewhere inside Obsidian: keep the map stable.
    return copy;
  }

  /** Does this property of this note get controls, and which kind? */
  private eligibility(file: TFile | null, key: string): { ok: boolean; locked: boolean; hasList: boolean } {
    const noteCtx = file ? this.plugin.notes.context(file) : null;
    const def = noteCtx?.type?.byName.get(key);
    const locked = isLocked(key, def);
    const pack = this.plugin.schemas.pack;
    const hasList = !locked && def && pack ? optionsFor(def, noteCtx?.frontmatter?.[def.name], pack) !== null : false;
    const ok = !!file && !!noteCtx?.type && noteCtx.verdict.managed && (locked || hasList);
    return { ok, locked, hasList };
  }

  private decorateField(el: HTMLElement, ctx: RenderContext, instance: unknown): void {
    const file = this.plugin.app.vault.getFileByPath(ctx.sourcePath);
    const { ok, locked, hasList } = this.eligibility(file, ctx.key);
    if (!file || !ok) {
      // Obsidian reuses row elements between notes: drop whatever an earlier note attached to this one.
      window.requestAnimationFrame(() => this.release(el));
      return;
    }
    // The container may not be attached yet when render runs; attach on the next frame.
    window.requestAnimationFrame(() => {
      if (!this.active) return;
      const row = el.closest<HTMLElement>('.metadata-property');
      if (!row) return;
      this.prune();
      const id = `${file.path}\u0000${ctx.key}`;
      // The row may have belonged to another note or property a moment ago.
      for (const [otherId, other] of this.fields) {
        if (otherId !== id && other.row === row) {
          other.destroy();
          this.fields.delete(otherId);
        }
      }
      // Obsidian re-renders a row after every save. Keep the controller (and an open list) across that.
      const existing = this.fields.get(id);
      if (existing) existing.attach(row, el, instance, locked, hasList);
      else {
        const controller = new FieldController(this.plugin, this, file, ctx.key);
        controller.attach(row, el, instance, locked, hasList);
        this.fields.set(id, controller);
      }
    });
  }

  private reconcileQueued = false;

  /** Check every visible Properties row against its note, soon. Rows are reused between notes without a re-render. */
  scheduleReconcile(): void {
    if (this.reconcileQueued || !this.active) return;
    this.reconcileQueued = true;
    window.requestAnimationFrame(() => {
      this.reconcileQueued = false;
      try {
        this.reconcile();
      } catch (e) {
        this.fail(e);
      }
    });
  }

  private reconcile(): void {
    if (!this.active) return;
    const live = new Set<HTMLElement>();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file) continue;
      const file = view.file;
      for (const row of Array.from(view.containerEl.querySelectorAll<HTMLElement>('.metadata-property[data-property-key]'))) {
        live.add(row);
        const key = row.dataset.propertyKey ?? '';
        const { ok, locked, hasList } = this.eligibility(file, key);
        let id = '';
        let existing: FieldController | undefined;
        for (const [fid, f] of this.fields) {
          if (f.row === row) {
            id = fid;
            existing = f;
          }
        }
        if (existing && (!ok || existing.file.path !== file.path || existing.key !== key)) {
          existing.destroy();
          this.fields.delete(id);
          existing = undefined;
        }
        if (!ok) continue;
        if (existing) existing.refresh(locked, hasList);
        else {
          const controller = new FieldController(this.plugin, this, file, key);
          controller.attach(row, row.querySelector<HTMLElement>('.metadata-property-value') ?? row, null, locked, hasList);
          this.fields.set(`${file.path}\u0000${key}`, controller);
        }
      }
    }
    for (const [id, f] of this.fields) {
      if (!live.has(f.row) && !f.row.isConnected && f.idle) {
        f.destroy();
        this.fields.delete(id);
      }
    }
  }

  /** A row now shows something with no schema behind it: remove controllers still attached to it. */
  private release(el: HTMLElement): void {
    const row = el.closest<HTMLElement>('.metadata-property');
    if (!row) return;
    for (const [id, f] of this.fields) {
      if (f.row === row) {
        f.destroy();
        this.fields.delete(id);
      }
    }
  }

  /** Forget fields whose row has gone and whose list is closed. */
  private prune(): void {
    for (const [id, f] of this.fields) {
      if (!f.row.isConnected && f.idle) {
        f.destroy();
        this.fields.delete(id);
      }
    }
  }

  private refreshOpenViews(): void {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const l = leaf as unknown as { rebuildView?: () => void };
      try {
        l.rebuildView?.();
      } catch {
        /* the note picks the change up the next time it is opened */
      }
    }
  }
}

/** One decorated property row: hold, latch, ▾ button, hint and the popover. */
class FieldController {
  row!: HTMLElement;
  private valueEl!: HTMLElement;
  private instance: unknown = null;
  private locked = false;
  private hasList = false;
  private rowAbort: AbortController | null = null;
  private docListening = false;
  private observer: MutationObserver | null = null;
  private destroyed = false;
  private auto: { pop: HTMLElement; view: OptionListView; session: OptionSession } | null = null;
  /** The element the user is typing in (the autocomplete fragment lives there). */
  private typing: HTMLElement | null = null;
  private autoToken = 0;
  private state: HoldState = 'closed';
  private timer: number | null = null;
  private popover: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  private readonly abort = new AbortController();
  private openToken = 0;

  constructor(
    private readonly plugin: VaultSchemaPlugin,
    private readonly layer: PropertiesLayer,
    readonly file: TFile,
    readonly key: string,
  ) {}

  /** Update what this field offers after its note changed (a new schema, a new type). */
  refresh(locked: boolean, hasList: boolean): void {
    this.locked = locked;
    this.hasList = hasList;
    this.row.toggleClass('vschema-locked', locked);
    this.row.toggleClass('vschema-has-list', hasList);
    if (hasList) this.ensureButton();
    else {
      this.button?.remove();
      this.button = null;
    }
  }

  /** True when no list is open or pending, so the controller can be dropped. */
  get idle(): boolean {
    return this.state === 'closed';
  }

  /** True when `node` is inside this field's row or its popover. */
  owns(node: Element | null): boolean {
    return !!node && (this.row.contains(node) || (this.popover?.contains(node) ?? false));
  }

  /** (Re)bind to a freshly rendered row. State and an open list survive. */
  attach(row: HTMLElement, valueEl: HTMLElement, instance: unknown, locked: boolean, hasList: boolean): void {
    this.valueEl = valueEl;
    this.instance = instance;
    this.locked = locked;
    this.hasList = hasList;
    if (this.row !== row) {
      this.rowAbort?.abort();
      this.row?.removeClass('vschema-field', 'vschema-locked', 'vschema-has-list');
      this.row = row;
      const rowAbort = new AbortController();
      this.rowAbort = rowAbort;
      const opts = { signal: AbortSignal.any([this.abort.signal, rowAbort.signal]) };
      row.addEventListener('keydown', (e) => this.onKeyDown(e), { ...opts, capture: true });
      row.addEventListener('focusin', () => this.showHint(), opts);
      row.addEventListener('focusout', (e) => {
        if (!(e.relatedTarget instanceof Node) || !row.contains(e.relatedTarget)) {
          this.hideHint();
          this.closeAuto();
        }
      }, opts);
      row.addEventListener('input', (e) => this.onTyped(e), opts);
    }
    // Key release is heard on the document: a save can re-render the row while the key is still down.
    if (!this.docListening) {
      this.docListening = true;
      row.ownerDocument.addEventListener('keyup', (e) => this.onKeyUp(e), { signal: this.abort.signal, capture: true });
      // A key release can go missing (the window lost focus, another app took the key). Any later event that shows the
      // hold key is no longer down counts as the release, so a list can never stay stuck open.
      row.ownerDocument.addEventListener('mousemove', (e) => this.releaseIfNotHeld(e), { signal: this.abort.signal, capture: true });
      row.ownerDocument.addEventListener('mousedown', (e) => this.releaseIfNotHeld(e), { signal: this.abort.signal, capture: true });
      row.ownerDocument.addEventListener('keydown', (e) => this.releaseIfNotHeld(e), { signal: this.abort.signal, capture: true });
      row.ownerDocument.defaultView?.addEventListener('blur', () => this.releaseNow(), { signal: this.abort.signal });
    }
    row.addClass('vschema-field');
    row.toggleClass('vschema-locked', locked);
    row.toggleClass('vschema-has-list', hasList);
    this.ensureButton();
    // Obsidian can rebuild the value without calling render again (after a save, for example). Re-add the button then.
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => {
      if (this.hasList && !this.button?.isConnected) window.requestAnimationFrame(() => this.ensureButton());
    });
    this.observer.observe(row, { childList: true, subtree: true });
  }

  private syncAria(): void {
    const open: boolean = (['hold', 'sticky', 'latched'] as HoldState[]).includes(this.state);
    this.button?.setAttribute('aria-expanded', String(open));
  }

  private ensureButton(): void {
    if (!this.destroyed && this.hasList && this.row.isConnected && !this.button?.isConnected) this.addButton();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelTimer();
    this.closePopover();
    this.hideHint();
    this.observer?.disconnect();
    this.closeAuto();
    this.button?.remove();
    this.row?.removeClass('vschema-field', 'vschema-locked', 'vschema-has-list');
    this.abort.abort();
    if (this.layer.openField === this) this.layer.openField = null;
  }

  private get doc(): Document {
    return this.row.ownerDocument;
  }

  private holdKey(): HoldKey {
    return this.plugin.settings.holdKey;
  }

  // -- input -----------------------------------------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    if (this.auto && this.state === 'closed') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        this.auto.view.moveActive(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (this.auto.view.count > 0) {
          e.preventDefault();
          e.stopPropagation();
          void this.auto.view.pickActive().then(() => this.closeAuto());
          return;
        }
      }
      if (e.key === 'Escape') {
        // the first Escape closes only the suggestions
        e.preventDefault();
        e.stopPropagation();
        this.closeAuto();
        return;
      }
    }
    if (e.key === 'Escape') {
      // handled by the document-level listener while a list is open
      return;
    }
    if (e.key === this.holdKey()) {
      if (!this.locked && !this.hasList) return;
      this.input({ type: 'holdDown', repeat: e.repeat });
    } else if (this.state === 'pending') {
      this.input({ type: 'otherKey' });
    }
  }

  /** The hold key is not down any more (as far as this event can tell): behave as if it was released. */
  private releaseIfNotHeld(e: KeyboardEvent | MouseEvent): void {
    if (!this.layer.releaseSafety) return;
    if (this.state !== 'pending' && this.state !== 'hold') return;
    if (isModifierHeld(this.holdKey(), e)) return;
    this.releaseNow(e);
  }

  /** Release without the pointer rule (the key is gone, so there is nothing to wait for). */
  private releaseNow(e?: Event): void {
    if (this.state !== 'pending' && this.state !== 'hold') return;
    const over = e instanceof MouseEvent && e.target instanceof Node && (this.popover?.contains(e.target) ?? false);
    this.input({ type: 'holdUp', pointerOverList: over, alwaysHide: !over });
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key !== this.holdKey() || this.state === 'closed') return;
    const handled = true;
    this.input({ type: 'holdUp', pointerOverList: this.popover?.matches(':hover') ?? false, alwaysHide: this.plugin.settings.alwaysHideOnRelease });
    // On Windows a lone Alt press and release would move focus to the menu bar; we used the key, so stop that.
    if (handled && e.key === 'Alt') e.preventDefault();
  }

  /** Feed the state machine and carry out what it asks for. */
  input(input: HoldInput): void {
    if (!this.locked && !this.hasList && input.type === 'hotkey') return;
    const result = holdStep(this.state, input);
    const before = this.state;
    this.state = result.state;
    for (const effect of result.effects) this.apply(effect);
    // moving between open states re-renders the list (the latched list has a filter box, the held one does not)
    if (this.state !== before && this.state !== 'closed' && !result.effects.includes('show')) this.renderPopover();
    this.syncAria();
  }

  private apply(effect: HoldEffect): void {
    switch (effect) {
      case 'startTimer':
        this.cancelTimer();
        this.timer = window.setTimeout(() => {
          this.timer = null;
          this.input({ type: 'timer' });
        }, this.plugin.settings.holdDelayMs);
        break;
      case 'cancelTimer':
        this.cancelTimer();
        break;
      case 'show':
        this.cancelTimer();
        this.renderPopover();
        break;
      case 'hide':
        this.closePopover();
        break;
      case 'consumeEscape':
        break; // the capture listener already stopped the event
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  // -- popover ---------------------------------------------------------------------------------------

  private renderPopover(): void {
    const token = ++this.openToken;
    this.closeAuto();
    const latched = this.state === 'latched';
    void (async () => {
      const session = new OptionSession(this.plugin, this.file, this.key);
      const loaded = await session.load();
      if (token !== this.openToken || this.state === 'closed' || this.state === 'pending') return;
      this.removePopoverEl();
      this.hideHint();
      const pop = this.doc.body.createDiv({ cls: 'vschema-popover', attr: { role: 'dialog', 'aria-label': `Options for ${this.key}` } });
      this.popover = pop;
      this.layer.openField = this;
      this.position(pop);
      if (loaded.kind === 'ready') {
        const view = new OptionListView(
          pop,
          loaded.list,
          {
            onPick: async (v) => {
              const next = await session.pick(v);
              // A list kept open only so you could click: once a single choice is made, it is done.
              if (this.state === 'sticky' && loaded.list.mode === 'single') this.input({ type: 'clickElsewhere' });
              return next;
            },
          },
          { filterable: latched, label: this.key },
        );
        if (latched) view.focus();
      } else {
        pop.createDiv({ cls: 'vschema-lock-note', text: loaded.kind === 'locked' ? loaded.note : loaded.message });
      }
      // A list kept open because the pointer was on it goes away when the pointer leaves it.
      if (this.state === 'sticky') pop.addEventListener('mouseleave', () => this.input({ type: 'clickElsewhere' }), { once: true });
      this.listenWhileOpen();
    })();
  }

  private position(pop: HTMLElement): void {
    const rect = this.valueEl.getBoundingClientRect();
    pop.setCssProps({
      '--vschema-left': `${Math.round(rect.left)}px`,
      '--vschema-top': `${Math.round(rect.bottom + 2)}px`,
      '--vschema-min-width': `${Math.round(rect.width)}px`,
    });
  }

  private listenWhileOpen(): void {
    const doc = this.doc;
    const opts = { signal: this.abort.signal, capture: true } as const;
    const stop = new AbortController();
    this.cleanupWhileOpen?.();
    this.cleanupWhileOpen = () => stop.abort();
    const sig = { ...opts, signal: AbortSignal.any([this.abort.signal, stop.signal]) };
    doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.state === 'closed') return;
      const before = this.state;
      this.input({ type: 'escape' });
      if (before !== 'pending') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, sig);
    const outside = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && (this.popover?.contains(t) || this.row.contains(t))) return;
      this.input({ type: 'clickElsewhere' });
    };
    doc.addEventListener('mousedown', outside, sig);
    doc.addEventListener('focusin', outside, sig);
  }

  private cleanupWhileOpen: (() => void) | null = null;

  private removePopoverEl(): void {
    this.popover?.remove();
    this.popover = null;
  }

  private closePopover(): void {
    this.openToken++;
    const hadFocus = this.popover?.contains(this.doc.activeElement) ?? false;
    this.removePopoverEl();
    this.cleanupWhileOpen?.();
    this.cleanupWhileOpen = null;
    if (this.layer.openField === this) this.layer.openField = null;
    if (hadFocus) this.refocusField();
  }

  private refocusField(): void {
    const inst = this.instance as { focus?: () => void } | null;
    if (inst && typeof inst.focus === 'function') inst.focus();
    else this.row.querySelector<HTMLElement>('input, [contenteditable="true"]')?.focus();
  }

  // -- autocomplete while typing ---------------------------------------------------------------------

  /** The text typed in the value part of the row, or null when the event came from elsewhere (the key name). */
  private typedText(e: Event): string | null {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.closest('.metadata-property-value')) return null;
    return t.instanceOf(HTMLInputElement) || t.instanceOf(HTMLTextAreaElement) ? t.value : (t.textContent ?? '');
  }

  private onTyped(e: Event): void {
    if (!this.hasList || this.state !== 'closed') return;
    const text = this.typedText(e);
    if (text === null) return;
    if (e.target instanceof HTMLElement) this.typing = e.target;
    const query = text.trim();
    if (!query) {
      this.closeAuto();
      return;
    }
    void this.showAuto(query);
  }

  private async showAuto(query: string): Promise<void> {
    const token = ++this.autoToken;
    if (this.auto) {
      this.auto.view.setQuery(query);
      if (this.auto.view.count === 0) this.closeAuto();
      return;
    }
    const session = new OptionSession(this.plugin, this.file, this.key);
    const loaded = await session.load();
    if (token !== this.autoToken || loaded.kind !== 'ready' || this.state !== 'closed') return;
    this.hideHint();
    const pop = this.doc.body.createDiv({ cls: 'vschema-popover vschema-autocomplete', attr: { role: 'listbox', 'aria-label': `Suggestions for ${this.key}` } });
    this.position(pop);
    const view = new OptionListView(
      pop,
      loaded.list,
      {
        onPick: async (v) => {
          const next = await session.pick(v);
          this.afterAutoPick(v, loaded.list.mode);
          return next;
        },
      },
      { filterable: false, label: this.key },
    );
    view.setQuery(query);
    this.auto = { pop, view, session };
    if (view.count === 0) this.closeAuto();
  }

  /**
   * The typed fragment ("dr") is still in the field after a pick saved "draft". Left alone, Obsidian would commit
   * the fragment when the field loses focus and overwrite the pick. Replace it with the picked value (single choice,
   * then leave the field as Enter does) or clear it (multi choice, where the pick was added to the list).
   */
  private afterAutoPick(value: unknown, mode: 'single' | 'multi'): void {
    const el = this.typing;
    this.typing = null;
    if (!el?.isConnected) return;
    if (mode === 'multi') {
      el.textContent = '';
      return;
    }
    const text = String(value);
    if (el.instanceOf(HTMLInputElement) || el.instanceOf(HTMLTextAreaElement)) el.value = text;
    else el.textContent = text;
    el.blur();
  }

  private closeAuto(): void {
    this.autoToken++;
    this.auto?.pop.remove();
    this.auto = null;
  }

  // -- ▾ button and hint ----------------------------------------------------------------------------

  private addButton(): void {
    const host = this.row.querySelector<HTMLElement>('.metadata-property-value') ?? this.valueEl;
    const btn = host.createEl('button', {
      cls: 'vschema-chevron clickable-icon',
      attr: {
        type: 'button',
        'aria-label': `Show all options for ${this.key}`,
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false',
      },
    });
    setIcon(btn, 'chevron-down');
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => this.input({ type: 'hotkey' }));
    this.button = btn;
    this.syncAria();
  }

  private showHint(): void {
    if (!this.plugin.settings.showHint || !this.hasList || this.state !== 'closed' || this.hint) return;
    const hint = this.doc.body.createDiv({
      cls: 'vschema-hint',
      text: `Hold ${HOLD_LABEL[this.holdKey()] ?? this.holdKey()} for all options`,
      attr: { role: 'status' },
    });
    this.position(hint);
    this.hint = hint;
  }

  private hideHint(): void {
    this.hint?.remove();
    this.hint = null;
  }
}

/** Used by tests and the settings page to describe the hold key. */
export function holdKeyLabel(key: string): string {
  return HOLD_LABEL[key] ?? key;
}

export { lockNote };
