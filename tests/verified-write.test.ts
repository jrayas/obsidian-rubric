import { describe, expect, it } from 'vitest';
import { WRITE_ATTEMPTS, retryDelayMs, writeVerified } from '../src/core/verified-write';
import type { TextFiles } from '../src/core/verified-write';

/** A file system that loses the first `lose` writes: the call succeeds but the file is left empty. */
function flaky(lose: number): TextFiles & { writes: number; files: Map<string, string> } {
  const files = new Map<string, string>();
  const fs = {
    writes: 0,
    files,
    async write(path: string, text: string) {
      fs.writes++;
      files.set(path, fs.writes <= lose ? '' : text);
    },
    async read(path: string) {
      const text = files.get(path);
      if (text === undefined) throw new Error('missing');
      return text;
    },
  };
  return fs;
}

const noWait = async (): Promise<void> => undefined;

describe('writeVerified', () => {
  it('writes once and reports no retries when the file is right', async () => {
    const fs = flaky(0);
    expect(await writeVerified(fs, 'a.yaml', 'module: a\n', noWait)).toBe(0);
    expect(fs.writes).toBe(1);
  });

  it('writes again when the first write left the file empty', async () => {
    const fs = flaky(1);
    expect(await writeVerified(fs, 'a.yaml', 'module: a\n', noWait)).toBe(1);
    expect(fs.files.get('a.yaml')).toBe('module: a\n');
  });

  it('recovers after several lost writes, up to the limit', async () => {
    const fs = flaky(WRITE_ATTEMPTS - 1);
    expect(await writeVerified(fs, 'a.yaml', 'x: 1\n', noWait)).toBe(WRITE_ATTEMPTS - 1);
    expect(fs.files.get('a.yaml')).toBe('x: 1\n');
  });

  it('throws, and says which file, when it never matches', async () => {
    const fs = flaky(100);
    await expect(writeVerified(fs, 'modules/review.yaml', 'x: 1\n', noWait)).rejects.toThrow(/modules\/review\.yaml/);
    expect(fs.writes).toBe(WRITE_ATTEMPTS);
  });

  it('treats a read that fails as a mismatch and tries again', async () => {
    const files = new Map<string, string>();
    let reads = 0;
    const fs: TextFiles = {
      async write(path, text) {
        files.set(path, text);
      },
      async read(path) {
        if (++reads === 1) throw new Error('not ready');
        return files.get(path) ?? '';
      },
    };
    expect(await writeVerified(fs, 'a.yaml', 'x: 1\n', noWait)).toBe(1);
  });

  it('waits a little longer before each new try', async () => {
    const waits: number[] = [];
    await writeVerified(flaky(2), 'a.yaml', 'x: 1\n', async (ms) => void waits.push(ms));
    expect(waits).toEqual([retryDelayMs(1), retryDelayMs(2)]);
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
  });

  it('keeps text exactly, including CRLF and a missing final newline', async () => {
    const fs = flaky(0);
    await writeVerified(fs, 'a.yaml', 'a: 1\r\nb: 2', noWait);
    expect(fs.files.get('a.yaml')).toBe('a: 1\r\nb: 2');
  });
});
