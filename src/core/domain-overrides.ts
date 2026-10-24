/**
 * Per-domain schema overrides. The effective schema for a note is the default plus the override files named after the
 * note's `domain`. Three verbs only: `override` (change values, default or description of an existing property), `add`
 * (a property allowed only for this domain) and `remove` (a property not allowed for this domain). Pure; no Obsidian types.
 *
 * Three names are fixed by this feature rather than read from the schema, because a schema file cannot say "this is the
 * domain" or "this must start with its domain": the `domain` property, the `section` and `track` properties, and the list
 * of core properties. They are documented in the README and in decisions D-63.
 */
import { checkDefault } from './loader-base';
import type { DomainFile, DomainVocabulary, PropertyDef, ResolvedType, SchemaPack, Vocabulary } from './schema-types';

/** The property whose value picks the override files. */
export const DOMAIN_PROPERTY = 'domain';

/** Properties no domain may remove. */
export const CORE_PROPERTIES: readonly string[] = ['type', 'schema', 'id', 'name', 'status', 'domain', 'section', 'level', 'order', 'created', 'modified'];

/** Properties whose values must start with `<domain>-` (and the vocabularies of a list property of that name). */
export const PREFIXED_PROPERTIES: readonly string[] = ['section', 'track'];

/** Where problems go. The loader satisfies this. */
export interface Reporter {
  error(code: string, file: string, message: string, line?: number): void;
}

/** The note's domain, or undefined when it has none. */
export function domainOf(fm: Record<string, unknown> | null | undefined): string | undefined {
  const d = fm?.[DOMAIN_PROPERTY];
  return typeof d === 'string' && d !== '' ? d : undefined;
}

/** `<domain>-` as a prefix for values. */
export const prefixFor = (domain: string): string => `${domain}-`;

/** A type with a domain's overrides applied; the default type when that domain changes nothing for it. */
export function typeFor(pack: SchemaPack, typeName: string, domain?: string): ResolvedType | undefined {
  if (domain) {
    const eff = pack.effectiveTypes.get(`${domain}/${typeName}`);
    if (eff) return eff;
  }
  return pack.types.get(typeName);
}

/** A vocabulary with a domain's terms added; the default vocabulary when the domain adds none. */
export function vocabFor(pack: SchemaPack, name: string, domain?: string): Vocabulary | undefined {
  if (domain) {
    const eff = pack.effectiveVocabularies.get(`${domain}/${name}`);
    if (eff) return eff;
  }
  return pack.vocabularies.get(name);
}

/** The default type and the effective one for a domain, for comparisons. */
export function typePair(pack: SchemaPack, typeName: string, domain?: string): { base: ResolvedType; effective: ResolvedType } | undefined {
  const base = pack.types.get(typeName);
  const effective = typeFor(pack, typeName, domain);
  return base && effective ? { base, effective } : undefined;
}

/**
 * Apply override files to a copy of a type. `files` are the module files the type uses (in the type's `uses` order),
 * then the type's own file. Each file is applied as remove, override, sections, add; a file may not name one property
 * under two verbs (checked when it is read).
 */
export function applyDomainToType(base: ResolvedType, domain: string, files: DomainFile[], ld: Reporter, vocabularies: Map<string, Vocabulary>): ResolvedType {
  const props: PropertyDef[] = base.properties.map((p) => ({ ...p }));
  const where = (f: DomainFile): string => (f.kind === 'module' ? ` from module "${f.name}"` : '');
  for (const f of files) {
    const inScope = (p: PropertyDef): boolean => f.kind === 'type' || p.module === f.name;

    for (const r of f.remove) {
      const i = props.findIndex((p) => p.name === r.name && inScope(p));
      if (i < 0) ld.error('remove-unknown', f.file, `Cannot remove “${r.name}”: type “${base.name}” has no such property${where(f)}`, r.line);
      else props.splice(i, 1);
    }

    const changed: { target: PropertyDef; line: number | undefined }[] = [];
    for (const [name, change] of f.override) {
      const target = props.find((p) => p.name === name && inScope(p));
      if (!target) {
        ld.error('override-unknown', f.file, `Cannot override “${name}”: type “${base.name}” has no such property${where(f)}`, change.line);
        continue;
      }
      if (change.values) {
        if (target.type !== 'enum') ld.error('override-values', f.file, `“${name}” is not an enum, so it has no values to change`, change.line);
        else {
          target.values = change.values;
          if (PREFIXED_PROPERTIES.includes(name)) {
            for (const v of change.values) {
              if (!v.startsWith(prefixFor(domain))) ld.error('domain-prefix', f.file, `“${name}” value “${v}” must start with “${prefixFor(domain)}”`, change.line);
            }
          }
        }
      }
      if (change.default !== undefined) target.default = change.default;
      if (change.description !== undefined) target.description = change.description;
      // Checked once the whole file is applied: a default may be one of the file's own `sections`.
      if (change.values || change.default !== undefined) changed.push({ target, line: change.line });
    }

    if (f.sections.length > 0) {
      const target = props.find((p) => p.name === 'section' && p.module === f.name);
      if (!target || target.type !== 'enum') {
        ld.error('sections-unknown', f.file, `“sections” needs the module “${f.name}” to have an enum property called “section”`);
      } else {
        const values = [...(target.values ?? [])];
        for (const s of f.sections) {
          if (values.includes(s)) ld.error('section-duplicate', f.file, `Section “${s}” is already in the default list; the default wins, so remove it here`);
          else values.push(s);
        }
        target.values = values;
      }
    }
    for (const { target, line } of changed) {
      const bad = checkDefault(target, target.default, target.values);
      if (bad) ld.error('bad-default', f.file, `Property “${target.name}” for domain “${domain}”: ${bad}`, line);
    }

    for (const a of f.add) {
      if (props.some((p) => p.name === a.name)) {
        ld.error('add-exists', f.file, `Cannot add “${a.name}”: type “${base.name}” already has it. Use override to change it`, a.source.line);
        continue;
      }
      if (a.type === 'list' && a.items === 'term' && !(a.vocabulary && vocabularies.has(a.vocabulary))) {
        ld.error('vocabulary-unknown', f.file, `Added property “${a.name}”: ${a.vocabulary ? `unknown vocabulary “${a.vocabulary}”` : 'a list of terms needs a “vocabulary”'}`, a.source.line);
      }
      const bad = checkDefault(a, a.default, a.values);
      if (bad) ld.error('bad-default', f.file, `Added property “${a.name}”: ${bad}`, a.source.line);
      // Added properties go after the type's own, before any `position: end` property.
      const at = props.findIndex((p) => p.position === 'end');
      if (at < 0) props.push({ ...a });
      else props.splice(at, 0, { ...a });
    }
  }
  return { ...base, domain, properties: props, byName: new Map(props.map((p) => [p.name, p])) };
}

/**
 * A vocabulary plus a domain's terms. A term or synonym that is already a default term or synonym is an error and is
 * left out (the default wins). `prefixed` vocabularies (the ones a `track` property uses) need `<domain>-` terms.
 */
export function applyDomainToVocabulary(base: Vocabulary, domain: string, file: DomainVocabulary, ld: Reporter, prefixed: boolean): Vocabulary {
  const terms = [...base.terms];
  const lookup = new Map(base.lookup);
  for (const t of file.terms) {
    const line = file.lines.get(t.term);
    const words = [t.term, ...t.synonyms];
    const inDefault = words.find((w) => base.lookup.has(w.toLowerCase()));
    if (inDefault !== undefined) {
      ld.error('vocab-collision', file.file, `“${inDefault}” is already a term or synonym in the default “${base.name}” vocabulary (${base.file}). The default wins, so remove it here`, line);
      continue;
    }
    if (prefixed && !t.term.startsWith(prefixFor(domain))) {
      ld.error('domain-prefix', file.file, `Term “${t.term}” must start with “${prefixFor(domain)}”`, line);
    }
    const mine = words.find((w) => {
      const existing = lookup.get(w.toLowerCase());
      return existing !== undefined && existing !== t.term;
    });
    if (mine !== undefined) {
      ld.error('vocabulary-clash', file.file, `“${mine}” is used for both “${lookup.get(mine.toLowerCase()) ?? ''}” and “${t.term}”`, line);
      continue;
    }
    terms.push(t);
    for (const w of words) lookup.set(w.toLowerCase(), t.term);
  }
  return { ...base, domain, terms, lookup };
}

export interface DomainViolation {
  code: 'domain-prefix' | 'removed-property';
  property: string;
  message: string;
}

/**
 * Note-level rules the value checks cannot express: `section` and `track` values start with the note's own domain, and
 * a property the domain removed is not present. `base` is the default type, `effective` the one for the note's domain.
 */
export function domainViolations(base: ResolvedType, effective: ResolvedType, fm: Record<string, unknown>): DomainViolation[] {
  const out: DomainViolation[] = [];
  const domain = domainOf(fm);
  if (domain) {
    const prefix = prefixFor(domain);
    for (const name of PREFIXED_PROPERTIES) {
      if (!effective.byName.has(name)) continue;
      const v = fm[name];
      const items = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
      for (const item of items) {
        if (typeof item === 'string' && !item.startsWith(prefix)) {
          out.push({ code: 'domain-prefix', property: name, message: `${name} “${item}” does not start with “${prefix}”, the note’s domain.` });
        }
      }
    }
  }
  for (const key of Object.keys(fm)) {
    if (base.byName.has(key) && !effective.byName.has(key)) {
      out.push({ code: 'removed-property', property: key, message: `“${key}” is not allowed for domain “${domain ?? effective.domain ?? ''}”. It is present in the note.` });
    }
  }
  return out;
}
