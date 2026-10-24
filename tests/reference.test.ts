import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SchemaPack } from '../src/core/schema-types';
import { SHIPPED_DIR, load, shippedFiles } from './helpers/pack';

const ROOT = join(__dirname, '..');
const reference = readFileSync(join(SHIPPED_DIR, 'REFERENCE.md'), 'utf8');
let pack: SchemaPack;
beforeAll(async () => {
  pack = (await load(shippedFiles())).pack as SchemaPack;
});

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const has = (word: string) => reference.includes(`\`${word}\``);

describe('REFERENCE.md covers the pack', () => {
  it('names every type, module, vocabulary, domain and domain prefix', () => {
    for (const t of pack.typeNames) expect(has(t), `type ${t}`).toBe(true);
    for (const m of pack.modules.keys()) expect(has(m), `module ${m}`).toBe(true);
    for (const v of pack.vocabularies.keys()) expect(has(v), `vocabulary ${v}`).toBe(true);
    for (const d of pack.domains) expect(has(d), `domain ${d}`).toBe(true);
    for (const p of Object.values(pack.types.get('kb')?.byName.get('domain')?.prefixes ?? {})) expect(reference.includes(p), `prefix ${p}`).toBe(true);
  });

  it('names every property of every type, including the ones a domain adds', () => {
    const names = new Set<string>();
    for (const t of [...pack.types.values(), ...pack.effectiveTypes.values()]) for (const p of t.properties) names.add(p.name);
    for (const n of names) expect(has(n), `property ${n}`).toBe(true);
  });

  it('names every override file of the pack', () => {
    for (const b of pack.domainFiles.values()) {
      for (const f of [...b.types.values(), ...b.modules.values()]) expect(reference.includes(f.file), f.file).toBe(true);
      for (const f of b.vocabularies.values()) expect(reference.includes(f.file), f.file).toBe(true);
    }
  });

  it('describes every property attribute the loader accepts', () => {
    const src = read('src/core/loader-base.ts');
    const block = /PROPERTY_KEYS = new Set\(\[([\s\S]*?)\]\);/.exec(src)?.[1] ?? '';
    const attrs = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
    expect(attrs.length).toBeGreaterThan(15);
    for (const a of attrs) expect(reference.includes(`\`${a}\``), `attribute ${a}`).toBe(true);
  });
});

describe('REFERENCE.md lists every code', () => {
  it('every schema problem code the loaders can report', () => {
    const codes = new Set<string>();
    for (const f of ['src/core/loader-base.ts', 'src/core/schema-loader.ts', 'src/core/domain-loader.ts', 'src/core/domain-overrides.ts']) {
      for (const m of read(f).matchAll(/\b(?:error|warn)\(\s*'([a-z-]+)'/g)) codes.add(m[1] as string);
    }
    expect(codes.size).toBeGreaterThan(40);
    for (const c of codes) expect(reference.includes(`\`${c}\``), `problem code ${c}`).toBe(true);
  });

  it('every vault check code', () => {
    const src = read('src/core/note-check.ts');
    const codes = new Set<string>();
    for (const m of src.matchAll(/add\(\d+,\s*'([a-z-]+)'/g)) codes.add(m[1] as string);
    for (const m of src.matchAll(/code: '([a-z-]+)'/g)) codes.add(m[1] as string);
    for (const m of read('src/core/domain-overrides.ts').matchAll(/code: '([a-z-]+)'/g)) codes.add(m[1] as string);
    for (const c of ['enum', 'type', 'min', 'max', 'pattern', 'format', 'link', 'heading']) codes.add(`value-${c}`);
    for (const c of codes) expect(reference.includes(`\`${c}\``), `check code ${c}`).toBe(true);
  });
});
