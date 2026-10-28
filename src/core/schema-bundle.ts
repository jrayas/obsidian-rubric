/**
 * The schema folder as a set of text files, and the preset file format. A preset is a named copy of every schema
 * file; the generated `preview/` folder is never part of it. Pure; no Obsidian types.
 */
import { PREVIEW_FOLDER } from './schema-preview';

/** Files that belong to a schema: the YAML files and the reference. */
const EXTENSIONS = ['.yaml', '.yml', '.md'];

/** A relative path with `/` separators that stays inside the schema folder. */
export function isSafePath(rel: string): boolean {
  if (rel === '' || rel.startsWith('/') || rel.includes('\\') || rel.includes(':')) return false;
  return rel.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** Is this schema-folder-relative path part of a preset or an export? */
export function isBundlePath(rel: string): boolean {
  if (!isSafePath(rel)) return false;
  if (rel === PREVIEW_FOLDER || rel.startsWith(`${PREVIEW_FOLDER}/`)) return false;
  const lower = rel.toLowerCase();
  return EXTENSIONS.some((e) => lower.endsWith(e));
}

export const PRESET_FORMAT = 1;

export interface Preset {
  format: number;
  name: string;
  /** ISO time the preset was saved. */
  created: string;
  pluginVersion: string;
  /** Schema-folder-relative path -> text. */
  files: Record<string, string>;
}

export function makePreset(name: string, files: ReadonlyMap<string, string>, now: Date, pluginVersion: string): Preset {
  const sorted = [...files.keys()].filter(isBundlePath).sort();
  return {
    format: PRESET_FORMAT,
    name: name.trim(),
    created: now.toISOString(),
    pluginVersion,
    files: Object.fromEntries(sorted.map((p) => [p, files.get(p) as string])),
  };
}

export function serialisePreset(p: Preset): string {
  return JSON.stringify(p, null, 2) + '\n';
}

export type ParsedPreset = { ok: true; preset: Preset } | { ok: false; error: string };

export function parsePreset(text: string): ParsedPreset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The preset file is not valid JSON.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'The preset file has the wrong shape.' };
  const r = raw as Record<string, unknown>;
  if (typeof r.format !== 'number' || r.format > PRESET_FORMAT) return { ok: false, error: 'The preset was made by a newer version of Rubric.' };
  if (typeof r.name !== 'string' || r.name.trim() === '') return { ok: false, error: 'The preset has no name.' };
  if (typeof r.files !== 'object' || r.files === null || Array.isArray(r.files)) return { ok: false, error: 'The preset has no files.' };
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(r.files)) {
    if (typeof content !== 'string') return { ok: false, error: `File "${path}" in the preset is not text.` };
    if (!isBundlePath(path)) return { ok: false, error: `The preset names a file that is not allowed: "${path}".` };
    files[path] = content;
  }
  return {
    ok: true,
    preset: {
      format: r.format,
      name: r.name.trim(),
      created: typeof r.created === 'string' ? r.created : '',
      pluginVersion: typeof r.pluginVersion === 'string' ? r.pluginVersion : '',
      files,
    },
  };
}

/** The name of a preset's file (without extension): lower case, letters and digits, accents folded. */
export function presetSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug === '' ? 'preset' : slug;
}

export interface BundleDiff {
  added: string[];
  changed: string[];
  removed: string[];
  same: string[];
}

/** What turning `current` into `target` would do, file by file. */
export function diffFiles(current: ReadonlyMap<string, string>, target: ReadonlyMap<string, string>): BundleDiff {
  const out: BundleDiff = { added: [], changed: [], removed: [], same: [] };
  for (const [path, text] of target) {
    const have = current.get(path);
    if (have === undefined) out.added.push(path);
    else if (have === text) out.same.push(path);
    else out.changed.push(path);
  }
  for (const path of current.keys()) if (!target.has(path)) out.removed.push(path);
  for (const list of Object.values(out)) list.sort();
  return out;
}

export function isNoChange(d: BundleDiff): boolean {
  return d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0;
}

const lineCount = (s: string) => (s === '' ? 0 : s.split('\n').length - (s.endsWith('\n') ? 1 : 0));

/** Preview lines for the confirmation window. */
export function describeDiff(d: BundleDiff, current: ReadonlyMap<string, string>, target: ReadonlyMap<string, string>): { heading: string; lines: string[] }[] {
  return [
    { heading: `Added (${d.added.length})`, lines: d.added.map((p) => `+ ${p}  (${lineCount(target.get(p) ?? '')} lines)`) },
    { heading: `Changed (${d.changed.length})`, lines: d.changed.map((p) => `~ ${p}  (${lineCount(current.get(p) ?? '')} → ${lineCount(target.get(p) ?? '')} lines)`) },
    { heading: `Removed (${d.removed.length})`, lines: d.removed.map((p) => `- ${p}`) },
  ];
}
