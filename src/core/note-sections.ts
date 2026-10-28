/**
 * The structure of a note's body: lines, regions that are not prose (fences, math, comments) and the heading tree.
 * What counts as a heading follows Obsidian's own metadata cache (D-82). Pure; no Obsidian types.
 * Line numbers are 0-based and count from the first line of the *file*, so `firstLine` is the number of frontmatter lines.
 */

export interface LineIndex {
  lines: string[];
  /** Offset of each line's first character in the text. */
  starts: number[];
}

/** Lines without their line endings (LF or CRLF). A final line ending does not make an extra empty line. */
export function indexLines(text: string): LineIndex {
  const lines: string[] = [];
  const starts: number[] = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl < 0 ? text.length : nl;
    starts.push(pos);
    lines.push(text.slice(pos, end > pos && text.charAt(end - 1) === '\r' ? end - 1 : end));
    if (nl < 0) break;
    pos = nl + 1;
  }
  return { lines, starts };
}

export type RegionKind = 'fence' | 'math' | 'comment';

/** A stretch of lines that is not prose: a code fence, a `$$` math block or a `%%` comment, delimiter lines included. */
export interface Region {
  kind: RegionKind;
  id: number;
}

export interface Section {
  level: number;
  text: string;
  /** The heading's own line (for a setext heading, its text line). */
  line: number;
  /** The first line after the heading. */
  contentStart: number;
  /** End (exclusive) of the section's own text: the first sub-heading, or `end`. */
  ownEnd: number;
  /** End (exclusive) of the whole section: the next heading of the same or a shallower level, or the end of the note. */
  end: number;
  parent: Section | null;
  children: Section[];
}

export interface SectionTree {
  roots: Section[];
  /** Every section in document order. */
  flat: Section[];
  firstLine: number;
  lineCount: number;
  /** The region a (file) line is in, or null for prose. */
  regionAt(line: number): Region | null;
  /** The region still open after the last line (an unclosed fence runs to the end of the note), or null. */
  unclosed: Region | null;
}

type Kind = 'blank' | 'text' | 'heading' | 'other';

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const SETEXT = /^ {0,3}(=+|-{2,})[ \t]*$/;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCK_START = /^(?: {0,3}>|[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$))/;
const INDENTED = /^(?: {4}|\t)/;

const countOf = (line: string, token: string): number => line.split(token).length - 1;

function atxText(content: string): string {
  const t = content.trim();
  if (/^#+$/.test(t)) return '';
  return t.replace(/[ \t]+#+$/, '').trim();
}

interface Heading {
  level: number;
  text: string;
  line: number;
  contentStart: number;
}

export function parseSections(lines: string[], firstLine = 0): SectionTree {
  const regions: (Region | null)[] = lines.map(() => null);
  const kinds: Kind[] = [];
  const headings: Heading[] = [];
  let nextId = 1;
  let open: { region: Region; fenceChar: string; fenceLen: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    kinds.push('other');

    if (open) {
      regions[i] = open.region;
      let closes = false;
      if (open.region.kind === 'fence') {
        const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
        closes = !!m && (m[1] ?? '').charAt(0) === open.fenceChar && (m[1] ?? '').length >= open.fenceLen;
      } else {
        closes = countOf(line, open.region.kind === 'math' ? '$$' : '%%') % 2 === 1;
      }
      if (closes) open = null;
      continue;
    }

    if (line.trim() === '') {
      kinds[i] = 'blank';
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence && !(((fence[1] ?? '').charAt(0) === '`') && (fence[2] ?? '').includes('`'))) {
      const region: Region = { kind: 'fence', id: nextId++ };
      regions[i] = region;
      open = { region, fenceChar: (fence[1] ?? '').charAt(0), fenceLen: (fence[1] ?? '').length };
      continue;
    }
    if (/^[ \t]*\$\$/.test(line) && countOf(line, '$$') % 2 === 1) {
      const region: Region = { kind: 'math', id: nextId++ };
      regions[i] = region;
      open = { region, fenceChar: '', fenceLen: 0 };
      continue;
    }

    if (INDENTED.test(line)) {
      // Indented code, or a nested list item or continuation: never a heading.
    } else {
      const atx = ATX.exec(line);
      const setext = SETEXT.exec(line);
      if (atx) {
        headings.push({ level: (atx[1] ?? '').length, text: atxText(atx[2] ?? ''), line: i, contentStart: i + 1 });
        kinds[i] = 'heading';
      } else if (setext && kinds[i - 1] === 'text' && kinds[i - 2] !== 'text') {
        headings.push({ level: (setext[1] ?? '').startsWith('=') ? 1 : 2, text: (lines[i - 1] ?? '').trim(), line: i - 1, contentStart: i + 1 });
        kinds[i - 1] = 'heading';
        kinds[i] = 'heading';
      } else if (!THEMATIC.test(line) && !BLOCK_START.test(line)) {
        kinds[i] = 'text';
      }
    }

    // A comment that starts on this line runs until its closing `%%`.
    if (countOf(line, '%%') % 2 === 1) {
      const region: Region = { kind: 'comment', id: nextId++ };
      if (line.trimStart().startsWith('%%')) regions[i] = region;
      open = { region, fenceChar: '', fenceLen: 0 };
    }
  }

  const flat: Section[] = headings.map((h) => ({ ...h, ownEnd: lines.length, end: lines.length, parent: null, children: [] }));
  const roots: Section[] = [];
  const stack: Section[] = [];
  for (const s of flat) {
    while (stack.length > 0 && (stack[stack.length - 1] as Section).level >= s.level) {
      (stack.pop() as Section).end = s.line;
    }
    const parent = stack[stack.length - 1] ?? null;
    s.parent = parent;
    (parent ? parent.children : roots).push(s);
    stack.push(s);
  }
  for (const s of flat) s.ownEnd = s.children[0]?.line ?? s.end;

  const shift = (s: Section) => {
    s.line += firstLine;
    s.contentStart += firstLine;
    s.ownEnd += firstLine;
    s.end += firstLine;
  };
  flat.forEach(shift);
  return {
    roots,
    flat,
    firstLine,
    lineCount: lines.length,
    regionAt: (line) => regions[line - firstLine] ?? null,
    unclosed: open ? open.region : null,
  };
}

export interface ListInfo {
  /** 0 for a top-level item. A tab counts as one level; spaces count `tabSize` to a level. */
  depth: number;
  /** `-`, `*`, `+`, `1.` or `1)`. */
  marker: string;
  task: boolean;
}

/** The list item a line starts, from the line's own marker only (a continuation line is not an item). The marker must be followed by a space. */
export function listInfo(lineText: string, tabSize = 4): ListInfo | null {
  const m = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(\[[^\]]\])?|$)/.exec(lineText);
  if (!m) return null;
  let columns = 0;
  for (const ch of m[1] ?? '') columns += ch === '\t' ? tabSize : 1;
  return { depth: Math.floor(columns / Math.max(1, tabSize)), marker: m[2] ?? '', task: m[3] !== undefined };
}
