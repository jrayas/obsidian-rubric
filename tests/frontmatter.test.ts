import { beforeAll, describe, expect, it } from 'vitest';
import { FrontmatterError, desiredOrder, detectEol, editFrontmatter, readFrontmatter } from '../src/core/frontmatter';
import type { ResolvedType } from '../src/core/schema-types';
import { loadPack } from './helpers/pack';

let kb: ResolvedType;
beforeAll(async () => {
  kb = (await loadPack()).types.get('kb') as ResolvedType;
});

const NOTE = '---\ntype: kb\nstatus: draft # keep me\ntags: [a, b]\ncreated: 2026-10-20T14:32\n---\n\nBody text\n---\nnot frontmatter\n';

describe('editFrontmatter: compare first, write only on change', () => {
  it('returns the identical text when nothing changes', () => {
    const r = editFrontmatter(NOTE, (fm) => {
      fm.status = 'draft';
      fm.tags = ['a', 'b'];
    });
    expect(r.changed).toBe(false);
    expect(r.text).toBe(NOTE);
    expect(r.changes).toEqual([]);
  });

  it('changes only the key that differs and keeps comments, body and style of other values', () => {
    const r = editFrontmatter(NOTE, (fm) => {
      fm.status = 'review';
    });
    expect(r.changed).toBe(true);
    expect(r.changes).toEqual([{ key: 'status', before: 'draft', after: 'review' }]);
    expect(r.text).toBe(NOTE.replace('status: draft # keep me', 'status: review # keep me'));
    expect(r.text).toContain('tags: [a, b]');
    expect(r.text.endsWith('Body text\n---\nnot frontmatter\n')).toBe(true);
  });

  it('does not treat a later --- in the body as frontmatter', () => {
    expect(readFrontmatter(NOTE)).toEqual({ type: 'kb', status: 'draft', tags: ['a', 'b'], created: '2026-10-20T14:32' });
  });

  it('keeps flow style when a flow list is edited', () => {
    const r = editFrontmatter(NOTE, (fm) => {
      fm.tags = ['a', 'b', 'c'];
    });
    expect(r.text).toContain('tags: [a, b, c]');
  });

  it('adds new keys at the end and removes keys', () => {
    const r = editFrontmatter(NOTE, (fm) => {
      fm.language = 'en-GB';
      delete fm.tags;
    });
    expect(readFrontmatter(r.text)).toEqual({ type: 'kb', status: 'draft', created: '2026-10-20T14:32', language: 'en-GB' });
    expect(Object.keys(readFrontmatter(r.text) ?? {}).pop()).toBe('language');
  });

  it('quotes wiki-links and keeps date-like text as text', () => {
    const r = editFrontmatter('---\ntype: kb\n---\n', (fm) => {
      fm.parent = '[[Quantum Mechanics]]';
      fm.review_last = '2026-10-20';
      fm.created = '2026-10-20T14:32';
      fm.level = 3;
      fm.flag = true;
    });
    expect(r.text).toContain('parent: "[[Quantum Mechanics]]"');
    expect(r.text).toContain('review_last: 2026-10-20\n');
    expect(r.text).toContain('level: 3\n');
    expect(readFrontmatter(r.text)).toMatchObject({ parent: '[[Quantum Mechanics]]', review_last: '2026-10-20', created: '2026-10-20T14:32', level: 3, flag: true });
  });

  it('creates a frontmatter block when the note has none', () => {
    const r = editFrontmatter('Just text\n', (fm) => {
      fm.type = 'note';
    });
    expect(r.text).toBe('---\ntype: note\n---\nJust text\n');
  });

  it('handles an empty frontmatter block', () => {
    const r = editFrontmatter('---\n---\nbody', (fm) => {
      fm.type = 'note';
    });
    expect(r.text).toBe('---\ntype: note\n---\nbody');
  });

  it('refuses frontmatter it cannot parse, without changing anything', () => {
    expect(() => editFrontmatter('---\na: [unclosed\n---\nx', (fm) => void (fm.b = 1))).toThrow(FrontmatterError);
    expect(() => editFrontmatter('---\n- a\n- b\n---\nx', (fm) => void (fm.b = 1))).toThrow(FrontmatterError);
  });

  it('treats a mutator that sets undefined as a removal', () => {
    const r = editFrontmatter(NOTE, (fm) => {
      fm.status = undefined;
    });
    expect(readFrontmatter(r.text)?.status).toBeUndefined();
  });
});

describe('line endings are preserved (rule 9)', () => {
  const crlf = NOTE.replace(/\n/g, '\r\n');

  it('detects the ending', () => {
    expect(detectEol(crlf)).toBe('\r\n');
    expect(detectEol(NOTE)).toBe('\n');
    expect(detectEol('no newline')).toBe('\n');
  });

  it('keeps CRLF in the frontmatter, the delimiters and the body after a change', () => {
    const r = editFrontmatter(crlf, (fm) => {
      fm.status = 'review';
      fm.language = 'en-GB';
    });
    expect(r.changed).toBe(true);
    expect(/[^\r]\n/.test(r.text)).toBe(false);
    expect(r.text.startsWith('---\r\ntype: kb\r\n')).toBe(true);
    expect(r.text.endsWith('Body text\r\n---\r\nnot frontmatter\r\n')).toBe(true);
  });

  it('keeps LF files LF', () => {
    const r = editFrontmatter(NOTE, (fm) => void (fm.status = 'review'));
    expect(r.text.includes('\r')).toBe(false);
  });

  it('creates a block with the file’s own ending', () => {
    expect(editFrontmatter('x\r\ny\r\n', (fm) => void (fm.type = 'note')).text).toBe('---\r\ntype: note\r\n---\r\nx\r\ny\r\n');
  });

  it('keeps a byte order mark', () => {
    const r = editFrontmatter('﻿' + NOTE, (fm) => void (fm.status = 'review'));
    expect(r.text.charAt(0)).toBe('﻿');
    expect(readFrontmatter(r.text)?.status).toBe('review');
  });
});

describe('property order', () => {
  it('computes: schema fields, unknown keys, archived_fields, then created and modified', () => {
    const keys = ['modified', 'custom', 'created', 'status', 'archived_fields', 'type', 'kind', 'zzz'];
    expect(desiredOrder(keys, kb)).toEqual(['type', 'status', 'kind', 'custom', 'zzz', 'archived_fields', 'created', 'modified']);
  });

  it('reorders when something changes, and nothing is deleted', () => {
    const messy = '---\nmodified: 2026-10-21T09:05\nstatus: draft\ncustom: x\ntype: kb\ncreated: 2026-10-20T14:32\n---\nbody\n';
    const r = editFrontmatter(messy, (fm) => void (fm.status = 'review'), { order: (k) => desiredOrder(k, kb) });
    expect(Object.keys(readFrontmatter(r.text) ?? {})).toEqual(['type', 'status', 'custom', 'created', 'modified']);
    expect(readFrontmatter(r.text)?.custom).toBe('x');
  });

  it('does not rewrite a note whose values are unchanged, even if the order is off', () => {
    const messy = '---\nstatus: draft\ntype: kb\n---\nbody\n';
    const r = editFrontmatter(messy, () => undefined, { order: (k) => desiredOrder(k, kb) });
    expect(r.changed).toBe(false);
    expect(r.text).toBe(messy);
  });

  it('can force the order explicitly (migration, convert)', () => {
    const messy = '---\nstatus: draft\ntype: kb\n---\nbody\n';
    const r = editFrontmatter(messy, () => undefined, { order: (k) => desiredOrder(k, kb), forceOrder: true });
    expect(r.text).toBe('---\ntype: kb\nstatus: draft\n---\nbody\n');
  });

  it('puts a newly added created and modified last', () => {
    const r = editFrontmatter('---\ntype: kb\nstatus: draft\n---\n', (fm) => {
      fm.modified = '2026-10-21T09:05';
      fm.created = '2026-10-20T14:32';
      fm.language = 'en-GB';
    }, { order: (k) => desiredOrder(k, kb) });
    expect(Object.keys(readFrontmatter(r.text) ?? {})).toEqual(['type', 'status', 'language', 'created', 'modified']);
  });
});
