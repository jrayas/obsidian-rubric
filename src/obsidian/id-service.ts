import type { App } from 'obsidian';
import { nextId } from '../core/ids';
import { UNIQUE_ID, nextUniqueId } from '../core/unique-id';
import type { RubricSettings } from '../settings';

/**
 * Allocates readable IDs. There is no counter file: the next number is worked out from the notes
 * themselves (rule 4). Allocations are serialised and remembered so two notes created at once never
 * get the same number.
 */
export class IdService {
  private readonly reserved = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => RubricSettings,
  ) {}

  /** Every ID in the vault right now. */
  usedIds(): string[] {
    const ids: string[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const id = this.app.metadataCache.getFileCache(f)?.frontmatter?.id as unknown;
      if (typeof id === 'string') ids.push(id);
    }
    return ids;
  }

  /** Every `unique_id` in the vault right now. */
  usedUniqueIds(): string[] {
    const ids: string[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const id = this.app.metadataCache.getFileCache(f)?.frontmatter?.[UNIQUE_ID] as unknown;
      if (typeof id === 'string') ids.push(id);
    }
    return ids;
  }

  /** The next unique ID for a type, domain and year (reserved until used or released, like `allocate`). */
  allocateUnique(typePrefix: string, domainPrefix: string, year: number): string {
    const id = nextUniqueId(typePrefix, domainPrefix, year, [...this.usedUniqueIds(), ...this.reserved], this.getSettings().retiredIds);
    this.reserved.add(id);
    return id;
  }

  /** Synchronous allocation (the cache and the reservation set are in memory, so no await is needed). */
  allocate(prefix: string, year: number): string {
    const id = nextId(prefix, year, [...this.usedIds(), ...this.reserved], this.getSettings().retiredIds);
    this.reserved.add(id);
    return id;
  }

  /** Release a reservation that was not used (the user cancelled the preview). */
  release(id: string): void {
    this.reserved.delete(id);
  }

  /** Run `fn` after every earlier allocation sequence has finished. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
