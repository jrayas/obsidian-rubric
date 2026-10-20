import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Vocabulary } from '../src/core/schema-types';
import { addVocabularyTerm, checkTags } from '../src/core/tags';
import { loadPack, packFiles } from './helpers/pack';

let vocab: Vocabulary;
beforeAll(async () => {
  vocab = (await loadPack()).vocabularies.get('tags') as Vocabulary;
});

describe('tags (rule 6)', () => {
  it('replaces a synonym by its preferred term, showing old and new', () => {
    const r = checkTags(['sop', 'quantum'], vocab);
    expect(r.replacements).toEqual([{ from: 'sop', to: 'procedure' }]);
    expect(r.normalised).toEqual(['procedure', 'quantum']);
    expect(r.unknown).toEqual([]);
  });

  it('treats a case variant as a replacement too', () => {
    expect(checkTags(['Quantum'], vocab).replacements).toEqual([{ from: 'Quantum', to: 'quantum' }]);
  });

  it('flags an unknown tag, keeps it in the normalised list and does not replace it', () => {
    const r = checkTags(['mystery', 'idea'], vocab);
    expect(r.unknown).toEqual(['mystery']);
    expect(r.replacements).toEqual([]);
    expect(r.normalised).toEqual(['mystery', 'idea']);
  });

  it('drops duplicates that appear once synonyms are resolved', () => {
    expect(checkTags(['sop', 'procedure', 'standard-operating-procedure'], vocab).normalised).toEqual(['procedure']);
  });

  it('accepts a single string, a leading # and a missing value', () => {
    expect(checkTags('sop', vocab).normalised).toEqual(['procedure']);
    expect(checkTags(['#idea'], vocab).replacements).toEqual([{ from: '#idea', to: 'idea' }]);
    expect(checkTags(undefined, vocab)).toEqual({ replacements: [], unknown: [], normalised: [] });
  });

  it('adds a term to the vocabulary file in one step, keeping comments, once', () => {
    const text = packFiles().get('vocabularies/tags.yaml') as string;
    const out = addVocabularyTerm(text, 'mystery');
    expect(out).toContain('# Controlled tags.');
    expect((parse(out) as { terms: Record<string, unknown> }).terms).toHaveProperty('mystery');
    expect(addVocabularyTerm(out, 'mystery')).toBe(out);
  });
});
