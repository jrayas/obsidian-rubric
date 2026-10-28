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
