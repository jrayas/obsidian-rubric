import { describe, expect, it } from 'vitest';
import { formatMoment, formatToRegex } from '../src/core/moment-format';

// Tuesday 3 November 2026, 14:09:05.007 local time.
const d = new Date(2026, 10, 3, 14, 9, 5, 7);

describe('formatMoment', () => {
  it('writes the formats Obsidian uses for time and date', () => {
    expect(formatMoment(d, 'HH:mm')).toBe('14:09');
    expect(formatMoment(d, 'YYYY-MM-DD')).toBe('2026-11-03');
    expect(formatMoment(d, 'YYYY-MM-DD HH:mm:ss')).toBe('2026-11-03 14:09:05');
  });

  it('writes day and month names', () => {
    expect(formatMoment(d, 'dddd, D MMMM YYYY')).toBe('Tuesday, 3 November 2026');
    expect(formatMoment(d, 'ddd D MMM')).toBe('Tue 3 Nov');
    expect(formatMoment(d, 'dd d')).toBe('Tu 2');
  });

  it('writes the 12-hour clock with am and pm, noon and midnight included', () => {
    expect(formatMoment(d, 'h:mm A')).toBe('2:09 PM');
    expect(formatMoment(new Date(2026, 0, 1, 0, 5), 'hh:mm a')).toBe('12:05 am');
    expect(formatMoment(new Date(2026, 0, 1, 12, 5), 'h A')).toBe('12 PM');
  });

  it('writes unpadded numbers, two-digit years, milliseconds and ordinals', () => {
    expect(formatMoment(new Date(2026, 0, 5, 7, 5, 3), 'H:m:s D/M/YY')).toBe('7:5:3 5/1/26');
    expect(formatMoment(d, 'SSS')).toBe('007');
    expect(formatMoment(new Date(2026, 0, 1), 'Do')).toBe('1st');
    expect(formatMoment(new Date(2026, 0, 2), 'Do')).toBe('2nd');
    expect(formatMoment(new Date(2026, 0, 3), 'Do')).toBe('3rd');
    expect(formatMoment(new Date(2026, 0, 11), 'Do')).toBe('11th');
    expect(formatMoment(new Date(2026, 0, 22), 'Do')).toBe('22nd');
  });

  it('keeps text in square brackets and other characters as written', () => {
    expect(formatMoment(d, '[at] HH:mm')).toBe('at 14:09');
    expect(formatMoment(d, '[YYYY] YYYY')).toBe('YYYY 2026');
    expect(formatMoment(d, 'HH.mm - ??')).toBe('14.09 - ??');
  });

  it('writes the time zone offset as +HH:mm', () => {
    expect(formatMoment(d, 'Z')).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});

describe('formatToRegex', () => {
  const matches = (format: string, text: string) => new RegExp(`^${formatToRegex(format)}$`).test(text);

  it('matches what formatMoment writes for the same format', () => {
    for (const format of ['HH:mm', 'YYYY-MM-DD', 'ddd HH:mm', 'dddd, D MMMM YYYY', 'h:mm A', '[at] HH:mm', 'Do MMM']) {
      expect(matches(format, formatMoment(d, format)), format).toBe(true);
    }
  });

  it('does not match ordinary typed text', () => {
    expect(matches('HH:mm', 'went walking')).toBe(false);
    expect(matches('HH:mm', '14:09 went')).toBe(false);
    expect(matches('YYYY-MM-DD', '2026-11')).toBe(false);
  });

  it('escapes characters that mean something in a regular expression', () => {
    expect(matches('HH.mm (x)', '14.09 (x)')).toBe(true);
    expect(matches('HH.mm (x)', '14x09 (x)')).toBe(false);
  });
});
