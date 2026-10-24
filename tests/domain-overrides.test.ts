import { beforeAll, describe, expect, it } from 'vitest';
import { domainOf, domainViolations, typeFor, vocabFor } from '../src/core/domain-overrides';
import { planMigration } from '../src/core/migrate';
import { checkNote, makeAllocator } from '../src/core/note-check';
import type { CheckContext, NoteInput } from '../src/core/note-check';
import type { Problem, ResolvedType, SchemaPack } from '../src/core/schema-types';
import { loadFixture } from './helpers/domain-fixture';
import { loadPack } from './helpers/pack';

let pack: SchemaPack;
beforeAll(async () => {
  const r = await loadFixture();
  if (!r.pack) throw new Error('fixture failed to load: ' + JSON.stringify(r.problems));
  pack = r.pack;
});

const names = (t: ResolvedType | undefined) => (t?.properties ?? []).map((p) => p.name);

describe('effective types', () => {
  it('the fixture loads with no problems and finds its domains', async () => {
    const r = await loadFixture();
    expect(r.problems).toEqual([]);
    expect(pack.domains).toEqual(['pcb', 'demo']);
    expect([...pack.effectiveTypes.keys()].sort()).toEqual(['demo/exercise', 'demo/kb']);
  });

  it('override changes values and default for the domain only', () => {
    const demo = typeFor(pack, 'kb', 'demo');
    const kind = demo?.byName.get('kind');
    expect(kind?.values).toEqual(['definition', 'theorem', 'proof']);
    expect(kind?.default).toBe('definition');
    const base = pack.types.get('kb')?.byName.get('kind');
    expect(base?.values).toEqual(['concept', 'how-to', 'reference']);
    expect(base?.default).toBe('concept');
  });

  it('add puts the property after the type’s own and before created and modified', () => {
    const list = names(typeFor(pack, 'kb', 'demo'));
    expect(list.slice(-4)).toEqual(['kind', 'prerequisite_theorems', 'created', 'modified']);
    expect(names(pack.types.get('kb'))).not.toContain('prerequisite_theorems');
  });

  it('remove drops the property for the domain only', () => {
    expect(names(typeFor(pack, 'kb', 'demo'))).not.toContain('standards');
    expect(names(typeFor(pack, 'kb', 'pcb'))).toContain('standards');
    expect(typeFor(pack, 'kb', 'demo')?.byName.has('standards')).toBe(false);
  });

  it('a domain without override files, or no domain at all, gets the default type itself', () => {
    expect(typeFor(pack, 'kb', 'pcb')).toBe(pack.types.get('kb'));
    expect(typeFor(pack, 'kb', undefined)).toBe(pack.types.get('kb'));
    expect(typeFor(pack, 'kb', 'unknown')).toBe(pack.types.get('kb'));
  });

  it('an effective type remembers its domain; the default does not', () => {
    expect(typeFor(pack, 'kb', 'demo')?.domain).toBe('demo');
    expect(pack.types.get('kb')?.domain).toBeUndefined();
  });

  it('lists the same effective properties, in the same order, as the vault validator (tests/validator)', () => {
    expect(names(typeFor(pack, 'kb', 'demo')).join(', ')).toBe(
      'type, schema, id, name, status, aliases, description, tags, domain, section, level, order, track, ai_generated, generated_by, verified, kind, prerequisite_theorems, created, modified',
    );
    expect(names(typeFor(pack, 'exercise', 'demo')).join(', ')).toContain('difficulty, question_kind, created, modified');
  });

  it('exercise gets its own added property with its default', () => {
    const q = typeFor(pack, 'exercise', 'demo')?.byName.get('question_kind');
    expect(q?.values).toEqual(['calculation', 'proof-writing']);
    expect(q?.default).toBe('calculation');
    expect(pack.types.get('exercise')?.byName.has('question_kind')).toBe(false);
  });

  it('a module override file’s sections are added to the default list', () => {
    const values = typeFor(pack, 'kb', 'demo')?.byName.get('section')?.values;
    expect(values).toEqual(['pcb-start-here', 'pcb-core', 'demo-basics', 'demo-proofs']);
    expect(pack.types.get('kb')?.byName.get('section')?.values).toEqual(['pcb-start-here', 'pcb-core']);
    // every type that uses the module gets them
    expect(typeFor(pack, 'exercise', 'demo')?.byName.get('section')?.values).toContain('demo-proofs');
  });

  it('the default types are not changed by building the effective ones', () => {
    expect(pack.types.get('kb')?.byName.get('kind')?.values).toEqual(['concept', 'how-to', 'reference']);
    expect(names(pack.types.get('kb'))).toContain('standards');
  });
});

describe('effective vocabularies', () => {
  it('a domain’s terms and synonyms are added to the default', () => {
    const tags = vocabFor(pack, 'tags', 'demo');
    expect(tags?.terms.map((t) => t.term)).toEqual(['layout', 'routing', 'power', 'theorem', 'lemma']);
    expect(tags?.lookup.get('thm')).toBe('theorem');
    expect(tags?.lookup.get('routes')).toBe('routing');
    expect(vocabFor(pack, 'tracks', 'demo')?.terms.map((t) => t.term)).toEqual(['pcb-first-board', 'demo-first-course']);
  });

  it('the default vocabulary does not gain the domain’s terms', () => {
    expect(pack.vocabularies.get('tags')?.lookup.has('theorem')).toBe(false);
    expect(vocabFor(pack, 'tags', 'pcb')).toBe(pack.vocabularies.get('tags'));
    expect(vocabFor(pack, 'tags')).toBe(pack.vocabularies.get('tags'));
  });
});

describe('no override folders: nothing changes', () => {
  it('the starter pack has no domain files and every lookup returns the default', async () => {
    const starter = await loadPack();
    expect(starter.domainFiles.size).toBe(0);
    expect(starter.effectiveTypes.size).toBe(0);
    expect(starter.effectiveVocabularies.size).toBe(0);
    for (const name of starter.typeNames) {
      expect(typeFor(starter, name, 'physics')).toBe(starter.types.get(name));
      expect(typeFor(starter, name)).toBe(starter.types.get(name));
    }
    for (const name of starter.vocabularies.keys()) expect(vocabFor(starter, name, 'physics')).toBe(starter.vocabularies.get(name));
  });
});

/** Load the fixture with one extra or changed file and return the problems. */
async function problemsWith(extra: Record<string, string | null>, edits: Record<string, (t: string) => string> = {}): Promise<Problem[]> {
  return (await loadFixture(edits, extra)).problems;
}
const has = (problems: Problem[], code: string, file?: string) => problems.some((p) => p.code === code && p.severity === 'error' && (!file || p.file === file));

describe('the rules', () => {
  it('core properties cannot be removed', async () => {
    for (const core of ['type', 'schema', 'id', 'name', 'status', 'domain', 'section', 'level', 'order', 'created', 'modified']) {
      const p = await problemsWith({ 'types/kb/demo.yaml': `domain: demo\nremove: [${core}]\n` });
      expect(has(p, 'remove-core', 'types/kb/demo.yaml'), core).toBe(true);
    }
  });

  it('a core property in a module file cannot be removed either', async () => {
    const p = await problemsWith({ 'modules/curriculum/demo.yaml': 'domain: demo\nremove: [level]\n' });
    expect(has(p, 'remove-core', 'modules/curriculum/demo.yaml')).toBe(true);
  });

  it('an override may not change a property’s type', async () => {
    const p = await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\noverride:\n  kind:\n    type: string\n' });
    expect(has(p, 'override-type', 'types/kb/demo.yaml')).toBe(true);
  });

  it('unknown keys are errors: in an override, and at the top of the file', async () => {
    expect(has(await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\noverride:\n  kind:\n    colour: red\n' }), 'override-unknown-key')).toBe(true);
    expect(has(await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\nextras: [a]\n' }), 'override-unknown-key')).toBe(true);
    expect(has(await problemsWith({ 'modules/curriculum/demo.yaml': 'domain: demo\nadds: {}\n' }), 'override-unknown-key')).toBe(true);
  });

  it('a vocabulary term that is a default term, or a default synonym, is an error (the default wins)', async () => {
    const term = await problemsWith({ 'vocabularies/tags/demo.yaml': 'domain: demo\nterms:\n  routing: {}\n' });
    expect(has(term, 'vocab-collision', 'vocabularies/tags/demo.yaml')).toBe(true);
    const synonym = await problemsWith({ 'vocabularies/tags/demo.yaml': 'domain: demo\nterms:\n  routes: {}\n' });
    expect(has(synonym, 'vocab-collision', 'vocabularies/tags/demo.yaml')).toBe(true);
    const asSynonym = await problemsWith({ 'vocabularies/tags/demo.yaml': 'domain: demo\nterms:\n  paths:\n    synonyms: [routing]\n' });
    expect(has(asSynonym, 'vocab-collision', 'vocabularies/tags/demo.yaml')).toBe(true);
  });

  it('a track term must start with its domain and a hyphen; so must a section', async () => {
    expect(has(await problemsWith({ 'vocabularies/tracks/demo.yaml': 'domain: demo\nterms:\n  other-path: {}\n' }), 'domain-prefix', 'vocabularies/tracks/demo.yaml')).toBe(true);
    expect(has(await problemsWith({ 'modules/curriculum/demo.yaml': 'domain: demo\nsections: [pcb-extra]\n' }), 'domain-prefix', 'modules/curriculum/demo.yaml')).toBe(true);
    // tag terms are not prefixed
    expect(await problemsWith({ 'vocabularies/tags/demo.yaml': 'domain: demo\nterms:\n  plain: {}\n' })).toEqual([]);
  });

  it('a section already in the default list is an error', async () => {
    const p = await problemsWith({ 'modules/curriculum/demo.yaml': 'domain: demo\nsections: [demo-basics]\n' }, { 'modules/curriculum.yaml': (t) => t.replace('[pcb-start-here, pcb-core]', '[pcb-start-here, pcb-core, demo-basics]') });
    expect(has(p, 'section-duplicate')).toBe(true);
  });

  it('an override file for a domain that is not a domain value is an error, in every kind of file', async () => {
    for (const path of ['types/kb/ghost.yaml', 'modules/curriculum/ghost.yaml', 'vocabularies/tags/ghost.yaml']) {
      const p = await problemsWith({ [path]: 'domain: ghost\nterms: {}\n' });
      expect(has(p, 'override-domain-unknown', path), path).toBe(true);
    }
  });

  it('the file must say the domain it is named for', async () => {
    expect(has(await problemsWith({ 'types/kb/demo.yaml': 'domain: pcb\nremove: [standards]\n' }), 'domain-mismatch')).toBe(true);
    expect(has(await problemsWith({ 'types/kb/demo.yaml': 'remove: [standards]\n' }), 'domain-missing')).toBe(true);
  });

  it('overriding, removing or adding something that does not fit is an error', async () => {
    expect(has(await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\noverride:\n  nope:\n    default: x\n' }), 'override-unknown')).toBe(true);
    expect(has(await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\nremove: [nope]\n' }), 'remove-unknown')).toBe(true);
    expect(has(await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\nadd:\n  kind: {type: string}\n' }), 'add-exists')).toBe(true);
    expect(has(await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\noverride:\n  order:\n    values: [a]\n' }), 'override-values')).toBe(true);
    expect(has(await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\noverride:\n  kind:\n    default: concept\n    values: [definition]\n' }), 'bad-default')).toBe(true);
  });

  it('one property under two verbs is an error', async () => {
    const p = await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\noverride:\n  kind:\n    default: proof\nremove: [kind]\n' });
    expect(has(p, 'override-conflict', 'types/kb/demo.yaml')).toBe(true);
  });

  it('a module file may only touch its own module’s properties', async () => {
    expect(has(await problemsWith({ 'modules/verification/demo.yaml': 'domain: demo\noverride:\n  kind:\n    default: x\n' }), 'override-unknown')).toBe(true);
    expect(has(await problemsWith({ 'modules/verification/demo.yaml': 'domain: demo\nsections: [demo-x]\n' }), 'sections-unknown')).toBe(true);
  });

  it('a module file’s removal applies to every type using the module', async () => {
    // the module file removes it for every type; the kb type file must then not remove it again
    const r = await loadFixture({ 'types/kb/demo.yaml': (t) => t.replace('remove: [standards]\n', '') }, { 'modules/verification/demo.yaml': 'domain: demo\nremove: [standards]\n' });
    expect(r.problems).toEqual([]);
    expect(names(typeFor(r.pack as SchemaPack, 'exercise', 'demo'))).not.toContain('standards');
    expect(names(typeFor(r.pack as SchemaPack, 'kb', 'demo'))).not.toContain('standards');
    // and removing it twice is an error: the second file finds nothing to remove
    const twice = await loadFixture({}, { 'modules/verification/demo.yaml': 'domain: demo\nremove: [standards]\n' });
    expect(twice.problems.some((p) => p.code === 'remove-unknown' && p.file === 'types/kb/demo.yaml')).toBe(true);
  });

  it('a property added with the same name and a different shape in another domain is a type conflict', async () => {
    const p = await problemsWith({ 'types/exercise/demo.yaml': 'domain: demo\nadd:\n  kind: {type: integer}\n' });
    expect(has(p, 'type-conflict')).toBe(true);
  });

  it('an added list of terms needs a known vocabulary', async () => {
    const p = await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\nadd:\n  labels: {type: list, items: term, vocabulary: nothing}\n' });
    expect(has(p, 'vocabulary-unknown')).toBe(true);
  });

  it('problems name the file and the line', async () => {
    const p = await problemsWith({ 'types/kb/demo.yaml': 'domain: demo\noverride:\n  kind:\n    type: string\n' });
    expect(p.find((x) => x.code === 'override-type')?.line).toBe(4);
  });
});

describe('note-level rules', () => {
  const kbBase = () => pack.types.get('kb') as ResolvedType;
  const kbDemo = () => typeFor(pack, 'kb', 'demo') as ResolvedType;

  it('reads the domain from the frontmatter', () => {
    expect(domainOf({ domain: 'demo' })).toBe('demo');
    expect(domainOf({ domain: '' })).toBeUndefined();
    expect(domainOf({ domain: 3 })).toBeUndefined();
    expect(domainOf(undefined)).toBeUndefined();
  });

  it('flags a section or track that does not start with the note’s domain', () => {
    const v = domainViolations(kbBase(), kbDemo(), { domain: 'demo', section: 'pcb-core', track: ['demo-first-course', 'pcb-first-board'] });
    expect(v.map((x) => `${x.code}:${x.property}`)).toEqual(['domain-prefix:section', 'domain-prefix:track']);
  });

  it('flags a property the domain removed', () => {
    const v = domainViolations(kbBase(), kbDemo(), { domain: 'demo', section: 'demo-basics', standards: [] });
    expect(v.map((x) => x.code)).toEqual(['removed-property']);
  });

  it('says nothing about a clean note, or about the default type', () => {
    expect(domainViolations(kbBase(), kbDemo(), { domain: 'demo', section: 'demo-basics', track: ['demo-first-course'] })).toEqual([]);
    expect(domainViolations(kbBase(), kbBase(), { domain: 'pcb', section: 'pcb-core', standards: [] })).toEqual([]);
  });

  const ctx = (): CheckContext => ({ pack, now: new Date(2026, 9, 21, 9, 5), usedIds: [], retiredIds: [], known: {} });
  const noteOf = (type: ResolvedType, fmLines: string[]): NoteInput => ({
    path: 'Knowledge/demo/N.md',
    basename: 'N',
    text: `---\n${fmLines.join('\n')}\n---\nbody\n`,
    ctime: Date.UTC(2026, 9, 21),
    type,
  });
  const fmDemo = ['type: kb', 'schema: 1', 'id: KB-2026-0001', 'name: N', 'status: draft', 'domain: demo', 'section: demo-basics', 'level: beginner', 'order: 1', 'kind: definition', 'created: 2026-10-21T09:00', 'modified: 2026-10-21T09:00'];

  it('the vault check uses the domain’s allowed values and reports a removed property', () => {
    const run = (lines: string[]) => checkNote(ctx(), noteOf(kbDemo(), lines), makeAllocator([], [])).map((f) => f.code);
    expect(run(fmDemo)).toEqual([]);
    expect(run(fmDemo.map((l) => (l === 'kind: definition' ? 'kind: concept' : l)))).toContain('value-enum');
    expect(run([...fmDemo.slice(0, -2), 'standards: []', ...fmDemo.slice(-2)])).toContain('removed-property');
    expect(run(fmDemo.map((l) => (l === 'section: demo-basics' ? 'section: pcb-core' : l)))).toContain('domain-prefix');
  });

  it('a schema that defines domain keeps it: no leftover warning, and a migration does not remove it', async () => {
    const lines = fmDemo.map((l) => (l === 'schema: 1' ? 'schema: 1' : l));
    const withCrumb = [...lines.slice(0, 5), 'breadcrumb: demo/Limits', ...lines.slice(5)];
    const codes = checkNote(ctx(), noteOf(kbDemo(), withCrumb), makeAllocator([], [])).map((f) => f.code);
    expect(codes).not.toContain('leftover-domain');
    const draft: Record<string, unknown> = { type: 'kb', schema: 1, domain: 'demo', breadcrumb: 'demo/Limits' };
    const plan = planMigration({ ...draft }, { ...kbDemo(), version: 2 }, new Date(2026, 9, 21));
    plan.apply(draft);
    expect(draft.domain).toBe('demo');
    expect(plan.archived).not.toHaveProperty('domain');
    // the same note on a schema without a domain property still loses the duplicate, as before
    const starter = await loadPack();
    const old: Record<string, unknown> = { type: 'kb', schema: 1, domain: 'demo', breadcrumb: 'demo/Limits' };
    planMigration({ ...old }, { ...(starter.types.get('kb') as ResolvedType), version: 2 }, new Date(2026, 9, 21)).apply(old);
    expect(old).not.toHaveProperty('domain');
  });

  it('the vault check knows a domain’s tags', () => {
    const lines = [...fmDemo.slice(0, 8), 'tags: [theorem, thm]', ...fmDemo.slice(8)];
    const codes = checkNote(ctx(), noteOf(kbDemo(), lines), makeAllocator([], [])).map((f) => f.code);
    expect(codes).toContain('tag-synonym'); // thm -> theorem, from the demo vocabulary
    expect(codes).not.toContain('tag-unknown');
    const asPcb = checkNote(ctx(), noteOf(kbBase(), lines.map((l) => l.replace('domain: demo', 'domain: pcb'))), makeAllocator([], [])).map((f) => f.code);
    expect(asPcb).toContain('tag-unknown'); // the default vocabulary does not have it
  });
});
