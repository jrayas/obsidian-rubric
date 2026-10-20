import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { addScopeFolder, removeFolderMapping, removeScopeFolder, setFolderMapping, setMatchingMode, setScopeMode } from '../src/core/registry-edit';
import { packFiles } from './helpers/pack';

interface Doc {
  mode: string;
  folders: Record<string, string>;
  exclude: string[];
  include: string[];
}
const parse = (text: string) => parseYaml(text) as Doc;
const folders = () => packFiles().get('registry/folders.yaml') as string;
const scope = () => packFiles().get('registry/scope.yaml') as string;

describe('folders.yaml edits', () => {
  it('adds a mapping and keeps every comment', () => {
    const out = setFolderMapping(folders(), 'Inbox', 'note');
    expect(parse(out).folders.Inbox).toBe('note');
    expect(out).toContain('# Root folder -> type.');
    expect(out).toContain('# Fixed by design');
    expect(parse(out).folders.Knowledge).toBe('kb');
  });

  it('replaces a key that differs only by case or accents', () => {
    const out = setFolderMapping(folders(), 'KNOWLEDGE', 'note');
    const f = parse(out).folders;
    expect(f.KNOWLEDGE).toBe('note');
    expect(f.Knowledge).toBeUndefined();
  });

  it('removes a mapping', () => {
    const out = removeFolderMapping(folders(), 'wiki');
    expect(parse(out).folders.Wiki).toBeUndefined();
    expect(parse(out).folders.Knowledge).toBe('kb');
  });

  it('creates the folders map when the file has none', () => {
    const out = setFolderMapping('mode: combined\n', 'Inbox', 'task');
    expect(parse(out)).toEqual({ mode: 'combined', folders: { Inbox: 'task' } });
  });

  it('changes the matching mode', () => {
    expect(parse(setMatchingMode(folders(), 'auto')).mode).toBe('auto');
  });

  it('refuses to edit a file with YAML errors', () => {
    expect(() => setFolderMapping('a: [', 'X', 'kb')).toThrow();
  });
});

describe('scope.yaml edits', () => {
  it('adds an excluded folder once, ignoring case, and keeps comments', () => {
    let out = addScopeFolder(scope(), 'exclude', 'Scratch');
    out = addScopeFolder(out, 'exclude', 'scratch');
    expect(parse(out).exclude).toEqual(['Templates', 'Archive', 'Attachments', 'Scratch']);
    expect(out).toContain('# Which notes are managed.');
  });

  it('adds to an empty include list', () => {
    const out = addScopeFolder(scope(), 'include', 'Knowledge');
    expect(parse(out).include).toEqual(['Knowledge']);
  });

  it('removes a folder, and an emptied list stays valid', () => {
    let out = scope();
    for (const f of ['Templates', 'Archive', 'attachments']) out = removeScopeFolder(out, 'exclude', f);
    expect(parse(out).exclude).toEqual([]);
  });

  it('changes the mode', () => {
    expect(parse(setScopeMode(scope(), 'include-only')).mode).toBe('include-only');
  });
});
