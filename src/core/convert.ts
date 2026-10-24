import type { Frontmatter } from './frontmatter';
import { formatLocal, formatLocalDate } from './timestamps';
import { ARCHIVED_FIELDS } from './schema-types';
import type { PropertyDef, ResolvedType } from './schema-types';
import { UNIQUE_ID, planUniqueId } from './unique-id';
import type { AllocateUnique, UniqueIdChange } from './unique-id';
import { isEmpty, validateValue } from './validate';

/** Properties that describe the note itself; a conversion never moves them to `archived_fields`. */
const IDENTITY = new Set(['type', 'schema', 'id', 'name', 'created', 'modified', 'breadcrumb', ARCHIVED_FIELDS]);

export function defaultValue(def: PropertyDef, now: Date): unknown {
  if (def.default === undefined) return undefined;
  if (def.type === 'date' && def.default === 'today') return formatLocalDate(now);
  if (def.type === 'datetime' && def.default === 'now') return formatLocal(now);
  return JSON.parse(JSON.stringify(def.default)) as unknown;
}

export interface ConversionPlan {
  from: string;
  to: string;
  /** Properties added with their defaults. */
  added: Record<string, unknown>;
  /** Values that no longer apply; kept in `archived_fields`, never deleted. */
  archived: Record<string, unknown>;
  /** Properties whose value stays as it is. */
  kept: string[];
  /** Run on a copy of the frontmatter to carry the conversion out. */
  apply: (fm: Frontmatter) => void;
}

/** Rule 8: what changes when a note moves from one type to another. Nothing is deleted. */
export function planConversion(fm: Frontmatter, from: ResolvedType, to: ResolvedType, now: Date, options: { allocateUnique?: AllocateUnique } = {}): ConversionPlan {
  const added: Record<string, unknown> = {};
  const archived: Record<string, unknown> = {};
  const kept: string[] = [];
  const removed: string[] = [];

  for (const key of Object.keys(fm)) {
    if (IDENTITY.has(key) || !from.byName.has(key)) continue; // identity and unknown keys stay as they are
    const value = fm[key];
    const target = to.byName.get(key);
    if (target && !validateValue(target, value)) {
      kept.push(key);
      continue;
    }
    if (!isEmpty(value)) archived[key] = value;
    removed.push(key);
  }

  for (const def of to.properties) {
    if (IDENTITY.has(def.name) || def.generated) continue;
    const present = def.name in fm && !removed.includes(def.name);
    if (present) continue;
    if (!def.required && def.default === undefined) continue;
    const v = defaultValue(def, now);
    if (v !== undefined) added[def.name] = v;
  }

  // A unique ID names the note's type and domain: for the new type it is issued again, and the old one is kept.
  let unique: UniqueIdChange | null = null;
  if (options.allocateUnique && to.byName.has(UNIQUE_ID)) {
    const year = Number(/^(\d{4})/.exec(typeof fm.created === 'string' ? fm.created : '')?.[1] ?? now.getFullYear());
    unique = planUniqueId(fm, to, options.allocateUnique, year);
    if (unique) {
      added[UNIQUE_ID] = unique.to;
      if (unique.from !== undefined) archived[UNIQUE_ID] = unique.from;
      const i = kept.indexOf(UNIQUE_ID);
      if (i >= 0) kept.splice(i, 1);
    }
  }

  return {
    from: from.name,
    to: to.name,
    added,
    archived,
    kept,
    apply(draft) {
      for (const key of removed) delete draft[key];
      for (const [k, v] of Object.entries(added)) draft[k] = v;
      draft.type = to.name;
      draft.schema = to.version;
      if (Object.keys(archived).length > 0) {
        const entry = { type: from.name, date: formatLocalDate(now), values: archived };
        const existing = draft[ARCHIVED_FIELDS];
        draft[ARCHIVED_FIELDS] = Array.isArray(existing) ? [...(existing as unknown[]), entry] : existing ? [existing, entry] : [entry];
      }
      if (unique) draft[UNIQUE_ID] = unique.to;
    },
  };
}
