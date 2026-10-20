import { parseDocument } from 'yaml';
import { isMap } from 'yaml';
import type { Vocabulary } from './schema-types';

export interface TagReplacement {
  from: string;
  to: string;
}

export interface TagIssues {
  /** Synonyms (and case variants) to replace by the preferred term. */
  replacements: TagReplacement[];
  /** Tags the vocabulary does not know. */
  unknown: string[];
  /** The tag list after replacing synonyms and removing duplicates; unknown tags are kept. */
  normalised: string[];
}

function asList(values: unknown): string[] {
  if (Array.isArray(values)) return values.filter((v): v is string => typeof v === 'string');
  if (typeof values === 'string' && values.trim()) return [values];
  return [];
}

/** Rule 6: check a note's tags against the controlled vocabulary. */
export function checkTags(values: unknown, vocab: Vocabulary): TagIssues {
  const replacements: TagReplacement[] = [];
  const unknown: string[] = [];
  const normalised: string[] = [];
  for (const raw of asList(values)) {
    const tag = raw.replace(/^#/, '');
    const preferred = vocab.lookup.get(tag.toLowerCase());
    if (preferred === undefined) {
      if (!unknown.includes(tag)) unknown.push(tag);
      if (!normalised.includes(tag)) normalised.push(tag);
      continue;
    }
    if (preferred !== raw) replacements.push({ from: raw, to: preferred });
    if (!normalised.includes(preferred)) normalised.push(preferred);
  }
  return { replacements, unknown, normalised };
}

/** Add a preferred term to a vocabulary file, keeping its comments. Does nothing if it is already there. */
export function addVocabularyTerm(text: string, term: string): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error('Cannot edit a vocabulary with YAML errors');
  const terms = doc.get('terms', true);
  if (isMap(terms) && terms.has(term)) return text;
  doc.setIn(['terms', term], doc.createNode({}));
  return doc.toString();
}
