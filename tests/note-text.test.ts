import { describe, expect, it } from 'vitest';
import { joinNote, splitNote } from '../src/core/note-text';

const roundTrips = (text: string) => expect(joinNote(splitNote(text))).toBe(text);

describe('splitNote / joinNote', () => {
  it('splits frontmatter from body at the closing line', () => {
    const p = splitNote('---\na: 1\n---\nbody\n');
    expect(p.frontmatter).toBe('---\na: 1\n---\n');
    expect(p.body).toBe('body\n');
    expect(p.eol).toBe('\n');
  });

  it('keeps CRLF in both parts and reports it', () => {
    const text = '---\r\na: 1\r\n---\r\nline one\r\nline two\r\n';
    const p = splitNote(text);
    expect(p.frontmatter).toBe('---\r\na: 1\r\n---\r\n');
    expect(p.body).toBe('line one\r\nline two\r\n');
    expect(p.eol).toBe('\r\n');
    roundTrips(text);
  });

  it('treats a note with no frontmatter as all body', () => {
    const p = splitNote('# Title\n\ntext');
    expect(p.frontmatter).toBe('');
    expect(p.body).toBe('# Title\n\ntext');
  });

  it('treats an opening --- with no closing line as body', () => {
    const text = '---\na: 1\nno closing line\n';
    expect(splitNote(text)).toMatchObject({ frontmatter: '', body: text });
  });

  it('does not end the frontmatter at a --- inside the body', () => {
    const p = splitNote('---\na: 1\n---\ntext\n---\nmore\n');
    expect(p.body).toBe('text\n---\nmore\n');
  });

  it('handles a frontmatter-only note, with and without a final line ending', () => {
    expect(splitNote('---\na: 1\n---\n')).toMatchObject({ frontmatter: '---\na: 1\n---\n', body: '' });
    expect(splitNote('---\na: 1\n---')).toMatchObject({ frontmatter: '---\na: 1\n---', body: '' });
  });

  it('handles empty frontmatter and an empty file', () => {
    expect(splitNote('---\n---\nx')).toMatchObject({ frontmatter: '---\n---\n', body: 'x' });
    expect(splitNote('')).toMatchObject({ frontmatter: '', body: '' });
  });

  it('keeps a byte order mark out of the body', () => {
    expect(splitNote('﻿---\na: 1\n---\nx')).toMatchObject({ frontmatter: '﻿---\na: 1\n---\n', body: 'x' });
    expect(splitNote('﻿# Title\n')).toMatchObject({ frontmatter: '﻿', body: '# Title\n' });
  });

  it('preserves a missing final newline and a trailing blank line', () => {
    roundTrips('---\na: 1\n---\nno newline at the end');
    roundTrips('---\na: 1\n---\ntext\n\n');
  });

  it('round-trips every text, including odd ones', () => {
    const pieces = ['---', '...', '\n', '\r\n', 'a: 1', ' ', 'text', '﻿', '#', '```'];
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let n = 0; n < 3000; n++) {
      let text = '';
      for (let k = next() % 12; k > 0; k--) text += pieces[next() % pieces.length];
      roundTrips(text);
    }
  });
});
