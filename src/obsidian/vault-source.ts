import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { SchemaFileSource } from '../core/schema-types';

/** Reads schema files straight through the adapter, so a hidden folder (.schema) works. */
export class VaultSchemaSource implements SchemaFileSource {
  constructor(
    private readonly app: App,
    private readonly folder: string,
  ) {}

  private full(path: string): string {
    return normalizePath(`${this.folder}/${path}`);
  }

  async read(path: string): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    const p = this.full(path);
    if (!(await adapter.exists(p))) return null;
    return adapter.read(p);
  }
}

/** Root-level folder names, including hidden ones, which the vault index does not list. */
export async function listRootFolders(app: App): Promise<string[]> {
  const listed = await app.vault.adapter.list('');
  return listed.folders.map((f) => f.split('/').pop() ?? f);
}

/** Cheap fingerprint of every file in a folder tree, used to notice edits to a hidden folder. */
export async function folderSignature(app: App, folder: string): Promise<string> {
  const adapter = app.vault.adapter;
  const parts: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let listed;
    try {
      listed = await adapter.list(dir);
    } catch {
      return;
    }
    for (const f of listed.files.sort()) {
      const st = await adapter.stat(f);
      parts.push(`${f}:${st?.mtime ?? 0}:${st?.size ?? 0}`);
    }
    for (const d of listed.folders.sort()) await walk(d);
  };
  await walk(normalizePath(folder));
  return parts.join('|');
}
