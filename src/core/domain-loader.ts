/**
 * Finds, reads and checks the per-domain override files, then builds the effective types and vocabularies.
 * Next to each default file `x/name.yaml` an optional folder `x/name/` holds one `<domain>.yaml` per domain.
 */
import { applyDomainToType, applyDomainToVocabulary, CORE_PROPERTIES, DOMAIN_PROPERTY, PREFIXED_PROPERTIES, prefixFor } from './domain-overrides';
import { Loader, asStringList, isObj, parseProperty, show } from './loader-base';
import type {
  DomainChange,
  DomainFile,
  DomainVocabulary,
  ModuleDef,
  PropertyDef,
  ResolvedType,
  SchemaFileSource,
  SchemaPack,
  Vocabulary,
  VocabularyTerm,
} from './schema-types';
import type { YamlFile } from './yaml-file';

const CHANGE_KEYS = new Set(['values', 'default', 'description']);

export interface DomainInput {
  source: SchemaFileSource;
  /** Registry entries: name -> file path. */
  typeFiles: Map<string, string>;
  moduleFiles: Map<string, string>;
  vocabularyFiles: Map<string, string>;
  modules: Map<string, ModuleDef>;
  vocabularies: Map<string, Vocabulary>;
  types: Map<string, ResolvedType>;
}

export type DomainOutput = Pick<SchemaPack, 'domains' | 'domainFiles' | 'effectiveTypes' | 'effectiveVocabularies'>;

/** The folder of override files for a default file: `types/kb.yaml` -> `types/kb`. */
export const overrideDir = (file: string): string => file.replace(/\.ya?ml$/i, '');

/** The values of the `domain` property, across all types: the domains that may have override files. */
export function declaredDomains(types: Map<string, ResolvedType>): string[] {
  const out: string[] = [];
  for (const t of types.values()) {
    for (const v of t.byName.get(DOMAIN_PROPERTY)?.values ?? []) if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Parse the shared shape of a type or module override file. Null (after reporting) when it cannot be used. */
function parseDomainFile(
  ld: Loader,
  yf: YamlFile,
  data: unknown,
  kind: 'type' | 'module',
  name: string,
  domain: string,
  module: ModuleDef | undefined,
): DomainFile | null {
  const file = yf.path;
  if (!isObj(data)) {
    ld.error('override-shape', file, 'An override file must be a map', 1);
    return null;
  }
  const allowed = new Set(['domain', 'override', 'add', 'remove', kind]);
  if (kind === 'module') allowed.add('sections');
  let ok = true;
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) {
      ld.error('override-unknown-key', file, `Unknown key “${key}” (use domain, override, add, remove${kind === 'module' ? ', sections' : ''})`, yf.lineOf([key]));
      ok = false;
    }
  }
  if (data.domain === undefined) {
    ld.error('domain-missing', file, `Missing “domain: ${domain}”`, 1);
    ok = false;
  } else if (data.domain !== domain) {
    ld.error('domain-mismatch', file, `The file is named for domain “${domain}” but says “${show(data.domain)}”`, yf.lineOf(['domain']));
    ok = false;
  }
  if (data[kind] !== undefined && data[kind] !== name) {
    ld.error('name-mismatch', file, `File says ${kind} “${show(data[kind])}” but it belongs to “${name}”`, yf.lineOf([kind]));
    ok = false;
  }
  const out: DomainFile = { file, domain, kind, name, override: new Map(), add: [], remove: [], sections: [] };
  const mentioned = new Map<string, string>();
  const mention = (prop: string, verb: string, line: number | undefined): void => {
    const prev = mentioned.get(prop);
    if (prev !== undefined) {
      ld.error('override-conflict', file, `“${prop}” is named under both ${prev} and ${verb}; use one verb per property`, line);
      ok = false;
    } else mentioned.set(prop, verb);
  };
  const inModule = (prop: string): boolean => module === undefined || module.properties.some((p) => p.name === prop);

  if (data.override !== undefined) {
    if (!isObj(data.override)) {
      ld.error('override-shape', file, '“override” must be a map of property name to changes', yf.lineOf(['override']));
      ok = false;
    } else {
      for (const [prop, raw] of Object.entries(data.override)) {
        const line = yf.lineOf(['override', prop]);
        if (!isObj(raw)) {
          ld.error('override-shape', file, `Override for “${prop}” must be a map`, line);
          ok = false;
          continue;
        }
        mention(prop, 'override', line);
        if (!inModule(prop)) {
          ld.error('override-unknown', file, `Cannot override “${prop}”: module “${name}” has no such property`, line);
          ok = false;
        }
        const change: DomainChange = { ...(line !== undefined ? { line } : {}) };
        for (const key of Object.keys(raw)) {
          if (key === 'type') {
            ld.error('override-type', file, `An override may not change the type of “${prop}”`, yf.lineOf(['override', prop, key]));
            ok = false;
          } else if (!CHANGE_KEYS.has(key)) {
            ld.error('override-unknown-key', file, `Override for “${prop}”: only values, default and description can change (found “${key}”)`, yf.lineOf(['override', prop, key]));
            ok = false;
          }
        }
        if (raw.values !== undefined) {
          const list = asStringList(raw.values);
          if (!list || list.length === 0) {
            ld.error('enum-values', file, `Override for “${prop}”: “values” must be a non-empty list`, yf.lineOf(['override', prop, 'values']));
            ok = false;
          } else change.values = list;
        }
        if (raw.default !== undefined) change.default = raw.default;
        if (typeof raw.description === 'string') change.description = raw.description;
        out.override.set(prop, change);
      }
    }
  }

  if (data.add !== undefined) {
    if (!isObj(data.add)) {
      ld.error('override-shape', file, '“add” must be a map of property name to definition', yf.lineOf(['add']));
      ok = false;
    } else {
      for (const [prop, raw] of Object.entries(data.add)) {
        mention(prop, 'add', yf.lineOf(['add', prop]));
        const def = parseProperty(ld, yf, ['add'], prop, raw, kind === 'module' ? name : undefined);
        if (def) out.add.push(def);
        else ok = false;
      }
    }
  }

  if (data.remove !== undefined) {
    const list = asStringList(data.remove);
    if (!list) {
      ld.error('override-shape', file, '“remove” must be a list of property names', yf.lineOf(['remove']));
      ok = false;
    } else {
      list.forEach((prop, i) => {
        const line = yf.lineOf(['remove', String(i)]) ?? yf.lineOf(['remove']);
        mention(prop, 'remove', line);
        if (CORE_PROPERTIES.includes(prop)) {
          ld.error('remove-core', file, `“${prop}” is a core property and cannot be removed (${CORE_PROPERTIES.join(', ')})`, line);
          ok = false;
        } else if (!inModule(prop)) {
          ld.error('remove-unknown', file, `Cannot remove “${prop}”: module “${name}” has no such property`, line);
          ok = false;
        } else out.remove.push({ name: prop, ...(line !== undefined ? { line } : {}) });
      });
    }
  }

  if (data.sections !== undefined) {
    const list = asStringList(data.sections);
    if (!list || list.length === 0) {
      ld.error('override-shape', file, '“sections” must be a non-empty list', yf.lineOf(['sections']));
      ok = false;
    } else if (module && !module.properties.some((p) => p.name === 'section')) {
      ld.error('sections-unknown', file, `“sections” needs module “${name}” to have a property called “section”`, yf.lineOf(['sections']));
      ok = false;
    } else {
      for (const s of list) {
        if (!s.startsWith(prefixFor(domain))) {
          ld.error('domain-prefix', file, `Section “${s}” must start with “${prefixFor(domain)}”`, yf.lineOf(['sections']));
          ok = false;
        }
      }
      out.sections = list;
    }
  }
  return ok ? out : null;
}

function parseDomainVocabulary(ld: Loader, yf: YamlFile, data: unknown, name: string, domain: string): DomainVocabulary | null {
  const file = yf.path;
  if (!isObj(data)) {
    ld.error('override-shape', file, 'An override file must be a map', 1);
    return null;
  }
  let ok = true;
  for (const key of Object.keys(data)) {
    if (!['domain', 'terms', 'vocabulary'].includes(key)) {
      ld.error('override-unknown-key', file, `Unknown key “${key}” (use domain, terms)`, yf.lineOf([key]));
      ok = false;
    }
  }
  if (data.domain === undefined) {
    ld.error('domain-missing', file, `Missing “domain: ${domain}”`, 1);
    ok = false;
  } else if (data.domain !== domain) {
    ld.error('domain-mismatch', file, `The file is named for domain “${domain}” but says “${show(data.domain)}”`, yf.lineOf(['domain']));
    ok = false;
  }
  if (data.vocabulary !== undefined && data.vocabulary !== name) {
    ld.error('name-mismatch', file, `File says vocabulary “${show(data.vocabulary)}” but it belongs to “${name}”`, yf.lineOf(['vocabulary']));
    ok = false;
  }
  const terms: VocabularyTerm[] = [];
  const lines = new Map<string, number | undefined>();
  if (!isObj(data.terms)) {
    ld.error('vocabulary-shape', file, 'An override vocabulary needs a “terms” map', yf.lineOf(['terms']) ?? 1);
    return null;
  }
  for (const [term, raw] of Object.entries(data.terms)) {
    const syn = isObj(raw) && raw.synonyms !== undefined ? asStringList(raw.synonyms) : [];
    if (syn === null) {
      ld.error('vocabulary-shape', file, `Term “${term}”: “synonyms” must be a list of text`, yf.lineOf(['terms', term, 'synonyms']));
      ok = false;
      continue;
    }
    terms.push({ term, synonyms: syn });
    lines.set(term, yf.lineOf(['terms', term]));
  }
  return ok ? { file, domain, name, terms, lines } : null;
}

/** Read the override files (if any) and compute every effective type and vocabulary. */
export async function loadDomains(ld: Loader, input: DomainInput): Promise<DomainOutput> {
  const { source, types, modules, vocabularies } = input;
  const domains = declaredDomains(types);
  const domainFiles: DomainOutput['domainFiles'] = new Map();
  const bucket = (domain: string) => {
    let b = domainFiles.get(domain);
    if (!b) {
      b = { types: new Map(), modules: new Map(), vocabularies: new Map() };
      domainFiles.set(domain, b);
    }
    return b;
  };

  /** Slugs of the `.yaml` files in the override folder of a default file. */
  const found = async (file: string): Promise<string[]> => {
    const names = await source.list(overrideDir(file));
    return names.filter((n) => /\.yaml$/i.test(n)).map((n) => n.replace(/\.yaml$/i, '')).sort();
  };
  const known = (slug: string, path: string): boolean => {
    if (domains.includes(slug)) return true;
    ld.error(
      'override-domain-unknown',
      path,
      domains.length > 0
        ? `“${slug}” is not one of the domain values (${domains.join(', ')}). Add it to the “${DOMAIN_PROPERTY}” property first, or rename this file`
        : `No property called “${DOMAIN_PROPERTY}” has values, so there are no domains to override`,
    );
    return false;
  };

  for (const [name, file] of input.typeFiles) {
    if (!types.has(name)) continue;
    for (const slug of await found(file)) {
      const path = `${overrideDir(file)}/${slug}.yaml`;
      if (!known(slug, path)) continue;
      const r = await ld.readYaml(path);
      if (!r) continue;
      const df = parseDomainFile(ld, r.file, r.data, 'type', name, slug, undefined);
      if (df) bucket(slug).types.set(name, df);
    }
  }
  for (const [name, file] of input.moduleFiles) {
    const module = modules.get(name);
    if (!module) continue;
    for (const slug of await found(file)) {
      const path = `${overrideDir(file)}/${slug}.yaml`;
      if (!known(slug, path)) continue;
      const r = await ld.readYaml(path);
      if (!r) continue;
      const df = parseDomainFile(ld, r.file, r.data, 'module', name, slug, module);
      if (df) bucket(slug).modules.set(name, df);
    }
  }
  for (const [name, file] of input.vocabularyFiles) {
    if (!vocabularies.has(name)) continue;
    for (const slug of await found(file)) {
      const path = `${overrideDir(file)}/${slug}.yaml`;
      if (!known(slug, path)) continue;
      const r = await ld.readYaml(path);
      if (!r) continue;
      const dv = parseDomainVocabulary(ld, r.file, r.data, name, slug);
      if (dv) bucket(slug).vocabularies.set(name, dv);
    }
  }

  // Vocabularies used by a `track` property need domain-prefixed terms.
  const prefixedVocabularies = new Set<string>();
  for (const t of types.values()) {
    for (const p of t.properties) {
      if (PREFIXED_PROPERTIES.includes(p.name) && p.type === 'list' && p.vocabulary) prefixedVocabularies.add(p.vocabulary);
    }
  }

  const effectiveTypes: DomainOutput['effectiveTypes'] = new Map();
  const effectiveVocabularies: DomainOutput['effectiveVocabularies'] = new Map();
  for (const [domain, b] of domainFiles) {
    for (const [vname, dv] of b.vocabularies) {
      const base = vocabularies.get(vname);
      if (base) effectiveVocabularies.set(`${domain}/${vname}`, applyDomainToVocabulary(base, domain, dv, ld, prefixedVocabularies.has(vname)));
    }
    for (const [tname, base] of types) {
      const files: DomainFile[] = [];
      for (const m of base.uses) {
        const mf = b.modules.get(m);
        if (mf) files.push(mf);
      }
      const tf = b.types.get(tname);
      if (tf) files.push(tf);
      if (files.length === 0) continue;
      // An added list-of-terms property sees the domain's own vocabulary names; they are the same names as the default.
      effectiveTypes.set(`${domain}/${tname}`, applyDomainToType(base, domain, files, ld, vocabularies));
    }
  }
  return { domains, domainFiles, effectiveTypes, effectiveVocabularies };
}

/** Every effective type, for checks that compare properties across types. */
export function allPropertyOwners(types: Map<string, ResolvedType>, effective: Map<string, ResolvedType>): { type: string; prop: PropertyDef }[] {
  const out: { type: string; prop: PropertyDef }[] = [];
  for (const t of [...types.values(), ...effective.values()]) {
    for (const prop of t.properties) out.push({ type: t.domain ? `${t.name} (${t.domain})` : t.name, prop });
  }
  return out;
}
