import { defaultValue } from './convert';
import type { Frontmatter } from './frontmatter';
import type { ResolvedType } from './schema-types';
import { formatLocal } from './timestamps';
import { UNIQUE_ID, uniqueScope } from './unique-id';
import type { AllocateUnique } from './unique-id';

export interface NewNoteOptions {
  name: string;
  id: string;
  now: Date;
  /** Overrides the type's default status. */
  status?: string;
  /** Gives the note its unique ID when its type has one and its domain has a prefix. */
  allocateUnique?: AllocateUnique;
  /** The note's domain, instead of the `domain` property's default. */
  domain?: string;
}

/**
 * Rule: create a note from a type. Every required property and every property with a default is written, in
 * schema order, with `created` and `modified` last. `schema`, `id`, `created` and `modified` are set here.
 */
export function newNoteFrontmatter(type: ResolvedType, o: NewNoteOptions): Frontmatter {
  const stamp = formatLocal(o.now);
  const fm: Frontmatter = {};
  for (const def of type.properties) {
    switch (def.name) {
      case 'type':
        fm.type = type.name;
        break;
      case 'schema':
        fm.schema = type.version;
        break;
      case 'id':
        fm.id = o.id;
        break;
      case 'name':
        fm.name = o.name;
        break;
      case 'created':
      case 'modified':
        fm[def.name] = stamp;
        break;
      case 'status':
        fm.status = o.status ?? (defaultValue(def, o.now)) ?? def.values?.[0];
        break;
      case 'domain': {
        const v = o.domain ?? defaultValue(def, o.now);
        if (v !== undefined) fm.domain = v;
        break;
      }
      case UNIQUE_ID: {
        // `domain` comes before it in the schema, so its default is already in `fm`
        const scope = o.allocateUnique ? uniqueScope(type, fm.domain) : null;
        if (scope && o.allocateUnique) fm.unique_id = o.allocateUnique(scope.typePrefix, scope.domainPrefix, o.now.getFullYear());
        break;
      }
      default: {
        if (def.managedBy === 'external') break; // another plugin writes it
        if (!def.required && def.default === undefined) break;
        const v = defaultValue(def, o.now);
        if (v !== undefined) fm[def.name] = v;
      }
    }
  }
  return fm;
}

export interface CompletionOptions {
  name: string;
  now: Date;
  /** Called only when the note has no ID; returns the one to give it. */
  allocateId: (year: number) => string;
  /** Used for `created` when the note has none (the file's own creation time). */
  fileCreated?: Date;
  /** Gives the note its unique ID when its type has one and its domain has a prefix. */
  allocateUnique?: AllocateUnique;
  /** The domain to give a note that has none (from its folder), instead of the `domain` property's default. */
  domain?: string;
}

export interface CompletionPlan {
  added: Record<string, unknown>;
  apply: (fm: Frontmatter) => void;
}

/**
 * What a note still needs to carry its type: `type`, `schema`, an ID, `name`, `created`, `modified`, and every
 * required property or default that is missing. Existing values are never changed.
 */
export function planCompletion(fm: Frontmatter, type: ResolvedType, o: CompletionOptions): CompletionPlan {
  const added: Record<string, unknown> = {};
  const has = (k: string) => fm[k] !== undefined && fm[k] !== null && fm[k] !== '';
  const created = has('created') ? String(fm.created) : formatLocal(o.fileCreated ?? o.now);
  const year = Number(/^(\d{4})/.exec(created)?.[1] ?? o.now.getFullYear());
  for (const def of type.properties) {
    if (has(def.name) && def.name !== 'type' && def.name !== 'schema') continue;
    switch (def.name) {
      case 'type':
        if (fm.type !== type.name) added.type = type.name;
        break;
      case 'schema':
        if (fm.schema !== type.version) added.schema = type.version;
        break;
      case 'id':
        added.id = o.allocateId(year);
        break;
      case 'name':
        added.name = o.name;
        break;
      case 'created':
        added.created = created;
        break;
      case 'modified':
        added.modified = formatLocal(o.now);
        break;
      case 'domain': {
        const v = o.domain ?? defaultValue(def, o.now);
        if (v !== undefined) added.domain = v;
        break;
      }
      case UNIQUE_ID: {
        const scope = o.allocateUnique ? uniqueScope(type, has('domain') ? fm.domain : added.domain) : null;
        if (scope && o.allocateUnique) added.unique_id = o.allocateUnique(scope.typePrefix, scope.domainPrefix, year);
        break;
      }
      default: {
        if (def.managedBy === 'external') break;
        if (!def.required && def.default === undefined) break;
        const v = defaultValue(def, o.now);
        if (v !== undefined) added[def.name] = v;
      }
    }
  }
  return {
    added,
    apply(draft) {
      for (const [k, v] of Object.entries(added)) draft[k] = v;
    },
  };
}
