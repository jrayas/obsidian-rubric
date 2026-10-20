import { describe, expect, it } from 'vitest';
import { loadWith, packFiles, load } from './helpers/pack';

const codes = (r: Awaited<ReturnType<typeof load>>) => r.problems.map((p) => `${p.severity}:${p.code}`);

describe('schema validation names the file and line', () => {
  it('reports invalid YAML with the line', async () => {
    const r = await loadWith({ 'modules/review.yaml': (t) => t + '\n  bad: [unclosed\n' });
    expect(r.pack).toBeNull();
    const p = r.problems.find((x) => x.code === 'yaml-syntax');
    expect(p?.file).toBe('modules/review.yaml');
    expect(p?.line).toBeGreaterThan(5);
  });

  it('reports an unknown module in a type', async () => {
    const r = await loadWith({ 'types/kb.yaml': (t) => t.replace('provenance, review', 'provenance, reveiw') });
    const p = r.problems.find((x) => x.code === 'unknown-module');
    expect(r.pack).toBeNull();
    expect(p?.file).toBe('types/kb.yaml');
    expect(p?.message).toContain('reveiw');
    expect(p?.line).toBe(3);
  });

  it('reports an enum default that is not in its list', async () => {
    const r = await loadWith({ 'modules/review.yaml': (t) => t.replace('default: 6-months', 'default: 9-months') });
    const p = r.problems.find((x) => x.code === 'bad-default');
    expect(r.pack).toBeNull();
    expect(p?.file).toBe('modules/review.yaml');
    expect(p?.message).toContain('9-months');
    expect(p?.line).toBeGreaterThan(0);
  });

  it('reports a status default that is not in the type override list', async () => {
    const r = await loadWith({ 'types/task.yaml': (t) => t.replace('default: todo', 'default: nope') });
    const p = r.problems.find((x) => x.code === 'bad-default');
    expect(p?.file).toBe('types/task.yaml');
    expect(p?.line).toBe(7);
  });

  it('reports an unknown value type', async () => {
    const r = await loadWith({ 'modules/provenance.yaml': (t) => t.replace('type: url', 'type: hyperlink') });
    const p = r.problems.find((x) => x.code === 'unknown-value-type');
    expect(p?.file).toBe('modules/provenance.yaml');
    expect(p?.message).toContain('hyperlink');
  });

  it('reports a property type conflict naming both places', async () => {
    const r = await loadWith({ 'types/task.yaml': (t) => t.replace('  context:\n    type: string', '  context:\n    type: integer').replace('  effort:\n    type: string', '  effort:\n    type: string') ,
      'types/journal.yaml': (t) => t.replace('  location:\n    type: string', '  location:\n    type: integer') });
    const conflict = r.problems.find((x) => x.code === 'type-conflict');
    expect(r.pack).toBeNull();
    expect(conflict).toBeDefined();
    expect(conflict?.message).toContain('location');
    expect(conflict?.message).toContain('types/');
    expect(conflict?.file).toMatch(/^types\//);
  });

  it('allows enum value lists to differ between types', async () => {
    const r = await loadWith();
    expect(r.pack?.types.get('exercise')?.byName.get('kind')?.values).not.toEqual(r.pack?.types.get('kb')?.byName.get('kind')?.values);
    expect(codes(r)).toEqual([]);
  });

  it('refuses a newer format and a pack that needs a newer plugin', async () => {
    const newer = await loadWith({ 'registry/types.yaml': (t) => t.replace('format: 1', 'format: 2') });
    expect(codes(newer)).toContain('error:format-newer');
    const tooOld = await loadWith({ 'registry/types.yaml': (t) => t.replace('min_plugin_version: 0.1.0', 'min_plugin_version: 9.0.0') });
    expect(codes(tooOld)).toContain('error:plugin-too-old');
  });

  it('reports a missing file', async () => {
    const files = packFiles();
    files.delete('types/person.yaml');
    const r = await load(files);
    expect(r.problems.find((x) => x.code === 'file-missing')?.file).toBe('types/person.yaml');
  });

  it('reports a type that does not use base, a missing status list and a duplicate prefix', async () => {
    expect(codes(await loadWith({ 'types/note.yaml': (t) => t.replace('[base, ', '[') }))).toContain('error:type-uses');
    expect(codes(await loadWith({ 'types/note.yaml': (t) => t.replace(/overrides:[\s\S]*?properties:/, 'properties:') }))).toContain('error:values-from-type');
    expect(codes(await loadWith({ 'registry/types.yaml': (t) => t.replace('prefix: PR', 'prefix: KB') }))).toContain('error:type-prefix');
  });

  it('reports an unknown vocabulary, a bad pattern and a duplicate synonym', async () => {
    expect(codes(await loadWith({ 'modules/findability.yaml': (t) => t.replace('vocabulary: tags', 'vocabulary: topics') }))).toContain('error:vocabulary-unknown');
    expect(codes(await loadWith({ 'modules/base.yaml': (t) => t.replace(`'^[A-Z]{2}-\\d{4}-\\d{4,}$'`, `'(['`) }))).toContain('error:pattern');
    expect(codes(await loadWith({ 'vocabularies/tags.yaml': (t) => t.replace('synonyms: [sop,', 'synonyms: [idea,') }))).toContain('error:vocabulary-clash');
  });

  it('warns about an unknown attribute but still loads', async () => {
    const r = await loadWith({ 'modules/review.yaml': (t) => t.replace('review_last:\n    type: date', 'review_last:\n    type: date\n    colour: red') });
    expect(r.pack).not.toBeNull();
    const w = r.problems.find((x) => x.code === 'unknown-attribute');
    expect(w?.severity).toBe('warning');
    expect(w?.file).toBe('modules/review.yaml');
  });

  it('warns when two types claim folders that compare equal (case and accents) and lists the conflict', async () => {
    const r = await loadWith({ 'registry/folders.yaml': (t) => t.trimEnd() + '\n  PROJÉCTS: task\n' });
    expect(r.pack).not.toBeNull();
    expect(r.pack?.folders.conflicts).toEqual([{ folder: 'Projects', types: ['project', 'task'] }]);
    expect(r.problems.some((p) => p.code === 'folder-conflict' && p.severity === 'warning')).toBe(true);
  });

  it('reports a folder mapped to an unknown type and a bad mode', async () => {
    expect(codes(await loadWith({ 'registry/folders.yaml': (t) => t.replace('Tasks: task', 'Tasks: tsak') }))).toContain('error:folders-unknown-type');
    expect(codes(await loadWith({ 'registry/folders.yaml': (t) => t.replace('mode: combined', 'mode: sometimes') }))).toContain('error:folders-mode');
  });

  it('warns that a custom matching order is ignored', async () => {
    const r = await loadWith({ 'registry/folders.yaml': (t) => t.replace('[type, breadcrumb, folder, ask]', '[folder, type, ask]') });
    expect(r.problems.some((p) => p.code === 'folders-order')).toBe(true);
    expect(r.pack).not.toBeNull();
  });

  it('reports duplicate YAML keys', async () => {
    const r = await loadWith({ 'registry/scope.yaml': (t) => t + 'mode: include-only\n' });
    expect(r.problems.some((p) => p.code === 'yaml-syntax' && p.file === 'registry/scope.yaml')).toBe(true);
  });
});
