import { beforeAll, describe, expect, it } from 'vitest';
import { planCompletion } from '../src/core/create';
import { desiredOrder, editFrontmatter, readFrontmatter, bodyOf } from '../src/core/frontmatter';
import type { ResolvedType, SchemaPack } from '../src/core/schema-types';
import { findPlaceholders, insertBodyIfEmpty, parseTemplate, renderText, useTemplate } from '../src/core/templates';
import type { TemplateDef } from '../src/core/templates';
import { load, loadPack, loadWith, packFiles } from './helpers/pack';

let pack: SchemaPack;
const t = (n: string) => pack.types.get(n) as ResolvedType;
const now = new Date(2026, 9, 24, 9, 5);
const ctx = { name: 'Wave', id: 'KB-2026-0143', type: 'kb', now, folder: 'Knowledge/Physics' };
beforeAll(async () => {
  pack = await loadPack();
});

describe('placeholders', () => {
  it('fills the known ones and leaves unknown ones as written', () => {
    expect(renderText('# {{name}} ({{ id }}) {{type}} on {{date}} at {{datetime}} in {{folder}} {{nope}}', ctx)).toBe(
      '# Wave (KB-2026-0143) kb on 2026-10-24 at 2026-10-24T09:05 in Knowledge/Physics {{nope}}',
    );
  });

  it('lists the placeholders in a text', () => {
    expect(findPlaceholders('a {{name}} b {{ date }} {{name}}')).toEqual(['name', 'date', 'name']);
  });
});

describe('reading a template', () => {
  it('splits properties from the body', () => {
    const { def, issues } = parseTemplate(t('kb'), 'templates/kb.md', '---\naudience: team\n---\n## Summary\n');
    expect(issues).toEqual([]);
    expect(def).toMatchObject({ type: 'kb', values: { audience: 'team' }, body: '## Summary\n' });
  });

  it('treats a file with no properties as all body', () => {
    expect(parseTemplate(t('kb'), 'x', '## Only body\n').def?.body).toBe('## Only body\n');
  });

  it('ignores properties the plugin owns, unknown ones and invalid values, each with a warning and a line', () => {
    const text = '---\nid: KB-1\ntype: task\nnope: 1\naudience: galaxy\nkind: faq\n---\nbody\n';
    const { def, issues } = parseTemplate(t('kb'), 'templates/kb.md', text, (k) => ({ id: 2, type: 3, nope: 4, audience: 5, kind: 6 })[k]);
    expect(def?.values).toEqual({ kind: 'faq' });
    expect(issues.map((i) => i.line)).toEqual([2, 3, 4, 5]);
    for (const [i, key] of ['id', 'type', 'nope', 'audience'].entries()) expect(issues[i]?.message).toContain(`“${key}”`);
  });

  it('reports an unknown placeholder', () => {
    const { issues } = parseTemplate(t('kb'), 'x', '---\ndescription: "{{wat}}"\n---\nHello {{name}} {{who}}\n');
    expect(issues.some((i) => i.message.includes('{{who}}'))).toBe(true);
    expect(issues.some((i) => i.message.includes('{{wat}}'))).toBe(true);
  });

  it('does not use a template whose properties are not valid YAML', () => {
    const r = parseTemplate(t('kb'), 'templates/kb.md', '---\na: [unclosed\n---\nbody\n');
    expect(r.def).toBeNull();
    expect(r.issues[0]?.message).toContain('not valid YAML');
  });
});

describe('using a template', () => {
  const def: TemplateDef = { type: 'task', file: 't', values: { priority: 1, context: 'for {{name}}' }, body: '## Details {{id}}\n' };

  it('fills placeholders in the body and in text values', () => {
    expect(useTemplate(def, t('task'), { ...ctx, type: 'task' })).toEqual({ values: { priority: 1, context: 'for Wave' }, body: '## Details KB-2026-0143\n' });
  });

  it('has nothing when there is no template or the body is blank', () => {
    expect(useTemplate(undefined, t('task'), ctx)).toEqual({ values: {}, body: null });
    expect(useTemplate({ ...def, body: '  \n' }, t('task'), ctx).body).toBeNull();
  });

  it('inserts the body only into an empty note', () => {
    expect(insertBodyIfEmpty('', '## A')).toBe('## A\n');
    expect(insertBodyIfEmpty('  \n\n', '## A\n')).toBe('## A\n');
    expect(insertBodyIfEmpty('My text\n', '## A\n')).toBe('My text\n');
    expect(insertBodyIfEmpty('', null)).toBe('');
  });
});

describe('writing a body with the frontmatter', () => {
  it('adds the body to an empty note and keeps text that is already there', () => {
    const add = (fm: Record<string, unknown>) => (d: Record<string, unknown>) => void Object.assign(d, fm);
    const a = editFrontmatter('', add({ type: 'kb' }), { body: (b) => insertBodyIfEmpty(b, '## S') });
    expect(a.text).toBe('---\ntype: kb\n---\n## S\n');
    const b = editFrontmatter('---\nstatus: draft\n---\nMy text\n', add({ type: 'kb' }), { body: (x) => insertBodyIfEmpty(x, '## S') });
    expect(b.text.endsWith('---\nMy text\n')).toBe(true);
    expect(readFrontmatter(b.text)?.type).toBe('kb');
  });

  it('writes a body alone when no property changes, and nothing when the body does not change', () => {
    const r = editFrontmatter('---\ntype: kb\n---\n', () => undefined, { body: (b) => insertBodyIfEmpty(b, '## S') });
    expect(r.changed).toBe(true);
    expect(bodyOf(r.text)).toBe('## S\n');
    const same = editFrontmatter('---\ntype: kb\n---\nText\n', () => undefined, { body: (b) => insertBodyIfEmpty(b, '## S') });
    expect(same.changed).toBe(false);
  });

  it('keeps Windows line endings in the inserted body', () => {
    const r = editFrontmatter('---\r\ntype: kb\r\n---\r\n', (d) => void (d.status = 'draft'), { body: (b) => insertBodyIfEmpty(b, '## A\n\n## B\n') });
    expect(/[^\r]\n/.test(r.text)).toBe(false);
    expect(r.text.endsWith('## A\r\n\r\n## B\r\n')).toBe(true);
  });
});

describe('completing a note with a template', () => {
  const tpl: TemplateDef = { type: 'task', file: 't', values: { priority: 1, context: 'home' }, body: '## Details\n' };
  const plan = (fm: Record<string, unknown>, template?: TemplateDef) =>
    planCompletion(fm, t('task'), { name: 'Review', now, folder: 'Tasks', allocateId: () => 'TK-2026-0007', ...(template ? { template } : {}) });

  it('uses template values instead of schema defaults, and adds the others', () => {
    const p = plan({}, tpl);
    expect(p.added).toMatchObject({ priority: 1, context: 'home', status: 'todo', id: 'TK-2026-0007' });
  });

  it('never replaces a value the note already has', () => {
    const p = plan({ priority: 5, context: 'office' }, tpl);
    expect(p.added).not.toHaveProperty('priority');
    expect(p.added).not.toHaveProperty('context');
  });

  it('offers the body, which goes in only if the note is empty', () => {
    const p = plan({}, tpl);
    expect(p.templateBody).toBe('## Details\n');
    expect(p.body?.('')).toBe('## Details\n');
    expect(p.body?.('Mine\n')).toBe('Mine\n');
  });

  it('is the same as before without a template', () => {
    const p = plan({});
    expect(p.templateBody).toBeNull();
    expect(p.body).toBeUndefined();
    expect(p.added.priority).toBe(3);
  });

  it('produces a complete note in schema order with the body', () => {
    const p = plan({}, tpl);
    const r = editFrontmatter('', p.apply, { order: (k) => desiredOrder(k, t('task')), forceOrder: true, ...(p.body ? { body: p.body } : {}) });
    const keys = Object.keys(readFrontmatter(r.text) ?? {});
    expect(keys.slice(-2)).toEqual(['created', 'modified']);
    expect(keys.indexOf('context')).toBeGreaterThan(keys.indexOf('priority'));
    expect(r.text.endsWith('---\n## Details\n')).toBe(true);
  });
});

describe('templates in the schema folder', () => {
  it('the starter pack has a template for every type but note, and loads with no problems', async () => {
    const { pack: p, problems } = await load(packFiles());
    expect(problems).toEqual([]);
    expect([...(p?.templates.keys() ?? [])].sort()).toEqual(['exercise', 'journal', 'kb', 'person', 'project', 'resource', 'task']);
    expect(p?.templates.get('kb')?.body).toContain('## Summary');
    expect(p?.templates.get('project')?.values).toEqual({ priority: 3 });
  });

  it('a bad template is a warning with file and line and never stops the schema loading', async () => {
    const r = await loadWith({}, { 'templates/task.md': '---\npriority: 9\nnope: 1\n---\nbody {{who}}\n' });
    expect(r.pack).not.toBeNull();
    const w = r.problems.filter((p) => p.code === 'template');
    expect(w.every((p) => p.severity === 'warning' && p.file === 'templates/task.md')).toBe(true);
    expect(w.map((p) => p.line)).toEqual(expect.arrayContaining([2, 3]));
    expect(r.pack?.templates.get('task')?.values).toEqual({});
  });

  it('a template whose YAML is broken is skipped with a warning', async () => {
    const r = await loadWith({}, { 'templates/kb.md': '---\na: [x\n---\nbody\n' });
    expect(r.pack?.templates.has('kb')).toBe(false);
    expect(r.problems.some((p) => p.code === 'template' && p.message.includes('not valid YAML'))).toBe(true);
  });

  it('a template for a type that does not exist is simply not read', async () => {
    const r = await loadWith({}, { 'templates/ghost.md': 'text' });
    expect(r.problems).toEqual([]);
    expect(r.pack?.templates.has('ghost')).toBe(false);
  });
});
