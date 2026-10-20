import { describe, expect, it } from 'vitest';
import { baseName, breadcrumbFromPath, nameAfterRename, parentFolder } from '../src/core/name-sync';
import { createAction } from '../src/core/prompt-policy';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings';

describe('name follows the file name', () => {
  const fm = (name: unknown) => ({ type: 'kb', id: 'KB-2026-0001', name });

  it('updates a name the plugin filled (equal to the old file name)', () => {
    expect(nameAfterRename(fm('Untitled'), 'Untitled', 'Wave')).toBe('Wave');
  });

  it('fills an empty or missing name', () => {
    expect(nameAfterRename(fm(''), 'Untitled', 'Wave')).toBe('Wave');
    expect(nameAfterRename({ type: 'kb' }, 'Untitled', 'Wave')).toBe('Wave');
    expect(nameAfterRename(fm(null), 'Untitled', 'Wave')).toBe('Wave');
  });

  it('never overwrites a name the user wrote', () => {
    expect(nameAfterRename(fm('My own title'), 'Untitled', 'Wave')).toBeNull();
  });

  it('does nothing when the name already matches, the file did not change name, or the note has no plugin properties', () => {
    expect(nameAfterRename(fm('Wave'), 'Untitled', 'Wave')).toBeNull();
    expect(nameAfterRename(fm('Untitled'), 'Untitled', 'Untitled')).toBeNull();
    expect(nameAfterRename({ status: 'x' }, 'A', 'B')).toBeNull();
    expect(nameAfterRename(undefined, 'A', 'B')).toBeNull();
  });

  it('works out file and folder names from a path', () => {
    expect(baseName('Knowledge/Physics/Wave.md')).toBe('Wave');
    expect(parentFolder('Knowledge/Physics/Wave.md')).toBe('Knowledge/Physics');
    expect(parentFolder('Wave.md')).toBe('');
    expect(breadcrumbFromPath('Knowledge/Physics/Wave.md')).toBe('Knowledge/Physics');
    expect(breadcrumbFromPath('Wave.md')).toBeNull();
  });
});

describe('what to do with a new note in a mapped folder', () => {
  const matched = { kind: 'matched', type: 'kb', via: 'folder-mapping' } as const;
  const base = { match: matched, event: 'create', hasId: false, ageMs: 500 } as const;

  it('follows the setting for a brand-new local note', () => {
    expect(createAction({ ...base, setting: 'fill' })).toBe('fill');
    expect(createAction({ ...base, setting: 'ask' })).toBe('ask');
    expect(createAction({ ...base, setting: 'nothing' })).toBe('none');
  });

  it('also handles a note moved into the folder just now', () => {
    expect(createAction({ ...base, event: 'rename', setting: 'fill' })).toBe('fill');
  });

  it('leaves a note with an ID, an old note (sync arrival), and unmatched notes alone', () => {
    expect(createAction({ ...base, hasId: true, setting: 'fill' })).toBe('none');
    expect(createAction({ ...base, ageMs: 60_000, setting: 'fill' })).toBe('none');
    expect(createAction({ ...base, match: { kind: 'ask', folder: 'X' }, setting: 'fill' })).toBe('none');
    expect(createAction({ ...base, event: 'open', setting: 'fill' })).toBe('none');
  });
});

describe('the new settings', () => {
  it('have the proposed defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ onCreate: 'ask', createDelayMs: 1500, syncName: true, breadcrumbFromFolder: false, promptScope: 'open', promptTags: true, promptStatus: true, promptTypeChange: true });
  });

  it('keep valid stored values and repair invalid ones', () => {
    expect(mergeSettings({ onCreate: 'fill', promptScope: 'all', createDelayMs: 3000, syncName: false })).toMatchObject({ onCreate: 'fill', promptScope: 'all', createDelayMs: 3000, syncName: false });
    expect(mergeSettings({ onCreate: 'always', promptScope: 'some', createDelayMs: 5 })).toMatchObject({ onCreate: 'ask', promptScope: 'open', createDelayMs: 1500 });
  });
});
