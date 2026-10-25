import { beforeAll, describe, expect, it } from 'vitest';
import { newNoteFrontmatter } from '../src/core/create';
import { typeFor, vocabFor } from '../src/core/domain-overrides';
import { renderAllPreviews } from '../src/core/schema-preview';
import type { ResolvedType, SchemaPack } from '../src/core/schema-types';
import { validateValue } from '../src/core/validate';
import { load, shippedFiles } from './helpers/pack';

let pack: SchemaPack;
beforeAll(async () => {
  const r = await load(shippedFiles());
  if (!r.pack) throw new Error('the shipping pack failed to load: ' + JSON.stringify(r.problems));
  pack = r.pack;
});
const names = (t: ResolvedType | undefined) => (t?.properties ?? []).map((p) => p.name);

const BASE = ['type', 'schema', 'id', 'name', 'status'];
const FIND = ['aliases', 'description', 'keywords', 'tags', 'language'];
const REL = ['parent', 'related', 'supersedes', 'superseded_by'];
const PROV = ['source_title', 'source_author', 'source_url', 'source_accessed'];
const REV = ['review_cycle', 'review_last', 'review_next'];
const PATH = ['prerequisites', 'next', 'companion'];
const CURR = ['domain', 'unique_id', 'section', 'level', 'topic', 'order', 'track'];
const VERIF = ['ai_generated', 'generated_by', 'verified', 'verified_by', 'references'];
const END = ['created', 'modified'];

describe('the shipping pack', () => {
  it('loads with no problems at all', async () => {
    expect((await load(shippedFiles())).problems).toEqual([]);
  });

  it('has the approved types, modules and vocabularies, and nothing else', () => {
    expect(pack.typeNames).toEqual(['note', 'kb', 'resource', 'project', 'task', 'exercise', 'scenario', 'example', 'journal', 'person', 'workout']);
    expect([...pack.modules.keys()]).toEqual(['base', 'findability', 'relations', 'review', 'provenance', 'verification', 'pathways', 'domain', 'curriculum']);
    expect([...pack.vocabularies.keys()]).toEqual(['tags', 'tracks']);
    expect(pack.modules.has('taxonomy')).toBe(false); // no breadcrumb: the pack works without a breadcrumb plugin
  });

  it('uses the ID prefixes and schema versions of the types', () => {
    expect(Object.fromEntries([...pack.types.values()].map((t) => [t.name, `${t.prefix}${t.version}`]))).toEqual({
      note: 'NT2', kb: 'KB2', resource: 'RS2', project: 'PR2', task: 'TK2', exercise: 'EX1', scenario: 'SC1', example: 'EG1', journal: 'JR2', person: 'PE2', workout: 'WK1',
    });
  });

  it('keeps created and modified last in every type', () => {
    for (const t of pack.types.values()) expect(t.properties.slice(-2).map((p) => p.name), t.name).toEqual(END);
  });

  it('resolves the learning types to their modules in order', () => {
    expect(names(pack.types.get('kb'))).toEqual([...BASE, ...FIND, ...REL, ...PROV, ...REV, ...PATH, ...CURR, ...VERIF, 'kind', 'audience', 'confidence', ...END]);
    expect(names(pack.types.get('exercise'))).toEqual([...BASE, ...FIND, ...REL, ...REV, ...PATH, ...CURR, ...VERIF, 'difficulty', 'time_minutes', 'tests', 'answer_verified', 'confidence', ...END]);
    expect(names(pack.types.get('scenario'))).toEqual([...BASE, ...FIND, ...REL, ...REV, ...PATH, ...CURR, ...VERIF, 'decision_type', 'difficulty', 'time_minutes', 'tests', 'senior_signal', 'answer_verified', 'confidence', ...END]);
    expect(names(pack.types.get('example'))).toEqual([...BASE, ...FIND, ...REL, ...REV, ...PATH, ...CURR, ...VERIF, 'demonstrates', 'difficulty', 'confidence', ...END]);
  });

  it('keeps the everyday and personal types free of the curriculum', () => {
    for (const name of ['note', 'resource', 'project', 'task', 'journal', 'person', 'workout']) {
      const t = pack.types.get(name);
      expect(t?.byName.has('domain'), name).toBe(false);
      expect(t?.byName.has('breadcrumb'), name).toBe(false);
    }
    expect(names(pack.types.get('note'))).toEqual([...BASE, ...FIND, ...REL, 'confidence', ...END]);
    expect(names(pack.types.get('workout'))).toContain('muscles_primary');
  });

  it('declares one unique two-letter prefix per domain', () => {
    expect(pack.domains).toEqual(['general', 'maths', 'physics', 'pcb', 'embedded']);
    const prefixes = pack.types.get('kb')?.byName.get('domain')?.prefixes;
    expect(prefixes).toEqual({ general: 'GE', maths: 'MA', physics: 'PY', pcb: 'PC', embedded: 'EM' });
    expect(new Set(Object.values(prefixes ?? {})).size).toBe(5);
  });

  it('maps the folders, including the learning types', () => {
    const map = Object.fromEntries(pack.folders.mappings.map((m) => [m.folder, m.type]));
    expect(map).toEqual({ Notes: 'note', Knowledge: 'kb', Wiki: 'kb', Resources: 'resource', Projects: 'project', Tasks: 'task', Exercises: 'exercise', Scenarios: 'scenario', Examples: 'example', Journal: 'journal', People: 'person', Workouts: 'workout' });
    expect(pack.folders.conflicts).toEqual([]);
  });
});

describe('the example domains', () => {
  const kb = (d: string) => typeFor(pack, 'kb', d) as ResolvedType;

  it('general has no override files: it is the default', () => {
    expect([...pack.effectiveTypes.keys()].some((k) => k.startsWith('general/'))).toBe(false);
    expect(typeFor(pack, 'kb', 'general')).toBe(pack.types.get('kb'));
    expect(vocabFor(pack, 'tags', 'general')).toBe(pack.vocabularies.get('tags'));
  });

  it('maths: its own kinds, an added link list, no audience, its own sections and section default', () => {
    expect(kb('maths').byName.get('kind')?.values).toEqual(['definition', 'theorem', 'proof', 'example', 'concept']);
    expect(kb('maths').byName.has('prerequisite_theorems')).toBe(true);
    expect(kb('maths').byName.has('audience')).toBe(false);
    expect(kb('maths').byName.get('section')?.values).toEqual(['general-start-here', 'general-reference', 'maths-foundations', 'maths-algebra', 'maths-analysis', 'maths-statistics']);
    expect(kb('maths').byName.get('section')?.default).toBe('maths-foundations');
  });

  it('physics: units and a formula, its own kinds', () => {
    expect(kb('physics').byName.get('kind')?.values).toEqual(['law', 'derivation', 'experiment', 'concept', 'reference']);
    expect(names(kb('physics'))).toEqual(expect.arrayContaining(['units', 'formula']));
    expect(kb('physics').byName.has('audience')).toBe(true);
  });

  it('pcb and embedded add standards (the subject domains never have it); embedded adds a target and a toolchain', () => {
    expect(kb('pcb').byName.has('standards')).toBe(true);
    expect(kb('embedded').byName.has('standards')).toBe(true);
    expect(names(kb('embedded'))).toEqual(expect.arrayContaining(['target_mcu', 'toolchain']));
    expect(kb('maths').byName.has('standards')).toBe(false);
    expect(kb('physics').byName.has('standards')).toBe(false);
    expect(pack.types.get('kb')?.byName.has('standards')).toBe(false);
  });

  it('exercise and scenario overrides', () => {
    expect(typeFor(pack, 'exercise', 'maths')?.byName.get('question_kind')?.values).toEqual(['calculation', 'proof-writing']);
    expect(typeFor(pack, 'exercise', 'pcb')?.byName.has('tools_needed')).toBe(true);
    expect(typeFor(pack, 'exercise', 'physics')?.byName.has('question_kind')).toBe(false);
    expect(typeFor(pack, 'scenario', 'pcb')?.byName.get('decision_type')?.values).toEqual(['diagnosis', 'trade-off', 'sourcing', 'design-choice', 'review']);
    expect(typeFor(pack, 'scenario', 'embedded')?.byName.get('decision_type')?.values).toEqual(['architecture', 'debugging', 'real-time', 'trade-off']);
    expect(typeFor(pack, 'scenario', 'embedded')?.byName.get('decision_type')?.default).toBe('debugging');
  });

  it('every domain adds its own tags and tracks to the defaults', () => {
    for (const d of ['maths', 'physics', 'pcb', 'embedded']) {
      expect(vocabFor(pack, 'tags', d)?.terms.length, d).toBeGreaterThan(pack.vocabularies.get('tags')?.terms.length ?? 0);
      const tracks = vocabFor(pack, 'tracks', d)?.terms.map((t) => t.term) ?? [];
      expect(tracks[0]).toBe('general-getting-started');
      expect(tracks.slice(1).every((t) => t.startsWith(`${d}-`)), d).toBe(true);
    }
    expect(vocabFor(pack, 'tags', 'maths')?.lookup.get('thm')).toBe('theorem');
    expect(vocabFor(pack, 'tags', 'pcb')?.lookup.get('bypassing')).toBe('decoupling');
    expect(pack.vocabularies.get('tags')?.lookup.has('theorem')).toBe(false);
  });

  it('every domain writes a preview for every type it changes, under preview/<type>/<domain>.yaml', () => {
    const files = [...renderAllPreviews(pack).keys()];
    expect(files.filter((f) => f.includes('/')).sort()).toEqual(
      ['embedded', 'maths', 'pcb', 'physics'].flatMap((d) => ['example', 'exercise', 'kb', 'scenario'].map((t) => `${t}/${d}.yaml`)).sort(),
    );
    expect(files.filter((f) => !f.includes('/'))).toHaveLength(11);
  });
});

describe('a new note is complete and valid in every domain', () => {
  const now = new Date(2026, 9, 25, 9, 0);
  it('every type, in every domain: required properties are present and every value is allowed', () => {
    let checked = 0;
    for (const domain of pack.domains) {
      for (const name of pack.typeNames) {
        const t = typeFor(pack, name, domain) as ResolvedType;
        const fm = newNoteFrontmatter(t, { name: 'N', id: `${t.prefix}-2026-0001`, now, domain, allocateUnique: (tp, dp, y) => `${tp}-${dp}-${y}-0001` });
        for (const def of t.properties) {
          const where = `${name}/${domain}.${def.name}`;
          if (def.required) expect(fm, where).toHaveProperty(def.name);
          if (def.name in fm) expect(validateValue(def, fm[def.name]), where).toBeNull();
          checked++;
        }
        if (t.byName.has('unique_id')) expect(fm.unique_id, `${name}/${domain}`).toMatch(new RegExp(`^${t.prefix}-${pack.types.get('kb')?.byName.get('domain')?.prefixes?.[domain]}-2026-0001$`));
        if (t.byName.has('domain')) expect(fm.domain).toBe(domain);
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});
