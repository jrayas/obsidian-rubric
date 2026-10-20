export type HoldKey = 'Alt' | 'Shift' | 'Control' | 'Meta';
export type NoMatchBehaviour = 'ask' | 'unmanaged';

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
  /** Folders the user answered "Not now" for; not asked again on every open. */
  skippedFolders: string[];
  /** IDs given up by renumbering. They are never handed out again. */
  retiredIds: string[];
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
  skippedFolders: [],
  retiredIds: [],
};

/** Merge stored data over the defaults, ignoring unknown keys and wrong types. */
export function mergeSettings(stored: unknown): VaultSchemaSettings {
  const out: VaultSchemaSettings = { ...DEFAULT_SETTINGS, skippedFolders: [], retiredIds: [] };
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
  if (!Number.isFinite(out.holdDelayMs) || out.holdDelayMs < 0) out.holdDelayMs = DEFAULT_SETTINGS.holdDelayMs;
  if (!out.schemaFolder.trim() || /[\\/]/.test(out.schemaFolder)) out.schemaFolder = DEFAULT_SETTINGS.schemaFolder;
  return out;
}
