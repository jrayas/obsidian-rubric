import { split } from './frontmatter';
import { compareVersions } from './semver';
import { parseTemplate } from './templates';
import type { TemplateDef } from './templates';
import { nameKey } from './normalise';
import { YamlFile } from './yaml-file';
import type { YamlPath } from './yaml-file';
import { ITEM_TYPES, SUPPORTED_FORMAT, VALUE_TYPES } from './schema-types';
import type {
  FoldersConfig,
  ItemType,
  LoadResult,
  ModuleDef,
  Problem,
  PropertyDef,
  ResolvedType,
  SchemaFileSource,
  SchemaPack,
  ScopeConfig,
  Severity,
  TypeOverride,
  ValueType,
  Vocabulary,
} from './schema-types';

type Obj = Record<string, unknown>;

/** Render any YAML value for a message without risking "[object Object]". */
const show = (v: unknown): string => (typeof v === 'string' ? v : (JSON.stringify(v) ?? 'nothing'));
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const PROPERTY_KEYS = new Set([
  'type', 'items', 'required', 'default', 'values', 'values_from', 'min', 'max', 'pattern', 'vocabulary',
  'strict', 'normalise', 'locked', 'immutable', 'generated', 'managed_by', 'position', 'allow_heading',
  'target', 'description',
]);
const OVERRIDE_KEYS = new Set(['values', 'default', 'required']);

export interface LoadOptions {
  /** Version of the running plugin, compared with `min_plugin_version`. */
  pluginVersion: string;
}

/** Collects problems and reads YAML files, remembering each file's text for line numbers. */
class Loader {
  readonly problems: Problem[] = [];
  private readonly files = new Map<string, YamlFile>();

  constructor(private readonly source: SchemaFileSource) {}

  report(severity: Severity, code: string, file: string, message: string, line?: number): void {
    this.problems.push({ severity, code, file, message, ...(line !== undefined ? { line } : {}) });
  }

  error(code: string, file: string, message: string, line?: number): void {
    this.report('error', code, file, message, line);
  }

  warn(code: string, file: string, message: string, line?: number): void {
    this.report('warning', code, file, message, line);
  }

  /** Raw text of a file, or null when it does not exist. */
  readText(path: string): Promise<string | null> {
    return this.source.read(path);
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

function asStringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === 'string' || typeof x === 'number') ? v.map(String) : null;
}

/** Parse one property definition. Returns null after reporting when it cannot be used. */
function parseProperty(
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
  if (typeof raw.target === 'string') def.target = raw.target;
  if (typeof raw.description === 'string') def.description = raw.description;
  if (module) def.module = module;
  return ok ? def : null;
}

function parseProperties(
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

function parseVocabulary(ld: Loader, name: string, file: string, yf: YamlFile, data: unknown): Vocabulary | null {
  if (!isObj(data) || !isObj(data.terms)) {
    ld.error('vocabulary-shape', file, 'A vocabulary needs a "terms" map', yf.lineOf(['terms']) ?? 1);
    return null;
  }
  if (data.vocabulary !== undefined && data.vocabulary !== name) {
    ld.warn('name-mismatch', file, `File says vocabulary "${show(data.vocabulary)}" but the registry calls it "${name}"`, yf.lineOf(['vocabulary']));
  }
  const terms: Vocabulary['terms'] = [];
  const lookup = new Map<string, string>();
  const claim = (word: string, preferred: string, line: number | undefined) => {
    const key = word.toLowerCase();
    const existing = lookup.get(key);
    if (existing !== undefined && existing !== preferred) {
      ld.error('vocabulary-clash', file, `"${word}" is used for both "${existing}" and "${preferred}"`, line);
    } else lookup.set(key, preferred);
  };
  for (const [term, raw] of Object.entries(data.terms)) {
    const syn = isObj(raw) && raw.synonyms !== undefined ? asStringList(raw.synonyms) : [];
    if (syn === null) {
      ld.error('vocabulary-shape', file, `Term "${term}": "synonyms" must be a list of text`, yf.lineOf(['terms', term, 'synonyms']));
      continue;
    }
    terms.push({ term, synonyms: syn });
  }
  for (const t of terms) claim(t.term, t.term, yf.lineOf(['terms', t.term]));
  for (const t of terms) for (const s of t.synonyms) claim(s, t.term, yf.lineOf(['terms', t.term, 'synonyms']));
  return { name, file, terms, lookup };
}

function parseOverrides(ld: Loader, yf: YamlFile, data: Obj): Map<string, TypeOverride> {
  const out = new Map<string, TypeOverride>();
  if (data.overrides === undefined) return out;
  if (!isObj(data.overrides)) {
    ld.error('overrides-shape', yf.path, '"overrides" must be a map', yf.lineOf(['overrides']));
    return out;
  }
  for (const [prop, raw] of Object.entries(data.overrides)) {
    if (!isObj(raw)) {
      ld.error('overrides-shape', yf.path, `Override for "${prop}" must be a map`, yf.lineOf(['overrides', prop]));
      continue;
    }
    const o: TypeOverride = {};
    for (const key of Object.keys(raw)) {
      if (!OVERRIDE_KEYS.has(key))
        ld.error('overrides-shape', yf.path, `Override for "${prop}": only values, default and required can change (found "${key}")`, yf.lineOf(['overrides', prop, key]));
    }
    if (raw.values !== undefined) {
      const list = asStringList(raw.values);
      if (!list || list.length === 0) ld.error('enum-values', yf.path, `Override for "${prop}": "values" must be a non-empty list`, yf.lineOf(['overrides', prop, 'values']));
      else o.values = list;
    }
    if (raw.default !== undefined) o.default = raw.default;
    if (typeof raw.required === 'boolean') o.required = raw.required;
    out.set(prop, o);
  }
  return out;
}

export async function loadSchemaPack(source: SchemaFileSource, options: LoadOptions): Promise<LoadResult> {
  const ld = new Loader(source);
  const REG = 'registry/types.yaml';

  const reg = await ld.readYaml(REG);
  if (!reg) return { pack: null, problems: ld.problems };
  if (!isObj(reg.data)) {
    ld.error('registry-shape', REG, 'The registry must be a map', 1);
    return { pack: null, problems: ld.problems };
  }
  const r = reg.data;

  const format = r.format;
  if (typeof format !== 'number') {
    ld.error('format', REG, 'Missing "format" (the schema language version, currently 1)', reg.file.lineOf(['format']) ?? 1);
  } else if (format > SUPPORTED_FORMAT) {
    ld.error('format-newer', REG, `Schema format ${format} is newer than this plugin understands (${SUPPORTED_FORMAT}). Update the plugin.`, reg.file.lineOf(['format']));
  }
  const minPlugin = typeof r.min_plugin_version === 'string' ? r.min_plugin_version : '0.0.0';
  if (compareVersions(minPlugin, options.pluginVersion) > 0) {
    ld.error('plugin-too-old', REG, `This pack needs plugin version ${minPlugin} or newer (running ${options.pluginVersion}).`, reg.file.lineOf(['min_plugin_version']));
  }

  // --- modules -------------------------------------------------------------------------
  const modules = new Map<string, ModuleDef>();
  const moduleReg = isObj(r.modules) ? r.modules : {};
  if (!isObj(r.modules)) ld.error('registry-shape', REG, 'Missing "modules" map', 1);
  for (const [name, p] of Object.entries(moduleReg)) {
    if (typeof p !== 'string') {
      ld.error('registry-shape', REG, `Module "${name}" needs a file path`, reg.file.lineOf(['modules', name]));
      continue;
    }
    const m = await ld.readYaml(p);
    if (!m) continue;
    if (!isObj(m.data)) {
      ld.error('module-shape', p, 'A module file must be a map', 1);
      continue;
    }
    if (m.data.module !== undefined && m.data.module !== name) {
      ld.warn('name-mismatch', p, `File says module "${show(m.data.module)}" but the registry calls it "${name}"`, m.file.lineOf(['module']));
    }
    const def: ModuleDef = {
      name,
      file: p,
      properties: parseProperties(ld, m.file, m.data, name),
    };
    if (typeof m.data.description === 'string') def.description = m.data.description;
    modules.set(name, def);
  }

  // --- vocabularies --------------------------------------------------------------------
  const vocabularies = new Map<string, Vocabulary>();
  const vocabReg = isObj(r.vocabularies) ? r.vocabularies : {};
  for (const [name, p] of Object.entries(vocabReg)) {
    if (typeof p !== 'string') {
      ld.error('registry-shape', REG, `Vocabulary "${name}" needs a file path`, reg.file.lineOf(['vocabularies', name]));
      continue;
    }
    const v = await ld.readYaml(p);
    if (!v) continue;
    const vocab = parseVocabulary(ld, name, p, v.file, v.data);
    if (vocab) vocabularies.set(name, vocab);
  }

  // --- types ---------------------------------------------------------------------------
  const types = new Map<string, ResolvedType>();
  const typeReg = isObj(r.types) ? r.types : {};
  if (!isObj(r.types) || Object.keys(typeReg).length === 0) ld.error('registry-shape', REG, 'The registry lists no types', reg.file.lineOf(['types']) ?? 1);
  const typeNames = Object.keys(typeReg);
  const prefixes = new Map<string, string>();

  for (const [name, entry] of Object.entries(typeReg)) {
    const line = reg.file.lineOf(['types', name]);
    if (!isObj(entry) || typeof entry.file !== 'string') {
      ld.error('registry-shape', REG, `Type "${name}" needs { file, prefix, version }`, line);
      continue;
    }
    const prefix = entry.prefix;
    if (typeof prefix !== 'string' || !/^[A-Z]{2}$/.test(prefix)) {
      ld.error('type-prefix', REG, `Type "${name}": prefix must be two capital letters`, reg.file.lineOf(['types', name, 'prefix']) ?? line);
    } else if (prefixes.has(prefix)) {
      ld.error('type-prefix', REG, `Types "${prefixes.get(prefix)}" and "${name}" both use prefix ${prefix}`, reg.file.lineOf(['types', name, 'prefix']) ?? line);
    } else prefixes.set(prefix, name);
    const version = entry.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      ld.error('type-version', REG, `Type "${name}": version must be a whole number from 1`, reg.file.lineOf(['types', name, 'version']) ?? line);
    }

    const t = await ld.readYaml(entry.file);
    if (!t) continue;
    if (!isObj(t.data)) {
      ld.error('type-shape', entry.file, 'A type file must be a map', 1);
      continue;
    }
    if (t.data.type !== undefined && t.data.type !== name) {
      ld.error('name-mismatch', entry.file, `File says type "${show(t.data.type)}" but the registry calls it "${name}"`, t.file.lineOf(['type']));
    }
    const uses = asStringList(t.data.uses);
    if (!uses) {
      ld.error('type-uses', entry.file, 'A type needs "uses": a list of module names', t.file.lineOf(['uses']) ?? 1);
      continue;
    }
    let usable = true;
    for (const m of uses) {
      if (!modules.has(m)) {
        const known = moduleReg[m] !== undefined;
        ld.error('unknown-module', entry.file, `Unknown module "${m}"${known ? ' (its file has errors)' : ''}`, t.file.lineOf(['uses']));
        usable = false;
      }
    }
    if (!uses.includes('base')) {
      ld.error('type-uses', entry.file, 'Every type must use the "base" module', t.file.lineOf(['uses']));
    }
    const overrides = parseOverrides(ld, t.file, t.data);
    const own = parseProperties(ld, t.file, t.data, undefined);
    if (!usable || typeof prefix !== 'string' || typeof version !== 'number') continue;

    // Build the ordered property list.
    const list: PropertyDef[] = [];
    const seen = new Map<string, PropertyDef>();
    for (const m of uses) {
      for (const p of modules.get(m)?.properties ?? []) {
        if (seen.has(p.name)) {
          ld.error('duplicate-property', entry.file, `Property "${p.name}" comes from module "${m}" and also from "${seen.get(p.name)?.module ?? 'this type'}"`, t.file.lineOf(['uses']));
          continue;
        }
        const copy: PropertyDef = { ...p };
        seen.set(p.name, copy);
        list.push(copy);
      }
    }
    for (const p of own) {
      if (seen.has(p.name)) {
        ld.error('duplicate-property', entry.file, `Property "${p.name}" is already defined by module "${seen.get(p.name)?.module}"; change it with "overrides"`, p.source.line);
        continue;
      }
      seen.set(p.name, p);
      list.push(p);
    }
    for (const [prop, o] of overrides) {
      const target = seen.get(prop);
      if (!target) {
        ld.error('override-unknown', entry.file, `Override for "${prop}", which this type does not have`, t.file.lineOf(['overrides', prop]));
        continue;
      }
      if (o.values) target.values = o.values;
      if (o.default !== undefined) target.default = o.default;
      if (o.required !== undefined) target.required = o.required;
    }
    for (const p of list) {
      if (p.valuesFrom === 'type') {
        if (!p.values) {
          ld.error('values-from-type', entry.file, `"${p.name}" takes its values from the type, so this type must give them under overrides.${p.name}.values`, t.file.lineOf(['overrides']) ?? t.file.lineOf(['uses']));
          continue;
        }
        if (p.default === undefined) p.default = p.values[0];
      }
      if (p.valuesFrom === 'registry') p.values = [...typeNames];
      if (p.type === 'list' && p.items === 'term') {
        if (!p.vocabulary) {
          ld.error('vocabulary-missing', entry.file, `Property "${p.name}" is a list of terms and needs a "vocabulary"`, p.source.line);
        } else if (!vocabularies.has(p.vocabulary)) {
          ld.error('vocabulary-unknown', p.source.file, `Property "${p.name}": unknown vocabulary "${p.vocabulary}"`, p.source.line);
        }
      }
      const bad = checkDefault(p, p.default, p.values);
      if (bad) {
        const line = overrides.get(p.name)?.default !== undefined ? t.file.lineOf(['overrides', p.name, 'default']) : p.source.line;
        const file = overrides.get(p.name)?.default !== undefined ? entry.file : p.source.file;
        ld.error('bad-default', file, `Property "${p.name}": ${bad}`, line);
      }
    }
    // `position: end` fields go last, in their declared order.
    const ordered = [...list.filter((p) => p.position !== 'end'), ...list.filter((p) => p.position === 'end')];
    const rt: ResolvedType = {
      name,
      prefix,
      version,
      file: entry.file,
      uses,
      properties: ordered,
      byName: new Map(ordered.map((p) => [p.name, p])),
    };
    if (typeof t.data.description === 'string') rt.description = t.data.description;
    types.set(name, rt);
  }

  // --- property type conflicts across types ---------------------------------------------
  const shapes = new Map<string, { sig: string; type: string; file: string; line?: number }>();
  for (const t of types.values()) {
    for (const p of t.properties) {
      const sig = p.type === 'list' ? `list of ${p.items ?? '?'}` : p.type;
      const prev = shapes.get(p.name);
      if (!prev) shapes.set(p.name, { sig, type: t.name, file: p.source.file, ...(p.source.line !== undefined ? { line: p.source.line } : {}) });
      else if (prev.sig !== sig) {
        ld.error(
          'type-conflict',
          p.source.file,
          `Property "${p.name}" is ${sig} here but ${prev.sig} in type "${prev.type}" (${prev.file}). Obsidian keeps one type per property name.`,
          p.source.line,
        );
      }
    }
  }

  // --- templates (optional, one per type) --------------------------------------------------
  const templates = new Map<string, TemplateDef>();
  for (const [name, rt] of types) {
    const path = `templates/${name}.md`;
    const text = await ld.readText(path);
    if (text === null) continue;
    const parts = split(text);
    const yf = parts ? new YamlFile(path, parts.yaml) : null;
    const { def, issues } = parseTemplate(rt, path, text, (k) => {
      const line = yf?.lineOf([k]);
      return line === undefined ? undefined : line + 1; // the opening --- is line 1
    });
    for (const issue of issues) ld.warn('template', path, issue.message, issue.line);
    if (def) templates.set(name, def);
  }

  // --- folders and scope ----------------------------------------------------------------
  const folders = await loadFolders(ld, new Set(typeNames));
  const scope = await loadScope(ld);

  const hasError = ld.problems.some((p) => p.severity === 'error');
  if (hasError) return { pack: null, problems: ld.problems };

  const pack: SchemaPack = {
    format: typeof format === 'number' ? format : SUPPORTED_FORMAT,
    minPluginVersion: minPlugin,
    typeNames,
    types,
    modules,
    vocabularies,
    folders,
    scope,
    templates,
  };
  return { pack, problems: ld.problems };
}

async function loadFolders(ld: Loader, typeNames: Set<string>): Promise<FoldersConfig> {
  const FILE = 'registry/folders.yaml';
  const out: FoldersConfig = { mode: 'combined', mappings: [], conflicts: [] };
  const f = await ld.readYaml(FILE, true);
  if (!f) {
    ld.warn('file-missing', FILE, 'No registry/folders.yaml: no folder mappings are defined');
    return out;
  }
  if (!isObj(f.data)) {
    ld.error('folders-shape', FILE, 'folders.yaml must be a map', 1);
    return out;
  }
  const d = f.data;
  if (d.mode !== undefined) {
    if (d.mode === 'combined' || d.mode === 'auto' || d.mode === 'manual') out.mode = d.mode;
    else ld.error('folders-mode', FILE, `"mode" must be combined, auto or manual (found "${show(d.mode)}")`, f.file.lineOf(['mode']));
  }
  if (d.order !== undefined) {
    const order = asStringList(d.order);
    if (!order || order.join(',') !== 'type,breadcrumb,folder,ask') {
      ld.warn('folders-order', FILE, 'The matching order is fixed (type, breadcrumb, folder, ask); the "order" you wrote is ignored', f.file.lineOf(['order']));
    }
  }
  if (d.folders !== undefined && !isObj(d.folders)) {
    ld.error('folders-shape', FILE, '"folders" must map a folder name to a type', f.file.lineOf(['folders']));
    return out;
  }
  const byKey = new Map<string, { folder: string; types: Set<string> }>();
  for (const [folder, type] of Object.entries(isObj(d.folders) ? d.folders : {})) {
    const line = f.file.lineOf(['folders', folder]);
    if (typeof type !== 'string' || !typeNames.has(type)) {
      ld.error('folders-unknown-type', FILE, `Folder "${folder}" maps to unknown type "${show(type)}"`, line);
      continue;
    }
    const mapping = { folder, type, ...(line !== undefined ? { line } : {}) };
    out.mappings.push(mapping);
    const key = nameKey(folder);
    const entry = byKey.get(key) ?? { folder, types: new Set<string>() };
    entry.types.add(type);
    byKey.set(key, entry);
  }
  for (const e of byKey.values()) {
    if (e.types.size > 1) {
      out.conflicts.push({ folder: e.folder, types: [...e.types] });
      ld.warn('folder-conflict', FILE, `Folder "${e.folder}" is claimed by several types (${[...e.types].join(', ')}). The plugin will ask which one owns it.`, f.file.lineOf(['folders', e.folder]));
    }
  }
  return out;
}

async function loadScope(ld: Loader): Promise<ScopeConfig> {
  const FILE = 'registry/scope.yaml';
  const out: ScopeConfig = { mode: 'exclude', exclude: [], include: [] };
  const s = await ld.readYaml(FILE, true);
  if (!s) {
    ld.warn('file-missing', FILE, 'No registry/scope.yaml: every note is managed');
    return out;
  }
  if (!isObj(s.data)) {
    ld.error('scope-shape', FILE, 'scope.yaml must be a map', 1);
    return out;
  }
  const d = s.data;
  if (d.mode !== undefined) {
    if (d.mode === 'exclude' || d.mode === 'include-only') out.mode = d.mode;
    else ld.error('scope-mode', FILE, `"mode" must be exclude or include-only (found "${show(d.mode)}")`, s.file.lineOf(['mode']));
  }
  for (const key of ['exclude', 'include'] as const) {
    if (d[key] === undefined || d[key] === null) continue;
    const list = asStringList(d[key]);
    if (!list) ld.error('scope-shape', FILE, `"${key}" must be a list of folder names`, s.file.lineOf([key]));
    else out[key] = list;
  }
  return out;
}
