import { describe, expect, it } from 'vitest';
import { convertOldId, findDuplicates, formatId, nextId, nextNumber, parseId, parseOldId, planRenumbering, yearOf } from '../src/core/ids';

describe('readable IDs (rule 4)', () => {
  it('formats PREFIX-YYYY-NNNN', () => {
    expect(formatId('KB', 2026, 143)).toBe('KB-2026-0143');
    expect(formatId('TK', 2026, 12)).toBe('TK-2026-0012');
    expect(formatId('KB', 2026, 12345)).toBe('KB-2026-12345');
  });

  it('parses new and old style IDs', () => {
    expect(parseId('KB-2026-0143')).toEqual({ prefix: 'KB', year: 2026, num: 143 });
    expect(parseId('KB-000142')).toBeNull();
    expect(parseId('kb-2026-0143')).toBeNull();
    expect(parseId(5)).toBeNull();
    expect(parseOldId('KB-000142')).toEqual({ prefix: 'KB', num: 142 });
    expect(parseOldId('KB-2026-0143')).toBeNull();
  });

  it('numbers per type per year: highest plus one', () => {
    const used = ['KB-2026-0001', 'KB-2026-0143', 'TK-2026-0500', 'KB-2025-0900'];
    expect(nextId('KB', 2026, used)).toBe('KB-2026-0144');
    expect(nextId('TK', 2026, used)).toBe('TK-2026-0501');
    expect(nextId('PR', 2026, used)).toBe('PR-2026-0001');
  });

  it('a new year restarts at 0001', () => {
    expect(nextId('KB', 2027, ['KB-2026-0143'])).toBe('KB-2027-0001');
  });

  it('never reuses a retired (renumbered) ID, even when it was the highest', () => {
    expect(nextNumber('KB', 2026, ['KB-2026-0010'], ['KB-2026-0012'])).toBe(13);
  });

  it('takes the year from created and keeps it', () => {
    expect(yearOf('2026-10-20T14:32')).toBe(2026);
    expect(yearOf(undefined)).toBeNull();
    expect(yearOf('soon')).toBeNull();
  });

  it('converts old IDs: year from created, number kept', () => {
    expect(convertOldId('KB-000142', '2026-03-04T10:00')).toBe('KB-2026-0142');
    expect(convertOldId('KB-000142', '2024-12-31T23:59')).toBe('KB-2024-0142');
    expect(convertOldId('KB-2026-0142', '2026-03-04T10:00')).toBeNull();
    expect(convertOldId('KB-000142', undefined)).toBeNull();
  });
});

describe('duplicate IDs and renumbering', () => {
  const notes = [
    { path: 'a.md', id: 'KB-2026-0143', created: '2026-03-01T10:00' },
    { path: 'b.md', id: 'KB-2026-0143', created: '2026-05-01T10:00' },
    { path: 'c.md', id: 'KB-2026-0144', created: '2026-04-01T10:00' },
    { path: 'd.md', id: 'TK-2026-0001', created: '2026-04-01T10:00' },
  ];

  it('finds duplicates, oldest first', () => {
    const groups = findDuplicates(notes);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((n) => n.path)).toEqual(['a.md', 'b.md']);
  });

  it('the older note keeps its ID and the newer one gets the next free number', () => {
    expect(planRenumbering(notes)).toEqual([{ path: 'b.md', from: 'KB-2026-0143', to: 'KB-2026-0145' }]);
  });

  it('is independent of the order the notes are listed in', () => {
    expect(planRenumbering([...notes].reverse())).toEqual([{ path: 'b.md', from: 'KB-2026-0143', to: 'KB-2026-0145' }]);
  });

  it('breaks a tie on created by file creation time, then by path', () => {
    const tie = [
      { path: 'z.md', id: 'KB-2026-0001', created: '2026-01-01T00:00', ctime: 1 },
      { path: 'a.md', id: 'KB-2026-0001', created: '2026-01-01T00:00', ctime: 2 },
    ];
    expect(planRenumbering(tie)[0]?.path).toBe('a.md');
  });

  it('gives several renumbered notes different numbers (two notes created at once)', () => {
    const triple = [
      { path: 'a.md', id: 'KB-2026-0007', created: '2026-01-01T00:00' },
      { path: 'b.md', id: 'KB-2026-0007', created: '2026-01-02T00:00' },
      { path: 'c.md', id: 'KB-2026-0007', created: '2026-01-03T00:00' },
    ];
    expect(planRenumbering(triple).map((r) => r.to)).toEqual(['KB-2026-0008', 'KB-2026-0009']);
  });

  it('does not reuse a retired ID when renumbering', () => {
    expect(planRenumbering(notes, ['KB-2026-0150']).map((r) => r.to)).toEqual(['KB-2026-0151']);
  });

  it('finds nothing when every ID is unique', () => {
    expect(planRenumbering(notes.filter((n) => n.path !== 'b.md'))).toEqual([]);
  });
});
