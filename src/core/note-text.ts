/** Split a note into its frontmatter block and its body, and join them again. Pure; no Obsidian types. */
import { detectEol, split } from './frontmatter';
import type { Eol } from './frontmatter';

export interface NoteParts {
  /** Everything before the body, byte for byte: the BOM, the opening `---`, the YAML and the closing line with its line ending. Empty when the note has no frontmatter. */
  frontmatter: string;
  /** Everything after it. A note with no frontmatter is all body. */
  body: string;
  /** The first line ending in the whole note (LF when there is none). New lines written into the body use it. */
  eol: Eol;
}

/** `joinNote(splitNote(text))` is always `text`. */
export function splitNote(text: string): NoteParts {
  const eol = detectEol(text);
  const s = split(text);
  if (!s) {
    // A BOM belongs to the front of the file, not to the first line of the body.
    return text.charAt(0) === '﻿' ? { frontmatter: '﻿', body: text.slice(1), eol } : { frontmatter: '', body: text, eol };
  }
  const nl = s.tail.indexOf('\n');
  const closeEnd = nl < 0 ? s.tail.length : nl + 1;
  return { frontmatter: s.head + s.yaml + s.tail.slice(0, closeEnd), body: s.tail.slice(closeEnd), eol };
}

export function joinNote(parts: Pick<NoteParts, 'frontmatter' | 'body'>): string {
  return parts.frontmatter + parts.body;
}
