import { stringify } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFrontmatter } from '../src/core/frontmatter';
import { applyFixToText, bodyTags, checkNote, makeAllocator, runVaultCheck } from '../src/core/note-check';
import type { CheckContext, Finding, NoteInput, VaultReport } from '../src/core/note-check';
import type { Problem, ResolvedType, SchemaPack } from '../src/core/schema-types';
import { loadPack } from './helpers/pack';

let pack: SchemaPack;
const kb = () => pack.types.get('kb') as ResolvedType;
beforeAll(async () => {
  pack = await loadPack();
});

const BASE = {
  type: 'kb', schema: 2, id: 'KB-2026-0001', name: 'X', status: 'draft', breadcrumb: 'Knowledge/Physics',
  created: '2026-03-01T10:00', modified: '2026-03-02T10:00',
};

function note(basename: string, props: Record<string, unknown>, body = 'body\n', type = 'kb', ctime = Date.UTC(2026, 2, 1)): NoteInput {
  const merged: Record<string, unknown> = { ...BASE, name: basename, ...props };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return {
    path: `Knowledge/${basename}.md`,
    basename,
    text: `---\n${stringify(merged, { lineWidth: 0 })}---\n${body}`,
    ctime,
    type: pack.types.get(type) as ResolvedType,
  };
}

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  pack, now: new Date(2026, 9, 21, 9, 5), usedIds: [], retiredIds: [], known: {}, ...over,
});

const idOf = (n: NoteInput): string => {
  try {
    return (readFrontmatter(n.text)?.id as string | undefined) ?? '';
  } catch {
    return '';
  }
};

const run = (notes: NoteInput[], over: Partial<CheckContext> = {}, extra: { folderPaths?: string[]; schemaProblems?: Problem[] } = {}): VaultReport =>
  runVaultCheck(ctx({ usedIds: notes.map(idOf), ...over }), notes, {
    folderPaths: extra.folderPaths ?? [],
    schemaProblems: extra.schemaProblems ?? [],
  });

const codes = (r: VaultReport, path?: string) => r.findings.filter((f) => !path || f.path === path).map((f) => f.code);

/** Apply a fix to its base text and re-run the checks on the result. */
function afterFix(f: Finding, type: ResolvedType, label?: string) {
  const fix = label ? f.fixes.find((x) => x.label === label) : f.fixes[0];
  if (!fix) throw new Error(`no fix ${label ?? ''} on ${f.code}`);
  return applyFixToText(f.baseText, type, fix);
}

describe('check 1: required properties missing', () => {
  it('finds a missing ID and says which ID it will use', () => {
    const r = run([note('A', { id: undefined })]);
    const f = r.findings.find((x) => x.code === 'missing-id') as Finding;
    expect(f.message).toContain('KB-2026-0001');
    expect(f.fixes[0]?.diff).toEqual(['+ id: KB-2026-0001']);
  });

  it('gives two notes without an ID different numbers, after the IDs already used', () => {
    const r = run([note('A', { id: undefined }), note('B', { id: undefined }), note('C', { id: 'KB-2026-0007' })]);
    const ids = r.findings.filter((f) => f.code === 'missing-id').map((f) => f.fixes[0]?.diff[0]);
    expect(ids).toEqual(['+ id: KB-2026-0008', '+ id: KB-2026-0009']);
  });

  it('takes the ID year from created', () => {
    const r = run([note('A', { id: undefined, created: '2025-12-31T23:59' })]);
    expect(r.findings.find((f) => f.code === 'missing-id')?.fixes[0]?.diff[0]).toBe('+ id: KB-2025-0001');
  });

  it('lists an estimated created, taken from the file creation time', () => {
    const r = run([note('A', { created: undefined }, 'body\n', 'kb', new Date(2026, 4, 6, 7, 8).getTime())]);
    const f = r.findings.find((x) => x.code === 'missing-created') as Finding;
    expect(f.message).toContain('estimated');
    expect(f.fixes[0]?.diff).toEqual(['+ created: 2026-05-06T07:08']);
  });

  it('finds other missing required properties and adds what it can', () => {
    const r = run([note('A', { name: undefined, status: undefined, schema: undefined })]);
    const f = r.findings.find((x) => x.code === 'missing-required') as Finding;
    expect(f.message).toContain('name');
    expect(f.fixes[0]?.diff).toEqual(expect.arrayContaining(['+ name: A', '+ status: draft', '+ schema: 2']));
  });
});

describe('check 2: values outside their rules', () => {
  it('flags an enum value outside its list, with the allowed values as the fixes', () => {
    const r = run([note('A', { status: 'live' })]);
    const f = r.findings.find((x) => x.code === 'value-enum') as Finding;
    expect(f.fixes.map((x) => x.label)).toEqual(['draft', 'review', 'published', 'outdated', 'archived']);
    expect(readFrontmatter(afterFix(f, kb(), 'review'))?.status).toBe('review');
  });

  it('flags integer limits and wrong types, with no fix', () => {
    const task = (props: Record<string, unknown>) => note('T', { type: 'task', id: 'TK-2026-0001', status: 'todo', breadcrumb: undefined, ...props }, 'body\n', 'task');
    expect(codes(run([task({ priority: 9 })]))).toContain('value-max');
    expect(codes(run([task({ priority: 0 })]))).toContain('value-min');
    expect(codes(run([task({ priority: 'high' })]))).toContain('value-type');
    expect(run([task({ priority: 9 })]).findings.find((f) => f.code === 'value-max')?.fixes).toEqual([]);
  });

  it('flags a pattern failure and bad dates', () => {
    expect(codes(run([note('A', { review_last: 'soon' })]))).toContain('value-format');
    expect(codes(run([note('A', { created: '2026-03-01' })]))).toContain('value-format');
  });

  it('reports YAML it cannot read instead of guessing', () => {
    const bad: NoteInput = { ...note('A', {}), text: '---\na: [unclosed\n---\nbody\n' };
    const r = run([bad]);
    expect(codes(r)).toEqual(['invalid-yaml']);
  });
});

describe('check 3: IDs', () => {
  it('finds duplicates: the older note keeps its ID, the newer one is renumbered with a preview', () => {
    const a = note('Older', { id: 'KB-2026-0010', created: '2026-01-01T10:00' });
    const b = note('Newer', { id: 'KB-2026-0010', created: '2026-02-01T10:00' });
    const c = note('Other', { id: 'KB-2026-0011', created: '2026-01-05T10:00' });
    const r = run([a, b, c]);
    const dup = r.findings.filter((f) => f.code === 'duplicate-id');
    expect(dup).toHaveLength(1);
    expect(dup[0]?.path).toBe(b.path);
    expect(dup[0]?.fixes[0]?.diff).toEqual(['id: KB-2026-0010 → KB-2026-0012']);
    expect(dup[0]?.fixes[0]?.retire).toEqual(['KB-2026-0010']);
  });

  it('does not hand a renumbered note an ID that another fix is about to give out', () => {
    const a = note('Older', { id: 'KB-2026-0010', created: '2026-01-01T10:00' });
    const b = note('Newer', { id: 'KB-2026-0010', created: '2026-02-01T10:00' });
    const noId = note('NoId', { id: undefined });
    const r = run([a, b, noId]);
    const given = r.findings.flatMap((f) => f.fixes.flatMap((x) => x.diff.filter((d) => /KB-2026-\d+/.test(d))));
    const ids = given.map((d) => /KB-2026-\d{4}$/.exec(d)?.[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never reuses a retired ID', () => {
    const a = note('Older', { id: 'KB-2026-0010', created: '2026-01-01T10:00' });
    const b = note('Newer', { id: 'KB-2026-0010', created: '2026-02-01T10:00' });
    const r = run([a, b], { retiredIds: ['KB-2026-0011'] });
    expect(r.findings.find((f) => f.code === 'duplicate-id')?.fixes[0]?.diff[0]).toBe('id: KB-2026-0010 → KB-2026-0012');
  });

  it('converts an old ID with a preview: year from created, number kept', () => {
    const r = run([note('Credit', { id: 'KB-000146', created: '2026-02-03T09:00', schema: 2 })]);
    const f = r.findings.find((x) => x.code === 'old-id') as Finding;
    expect(f.fixes[0]?.diff).toEqual(['id: KB-000146 → KB-2026-0146']);
  });

  it('reports a malformed ID without offering to change it', () => {
    const f = run([note('A', { id: 'whatever' })]).findings.find((x) => x.code === 'malformed-id') as Finding;
    expect(f.fixes).toEqual([]);
  });

  it('warns when the ID year differs from the created year, and changes nothing', () => {
    const f = run([note('A', { id: 'KB-2025-0001', created: '2026-03-01T10:00' })]).findings.find((x) => x.code === 'id-year') as Finding;
    expect(f.severity).toBe('warning');
    expect(f.fixes).toEqual([]);
  });
});

describe('check 4: tags', () => {
  it('finds a synonym and replaces it after approval, showing old and new', () => {
    const f = run([note('A', { tags: ['sop', 'idea'] })]).findings.find((x) => x.code === 'tag-synonym') as Finding;
    expect(f.message).toContain('“sop” is a synonym of “procedure”');
    expect(readFrontmatter(afterFix(f, kb()))?.tags).toEqual(['procedure', 'idea']);
  });

  it('finds an unknown tag and offers a one-click vocabulary add', () => {
    const f = run([note('A', { tags: ['mystery'] })]).findings.find((x) => x.code === 'tag-unknown') as Finding;
    expect(f.fixes[0]).toMatchObject({ kind: 'vocabulary', vocabulary: { name: 'tags', term: 'mystery' } });
  });

  it('reports body tags but only changes them with approval, and ignores code and headings', () => {
    const body = '# Heading\nSome #sop text and #ghost and #idea.\n\n```\n#ignored\n```\nand `#inline` and a#b and #123 and https://x.com/#frag\n';
    expect(bodyTags(`---\ntype: kb\n---\n${body}`)).toEqual(['sop', 'ghost', 'idea']);
    const r = run([note('A', {}, body)]);
    expect(codes(r)).toEqual(expect.arrayContaining(['body-tag-synonym', 'body-tag-unknown']));
    expect(codes(r)).not.toContain('tag-synonym'); // the property is fine
    const syn = r.findings.find((f) => f.code === 'body-tag-synonym') as Finding;
    const out = afterFix(syn, kb());
    expect(out).toContain('Some #procedure text and #ghost and #idea.');
    expect(out).toContain('#ignored');
    expect(r.findings.find((f) => f.code === 'body-tag-unknown')?.fixes).toEqual([]);
  });
});

describe('checks 5 and 6: name and breadcrumb', () => {
  it('finds a name that differs from the file name and offers to fix it', () => {
    const n = { ...note('Wave', {}), text: note('Wave', { name: 'Other' }).text };
    const f = run([n]).findings.find((x) => x.code === 'name-mismatch') as Finding;
    expect(f.severity).toBe('warning');
    expect(readFrontmatter(afterFix(f, kb()))?.name).toBe('Wave');
  });

  it('warns about a missing breadcrumb and one that maps to no schema, never an error', () => {
    const missing = run([note('A', { breadcrumb: undefined })]).findings.find((x) => x.code === 'no-breadcrumb') as Finding;
    const unmapped = run([note('B', { breadcrumb: 'Nonsense/x' })]).findings.find((x) => x.code === 'breadcrumb-unmapped') as Finding;
    expect(missing.severity).toBe('warning');
    expect(unmapped.severity).toBe('warning');
    expect(missing.fixes).toEqual([]);
  });

  it('does not warn about a difference between the breadcrumb and the real folder', () => {
    const n = { ...note('A', { breadcrumb: 'Projects/Alpha' }), path: 'Inbox/A.md' };
    expect(codes(run([n]))).not.toContain('breadcrumb-unmapped');
  });

  it('flags an odd breadcrumb shape', () => {
    expect(codes(run([note('A', { breadcrumb: '/Knowledge/' })]))).toContain('odd-breadcrumb');
  });

  it('does not ask for a breadcrumb on types that have none', () => {
    const t = note('T', { type: 'task', id: 'TK-2026-0001', status: 'todo', breadcrumb: undefined }, 'body\n', 'task');
    expect(codes(run([t]))).not.toContain('no-breadcrumb');
  });
});

describe('check 7: older schema version (migration)', () => {
  const OLD = {
    schema: 1, id: 'KB-000146', created: '2026-02-03T09:00', modified: '2026-02-04T09:00',
    source: { title: 'Lectures', author: 'Feynman', url: 'https://example.com', accessed: '2026-01-01' },
    review: { cycle: '3-months', last: '2026-01-01', next: '2026-04-01' },
    domain: 'Knowledge', domain_path: 'Knowledge/Risk', breadcrumb: 'Knowledge/Risk',
  };

  it('offers a migration with an exact diff', () => {
    const f = run([note('Credit', OLD)]).findings.find((x) => x.code === 'old-schema') as Finding;
    expect(f.message).toBe('schema 1 → 2');
    const diff = f.fixes[0]?.diff ?? [];
    expect(diff).toEqual(expect.arrayContaining([
      'id: KB-000146 → KB-2026-0146',
      '+ source_title: Lectures',
      '+ source_author: Feynman',
      '+ review_cycle: 3-months',
      '- source: {"title":"Lectures","author":"Feynman","url":"https://example.com","accessed":"2026-01-01"}',
      '- domain: Knowledge',
      '- domain_path: Knowledge/Risk',
      'schema: 1 → 2',
    ]));
  });

  it('after the migration the note has no schema problems left', () => {
    const f = run([note('Credit', OLD)]).findings.find((x) => x.code === 'old-schema') as Finding;
    const migrated = { ...note('Credit', OLD), text: afterFix(f, kb()) };
    expect(codes(run([migrated]))).toEqual([]);
  });
});

describe('check 8: leftover domain', () => {
  it('offers removal only when domain repeats the breadcrumb', () => {
    const repeats = run([note('A', { domain: 'Knowledge', breadcrumb: 'Knowledge/Physics' })]).findings.find((x) => x.code === 'leftover-domain') as Finding;
    expect(repeats.fixes[0]?.diff).toEqual(['- domain: Knowledge']);
    const different = run([note('B', { domain: 'Finance', breadcrumb: 'Knowledge/Physics' })]).findings.find((x) => x.code === 'leftover-domain') as Finding;
    expect(different.fixes).toEqual([]);
  });
});

describe('check 9: timestamps and changed IDs', () => {
  it('flags created later than modified', () => {
    expect(codes(run([note('A', { created: '2026-05-01T10:00', modified: '2026-04-01T10:00' })]))).toContain('created-after-modified');
  });

  it('notices an ID or created that looks changed outside the plugin, using the local index', () => {
    const n = note('A', { id: 'KB-2026-0005', created: '2026-03-01T10:00' });
    const r = run([n], { known: { [n.path]: { id: 'KB-2026-0004', created: '2026-02-01T10:00' } } });
    const idF = r.findings.find((f) => f.code === 'id-changed') as Finding;
    const crF = r.findings.find((f) => f.code === 'created-changed') as Finding;
    expect(idF.fixes.map((x) => x.label)).toEqual(['Restore KB-2026-0004', 'Accept the new ID']);
    expect(readFrontmatter(afterFix(idF, kb(), 'Restore KB-2026-0004'))?.id).toBe('KB-2026-0004');
    expect(crF.fixes[1]?.accept).toEqual({ created: '2026-03-01T10:00' });
  });

  it('is quiet when the index agrees or has no entry', () => {
    const n = note('A', {});
    expect(codes(run([n], { known: { [n.path]: { id: 'KB-2026-0001', created: '2026-03-01T10:00' } } }))).toEqual([]);
    expect(codes(run([n]))).toEqual([]);
  });
});

describe('checks 10 and 11: folders and schema problems', () => {
  it('finds folders that differ only by case, among siblings', () => {
    const r = run([], {}, { folderPaths: ['Projects', 'projects', 'Tasks', 'Tasks/a', 'Tasks/A', 'Other/x'] });
    expect(r.globalFindings.filter((g) => g.check === 10).map((g) => g.message)).toEqual([
      expect.stringContaining('“Projects” and “projects”'),
      expect.stringContaining('“Tasks/A” and “Tasks/a”'),
    ]);
  });

  it('reports schema problems with their file and line, including type conflicts and shared folders', () => {
    const problems: Problem[] = [
      { severity: 'error', code: 'yaml-syntax', file: 'types/kb.yaml', line: 4, message: 'Invalid YAML' },
      { severity: 'error', code: 'type-conflict', file: 'types/task.yaml', line: 9, message: 'Property "x" is integer here but string elsewhere' },
      { severity: 'warning', code: 'folder-conflict', file: 'registry/folders.yaml', message: 'Folder "Projects" is claimed by several types' },
    ];
    const g = run([], {}, { schemaProblems: problems }).globalFindings.filter((x) => x.check === 11);
    expect(g.map((x) => [x.severity, x.code, x.file, x.line])).toEqual([
      ['problem', 'yaml-syntax', 'types/kb.yaml', 4],
      ['problem', 'type-conflict', 'types/task.yaml', 9],
      ['warning', 'folder-conflict', 'registry/folders.yaml', undefined],
    ]);
  });
});

describe('the report', () => {
  const seeded = () => [
    note('Capital', { id: 'KB-2026-0001', tags: ['sop'] }),
    note('Contract', { id: undefined, status: 'live' }),
    note('Clean', { id: 'KB-2026-0002' }),
  ];

  it('counts notes scanned and notes that need attention', () => {
    const r = run(seeded());
    expect(r.scanned).toBe(3);
    expect(r.notesWithFindings).toBe(2);
  });

  it('changes nothing: the inputs are untouched and every finding carries the text it was made from', () => {
    const before = seeded().map((n) => n.text);
    const r = run(seeded());
    expect(seeded().map((n) => n.text)).toEqual(before);
    for (const f of r.findings) expect(before).toContain(f.baseText);
  });

  it('every frontmatter fix resolves its own finding (and only changes what its preview says)', () => {
    const notes = [
      note('A', { id: undefined }), note('B', { id: 'KB-2026-0002', status: 'live' }), note('C', { id: 'KB-2026-0003', tags: ['sop'] }),
      note('D', { id: 'KB-2026-0004', breadcrumb: 'Knowledge', domain: 'Knowledge' }),
      note('E', { id: 'KB-000146' }), note('F', { id: 'KB-2026-0005' }), note('G', { id: 'KB-2026-0006', created: undefined }),
    ];
    notes[5] = { ...note('F', { id: 'KB-2026-0005', name: 'Wrong' }), basename: 'F' };
    const r = run(notes);
    let tested = 0;
    for (const f of r.findings) {
      for (const fix of f.fixes.filter((x) => x.kind === 'frontmatter')) {
        const type = notes.find((n) => n.path === f.path)?.type as ResolvedType;
        const text = applyFixToText(f.baseText, type, fix);
        expect(text, `${f.code}/${fix.label}`).not.toBe(f.baseText);
        const again = checkNote(ctx({ usedIds: [] }), { ...(notes.find((n) => n.path === f.path) as NoteInput), text }, makeAllocator([], []));
        expect(again.map((x) => x.code), `${f.code}/${fix.label} should resolve itself`).not.toContain(f.code);
        tested++;
      }
    }
    expect(tested).toBeGreaterThanOrEqual(8);
  });

  it('finds a seeded problem for each of the eleven checks', () => {
    const notes = [
      note('One', { id: undefined }), // 1
      note('Two', { id: 'KB-2026-0102', status: 'live' }), // 2
      note('Three', { id: 'KB-000146' }), // 3
      note('Four', { id: 'KB-2026-0104', tags: ['sop'] }), // 4
      { ...note('Five', { id: 'KB-2026-0105', name: 'Else' }), basename: 'Five' }, // 5
      note('Six', { id: 'KB-2026-0106', breadcrumb: undefined }), // 6
      note('Seven', { id: 'KB-2026-0107', schema: 1 }), // 7
      note('Eight', { id: 'KB-2026-0108', domain: 'Knowledge' }), // 8
      note('Nine', { id: 'KB-2026-0109', created: '2026-09-01T00:00', modified: '2026-08-01T00:00' }), // 9
    ];
    const r = run(notes, {}, {
      folderPaths: ['Projects', 'projects'], // 10
      schemaProblems: [{ severity: 'error', code: 'yaml-syntax', file: 'types/kb.yaml', line: 1, message: 'bad' }], // 11
    });
    const checks = new Set([...r.findings.map((f) => f.check), ...r.globalFindings.map((g) => g.check)]);
    expect([...checks].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('a note on a newer schema than this plugin knows (spec: read-only)', () => {
  it('is reported with no fix and no migration is offered', () => {
    const r = run([note('Future', { schema: 3 })]);
    const f = r.findings.find((x) => x.code === 'newer-schema') as Finding;
    expect(f.check).toBe(7);
    expect(f.fixes).toEqual([]);
    expect(f.message).toContain('read-only');
    expect(codes(r)).not.toContain('old-schema');
  });
});
