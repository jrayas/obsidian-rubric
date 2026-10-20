import { defaultValue } from './convert';
import type { Frontmatter } from './frontmatter';
import type { ResolvedType } from './schema-types';
import { formatLocal } from './timestamps';

export interface NewNoteOptions {
  name: string;
  id: string;
  now: Date;
  /** Overrides the type's default status. */
  status?: string;
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
