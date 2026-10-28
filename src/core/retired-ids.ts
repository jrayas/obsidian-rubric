/** Reviewing retired IDs: which ones still hold a number back. Pure; no Obsidian types. */
import { formatId, parseId } from './ids';
import { formatUniqueId, parseUniqueId } from './unique-id';

/**
 * What a retired ID does to numbering. The next number is one more than the highest used or retired number for the
 * same type, year (and domain for a unique ID), so a retired ID only matters while it is that highest number.
 */
export type RetiredEffect = 'holds' | 'covered' | 'none';

export interface RetiredEntry {
  id: string;
  effect: RetiredEffect;
  /** One sentence for the settings list. */
  detail: string;
}

interface Slot {
  key: string;
  num: number;
  format: (n: number) => string;
}

function slotOf(id: string): Slot | null {
  const p = parseId(id);
  if (p) return { key: `id|${p.prefix}|${p.year}`, num: p.num, format: (n) => formatId(p.prefix, p.year, n) };
  const u = parseUniqueId(id);
  if (u) return { key: `uid|${u.typePrefix}|${u.domainPrefix}|${u.year}`, num: u.num, format: (n) => formatUniqueId(u.typePrefix, u.domainPrefix, u.year, n) };
  return null;
}

/** One entry per retired ID, in ID order. `usedIds` are the `id` and `unique_id` values in the vault right now. */
export function reviewRetired(retired: readonly string[], usedIds: Iterable<string>): RetiredEntry[] {
  const maxUsed = new Map<string, number>();
  for (const id of usedIds) {
    const s = slotOf(id);
    if (s && s.num > (maxUsed.get(s.key) ?? 0)) maxUsed.set(s.key, s.num);
  }
  // The retired numbers per slot, highest first.
  const retiredBy = new Map<string, number[]>();
  for (const id of new Set(retired)) {
    const s = slotOf(id);
    if (s) retiredBy.set(s.key, [...(retiredBy.get(s.key) ?? []), s.num].sort((a, b) => b - a));
  }

  return [...new Set(retired)]
    .sort()
    .map((id): RetiredEntry => {
      const s = slotOf(id);
      if (!s) return { id, effect: 'none', detail: 'Not a readable ID, so it does not affect numbering.' };
      const used = maxUsed.get(s.key) ?? 0;
      const top = retiredBy.get(s.key)?.[0] ?? 0;
      if (s.num <= used) return { id, effect: 'covered', detail: 'No effect on numbering: a note already uses an equal or higher number.' };
      if (s.num < top) return { id, effect: 'covered', detail: 'No effect on numbering: a higher retired number is already holding the next one back.' };
      // It is the highest number in play: releasing it lowers the next number to the next highest.
      const below = Math.max(used, retiredBy.get(s.key)?.[1] ?? 0);
      return { id, effect: 'holds', detail: `Holds the next number back. Releasing it lets ${s.format(below + 1)} be issued again.` };
    });
}
