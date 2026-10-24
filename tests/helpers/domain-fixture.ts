import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { LoadResult } from '../../src/core/schema-types';
import { load } from './pack';

export const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'domain-vault');
const SCHEMA_DIR = join(FIXTURE_DIR, '_schema');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The fixture's schema folder as a map of schema-relative path -> text. */
export function fixtureFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const p of walk(SCHEMA_DIR)) files.set(relative(SCHEMA_DIR, p).split(sep).join('/'), readFileSync(p, 'utf8'));
  return files;
}

/** Load the fixture after text edits and extra or replaced files ({ path: text }); `null` removes a file. */
export function loadFixture(edits: Record<string, (text: string) => string> = {}, extra: Record<string, string | null> = {}): Promise<LoadResult> {
  const files = fixtureFiles();
  for (const [path, fn] of Object.entries(edits)) {
    const text = files.get(path);
    if (text === undefined) throw new Error(`no such fixture file ${path}`);
    files.set(path, fn(text));
  }
  for (const [path, text] of Object.entries(extra)) {
    if (text === null) files.delete(path);
    else files.set(path, text);
  }
  return load(files);
}
