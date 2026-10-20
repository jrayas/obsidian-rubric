import { beforeAll, describe, expect, it } from 'vitest';
import { matchNote } from '../src/core/matcher';
import type { MatchOptions } from '../src/core/matcher';
import type { SchemaPack } from '../src/core/schema-types';
import { loadPack, loadWith } from './helpers/pack';

let pack: SchemaPack;
beforeAll(async () => {
  pack = await loadPack();
});

const combined: MatchOptions = { mode: 'combined', noMatch: 'ask' };
const m = (path: string, fm: Record<string, unknown> | undefined, o: MatchOptions = combined) => matchNote(pack, { path, frontmatter: fm }, o);

describe('matching order (rule 1)', () => {
  it('1: a valid `type` in the note wins over breadcrumb and folder', () => {
    expect(m('Knowledge/x.md', { type: 'task', breadcrumb: 'Projects/Alpha' })).toEqual({ kind: 'matched', type: 'task', via: 'type' });
  });

  it('1: type comparison ignores case', () => {
    expect(m('Notes/x.md', { type: 'KB' })).toMatchObject({ kind: 'matched', type: 'kb', via: 'type' });
  });

  it('1: an invalid type falls through to the breadcrumb', () => {
    expect(m('Notes/x.md', { type: 'kbx', breadcrumb: 'Projects/Alpha' })).toEqual({ kind: 'matched', type: 'project', via: 'breadcrumb' });
    expect(m('Notes/x.md', { type: 42 })).toMatchObject({ via: 'folder-mapping', type: 'note' });
  });

  it('2: the first breadcrumb segment against the registry folder list, ahead of the real folder', () => {
    expect(m('Inbox/x.md', { breadcrumb: 'Knowledge/Physics/Quantum Mechanics' })).toEqual({ kind: 'matched', type: 'kb', via: 'breadcrumb' });
    expect(m('Notes/x.md', { breadcrumb: 'Projects' })).toMatchObject({ type: 'project', via: 'breadcrumb' });
  });

  it('2: a breadcrumb that maps to nothing falls through to the folder', () => {
    expect(m('Tasks/x.md', { breadcrumb: 'Nonsense/Deep' })).toEqual({ kind: 'matched', type: 'task', via: 'folder-mapping' });
  });

  it('3: a note with no breadcrumb falls back to its folder name', () => {
    expect(m('Knowledge/Physics/x.md', {})).toEqual({ kind: 'matched', type: 'kb', via: 'folder-mapping' });
    expect(m('People/Ann.md', undefined)).toMatchObject({ type: 'person' });
  });

  it('3: one schema can answer to several folders (Knowledge and Wiki both map to kb)', () => {
    expect(m('Wiki/a.md', {})).toMatchObject({ type: 'kb' });
    expect(m('Knowledge/a.md', {})).toMatchObject({ type: 'kb' });
  });

  it('3: a folder named like a schema matches even if not in the registry', () => {
    expect(m('kb/x.md', {})).toEqual({ kind: 'matched', type: 'kb', via: 'folder-name' });
    expect(m('Task/x.md', {})).toMatchObject({ type: 'task', via: 'folder-name' });
  });

  it('4: otherwise ask, naming the folder', () => {
    expect(m('Inbox/x.md', {})).toEqual({ kind: 'ask', folder: 'Inbox' });
  });

  it('a note in the vault root stays unmanaged until the user picks a schema', () => {
    expect(m('x.md', {})).toEqual({ kind: 'unmanaged', reason: 'root' });
    expect(m('x.md', { type: 'journal' })).toMatchObject({ kind: 'matched', type: 'journal' });
  });

  it('the no-match setting can leave the note unmanaged instead of asking', () => {
    expect(m('Inbox/x.md', {}, { mode: 'combined', noMatch: 'unmanaged' })).toEqual({ kind: 'unmanaged', reason: 'no-match-setting' });
  });
});

describe('case and accent variations', () => {
  it('matches folder names ignoring case', () => {
    expect(m('knowledge/x.md', {})).toMatchObject({ type: 'kb' });
    expect(m('KNOWLEDGE/x.md', {})).toMatchObject({ type: 'kb' });
    expect(m('x/y.md', { breadcrumb: 'pROJECTS/a' })).toMatchObject({ type: 'project' });
  });

  it('matches accent variants and NFC against NFD (Mac versus Windows file names)', async () => {
    const r = await loadWith({ 'registry/folders.yaml': (t) => t.trimEnd() + '\n  Café: resource\n' });
    const p = r.pack as SchemaPack;
    const nfd = 'Café';
    const nfc = 'Café';
    for (const name of [nfd, nfc, 'cafe', 'CAFÉ']) {
      expect(matchNote(p, { path: `${name}/x.md`, frontmatter: {} }, combined), name).toMatchObject({ type: 'resource' });
    }
    expect(matchNote(p, { path: 'x/y.md', frontmatter: { breadcrumb: `${nfd}/sub` } }, combined)).toMatchObject({ type: 'resource', via: 'breadcrumb' });
  });
});

describe('two schemas on one folder', () => {
  it('warns and asks which one owns it; never picks silently', async () => {
    const r = await loadWith({ 'registry/folders.yaml': (t) => t.trimEnd() + '\n  projects: task\n' });
    const p = r.pack as SchemaPack;
    const res = matchNote(p, { path: 'Projects/x.md', frontmatter: {} }, combined);
    expect(res.kind).toBe('conflict');
    if (res.kind === 'conflict') expect(res.types.sort()).toEqual(['project', 'task']);
    // an explicit type in the note still decides
    expect(matchNote(p, { path: 'Projects/x.md', frontmatter: { type: 'task' } }, combined)).toMatchObject({ kind: 'matched' });
  });
});

describe('matching modes', () => {
  it('auto uses breadcrumb and folder only, and never asks', () => {
    const auto: MatchOptions = { mode: 'auto', noMatch: 'ask' };
    expect(m('Knowledge/x.md', { type: 'task' }, auto)).toMatchObject({ type: 'kb' });
    expect(m('Inbox/x.md', {}, auto)).toEqual({ kind: 'unmanaged', reason: 'auto-no-match' });
  });

  it('manual honours the type and mapped folders but does not guess', () => {
    const manual: MatchOptions = { mode: 'manual', noMatch: 'ask' };
    expect(m('Inbox/x.md', { type: 'kb' }, manual)).toMatchObject({ type: 'kb' });
    expect(m('Tasks/x.md', {}, manual)).toMatchObject({ type: 'task', via: 'folder-mapping' });
    expect(m('kb/x.md', {}, manual)).toEqual({ kind: 'ask', folder: 'kb' });
    expect(m('Inbox/x.md', { breadcrumb: 'Projects' }, manual)).toEqual({ kind: 'ask', folder: 'Inbox' });
  });
});
