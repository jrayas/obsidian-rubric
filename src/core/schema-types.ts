/** Data model for a loaded schema pack. Pure data; no Obsidian types. */

export const VALUE_TYPES = ['string', 'integer', 'boolean', 'date', 'datetime', 'url', 'link', 'enum', 'list'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export const ITEM_TYPES = ['string', 'link', 'url', 'term'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type Severity = 'error' | 'warning';

/** A problem found while loading or checking schema files. Always names the file; line when known. */
export interface Problem {
  severity: Severity;
  code: string;
  file: string;
  line?: number;
  message: string;
}

export interface SourceRef {
  file: string;
  line?: number;
}

export interface PropertyDef {
  name: string;
  type: ValueType;
  items?: ItemType;
  required: boolean;
  default?: unknown;
  values?: string[];
  valuesFrom?: 'type' | 'registry';
  min?: number;
  max?: number;
  pattern?: string;
  vocabulary?: string;
  strict: boolean;
  normalise: boolean;
  locked: boolean;
  immutable: boolean;
  generated: boolean;
  managedBy?: 'external';
  position?: 'end';
  allowHeading: boolean;
  target?: string;
  description?: string;
  /** Module that defined it, or undefined for a type's own property. */
  module?: string;
  source: SourceRef;
}

export interface TypeOverride {
  values?: string[];
  default?: unknown;
  required?: boolean;
}

export interface ModuleDef {
  name: string;
  file: string;
  description?: string;
  properties: PropertyDef[];
}

export interface VocabularyTerm {
  term: string;
  synonyms: string[];
}

export interface Vocabulary {
  name: string;
  file: string;
  terms: VocabularyTerm[];
  /** lower-case term or synonym -> preferred term */
  lookup: Map<string, string>;
}

export interface ResolvedType {
  name: string;
  prefix: string;
  version: number;
  description?: string;
  file: string;
  uses: string[];
  /** Ordered: modules in order, own fields, then `position: end` fields. */
  properties: PropertyDef[];
  byName: Map<string, PropertyDef>;
}

export type MatchingMode = 'combined' | 'auto' | 'manual';

export interface FolderMapping {
  folder: string;
  type: string;
  line?: number;
}

/** Two or more different types claim folder names that compare equal. */
export interface FolderConflict {
  folder: string;
  types: string[];
}

export interface FoldersConfig {
  mode: MatchingMode;
  mappings: FolderMapping[];
  conflicts: FolderConflict[];
}

export type ScopeMode = 'exclude' | 'include-only';

export interface ScopeConfig {
  mode: ScopeMode;
  exclude: string[];
  include: string[];
}

import type { TemplateDef } from './templates';

export interface SchemaPack {
  format: number;
  minPluginVersion: string;
  typeNames: string[];
  types: Map<string, ResolvedType>;
  modules: Map<string, ModuleDef>;
  vocabularies: Map<string, Vocabulary>;
  folders: FoldersConfig;
  scope: ScopeConfig;
  /** Starting body and values per type, from `templates/<type>.md`. Types without a file have no entry. */
  templates: Map<string, TemplateDef>;
}

export interface LoadResult {
  /** Null when any error-level problem was found. */
  pack: SchemaPack | null;
  problems: Problem[];
}

/** Read-only access to the schema folder. Paths are relative to it, with `/` separators. */
export interface SchemaFileSource {
  read(path: string): Promise<string | null>;
}

export const SUPPORTED_FORMAT = 1;

/** Properties every type gets for free and that no module declares. */
export const ARCHIVED_FIELDS = 'archived_fields';
export const LOCKED_NAMES = ['schema', 'id', 'breadcrumb', 'created', 'modified', ARCHIVED_FIELDS] as const;
