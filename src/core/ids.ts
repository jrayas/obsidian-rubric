/** Readable IDs: PREFIX-YYYY-NNNN (rule 4). */

export interface ParsedId {
  prefix: string;
  year: number;
  num: number;
}

const NEW_ID = /^([A-Z]{2})-(\d{4})-(\d{4,})$/;
const OLD_ID = /^([A-Z]{2})-(\d{3,})$/;

export function formatId(prefix: string, year: number, num: number): string {
  return `${prefix}-${year}-${String(num).padStart(4, '0')}`;
}

export function parseId(id: unknown): ParsedId | null {
  const m = typeof id === 'string' ? NEW_ID.exec(id) : null;
  if (!m) return null;
  return { prefix: m[1] as string, year: Number(m[2]), num: Number(m[3]) };
}

/** Old style `KB-000142`: prefix and number, no year. */
export function parseOldId(id: unknown): { prefix: string; num: number } | null {
  const m = typeof id === 'string' ? OLD_ID.exec(id) : null;
  if (!m || NEW_ID.test(id as string)) return null;
  return { prefix: m[1] as string, num: Number(m[2]) };
}

/** `KB-000142` with created 2026-... becomes `KB-2026-0142`: the year from `created`, the number kept. */
export function convertOldId(id: string, created: string | undefined): string | null {
  const old = parseOldId(id);
  const year = created ? Number(/^(\d{4})/.exec(created)?.[1]) : NaN;
  if (!old || !Number.isInteger(year)) return null;
  return formatId(old.prefix, year, old.num);
}

/** The year in `created`, or null. */
export function yearOf(created: unknown): number | null {
  const m = typeof created === 'string' ? /^(\d{4})-/.exec(created) : null;
  return m ? Number(m[1]) : null;
}

/**
 * The next free number for a type and year: one more than the highest used.
 * `retired` holds IDs given up by renumbering; they count as used so a renumbered ID is never reused.
 */
export function nextNumber(prefix: string, year: number, used: Iterable<string>, retired: Iterable<string> = []): number {
  let max = 0;
  for (const id of [...used, ...retired]) {
    const p = parseId(id);
    if (p && p.prefix === prefix && p.year === year && p.num > max) max = p.num;
  }
  return max + 1;
}

export function nextId(prefix: string, year: number, used: Iterable<string>, retired: Iterable<string> = []): string {
  return formatId(prefix, year, nextNumber(prefix, year, used, retired));
}

export interface IdNote {
  path: string;
  id: string;
  created?: string;
  /** File creation time in ms, used when two notes have the same `created`. */
  ctime?: number;
}

export interface Renumber {
  path: string;
  from: string;
  to: string;
}

/** Order two notes by age: `created` first, then file creation time, then path. */
function older(a: IdNote, b: IdNote): number {
  const ca = a.created ?? '';
  const cb = b.created ?? '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  const ta = a.ctime ?? 0;
  const tb = b.ctime ?? 0;
  if (ta !== tb) return ta - tb;
  return a.path < b.path ? -1 : 1;
}

/** Groups of notes sharing one ID. */
export function findDuplicates(notes: IdNote[]): IdNote[][] {
  const by = new Map<string, IdNote[]>();
  for (const n of notes) by.set(n.id, [...(by.get(n.id) ?? []), n]);
  return [...by.values()].filter((g) => g.length > 1).map((g) => [...g].sort(older));
}

/**
 * The older note in each duplicate group keeps its ID; every newer note gets the next free number for its
 * prefix and year, allocated one after another so two renumbered notes never share a number.
 */
export function planRenumbering(notes: IdNote[], retired: Iterable<string> = [], alsoUsed: Iterable<string> = []): Renumber[] {
  const used = new Set([...notes.map((n) => n.id), ...alsoUsed]);
  const gone = new Set(retired);
  const out: Renumber[] = [];
  for (const group of findDuplicates(notes)) {
    for (const note of group.slice(1)) {
      const p = parseId(note.id);
      if (!p) continue;
      const to = nextId(p.prefix, p.year, used, gone);
      used.add(to);
      out.push({ path: note.path, from: note.id, to });
    }
  }
  return out;
}
