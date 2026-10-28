import { describe, expect, it } from 'vitest';
import { insertIntoBody } from '../src/core/body-edit';
import type { InsertPosition } from '../src/core/body-edit';

const BODY = '# Top\nintro\n\n## Notes\nn1\nn2\n\n### Sub\ns1\n\n## Other\no1\n';
const at = (heading: string, position: InsertPosition, text = 'NEW', body = BODY) => {
  const r = insertIntoBody(body, heading, text, position);
  if (!r.ok) throw new Error(r.reason);
  return r.body;
};

describe('insertIntoBody positions', () => {
  it('start: the line under the heading', () => {
    expect(at('Notes', 'start')).toBe('# Top\nintro\n\n## Notes\nNEW\nn1\nn2\n\n### Sub\ns1\n\n## Other\no1\n');
  });

  it('end: after the last line of the own text, before the first sub-heading and its blank line', () => {
    expect(at('Notes', 'end')).toBe('# Top\nintro\n\n## Notes\nn1\nn2\nNEW\n\n### Sub\ns1\n\n## Other\no1\n');
  });

  it('after: after the last line of the whole subtree, before the next heading', () => {
    expect(at('Notes', 'after')).toBe('# Top\nintro\n\n## Notes\nn1\nn2\n\n### Sub\ns1\nNEW\n\n## Other\no1\n');
  });

  it('before: the line above the heading', () => {
    expect(at('Notes', 'before')).toBe('# Top\nintro\n\nNEW\n## Notes\nn1\nn2\n\n### Sub\ns1\n\n## Other\no1\n');
  });

  it('works on the first and the last section', () => {
    expect(at('Top', 'before')).toBe('NEW\n' + BODY);
    expect(at('Other', 'after')).toBe(BODY + 'NEW\n');
    expect(at('Top', 'end')).toBe('# Top\nintro\nNEW\n\n## Notes\nn1\nn2\n\n### Sub\ns1\n\n## Other\no1\n');
    expect(at('Top', 'after')).toBe('# Top\nintro\n\n## Notes\nn1\nn2\n\n### Sub\ns1\n\n## Other\no1\nNEW\n');
  });

  it('an empty section: start, end and after all go under the heading', () => {
    const body = '## A\n\n## B\nb\n';
    expect(at('A', 'start', 'NEW', body)).toBe('## A\nNEW\n\n## B\nb\n');
    expect(at('A', 'end', 'NEW', body)).toBe('## A\nNEW\n\n## B\nb\n');
    expect(at('A', 'after', 'NEW', body)).toBe('## A\nNEW\n\n## B\nb\n');
    expect(at('B', 'start', 'NEW', '## B\n')).toBe('## B\nNEW\n');
  });

  it('inserts several lines', () => {
    expect(at('Other', 'start', '- a\n- b\n')).toBe(BODY.replace('## Other\n', '## Other\n- a\n- b\n'));
  });
});

describe('insertIntoBody line endings and the end of the body', () => {
  it('uses the note line ending for the new lines and leaves the rest byte for byte', () => {
    const body = '# A\r\ntext\r\n## B\r\nb\r\n';
    expect(at('A', 'end', 'x\ny', body)).toBe('# A\r\ntext\r\nx\r\ny\r\n## B\r\nb\r\n');
    const mixed = '# A\ntext\r\n## B\nb\r\n';
    expect(at('B', 'start', 'x', mixed)).toBe('# A\ntext\r\n## B\nx\nb\r\n');
    expect(insertIntoBody('# A\ntext\n', 'A', 'x', 'end', '\r\n')).toMatchObject({ body: '# A\ntext\nx\r\n' });
  });

  it('adds a line break first when the body has none at the end, and keeps it without one', () => {
    expect(at('A', 'after', 'NEW', '# A\ntext')).toBe('# A\ntext\nNEW');
    expect(at('A', 'start', 'NEW', '# A')).toBe('# A\nNEW');
    expect(at('A', 'after', 'NEW', '# A\n')).toBe('# A\nNEW\n');
  });

  it('inserts nothing for empty text and says it changed nothing', () => {
    expect(insertIntoBody(BODY, 'Notes', '', 'start')).toEqual({ ok: true, body: BODY, changed: false });
  });

  it('only adds: removing the inserted text gives back the original body', () => {
    for (const pos of ['start', 'end', 'after', 'before'] as const) {
      expect(at('Notes', pos).replace('NEW\n', '')).toBe(BODY);
    }
  });
});

describe('insertIntoBody finding the heading', () => {
  it('reports a missing heading and an ambiguous one', () => {
    expect(insertIntoBody(BODY, 'Nope', 'x', 'start')).toEqual({ ok: false, reason: 'heading-not-found' });
    expect(insertIntoBody('# A\n## X\n# B\n## X\n', 'X', 'x', 'start')).toEqual({ ok: false, reason: 'heading-ambiguous' });
  });

  it('picks one of several with nth, and by level', () => {
    const body = '# A\n## X\n# B\n## X\n';
    expect(insertIntoBody(body, { text: 'X', nth: 2 }, 'NEW', 'start')).toMatchObject({ ok: true, body: '# A\n## X\n# B\n## X\nNEW\n' });
    expect(insertIntoBody(body, { text: 'X', nth: 3 }, 'NEW', 'start')).toEqual({ ok: false, reason: 'heading-not-found' });
    expect(insertIntoBody('# X\n## X\n', { text: 'X', level: 2 }, 'NEW', 'start')).toMatchObject({ body: '# X\n## X\nNEW\n' });
    expect(insertIntoBody('# X\n## X\n', '## X', 'NEW', 'start')).toMatchObject({ body: '# X\n## X\nNEW\n' });
  });

  it('ignores a heading-like line inside a fence', () => {
    const body = '# A\n```\n## Fake\n```\n';
    expect(insertIntoBody(body, 'Fake', 'x', 'start')).toEqual({ ok: false, reason: 'heading-not-found' });
  });

  it('refuses to insert inside a code fence', () => {
    const body = '# A\n```\ncode\n\n\n';
    expect(insertIntoBody(body, 'A', 'x', 'after')).toEqual({ ok: false, reason: 'inside-code' });
    expect(insertIntoBody(body, 'A', 'x', 'start')).toMatchObject({ ok: true });
  });

  it('may insert between two fences that touch', () => {
    const body = '# A\n```\na\n```\n```\nb\n```\n';
    expect(insertIntoBody(body, 'A', 'x', 'after')).toMatchObject({ ok: true });
  });
});
