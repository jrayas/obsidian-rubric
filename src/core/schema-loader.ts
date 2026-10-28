import { parseBody } from './body-config';
import { allPropertyOwners, declaredDomains, loadDomains } from './domain-loader';
import { loadDomainRegistry } from './domain-registry';
import { compareVersions } from './semver';
import { nameKey } from './normalise';
import { SUPPORTED_FORMAT } from './schema-types';
import { Loader, OVERRIDE_KEYS, asStringList, checkDefault, isObj, parseProperties, show } from './loader-base';
import type { Obj } from './loader-base';
import type { YamlFile } from './yaml-file';
import type {
  FoldersConfig,
  LoadResult,
  ModuleDef,
  PropertyDef,
  ResolvedType,
  SchemaFileSource,
  SchemaPack,
  ScopeConfig,
  TypeOverride,
  Vocabulary,
} from './schema-types';

export { checkDefault };

export interface LoadOptions {
  /** Version of the running plugin, compared with `min_plugin_version`. */
  pluginVersion: string;
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

  // --- the domain registry (optional) -----------------------------------------------------
  const domainReg = await loadDomainRegistry(ld);

  // --- modules -------------------------------------------------------------------------
  const modules = new Map<string, ModuleDef>();
  const moduleFiles = new Map<string, string>();
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
    const requires = m.data.requires === undefined ? [] : asStringList(m.data.requires);
    if (requires === null) ld.error('module-shape', p, '"requires" must be a list of module names', m.file.lineOf(['requires']));
    const def: ModuleDef = {
      name,
      file: p,
      requires: requires ?? [],
      properties: parseProperties(ld, m.file, m.data, name),
    };
    if (typeof m.data.description === 'string') def.description = m.data.description;
    // A module that lost its content (for example another file was saved over it) would otherwise vanish silently.
    if (def.properties.length === 0 && (m.data.properties === undefined || m.data.properties === null || (isObj(m.data.properties) && Object.keys(m.data.properties).length === 0))) {
      ld.error('module-empty', p, `Module "${name}" has no properties. A module file needs "module: ${name}" and a "properties" map`, 1);
    }
    modules.set(name, def);
    moduleFiles.set(name, p);
  }

  for (const m of modules.values()) {
    for (const need of m.requires) {
      if (moduleReg[need] === undefined) ld.error('unknown-module', m.file, `Module "${m.name}" requires "${need}", which is not in the registry`, 1);
    }
  }

  // --- vocabularies --------------------------------------------------------------------
  const vocabularies = new Map<string, Vocabulary>();
  const vocabularyFiles = new Map<string, string>();
  const vocabReg = isObj(r.vocabularies) ? r.vocabularies : {};
  for (const [name, p] of Object.entries(vocabReg)) {
    if (typeof p !== 'string') {
      ld.error('registry-shape', REG, `Vocabulary "${name}" needs a file path`, reg.file.lineOf(['vocabularies', name]));
      continue;
    }
    const v = await ld.readYaml(p);
    if (!v) continue;
    const vocab = parseVocabulary(ld, name, p, v.file, v.data);
    if (vocab) {
      vocabularies.set(name, vocab);
      vocabularyFiles.set(name, p);
    }
  }

  // --- types ---------------------------------------------------------------------------
  const types = new Map<string, ResolvedType>();
  const typeFiles = new Map<string, string>();
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
    // A module may name the modules it needs; the type lists them itself, so the order of its properties stays its own.
    for (const m of uses) {
      for (const need of modules.get(m)?.requires ?? []) {
        if (!uses.includes(need)) {
          ld.error('module-requires', entry.file, `Module "${m}" requires "${need}": add "${need}" to uses${moduleReg[need] === undefined ? ' (and to the registry)' : ''}`, t.file.lineOf(['uses']));
        }
      }
    }
    const overrides = parseOverrides(ld, t.file, t.data);
    const body = parseBody(ld, t.file, t.data);
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
      if (p.valuesFrom === 'domains') {
        if (!domainReg) {
          ld.error('domains-missing', p.source.file, `"${p.name}" takes its values from registry/domains.yaml, which does not exist`, p.source.line);
          continue;
        }
        if (p.prefixes) ld.error('prefixes', p.source.file, `Property "${p.name}": prefixes belong in registry/domains.yaml when the values come from it`, p.source.line);
        p.values = [...domainReg.names];
        if (p.default === undefined) p.default = domainReg.defaultDomain;
        const prefixes = Object.fromEntries([...domainReg.entries].filter(([, e]) => e.prefix !== undefined).map(([n, e]) => [n, e.prefix as string]));
        if (Object.keys(prefixes).length > 0) p.prefixes = prefixes;
        else delete p.prefixes;
      }
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
    // A unique ID is made from the domain's prefix, so the type must declare prefixes on its `domain` property.
    if (ordered.some((p) => p.name === 'unique_id') && Object.keys(ordered.find((p) => p.name === 'domain')?.prefixes ?? {}).length === 0) {
      ld.error('unique-id-prefixes', entry.file, 'This type has a "unique_id" property, so at least one domain needs a prefix (two capital letters, in registry/domains.yaml or under "prefixes" on the "domain" property)', t.file.lineOf(['uses']));
    }
    const rt: ResolvedType = {
      name,
      prefix,
      version,
      file: entry.file,
      uses,
      properties: ordered,
      byName: new Map(ordered.map((p) => [p.name, p])),
      body,
    };
    if (typeof t.data.description === 'string') rt.description = t.data.description;
    types.set(name, rt);
    typeFiles.set(name, entry.file);
  }

  // --- per-domain overrides --------------------------------------------------------------
  const domainList = domainReg ? domainReg.names : declaredDomains(types);
  const domainOut = await loadDomains(ld, { source, typeFiles, moduleFiles, vocabularyFiles, modules, vocabularies, types, domains: domainList });
  const domainFolder = new Map(domainList.map((d) => [d, domainReg?.entries.get(d)?.folder ?? d]));
  const legacyDefault = [...types.values()].map((t) => t.byName.get('domain')?.default).find((v): v is string => typeof v === 'string');

  // --- property type conflicts across types (and across each domain's effective types) -------
  const shapes = new Map<string, { sig: string; type: string; file: string; line?: number }>();
  for (const { type, prop: p } of allPropertyOwners(types, domainOut.effectiveTypes)) {
    const sig = p.type === 'list' ? `list of ${p.items ?? '?'}` : p.type;
    const prev = shapes.get(p.name);
    if (!prev) shapes.set(p.name, { sig, type, file: p.source.file, ...(p.source.line !== undefined ? { line: p.source.line } : {}) });
    else if (prev.sig !== sig) {
      ld.error(
        'type-conflict',
        p.source.file,
        `Property "${p.name}" is ${sig} here but ${prev.sig} in type "${prev.type}" (${prev.file}). Obsidian keeps one type per property name.`,
        p.source.line,
      );
    }
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
    ...domainOut,
    domainRegistry: domainReg ? new Map(domainReg.entries) : null,
    defaultDomain: domainReg?.defaultDomain ?? legacyDefault,
    domainFolder,
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
