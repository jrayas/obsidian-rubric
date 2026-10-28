import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, makeZip, readZip } from '../src/core/zip';

const enc = new TextEncoder();
const when = new Date(2026, 9, 28, 15, 40, 12);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('makeZip', () => {
  const entries = [
    { path: '_schema/registry/types.yaml', data: enc.encode('format: 1\n') },
    { path: '_schema/types/kb.yaml', data: enc.encode('type: kb\nnote: ünïcode ✓\r\n') },
    { path: '_schema/empty.md', data: new Uint8Array() },
  ];

  it('round-trips names and bytes', () => {
    const back = readZip(makeZip(entries, when));
    expect(back.map((e) => e.path)).toEqual(entries.map((e) => e.path));
    back.forEach((e, i) => expect([...e.data]).toEqual([...(entries[i] as { data: Uint8Array }).data]));
  });

  it('makes a valid empty zip', () => {
    expect(readZip(makeZip([], when))).toEqual([]);
  });

  it('notices a damaged file', () => {
    const bytes = makeZip(entries, when);
    const firstData = 30 + enc.encode((entries[0] as { path: string }).path).length; // the first byte of the first file
    bytes[firstData] = (bytes[firstData] as number) ^ 0xff;
    expect(() => readZip(bytes)).toThrow(/Damaged/);
    expect(() => readZip(new Uint8Array(10))).toThrow(/Not a zip/);
  });

  it('is a zip that the system tool accepts, with the right names and contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rubric-zip-'));
    try {
      const file = join(dir, 'x.zip');
      writeFileSync(file, makeZip(entries, when));
      const test = spawnSync('unzip', ['-tq', file], { encoding: 'utf8' });
      if (test.error) return; // no unzip on this machine: the round trip above still ran
      expect(test.status, test.stdout + test.stderr).toBe(0);
      const list = spawnSync('unzip', ['-Z1', file], { encoding: 'utf8' }).stdout.trim().split('\n');
      expect(list).toEqual(entries.map((e) => e.path));
      const one = spawnSync('unzip', ['-p', file, '_schema/types/kb.yaml'], { encoding: 'utf8' }).stdout;
      expect(one).toBe('type: kb\nnote: ünïcode ✓\r\n');
      expect(readFileSync(file).length).toBeGreaterThan(100);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
