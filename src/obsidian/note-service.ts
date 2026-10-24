import { TFile, getFrontMatterInfo, parseYaml } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import { matchNote } from '../core/matcher';
import type { MatchResult } from '../core/matcher';
import { NAMING_PATIENCE_MS, stillBeingNamed } from '../core/naming';
import { createAction, folderKey, shouldAskWhichSchema } from '../core/prompt-policy';
import type { NoteEvent } from '../core/prompt-policy';
import { checkScope } from '../core/scope';
import type { ScopeVerdict } from '../core/scope';
import type { ResolvedType } from '../core/schema-types';
import type { RubricSettings } from '../settings';
import { askSchemaChoice } from './choice-modals';
import type { RegistryStore } from './registry-store';
import type { SchemaService } from './schema-service';

export interface NoteContext {
  file: TFile;
  verdict: ScopeVerdict;
  /** Null when the scope excludes the note or no schemas are loaded. */
  match: MatchResult | null;
  /** The schema that governs the note, when one matched. */
  type: ResolvedType | null;
  frontmatter: Record<string, unknown> | undefined;
}

/** Answers "is this note managed, and by which schema?" and runs the no-match prompt. */
export class NoteService {
  /** Folders asked about during this session, so two notes in one folder do not stack prompts. */
  private readonly askedThisSession = new Set<string>();
  private readonly pending = new Set<string>();
  /** New notes whose name is still being typed: path -> when they started waiting. They are filled after the rename. */
  private readonly awaitingName = new Map<string, number>();
  /** Notes to treat as brand new even if the file is older than the usual window (they waited for their name). */
  private readonly treatAsNew = new Set<string>();
  /** Set in Phase 4: write `type` into a note when the user picks a schema without remembering the folder. */
  applyType: ((file: TFile, type: string) => Promise<void>) | null = null;
  /** Set in main: fill or offer to fill a new note that matched a schema. */
  fillNew: ((file: TFile, type: ResolvedType, action: 'fill' | 'ask') => Promise<void>) | null = null;

  constructor(
    private readonly app: App,
    private readonly plugin: Plugin,
    private readonly schemas: SchemaService,
    private readonly registry: RegistryStore,
    private readonly getSettings: () => RubricSettings,
    private readonly saveSettings: () => Promise<void>,
  ) {}

  frontmatterOf(file: TFile): Record<string, unknown> | undefined {
    return this.app.metadataCache.getFileCache(file)?.frontmatter;
  }

  /** Frontmatter read from the file itself, for a brand-new file the metadata cache may not have indexed yet. */
  async readFrontmatter(file: TFile): Promise<Record<string, unknown> | undefined> {
    const text = await this.app.vault.cachedRead(file);
    const info = getFrontMatterInfo(text);
    if (!info.exists) return undefined;
    try {
      const value: unknown = parseYaml(info.frontmatter);
      return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Scope check, then matching. Never throws; unmanaged notes get `type: null`. */
  context(file: TFile, knownFrontmatter?: Record<string, unknown>  ): NoteContext {
    const pack = this.schemas.pack;
    const frontmatter = knownFrontmatter ?? this.frontmatterOf(file);
    if (!pack) return { file, verdict: { managed: true }, match: null, type: null, frontmatter };
    const verdict = checkScope(file.path, pack.scope, this.schemas.folder);
    if (!verdict.managed) return { file, verdict, match: null, type: null, frontmatter };
    const s = this.getSettings();
    const match = matchNote(pack, { path: file.path, frontmatter }, { mode: pack.folders.mode, noMatch: s.noMatch });
    const type = match.kind === 'matched' ? (pack.types.get(match.type) ?? null) : null;
    return { file, verdict, match, type, frontmatter };
  }

  /** Register vault events. Call from onLayoutReady, so the initial load does not look like new notes. */
  start(): void {
    const { vault, workspace } = this.app;
    this.plugin.registerEvent(
      vault.on('create', (f) => {
        if (f instanceof TFile) this.later(f, 'create');
      }),
    );
    this.plugin.registerEvent(
      vault.on('rename', (f, oldPath) => {
        if (!(f instanceof TFile)) return;
        // The user finished naming the note (Enter, or leaving the title): now it can be filled.
        if (this.awaitingName.delete(oldPath)) this.later(f, 'create', true);
        else this.later(f, 'rename');
      }),
    );
    // Leaving the title field without changing the name (they keep "Untitled"): fill after a short pause.
    this.plugin.registerDomEvent(document, 'focusout', (e) => {
      if (!(e.target instanceof HTMLElement) || !e.target.closest('.inline-title')) return;
      window.setTimeout(() => this.releaseIdle(), 1500);
    });
    this.plugin.registerEvent(workspace.on('active-leaf-change', () => window.setTimeout(() => this.releaseIdle(), 1500)));
    this.plugin.registerInterval(window.setInterval(() => this.releaseStale(), 15_000));
  }

  private titleFocused(): boolean {
    return !!activeDocument.activeElement?.closest('.inline-title');
  }

  private isBeingNamed(file: TFile): boolean {
    return stillBeingNamed({
      isActive: this.app.workspace.getActiveFile()?.path === file.path,
      titleFocused: this.titleFocused(),
      basename: file.basename,
    });
  }

  /** Waiting notes whose title is no longer being edited and that are no longer the open note's title in progress. */
  private releaseIdle(): void {
    for (const path of [...this.awaitingName.keys()]) {
      const file = this.app.vault.getFileByPath(path);
      if (!file) {
        this.awaitingName.delete(path);
        continue;
      }
      if (this.titleFocused() && this.app.workspace.getActiveFile()?.path === path) continue;
      this.awaitingName.delete(path);
      this.later(file, 'create', true);
    }
  }

  private releaseStale(): void {
    const now = Date.now();
    for (const [path, since] of [...this.awaitingName]) {
      if (now - since < NAMING_PATIENCE_MS) continue;
      this.awaitingName.delete(path);
      const file = this.app.vault.getFileByPath(path);
      if (file) this.later(file, 'create', true);
    }
  }

  /** Give the metadata cache a moment to read the new file before deciding. */
  private later(file: TFile, event: NoteEvent, asNew = false): void {
    if (file.extension !== 'md' || this.pending.has(file.path)) return;
    if (asNew) this.treatAsNew.add(file.path);
    this.pending.add(file.path);
    window.setTimeout(() => {
      this.pending.delete(file.path);
      void this.maybePrompt(file, event);
    }, Math.max(700, this.getSettings().createDelayMs));
  }

  private async maybePrompt(file: TFile, event: NoteEvent): Promise<void> {
    const pack = this.schemas.pack;
    if (!pack || !this.app.vault.getFileByPath(file.path)) return;
    const asNew = this.treatAsNew.delete(file.path);
    // A new note is filled after it has its real name, not while the title is still being typed.
    if (event === 'create' && !asNew && this.isBeingNamed(file)) {
      this.awaitingName.set(file.path, Date.now());
      return;
    }
    const ctx = this.context(file, (await this.readFrontmatter(file)) ?? {});
    if (!ctx.match) return;
    const settings = this.getSettings();
    const fm0 = ctx.frontmatter;
    if (ctx.match.kind === 'matched' && ctx.type) {
      const action = createAction({
        match: ctx.match,
        event,
        hasId: typeof fm0?.id === 'string' && fm0.id !== '',
        ageMs: asNew ? 0 : Date.now() - file.stat.ctime,
        setting: settings.onCreate,
      });
      if (action !== 'none' && this.fillNew) await this.fillNew(file, ctx.type, action);
      return;
    }
    const skipped = new Set([...settings.skippedFolders.map(folderKey), ...this.askedThisSession]);
    const fm = ctx.frontmatter;
    const ask = shouldAskWhichSchema({
      match: ctx.match,
      event,
      skippedFolders: skipped,
      hasId: typeof fm?.id === 'string' && fm.id !== '',
      ageMs: asNew ? 0 : Date.now() - file.stat.ctime,
    });
    if (!ask) return;
    await this.promptForSchema(file, ctx.match);
  }

  /** Show the schema choice for a note. `match` decides the folder and, for a conflict, the options. */
  async promptForSchema(file: TFile, match: MatchResult | null): Promise<void> {
    const pack = this.schemas.pack;
    if (!pack) return;
    const folder =
      match && (match.kind === 'ask' || match.kind === 'conflict') ? match.folder : (file.path.split('/')[0] ?? '');
    const conflict = match?.kind === 'conflict';
    const key = folderKey(folder);
    this.askedThisSession.add(key);
    const choice = await askSchemaChoice(this.app, {
      title: conflict ? `Which schema owns ${folder}/?` : folder ? `No schema for ${folder}/` : 'Choose a schema',
      lead: conflict
        ? `More than one schema claims "${folder}". Choose which one this folder belongs to.`
        : `Which schema should "${file.basename}" use?`,
      types: conflict && match?.kind === 'conflict' ? match.types : pack.typeNames,
      allowUnmanaged: !conflict,
      ...(folder ? { rememberText: `Remember ${folder}/ for this choice` } : {}),
      rememberDefault: this.getSettings().rememberAnswer,
    });
    if (!choice) {
      await this.skipFolder(key);
      return;
    }
    if (choice.type === null) {
      await this.skipFolder(key);
      return;
    }
    if (choice.remember && folder) {
      await this.registry.setMapping(folder, choice.type);
    } else if (this.applyType) {
      await this.applyType(file, choice.type);
    }
  }

  private async skipFolder(key: string): Promise<void> {
    const s = this.getSettings();
    if (!s.skippedFolders.map(folderKey).includes(key)) {
      s.skippedFolders.push(key);
      await this.saveSettings();
    }
  }
}
