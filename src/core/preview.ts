import type { KeyChange } from './frontmatter';

/** A value as it would read in the note, shortened for a preview. */
export function formatValue(v: unknown): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/** One line per changed property: `+ key: value`, `key: old → new`, `- key: value`. */
export function describeChanges(changes: KeyChange[]): string[] {
  return changes.map((c) => {
    if (c.before === undefined) return `+ ${c.key}: ${formatValue(c.after)}`;
    if (c.after === undefined) return `- ${c.key}: ${formatValue(c.before)}`;
    return `${c.key}: ${formatValue(c.before)} → ${formatValue(c.after)}`;
  });
}
