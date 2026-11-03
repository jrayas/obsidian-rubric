import { describe, expect, it } from 'vitest';
import { typeFor } from '../src/core/domain-overrides';
import { loadFixture } from './helpers/domain-fixture';
import { loadWith } from './helpers/pack';

const withBody = (yaml: string) => loadWith({ 'types/task.yaml': (t) => `${t}\nbody:\n${yaml}\n` });
const body = (r: Awaited<ReturnType<typeof loadWith>>, type = 'task') => r.pack?.types.get(type)?.body;
const problem = (r: Awaited<ReturnType<typeof loadWith>>, code: string) => r.problems.find((p) => p.code === code);

describe('the body: key of a type file', () => {
  it('is disabled when the type has no body key', async () => {
    const r = await loadWith();
    expect(r.problems.filter((p) => p.code.startsWith('body-'))).toEqual([]);
    expect(body(r)).toEqual({ enabled: false });
  });

  it('enables body access for the type that asks, and only that type', async () => {
    const r = await withBody('  enabled: true');
    expect(r.problems.filter((p) => p.code.startsWith('body-'))).toEqual([]);
    expect(body(r)).toEqual({ enabled: true });
    expect(body(r, 'kb')).toEqual({ enabled: false });
  });

  it('accepts enabled: false, an empty map and null as disabled', async () => {
    expect(body(await withBody('  enabled: false'))).toEqual({ enabled: false });
    expect(body(await withBody('  {}'))).toEqual({ enabled: false });
    const r = await loadWith({ 'types/task.yaml': (t) => `${t}\nbody:\n` });
    expect(r.problems.filter((p) => p.code.startsWith('body-'))).toEqual([]);
    expect(body(r)).toEqual({ enabled: false });
  });

  it('warns about an unknown key, names the file and line, and still loads the pack', async () => {
    const r = await withBody('  enabled: true\n  templat: x');
    const p = problem(r, 'body-unknown-key');
    expect(p).toMatchObject({ severity: 'warning', file: 'types/task.yaml' });
    expect(p?.message).toContain('"templat"');
    expect(p?.line).toBeGreaterThan(5);
    expect(r.pack).not.toBeNull();
    expect(body(r)).toEqual({ enabled: true });
  });

  it('reports a body that is not a map as body-shape and loads no pack (the last good copy stays)', async () => {
    for (const yaml of ['  - enabled', ' true']) {
      const r = await withBody(yaml);
      const p = problem(r, 'body-shape');
      expect(p).toMatchObject({ severity: 'error', file: 'types/task.yaml' });
      expect(p?.line).toBeGreaterThan(5);
      expect(r.pack).toBeNull();
    }
  });

  it('reports an enabled that is not true or false as body-shape on the enabled line', async () => {
    const r = await withBody('  enabled: yes please');
    const p = problem(r, 'body-shape');
    expect(p?.severity).toBe('error');
    expect(p?.message).toContain('body.enabled');
    expect(r.pack).toBeNull();
  });

  it('is not read from a module file (a body key there is ignored, as any unknown top-level key is)', async () => {
    const r = await loadWith({ 'modules/relations.yaml': (t) => `${t}\nbody:\n  enabled: true\n` });
    expect(r.problems.filter((p) => p.code.startsWith('body-'))).toEqual([]);
    expect(body(r)).toEqual({ enabled: false });
  });

  it('is carried unchanged into a domain-effective type', async () => {
    const r = await loadFixture({ 'types/kb.yaml': (t) => `${t}\nbody:\n  enabled: true\n` });
    expect(r.pack).not.toBeNull();
    const pack = r.pack;
    if (!pack) return;
    expect(typeFor(pack, 'kb', 'demo')?.domain).toBe('demo');
    expect(typeFor(pack, 'kb', 'demo')?.body).toEqual({ enabled: true });
    expect(typeFor(pack, 'kb', undefined)?.body).toEqual({ enabled: true });
  });
});

// ---- the body module -----------------------------------------------------------------------------------------

const BODY_MODULE = `module: body
description: What happens in the body of a note.
sections:
  - heading: Captures
    level: 2
    starter: "- {{time:HH:mm}} "
    keys:
      Enter: { insert: "- {{time:HH:mm}} " }
  - heading: Gratitude
    keys:
      Enter: { insert: "- " }
default:
  keys:
    Enter: { insert: "- {{ now().format('HH:mm') }} " }
    Tab: { insert: "{{time}} ", newline: false }
`;

const withModule = (module: string = BODY_MODULE, typeEdit: (text: string) => string = (t) => t) =>
  loadWith(
    {
      'registry/types.yaml': (t) => t.replace('modules:\n', 'modules:\n  body: modules/body.yaml\n'),
      'types/journal.yaml': (t) => typeEdit(t.replace('uses: [base, findability, relations]', 'uses: [base, findability, relations, body]')),
    },
    { 'modules/body.yaml': module },
  );

const journalBody = (r: Awaited<ReturnType<typeof loadWith>>) => r.pack?.types.get('journal')?.body;

describe('the body module', () => {
  it('loads with no problems, although it has no properties', async () => {
    const r = await withModule();
    expect(r.problems).toEqual([]);
    expect(r.pack?.modules.get('body')?.body?.sections.map((s) => s.heading)).toEqual(['Captures', 'Gratitude']);
  });

  it('opts in a type that uses it, with the rules, and no other type', async () => {
    const r = await withModule();
    const b = journalBody(r);
    expect(b?.enabled).toBe(true);
    expect(b?.rules?.sections[0]).toEqual({
      heading: 'Captures',
      level: 2,
      starter: '- {{time:HH:mm}} ',
      scaffold: true,
      keys: { Enter: { insert: '- {{time:HH:mm}} ' } },
    });
    expect(b?.rules?.default.Tab).toEqual({ insert: '{{time}} ', newline: false });
    expect(body(r, 'kb')).toEqual({ enabled: false });
  });

  it("is changed by the type's own body block: a section key at a time, a new section, and enabled: false", async () => {
    const r = await withModule(BODY_MODULE, (t) =>
      `${t}\nbody:\n  sections:\n    - heading: Captures\n      level: 2\n      keys:\n        Enter: { insert: "* {{time}} " }\n    - heading: Events\n      keys:\n        Enter: { pass: true }\n`,
    );
    const rules = journalBody(r)?.rules;
    expect(rules?.sections.map((s) => s.heading)).toEqual(['Captures', 'Gratitude', 'Events']);
    expect(rules?.sections[0]?.keys.Enter).toEqual({ insert: '* {{time}} ' });
    expect(rules?.sections[0]?.starter).toBe('- {{time:HH:mm}} '); // kept from the module
    expect(rules?.sections[2]?.keys.Enter).toEqual({ pass: true });

    const off = await withModule(BODY_MODULE, (t) => `${t}\nbody:\n  enabled: false\n`);
    expect(journalBody(off)?.enabled).toBe(false);
    expect(journalBody(off)?.rules?.sections.length).toBe(2); // the rules are still there, switched off
  });

  it('reports an unknown key name under keys, with file and line, and keeps the last good schema', async () => {
    const r = await withModule(BODY_MODULE.replace('Tab: {', 'Space: {'));
    const p = problem(r, 'body-shape');
    expect(p).toMatchObject({ severity: 'error', file: 'modules/body.yaml' });
    expect(p?.message).toContain('Space');
    expect(p?.line).toBeGreaterThan(5);
    expect(r.pack).toBeNull();
  });

  it('reports a formula that does not parse as body-formula on the line of the rule', async () => {
    const r = await withModule(BODY_MODULE.replace("now().format('HH:mm')", 'now('));
    const p = problem(r, 'body-formula');
    expect(p).toMatchObject({ severity: 'error', file: 'modules/body.yaml' });
    expect(p?.message).toContain('now(');
    expect(p?.line).toBeGreaterThan(10);
    expect(r.pack).toBeNull();
  });

  it('reports a section with no heading, a level that is not 1 to 6, and a list that is not a list', async () => {
    expect(problem(await withModule('module: body\nsections:\n  - level: 2\n'), 'body-shape')?.message).toContain('"heading"');
    expect(problem(await withModule('module: body\nsections:\n  - heading: A\n    level: 7\n'), 'body-shape')?.message).toContain('1 to 6');
    expect(problem(await withModule('module: body\nsections: Captures\n'), 'body-shape')?.message).toContain('list');
    expect(problem(await withModule('module: body\nsections:\n  - heading: A\n    scaffold: maybe\n'), 'body-shape')?.message).toContain('scaffold');
  });

  it('warns about unknown keys and a rule that does nothing, and still loads', async () => {
    const r = await withModule(
      'module: body\nsections:\n  - heading: A\n    colour: red\n    keys:\n      Enter: { wibble: 1 }\ndefault:\n  extra: 1\n  keys:\n    Tab: { insert: "x" }\n',
    );
    const warnings = r.problems.filter((p) => p.code === 'body-unknown-key');
    expect(warnings.map((w) => w.severity)).toEqual(['warning', 'warning', 'warning', 'warning']);
    expect(warnings.some((w) => w.message.includes('"colour"'))).toBe(true);
    expect(warnings.some((w) => w.message.includes('does nothing'))).toBe(true);
    expect(r.pack).not.toBeNull();
  });

  it('warns when a heading is listed twice and keeps the later one', async () => {
    const r = await withModule('module: body\nsections:\n  - heading: A\n    starter: one\n  - heading: a\n    starter: two\n');
    expect(problem(r, 'body-unknown-key')?.message).toContain('listed twice');
    expect(journalBody(r)?.rules?.sections.map((s) => s.starter)).toEqual(['two']);
  });

  it('is still an error for an ordinary module with no properties', async () => {
    const r = await loadWith({ 'modules/relations.yaml': () => 'module: relations\n' });
    expect(problem(r, 'module-empty')).toBeDefined();
  });
});
