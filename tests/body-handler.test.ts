import { describe, expect, it } from 'vitest';
import { makeBodyHandler } from '../src/core/body-handler';
import type { BodyGate } from '../src/core/body-gate';
import { BodyHandlerRegistry, handleBodyKey } from '../src/core/body-handlers';
import type { BodyChange, BodyKey, KeyResult } from '../src/core/body-handlers';
import { emptyRules } from '../src/core/body-rules';
import type { BodyRules, KeyRules } from '../src/core/body-rules';
import type { FormulaContext } from '../src/core/formula';
import type { ResolvedType } from '../src/core/schema-types';

const GATE: BodyGate = { allowed: true, type: { name: 'journal', body: { enabled: true } } as unknown as ResolvedType };
const NOW = new Date(2026, 10, 3, 14, 9, 30); // Tuesday 3 November 2026

const cx = (props: Record<string, unknown> = {}): FormulaContext => ({
  now: NOW,
  file: { name: '2026-11-03.md', basename: '2026-11-03', path: 'Journal/2026-11-03.md', folder: 'Journal', ext: 'md' },
  props,
});

const keys = (k: KeyRules): BodyRules => ({ ...emptyRules(), default: k });
const ENTRIES = keys({ Enter: { insert: '- {{time:HH:mm}} ' } });

/** `|` marks the cursor. Returns the key result and the text after its changes, with the cursor shown as `|`. */
function press(
  marked: string,
  rules: BodyRules | null = ENTRIES,
  o: { key?: BodyKey; props?: Record<string, unknown>; selectTo?: number } = {},
) {
  const at = marked.indexOf('|');
  const text = marked.replace('|', '');
  const registry = new BodyHandlerRegistry();
  const logs: string[] = [];
  registry.register(makeBodyHandler({ rulesFor: () => rules, context: () => cx(o.props), log: (m) => logs.push(m) }));
  const result: KeyResult = handleBodyKey(registry, {
    key: o.key ?? 'Enter',
    path: 'Journal/2026-11-03.md',
    composing: false,
    multipleSelections: false,
    gate: () => GATE,
    text: () => text,
    selection: { anchor: o.selectTo ?? at, head: at },
    tabSize: 4,
  });
  return { result, logs, after: result.claimed ? apply(text, result.changes, result.cursor) : text };
}

function apply(text: string, changes: BodyChange[], cursor: number | null): string {
  let out = text;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  if (cursor === null) return out;
  let pos = cursor;
  // A change at or before the cursor moves it; an insert exactly at the cursor puts the cursor after the new text.
  for (const c of changes) if (c.to <= cursor) pos += c.insert.length - (c.to - c.from);
  return `${out.slice(0, pos)}|${out.slice(pos)}`;
}

describe('Enter with a timed-entry rule', () => {
  it('after an entry, a heading, a plain line, an embed or a bullet, starts a timed entry', () => {
    expect(press('- 14:05 had lunch|').after).toBe('- 14:05 had lunch\n- 14:09 |');
    expect(press('## Captures|\n').after).toBe('## Captures\n- 14:09 |\n');
    expect(press('Slept badly|').after).toBe('Slept badly\n- 14:09 |');
    expect(press('![[journal-20261103-1.jpg]]|').after).toBe('![[journal-20261103-1.jpg]]\n- 14:09 |');
    expect(press('- cleaned room|').after).toBe('- cleaned room\n- 14:09 |');
  });

  it('in the middle of a line, moves the rest of the text to the new entry', () => {
    expect(press('- 14:05 had |lunch with Sam').after).toBe('- 14:05 had \n- 14:09 |lunch with Sam');
  });

  it('writes exactly the rule text, so a missing trailing space is the rule author\'s to add', () => {
    expect(press('a|', keys({ Enter: { insert: '- {{time}}' } })).after).toBe('a\n- 14:09|');
  });

  it('is one insert and keeps the original text', () => {
    const { result } = press('- 14:05 a|');
    expect(result).toMatchObject({ claimed: true, handler: 'body-rules' });
    if (result.claimed) expect(result.changes).toEqual([{ from: 9, to: 9, insert: '\n- 14:09 ' }]);
  });
});

describe('Enter ends the entries', () => {
  it('on an entry that has only what the rule wrote, removes it and leaves a blank line', () => {
    expect(press('- 14:05 a\n- 14:09 |').after).toBe('- 14:05 a\n|');
    expect(press('- 14:05 a\n- 14:09|').after).toBe('- 14:05 a\n|');
  });

  it('knows an empty entry by the format of a formula that ends in .format()', () => {
    const rules = keys({ Enter: { insert: "- {{ now().format('ddd HH:mm') }} " } });
    expect(press('x\n- Tue 14:05 |', rules).after).toBe('x\n|');
    expect(press('x\n- Tue 14:05 went|', rules).after).toBe('x\n- Tue 14:05 went\n- Tue 14:09 |');
  });

  it('leaves a blank line and an empty bullet to Obsidian', () => {
    expect(press('- 14:05 a\n\n|').result.claimed).toBe(false);
    expect(press('- |').result.claimed).toBe(false);
  });
});

describe('Enter where Obsidian keeps control', () => {
  const passes = (marked: string) => expect(press(marked).result.claimed, marked).toBe(false);

  it('a sub-bullet, a task, a numbered item, a quote and a table row', () => {
    passes('- 14:05 a\n    - detail|');
    passes('- [ ] buy milk|');
    passes('1. first|');
    passes('> quoted|');
    passes('| a | b |');
  });

  it('the start of a line and the generated part of an entry', () => {
    passes('|Slept badly');
    passes('|- 14:05 a');
    passes('- |14:05 a');
    passes('- 14:05| a');
  });

  it('a selection, the frontmatter and a code fence', () => {
    expect(press('Slept |badly', ENTRIES, { selectTo: 1 }).result.claimed).toBe(false);
    expect(press('---\ntype: journal\n---\n\nbody').result.claimed).toBe(false);
    expect(press('```\ncode|\n```').result).toMatchObject({ claimed: false, reason: 'in-region' });
  });

  it('a type with no rules', () => {
    expect(press('x|', null).result.claimed).toBe(false);
    expect(press('x|', emptyRules()).result.claimed).toBe(false);
  });
});

describe('rules per heading', () => {
  const rules: BodyRules = {
    sections: [
      { heading: 'Captures', level: 2, scaffold: true, keys: { Enter: { insert: '- {{time:HH:mm}} ' } } },
      { heading: 'Gratitude', scaffold: true, keys: { Enter: { insert: '- ' } } },
      { heading: 'Notes', scaffold: true, keys: { Enter: { pass: true } } },
    ],
    default: { Enter: { insert: '* ' } },
  };
  const doc = (heading: string, line: string) => `# Day\n\n${heading}\n\n${line}`;

  it('uses the rule of the heading the cursor is under', () => {
    expect(press(doc('## Captures', '- 10:03 a|'), rules).after).toContain('- 10:03 a\n- 14:09 |');
    expect(press(doc('## Gratitude', '- sun|'), rules).after).toContain('- sun\n- |');
  });

  it('matches the heading without regard to case, and at any level when none is given', () => {
    expect(press(doc('### gratitude', '- sun|'), rules).after).toContain('- sun\n- |');
  });

  it('does not match a heading at another level when a level is given', () => {
    expect(press(doc('### Captures', '- sun|'), rules).after).toContain('- sun\n* |'); // default
  });

  it('falls back to default outside the listed headings and before the first heading', () => {
    expect(press(doc('## Other', '- x|'), rules).after).toContain('- x\n* |');
    expect(press('plain|', rules).after).toBe('plain\n* |');
  });

  it('lets a section turn a key off with pass', () => {
    expect(press(doc('## Notes', '- x|'), rules).result.claimed).toBe(false);
  });

  it('uses the section rule on the heading line itself', () => {
    expect(press('## Gratitude|\n', rules).after).toBe('## Gratitude\n- |\n');
  });

  it('keeps default for a key the section does not mention', () => {
    const r: BodyRules = { sections: [{ heading: 'A', scaffold: true, keys: {} }], default: { Enter: { insert: '- ' } } };
    expect(press('## A\n\nx|', r).after).toBe('## A\n\nx\n- |');
  });
});

describe('rules per key', () => {
  const rules = keys({ Tab: { insert: '{{time}} ', newline: false }, 'Shift-Tab': { insert: '{{date}} ', newline: false }, Enter: { insert: '- ' } });

  it('Tab puts the text at the cursor, without a new line', () => {
    expect(press('met Sam |and', rules, { key: 'Tab' }).after).toBe('met Sam 14:09 |and');
  });

  it('Shift-Tab has its own rule', () => {
    expect(press('x|', rules, { key: 'Shift-Tab' }).after).toBe('x2026-11-03 |');
  });

  it('a key with no rule is left to Obsidian', () => {
    expect(press('- a|', keys({ Enter: { insert: '- ' } }), { key: 'Tab' }).result.claimed).toBe(false);
  });

  it('newline: false on Enter inserts at the cursor too, and newline: true on Tab starts a line', () => {
    expect(press('a|', keys({ Enter: { insert: '!', newline: false } })).after).toBe('a!|');
    expect(press('a|', keys({ Tab: { insert: '- ', newline: true } }), { key: 'Tab' }).after).toBe('a\n- |');
  });

  it('does nothing with a selection', () => {
    expect(press('met |Sam', rules, { key: 'Tab', selectTo: 0 }).result.claimed).toBe(false);
  });
});

describe('formulas in rules', () => {
  it('reads note properties and the file', () => {
    const rules = keys({ Enter: { insert: "- {{ status }} {{ file.basename }} {{ if(mood >= 4, ':)', ':|') }} " } });
    expect(press('a|', rules, { props: { status: 'open', mood: 5 } }).after).toBe('a\n- open 2026-11-03 :) |');
  });

  it('writes a placeholder that fails as nothing, and logs why, without losing the key press', () => {
    const rules = keys({ Enter: { insert: '- {{ "x" - 1 }}{{time}} ' } });
    const { after, logs } = press('a|', rules);
    expect(after).toBe('a\n- 14:09 |');
    expect(logs[0]).toMatch(/needs two numbers/);
  });
});
