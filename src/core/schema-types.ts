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
  /** Set on an effective vocabulary: the domain whose terms were added. Absent on the default vocabulary. */
  domain?: string;
  name: string;
  file: string;
  terms: VocabularyTerm[];
  /** lower-case term or synonym -> preferred term */
  lookup: Map<string, string>;
}

export interface ResolvedType {
  /** Set on an effective type: the domain whose overrides were applied. Absent on the default type. */
  domain?: string;
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

/** What one domain override file may change about one existing property. */
export interface DomainChange {
  values?: string[];
  default?: unknown;
  description?: string;
  line?: number;
}

/** A type or module override file for one domain: `override`, `add`, `remove` (and `sections` in a module file). */
export interface DomainFile {
  file: string;
  domain: string;
  /** 'type' or 'module', and its name. */
  kind: 'type' | 'module';
  name: string;
  override: Map<string, DomainChange>;
  add: PropertyDef[];
  remove: { name: string; line?: number }[];
  /** Extra values for the module's `section` property (module files only). */
  sections: string[];
}

/** A vocabulary override file: extra terms for one domain. */
export interface DomainVocabulary {
  file: string;
  domain: string;
  name: string;
  terms: VocabularyTerm[];
  /** Line of each term in the file, for messages. */
  lines: Map<string, number | undefined>;
}

export interface SchemaPack {
  /** The values of the `domain` property: the domains that may have override files. */
  domains: string[];
  /** Override files found, by domain slug. */
  domainFiles: Map<string, { types: Map<string, DomainFile>; modules: Map<string, DomainFile>; vocabularies: Map<string, DomainVocabulary> }>;
  /** Effective types, key `<domain>/<type>`. A pair with no override has no entry: the default type applies. */
  effectiveTypes: Map<string, ResolvedType>;
  /** Effective vocabularies, key `<domain>/<vocabulary>`. */
  effectiveVocabularies: Map<string, Vocabulary>;
  format: number;
  minPluginVersion: string;
  typeNames: string[];
  types: Map<string, ResolvedType>;
  modules: Map<string, ModuleDef>;
  vocabularies: Map<string, Vocabulary>;
  folders: FoldersConfig;
  scope: ScopeConfig;
}

export interface LoadResult {
  /** Null when any error-level problem was found. */
  pack: SchemaPack | null;
  problems: Problem[];
}

/** Read-only access to the schema folder. Paths are relative to it, with `/` separators. */
export interface SchemaFileSource {
  read(path: string): Promise<string | null>;
  /** Names of the files (not folders) directly inside a folder; empty when the folder does not exist. */
  list(dir: string): Promise<string[]>;
}

export const SUPPORTED_FORMAT = 1;

/** Properties every type gets for free and that no module declares. */
export const ARCHIVED_FIELDS = 'archived_fields';
export const LOCKED_NAMES = ['schema', 'id', 'breadcrumb', 'created', 'modified', ARCHIVED_FIELDS] as const;
