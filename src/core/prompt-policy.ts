import { nameKey } from './normalise';
import type { MatchResult } from './matcher';

/** What made the plugin look at the note. */
export type NoteEvent = 'create' | 'rename' | 'open' | 'modify' | 'startup' | 'manual';

export interface PromptFacts {
  match: MatchResult;
  event: NoteEvent;
  /** Folder keys already asked or answered (persisted) plus asked this session. */
  skippedFolders: ReadonlySet<string>;
  /** Note has an `id` already (a managed note that arrived, for example through sync). */
  hasId: boolean;
  /** Milliseconds since the file was created. */
  ageMs: number;
}

export const LOCAL_ARRIVAL_WINDOW_MS = 10_000;

/**
 * D-08: Obsidian does not say whether a file was created here or arrived through sync.
 * Treat a note as created or moved on this device only when the event is a create or rename,
 * the note has no `id` yet, and the file is brand new.
 */
export function looksLocal(facts: Pick<PromptFacts, 'event' | 'hasId' | 'ageMs'>): boolean {
  if (facts.event === 'manual') return true;
  if (facts.event !== 'create' && facts.event !== 'rename') return false;
  return !facts.hasId && facts.ageMs <= LOCAL_ARRIVAL_WINDOW_MS;
}

/** Folder keys use the same comparison as matching. */
export const folderKey = (folder: string): string => nameKey(folder);

/** Should the "which schema?" prompt be shown for this note? */
export function shouldAskWhichSchema(facts: PromptFacts): boolean {
  if (facts.match.kind !== 'ask' && facts.match.kind !== 'conflict') return false;
  if (facts.event === 'manual') return true;
  if (!looksLocal(facts)) return false;
  return !facts.skippedFolders.has(folderKey(facts.match.folder));
}

export type CreateAction = 'fill' | 'ask' | 'none';

/**
 * What to do with a note that has just appeared in a folder that maps to a schema.
 * Only notes that look created or moved on this device and have no `id` yet are touched, so a note that
 * arrived through sync, or one that is already complete, is left alone.
 */
export function createAction(o: {
  match: MatchResult;
  event: NoteEvent;
  hasId: boolean;
  ageMs: number;
  setting: 'fill' | 'ask' | 'nothing';
}): CreateAction {
  if (o.match.kind !== 'matched' || o.setting === 'nothing') return 'none';
  if (o.event !== 'create' && o.event !== 'rename') return 'none';
  if (!looksLocal({ event: o.event, hasId: o.hasId, ageMs: o.ageMs })) return 'none';
  return o.setting;
}
