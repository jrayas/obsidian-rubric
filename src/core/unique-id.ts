/**
 * The domain-level unique ID: TYPE-DOMAIN-YEAR-NNNN, for example `KB-PH-2026-0001`. It sits beside `id`, which stays the
 * one global identity (`KB-2026-0001`, never changes, what links should rely on). `unique_id` is a readable label with
 * its own counter per type, domain and year. It names the note's type and domain, so it is issued again when either
 * changes; the old value is kept in `archived_fields` and never handed out again. Pure; no Obsidian types.
 *
 * The property is called `unique_id` and each domain's two-letter prefix is declared on the `domain` property
 * (`prefixes: { physics: PH }`). Prefixes are declared, not derived from the word, because physics and philosophy would
 * both be `PH`. A domain with no prefix gets no unique ID.
 */
import { findDuplicates } from './ids';
import type { IdNote } from './ids';
import type { Frontmatter } from './frontmatter';
import { ARCHIVED_FIELDS } from './schema-types';
import type { ResolvedType } from './schema-types';
import { formatLocalDate } from './timestamps';

export const UNIQUE_ID = 'unique_id';

const PATTERN = /^([A-Z]{2})-([A-Z]{2})-(\d{4})-(\d{4,})$/;

export interface ParsedUniqueId {
  typePrefix: string;
  domainPrefix: string;
  year: number;
  num: number;
}

export function parseUniqueId(value: unknown): ParsedUniqueId | null {
  const m = typeof value === 'string' ? PATTERN.exec(value) : null;
  if (!m) return null;
  return { typePrefix: m[1] as string, domainPrefix: m[2] as string, year: Number(m[3]), num: Number(m[4]) };
}

export function formatUniqueId(typePrefix: string, domainPrefix: string, year: number, num: number): string {
  return `${typePrefix}-${domainPrefix}-${year}-${String(num).padStart(4, '0')}`;
}

/** What a note's unique ID is made from: its type's prefix and its domain's prefix. */
export interface UniqueScope {
  typePrefix: string;
  domainPrefix: string;
  domain: string;
}

/** The two-letter prefix declared for a domain on the type's `domain` property, if any. */
export function domainPrefixOf(type: ResolvedType, domain: unknown): string | undefined {
  return typeof domain === 'string' ? type.byName.get('domain')?.prefixes?.[domain] : undefined;
}

/** The scope for a note, or null when its type has no `unique_id` or its domain has no prefix. */
export function uniqueScope(type: ResolvedType, domain: unknown): UniqueScope | null {
  if (!type.byName.has(UNIQUE_ID) || typeof domain !== 'string') return null;
  const domainPrefix = domainPrefixOf(type, domain);
  return domainPrefix ? { typePrefix: type.prefix, domainPrefix, domain } : null;
}

/** One more than the highest number used for this type, domain and year. `retired` values count as used. */
export function nextUniqueNumber(typePrefix: string, domainPrefix: string, year: number, used: Iterable<string>, retired: Iterable<string> = []): number {
  let max = 0;
  for (const value of [...used, ...retired]) {
    const p = parseUniqueId(value);
    if (p && p.typePrefix === typePrefix && p.domainPrefix === domainPrefix && p.year === year && p.num > max) max = p.num;
  }
  return max + 1;
}

export function nextUniqueId(typePrefix: string, domainPrefix: string, year: number, used: Iterable<string>, retired: Iterable<string> = []): string {
  return formatUniqueId(typePrefix, domainPrefix, year, nextUniqueNumber(typePrefix, domainPrefix, year, used, retired));
}

/** Allocates one unique ID for a type prefix, domain prefix and year. */
export type AllocateUnique = (typePrefix: string, domainPrefix: string, year: number) => string;

export interface UniqueIdChange {
  /** The unique ID the note should carry. */
  to: string;
  /** The value it replaces (kept in `archived_fields`); absent when the note had none. */
  from?: string;
}

/**
 * What the note's unique ID should become, or null when nothing needs to change: the type has no `unique_id`, the
 * domain has no prefix, the note's value already names its type and domain, or its value is not a unique ID at all
 * (a malformed value is reported by the vault check and never overwritten).
 */
export function planUniqueId(fm: Frontmatter, type: ResolvedType, allocate: AllocateUnique, year: number): UniqueIdChange | null {
  const scope = uniqueScope(type, fm.domain);
  if (!scope) return null;
  const current = fm[UNIQUE_ID];
  if (current === undefined || current === null || current === '') return { to: allocate(scope.typePrefix, scope.domainPrefix, year) };
  const parsed = parseUniqueId(current);
  if (!parsed) return null;
  if (parsed.typePrefix === scope.typePrefix && parsed.domainPrefix === scope.domainPrefix) return null;
  return { to: allocate(scope.typePrefix, scope.domainPrefix, year), from: current as string };
}

/** Write a planned change: the new value, and the old one into `archived_fields` (nothing is deleted). */
export function applyUniqueId(draft: Frontmatter, change: UniqueIdChange, type: ResolvedType, now: Date): void {
  draft[UNIQUE_ID] = change.to;
  if (change.from === undefined) return;
  const entry = { type: type.name, date: formatLocalDate(now), values: { [UNIQUE_ID]: change.from } };
  const existing = draft[ARCHIVED_FIELDS];
  draft[ARCHIVED_FIELDS] = Array.isArray(existing) ? [...(existing as unknown[]), entry] : existing ? [existing, entry] : [entry];
}

export interface UniqueRenumber {
  path: string;
  from: string;
  to: string;
}

/**
 * The older note in each group sharing a unique ID keeps it; every newer note gets the next free number for its type,
 * domain and year, one after another so two renumbered notes never share a number.
 */
export function planUniqueRenumbering(notes: IdNote[], retired: Iterable<string> = [], alsoUsed: Iterable<string> = []): UniqueRenumber[] {
  const used = new Set([...notes.map((n) => n.id), ...alsoUsed]);
  const gone = new Set(retired);
  const out: UniqueRenumber[] = [];
  for (const group of findDuplicates(notes)) {
    for (const note of group.slice(1)) {
      const p = parseUniqueId(note.id);
      if (!p) continue;
      const to = nextUniqueId(p.typePrefix, p.domainPrefix, p.year, used, gone);
      used.add(to);
      out.push({ path: note.path, from: note.id, to });
    }
  }
  return out;
}
