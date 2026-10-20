import { firstSegment, nameKey } from './normalise';
import type { MatchingMode, SchemaPack } from './schema-types';

export type MatchVia = 'type' | 'breadcrumb' | 'folder-mapping' | 'folder-name';

export type MatchResult =
  /** One schema owns the note. */
  | { kind: 'matched'; type: string; via: MatchVia }
  /** Several schemas claim the same folder: ask which one owns it, never pick silently. */
  | { kind: 'conflict'; folder: string; types: string[] }
  /** Nothing matched: ask once (mode combined / manual). */
  | { kind: 'ask'; folder: string }
  /** Left alone: vault root, or the setting says leave unmanaged, or auto mode found nothing. */
  | { kind: 'unmanaged'; reason: 'root' | 'no-match-setting' | 'auto-no-match' };

export interface MatchNote {
  /** Vault-relative path, `/` separators, including the file name. */
  path: string;
  frontmatter: Record<string, unknown> | undefined;
}

export interface MatchOptions {
  mode: MatchingMode;
  /** What to do when nothing matches in combined or manual mode. */
  noMatch: 'ask' | 'unmanaged';
}

/** Types that the registry maps `folderName` to (compared ignoring case and accents). */
function typesForFolder(pack: SchemaPack, folderName: string): string[] {
  const key = nameKey(folderName);
  const found = new Set<string>();
  for (const m of pack.folders.mappings) if (nameKey(m.folder) === key) found.add(m.type);
  return [...found];
}

function typeNameFor(pack: SchemaPack, folderName: string): string | undefined {
  const key = nameKey(folderName);
  return pack.typeNames.find((t) => nameKey(t) === key);
}

function fromList(pack: SchemaPack, folder: string, via: MatchVia): MatchResult | null {
  const types = typesForFolder(pack, folder);
  if (types.length === 1) return { kind: 'matched', type: types[0] as string, via };
  if (types.length > 1) return { kind: 'conflict', folder, types };
  return null;
}

/**
 * Rule 1: match a note to a schema.
 *   combined: a valid `type`, the first segment of `breadcrumb` against the registry folder list,
 *             the note's first folder against the registry list or a schema name, otherwise ask.
 *   auto:     breadcrumb and folder only; never asks.
 *   manual:   a valid `type`, or a folder the user mapped; otherwise ask. No guessing.
 */
export function matchNote(pack: SchemaPack, note: MatchNote, options: MatchOptions): MatchResult {
  const fm = note.frontmatter ?? {};
  const segments = note.path.split('/');
  const folder = segments.length > 1 ? (segments[0] as string) : '';
  const { mode } = options;

  // 1) a valid `type` property
  if (mode !== 'auto' && typeof fm.type === 'string') {
    const wanted = nameKey(fm.type);
    const t = pack.typeNames.find((name) => nameKey(name) === wanted);
    if (t) return { kind: 'matched', type: t, via: 'type' };
  }

  // 2) first segment of the breadcrumb against the registry folder list
  const breadcrumb = typeof fm.breadcrumb === 'string' ? fm.breadcrumb : '';
  const crumb = firstSegment(breadcrumb);
  if (mode !== 'manual' && crumb) {
    const hit = fromList(pack, crumb, 'breadcrumb');
    if (hit) return hit;
  }

  // 3) the note's own first folder: registry list, then a folder named like a schema
  if (folder) {
    const hit = fromList(pack, folder, 'folder-mapping');
    if (hit) return hit;
    if (mode !== 'manual') {
      const t = typeNameFor(pack, folder);
      if (t) return { kind: 'matched', type: t, via: 'folder-name' };
    }
  }

  // 4) nothing matched
  if (!folder && !crumb) return { kind: 'unmanaged', reason: 'root' };
  if (mode === 'auto') return { kind: 'unmanaged', reason: 'auto-no-match' };
  if (options.noMatch === 'unmanaged') return { kind: 'unmanaged', reason: 'no-match-setting' };
  return { kind: 'ask', folder: folder || crumb };
}
