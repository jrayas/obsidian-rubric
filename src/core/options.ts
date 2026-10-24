import { ARCHIVED_FIELDS, LOCKED_NAMES } from './schema-types';
import { vocabFor } from './domain-overrides';
import type { PropertyDef, SchemaPack, Vocabulary } from './schema-types';

export type OptionValue = string | number | boolean;

export interface OptionItem {
  value: OptionValue;
  label: string;
  checked: boolean;
  /** Words that resolve to this option (tag synonyms). */
  synonyms: string[];
}

export interface OptionList {
  property: string;
  mode: 'single' | 'multi';
  items: OptionItem[];
  /** Links limited to notes of this type; the caller supplies the items. */
  linkTarget?: string;
}

/** Largest integer range that is offered as a list (priority 1 to 5 yes, percent 0 to 100 no). */
export const MAX_INTEGER_OPTIONS = 20;

export function isLocked(name: string, def: PropertyDef | undefined): boolean {
  return (def?.locked ?? false) || (LOCKED_NAMES as readonly string[]).includes(name);
}

/** Short note saying who manages a locked property, or null when it is not locked. */
export function lockNote(name: string, def: PropertyDef | undefined): string | null {
  if (!isLocked(name, def)) return null;
  if (def?.managedBy === 'external' || name === 'breadcrumb') {
    return 'Written by your breadcrumb plugin. This plugin only reads it.';
  }
  if (name === ARCHIVED_FIELDS) return 'Kept by Rubric: values from an earlier type. Never deleted.';
  return 'Set automatically by Rubric and locked.';
}

function currentList(current: unknown): string[] {
  if (Array.isArray(current)) return current.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  if (typeof current === 'string' && current.length > 0) return [current];
  return [];
}

/** Resolve each word to its preferred term; unknown words are kept as they are. */
export function normaliseTerms(values: string[], vocab: Vocabulary | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const preferred = vocab?.lookup.get(v.toLowerCase()) ?? v;
    if (!seen.has(preferred)) {
      seen.add(preferred);
      out.push(preferred);
    }
  }
  return out;
}

/**
 * The values a property offers, from the note's own schema. Null when the property is locked or has
 * no fixed list (free text, dates, links without a target).
 */
export function optionsFor(def: PropertyDef, current: unknown, pack: SchemaPack, domain?: string): OptionList | null {
  if (isLocked(def.name, def)) return null;
  const item = (value: OptionValue, checked: boolean, synonyms: string[] = []): OptionItem => ({
    value,
    label: String(value),
    checked,
    synonyms,
  });

  switch (def.type) {
    case 'enum':
      return { property: def.name, mode: 'single', items: (def.values ?? []).map((v) => item(v, current === v)) };
    case 'boolean':
      return { property: def.name, mode: 'single', items: [true, false].map((v) => item(v, current === v)) };
    case 'integer': {
      if (def.min === undefined || def.max === undefined || def.max - def.min >= MAX_INTEGER_OPTIONS) return null;
      const items: OptionItem[] = [];
      for (let n = def.min; n <= def.max; n++) items.push(item(n, current === n));
      return { property: def.name, mode: 'single', items };
    }
    case 'link':
      return def.target ? { property: def.name, mode: 'single', items: [], linkTarget: def.target } : null;
    case 'list': {
      if (def.items === 'term') {
        const vocab = def.vocabulary ? vocabFor(pack, def.vocabulary, domain) : undefined;
        if (!vocab) return null;
        const have = new Set(normaliseTerms(currentList(current), vocab));
        return {
          property: def.name,
          mode: 'multi',
          items: vocab.terms.map((t) => item(t.term, have.has(t.term), t.synonyms)),
        };
      }
      if (def.items === 'link' && def.target) return { property: def.name, mode: 'multi', items: [], linkTarget: def.target };
      return null;
    }
    default:
      return null;
  }
}

export interface FilteredItem {
  item: OptionItem;
  /** The synonym that matched, when the query was a synonym of this option. */
  viaSynonym?: string;
}

/** Autocomplete: prefix matches first, then substring matches; synonyms resolve to the preferred option. */
export function filterOptions(list: OptionList, query: string): FilteredItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.items.map((item) => ({ item }));
  const prefix: FilteredItem[] = [];
  const contains: FilteredItem[] = [];
  for (const item of list.items) {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) prefix.push({ item });
    else if (label.includes(q)) contains.push({ item });
    else {
      const syn = item.synonyms.find((s) => s.toLowerCase().startsWith(q));
      if (syn) prefix.push({ item, viaSynonym: syn });
      else {
        const inner = item.synonyms.find((s) => s.toLowerCase().includes(q));
        if (inner) contains.push({ item, viaSynonym: inner });
      }
    }
  }
  return [...prefix, ...contains];
}

/** The new value after the user picks (single) or toggles (multi) an option. */
export function applyPick(def: PropertyDef, current: unknown, list: OptionList, value: OptionValue, pack: SchemaPack, domain?: string): unknown {
  if (list.mode === 'single') return value;
  const vocab = def.vocabulary ? vocabFor(pack, def.vocabulary, domain) : undefined;
  const existing = normaliseTerms(currentList(current), vocab);
  const word = String(value);
  return existing.includes(word) ? existing.filter((v) => v !== word) : [...existing, word];
}
