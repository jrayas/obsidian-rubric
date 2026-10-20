import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { STARTER_PACK } from '../src/pack';
import { PACK_DIR, load } from './helpers/pack';

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('embedded starter pack', () => {
  it('contains every file in schema-pack/ with identical text', () => {
    const onDisk = new Map(walk(PACK_DIR).map((p) => [relative(PACK_DIR, p).split(sep).join('/'), readFileSync(p, 'utf8')]));
    expect(Object.keys(STARTER_PACK).sort()).toEqual([...onDisk.keys()].sort());
    for (const [path, text] of onDisk) expect(STARTER_PACK[path], path).toBe(text);
  });

  it('loads without problems from the embedded copy', async () => {
    const files = new Map(Object.entries(STARTER_PACK));
    const r = await load(files);
    expect(r.problems).toEqual([]);
    expect(r.pack?.typeNames).toHaveLength(8);
  });
});
