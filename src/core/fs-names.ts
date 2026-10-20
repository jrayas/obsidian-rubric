import { nameKey } from './normalise';

const ILLEGAL = /[\\/:*?"<>|]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * A message when `name` cannot be a file name on both macOS and Windows, otherwise null.
 * The union of the two rules: no / \ : * ? " < > | or control characters, no trailing dot or space,
 * no Windows device names, not empty.
 */
export function checkFileName(name: string): string | null {
  if (name.trim().length === 0) return 'A name is required.';
  const bad = ILLEGAL.exec(name);
  if (bad) return `"${bad[0]}" is not allowed in a file name on macOS or Windows.`;
  if ([...name].some((c) => c.charCodeAt(0) < 32)) return 'Control characters are not allowed in a file name on macOS or Windows.';
  if (/[. ]$/.test(name)) return 'A file name cannot end with a dot or a space (Windows).';
  if (RESERVED.test(name)) return `"${name}" is a reserved name on Windows.`;
  if (name.length > 200) return 'The name is too long.';
  return null;
}

/** Groups of folder names that differ only by case (they collide on Windows and in default macOS volumes). */
export function caseCollisions(folders: string[]): string[][] {
  const byKey = new Map<string, Set<string>>();
  for (const f of folders) {
    const key = f.toLowerCase();
    const set = byKey.get(key) ?? new Set<string>();
    set.add(f);
    byKey.set(key, set);
  }
  return [...byKey.values()].filter((s) => s.size > 1).map((s) => [...s].sort());
}

/** Folder names that are equal once accents and case are ignored but not identical (typed on another system). */
export function accentVariants(folders: string[]): string[][] {
  const byKey = new Map<string, Set<string>>();
  for (const f of folders) {
    const set = byKey.get(nameKey(f)) ?? new Set<string>();
    set.add(f);
    byKey.set(nameKey(f), set);
  }
  return [...byKey.values()].filter((s) => s.size > 1).map((s) => [...s].sort());
}
