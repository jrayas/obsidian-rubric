import { describe, expect, it } from 'vitest';
import { entryPrefix, entryStart, formatTime, makeEntryHandler } from '../src/core/body-entry';
import type { BodyGate } from '../src/core/body-gate';
import { BodyHandlerRegistry, handleBodyKey } from '../src/core/body-handlers';
import type { BodyChange, KeyResult } from '../src/core/body-handlers';
import type { ResolvedType } from '../src/core/schema-types';

const TYPE = { name: 'journal', body: { enabled: true, entry: '- {time}' } } as unknown as ResolvedType;
const ALLOWED: BodyGate = { allowed: true, type: TYPE };
const AT_14_09 = new Date(2026, 10, 3, 14, 9, 30);

function registry(template: string | null = '- {time}', now: Date = AT_14_09) {
  const r = new BodyHandlerRegistry();
  r.register(makeEntryHandler({ entryFor: () => template, now: () => now }));
  return r;
}

/** `|` marks the cursor. Returns the key result and the note text after its changes. */
function press(marked: string, opts: { template?: string | null; frontmatter?: string; selectTo?: number } = {}) {
  const at = marked.indexOf('|');
  const text = marked.replace('|', '');
  const result: KeyResult = handleBodyKey(registry(opts.template === undefined ? '- {time}' : opts.template), {
    key: 'Enter',
    path: 'Journal/2026-11-03.md',
    composing: false,
    multipleSelections: false,
    gate: () => ALLOWED,
    text: () => text,
    selection: { anchor: opts.selectTo ?? at, head: at },
    tabSize: 4,
  });
  return { result, after: result.claimed ? apply(text, result.changes, result.cursor) : text };
}

/** Apply changes (all in offsets of the original text) and show the cursor as `|`. */
function apply(text: string, changes: BodyChange[], cursor: number | null): string {
  const sorted = [...changes].sort((a, b) => b.from - a.from);
  let out = text;
  for (const c of sorted) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  if (cursor === null) return out;
  let pos = cursor;
  // A change at or before the cursor moves it; an insert exactly at the cursor puts the cursor after the new text.
  for (const c of changes) if (c.to <= cursor) pos += c.insert.length - (c.to - c.from);
  return `${out.slice(0, pos)}|${out.slice(pos)}`;
}

describe('formatTime and entryPrefix', () => {
  it('writes the local time as HH:mm with leading zeros', () => {
    expect(formatTime(new Date(2026, 0, 1, 7, 5))).toBe('07:05');
    expect(formatTime(new Date(2026, 0, 1, 23, 59))).toBe('23:59');
    expect(formatTime(new Date(2026, 0, 1, 0, 0))).toBe('00:00');
  });

  it('fills the time and always ends with one space', () => {
    expect(entryPrefix('- {time}', AT_14_09)).toBe('- 14:09 ');
    expect(entryPrefix('- {time} ', AT_14_09)).toBe('- 14:09 ');
    expect(entryPrefix('* **{time}** -', AT_14_09)).toBe('* **14:09** - ');
  });

  it('recognises an entry written from the template, with any time', () => {
    expect(entryStart('- {time}').exec('- 10:03 hello')?.[0]).toBe('- 10:03 ');
    expect(entryStart('- {time}').exec('- 10:03')?.[0]).toBe('- 10:03');
    expect(entryStart('- {time}').exec('- cleaned room')).toBeNull();
    expect(entryStart('- {time}').exec('  - 10:03 nested')).toBeNull();
    expect(entryStart('* **{time}** -').exec('* **10:03** - a')?.[0]).toBe('* **10:03** - ');
  });
});

describe('Enter in a journal note', () => {
  it('after an entry with text, starts the next entry with the time', () => {
    expect(press('- 14:05 had lunch|').after).toBe('- 14:05 had lunch\n- 14:09 |');
  });

  it('after a plain line, starts an entry', () => {
    expect(press('Slept badly|').after).toBe('Slept badly\n- 14:09 |');
  });

  it('after a heading, starts the first entry under it', () => {
    expect(press('## Captures|\n').after).toBe('## Captures\n- 14:09 |\n');
  });

  it('after a photo embed, starts an entry', () => {
    expect(press('![[journal-20261103-1.jpg]]|').after).toBe('![[journal-20261103-1.jpg]]\n- 14:09 |');
  });

  it('after a bullet that has no time, starts a timed entry', () => {
    expect(press('- cleaned room|').after).toBe('- cleaned room\n- 14:09 |');
  });

  it('in the middle of an entry, moves the rest of the text to the new entry', () => {
    expect(press('- 14:05 had |lunch with Sam').after).toBe('- 14:05 had \n- 14:09 |lunch with Sam');
  });

  it('is one insert and keeps the original text', () => {
    const { result } = press('- 14:05 a|');
    expect(result).toMatchObject({ claimed: true, handler: 'timed-entry' });
    if (result.claimed) expect(result.changes).toEqual([{ from: 9, to: 9, insert: '\n- 14:09 ' }]);
  });

  it('uses another template when the type has one', () => {
    expect(press('* **14:05** - a|', { template: '* **{time}** -' }).after).toBe('* **14:05** - a\n* **14:09** - |');
  });
});

describe('Enter ends the entries', () => {
  it('on an entry that is only a time, removes it and leaves a blank line', () => {
    expect(press('- 14:05 a\n- 14:09 |').after).toBe('- 14:05 a\n|');
  });

  it('also when the space after the time is missing', () => {
    expect(press('- 14:05 a\n- 14:09|').after).toBe('- 14:05 a\n|');
  });

  it('on a blank line, leaves the key to Obsidian', () => {
    expect(press('- 14:05 a\n\n|').result).toMatchObject({ claimed: false, reason: 'all-passed' });
  });

  it('on an empty bullet, leaves the key to Obsidian, which ends the list', () => {
    expect(press('- |').result).toMatchObject({ claimed: false });
  });
});

describe('Enter in places the handler leaves alone', () => {
  const passes = (marked: string, opts?: Parameters<typeof press>[1]) => expect(press(marked, opts).result.claimed, marked).toBe(false);

  it('a sub-bullet, a task, a numbered item, a quote and a table row', () => {
    passes('- 14:05 a\n    - detail|');
    passes('- [ ] buy milk|');
    passes('1. first|');
    passes('> quoted|');
    passes('| a | b |');
  });

  it('the start of a line and the "- 14:05 " part of an entry', () => {
    passes('|Slept badly');
    passes('|- 14:05 a');
    passes('- |14:05 a');
    passes('- 14:05| a');
  });

  it('a type with no entry template', () => {
    passes('Slept badly|', { template: null });
  });

  it('a selection, not just a cursor', () => {
    passes('Slept |badly', { selectTo: 1 });
  });

  it('frontmatter and code blocks (the dispatcher keeps handlers out)', () => {
    expect(press('---\ntype: journal\n---\n\nbody').result.claimed).toBe(false);
    const inFence = '```\ncode|\n```';
    expect(press(inFence).result).toMatchObject({ claimed: false, reason: 'in-region' });
  });
});
