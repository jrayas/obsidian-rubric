/**
 * Timed entries: in a note whose type has `body: { enabled: true, entry: "- {time}" }`, pressing Enter in the body
 * starts a new line that begins with the entry text and the current time (HH:mm), so every line is an entry.
 * Pure: no Obsidian or CodeMirror types; the clock and the lookup of the type's `entry` are passed in.
 */
import { ENTRY_TIME_TOKEN } from './body-config';
import type { BodyHandler, BodyKeyContext, BodyOutcome } from './body-handlers';

export const ENTRY_HANDLER_ID = 'timed-entry';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local time as HH:mm. */
export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What a new entry line starts with: the template with the time filled in, ending in one space. */
export function entryPrefix(template: string, now: Date): string {
  const text = template.split(ENTRY_TIME_TOKEN).join(formatTime(now));
  return /\s$/.test(text) ? text : `${text} `;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches the start of an entry line made from `template`, with any time, plus the spaces after it. */
export function entryStart(template: string): RegExp {
  const source = template
    .trimEnd()
    .split(ENTRY_TIME_TOKEN)
    .map(escapeRegExp)
    .join('\\d{2}:\\d{2}');
  return new RegExp(`^${source}[ \\t]*`);
}

export interface EntryHandlerOptions {
  /** The `entry` template of the note's type, or null when it has none. */
  entryFor(path: string): string | null;
  now(): Date;
}

/** Enter on a line that Obsidian should keep handling itself: a different kind of list, a quote, a table, a blank line. */
function leaveToObsidian(ctx: BodyKeyContext): boolean {
  if (!ctx.selectionEmpty) return true;
  const text = ctx.lineText;
  if (text.trim() === '') return true; // Enter on a blank line makes a blank line: the way out of the entries
  if (/^\s*(>|\|)/.test(text)) return true; // quote and table rows
  if (ctx.list) {
    if (ctx.list.depth > 0 || ctx.list.task || !/^[-*+]$/.test(ctx.list.marker)) return true; // sub-bullets, tasks, numbers
    const marker = /^[ \t]*[-*+][ \t]*/.exec(text);
    if (!marker || text.slice(marker[0].length).trim() === '') return true; // an empty bullet: Obsidian ends the list
  }
  return false;
}

export function makeEntryHandler(options: EntryHandlerOptions): BodyHandler {
  return {
    id: ENTRY_HANDLER_ID,
    keys: ['Enter'],
    mayRewrite: true, // an entry with nothing after its time is removed, which ends the list
    handle(ctx: BodyKeyContext): BodyOutcome {
      const template = options.entryFor(ctx.path);
      if (!template) return 'pass';
      if (leaveToObsidian(ctx)) return 'pass';

      const start = entryStart(template).exec(ctx.lineText);
      if (start) {
        // Cursor inside the "- 14:05 " part: the key moves the line down, as usual.
        if (ctx.cursor.ch < start[0].length) return 'pass';
        // An entry with only a time, Enter at its end: drop it and leave a blank line.
        if (ctx.lineText.slice(start[0].length).trim() === '' && ctx.cursor.ch >= ctx.lineText.trimEnd().length) {
          const from = ctx.cursor.offset - ctx.cursor.ch;
          ctx.tx.replace(from, from + ctx.lineText.length, '');
          ctx.tx.setCursor(from);
          return 'claim';
        }
      } else if (ctx.cursor.ch === 0) {
        return 'pass'; // Enter at the very start of a line pushes it down
      } else if (ctx.list) {
        const marker = /^[ \t]*[-*+][ \t]*/.exec(ctx.lineText);
        if (marker && ctx.cursor.ch < marker[0].length) return 'pass';
      }

      ctx.tx.insert(`\n${entryPrefix(template, options.now())}`);
      ctx.tx.setCursor(ctx.cursor.offset);
      return 'claim';
    },
  };
}
