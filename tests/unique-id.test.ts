import { stringify } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { planConversion } from '../src/core/convert';
import { newNoteFrontmatter, planCompletion } from '../src/core/create';
import { editFrontmatter, readFrontmatter } from '../src/core/frontmatter';
import { applyFixToText, checkNote, checkUniqueDuplicates, makeAllocator, makeUniqueAllocator, runVaultCheck } from '../src/core/note-check';
import type { CheckContext, Finding, NoteInput } from '../src/core/note-check';
import type { ResolvedType, SchemaPack } from '../src/core/schema-types';
import {
  applyUniqueId, formatUniqueId, nextUniqueId, nextUniqueNumber, parseUniqueId, planUniqueId, planUniqueRenumbering, uniqueScope,
} from '../src/core/unique-id';
import { load, loadPack, loadWith, packFiles } from './helpers/pack';

let pack: SchemaPack;
const lesson = () => pack.types.get('lesson') as ResolvedType;
beforeAll(async () => {
  pack = await loadPack();
});
const NOW = new Date(2026, 9, 25, 9, 0);

describe('format and parsing', () => {
  it('formats TYPE-DOMAIN-YEAR-NNNN with at least four digits', () => {
    expect(formatUniqueId('KB', 'PH', 2026, 1)).toBe('KB-PH-2026-0001');
    expect(formatUniqueId('KB', 'PH', 2026, 12345)).toBe('KB-PH-2026-12345');
  });

  it('parses its own format and nothing else (the global id is different)', () => {
    expect(parseUniqueId('KB-PH-2026-0042')).toEqual({ typePrefix: 'KB', domainPrefix: 'PH', year: 2026, num: 42 });
    for (const bad of ['KB-2026-0042', 'KB-PH-26-0042', 'kb-ph-2026-0042', 'KB-PHY-2026-0042', 'KB-PH-2026-42', '', 7, null, undefined]) {
      expect(parseUniqueId(bad), String(bad)).toBeNull();
    }
  });
});

describe('scope', () => {
  it('needs a type with a unique_id property and a domain with a declared prefix', () => {
    expect(uniqueScope(lesson(), 'maths')).toEqual({ typePrefix: 'LS', domainPrefix: 'MA', domain: 'maths' });
    expect(uniqueScope(lesson(), 'general')?.domainPrefix).toBe('GE');
    expect(uniqueScope(lesson(), 'physics')).toBeNull(); // no prefix declared
    expect(uniqueScope(lesson(), undefined)).toBeNull();
    expect(uniqueScope(pack.types.get('kb') as ResolvedType, 'maths')).toBeNull(); // kb has no unique_id
  });
});

describe('allocation: one counter per type, domain and year', () => {
  const used = ['KB-PH-2026-0003', 'KB-PH-2026-0001', 'KB-MA-2026-0009', 'KB-PH-2025-0050', 'EX-PH-2026-0020', 'KB-2026-0100'];
  it('is one more than the highest in the same type, domain and year', () => {
    expect(nextUniqueNumber('KB', 'PH', 2026, used)).toBe(4);
    expect(nextUniqueId('KB', 'MA', 2026, used)).toBe('KB-MA-2026-0010');
    expect(nextUniqueId('KB', 'PH', 2027, used)).toBe('KB-PH-2027-0001'); // a new year restarts
    expect(nextUniqueId('EX', 'MA', 2026, used)).toBe('EX-MA-2026-0001'); // another type, another counter
  });

  it('is not disturbed by the global id counter, and does not disturb it', () => {
    expect(nextUniqueNumber('KB', 'PH', 2026, ['KB-2026-0100'])).toBe(1);
  });

  it('never reuses a retired value', () => {
    expect(nextUniqueId('KB', 'PH', 2026, ['KB-PH-2026-0001'], ['KB-PH-2026-0005'])).toBe('KB-PH-2026-0006');
  });
});

describe('what a note’s unique ID should be', () => {
  const alloc = makeUniqueAllocator(['LS-MA-2026-0002'], []);
  it('is issued when missing and the domain has a prefix', () => {
    expect(planUniqueId({ domain: 'maths' }, lesson(), alloc, 2026)).toEqual({ to: 'LS-MA-2026-0003' });
  });

  it('is left alone when it already names the note’s type and domain', () => {
    expect(planUniqueId({ domain: 'maths', unique_id: 'LS-MA-2026-0001' }, lesson(), alloc, 2026)).toBeNull();
  });

  it('is issued again when the domain changed, remembering the old value', () => {
    const change = planUniqueId({ domain: 'general', unique_id: 'LS-MA-2026-0001' }, lesson(), makeUniqueAllocator([], []), 2026);
    expect(change).toEqual({ to: 'LS-GE-2026-0001', from: 'LS-MA-2026-0001' });
  });

  it('is issued again when the type changed', () => {
    const change = planUniqueId({ domain: 'maths', unique_id: 'KB-MA-2026-0001' }, lesson(), makeUniqueAllocator([], []), 2026);
    expect(change).toEqual({ to: 'LS-MA-2026-0001', from: 'KB-MA-2026-0001' });
  });

  it('never overwrites a value that is not a unique ID, and does nothing without a domain prefix', () => {
    expect(planUniqueId({ domain: 'maths', unique_id: 'whatever' }, lesson(), alloc, 2026)).toBeNull();
    expect(planUniqueId({ domain: 'physics' }, lesson(), alloc, 2026)).toBeNull();
    expect(planUniqueId({}, lesson(), alloc, 2026)).toBeNull();
  });

  it('writes the new value and keeps the old one in archived_fields (nothing is deleted)', () => {
    const fm: Record<string, unknown> = { domain: 'general', unique_id: 'LS-MA-2026-0001' };
    applyUniqueId(fm, { to: 'LS-GE-2026-0001', from: 'LS-MA-2026-0001' }, lesson(), NOW);
    expect(fm.unique_id).toBe('LS-GE-2026-0001');
    expect(fm.archived_fields).toEqual([{ type: 'lesson', date: '2026-10-25', values: { unique_id: 'LS-MA-2026-0001' } }]);
    applyUniqueId(fm, { to: 'LS-GE-2026-0002', from: 'LS-GE-2026-0001' }, lesson(), NOW);
    expect((fm.archived_fields as unknown[]).length).toBe(2);
  });
});

describe('duplicates', () => {
  it('the older note keeps the value, the newer gets the next free number', () => {
    const plan = planUniqueRenumbering([
      { path: 'a.md', id: 'LS-MA-2026-0001', created: '2026-01-01T10:00' },
      { path: 'b.md', id: 'LS-MA-2026-0001', created: '2026-02-01T10:00' },
      { path: 'c.md', id: 'LS-MA-2026-0004', created: '2026-03-01T10:00' },
    ]);
    expect(plan).toEqual([{ path: 'b.md', from: 'LS-MA-2026-0001', to: 'LS-MA-2026-0005' }]);
  });
});

describe('new notes', () => {
  it('get a unique ID in schema order, from the default domain, with its own counter', () => {
    const fm = newNoteFrontmatter(lesson(), {
      name: 'N', id: 'LS-2026-0001', now: NOW,
      allocateUnique: (tp, dp, y) => nextUniqueId(tp, dp, y, ['LS-GE-2026-0004']),
    });
    expect(fm.domain).toBe('general');
    expect(fm.unique_id).toBe('LS-GE-2026-0005');
    const keys = Object.keys(fm);
    expect(keys.indexOf('unique_id')).toBe(keys.indexOf('domain') + 1);
    expect(keys.slice(-2)).toEqual(['created', 'modified']);
  });

  it('get none when the type has no unique_id, or nothing is allocating', () => {
    expect(newNoteFrontmatter(pack.types.get('kb') as ResolvedType, { name: 'N', id: 'KB-2026-0001', now: NOW, allocateUnique: () => 'X' })).not.toHaveProperty('unique_id');
    expect(newNoteFrontmatter(lesson(), { name: 'N', id: 'LS-2026-0001', now: NOW })).not.toHaveProperty('unique_id');
  });

  it('completion adds a missing unique ID from the note’s own domain and never changes an existing one', () => {
    const alloc = (tp: string, dp: string, y: number) => nextUniqueId(tp, dp, y, []);
    const add = planCompletion({ type: 'lesson', domain: 'maths', created: '2025-03-01T10:00' }, lesson(), { name: 'N', now: NOW, allocateId: () => 'LS-2025-0001', allocateUnique: alloc });
    expect(add.added.unique_id).toBe('LS-MA-2025-0001'); // the year of created
    const keep = planCompletion({ type: 'lesson', domain: 'maths', unique_id: 'LS-GE-2026-0007' }, lesson(), { name: 'N', now: NOW, allocateId: () => 'LS-2026-0001', allocateUnique: alloc });
    expect(keep.added).not.toHaveProperty('unique_id');
  });
});

describe('conversion between types that both have a unique ID', () => {
  it('issues it again for the new type and archives the old one', async () => {
    // kb opts in to the curriculum module here, so both ends have domain and unique_id
    const r = await loadWith({ 'types/kb.yaml': (t) => t.replace('uses: [base, findability, taxonomy, relations, provenance, review]', 'uses: [base, findability, taxonomy, relations, provenance, review, curriculum]') });
    expect(r.problems).toEqual([]);
    const both = r.pack as SchemaPack;
    const kb = both.types.get('kb') as ResolvedType;
    const ls = both.types.get('lesson') as ResolvedType;
    const fm = { type: 'lesson', schema: 1, id: 'LS-2026-0001', name: 'N', status: 'draft', domain: 'maths', unique_id: 'LS-MA-2026-0003', section: 'maths-algebra', level: 'beginner', order: 10, track: [], created: '2026-10-01T10:00', modified: '2026-10-01T10:00' };
    const plan = planConversion(fm, ls, kb, NOW, { allocateUnique: makeUniqueAllocator(['KB-MA-2026-0006'], []) });
    expect(plan.added.unique_id).toBe('KB-MA-2026-0007');
    expect(plan.archived.unique_id).toBe('LS-MA-2026-0003');
    expect(plan.kept).not.toContain('unique_id');
    const out: Record<string, unknown> = { ...fm };
    plan.apply(out);
    expect(out.unique_id).toBe('KB-MA-2026-0007');
    expect(out.id).toBe('LS-2026-0001'); // the global id is kept
    expect(JSON.stringify(out.archived_fields)).toContain('LS-MA-2026-0003');
  });

  it('a type without unique_id archives it, as any property that no longer applies', () => {
    const fm = { type: 'lesson', schema: 1, id: 'LS-2026-0001', name: 'N', status: 'draft', domain: 'maths', unique_id: 'LS-MA-2026-0003', created: '2026-10-01T10:00', modified: '2026-10-01T10:00' };
    const plan = planConversion(fm, lesson(), pack.types.get('kb') as ResolvedType, NOW, { allocateUnique: makeUniqueAllocator([], []) });
    expect(plan.archived.unique_id).toBe('LS-MA-2026-0003');
    expect(plan.added).not.toHaveProperty('unique_id');
  });

  it('without an allocator nothing about unique IDs changes (existing behaviour)', () => {
    const fm = { type: 'lesson', domain: 'maths', unique_id: 'LS-MA-2026-0003' };
    const plan = planConversion(fm, lesson(), pack.types.get('kb') as ResolvedType, NOW);
    expect(plan.added).not.toHaveProperty('unique_id');
  });
});

describe('the schema declares the prefixes', () => {
  const edit = (from: string, to: string) => loadWith({ 'modules/curriculum.yaml': (t) => t.replace(from, to) });
  const codes = async (from: string, to: string) => (await edit(from, to)).problems.filter((p) => p.severity === 'error').map((p) => p.code);

  it('the starter pack declares two-letter prefixes next to the domain values', () => {
    expect(pack.types.get('lesson')?.byName.get('domain')?.prefixes).toEqual({ general: 'GE', maths: 'MA' });
  });

  it('rejects a prefix that is not two capital letters', async () => {
    expect(await codes('{general: GE, maths: MA}', '{general: GE, maths: Mat}')).toContain('prefixes');
    expect(await codes('{general: GE, maths: MA}', '{general: GE, maths: ma}')).toContain('prefixes');
  });

  it('rejects two domains with the same prefix', async () => {
    expect(await codes('{general: GE, maths: MA}', '{general: MA, maths: MA}')).toContain('prefixes');
  });

  it('rejects a prefix for a value the property does not have', async () => {
    expect(await codes('{general: GE, maths: MA}', '{general: GE, maths: MA, physics: PH}')).toContain('prefixes');
  });

  it('a type with a unique_id whose domain has no prefixes is an error', async () => {
    expect(await codes('    prefixes: {general: GE, maths: MA}\n', '')).toContain('unique-id-prefixes');
  });

  it('warns that prefixes only apply to an enum', async () => {
    const r = await load(new Map([...packFiles()].map(([k, v]) => [k, k === 'modules/curriculum.yaml' ? v.replace('  topic:\n    type: string\n', '  topic:\n    type: string\n    prefixes: {a: AA}\n') : v])));
    expect(r.problems.some((p) => p.code === 'unknown-attribute' && p.message.includes('prefixes'))).toBe(true);
  });

  it('a domain without a prefix is allowed: it just has no unique IDs', async () => {
    const r = await edit('{general: GE, maths: MA}', '{general: GE}');
    expect(r.problems).toEqual([]);
    expect(uniqueScope((r.pack as SchemaPack).types.get('lesson') as ResolvedType, 'maths')).toBeNull();
  });
});

describe('the vault check', () => {
  const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({ pack, now: NOW, usedIds: [], usedUniqueIds: [], retiredIds: [], known: {}, ...over });
  const BASE = { type: 'lesson', schema: 1, id: 'LS-2026-0001', name: 'X', status: 'draft', domain: 'maths', section: 'maths-algebra', level: 'beginner', order: 10, created: '2026-03-01T10:00', modified: '2026-03-02T10:00' };
  const note = (name: string, props: Record<string, unknown>): NoteInput => {
    const merged: Record<string, unknown> = { ...BASE, name, ...props };
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    return { path: `Lessons/${name}.md`, basename: name, text: `---\n${stringify(merged, { lineWidth: 0 })}---\nbody\n`, ctime: Date.UTC(2026, 2, 1), type: lesson() };
  };
  const find = (n: NoteInput, used: string[] = []): Finding[] =>
    checkNote(ctx(), n, makeAllocator([], []), makeUniqueAllocator(used, []));
  const codes = (fs: Finding[]) => fs.map((f) => f.code);

  it('a note with the right unique ID has no finding about it', () => {
    expect(codes(find(note('A', { unique_id: 'LS-MA-2026-0001' })))).not.toContain('missing-unique-id');
    expect(codes(find(note('A', { unique_id: 'LS-MA-2026-0001' })))).not.toContain('unique-id-mismatch');
  });

  it('finds a missing unique ID and offers to assign the next free one', () => {
    const f = find(note('A', {}), ['LS-MA-2026-0004']).find((x) => x.code === 'missing-unique-id');
    expect(f?.message).toContain('LS-MA-2026-0005');
    const fixed = readFrontmatter(applyFixToText(f?.baseText as string, lesson(), f?.fixes[0] as never));
    expect(fixed?.unique_id).toBe('LS-MA-2026-0005');
    expect(Object.keys(fixed ?? {}).indexOf('unique_id')).toBe(Object.keys(fixed ?? {}).indexOf('domain') + 1);
  });

  it('does not ask for one when the domain has no prefix', () => {
    expect(codes(find(note('A', { domain: 'physics' })))).not.toContain('missing-unique-id');
  });

  it('reports a malformed unique ID and offers no fix (it is never overwritten)', () => {
    const f = find(note('A', { unique_id: 'nonsense' })).find((x) => x.code === 'malformed-unique-id');
    expect(f).toBeDefined();
    expect(f?.fixes).toEqual([]);
  });

  it('finds a unique ID that names another domain, and issues it again keeping the old one', () => {
    const f = find(note('A', { domain: 'general', unique_id: 'LS-MA-2026-0001' })).find((x) => x.code === 'unique-id-mismatch');
    expect(f?.message).toContain('LS-GE-2026-0001');
    const fix = f?.fixes[0];
    expect(fix?.retire).toEqual(['LS-MA-2026-0001']);
    const out = readFrontmatter(applyFixToText(f?.baseText as string, lesson(), fix as never));
    expect(out?.unique_id).toBe('LS-GE-2026-0001');
    expect(JSON.stringify(out?.archived_fields)).toContain('LS-MA-2026-0001');
  });

  it('finds duplicates; the older note keeps its value, the newer is renumbered', () => {
    const a = note('Older', { unique_id: 'LS-MA-2026-0001', created: '2026-01-01T10:00' });
    const b = note('Newer', { unique_id: 'LS-MA-2026-0001', created: '2026-02-01T10:00' });
    const out = checkUniqueDuplicates(ctx({ usedUniqueIds: ['LS-MA-2026-0001', 'LS-MA-2026-0001'] }), [a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBe('Lessons/Newer.md');
    expect(out[0]?.message).toContain('LS-MA-2026-0002');
    const fixed = readFrontmatter(applyFixToText(b.text, lesson(), out[0]?.fixes[0] as never));
    expect(fixed?.unique_id).toBe('LS-MA-2026-0002');
  });

  it('runs as part of the whole check, and two missing IDs in one scan get different numbers', () => {
    const a = note('A', {});
    const b = note('B', {});
    const report = runVaultCheck(ctx(), [a, b], { folderPaths: [], schemaProblems: [] });
    const messages = report.findings.filter((f) => f.code === 'missing-unique-id').map((f) => f.message);
    expect(messages).toHaveLength(2);
    expect(new Set(messages).size).toBe(2);
  });

  it('a type without unique_id is never asked for one', () => {
    const kb = pack.types.get('kb') as ResolvedType;
    const n: NoteInput = { path: 'Knowledge/K.md', basename: 'K', text: `---\ntype: kb\nschema: 2\nid: KB-2026-0001\nname: K\nstatus: draft\ncreated: 2026-03-01T10:00\nmodified: 2026-03-01T10:00\n---\n`, ctime: 0, type: kb };
    expect(codes(checkNote(ctx(), n, makeAllocator([], []), makeUniqueAllocator([], [])))).not.toContain('missing-unique-id');
  });

  it('editFrontmatter keeps the note’s other properties when the fix is applied', () => {
    const t = note('A', { domain: 'general', unique_id: 'LS-MA-2026-0001', topic: 'groups' });
    const out = editFrontmatter(t.text, (d) => applyUniqueId(d, { to: 'LS-GE-2026-0001', from: 'LS-MA-2026-0001' }, lesson(), NOW)).text;
    expect(readFrontmatter(out)?.topic).toBe('groups');
  });
});
