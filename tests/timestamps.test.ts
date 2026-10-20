import { describe, expect, it } from 'vitest';
import { decideStamp, fingerprint, formatLocal, formatLocalDate } from '../src/core/timestamps';

const note = (modified: string, body = 'body', extra = '') =>
  `---\ntype: kb\nstatus: draft\nbreadcrumb: Knowledge/Physics\n${extra}created: 2026-10-20T14:32\nmodified: ${modified}\n---\n${body}\n`;

describe('local timestamps', () => {
  it('formats local time with no timezone', () => {
    expect(formatLocal(new Date(2026, 9, 20, 14, 32, 59))).toBe('2026-10-20T14:32');
    expect(formatLocal(new Date(2026, 0, 5, 3, 4))).toBe('2026-01-05T03:04');
    expect(formatLocalDate(new Date(2026, 9, 20, 23, 59))).toBe('2026-10-20');
  });
});

describe('what counts as a change (rule 5)', () => {
  const base = fingerprint(note('2026-10-20T14:32'));

  it('ignores `modified` and `breadcrumb` in the fingerprint', () => {
    expect(fingerprint(note('2026-12-01T00:00')).fp).toBe(base.fp);
    expect(fingerprint(note('2026-10-20T14:32').replace('Knowledge/Physics', 'Projects/Alpha')).fp).toBe(base.fp);
  });

  it('sees a body edit, a property edit and a new property', () => {
    expect(fingerprint(note('2026-10-20T14:32', 'new body')).fp).not.toBe(base.fp);
    expect(fingerprint(note('2026-10-20T14:32').replace('draft', 'review')).fp).not.toBe(base.fp);
    expect(fingerprint(note('2026-10-20T14:32', 'body', 'language: en-GB\n')).fp).not.toBe(base.fp);
  });

  it('reads the modified value, and copes with notes that have no frontmatter', () => {
    expect(base.modified).toBe('2026-10-20T14:32');
    expect(fingerprint('just text').modified).toBeUndefined();
    expect(fingerprint('just text').fp).not.toBe(fingerprint('other text').fp);
  });
});

describe('decideStamp', () => {
  const before = { fp: 'a', modified: '2026-10-20T14:32' };

  it('stamps when the file changed and its modified value did not', () => {
    expect(decideStamp({ ownWrite: false, before, after: { fp: 'b', modified: '2026-10-20T14:32' } })).toEqual({ action: 'stamp' });
  });

  it('does not stamp for this plugin’s own writes', () => {
    expect(decideStamp({ ownWrite: true, before, after: { fp: 'b', modified: before.modified } })).toEqual({ action: 'none', reason: 'own-write' });
  });

  it('does not stamp when only a move or a breadcrumb rewrite happened (same fingerprint)', () => {
    expect(decideStamp({ ownWrite: false, before, after: { fp: 'a', modified: before.modified } })).toEqual({ action: 'none', reason: 'unchanged' });
  });

  it('accepts a change that arrives with a different modified already inside it (sync), writing nothing', () => {
    expect(decideStamp({ ownWrite: false, before, after: { fp: 'b', modified: '2026-10-21T09:05' } })).toEqual({ action: 'none', reason: 'accepted-newer' });
  });

  it('stamps a change that arrives without a modified at all', () => {
    expect(decideStamp({ ownWrite: false, before: { fp: 'a', modified: undefined }, after: { fp: 'b', modified: undefined } })).toEqual({ action: 'stamp' });
  });

  it('does nothing without a baseline (the first sight of a note)', () => {
    expect(decideStamp({ ownWrite: false, before: undefined, after: { fp: 'b', modified: undefined } })).toEqual({ action: 'none', reason: 'no-baseline' });
  });

  it('has no loop: after a stamp the new content is the baseline, so the follow-up event changes nothing', () => {
    const stamped = { fp: 'b', modified: '2026-10-20T15:00' };
    // the plugin's own write is recognised by content...
    expect(decideStamp({ ownWrite: true, before: { fp: 'b', modified: before.modified }, after: stamped }).action).toBe('none');
    // ...and even if it were not, the fingerprint matches the baseline
    expect(decideStamp({ ownWrite: false, before: stamped, after: stamped }).action).toBe('none');
  });
});
