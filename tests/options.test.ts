import { beforeAll, describe, expect, it } from 'vitest';
import { applyPick, filterOptions, isLocked, lockNote, normaliseTerms, optionsFor } from '../src/core/options';
import type { OptionList } from '../src/core/options';
import type { PropertyDef, ResolvedType, SchemaPack } from '../src/core/schema-types';
import { loadPack } from './helpers/pack';

let pack: SchemaPack;
const type = (n: string) => pack.types.get(n) as ResolvedType;
const prop = (t: string, n: string) => type(t).byName.get(n) as PropertyDef;
beforeAll(async () => {
  pack = await loadPack();
});

describe('options come from the note’s own schema', () => {
  it('a task offers task statuses, a kb note offers kb statuses', () => {
    const task = optionsFor(prop('task', 'status'), 'todo', pack) as OptionList;
    const kb = optionsFor(prop('kb', 'status'), 'draft', pack) as OptionList;
    expect(task.items.map((i) => i.label)).toEqual(['todo', 'doing', 'waiting', 'done', 'cancelled']);
    expect(kb.items.map((i) => i.label)).toEqual(['draft', 'review', 'published', 'outdated', 'archived']);
    expect(task.mode).toBe('single');
  });

  it('ticks the current value', () => {
    const list = optionsFor(prop('kb', 'status'), 'review', pack) as OptionList;
    expect(list.items.filter((i) => i.checked).map((i) => i.label)).toEqual(['review']);
  });

  it('offers an integer range as single choice (priority 1 to 5) but not a wide one', () => {
    const p = optionsFor(prop('task', 'priority'), 2, pack) as OptionList;
    expect(p.items.map((i) => i.value)).toEqual([1, 2, 3, 4, 5]);
    expect(p.items.find((i) => i.checked)?.value).toBe(2);
    expect(optionsFor(prop('resource', 'progress_percent'), 10, pack)).toBeNull();
  });

  it('offers the controlled tags as multi-select and ticks the ones in the note', () => {
    const list = optionsFor(prop('kb', 'tags'), ['quantum', 'sop'], pack) as OptionList;
    expect(list.mode).toBe('multi');
    expect(list.items.filter((i) => i.checked).map((i) => i.label)).toEqual(['quantum', 'procedure']);
  });

  it('offers nothing for free text, dates and plain lists', () => {
    for (const [t, n] of [['kb', 'description'], ['task', 'due'], ['kb', 'keywords'], ['kb', 'aliases'], ['kb', 'source_url']] as const) {
      expect(optionsFor(prop(t, n), undefined, pack), `${t}.${n}`).toBeNull();
    }
  });

  it('marks links with a target so the caller can list those notes', () => {
    expect((optionsFor(prop('task', 'project'), undefined, pack) as OptionList).linkTarget).toBe('project');
    expect((optionsFor(prop('project', 'stakeholders'), [], pack) as OptionList).linkTarget).toBe('person');
    expect(optionsFor(prop('kb', 'parent'), undefined, pack)).toBeNull();
  });
});

describe('locked properties never open a list (rule: locked)', () => {
  for (const name of ['schema', 'id', 'breadcrumb', 'created', 'modified']) {
    it(`${name} is locked, has no options and says who manages it`, () => {
      const def = prop('kb', name);
      expect(isLocked(name, def)).toBe(true);
      expect(optionsFor(def, 'x', pack)).toBeNull();
      expect(lockNote(name, def)).toBeTruthy();
    });
  }

  it('archived_fields is locked even though no module declares it', () => {
    expect(isLocked('archived_fields', undefined)).toBe(true);
    expect(lockNote('archived_fields', undefined)).toContain('Never deleted');
  });

  it('breadcrumb names the breadcrumb plugin; the others name this plugin', () => {
    expect(lockNote('breadcrumb', prop('kb', 'breadcrumb'))).toContain('breadcrumb plugin');
    expect(lockNote('id', prop('kb', 'id'))).toContain('Rubric');
  });

  it('a normal property has no lock note', () => {
    expect(lockNote('status', prop('kb', 'status'))).toBeNull();
    expect(isLocked('status', prop('kb', 'status'))).toBe(false);
  });
});

describe('autocomplete', () => {
  const status = () => optionsFor(prop('kb', 'status'), 'draft', pack) as OptionList;
  const tags = () => optionsFor(prop('kb', 'tags'), [], pack) as OptionList;

  it('shows everything for an empty query', () => {
    expect(filterOptions(status(), '').map((f) => f.item.label)).toHaveLength(5);
  });

  it('matches by prefix, case-insensitively: "dr" -> draft', () => {
    expect(filterOptions(status(), 'DR').map((f) => f.item.label)).toEqual(['draft']);
  });

  it('puts prefix matches before substring matches', () => {
    expect(filterOptions(status(), 'a').map((f) => f.item.label)).toEqual(['archived', 'draft', 'outdated']);
  });

  it('resolves a synonym to its preferred term: "sop" -> procedure', () => {
    const r = filterOptions(tags(), 'sop');
    expect(r.map((f) => f.item.label)).toEqual(['procedure']);
    expect(r[0]?.viaSynonym).toBe('sop');
  });

  it('returns nothing for a word that matches no option', () => {
    expect(filterOptions(status(), 'zzz')).toEqual([]);
  });
});

describe('picking', () => {
  it('a single choice replaces the value', () => {
    const list = optionsFor(prop('kb', 'status'), 'draft', pack) as OptionList;
    expect(applyPick(prop('kb', 'status'), 'draft', list, 'review', pack)).toBe('review');
  });

  it('keeps the number type for an integer choice', () => {
    const list = optionsFor(prop('task', 'priority'), 3, pack) as OptionList;
    expect(applyPick(prop('task', 'priority'), 3, list, 1, pack)).toBe(1);
  });

  it('a multi choice ticks and unticks, keeping the others and normalising synonyms', () => {
    const def = prop('kb', 'tags');
    const list = optionsFor(def, ['quantum', 'sop'], pack) as OptionList;
    expect(applyPick(def, ['quantum', 'sop'], list, 'theory', pack)).toEqual(['quantum', 'procedure', 'theory']);
    expect(applyPick(def, ['quantum', 'sop'], list, 'procedure', pack)).toEqual(['quantum']);
    expect(applyPick(def, undefined, list, 'idea', pack)).toEqual(['idea']);
  });

  it('keeps tags the vocabulary does not know', () => {
    const def = prop('kb', 'tags');
    const list = optionsFor(def, ['mystery'], pack) as OptionList;
    expect(applyPick(def, ['mystery'], list, 'idea', pack)).toEqual(['mystery', 'idea']);
  });

  it('normaliseTerms replaces synonyms, drops duplicates and keeps order', () => {
    const vocab = pack.vocabularies.get('tags');
    expect(normaliseTerms(['sop', 'procedure', 'Quantum-Mechanics', 'x'], vocab)).toEqual(['procedure', 'quantum', 'x']);
  });
});
