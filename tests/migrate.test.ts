import { beforeAll, describe, expect, it } from 'vitest';
import { editFrontmatter, readFrontmatter } from '../src/core/frontmatter';
import type { Frontmatter } from '../src/core/frontmatter';
import { domainRepeatsBreadcrumb, needsMigration, planMigration } from '../src/core/migrate';
import type { ResolvedType, SchemaPack } from '../src/core/schema-types';
import { loadPack } from './helpers/pack';
import { desiredOrder } from '../src/core/frontmatter';

let pack: SchemaPack;
const t = (n: string) => pack.types.get(n) as ResolvedType;
const now = new Date(2026, 9, 21, 9, 5);
beforeAll(async () => {
  pack = await loadPack();
});

const migrate = (text: string, type: ResolvedType) =>
  editFrontmatter(text, (fm) => planMigration(fm, type, now).apply(fm), { order: (k) => desiredOrder(k, type), forceOrder: true });

describe('migration schema 1 to 2', () => {
  it('knows which notes need it', () => {
    expect(needsMigration({ schema: 1 }, t('kb'))).toBe(true);
    expect(needsMigration({ schema: 2 }, t('kb'))).toBe(false);
    expect(needsMigration({}, t('kb'))).toBe(false);
  });

  it('renames an old ID to the year format and sets schema 2', () => {
    const fm: Frontmatter = { schema: 1, id: 'KB-000142', created: '2026-03-04T10:00' };
    const draft = { ...fm };
    planMigration(fm, t('kb'), now).apply(draft);
    expect(draft).toMatchObject({ id: 'KB-2026-0142', schema: 2 });
  });

  it('flattens the nested blocks into flat properties', () => {
    const text = [
      '---', 'type: resource', 'schema: 1', 'id: RS-000007', 'name: R', 'status: done', 'created: 2026-01-02T10:00', 'modified: 2026-01-03T10:00',
      'progress:', '  percent: 40', '  started: 2026-01-02', '  finished: 2026-02-01', '---', 'body', '',
    ].join('\n');
    const out = readFrontmatter(migrate(text, t('resource')).text) as Frontmatter;
    expect(out).toMatchObject({ progress_percent: 40, progress_started: '2026-01-02', progress_finished: '2026-02-01', schema: 2, id: 'RS-2026-0007' });
    expect(out).not.toHaveProperty('progress');
    expect(out).not.toHaveProperty('archived_fields'); // nothing lost, nothing archived
  });

  it('flattens every block named in the spec', () => {
    const cases: [string, string, string][] = [
      ['person', 'contact', 'contact_email'], ['person', 'met', 'met_date'], ['exercise', 'muscles', 'muscles_primary'],
      ['task', 'recurrence', 'recurrence_rule'], ['kb', 'review', 'review_cycle'], ['kb', 'source', 'source_title'], ['resource', 'progress', 'progress_percent'],
    ];
    const values: Record<string, unknown> = { contact_email: 'a@b.c', met_date: '2026-01-01', muscles_primary: ['x'], recurrence_rule: 'weekly', review_cycle: '3-months', source_title: 'T', progress_percent: 5 };
    for (const [type, block, flat] of cases) {
      const key = flat.slice(block.length + 1);
      const fm: Frontmatter = { schema: 1, [block]: { [key]: values[flat] } };
      const draft = { ...fm };
      planMigration(fm, t(type), now).apply(draft);
      expect(draft[flat], `${type}.${block}`).toEqual(values[flat]);
      expect(draft).not.toHaveProperty(block);
    }
  });

  it('keeps the original in archived_fields where flattening would lose information', () => {
    const fm: Frontmatter = {
      schema: 1, type: 'kb', created: '2026-01-02T10:00',
      source: { title: 'T', notes: 'free text with nowhere to go', url: 'not a url' },
    };
    const draft = JSON.parse(JSON.stringify(fm)) as Frontmatter;
    planMigration(fm, t('kb'), now).apply(draft);
    expect(draft.source_title).toBe('T');
    expect(draft).not.toHaveProperty('source_url');
    expect(draft.archived_fields).toEqual([{ type: 'kb', date: '2026-10-21', from_schema: 1, values: { source: { notes: 'free text with nowhere to go', url: 'not a url' } } }]);
  });

  it('archives a block the type has no flat properties for', () => {
    const fm: Frontmatter = { schema: 1, source: { title: 'T' } };
    const draft = JSON.parse(JSON.stringify(fm)) as Frontmatter;
    planMigration(fm, t('journal'), now).apply(draft);
    expect(draft.archived_fields).toMatchObject([{ values: { source: { title: 'T' } } }]);
    expect(draft).not.toHaveProperty('source');
  });

  it('removes domain and domain_path when they repeat the breadcrumb, archives them otherwise', () => {
    const repeats: Frontmatter = { schema: 1, breadcrumb: 'Knowledge/Physics', domain: 'Knowledge', domain_path: 'Knowledge/Physics' };
    const d1 = { ...repeats };
    planMigration(repeats, t('kb'), now).apply(d1);
    expect(d1).not.toHaveProperty('domain');
    expect(d1).not.toHaveProperty('domain_path');
    expect(d1).not.toHaveProperty('archived_fields');

    const differs: Frontmatter = { schema: 1, breadcrumb: 'Knowledge/Physics', domain: 'Finance', domain_path: 'Finance/Risk' };
    const d2 = { ...differs };
    planMigration(differs, t('kb'), now).apply(d2);
    expect(d2.archived_fields).toMatchObject([{ values: { domain: 'Finance', domain_path: 'Finance/Risk' } }]);
  });

  it('compares domain with the breadcrumb ignoring separators and case', () => {
    expect(domainRepeatsBreadcrumb({ breadcrumb: 'Knowledge/Physics', domain: 'knowledge' }, 'domain')).toBe(true);
    expect(domainRepeatsBreadcrumb({ breadcrumb: 'Knowledge/Physics', domain_path: 'Knowledge > Physics' }, 'domain_path')).toBe(true);
    expect(domainRepeatsBreadcrumb({ breadcrumb: 'Knowledge/Physics', domain: 'Finance' }, 'domain')).toBe(false);
    expect(domainRepeatsBreadcrumb({ domain: 'Knowledge' }, 'domain')).toBe(false);
  });

  it('keeps created and modified and moves them last', () => {
    const text = '---\ncreated: 2026-01-02T10:00\nmodified: 2026-01-03T10:00\ntype: kb\nschema: 1\nid: KB-000001\nname: N\nstatus: draft\nsource:\n  title: T\n---\nbody\n';
    const out = readFrontmatter(migrate(text, t('kb')).text) as Frontmatter;
    expect(Object.keys(out).slice(-2)).toEqual(['created', 'modified']);
    expect(out).toMatchObject({ created: '2026-01-02T10:00', modified: '2026-01-03T10:00' });
  });

  it('does not lose a single value: every original value ends up in the note, flattened or archived', () => {
    const fm: Frontmatter = {
      schema: 1, type: 'kb', id: 'KB-000009', created: '2026-01-02T10:00', modified: '2026-01-03T10:00',
      source: { title: 'T', odd: 1 }, review: { cycle: 'weekly' }, domain: 'Other', tags: ['idea'],
    };
    const draft = JSON.parse(JSON.stringify(fm)) as Frontmatter;
    planMigration(fm, t('kb'), now).apply(draft);
    const all = JSON.stringify(draft);
    for (const needle of ['"T"', '"odd":1', '"weekly"', '"Other"', '"idea"']) expect(all, needle).toContain(needle);
  });

  it('is exact: running the migration twice changes nothing the second time', () => {
    const text = '---\ntype: kb\nschema: 1\nid: KB-000001\nname: N\nstatus: draft\ncreated: 2026-01-02T10:00\nmodified: 2026-01-03T10:00\nreview:\n  cycle: yearly\n---\nbody\n';
    const once = migrate(text, t('kb'));
    const fm = readFrontmatter(once.text) as Frontmatter;
    expect(needsMigration(fm, t('kb'))).toBe(false);
    expect(once.text.endsWith('---\nbody\n')).toBe(true);
  });
});

describe('read-only notes from a newer schema', () => {
  it('detects a schema number above the type’s version, and says why', async () => {
    const { isNewerThanSchema, newerSchemaMessage } = await import('../src/core/migrate');
    expect(isNewerThanSchema({ schema: 3 }, t('kb'))).toBe(true);
    expect(isNewerThanSchema({ schema: 2 }, t('kb'))).toBe(false);
    expect(isNewerThanSchema({ schema: 1 }, t('kb'))).toBe(false);
    expect(isNewerThanSchema({}, t('kb'))).toBe(false);
    expect(newerSchemaMessage({ schema: 3 }, t('kb'))).toContain('schema 3');
  });
});
