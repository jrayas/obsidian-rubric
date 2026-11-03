import type { App } from 'obsidian';
import { writeVerified } from '../core/verified-write';

const pause = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Write a plugin-owned text file (schema, registry, vocabulary, preset) and check it was really saved.
 * Use this instead of `adapter.write` for those files; see `core/verified-write.ts` for why.
 */
export function writeText(app: App, path: string, text: string): Promise<number> {
  const adapter = app.vault.adapter;
  return writeVerified(
    { write: (p, t) => adapter.write(p, t), read: (p) => adapter.read(p) },
    path,
    text,
    pause,
  );
}
