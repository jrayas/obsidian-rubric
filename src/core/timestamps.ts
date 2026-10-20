import { readFrontmatter } from './frontmatter';
import { contentHash } from './hash';

/** Local time as YYYY-MM-DDTHH:mm, no timezone (rule 5). */
export function formatLocal(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

export function formatLocalDate(date: Date): string {
  return formatLocal(date).slice(0, 10);
}

/**
 * What identifies "the note changed" for timestamp purposes: the properties other than `modified` and
 * `breadcrumb`, plus the body. A move or a breadcrumb rewrite leaves it unchanged.
 */
export function fingerprint(text: string): { fp: string; modified: string | undefined } {
  let fm: Record<string, unknown> | undefined;
  let body = text;
  try {
    fm = readFrontmatter(text);
  } catch {
    fm = undefined;
  }
  if (fm) {
    // everything after the closing delimiter is the body
    const m = /^\ufeff?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
    body = m ? text.slice(m[0].length) : text;
  }
  const rest = { ...(fm ?? {}) };
  const modified = typeof rest.modified === 'string' ? rest.modified : undefined;
  delete rest.modified;
  delete rest.breadcrumb;
  return { fp: contentHash(JSON.stringify(rest) + '\u0000' + body), modified };
}

export interface NoteState {
  fp: string;
  modified: string | undefined;
}

export type StampDecision =
  | { action: 'stamp' }
  | { action: 'none'; reason: 'own-write' | 'unchanged' | 'accepted-newer' | 'no-baseline' };

/**
 * Rule 5. Stamp `modified` only when the file changed and its `modified` value did not.
 *  - this plugin's own writes never count (they are matched by content before this is called);
 *  - a move, a breadcrumb rewrite or any change that leaves the fingerprint alone does not count;
 *  - a change that arrives with a different `modified` already inside it is accepted as it is.
 */
export function decideStamp(input: { ownWrite: boolean; before: NoteState | undefined; after: NoteState }): StampDecision {
  if (input.ownWrite) return { action: 'none', reason: 'own-write' };
  if (!input.before) return { action: 'none', reason: 'no-baseline' };
  if (input.before.fp === input.after.fp) return { action: 'none', reason: 'unchanged' };
  if (input.before.modified !== input.after.modified) return { action: 'none', reason: 'accepted-newer' };
  return { action: 'stamp' };
}
