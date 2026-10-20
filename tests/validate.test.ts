import { beforeAll, describe, expect, it } from 'vitest';
import { checkFileName, caseCollisions, accentVariants } from '../src/core/fs-names';
import type { PropertyDef, ResolvedType } from '../src/core/schema-types';
import { isDateText, isDatetimeText, isEmpty, validateValue } from '../src/core/validate';
import { loadPack } from './helpers/pack';

let kb: ResolvedType;
let task: ResolvedType;
let exercise: ResolvedType;
const p = (t: ResolvedType, n: string) => t.byName.get(n) as PropertyDef;
beforeAll(async () => {
  const pack = await loadPack();
  kb = pack.types.get('kb') as ResolvedType;
  task = pack.types.get('task') as ResolvedType;
  exercise = pack.types.get('exercise') as ResolvedType;
});

describe('value validation', () => {
  it('enum: only listed values', () => {
    expect(validateValue(p(kb, 'status'), 'draft')).toBeNull();
    expect(validateValue(p(kb, 'status'), 'live')?.code).toBe('enum');
    expect(validateValue(p(kb, 'status'), 'live')?.message).toContain('draft, review');
  });

  it('integer: whole number within min and max', () => {
    expect(validateValue(p(task, 'priority'), 3)).toBeNull();
    expect(validateValue(p(task, 'priority'), 0)?.code).toBe('min');
    expect(validateValue(p(task, 'priority'), 6)?.code).toBe('max');
    expect(validateValue(p(task, 'priority'), 2.5)?.code).toBe('type');
    expect(validateValue(p(task, 'priority'), '3')?.code).toBe('type');
  });

  it('date and datetime: real calendar values in the right shape', () => {
    expect(isDateText('2026-10-20')).toBe(true);
    expect(isDateText('2026-02-30')).toBe(false);
    expect(isDateText('20/10/2026')).toBe(false);
    expect(isDatetimeText('2026-10-20T14:32')).toBe(true);
    expect(isDatetimeText('2026-10-20T24:00')).toBe(false);
    expect(isDatetimeText('2026-10-20T14:32:10')).toBe(false);
    expect(isDatetimeText('2026-10-20T14:32Z')).toBe(false);
    expect(validateValue(p(task, 'due'), '2026-10-24')).toBeNull();
    expect(validateValue(p(task, 'due'), 'tomorrow')?.code).toBe('format');
    expect(validateValue(p(kb, 'created'), '2026-10-20T14:32')).toBeNull();
    expect(validateValue(p(kb, 'created'), '2026-10-20')?.code).toBe('format');
  });

  it('url: a web address', () => {
    expect(validateValue(p(kb, 'source_url'), 'https://example.com/a')).toBeNull();
    expect(validateValue(p(kb, 'source_url'), 'example.com')?.code).toBe('format');
  });

  it('link: a quoted wiki-link; a heading only where allowed', () => {
    expect(validateValue(p(kb, 'parent'), '[[Quantum Mechanics]]')).toBeNull();
    expect(validateValue(p(kb, 'parent'), '[[Quantum Mechanics|QM]]')).toBeNull();
    expect(validateValue(p(kb, 'parent'), 'Quantum Mechanics')?.code).toBe('link');
    expect(validateValue(p(kb, 'parent'), '[[Note#Heading]]')?.code).toBe('heading');
    expect(validateValue(p(exercise, 'technique'), '[[Squat#Setup]]')).toBeNull();
  });

  it('list: every item is checked', () => {
    expect(validateValue(p(kb, 'related'), ['[[A]]', '[[B]]'])).toBeNull();
    expect(validateValue(p(kb, 'related'), ['[[A]]', 'B'])?.code).toBe('link');
    expect(validateValue(p(kb, 'related'), '[[A]]')?.code).toBe('type');
    expect(validateValue(p(kb, 'aliases'), ['x', 3])?.code).toBe('type');
  });

  it('pattern: the ID shape', () => {
    expect(validateValue(p(kb, 'id'), 'KB-2026-0143')).toBeNull();
    expect(validateValue(p(kb, 'id'), 'KB-000142')?.code).toBe('pattern');
    expect(validateValue(p(kb, 'breadcrumb'), 'Knowledge/Physics')).toBeNull();
    expect(validateValue(p(kb, 'breadcrumb'), '/Knowledge')?.code).toBe('pattern');
    expect(validateValue(p(kb, 'breadcrumb'), 'Knowledge/')?.code).toBe('pattern');
  });

  it('isEmpty: missing, null, empty text and empty lists', () => {
    for (const v of [undefined, null, '', []]) expect(isEmpty(v)).toBe(true);
    for (const v of [0, false, 'x', ['x']]) expect(isEmpty(v)).toBe(false);
  });
});

describe('file names that work on both macOS and Windows (rule 12)', () => {
  it('rejects the characters either system forbids', () => {
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0001b']) {
      expect(checkFileName(bad), bad).toMatch(/not allowed/);
    }
  });

  it('rejects Windows-only problems: trailing dot or space and device names', () => {
    expect(checkFileName('note.')).toMatch(/dot or a space/);
    expect(checkFileName('note ')).toMatch(/dot or a space/);
    expect(checkFileName('CON')).toMatch(/reserved/);
    expect(checkFileName('nul.txt')).toMatch(/reserved/);
    expect(checkFileName('lpt3')).toMatch(/reserved/);
  });

  it('rejects an empty or very long name and accepts ordinary ones', () => {
    expect(checkFileName('   ')).toMatch(/required/);
    expect(checkFileName('x'.repeat(201))).toMatch(/too long/);
    for (const ok of ['Wave-Particle Duality', 'Café notes', 'Q&A (draft)', 'Note 2026-10-20', 'a.b']) expect(checkFileName(ok), ok).toBeNull();
  });

  it('finds folders that differ only by case, and accent variants', () => {
    expect(caseCollisions(['Projects', 'projects', 'Tasks'])).toEqual([['Projects', 'projects']]);
    expect(caseCollisions(['Projects', 'Tasks'])).toEqual([]);
    expect(accentVariants(['Café', 'Café', 'Tasks'])).toHaveLength(1);
  });
});
