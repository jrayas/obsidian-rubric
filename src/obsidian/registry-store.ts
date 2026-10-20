import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import {
  addScopeFolder,
  removeFolderMapping,
  removeScopeFolder,
  setFolderMapping,
  setMatchingMode,
  setScopeMode,
} from '../core/registry-edit';
import type { MatchingMode, ScopeMode } from '../core/schema-types';
import type { SchemaService } from './schema-service';

/**
 * The only writer of schema files. It may change registry/folders.yaml and registry/scope.yaml,
 * keeping their comments, and nothing else in the schema folder.
 */
export class RegistryStore {
  constructor(
    private readonly app: App,
    private readonly schemas: SchemaService,
  ) {}

  private async edit(rel: 'registry/folders.yaml' | 'registry/scope.yaml', fn: (text: string) => string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = normalizePath(`${this.schemas.folder}/${rel}`);
    const text = (await adapter.exists(path)) ? await adapter.read(path) : '';
    const next = fn(text);
    if (next !== text) {
      const dir = path.split('/').slice(0, -1).join('/');
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      await adapter.write(path, next);
    }
    await this.schemas.reload('change');
  }

  setMapping(folder: string, type: string): Promise<void> {
    return this.edit('registry/folders.yaml', (t) => setFolderMapping(t, folder, type));
  }

  removeMapping(folder: string): Promise<void> {
    return this.edit('registry/folders.yaml', (t) => removeFolderMapping(t, folder));
  }

  setMatchingMode(mode: MatchingMode): Promise<void> {
    return this.edit('registry/folders.yaml', (t) => setMatchingMode(t, mode));
  }

  setScopeMode(mode: ScopeMode): Promise<void> {
    return this.edit('registry/scope.yaml', (t) => setScopeMode(t, mode));
  }

  addScopeFolder(list: 'exclude' | 'include', folder: string): Promise<void> {
    return this.edit('registry/scope.yaml', (t) => addScopeFolder(t, list, folder));
  }

  removeScopeFolder(list: 'exclude' | 'include', folder: string): Promise<void> {
    return this.edit('registry/scope.yaml', (t) => removeScopeFolder(t, list, folder));
  }
}
