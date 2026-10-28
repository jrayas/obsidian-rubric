import { describe, expect, it } from 'vitest';
import { describeDiff, diffFiles, isBundlePath, isNoChange, isSafePath, makePreset, parsePreset, presetSlug, serialisePreset } from '../src/core/schema-bundle';

const files = (o: Record<string, string>) => new Map(Object.entries(o));
const now = new Date('2026-10-28T15:40:00Z');

describe('which paths belong to a schema', () => {
  it('takes YAML and markdown files, not the generated preview folder or other files', () => {
    expect(isBundlePath('registry/types.yaml')).toBe(true);
    expect(isBundlePath('types/kb/maths.yaml')).toBe(true);
    expect(isBundlePath('REFERENCE.md')).toBe(true);
    expect(isBundlePath('preview/kb.yaml')).toBe(false);
    expect(isBundlePath('preview')).toBe(false);
    expect(isBundlePath('previews/kb.yaml')).toBe(true);
    expect(isBundlePath('notes.txt')).toBe(false);
    expect(isBundlePath('image.png')).toBe(false);
  });

  it('refuses paths that could leave the schema folder', () => {
    for (const bad of ['', '/etc/x.yaml', '../x.yaml', 'a/../x.yaml', 'a//x.yaml', './x.yaml', 'a\\x.yaml', 'C:/x.yaml', 'a/']) {
      expect(isSafePath(bad), bad).toBe(false);
      expect(isBundlePath(bad), bad).toBe(false);
    }
  });
});

describe('presets', () => {
  it('make a sorted, round-trippable file that leaves out what does not belong', () => {
    const p = makePreset('  My schema ', files({ 'types/kb.yaml': 'b\n', 'registry/types.yaml': 'a\n', 'preview/kb.yaml': 'x', 'a.txt': 'y' }), now, '0.4.0');
    expect(p.name).toBe('My schema');
    expect(Object.keys(p.files)).toEqual(['registry/types.yaml', 'types/kb.yaml']);
    const back = parsePreset(serialisePreset(p));
    expect(back).toEqual({ ok: true, preset: p });
  });

  it('keep text exactly, CRLF and BOM included', () => {
    const text = '\ufefftype: kb\r\n  x: 1\r\n';
    const back = parsePreset(serialisePreset(makePreset('n', files({ 'types/kb.yaml': text }), now, '0.4.0')));
    expect(back.ok && back.preset.files['types/kb.yaml']).toBe(text);
  });

  it('are refused when damaged, newer, or naming a path outside the schema folder', () => {
    const ok = JSON.parse(serialisePreset(makePreset('n', files({ 'types/kb.yaml': 'x' }), now, '0.4.0'))) as Record<string, unknown>;
    const err = (o: unknown) => {
      const r = parsePreset(typeof o === 'string' ? o : JSON.stringify(o));
      return r.ok ? null : r.error;
    };
    expect(err('{')).toMatch(/not valid JSON/);
    expect(err([])).toMatch(/wrong shape/);
    expect(err({ ...ok, format: 2 })).toMatch(/newer version/);
    expect(err({ ...ok, name: ' ' })).toMatch(/no name/);
    expect(err({ ...ok, files: null })).toMatch(/no files/);
    expect(err({ ...ok, files: { 'types/kb.yaml': 5 } })).toMatch(/not text/);
    expect(err({ ...ok, files: { '../outside.yaml': 'x' } })).toMatch(/not allowed/);
    expect(err({ ...ok, files: { 'preview/kb.yaml': 'x' } })).toMatch(/not allowed/);
  });

  it('have a file name made of letters, digits and hyphens', () => {
    expect(presetSlug('My Schema (v2)!')).toBe('my-schema-v2');
    expect(presetSlug('Étude – très bien')).toBe('etude-tres-bien');
    expect(presetSlug('???')).toBe('preset');
    expect(presetSlug('a'.repeat(100)).length).toBe(60);
  });
});

describe('diffFiles', () => {
  const current = files({ a: '1\n', b: '2\n', c: '3\n' });
  const target = files({ a: '1\n', b: 'changed\nmore\n', d: 'new\n' });

  it('sorts every file into added, changed, removed or same', () => {
    expect(diffFiles(current, target)).toEqual({ added: ['d'], changed: ['b'], removed: ['c'], same: ['a'] });
  });

  it('says when nothing would change', () => {
    expect(isNoChange(diffFiles(current, current))).toBe(true);
    expect(isNoChange(diffFiles(current, target))).toBe(false);
  });

  it('describes each change for the preview', () => {
    const s = describeDiff(diffFiles(current, target), current, target);
    expect(s).toEqual([
      { heading: 'Added (1)', lines: ['+ d  (1 lines)'] },
      { heading: 'Changed (1)', lines: ['~ b  (1 → 2 lines)'] },
      { heading: 'Removed (1)', lines: ['- c'] },
    ]);
  });
});
