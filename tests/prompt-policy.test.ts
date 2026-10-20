import { describe, expect, it } from 'vitest';
import { folderKey, looksLocal, shouldAskWhichSchema } from '../src/core/prompt-policy';
import type { PromptFacts } from '../src/core/prompt-policy';

const base: PromptFacts = {
  match: { kind: 'ask', folder: 'Inbox' },
  event: 'create',
  skippedFolders: new Set(),
  hasId: false,
  ageMs: 500,
};

describe('no-match prompt policy', () => {
  it('asks for a note just created on this device in an unknown folder', () => {
    expect(shouldAskWhichSchema(base)).toBe(true);
  });

  it('asks after a move too', () => {
    expect(shouldAskWhichSchema({ ...base, event: 'rename' })).toBe(true);
  });

  it('never asks for notes that arrive through sync (they already have an id, or are old)', () => {
    expect(shouldAskWhichSchema({ ...base, hasId: true })).toBe(false);
    expect(shouldAskWhichSchema({ ...base, ageMs: 60_000 })).toBe(false);
  });

  it('does not ask on open, modify or startup', () => {
    for (const event of ['open', 'modify', 'startup'] as const) expect(shouldAskWhichSchema({ ...base, event })).toBe(false);
  });

  it('asks once per folder: "Not now" and remembered answers stay quiet', () => {
    const skipped = new Set([folderKey('Inbox')]);
    expect(shouldAskWhichSchema({ ...base, skippedFolders: skipped })).toBe(false);
    expect(shouldAskWhichSchema({ ...base, match: { kind: 'ask', folder: 'INBOX' }, skippedFolders: skipped })).toBe(false);
    expect(shouldAskWhichSchema({ ...base, match: { kind: 'ask', folder: 'Other' }, skippedFolders: skipped })).toBe(true);
  });

  it('asks which schema owns a folder claimed twice', () => {
    expect(shouldAskWhichSchema({ ...base, match: { kind: 'conflict', folder: 'Projects', types: ['project', 'task'] } })).toBe(true);
  });

  it('a manual command always asks, even for old notes', () => {
    expect(shouldAskWhichSchema({ ...base, event: 'manual', hasId: true, ageMs: 9e9, skippedFolders: new Set([folderKey('Inbox')]) })).toBe(true);
  });

  it('never asks when the note is already matched or deliberately unmanaged', () => {
    expect(shouldAskWhichSchema({ ...base, match: { kind: 'matched', type: 'kb', via: 'type' } })).toBe(false);
    expect(shouldAskWhichSchema({ ...base, match: { kind: 'unmanaged', reason: 'root' } })).toBe(false);
  });

  it('looksLocal needs a create or rename, no id and a brand-new file', () => {
    expect(looksLocal({ event: 'create', hasId: false, ageMs: 9_999 })).toBe(true);
    expect(looksLocal({ event: 'create', hasId: false, ageMs: 10_001 })).toBe(false);
  });
});
