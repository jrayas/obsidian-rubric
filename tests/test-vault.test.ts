import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { domainOf, typeFor } from '../src/core/domain-overrides';
import { readFrontmatter } from '../src/core/frontmatter';
import { runVaultCheck } from '../src/core/note-check';
import type { Finding, NoteInput } from '../src/core/note-check';
import { PREVIEW_MARKER, renderAllPreviews } from '../src/core/schema-preview';
import type { SchemaPack } from '../src/core/schema-types';
import { load } from './helpers/pack';

const ROOT = join(__dirname, '..');
let dir = '';
let pack: SchemaPack;
const notes: NoteInput[] = [];
let findings: Finding[] = [];

function walk(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(dir, p).split(sep).join('/');

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rubric-test-vault-'));
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'create-test-vault.mjs'), dir, '--no-plugin'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the vault builder failed: ${r.stderr || r.stdout}`);
  const schema = new Map<string, string>();
  const base = join(dir, '_schema');
  for (const p of walk(base)) if (p.endsWith('.yaml')) schema.set(relative(base, p).split(sep).join('/'), readFileSync(p, 'utf8'));
  const loaded = await load(schema);
  if (!loaded.pack) throw new Error('the vault schema failed to load: ' + JSON.stringify(loaded.problems));
  pack = loaded.pack;
  for (const p of walk(dir)) {
    const path = rel(p);
    if (!path.endsWith('.md') || /^(_schema|Templates|Archive|Inbox)\//.test(path) || path === 'START HERE.md' || path === 'Knowledge/Blank note.md') continue;
    const text = readFileSync(p, 'utf8');
    let fm;
    try {
      fm = readFrontmatter(text);
    } catch {
      continue;
    }
    const typeName = typeof fm?.type === 'string' ? fm.type : '';
    const type = typeFor(pack, typeName, domainOf(fm));
    if (type) notes.push({ path, basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path, text, ctime: statSync(p).ctimeMs, type });
  }
  const ids = notes.map((n) => readFrontmatter(n.text)?.id).filter((v): v is string => typeof v === 'string');
  const uniques = notes.map((n) => readFrontmatter(n.text)?.unique_id).filter((v): v is string => typeof v === 'string');
  findings = runVaultCheck({ pack, now: new Date(2026, 9, 25, 9, 0), usedIds: ids, usedUniqueIds: uniques, retiredIds: [], known: {} }, notes, { folderPaths: [], schemaProblems: [] }).findings;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const codesFor = (path: string) => findings.filter((f) => f.path === path).map((f) => f.code);

describe('the test vault', () => {
  it('its schema loads with no problems and has every domain', () => {
    expect(pack.domains).toEqual(['general', 'maths', 'physics', 'pcb', 'embedded']);
    expect(pack.typeNames).toHaveLength(11);
  });

  it('has an example in every type and every domain', () => {
    const types = new Set(notes.map((n) => readFrontmatter(n.text)?.type));
    for (const t of pack.typeNames) expect(types.has(t), t).toBe(true);
    const domains = new Set(notes.map((n) => readFrontmatter(n.text)?.domain).filter(Boolean));
    for (const d of pack.domains) expect(domains.has(d), d).toBe(true);
  });

  it('every example outside Knowledge/Problems/ passes the vault check with no finding', () => {
    const examples = notes.filter((n) => !n.path.startsWith('Knowledge/Problems/'));
    expect(examples.map((n) => n.path).sort()).toEqual([
      'Examples/maths/Limit of one over n.md', 'Exercises/maths/Prove the triangle inequality.md', 'Exercises/pcb/Size a decoupling capacitor.md',
      'Journal/2026-10-20.md', 'Knowledge/embedded/Interrupt latency.md', 'Knowledge/general/Getting started.md', 'Knowledge/maths/Limits.md',
      'Knowledge/maths/Triangle inequality.md', 'Knowledge/pcb/Decoupling capacitors.md', 'Knowledge/physics/Second law of motion.md',
      'Notes/Loose idea.md', 'People/Ann Lee.md', 'Projects/Contract Renewal.md', 'Resources/Feynman Lectures.md',
      'Scenarios/embedded/Missed deadlines in the RTOS.md', 'Scenarios/pcb/The board resets under load.md', 'Tasks/Review contract.md', 'Workouts/Goblet Squat.md',
    ]);
    const bad = findings.filter((f) => !f.path.startsWith('Knowledge/Problems/')).map((f) => `${f.path}: ${f.code} ${f.message}`);
    expect(bad).toEqual([]);
  });

  const PROBLEMS: Record<string, string[]> = {
    'Needs an ID': ['missing-id'],
    'Bad status': ['value-enum'],
    'Tag synonym': ['tag-synonym'],
    'Unknown tag': ['tag-unknown'],
    'Body tags': ['body-tag-synonym', 'body-tag-unknown'],
    'Duplicate ID newer': ['duplicate-id'],
    'Old style ID': ['old-id'],
    'Wrong name': ['name-mismatch'],
    'Created after modified': ['created-after-modified'],
    'No unique ID': ['missing-unique-id'],
    'Unique ID of another domain': ['unique-id-mismatch'],
    'Section of another domain': ['value-enum', 'domain-prefix'],
    'Kind of another domain': ['value-enum'],
    'Property the domain removed': ['removed-property'],
    'Old schema': ['old-schema'],
    'Old schema two': ['old-schema'],
  };
  for (const [name, expected] of Object.entries(PROBLEMS)) {
    it(`Knowledge/Problems/${name}.md is found: ${expected.join(', ')}`, () => {
      const codes = codesFor(`Knowledge/Problems/${name}.md`);
      for (const c of expected) expect(codes, name).toContain(c);
    });
  }

  it('the note meant for editing by hand has nothing wrong yet', () => {
    expect(codesFor('Knowledge/Problems/Needs a type change.md')).toEqual([]);
  });

  it('the older of two duplicate IDs is not flagged', () => {
    expect(codesFor('Knowledge/Problems/Duplicate ID older.md')).not.toContain('duplicate-id');
  });

  it('a missing unique ID is offered the next free number for pcb kb notes', () => {
    const f = findings.find((x) => x.path === 'Knowledge/Problems/No unique ID.md' && x.code === 'missing-unique-id');
    expect(f?.message).toContain('KB-PC-2026-0004'); // the pcb notes already use 0001 to 0003
  });

  it('the previews the plugin would write: one per type, and one per type and domain that has overrides', () => {
    const files = renderAllPreviews(pack);
    expect(files.size).toBe(11 + 16);
    expect(files.get('kb/pcb.yaml')).toContain('standards');
    expect(files.get('kb/pcb.yaml')?.startsWith(PREVIEW_MARKER)).toBe(true);
  });
});
