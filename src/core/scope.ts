import { isInSchemaFolder } from './folder-detect';
import { nameKey } from './normalise';
import type { ScopeConfig } from './schema-types';

export type ScopeVerdict =
  | { managed: true }
  | { managed: false; reason: 'schema-folder' | 'excluded' | 'not-included' };

/** Split a folder rule or note path into comparison keys, one per segment. */
function keys(path: string): string[] {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .map(nameKey);
}

/** True when `rule` (a folder path) is the same as, or contains, the note's folder. */
function ruleCovers(rule: string, notePath: string): boolean {
  const r = keys(rule);
  if (r.length === 0) return false;
  const n = keys(notePath);
  // The note's own file name is never part of the folder.
  const folder = n.slice(0, -1);
  if (folder.length < r.length) return false;
  return r.every((seg, i) => folder[i] === seg);
}

/**
 * Decide whether a note is managed.
 * Every note is included by default; exclude always wins; the schema folder is always excluded.
 */
export function checkScope(notePath: string, scope: ScopeConfig, schemaFolder: string): ScopeVerdict {
  if (isInSchemaFolder(notePath, schemaFolder)) return { managed: false, reason: 'schema-folder' };
  if (scope.exclude.some((rule) => ruleCovers(rule, notePath))) return { managed: false, reason: 'excluded' };
  if (scope.mode === 'include-only' && !scope.include.some((rule) => ruleCovers(rule, notePath))) {
    return { managed: false, reason: 'not-included' };
  }
  return { managed: true };
}
