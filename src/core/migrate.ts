import { convertOldId, parseOldId } from './ids';
import type { Frontmatter } from './frontmatter';
import { ARCHIVED_FIELDS } from './schema-types';
import type { ResolvedType } from './schema-types';
import { formatLocalDate } from './timestamps';
import { validateValue } from './validate';

/** Nested blocks from schema 1 that become flat properties named `<block>_<key>` in schema 2. */
export const NESTED_BLOCKS = ['source', 'review', 'contact', 'met', 'muscles', 'progress', 'recurrence'] as const;

export interface MigrationPlan {
  from: number;
  to: number;
  /** Values kept in `archived_fields` because a flat property would lose them. */
  archived: Record<string, unknown>;
  apply: (fm: Frontmatter) => void;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Normalise a path-like text for comparison: `Knowledge > Physics` and `Knowledge/Physics` are the same. */
const normPath = (v: unknown): string =>
  typeof v === 'string'
    ? v
        .split(/\s*(?:\/|>|›|»)\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join('/')
        .toLowerCase()
    : '';

/** Does a leftover `domain` text repeat the breadcrumb (so removing it loses nothing)? */
export function domainRepeatsBreadcrumb(fm: Frontmatter, key: 'domain' | 'domain_path'): boolean {
  const crumb = normPath(fm.breadcrumb);
  const value = normPath(fm[key]);
  if (!crumb || !value) return false;
  if (key === 'domain_path') return value === crumb;
  // `domain` is the top of the breadcrumb or the whole of it
  return value === crumb || crumb.startsWith(value + '/') || crumb.split('/')[0] === value;
}

/** A note written against a newer schema than this one knows is read-only: an older plugin must not rewrite it. */
export function isNewerThanSchema(fm: Frontmatter, type: ResolvedType): boolean {
  return typeof fm.schema === 'number' && fm.schema > type.version;
}

export function newerSchemaMessage(fm: Frontmatter, type: ResolvedType): string {
  return `This note was written with schema ${String(fm.schema)}, newer than the ${String(type.version)} this ${type.name} schema knows, so it is read-only here. Update the schema files or the plugin.`;
}

export function needsMigration(fm: Frontmatter, type: ResolvedType): boolean {
  return typeof fm.schema === 'number' && fm.schema < type.version;
}

/**
 * Schema 1 to 2 (the only migration in this release):
 *  - old IDs become the year format (year from `created`, number kept);
 *  - nested blocks become flat properties; what cannot be flattened without loss is archived;
 *  - `domain` and `domain_path` go, but only deleted when they repeat the breadcrumb, otherwise archived;
 *  - `created` and `modified` are kept and sort last (the writer orders by schema); `schema` becomes 2.
 */
export function planMigration(fm: Frontmatter, type: ResolvedType, now: Date): MigrationPlan {
  const from = typeof fm.schema === 'number' ? fm.schema : 1;
  const to = type.version;
  const archived: Record<string, unknown> = {};
  const flat: Record<string, unknown> = {};
  const removeKeys: string[] = [];

  // nested blocks
  for (const block of NESTED_BLOCKS) {
    const value = fm[block];
    if (value === undefined) continue;
    if (!isPlainObject(value)) {
      // already flat or an unexpected shape: keep it as it is, never guess
      continue;
    }
    removeKeys.push(block);
    const leftovers: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const name = `${block}_${k}`;
      const def = type.byName.get(name);
      if (def && !validateValue(def, v) && !(name in fm)) flat[name] = v;
      else leftovers[k] = v;
    }
    if (Object.keys(leftovers).length > 0) archived[block] = leftovers;
  }

  // leftover domain texts
  for (const key of ['domain', 'domain_path'] as const) {
    if (fm[key] === undefined) continue;
    removeKeys.push(key);
    if (!domainRepeatsBreadcrumb(fm, key)) archived[key] = fm[key];
  }

  const newId = typeof fm.id === 'string' && parseOldId(fm.id) ? convertOldId(fm.id, typeof fm.created === 'string' ? fm.created : undefined) : null;

  return {
    from,
    to,
    archived,
    apply(draft) {
      for (const k of removeKeys) delete draft[k];
      for (const [k, v] of Object.entries(flat)) draft[k] = v;
      if (newId) draft.id = newId;
      draft.schema = to;
      if (Object.keys(archived).length > 0) {
        const entry = { type: type.name, date: formatLocalDate(now), from_schema: from, values: archived };
        const existing = draft[ARCHIVED_FIELDS];
        draft[ARCHIVED_FIELDS] = Array.isArray(existing) ? [...(existing as unknown[]), entry] : existing ? [existing, entry] : [entry];
      }
    },
  };
}
