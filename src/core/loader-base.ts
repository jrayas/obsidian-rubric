/** Shared pieces of the schema loaders: problem collection, YAML reading, property parsing. Pure; no Obsidian types. */
import { YamlFile } from './yaml-file';
import type { YamlPath } from './yaml-file';
import { ITEM_TYPES, VALUE_TYPES } from './schema-types';
import type { ItemType, Problem, PropertyDef, Severity, ValueType } from './schema-types';
import type { SchemaFileSource } from './schema-types';

export type Obj = Record<string, unknown>;

/** Render any YAML value for a message without risking "[object Object]". */
export const show = (v: unknown): string => (typeof v === 'string' ? v : (JSON.stringify(v) ?? 'nothing'));
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const PROPERTY_KEYS = new Set([
  'type', 'items', 'required', 'default', 'values', 'values_from', 'min', 'max', 'pattern', 'vocabulary',
  'strict', 'normalise', 'locked', 'immutable', 'generated', 'managed_by', 'position', 'allow_heading',
  'target', 'description', 'prefixes',
]);
export const OVERRIDE_KEYS = new Set(['values', 'default', 'required']);

/** Collects problems and reads YAML files, remembering each file's text for line numbers. */
export class Loader {
  readonly problems: Problem[] = [];
  private readonly files = new Map<string, YamlFile>();

  constructor(private readonly source: SchemaFileSource) {}

  report(severity: Severity, code: string, file: string, message: string, line?: number): void {
    // The same override file is checked once per type that uses it; report each finding once.
    if (this.problems.some((p) => p.severity === severity && p.code === code && p.file === file && p.line === line && p.message === message)) return;
    this.problems.push({ severity, code, file, message, ...(line !== undefined ? { line } : {}) });
  }

  error(code: string, file: string, message: string, line?: number): void {
    this.report('error', code, file, message, line);
  }

  warn(code: string, file: string, message: string, line?: number): void {
    this.report('warning', code, file, message, line);
  }

  /** Read and parse; null (with a problem recorded) when missing or not valid YAML. */
  async readYaml(path: string, optional = false): Promise<{ file: YamlFile; data: unknown } | null> {
    const text = await this.source.read(path);
    if (text === null) {
      if (!optional) this.error('file-missing', path, `File not found: ${path}`);
      return null;
    }
    const yf = new YamlFile(path, text);
    const errs = yf.syntaxErrors();
    if (errs.length > 0) {
      for (const e of errs) this.error('yaml-syntax', path, `Invalid YAML: ${e.message}`, e.line);
      return null;
    }
    this.files.set(path, yf);
    return { file: yf, data: yf.toJS() };
  }
}

export function asStringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === 'string' || typeof x === 'number') ? v.map(String) : null;
}

/** Parse one property definition. Returns null after reporting when it cannot be used. */
export function parseProperty(
  ld: Loader,
  yf: YamlFile,
  basePath: YamlPath,
  name: string,
  raw: unknown,
  module: string | undefined,
): PropertyDef | null {
  const file = yf.path;
  const at = (...rest: string[]) => yf.lineOf([...basePath, name, ...rest]);
  if (!isObj(raw)) {
    ld.error('property-shape', file, `Property "${name}" must be a map of attributes`, at());
    return null;
  }
  let ok = true;
  for (const key of Object.keys(raw)) {
    if (!PROPERTY_KEYS.has(key)) {
      ld.warn('unknown-attribute', file, `Property "${name}": unknown attribute "${key}"`, at(key));
    }
  }
  const typeRaw = raw.type;
  if (typeof typeRaw !== 'string' || !(VALUE_TYPES as readonly string[]).includes(typeRaw)) {
    ld.error(
      'unknown-value-type',
      file,
      `Property "${name}": unknown value type "${show(typeRaw)}" (use ${VALUE_TYPES.join(', ')})`,
      at('type'),
    );
    return null;
  }
  const type = typeRaw as ValueType;
  let items: ItemType | undefined;
  if (type === 'list') {
    if (typeof raw.items !== 'string' || !(ITEM_TYPES as readonly string[]).includes(raw.items)) {
      ld.error('list-items', file, `Property "${name}": a list needs "items" (one of ${ITEM_TYPES.join(', ')})`, at('items') ?? at());
      ok = false;
    } else {
      items = raw.items as ItemType;
    }
  } else if (raw.items !== undefined) {
    ld.warn('unknown-attribute', file, `Property "${name}": "items" only applies to lists`, at('items'));
  }

  let values: string[] | undefined;
  if (raw.values !== undefined) {
    const list = asStringList(raw.values);
    if (!list || list.length === 0) {
      ld.error('enum-values', file, `Property "${name}": "values" must be a non-empty list`, at('values'));
      ok = false;
    } else {
      values = list;
    }
  }
  let valuesFrom: 'type' | 'registry' | undefined;
  if (raw.values_from !== undefined) {
    if (raw.values_from === 'type' || raw.values_from === 'registry') valuesFrom = raw.values_from;
    else {
      ld.error('values-from', file, `Property "${name}": "values_from" must be "type" or "registry"`, at('values_from'));
      ok = false;
    }
  }
  if (type === 'enum' && !values && !valuesFrom) {
    ld.error('enum-values', file, `Property "${name}": an enum needs "values" or "values_from"`, at('type'));
    ok = false;
  }

  const num = (key: 'min' | 'max'): number | undefined => {
    const v = raw[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      ld.error('number-limit', file, `Property "${name}": "${key}" must be a number`, at(key));
      ok = false;
      return undefined;
    }
    if (type !== 'integer') ld.warn('unknown-attribute', file, `Property "${name}": "${key}" only applies to integers`, at(key));
    return v;
  };
  const min = num('min');
  const max = num('max');
  if (min !== undefined && max !== undefined && min > max) {
    ld.error('number-limit', file, `Property "${name}": min ${min} is above max ${max}`, at('min'));
    ok = false;
  }

  let pattern: string | undefined;
  if (raw.pattern !== undefined) {
    if (typeof raw.pattern !== 'string') {
      ld.error('pattern', file, `Property "${name}": "pattern" must be text`, at('pattern'));
      ok = false;
    } else {
      try {
        new RegExp(raw.pattern);
        pattern = raw.pattern;
      } catch (e) {
        ld.error('pattern', file, `Property "${name}": invalid pattern (${(e as Error).message})`, at('pattern'));
        ok = false;
      }
    }
  }

  let prefixes: Record<string, string> | undefined;
  if (raw.prefixes !== undefined) {
    if (type !== 'enum') {
      ld.warn('unknown-attribute', file, `Property "${name}": "prefixes" only applies to enums`, at('prefixes'));
    } else if (!isObj(raw.prefixes)) {
      ld.error('prefixes', file, `Property "${name}": "prefixes" must map each value to two capital letters`, at('prefixes'));
      ok = false;
    } else {
      prefixes = {};
      const owner = new Map<string, string>();
      for (const [value, prefix] of Object.entries(raw.prefixes)) {
        const line = at('prefixes', value);
        if (typeof prefix !== 'string' || !/^[A-Z]{2}$/.test(prefix)) {
          ld.error('prefixes', file, `Property "${name}": the prefix for "${value}" must be two capital letters`, line);
          ok = false;
        } else if (values && !values.includes(value)) {
          ld.error('prefixes', file, `Property "${name}": "${value}" has a prefix but is not one of its values`, line);
          ok = false;
        } else if (owner.has(prefix)) {
          ld.error('prefixes', file, `Property "${name}": "${owner.get(prefix) ?? ''}" and "${value}" both use the prefix ${prefix}`, line);
          ok = false;
        } else {
          owner.set(prefix, value);
          prefixes[value] = prefix;
        }
      }
    }
  }

  const bool = (key: string): boolean => {
    const v = raw[key];
    if (v === undefined) return false;
    if (typeof v !== 'boolean') {
      ld.error('boolean-attribute', file, `Property "${name}": "${key}" must be true or false`, at(key));
      ok = false;
      return false;
    }
    return v;
  };

  const def: PropertyDef = {
    name,
    type,
    required: bool('required'),
    strict: bool('strict'),
    normalise: bool('normalise'),
    locked: bool('locked'),
    immutable: bool('immutable'),
    generated: bool('generated'),
    allowHeading: bool('allow_heading'),
    source: { file, line: at() },
  };
  if (items) def.items = items;
  if (raw.default !== undefined) def.default = raw.default;
  if (values) def.values = values;
  if (valuesFrom) def.valuesFrom = valuesFrom;
  if (min !== undefined) def.min = min;
  if (max !== undefined) def.max = max;
  if (pattern !== undefined) def.pattern = pattern;
  if (typeof raw.vocabulary === 'string') def.vocabulary = raw.vocabulary;
  if (raw.managed_by !== undefined) {
    if (raw.managed_by === 'external') def.managedBy = 'external';
    else {
      ld.error('managed-by', file, `Property "${name}": "managed_by" must be "external"`, at('managed_by'));
      ok = false;
    }
  }
  if (raw.position !== undefined) {
    if (raw.position === 'end') def.position = 'end';
    else {
      ld.error('position', file, `Property "${name}": "position" must be "end"`, at('position'));
      ok = false;
    }
  }
  if (prefixes) def.prefixes = prefixes;
  if (typeof raw.target === 'string') def.target = raw.target;
  if (typeof raw.description === 'string') def.description = raw.description;
  if (module) def.module = module;
  return ok ? def : null;
}

export function parseProperties(
  ld: Loader,
  yf: YamlFile,
  data: Obj,
  module: string | undefined,
): PropertyDef[] {
  const out: PropertyDef[] = [];
  const props = data.properties;
  if (props === undefined || props === null) return out;
  if (!isObj(props)) {
    ld.error('properties-shape', yf.path, '"properties" must be a map of property name to attributes', yf.lineOf(['properties']));
    return out;
  }
  for (const [name, raw] of Object.entries(props)) {
    const def = parseProperty(ld, yf, ['properties'], name, raw, module);
    if (def) out.push(def);
  }
  return out;
}

/** Check a default value against a property's type and limits. Returns an error message or null. */
export function checkDefault(def: PropertyDef, value: unknown, values: string[] | undefined): string | null {
  if (value === undefined) return null;
  switch (def.type) {
    case 'enum':
      if (typeof value !== 'string' || !values || !values.includes(value))
        return `default "${show(value)}" is not one of the allowed values (${(values ?? []).join(', ')})`;
      return null;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return `default "${show(value)}" is not a whole number`;
      if (def.min !== undefined && value < def.min) return `default ${value} is below min ${def.min}`;
      if (def.max !== undefined && value > def.max) return `default ${value} is above max ${def.max}`;
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : `default "${show(value)}" is not true or false`;
    case 'list':
      return Array.isArray(value) ? null : 'default for a list must be a list';
    case 'date':
      if (value === 'today') return null;
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : `default "${show(value)}" is not a date (YYYY-MM-DD or today)`;
    case 'datetime':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
        ? null
        : `default "${show(value)}" is not a datetime (YYYY-MM-DDTHH:mm)`;
    default:
      return typeof value === 'string' ? null : `default "${show(value)}" must be text`;
  }
}
