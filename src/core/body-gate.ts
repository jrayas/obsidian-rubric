/** Who may change a note's body. One answer for the file API and the editor hook. Pure; no Obsidian types. */
import type { Frontmatter } from './frontmatter';
import { isNewerThanSchema } from './migrate';
import type { ResolvedType } from './schema-types';
import type { ScopeVerdict } from './scope';

export type GateRefusal =
  | 'rubric-off' // the master switch
  | 'body-edits-off' // the kill switch "Allow Rubric to edit note bodies"
  | 'unmanaged' // outside the managed scope, or in the schema folder
  | 'no-type' // no schema matched the note
  | 'type-not-enabled' // the type has no body: { enabled: true }
  | 'newer-schema'; // the note is on a newer schema than this plugin knows: read-only

export type BodyGate = { allowed: true; type: ResolvedType } | { allowed: false; reason: GateRefusal };

export interface GateInput {
  masterOn: boolean;
  allowBodyEdits: boolean;
  verdict: ScopeVerdict;
  type: ResolvedType | null;
  frontmatter: Frontmatter | undefined;
}

/** Reading a body is never gated; this decides writes and handlers. The first failing rule is the reason. */
export function bodyGate(i: GateInput): BodyGate {
  if (!i.masterOn) return { allowed: false, reason: 'rubric-off' };
  if (!i.allowBodyEdits) return { allowed: false, reason: 'body-edits-off' };
  if (!i.verdict.managed) return { allowed: false, reason: 'unmanaged' };
  if (!i.type) return { allowed: false, reason: 'no-type' };
  if (!i.type.body.enabled) return { allowed: false, reason: 'type-not-enabled' };
  if (i.frontmatter && isNewerThanSchema(i.frontmatter, i.type)) return { allowed: false, reason: 'newer-schema' };
  return { allowed: true, type: i.type };
}
