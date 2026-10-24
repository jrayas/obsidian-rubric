import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { loadSchemaPack } from '../../src/core/schema-loader';
import type { LoadResult, SchemaFileSource, SchemaPack } from '../../src/core/schema-types';

export const PACK_DIR = join(__dirname, '..', '..', 'schema-pack');
export const PLUGIN_VERSION = '0.1.0';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The shipped starter pack as a map of schema-folder-relative path -> text. */
export function packFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const p of walk(PACK_DIR)) {
    const rel = relative(PACK_DIR, p).split(sep).join('/');
    if (rel.endsWith('.yaml')) files.set(rel, readFileSync(p, 'utf8'));
  }
  return files;
}

export function memSource(files: Map<string, string>): SchemaFileSource {
  return {
    read: (path) => Promise.resolve(files.get(path) ?? null),
    list: (dir) => {
      const prefix = `${dir}/`;
      const names = [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map((k) => k.slice(prefix.length));
      return Promise.resolve(names);
    },
  };
}

export function load(files: Map<string, string>, pluginVersion = PLUGIN_VERSION): Promise<LoadResult> {
  return loadSchemaPack(memSource(files), { pluginVersion });
}

/** Load the shipped pack after applying text edits: { 'path': (text) => newText }. */
export async function loadWith(edits: Record<string, (text: string) => string> = {}, extra: Record<string, string> = {}): Promise<LoadResult> {
  const files = packFiles();
  for (const [path, fn] of Object.entries(edits)) {
    const text = files.get(path);
    if (text === undefined) throw new Error(`no such pack file ${path}`);
    files.set(path, fn(text));
  }
  for (const [path, text] of Object.entries(extra)) files.set(path, text);
  return load(files);
}

export async function loadPack(): Promise<SchemaPack> {
  const { pack, problems } = await load(packFiles());
  if (!pack) throw new Error('shipped pack failed to load: ' + JSON.stringify(problems));
  return pack;
}
