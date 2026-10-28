import { describe, expect, it, vi } from 'vitest';
import type { BodyGate } from '../src/core/body-gate';
import { BodyHandlerRegistry, handleBodyKey } from '../src/core/body-handlers';
import type { BodyHandler, BodyKey, BodyKeyContext, KeyInput } from '../src/core/body-handlers';
import type { ResolvedType } from '../src/core/schema-types';

const TYPE = { name: 'task', body: { enabled: true } } as unknown as ResolvedType;
const ALLOWED: BodyGate = { allowed: true, type: TYPE };

/** `|` marks the cursor in `marked`; it is removed from the text. */
function press(registry: BodyHandlerRegistry, marked: string, over: Partial<KeyInput> = {}, key: BodyKey = 'Enter') {
  const at = marked.indexOf('|');
  const text = marked.replace('|', '');
  const input: KeyInput = {
    key,
    path: 'Tasks/a.md',
    composing: false,
    multipleSelections: false,
    gate: () => ALLOWED,
    text: () => text,
    selection: { anchor: at, head: at },
    tabSize: 4,
    ...over,
  };
  return handleBodyKey(registry, input);
}

const handler = (id: string, outcome: 'claim' | 'pass', run?: (ctx: BodyKeyContext) => void, extra: Partial<BodyHandler> = {}): BodyHandler => ({
  id,
  keys: ['Enter'],
  handle: (ctx) => {
    run?.(ctx);
    return outcome;
  },
  ...extra,
});

const reg = (...hs: BodyHandler[]) => {
  const r = new BodyHandlerRegistry();
  hs.forEach((h) => r.register(h));
  return r;
};

describe('the registry', () => {
  it('registers, lists in order, and unregisters', () => {
    const r = new BodyHandlerRegistry();
    const off = r.register(handler('a', 'pass'));
    r.register(handler('b', 'pass', undefined, { keys: ['Tab'] }));
    expect(r.size).toBe(2);
    expect(r.listensTo('Enter')).toBe(true);
    expect(r.listensTo('Shift-Tab')).toBe(false);
    expect(r.forKey('Tab').map((h) => h.id)).toEqual(['b']);
    off();
    expect(r.listensTo('Enter')).toBe(false);
    expect(r.size).toBe(1);
  });

  it('refuses two handlers with one id', () => {
    const r = reg(handler('a', 'pass'));
    expect(() => r.register(handler('a', 'pass'))).toThrow(/already registered/);
  });
});

describe('claiming and passing', () => {
  it('does nothing, and asks nothing, when no handler listens to the key', () => {
    const gate = vi.fn(() => ALLOWED);
    const text = vi.fn(() => '');
    expect(press(new BodyHandlerRegistry(), '# A\n|', { gate, text })).toEqual({ claimed: false, reason: 'no-handler' });
    expect(press(reg(handler('a', 'claim', undefined, { keys: ['Tab'] })), '# A\n|', { gate, text })).toEqual({ claimed: false, reason: 'no-handler' });
    expect(gate).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it('a claim returns what the handler recorded, as changes and a cursor', () => {
    const r = reg(handler('a', 'claim', (c) => { c.tx.insert('X'); c.tx.setCursor(c.cursor.offset + 1); }));
    expect(press(r, '# A\nhe|llo')).toEqual({ claimed: true, handler: 'a', changes: [{ from: 6, to: 6, insert: 'X' }], cursor: 7 });
  });

  it('a pass leaves the key alone, and what a passing handler recorded is dropped', () => {
    const r = reg(handler('a', 'pass', (c) => c.tx.insert('X')));
    expect(press(r, '# A\n|')).toEqual({ claimed: false, reason: 'all-passed' });
  });

  it('the first handler to claim wins and later ones do not run', () => {
    const second = vi.fn();
    const r = reg(handler('first', 'pass'), handler('second', 'claim'), handler('third', 'claim', second));
    expect(press(r, 'text|')).toMatchObject({ claimed: true, handler: 'second' });
    expect(second).not.toHaveBeenCalled();
  });

  it('a claim with no edits still swallows the key', () => {
    expect(press(reg(handler('a', 'claim')), 'x|')).toEqual({ claimed: true, handler: 'a', changes: [], cursor: null });
  });
});

describe('when handlers must not run', () => {
  it.each([
    ['rubric-off'],
    ['body-edits-off'],
    ['unmanaged'],
    ['no-type'],
    ['type-not-enabled'],
    ['newer-schema'],
  ] as const)('the gate says %s: no handler runs', (reason) => {
    const ran = vi.fn();
    const r = reg(handler('a', 'claim', ran));
    expect(press(r, 'x|', { gate: () => ({ allowed: false, reason }) })).toEqual({ claimed: false, reason });
    expect(ran).not.toHaveBeenCalled();
  });

  it('IME composition is in progress: no handler runs and the gate is not even asked', () => {
    const ran = vi.fn();
    const gate = vi.fn(() => ALLOWED);
    expect(press(reg(handler('a', 'claim', ran)), 'x|', { composing: true, gate })).toEqual({ claimed: false, reason: 'composing' });
    expect(ran).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
  });

  it('several cursors: no handler runs', () => {
    const ran = vi.fn();
    expect(press(reg(handler('a', 'claim', ran)), 'x|', { multipleSelections: true })).toEqual({ claimed: false, reason: 'multiple-selections' });
    expect(ran).not.toHaveBeenCalled();
  });

  it('in a code fence, a math block or a comment, delimiter lines included', () => {
    const ran = vi.fn();
    const r = reg(handler('a', 'claim', ran));
    for (const doc of ['# A\n```\nco|de\n```\n', '# A\n```|\ncode\n```\n', '# A\n```\ncode\n```|\n', '# A\n$$\nx|\n$$\n', '# A\n%%\nnote|\n%%\n', '# A\n```\nunclosed|\n']) {
      expect(press(r, doc), doc).toEqual({ claimed: false, reason: 'in-region' });
    }
    expect(ran).not.toHaveBeenCalled();
    expect(press(r, '# A\n```\ncode\n```\nafter|\n')).toMatchObject({ claimed: true });
  });

  it('in the frontmatter, but not at the first body line', () => {
    const r = reg(handler('a', 'claim'));
    expect(press(r, '---\ntype: t|ask\n---\nbody\n')).toEqual({ claimed: false, reason: 'frontmatter' });
    expect(press(r, '---\ntype: task\n---|\nbody\n')).toEqual({ claimed: false, reason: 'frontmatter' });
    expect(press(r, '---\ntype: task\n---\n|body\n')).toMatchObject({ claimed: true });
    expect(press(r, '﻿|# Title\n')).toMatchObject({ claimed: true });
  });
});

describe('what a handler sees', () => {
  const seen = (marked: string, over: Partial<KeyInput> = {}): BodyKeyContext => {
    let ctx: BodyKeyContext | null = null;
    press(reg(handler('a', 'pass', (c) => { ctx = c; })), marked, over);
    if (!ctx) throw new Error('handler did not run');
    return ctx;
  };

  it('the type, the cursor line and column, and the line', () => {
    const c = seen('---\ntype: task\n---\n# A\nsome te|xt\n');
    expect(c.type).toEqual({ name: 'task' });
    expect(c.path).toBe('Tasks/a.md');
    expect(c.cursor).toEqual({ line: 4, ch: 7, offset: 30 });
    expect(c.lineText).toBe('some text');
    expect(c.selectionEmpty).toBe(true);
    expect(c.doc.lineText(3)).toBe('# A');
    expect(c.doc.lineCount).toBe(5);
    expect(c.doc.lineStart(4)).toBe(23);
  });

  it('the list item and its depth', () => {
    expect(seen('# A\n- one|\n').list).toEqual({ depth: 0, marker: '-', task: false });
    expect(seen('# A\n\t\t- [ ] deep|\n').list).toEqual({ depth: 2, marker: '-', task: true });
    expect(seen('# A\nplain|\n').list).toBeNull();
    expect(seen('# A\n        - eight|\n', { tabSize: 2 }).list?.depth).toBe(4);
  });

  it('the innermost section, with file line numbers, or none before the first heading', () => {
    const doc = '---\na: 1\n---\nintro|\n# One\ntext\n## Two\nmore\n# Three\n';
    expect(seen(doc).section).toBeNull();
    expect(seen('---\na: 1\n---\n# One\ntext\n## Two\nmo|re\n# Three\n').section).toEqual({ text: 'Two', level: 2, line: 5 });
    expect(seen('# One\n## Two\nx\n# Th|ree\n').section).toEqual({ text: 'Three', level: 1, line: 3 });
    expect(seen('# One\n## Two\nx\n# Three\n|').section).toEqual({ text: 'Three', level: 1, line: 3 });
  });

  it('a selection is reported', () => {
    const c = seen('# A\nhello|', { selection: { anchor: 4, head: 9 } });
    expect(c.selectionEmpty).toBe(false);
  });
});

describe('the edits a handler may make', () => {
  it('insertAfterLine puts whole lines on a new line, with the note line ending', () => {
    const r = reg(handler('a', 'claim', (c) => c.tx.insertAfterLine(c.cursor.line, 'x\ny')));
    expect(press(r, '# A\r\nline|\r\nnext\r\n')).toMatchObject({ changes: [{ from: 11, to: 11, insert: 'x\r\ny\r\n' }] });
    expect(press(r, '# A\nlast|')).toMatchObject({ changes: [{ from: 8, to: 8, insert: '\nx\ny' }] });
  });

  it('replace and delete need mayRewrite: without it the handler fails and nothing is applied', () => {
    const log = vi.fn();
    const r = reg(handler('a', 'claim', (c) => c.tx.replace(0, 2, 'x')));
    expect(press(r, '# A\n|', { log })).toEqual({ claimed: false, reason: 'failed' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('handler a failed'));
    const ok = reg(handler('a', 'claim', (c) => c.tx.replace(0, 2, 'x'), { mayRewrite: true }));
    expect(press(ok, '# A\n|')).toMatchObject({ claimed: true, changes: [{ from: 0, to: 2, insert: 'x' }] });
  });

  it('drops edits that are out of range or overlap, and tries the next handler', () => {
    const log = vi.fn();
    const r = reg(
      handler('bad', 'claim', (c) => c.tx.insert('x', 999)),
      handler('overlap', 'claim', (c) => { c.tx.replace(0, 3, 'a'); c.tx.replace(2, 4, 'b'); }, { mayRewrite: true }),
      handler('good', 'claim', (c) => c.tx.insert('ok')),
    );
    expect(press(r, 'abcdef|', { log })).toMatchObject({ claimed: true, handler: 'good' });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('a handler that throws is skipped; the key is not claimed unless another handler claims it', () => {
    const boom = handler('boom', 'claim', () => { throw new Error('boom'); });
    expect(press(reg(boom), 'x|')).toEqual({ claimed: false, reason: 'failed' });
    expect(press(reg(boom, handler('fine', 'claim')), 'x|')).toMatchObject({ claimed: true, handler: 'fine' });
  });

  it('keeps several inserts together in one result (one transaction)', () => {
    const r = reg(handler('a', 'claim', (c) => { c.tx.insert('1', 0); c.tx.insert('2'); c.tx.insertAfterLine(0, 'z'); }));
    const res = press(r, 'ab|\n');
    expect(res).toMatchObject({ claimed: true });
    if (res.claimed) expect(res.changes).toHaveLength(3);
  });
});
