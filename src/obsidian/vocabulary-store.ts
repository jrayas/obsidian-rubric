import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { addVocabularyTerm } from '../core/tags';
import type { SchemaService } from './schema-service';

/**
 * The one-click "add to vocabulary" write. It touches a single vocabulary file, adds one term and keeps the
 * file's comments (decisions D-33: this extends the spec's list of files the plugin may write).
 */
export class VocabularyStore {
  constructor(
    private readonly app: App,
    private readonly schemas: SchemaService,
  ) {}

  async addTerm(vocabulary: string, term: string): Promise<void> {
    const file = this.schemas.pack?.vocabularies.get(vocabulary)?.file;
    if (!file) return;
    const path = normalizePath(`${this.schemas.folder}/${file}`);
    const text = await this.app.vault.adapter.read(path);
    const next = addVocabularyTerm(text, term);
    if (next !== text) await this.app.vault.adapter.write(path, next);
    await this.schemas.reload('change');
  }
}
