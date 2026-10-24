import { describe, expect, it } from 'vitest';
import { load, loadPack, packFiles } from './helpers/pack';

const BASE = ['type', 'schema', 'id', 'name', 'status'];
const FIND = ['aliases', 'description', 'keywords', 'tags', 'language'];
const TAX = ['breadcrumb'];
const REL = ['parent', 'related', 'supersedes', 'superseded_by'];
const PROV = ['source_title', 'source_author', 'source_url', 'source_accessed'];
const REV = ['review_cycle', 'review_last', 'review_next'];
const END = ['created', 'modified'];

// Spec "Types" table: modules in order, own fields, then created and modified.
const EXPECTED: Record<string, string[]> = {
  note: [...BASE, ...FIND, ...TAX, ...REL, 'confidence', ...END],
  kb: [...BASE, ...FIND, ...TAX, ...REL, ...PROV, ...REV, 'kind', 'audience', 'confidence', ...END],
  project: [...BASE, ...FIND, ...TAX, ...REL, 'priority', 'start', 'deadline', 'outcome', 'stakeholders', ...END],
  exercise: [
    ...BASE, ...FIND, ...TAX, ...REL,
    'category', 'kind', 'measure', 'equipment', 'muscles_primary', 'muscles_secondary', 'technique', 'mistakes',
    ...END,
  ],
  journal: [...BASE, ...FIND, ...REL, 'date', 'period', 'mood', 'energy', 'location', 'highlights', ...END],
  person: [
    ...BASE, ...FIND, ...REL,
    'relationship', 'organisation', 'role', 'location', 'birthday', 'last_contacted', 'follow_up',
    'contact_email', 'contact_phone', 'contact_website', 'contact_social', 'met_date', 'met_where',
    ...END,
  ],
  resource: [
    ...BASE, ...FIND, ...TAX, ...REL,
    'resource_type', 'creator', 'url', 'published', 'rating', 'takeaways',
    'progress_percent', 'progress_started', 'progress_finished',
    ...END,
  ],
  task: [
    ...BASE, ...FIND, ...REL,
    'priority', 'project', 'context', 'effort', 'scheduled', 'due', 'completed', 'depends_on',
    'recurrence_rule', 'recurrence_until',
    ...END,
  ],
};

const STATUS: Record<string, string[]> = {
  note: ['draft', 'in-progress', 'evergreen', 'archived'],
  kb: ['draft', 'review', 'published', 'outdated', 'archived'],
  project: ['planning', 'idea', 'active', 'on-hold', 'done', 'cancelled'],
  exercise: ['draft', 'tested', 'reliable', 'archived'],
  journal: ['open', 'closed'],
  person: ['active', 'dormant', 'archived'],
  resource: ['to-consume', 'in-progress', 'done', 'abandoned'],
  task: ['todo', 'doing', 'waiting', 'done', 'cancelled'],
};

describe('shipped schema pack', () => {
  it('loads with no problems at all', async () => {
    const { pack, problems } = await load(packFiles());
    expect(problems).toEqual([]);
    expect(pack).not.toBeNull();
  });

  it('has the eight spec types plus lesson, eight modules and the tags and tracks vocabularies', async () => {
    const pack = await loadPack();
    expect(pack.typeNames).toEqual(['note', 'kb', 'project', 'exercise', 'journal', 'person', 'resource', 'task', 'lesson']);
    expect([...pack.modules.keys()]).toEqual(['base', 'findability', 'taxonomy', 'relations', 'provenance', 'review', 'curriculum', 'verification']);
    expect([...pack.vocabularies.keys()]).toEqual(['tags', 'tracks']);
  });

  // Added after the spec, opt-in: the eight spec types above do not use the curriculum or verification modules.
  it('resolves lesson to the property list and order of its modules', async () => {
    const pack = await loadPack();
    expect(pack.types.get('lesson')?.properties.map((p) => p.name)).toEqual([
      ...BASE, ...FIND, ...TAX, ...REL,
      'domain', 'section', 'level', 'topic', 'order', 'track',
      'ai_generated', 'generated_by', 'verified', 'verified_by', 'references',
      'kind', 'audience', 'confidence', ...END,
    ]);
    const status = pack.types.get('lesson')?.byName.get('status');
    expect(status?.values).toEqual(['draft', 'review', 'published', 'outdated', 'archived']);
    expect(status?.default).toBe('draft');
  });

  it('keeps the eight spec types free of the opt-in modules, so their notes and property lists are unchanged', async () => {
    const pack = await loadPack();
    for (const name of Object.keys(EXPECTED)) {
      const uses = pack.types.get(name)?.uses ?? [];
      expect(uses, name).not.toContain('curriculum');
      expect(uses, name).not.toContain('verification');
      expect(pack.types.get(name)?.byName.has('domain'), name).toBe(false);
    }
  });

  for (const [type, names] of Object.entries(EXPECTED)) {
    it(`resolves ${type} to the property list and order in the spec`, async () => {
      const pack = await loadPack();
      expect(pack.types.get(type)?.properties.map((p) => p.name)).toEqual(names);
    });

    it(`gives ${type} its status values, default first`, async () => {
      const pack = await loadPack();
      const status = pack.types.get(type)?.byName.get('status');
      expect(status?.values).toEqual(STATUS[type]);
      expect(status?.default).toBe(STATUS[type]?.[0]);
    });
  }

  it('puts created and modified last in every type', async () => {
    const pack = await loadPack();
    for (const t of pack.types.values()) {
      expect(t.properties.slice(-2).map((p) => p.name)).toEqual(['created', 'modified']);
    }
  });

  it('uses the ID prefixes from the spec and schema version 2 (lesson is new: LS, version 1)', async () => {
    const pack = await loadPack();
    const prefixes = Object.fromEntries([...pack.types.values()].map((t) => [t.name, t.prefix]));
    expect(prefixes).toEqual({ note: 'NT', kb: 'KB', project: 'PR', exercise: 'EX', journal: 'JR', person: 'PE', resource: 'RS', task: 'TK', lesson: 'LS' });
    for (const t of pack.types.values()) expect(t.version, t.name).toBe(t.name === 'lesson' ? 1 : 2);
  });

  it('offers the registry type names as the values of `type`', async () => {
    const pack = await loadPack();
    expect(pack.types.get('kb')?.byName.get('type')?.values).toEqual(pack.typeNames);
  });

  it('marks the locked and generated base properties', async () => {
    const pack = await loadPack();
    const kb = pack.types.get('kb');
    for (const name of ['schema', 'id', 'created', 'modified', 'breadcrumb']) {
      expect(kb?.byName.get(name)?.locked, name).toBe(true);
    }
    expect(kb?.byName.get('breadcrumb')?.managedBy).toBe('external');
    expect(kb?.byName.get('id')?.immutable).toBe(true);
    expect(kb?.byName.get('modified')?.position).toBe('end');
  });

  it('maps the folders from the spec, with Wiki also on kb', async () => {
    const pack = await loadPack();
    const map = Object.fromEntries(pack.folders.mappings.map((m) => [m.folder, m.type]));
    expect(map).toMatchObject({ Notes: 'note', Knowledge: 'kb', Wiki: 'kb', Projects: 'project', Tasks: 'task', People: 'person' });
    expect(pack.folders.conflicts).toEqual([]);
    expect(pack.scope.exclude).toEqual(['Templates', 'Archive', 'Attachments']);
  });

  it('declares tag synonyms that resolve to preferred terms', async () => {
    const pack = await loadPack();
    const tags = pack.vocabularies.get('tags');
    expect(tags?.lookup.get('sop')).toBe('procedure');
    expect(tags?.lookup.get('quantum')).toBe('quantum');
  });
});
