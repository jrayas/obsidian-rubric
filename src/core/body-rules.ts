/**
 * The rules of a body module: what happens in a note's body, described in YAML the way properties are.
 *
 *   module: body
 *   sections:                      # by heading
 *     - heading: Captures
 *       level: 2                   # optional
 *       starter: "- {{time:HH:mm}} "   # what a new note has under it
 *       keys:
 *         Enter: { insert: "- {{time:HH:mm}} " }
 *   default:                       # anywhere else in the body
 *     keys:
 *       Enter: { insert: "- {{time:HH:mm}} " }
 *
 * Pure: no Obsidian types. The loader reads these from a module file and from a type's own `body:` block, and
 * `mergeBodyRules` puts them together.
 */
import { isObj, show } from './loader-base';
import type { Loader, Obj } from './loader-base';
import { validateTemplate } from './template';
import type { YamlFile } from './yaml-file';

/** The keys a rule can be written for. Deleting keys are not offered. */
export const RULE_KEYS = ['Enter', 'Tab', 'Shift-Tab'] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export interface KeyRule {
  /** Text with `{{ }}` placeholders. Enter starts a new line with it; Tab and Shift-Tab put it at the cursor. */
  insert?: string;
  /** Start a new line before the text. Default: true for Enter, false for Tab and Shift-Tab. */
  newline?: boolean;
  /** Leave the key to Obsidian here, even if `default` has a rule for it. */
  pass?: boolean;
}

export type KeyRules = Partial<Record<RuleKey, KeyRule>>;

export interface BodySection {
  heading: string;
  /** Heading level 1 to 6. Absent: any level. */
  level?: number;
  /** What a new note has under the heading. Text with `{{ }}` placeholders. */
  starter?: string;
  /** Include the heading in new notes. Default true. */
  scaffold: boolean;
  keys: KeyRules;
}

export interface BodyRules {
  sections: BodySection[];
  default: KeyRules;
}

export const emptyRules = (): BodyRules => ({ sections: [], default: {} });

export function hasRules(r: BodyRules | null | undefined): r is BodyRules {
  return !!r && (r.sections.length > 0 || Object.keys(r.default).length > 0);
}

const SECTION_KEYS = new Set(['heading', 'level', 'starter', 'scaffold', 'keys']);
const RULE_FIELDS = new Set(['insert', 'newline', 'pass']);
const GROUP_KEYS = new Set(['keys']);

type Path = (string | number)[];

function parseKeyRules(ld: Loader, yf: YamlFile, raw: unknown, path: Path): KeyRules {
  const out: KeyRules = {};
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) {
    ld.error('body-shape', yf.path, `"keys" must be a map such as { Enter: { insert: "- {{time}} " } } (found ${show(raw)})`, yf.lineOf(path));
    return out;
  }
  for (const [name, rule] of Object.entries(raw)) {
    const where = [...path, name];
    if (!(RULE_KEYS as readonly string[]).includes(name)) {
      ld.error('body-shape', yf.path, `Unknown key "${name}" under "keys" (known: ${RULE_KEYS.join(', ')})`, yf.lineOf(where));
      continue;
    }
    if (!isObj(rule)) {
      ld.error('body-shape', yf.path, `The rule for ${name} must be a map such as { insert: "- {{time}} " } (found ${show(rule)})`, yf.lineOf(where));
      continue;
    }
    const keyRule: KeyRule = {};
    for (const field of Object.keys(rule)) {
      if (!RULE_FIELDS.has(field)) {
        ld.warn('body-unknown-key', yf.path, `Unknown key "${field}" in the rule for ${name} (it has no effect; known keys: ${[...RULE_FIELDS].join(', ')})`, yf.lineOf([...where, field]));
      }
    }
    if (rule.insert !== undefined && rule.insert !== null) {
      if (typeof rule.insert !== 'string') {
        ld.error('body-shape', yf.path, `"insert" must be text (found ${show(rule.insert)})`, yf.lineOf([...where, 'insert']));
      } else {
        keyRule.insert = rule.insert;
        for (const problem of validateTemplate(rule.insert)) ld.error('body-formula', yf.path, problem, yf.lineOf([...where, 'insert']));
      }
    }
    for (const flag of ['newline', 'pass'] as const) {
      const value = rule[flag];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'boolean') ld.error('body-shape', yf.path, `"${flag}" must be true or false (found ${show(value)})`, yf.lineOf([...where, flag]));
      else keyRule[flag] = value;
    }
    if (keyRule.insert === undefined && keyRule.pass === undefined) {
      ld.warn('body-unknown-key', yf.path, `The rule for ${name} has neither "insert" nor "pass", so it does nothing`, yf.lineOf(where));
    }
    out[name as RuleKey] = keyRule;
  }
  return out;
}

function parseGroup(ld: Loader, yf: YamlFile, raw: unknown, path: Path): KeyRules {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) {
    ld.error('body-shape', yf.path, `"default" must be a map such as { keys: { Enter: { insert: "- {{time}} " } } } (found ${show(raw)})`, yf.lineOf(path));
    return {};
  }
  for (const key of Object.keys(raw)) {
    if (!GROUP_KEYS.has(key)) ld.warn('body-unknown-key', yf.path, `Unknown key "${key}" under "default" (it has no effect; known keys: keys)`, yf.lineOf([...path, key]));
  }
  return parseKeyRules(ld, yf, raw.keys, [...path, 'keys']);
}

/** Read `sections` and `default` from a map: a body module file, or the `body:` block of a type file. */
export function parseBodyRules(ld: Loader, yf: YamlFile, data: Obj, base: Path): BodyRules {
  const rules = emptyRules();
  const rawSections = data.sections;
  if (rawSections !== undefined && rawSections !== null) {
    if (!Array.isArray(rawSections)) {
      ld.error('body-shape', yf.path, `"sections" must be a list of sections, each starting "- heading: ..." (found ${show(rawSections)})`, yf.lineOf([...base, 'sections']));
    } else {
      rawSections.forEach((item: unknown, index: number) => {
        const path = [...base, 'sections', index];
        if (!isObj(item)) {
          ld.error('body-shape', yf.path, `Each section must be a map with a "heading" (found ${show(item)})`, yf.lineOf(path));
          return;
        }
        if (typeof item.heading !== 'string' || item.heading.trim() === '') {
          ld.error('body-shape', yf.path, 'A section needs a "heading": the text of the heading, without the # marks', yf.lineOf(path));
          return;
        }
        for (const key of Object.keys(item)) {
          if (!SECTION_KEYS.has(key)) {
            ld.warn('body-unknown-key', yf.path, `Unknown key "${key}" in the "${item.heading}" section (it has no effect; known keys: ${[...SECTION_KEYS].join(', ')})`, yf.lineOf([...path, key]));
          }
        }
        const section: BodySection = { heading: item.heading.trim(), scaffold: true, keys: {} };
        if (item.level !== undefined && item.level !== null) {
          if (typeof item.level !== 'number' || !Number.isInteger(item.level) || item.level < 1 || item.level > 6) {
            ld.error('body-shape', yf.path, `"level" must be a whole number from 1 to 6 (found ${show(item.level)})`, yf.lineOf([...path, 'level']));
          } else section.level = item.level;
        }
        if (item.starter !== undefined && item.starter !== null) {
          if (typeof item.starter !== 'string') {
            ld.error('body-shape', yf.path, `"starter" must be text (found ${show(item.starter)})`, yf.lineOf([...path, 'starter']));
          } else {
            section.starter = item.starter;
            for (const problem of validateTemplate(item.starter)) ld.error('body-formula', yf.path, problem, yf.lineOf([...path, 'starter']));
          }
        }
        if (item.scaffold !== undefined && item.scaffold !== null) {
          if (typeof item.scaffold !== 'boolean') ld.error('body-shape', yf.path, `"scaffold" must be true or false (found ${show(item.scaffold)})`, yf.lineOf([...path, 'scaffold']));
          else section.scaffold = item.scaffold;
        }
        section.keys = parseKeyRules(ld, yf, item.keys, [...path, 'keys']);
        if (rules.sections.some((s) => sameSection(s, section))) {
          ld.warn('body-unknown-key', yf.path, `The "${section.heading}" section is listed twice; the later one replaces the earlier`, yf.lineOf(path));
          rules.sections = rules.sections.filter((s) => !sameSection(s, section));
        }
        rules.sections.push(section);
      });
    }
  }
  rules.default = parseGroup(ld, yf, data.default, [...base, 'default']);
  return rules;
}

export const sameHeading = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function sameSection(a: BodySection, b: BodySection): boolean {
  return sameHeading(a.heading, b.heading) && a.level === b.level;
}

function mergeKeys(base: KeyRules, over: KeyRules): KeyRules {
  const out: KeyRules = { ...base };
  for (const key of RULE_KEYS) {
    const rule = over[key];
    if (rule) out[key] = rule;
  }
  return out;
}

/**
 * Put rules together, later over earlier: a section with the same heading (and level) is changed key by key and
 * keeps its place; a new heading goes on the end; each key of `default` is replaced by the later rule.
 */
export function mergeBodyRules(base: BodyRules, over: BodyRules): BodyRules {
  const sections = base.sections.map((s) => ({ ...s, keys: { ...s.keys } }));
  for (const next of over.sections) {
    const at = sections.findIndex((s) => sameSection(s, next));
    const current = sections[at];
    if (current) {
      sections[at] = {
        heading: current.heading,
        ...(next.level !== undefined ? { level: next.level } : current.level !== undefined ? { level: current.level } : {}),
        ...(next.starter !== undefined ? { starter: next.starter } : current.starter !== undefined ? { starter: current.starter } : {}),
        scaffold: next.scaffold,
        keys: mergeKeys(current.keys, next.keys),
      };
    } else sections.push({ ...next, keys: { ...next.keys } });
  }
  return { sections, default: mergeKeys(base.default, over.default) };
}

/** The section a heading belongs to, if the rules list it. */
export function sectionFor(rules: BodyRules, heading: string, level: number): BodySection | undefined {
  return rules.sections.find((s) => sameHeading(s.heading, heading) && (s.level === undefined || s.level === level));
}

/** The rule for a key at a place: the section that matches the heading, else `default`. */
export function ruleFor(rules: BodyRules, key: RuleKey, section: { text: string; level: number } | null): KeyRule | undefined {
  const matched = section ? sectionFor(rules, section.text, section.level) : undefined;
  return matched?.keys[key] ?? rules.default[key];
}
