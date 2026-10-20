export type HoldKey = 'Alt' | 'Shift' | 'Control' | 'Meta';
export type NoMatchBehaviour = 'ask' | 'unmanaged';
export type OnCreate = 'fill' | 'ask' | 'nothing';
export type PromptScope = 'open' | 'all';

export interface VaultSchemaSettings {
  /** `_schema` (default), `.schema`, or a custom root folder name. */
  schemaFolder: string;
  noMatch: NoMatchBehaviour;
  rememberAnswer: boolean;
  holdKey: HoldKey;
  holdDelayMs: number;
  alwaysHideOnRelease: boolean;
  showHint: boolean;
  commandsOnly: boolean;
  stampModified: boolean;
  batchMode: boolean;
  /** What to do with a new note in a mapped folder: add its properties, ask with a preview, or nothing. */
  onCreate: OnCreate;
  /** Quiet time after a note appears before it is filled, so a template can finish first. */
  createDelayMs: number;
  /** Keep `name` in step with the file name when the note is renamed (only if `name` was empty or filled by the plugin). */
  syncName: boolean;
  /** Write `breadcrumb` from the real folder when a note is created or moved. Off unless no breadcrumb plugin is used. */
  breadcrumbFromFolder: boolean;
  /** Ask about changes in notes that are open only, or in every note. */
  promptScope: PromptScope;
  promptTags: boolean;
  promptStatus: boolean;
  promptTypeChange: boolean;
  /** Folders the user answered "Not now" for; not asked again on every open. */
  skippedFolders: string[];
  /** IDs given up by renumbering. They are never handed out again. */
  retiredIds: string[];
  /** First-seen ID and created per note path: the small local index behind check 9. */
  index: Record<string, { id?: string; created?: string }>;
}

export const DEFAULT_SETTINGS: VaultSchemaSettings = {
  schemaFolder: '_schema',
  noMatch: 'ask',
  rememberAnswer: true,
  holdKey: 'Alt',
  holdDelayMs: 330,
  alwaysHideOnRelease: false,
  showHint: true,
  commandsOnly: false,
  stampModified: true,
  batchMode: true,
  onCreate: 'ask',
  createDelayMs: 1500,
  syncName: true,
  breadcrumbFromFolder: false,
  promptScope: 'open',
  promptTags: true,
  promptStatus: true,
  promptTypeChange: true,
  skippedFolders: [],
  retiredIds: [],
  index: {},
};

/** Merge stored data over the defaults, ignoring unknown keys and wrong types. */
export function mergeSettings(stored: unknown): VaultSchemaSettings {
  const out: VaultSchemaSettings = { ...DEFAULT_SETTINGS, skippedFolders: [], retiredIds: [], index: {} };
  if (typeof stored !== 'object' || stored === null) return out;
  const s = stored as Record<string, unknown>;
  const rec = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof VaultSchemaSettings)[]) {
    const v = s[key];
    if (v === undefined) continue;
    const def = DEFAULT_SETTINGS[key];
    if (Array.isArray(def) ? Array.isArray(v) : typeof v === typeof def) rec[key] = v;
  }
  if (!['Alt', 'Shift', 'Control', 'Meta'].includes(out.holdKey)) out.holdKey = 'Alt';
  if (!['ask', 'unmanaged'].includes(out.noMatch)) out.noMatch = 'ask';
  if (!['fill', 'ask', 'nothing'].includes(out.onCreate)) out.onCreate = 'ask';
  if (!['open', 'all'].includes(out.promptScope)) out.promptScope = 'open';
  if (!Number.isFinite(out.createDelayMs) || out.createDelayMs < 700 || out.createDelayMs > 30000) out.createDelayMs = DEFAULT_SETTINGS.createDelayMs;
  if (!Number.isFinite(out.holdDelayMs) || out.holdDelayMs < 0) out.holdDelayMs = DEFAULT_SETTINGS.holdDelayMs;
  if (!out.schemaFolder.trim() || /[\\/]/.test(out.schemaFolder)) out.schemaFolder = DEFAULT_SETTINGS.schemaFolder;
  return out;
}
