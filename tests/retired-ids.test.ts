import { describe, expect, it } from 'vitest';
import { reviewRetired } from '../src/core/retired-ids';

const effects = (retired: string[], used: string[]) => Object.fromEntries(reviewRetired(retired, used).map((e) => [e.id, e.effect]));

describe('reviewRetired', () => {
  it('a retired ID above everything in use holds its number back', () => {
    const [e] = reviewRetired(['KB-2026-0007'], ['KB-2026-0003', 'KB-2026-0005']);
    expect(e).toMatchObject({ id: 'KB-2026-0007', effect: 'holds' });
    expect(e?.detail).toContain('KB-2026-0006');
  });

  it('one at or below a number in use changes nothing', () => {
    expect(effects(['KB-2026-0004', 'KB-2026-0005'], ['KB-2026-0005'])).toEqual({ 'KB-2026-0004': 'covered', 'KB-2026-0005': 'covered' });
  });

  it('only the highest of several retired numbers holds; releasing it hands over to the next', () => {
    const r = reviewRetired(['KB-2026-0009', 'KB-2026-0007'], ['KB-2026-0003']);
    expect(r.map((e) => e.effect)).toEqual(['covered', 'holds']);
    expect(r[1]?.detail).toContain('KB-2026-0008');
    expect(r[0]?.detail).toMatch(/higher retired number/);
  });

  it('keeps types, years and unique-ID scopes apart', () => {
    expect(effects(['KB-2026-0007', 'TK-2026-0002', 'KB-2025-0007'], ['KB-2026-0009', 'TK-2026-0001'])).toEqual({
      'KB-2025-0007': 'holds',
      'KB-2026-0007': 'covered',
      'TK-2026-0002': 'holds',
    });
    expect(effects(['KB-MA-2026-0004', 'KB-PH-2026-0004'], ['KB-MA-2026-0002', 'KB-PH-2026-0009'])).toEqual({
      'KB-MA-2026-0004': 'holds',
      'KB-PH-2026-0004': 'covered',
    });
  });

  it('with nothing in use, the number to issue again is the first', () => {
    expect(reviewRetired(['KB-2026-0001'], [])[0]?.detail).toContain('KB-2026-0001 be issued again');
  });

  it('says so for text that is not an ID, lists each ID once, in order', () => {
    const r = reviewRetired(['zzz', 'KB-2026-0002', 'KB-2026-0002', 'KB-2026-0001'], []);
    expect(r.map((e) => e.id)).toEqual(['KB-2026-0001', 'KB-2026-0002', 'zzz']);
    expect(r[2]?.effect).toBe('none');
  });
});
