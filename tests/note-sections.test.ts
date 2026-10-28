import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexLines, listInfo, parseSections } from '../src/core/note-sections';

const parse = (text: string, firstLine = 0) => parseSections(indexLines(text).lines, firstLine);
const heads = (text: string) => parse(text).flat.map((s) => [s.level, s.text, s.line]);

describe('indexLines', () => {
  it('splits LF and CRLF and does not invent a last empty line', () => {
    expect(indexLines('a\nb\n').lines).toEqual(['a', 'b']);
    expect(indexLines('a\r\nb').lines).toEqual(['a', 'b']);
    expect(indexLines('a\n\n').lines).toEqual(['a', '']);
    expect(indexLines('').lines).toEqual([]);
    expect(indexLines('a\r\nb\nc').starts).toEqual([0, 3, 5]);
  });
});

describe('parseSections', () => {
  it('builds the tree with own and full extents', () => {
    const t = parse('# A\ntext\n## B\nb\n### C\nc\n## D\nd\n# E\n');
    expect(t.flat.map((s) => s.text)).toEqual(['A', 'B', 'C', 'D', 'E']);
    const [a, b, c, d, e] = t.flat;
    expect(t.roots).toEqual([a, e]);
    expect(a?.children).toEqual([b, d]);
    expect(b?.children).toEqual([c]);
    expect(c?.parent).toBe(b);
    expect([a?.line, a?.contentStart, a?.ownEnd, a?.end]).toEqual([0, 1, 2, 8]);
    expect([b?.line, b?.ownEnd, b?.end]).toEqual([2, 4, 6]);
    expect([c?.line, c?.end]).toEqual([4, 6]);
    expect([e?.line, e?.ownEnd, e?.end]).toEqual([8, 9, 9]);
  });

  it('nests under the nearest shallower heading when a level is skipped', () => {
    const t = parse('# A\n### C\n## B\n');
    expect(t.flat[1]?.parent?.text).toBe('A');
    expect(t.flat[2]?.parent?.text).toBe('A');
    expect(t.flat[1]?.end).toBe(2);
  });

  it('counts lines from the first line of the file', () => {
    const t = parse('# A\ntext\n## B\n', 4);
    expect(t.flat.map((s) => s.line)).toEqual([4, 6]);
    expect(t.flat[0]?.end).toBe(7);
    expect(t.regionAt(4)).toBeNull();
  });

  it('has no sections for a note with no headings', () => {
    expect(parse('just text\n\nmore').flat).toEqual([]);
    expect(parse('').roots).toEqual([]);
  });

  it('ignores headings inside fences, including longer closers and unclosed fences', () => {
    expect(heads('# One\n```\n# no\n```\n## Two\n~~~\n## no\n```\n~~~\n### Three\n````\n### no\n```\n### no\n````\n#### Four\n```\n# swallowed\n')).toEqual([
      [1, 'One', 0],
      [2, 'Two', 4],
      [3, 'Three', 9],
      [4, 'Four', 15],
    ]);
  });

  it('does not close a fence with a shorter fence or the other character', () => {
    const t = parse('````\n```\n# x\n~~~~\n````\n# real\n');
    expect(t.flat.map((s) => s.text)).toEqual(['real']);
    expect(t.regionAt(2)?.kind).toBe('fence');
    expect(t.regionAt(5)).toBeNull();
  });

  it('knows math, comment and fence regions apart and by identity', () => {
    const t = parse('```\na\n```\n```\nb\n```\n$$\n# m\n$$\n%%\n# c\n%%\n');
    expect(t.regionAt(1)?.kind).toBe('fence');
    expect(t.regionAt(1)?.id).not.toBe(t.regionAt(4)?.id);
    expect(t.regionAt(2)?.id).toBe(t.regionAt(1)?.id);
    expect(t.regionAt(7)?.kind).toBe('math');
    expect(t.regionAt(10)?.kind).toBe('comment');
    expect(t.flat).toEqual([]);
  });

  it('reports a region that is still open after the last line', () => {
    expect(parse('# A\n```\ncode\n').unclosed?.kind).toBe('fence');
    expect(parse('# A\n```\ncode\n```\n').unclosed).toBeNull();
    expect(parse('# A\n$$\nx\n').unclosed?.kind).toBe('math');
    expect(parse('# A\ntext\n').unclosed).toBeNull();
  });

  it('matches Obsidian on the recorded edge cases (D-82)', () => {
    const golden = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'body', 'obsidian-headings.json'), 'utf8')) as {
      lines: string[];
      headings: { level: number; text: string; line: number }[];
    };
    const mine = parseSections(golden.lines).flat.map((s) => ({ level: s.level, text: s.text, line: s.line }));
    expect(mine).toEqual(golden.headings);
  });

  it('matches Obsidian on fences, math, comments, indented code and setext', () => {
    const lines = ['# One', 'text', '```', '# not a heading', '```', '## Two', '~~~', '## not either', '~~~', '````', '### nope', '```', '### still nope', '````', '### Three', 'Setext', '======', '$$', '# in math', '$$', '%%', '# in comment', '%%', '    # indented code', '#### Four ####'];
    expect(parseSections(lines).flat.map((s) => [s.level, s.text, s.line])).toEqual([
      [1, 'One', 0],
      [2, 'Two', 5],
      [3, 'Three', 14],
      [1, 'Setext', 15],
      [4, 'Four', 24],
    ]);
  });

  it('puts a setext heading on its text line and starts its content after the underline', () => {
    const s = parse('Title\n=====\nbody\n').flat[0];
    expect([s?.level, s?.text, s?.line, s?.contentStart]).toEqual([1, 'Title', 0, 2]);
  });
});

describe('listInfo', () => {
  it('reads marker, task box and depth', () => {
    expect(listInfo('- item')).toEqual({ depth: 0, marker: '-', task: false });
    expect(listInfo('\t\t* item')).toEqual({ depth: 2, marker: '*', task: false });
    expect(listInfo('        - nested')).toEqual({ depth: 2, marker: '-', task: false });
    expect(listInfo('  - [x] done', 2)).toEqual({ depth: 1, marker: '-', task: true });
    expect(listInfo('1. first')).toEqual({ depth: 0, marker: '1.', task: false });
    expect(listInfo('-')).toEqual({ depth: 0, marker: '-', task: false });
  });

  it('does not take other lines for items', () => {
    expect(listInfo('-text')).toBeNull();
    expect(listInfo('1.5 is a number')).toBeNull();
    expect(listInfo('plain')).toBeNull();
    expect(listInfo('')).toBeNull();
  });
});
