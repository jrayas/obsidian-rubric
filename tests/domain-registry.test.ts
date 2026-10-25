import { describe, expect, it } from 'vitest';
import { domainFromFolder, typeFor } from '../src/core/domain-overrides';
import type { Problem, SchemaPack } from '../src/core/schema-types';
import { uniqueScope } from '../src/core/unique-id';
import { load, loadPack, packFiles, shippedFiles } from './helpers/pack';

const DOMAINS = 'registry/domains.yaml';
const errors = (p: Problem[]) => p.filter((x) => x.severity === 'error');
const codes = (p: Problem[]) => errors(p).map((x) => x.code);

/** The shipping pack with edits: { path: new text | (old) => new | null to delete }. */
async function shipped(edits: Record<string, string | ((t: string) => string) | null>) {
  const files = shippedFiles();
  for (const [path, how] of Object.entries(edits)) {
    if (how === null) files.delete(path);
    else files.set(path, typeof how === 'function' ? how(files.get(path) ?? '') : how);
  }
  return load(files);
}
const registry = (body: string, head = 'default: general\n') => `${head}domains:\n${body}`;

describe('registry/domains.yaml', () => {
  it('lists the domains, their prefixes, the default and each folder', async () => {
    const pack = (await shipped({})).pack as SchemaPack;
    expect(pack.domains).toEqual(['general', 'maths', 'physics', 'pcb', 'embedded']);
    expect(pack.defaultDomain).toBe('general');
    expect(pack.domainRegistry?.get('pcb')).toMatchObject({ prefix: 'PC', folder: 'pcb', description: 'Printed circuit board design.' });
    expect(pack.domainFolder.get('maths')).toBe('maths');
  });

  it('gives the domain property its values, default and prefixes from the registry', () => {
    return shipped({}).then((r) => {
      const d = (r.pack as SchemaPack).types.get('kb')?.byName.get('domain');
      expect(d?.values).toEqual(['general', 'maths', 'physics', 'pcb', 'embedded']);
      expect(d?.default).toBe('general');
      expect(d?.prefixes).toEqual({ general: 'GE', maths: 'MA', physics: 'PY', pcb: 'PC', embedded: 'EM' });
    });
  });

  it('a prefix is optional: that domain gets no unique ID', async () => {
    const r = await shipped({ [DOMAINS]: (t) => t.replace('{ prefix: MA, description: Mathematics. }', '{ description: Mathematics. }') });
    expect(errors(r.problems)).toEqual([]);
    const lesson = (r.pack as SchemaPack).types.get('kb') as never;
    expect(uniqueScope(lesson, 'general')?.domainPrefix).toBe('GE');
    expect(uniqueScope(lesson, 'maths')).toBeNull();
  });

  it('a folder name can differ from the domain name, and then the folder decides', async () => {
    const r = await shipped({ [DOMAINS]: (t) => t.replace('{ prefix: MA, description: Mathematics. }', '{ prefix: MA, folder: Mathematics }') });
    const pack = r.pack as SchemaPack;
    expect(pack.domainFolder.get('maths')).toBe('Mathematics');
    expect(domainFromFolder(pack.domainFolder, 'Knowledge/mathematics/Limits.md')).toBe('maths'); // case ignored
    expect(domainFromFolder(pack.domainFolder, 'Knowledge/maths/Limits.md')).toBeUndefined(); // the domain's own name is no longer the folder
  });

  it('the default is the first domain when the file names none, and must be a listed domain when it does', async () => {
    const all = '  maths: { prefix: MA }\n  general: { prefix: GE }\n  physics: { prefix: PY }\n  pcb: { prefix: PC }\n  embedded: { prefix: EM }\n';
    const first = await shipped({ [DOMAINS]: registry(all, '') });
    expect((first.pack as SchemaPack).defaultDomain).toBe('maths');
    expect(codes((await shipped({ [DOMAINS]: registry(all, 'default: nowhere\n') })).problems)).toContain('domains-default');
  });

  it('rejects bad names, prefixes and folders, naming the file', async () => {
    const bad = async (body: string) => (await shipped({ [DOMAINS]: registry(body) })).problems.filter((p) => p.file === DOMAINS && p.severity === 'error').map((p) => p.code);
    expect(await bad('  general: {}\n  Maths: {}\n')).toContain('domains-name');
    expect(await bad('  general: {}\n  "a b": {}\n')).toContain('domains-name');
    expect(await bad('  general: { prefix: G }\n')).toContain('prefixes');
    expect(await bad('  general: { prefix: ge }\n')).toContain('prefixes');
    expect(await bad('  general: { prefix: GE }\n  maths: { prefix: GE }\n')).toContain('prefixes');
    expect(await bad('  general: { folder: a/b }\n')).toContain('domains-folder');
    expect(await bad('  general: { folder: Same }\n  maths: { folder: same }\n')).toContain('domains-folder');
    expect(await bad('  general: 7\n')).toContain('domains-shape');
  });

  it('rejects a registry that is not a map, or lists no domains', async () => {
    expect(codes((await shipped({ [DOMAINS]: '- a\n- b\n' })).problems)).toContain('domains-shape');
    expect(codes((await shipped({ [DOMAINS]: 'default: general\ndomains: {}\n' })).problems)).toContain('domains-shape');
    expect(codes((await shipped({ [DOMAINS]: 'default: general\n' })).problems)).toContain('domains-shape');
  });

  it('warns about an attribute it does not know, and still loads', async () => {
    const r = await shipped({ [DOMAINS]: (t) => t.replace('{ prefix: GE, description', '{ prefix: GE, colour: red, description') });
    expect(r.problems.some((p) => p.code === 'unknown-attribute' && p.file === DOMAINS && p.severity === 'warning')).toBe(true);
    expect(r.pack).not.toBeNull();
  });

  it('a property that takes its values from the registry needs the file', async () => {
    const r = await shipped({ [DOMAINS]: null });
    expect(codes(r.problems)).toContain('domains-missing');
    expect(r.pack).toBeNull();
  });

  it('the registry is the one source: prefixes on the property as well is an error', async () => {
    const r = await shipped({ 'modules/domain.yaml': (t) => t.replace('    values_from: domains\n', '    values_from: domains\n    prefixes: {general: GE}\n') });
    expect(codes(r.problems)).toContain('prefixes');
  });

  it('a unique_id with no prefix on any domain is an error', async () => {
    const r = await shipped({ [DOMAINS]: registry('  general: {}\n  maths: {}\n') });
    expect(codes(r.problems)).toContain('unique-id-prefixes');
  });

  it('override files are found for the registered domains, and a file for another is an error that lists them', async () => {
    const ok = await shipped({});
    expect([...(ok.pack as SchemaPack).domainFiles.keys()].sort()).toEqual(['embedded', 'maths', 'pcb', 'physics']);
    const bad = await shipped({ 'types/kb/chemistry.yaml': 'domain: chemistry\nremove: [audience]\n' });
    const p = errors(bad.problems).find((x) => x.code === 'override-domain-unknown');
    expect(p?.file).toBe('types/kb/chemistry.yaml');
    expect(p?.message).toContain('registry/domains.yaml');
    expect(p?.message).toContain('general, maths, physics, pcb, embedded');
  });

  it('effective types follow the registry: the same overrides apply as before', async () => {
    const pack = (await shipped({})).pack as SchemaPack;
    expect(typeFor(pack, 'kb', 'maths')?.byName.get('kind')?.values).toEqual(['definition', 'theorem', 'proof', 'example', 'concept']);
    expect(typeFor(pack, 'kb', 'general')).toBe(pack.types.get('kb'));
  });
});

describe('without a registry (the earlier form)', () => {
  it('still works: the domains come from the domain property’s own values and prefixes', async () => {
    const pack = await loadPack(); // the frozen rule pack keeps the earlier form
    expect(pack.domainRegistry).toBeNull();
    expect(pack.domains).toEqual(['general', 'maths']);
    expect(pack.defaultDomain).toBe('general');
    expect([...pack.domainFolder]).toEqual([['general', 'general'], ['maths', 'maths']]);
    expect(domainFromFolder(pack.domainFolder, 'Knowledge/maths/Limits.md')).toBe('maths');
  });

});

describe('a module that depends on another', () => {
  it('a type that uses curriculum without the domain module is an error that names both', async () => {
    const r = await shipped({ 'types/kb.yaml': (t) => t.replace(', domain, curriculum', ', curriculum') });
    const p = errors(r.problems).find((x) => x.code === 'module-requires');
    expect(p?.file).toBe('types/kb.yaml');
    expect(p?.message).toContain('"curriculum" requires "domain"');
  });

  it('a module that requires a module not in the registry is an error', async () => {
    const r = await shipped({ 'modules/curriculum.yaml': (t) => t.replace('requires: [domain]', 'requires: [domain, ghost]') });
    expect(errors(r.problems).some((x) => x.code === 'unknown-module' && x.file === 'modules/curriculum.yaml')).toBe(true);
  });

  it('requires must be a list of names', async () => {
    const r = await shipped({ 'modules/curriculum.yaml': (t) => t.replace('requires: [domain]', 'requires: 5') });
    expect(codes(r.problems)).toContain('module-shape');
  });

  it('the order of uses stays the type’s own choice', async () => {
    const r = await shipped({ 'types/kb.yaml': (t) => t.replace('pathways, domain, curriculum, verification', 'pathways, verification, domain, curriculum') });
    expect(r.problems).toEqual([]);
    const names = (r.pack as SchemaPack).types.get('kb')?.properties.map((p) => p.name) ?? [];
    expect(names.indexOf('references')).toBeLessThan(names.indexOf('domain'));
  });
});

describe('a module that lost its content', () => {
  it('is one clear error naming the file, not a flood about the override files', async () => {
    // the very case: another file was saved over modules/domain.yaml, so it has no properties
    const r = await shipped({ 'modules/domain.yaml': 'domain: maths\nsections: [maths-a]\n' });
    const problems = errors(r.problems);
    expect(problems.some((p) => p.code === 'module-empty' && p.file === 'modules/domain.yaml')).toBe(true);
    expect(problems.filter((p) => p.code === 'override-domain-unknown')).toEqual([]); // the registry still lists the domains
  });

  it('without a registry the "no domains" flood is one error that names the first file and the count', async () => {
    const files = packFiles();
    files.set('modules/curriculum.yaml', 'domain: maths\nsections: [maths-a]\n');
    const r = await load(files);
    const unknown = errors(r.problems).filter((p) => p.code === 'override-domain-unknown');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.message).toMatch(/\d+ override files? found/);
    expect(errors(r.problems).some((p) => p.code === 'module-empty' && p.file === 'modules/curriculum.yaml')).toBe(true);
  });
});
