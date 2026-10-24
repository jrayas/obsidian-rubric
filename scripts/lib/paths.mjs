import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEV = join(ROOT, 'dev');
// The scratch vault and profile live in the system temp folder, not inside the project: a vault inside the project can end
// up registered in someone's everyday Obsidian, whose plugins then act on the test notes. Override with RUBRIC_SCRATCH.
export const SCRATCH = process.env.RUBRIC_SCRATCH ? resolve(process.env.RUBRIC_SCRATCH) : join(tmpdir(), 'rubric-scratch');
export const PLUGIN_ID = 'rubric';

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
