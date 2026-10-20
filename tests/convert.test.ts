import { beforeAll, describe, expect, it } from 'vitest';
import { planConversion } from '../src/core/convert';
import { newNoteFrontmatter } from '../src/core/create';
import { validateValue } from '../src/core/validate';
import { editFrontmatter, readFrontmatter } from '../src/core/frontmatter';
import type { Frontmatter } from '../src/core/frontmatter';
import type { ResolvedType, SchemaPack } from '../src/core/schema-types';
import { loadPack } from './helpers/pack';

let pack: SchemaPack;
const t = (n: string) => pack.types.get(n) as ResolvedType;
const now = new Date(2026, 9, 21, 9, 5);
beforeAll(async () => {
  pack = await loadPack();
});

const TASK: Frontmatter = {
  type: 'task', schema: 2, id: 'TK-2026-0012', name: 'Review contract', status: 'doing', aliases: [], tags: ['policy'],
  language: 'en-GB', priority: 2, project: '[[Contract Renewal]]', due: '2026-10-24', depends_on: [],
  mood_note: 'a custom key', created: '2026-10-18T10:15', modified: '2026-10-20T16:40',
};

describe('changing type (rule 8)', () => {
  it('previews what is added with defaults and what is kept in archived_fields', () => {
    const plan = planConversion(TASK, t('task'), t('kb'), now);
    expect(plan.added).toMatchObject({ status: 'draft', kind: 'concept', audience: 'self', confidence: 'medium', review_cycle: '6-months' });
    expect(plan.archived).toEqual({ status: 'doing', priority: 2, project: '[[Contract Renewal]]', due: '2026-10-24' });
    expect(plan.kept).toEqual(['aliases', 'tags', 'language']);
  });

  it('writes the new type and schema version and records the old values; nothing is deleted', () => {
    const plan = planConversion(TASK, t('task'), t('kb'), now);
    const draft = JSON.parse(JSON.stringify(TASK)) as Frontmatter;
    plan.apply(draft);
    expect(draft.type).toBe('kb');
    expect(draft.schema).toBe(2);
    expect(draft.status).toBe('draft');
    expect(draft.archived_fields).toEqual([
      { type: 'task', date: '2026-10-21', values: { status: 'doing', priority: 2, project: '[[Contract Renewal]]', due: '2026-10-24' } },
    ]);
    // every old value is somewhere
    for (const [k, v] of Object.entries(TASK)) {
      const found = JSON.stringify(draft[k]) === JSON.stringify(v) || k in (plan.archived) || ['type', 'status'].includes(k) || (Array.isArray(v) && v.length === 0);
      expect(found, k).toBe(true);
    }
    // identity, the ID, timestamps and unknown keys are untouched
    expect(draft).toMatchObject({ id: 'TK-2026-0012', name: 'Review contract', created: '2026-10-18T10:15', mood_note: 'a custom key' });
  });

  it('keeps a shared property when its value is valid for the new type (priority task to project)', () => {
    const plan = planConversion(TASK, t('task'), t('project'), now);
    expect(plan.kept).toContain('priority');
    expect(plan.archived).not.toHaveProperty('priority');
    expect(plan.archived.status).toBe('doing');
    expect(plan.archived.project).toBe('[[Contract Renewal]]');
  });

  it('archives a shared property whose value is not valid for the new type', () => {
    const fm = { ...TASK, priority: 5 };
    const to = { ...t('project'), byName: new Map(t('project').byName) };
    const priority = { ...(to.byName.get('priority') as NonNullable<ReturnType<typeof to.byName.get>>), max: 3 };
    to.byName.set('priority', priority);
    const plan = planConversion(fm, t('task'), to, now);
    expect(plan.archived.priority).toBe(5);
    expect(plan.added.priority).toBe(3);
  });

  it('appends to archived_fields on a second conversion instead of overwriting', () => {
    const first = JSON.parse(JSON.stringify(TASK)) as Frontmatter;
    planConversion(TASK, t('task'), t('kb'), now).apply(first);
    const back = planConversion(first, t('kb'), t('task'), new Date(2026, 9, 22));
    back.apply(first);
    const archive = first.archived_fields as { type: string; date: string }[];
    expect(archive.map((a) => a.type)).toEqual(['task', 'kb']);
    expect(archive[0]?.date).toBe('2026-10-21');
    expect(first.type).toBe('task');
  });

  it('produces a note that is valid for the new type and keeps the order through the writer', () => {
    const text = '---\ntype: task\nstatus: doing\npriority: 2\ncreated: 2026-10-18T10:15\nmodified: 2026-10-20T16:40\n---\nbody\n';
    const result = editFrontmatter(text, (fm) => planConversion(fm, t('task'), t('kb'), now).apply(fm));
    const fm = readFrontmatter(result.text) as Frontmatter;
    for (const def of t('kb').properties) {
      if (def.name in fm && !def.locked) expect(validateValue(def, fm[def.name]), def.name).toBeNull();
    }
    expect(result.text.endsWith('---\nbody\n')).toBe(true);
  });
});

describe('creating a note from a type', () => {
  const ctx = { name: 'Wave-Particle Duality', id: 'KB-2026-0143', now };

  it('writes every required property and every default, in schema order, created and modified last', () => {
    const fm = newNoteFrontmatter(t('kb'), ctx);
    expect(Object.keys(fm)).toEqual([
      'type', 'schema', 'id', 'name', 'status', 'aliases', 'language', 'related', 'supersedes',
      'review_cycle', 'kind', 'audience', 'confidence', 'created', 'modified',
    ]);
    expect(fm).toMatchObject({ type: 'kb', schema: 2, id: 'KB-2026-0143', name: 'Wave-Particle Duality', status: 'draft', created: '2026-10-21T09:05', modified: '2026-10-21T09:05' });
  });

  it('never writes the breadcrumb (another plugin owns it)', () => {
    for (const type of pack.types.values()) expect(newNoteFrontmatter(type, ctx)).not.toHaveProperty('breadcrumb');
  });

  it('has a valid ID, valid values and every required property for every type', () => {
    for (const type of pack.types.values()) {
      const fm = newNoteFrontmatter(type, { ...ctx, id: `${type.prefix}-2026-0001` });
      for (const def of type.properties) {
        if (def.required) expect(fm, `${type.name}.${def.name}`).toHaveProperty(def.name);
        if (def.name in fm) expect(validateValue(def, fm[def.name]), `${type.name}.${def.name}`).toBeNull();
      }
      expect(fm.status).toBe(type.byName.get('status')?.values?.[0]);
    }
  });

  it('fills today into a journal date and lets the caller choose the status', () => {
    expect(newNoteFrontmatter(t('journal'), ctx).date).toBe('2026-10-21');
    expect(newNoteFrontmatter(t('task'), { ...ctx, status: 'doing' }).status).toBe('doing');
  });

  it('writes priority and progress defaults', () => {
    expect(newNoteFrontmatter(t('task'), ctx).priority).toBe(3);
    expect(newNoteFrontmatter(t('resource'), ctx).progress_percent).toBe(0);
  });
});
