/** Pure edits of a note's body text. Existing text is never changed; text is only inserted. No Obsidian types. */
import { detectEol } from './frontmatter';
import type { Eol } from './frontmatter';
import { indexLines, parseSections } from './note-sections';
import type { Section, SectionTree } from './note-sections';

/** Where text goes relative to a section. All four insert whole lines. */
export type InsertPosition = 'start' | 'end' | 'after' | 'before';

/** A heading by its text, optionally with its level (`'## Notes'` also works) and which one when several match (1 = first). */
export type HeadingRef = string | { text: string; level?: number; nth?: number };

export type HeadingMiss = 'heading-not-found' | 'heading-ambiguous';
export type InsertFailure = HeadingMiss | 'inside-code';

export type InsertResult = { ok: true; body: string; changed: boolean } | { ok: false; reason: InsertFailure };

export function findSection(tree: SectionTree, ref: HeadingRef): { ok: true; section: Section } | { ok: false; reason: HeadingMiss } {
  let text: string;
  let level: number | undefined;
  let nth: number | undefined;
  if (typeof ref === 'string') {
    const m = /^(#{1,6})[ \t]+(.*)$/.exec(ref.trim());
    text = (m ? m[2] : ref) ?? '';
    level = m ? (m[1] ?? '').length : undefined;
  } else {
    text = ref.text;
    level = ref.level;
    nth = ref.nth;
  }
  text = text.trim();
  const hits = tree.flat.filter((s) => s.text === text && (level === undefined || s.level === level));
  if (hits.length === 0) return { ok: false, reason: 'heading-not-found' };
  if (nth !== undefined) {
    const hit = hits[nth - 1];
    return hit ? { ok: true, section: hit } : { ok: false, reason: 'heading-not-found' };
  }
  const first = hits[0];
  return hits.length > 1 || !first ? { ok: false, reason: 'heading-ambiguous' } : { ok: true, section: first };
}

/** The line to insert before: after the last non-blank line in [from, to), so blank lines that separate sections stay where they are. */
function afterLastContent(lines: string[], from: number, to: number): number {
  for (let i = to - 1; i >= from; i--) if ((lines[i] ?? '').trim() !== '') return i + 1;
  return from;
}

/**
 * Insert `text` (whole lines) at a position relative to a heading. `eol` is the note's line ending for the new lines.
 * Nothing else in the body is touched, not even its line endings. Empty text changes nothing.
 */
export function insertIntoBody(body: string, ref: HeadingRef, text: string, position: InsertPosition, eol: Eol = detectEol(body)): InsertResult {
  const { lines, starts } = indexLines(body);
  const tree = parseSections(lines, 0);
  const found = findSection(tree, ref);
  if (!found.ok) return found;
  const s = found.section;
  const target =
    position === 'before' ? s.line : position === 'start' ? s.contentStart : position === 'end' ? afterLastContent(lines, s.contentStart, s.ownEnd) : afterLastContent(lines, s.contentStart, s.end);
  // Inside a fence, a math block or a comment the text would become part of it.
  const here = target >= lines.length ? tree.unclosed : tree.regionAt(target);
  const before = target > 0 ? tree.regionAt(target - 1) : null;
  if (here && before && here.id === before.id) return { ok: false, reason: 'inside-code' };
  if (text === '') return { ok: true, body, changed: false };

  const lineText = text.replace(/\r?\n/g, eol);
  const atEnd = target >= lines.length;
  let insert: string;
  let offset: number;
  if (!atEnd) {
    offset = starts[target] ?? body.length;
    insert = lineText.endsWith(eol) ? lineText : lineText + eol;
  } else {
    offset = body.length;
    const lastBreak = body === '' || body.endsWith('\n');
    // The body has no final line ending: the new text starts after one and ends without one, as the body did.
    insert = lastBreak ? (lineText.endsWith(eol) ? lineText : lineText + eol) : eol + (lineText.endsWith(eol) ? lineText.slice(0, -eol.length) : lineText);
  }
  return { ok: true, body: body.slice(0, offset) + insert + body.slice(offset), changed: true };
}

/** How many characters differ between two texts: what was added and what was removed, found from the common start and end. */
export function changeSize(before: string, after: string): { added: number; removed: number } {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endA = before.length;
  let endB = after.length;
  while (endA > start && endB > start && before.charCodeAt(endA - 1) === after.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { added: endB - start, removed: endA - start };
}
