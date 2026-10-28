/**
 * Body handlers: small pieces of code that react to a key in the body of a note. This file is the registry and the
 * rules for when a handler may run; the editor extension in `src/obsidian/body-editor.ts` only feeds it keys and
 * applies what comes back. No handler ships yet. Pure; no Obsidian or CodeMirror types.
 */
import type { BodyGate, GateRefusal } from './body-gate';
import { detectEol } from './frontmatter';
import { indexLines, listInfo, parseSections } from './note-sections';
import type { ListInfo, Region } from './note-sections';
import { splitNote } from './note-text';

/** The keys a handler may claim. Backspace and Delete are left out on purpose: they remove text. */
export const BODY_KEYS = ['Enter', 'Tab', 'Shift-Tab'] as const;
export type BodyKey = (typeof BODY_KEYS)[number];

/** A change in document offsets, all relative to the document as it was when the key was pressed. */
export interface BodyChange {
  from: number;
  to: number;
  insert: string;
}

/** What a handler uses to say what to do. Everything it records becomes one editor transaction: one undo step. */
export interface BodyTx {
  /** Insert text at a document offset (default: the cursor). Existing text is not touched. */
  insert(text: string, at?: number): void;
  /** Insert whole lines on a new line after line `line` (0-based, whole file). */
  insertAfterLine(line: number, text: string): void;
  /** Replace or delete existing text. Throws unless the handler was registered with `mayRewrite: true`. */
  replace(from: number, to: number, text: string): void;
  /** Where the cursor goes afterwards, as an offset in the document before the changes (it is moved with them). */
  setCursor(offset: number): void;
}

export interface BodyKeyContext {
  readonly key: BodyKey;
  readonly path: string;
  /** The note's resolved type. */
  readonly type: { name: string; domain?: string };
  /** 0-based line in the whole file, column and document offset of the cursor. */
  readonly cursor: { line: number; ch: number; offset: number };
  readonly lineText: string;
  readonly selectionEmpty: boolean;
  /** The list item the cursor line starts, or null. */
  readonly list: ListInfo | null;
  /** The innermost section the cursor is in, or null before the first heading. */
  readonly section: { text: string; level: number; line: number } | null;
  readonly doc: { length: number; lineCount: number; lineText(line: number): string; lineStart(line: number): number };
  readonly tx: BodyTx;
}

/** `claim` handles the key (what `tx` recorded is applied, the key goes no further); `pass` leaves it to the next handler and to Obsidian. */
export type BodyOutcome = 'claim' | 'pass';

export interface BodyHandler {
  /** Names the handler in the debug log. Unique. */
  id: string;
  keys: BodyKey[];
  /** The handler may replace or delete existing text with `tx.replace`. Default: it may only insert. */
  mayRewrite?: boolean;
  handle(ctx: BodyKeyContext): BodyOutcome;
}

export class BodyHandlerRegistry {
  private readonly handlers: BodyHandler[] = [];

  /** Add a handler; returns the function that removes it. */
  register(handler: BodyHandler): () => void {
    if (this.handlers.some((h) => h.id === handler.id)) throw new Error(`A body handler called "${handler.id}" is already registered`);
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** Does any handler listen to this key? The editor hook asks first, so with none registered a keypress costs one array scan. */
  listensTo(key: BodyKey): boolean {
    return this.handlers.some((h) => h.keys.includes(key));
  }

  /** In registration order. */
  forKey(key: BodyKey): readonly BodyHandler[] {
    return this.handlers.filter((h) => h.keys.includes(key));
  }

  get size(): number {
    return this.handlers.length;
  }
}

export interface KeyInput {
  key: BodyKey;
  path: string;
  /** IME composition is in progress. */
  composing: boolean;
  /** More than one cursor or selection: handlers are not run. */
  multipleSelections: boolean;
  /** Called only once a handler listens to the key and nothing else has said no. */
  gate(): BodyGate;
  /** The whole note text. Called lazily, after the gate. */
  text(): string;
  /** The main selection, as document offsets. */
  selection: { anchor: number; head: number };
  /** Spaces per list level, for `list.depth`. */
  tabSize: number;
  log?: (message: string) => void;
}

export type SkipReason = 'no-handler' | 'composing' | 'multiple-selections' | GateRefusal | 'frontmatter' | 'in-region' | 'all-passed' | 'failed';

export type KeyResult =
  | { claimed: false; reason: SkipReason }
  | { claimed: true; handler: string; changes: BodyChange[]; cursor: number | null };

/** What can be known about the cursor's place in a note. Exported for tests. */
export function locateCursor(text: string, offset: number, tabSize: number) {
  const parts = splitNote(text);
  const all = indexLines(text);
  let line = 0;
  for (let i = 0; i < all.starts.length; i++) {
    if ((all.starts[i] ?? 0) <= offset) line = i;
    else break;
  }
  const firstBodyLine = parts.frontmatter === '' ? 0 : parts.frontmatter.split('\n').length - 1;
  const body = indexLines(parts.body);
  const tree = parseSections(body.lines, firstBodyLine);
  const lineText = all.lines[line] ?? '';
  const region: Region | null = line >= firstBodyLine ? tree.regionAt(line) : null;
  // A lone byte order mark in front of a note with no frontmatter is not frontmatter.
  const inFrontmatter = parts.frontmatter.replace('\ufeff', '') !== '' && offset < parts.frontmatter.length;
  // The innermost section: the last heading at or above the cursor line whose extent still covers it.
  let section: BodyKeyContext['section'] = null;
  for (const s of tree.flat) {
    if (s.line <= line && line < s.end && (!section || s.level >= section.level)) section = { text: s.text, level: s.level, line: s.line };
  }
  return {
    line,
    ch: offset - (all.starts[line] ?? 0),
    lineText,
    lines: all,
    inFrontmatter,
    region,
    list: listInfo(lineText, tabSize),
    section,
    eol: detectEol(text),
    length: text.length,
  };
}

class CollectingTx implements BodyTx {
  readonly changes: BodyChange[] = [];
  cursor: number | null = null;
  constructor(
    private readonly at: number,
    private readonly mayRewrite: boolean,
    private readonly text: string,
    private readonly lines: { lines: string[]; starts: number[] },
    private readonly eol: string,
  ) {}

  insert(text: string, at = this.at): void {
    this.changes.push({ from: at, to: at, insert: text });
  }

  insertAfterLine(line: number, text: string): void {
    const norm = text.replace(/\r?\n/g, this.eol);
    const next = this.lines.starts[line + 1];
    if (next !== undefined) {
      this.changes.push({ from: next, to: next, insert: norm.endsWith(this.eol) ? norm : norm + this.eol });
    } else {
      const end = this.text.length;
      this.changes.push({ from: end, to: end, insert: (this.text === '' || this.text.endsWith('\n') ? '' : this.eol) + norm });
    }
  }

  replace(from: number, to: number, text: string): void {
    if (!this.mayRewrite) throw new Error('This handler was not registered with mayRewrite, so it may only insert');
    this.changes.push({ from, to, insert: text });
  }

  setCursor(offset: number): void {
    this.cursor = offset;
  }
}

/** Changes must lie inside the document, not overlap, and (unless the handler may rewrite) only insert. */
function validChanges(changes: BodyChange[], length: number, mayRewrite: boolean): boolean {
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let end = 0;
  for (const c of sorted) {
    if (c.from < 0 || c.to < c.from || c.to > length) return false;
    if (!mayRewrite && c.to !== c.from) return false;
    if (c.from < end) return false;
    end = c.to;
  }
  return true;
}

/**
 * Decide whether a key reaches a handler and run the handlers. In order: a handler listens to the key, no IME
 * composition, one cursor, the gate (both switches, scope, a type that opted in), the cursor is in the body and not in
 * a fence, math block or comment. The first handler to `claim` wins. A handler that throws, or whose edits are
 * invalid, is logged and counts as a pass: nothing it recorded is applied.
 */
export function handleBodyKey(registry: BodyHandlerRegistry, input: KeyInput): KeyResult {
  const handlers = registry.forKey(input.key);
  if (handlers.length === 0) return { claimed: false, reason: 'no-handler' };
  if (input.composing) return { claimed: false, reason: 'composing' };
  if (input.multipleSelections) return { claimed: false, reason: 'multiple-selections' };
  const gate = input.gate();
  if (!gate.allowed) return { claimed: false, reason: gate.reason };

  const text = input.text();
  const at = locateCursor(text, input.selection.head, input.tabSize);
  if (at.inFrontmatter) return { claimed: false, reason: 'frontmatter' };
  if (at.region) return { claimed: false, reason: 'in-region' };

  let failed = false;
  for (const handler of handlers) {
    const tx = new CollectingTx(input.selection.head, handler.mayRewrite === true, text, at.lines, at.eol);
    const ctx: BodyKeyContext = {
      key: input.key,
      path: input.path,
      type: { name: gate.type.name, ...(gate.type.domain !== undefined ? { domain: gate.type.domain } : {}) },
      cursor: { line: at.line, ch: at.ch, offset: input.selection.head },
      lineText: at.lineText,
      selectionEmpty: input.selection.anchor === input.selection.head,
      list: at.list,
      section: at.section,
      doc: {
        length: at.length,
        lineCount: at.lines.lines.length,
        lineText: (n) => at.lines.lines[n] ?? '',
        lineStart: (n) => at.lines.starts[n] ?? at.length,
      },
      tx,
    };
    try {
      if (handler.handle(ctx) !== 'claim') continue;
    } catch (e) {
      input.log?.(`handler ${handler.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      failed = true;
      continue;
    }
    if (!validChanges(tx.changes, at.length, handler.mayRewrite === true) || (tx.cursor !== null && (tx.cursor < 0 || tx.cursor > at.length))) {
      input.log?.(`handler ${handler.id} returned edits that are not allowed and they were dropped`);
      failed = true;
      continue;
    }
    return { claimed: true, handler: handler.id, changes: tx.changes, cursor: tx.cursor };
  }
  return { claimed: false, reason: failed ? 'failed' : 'all-passed' };
}
