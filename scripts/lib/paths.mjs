import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEV = join(ROOT, 'dev');
export const SCRATCH = join(DEV, 'scratch');
export const PLUGIN_ID = 'vault-schema';

export function obsidianBinary() {
  if (process.env.OBSIDIAN_BIN) return process.env.OBSIDIAN_BIN;
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Obsidian.app/Contents/MacOS/Obsidian']
      : process.platform === 'win32'
        ? [
            join(process.env.LOCALAPPDATA ?? '', 'Obsidian', 'Obsidian.exe'),
            join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Obsidian', 'Obsidian.exe'),
          ]
        : ['/usr/bin/obsidian', '/opt/Obsidian/obsidian'];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('Obsidian not found. Set OBSIDIAN_BIN to the executable path.');
  return found;
}
