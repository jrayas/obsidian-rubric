import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

// The generated pack index only embeds text files.
const FILES = walk(SRC).filter((f) => !f.endsWith(`${sep}pack${sep}index.ts`));
const imports = (text: string) => [...text.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);

describe('the plugin can load on a phone or tablet (isDesktopOnly is false)', () => {
  it('finds the source files', () => {
    expect(FILES.length).toBeGreaterThan(40);
  });

  it.each(FILES.map((f) => [relative(SRC, f).split(sep).join('/'), f] as const))('%s uses no Node or Electron API', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    for (const spec of imports(text)) {
      expect(spec, `imports ${spec}`).not.toMatch(/^(node:|electron$)/);
      expect(builtinModules.includes(spec), `imports the Node module ${spec}`).toBe(false);
    }
    expect(text).not.toMatch(/\belectron\b/i);
    expect(text).not.toMatch(/window\.require|\brequire\(|\bBuffer\b|\bprocess\.(env|platform|cwd|versions)/);
  });

  it('the manifest says it runs on mobile', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8')) as { isDesktopOnly: boolean };
    expect(manifest.isDesktopOnly).toBe(false);
  });
});
