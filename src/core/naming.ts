/**
 * Obsidian names a new note "Untitled" (or "Untitled 1" and so on) and lets you type the real name afterwards.
 * Names for the default in the languages Obsidian is commonly used in.
 */
const DEFAULT_NAMES =
  /^(untitled|sans titre|unbenannt|sin t[ií]tulo|senza titolo|sem t[ií]tulo|без названия|無題|无标题|제목 없음|naamloos|bez tytułu|namnlös|uten tittel)( \d+)?$/iu;

export function isDefaultNoteName(basename: string): boolean {
  return DEFAULT_NAMES.test(basename.trim());
}

/** How long a note still named by default is waited for before it is treated as finished (ms). */
export const NAMING_PATIENCE_MS = 120_000;

/**
 * Is the user probably still naming this note? Yes while its title field has focus, or while it is the open note
 * and still carries the default name (they have not typed the real name yet).
 */
export function stillBeingNamed(o: { isActive: boolean; titleFocused: boolean; basename: string }): boolean {
  if (!o.isActive) return false;
  return o.titleFocused || isDefaultNoteName(o.basename);
}
