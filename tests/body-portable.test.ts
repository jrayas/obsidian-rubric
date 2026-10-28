import { readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const CORE = ['note-text.ts', 'note-sections.ts', 'body-edit.ts', 'body-config.ts', 'body-gate.ts', 'body-service.ts', 'body-handlers.ts', 'body-report.ts'].map((f) => `src/core/${f}`);
const ADAPTERS = readdirSync(join(ROOT, 'src', 'obsidian'))
  .filter((f) => f.startsWith('body-'))
  .map((f) => `src/obsidian/${f}`);

const imports = (file: string) => [...readFileSync(join(ROOT, file), 'utf8').matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);

describe('the body access layer can run on mobile later', () => {
  it('finds the files it is meant to check', () => {
    expect(ADAPTERS.sort()).toEqual(['src/obsidian/body-access.ts', 'src/obsidian/body-demo.ts', 'src/obsidian/body-editor.ts']);
  });

  it.each([...CORE, ...ADAPTERS])('%s imports nothing desktop-only', (file) => {
    for (const spec of imports(file)) {
      expect(spec, `${file} imports ${spec}`).not.toMatch(/^(node:|electron$)/);
      expect(builtinModules.includes(spec), `${file} imports the Node module ${spec}`).toBe(false);
      expect(spec, `${file} reaches into the Properties-area internals`).not.toMatch(/properties-layer/);
    }
    const text = readFileSync(join(ROOT, file), 'utf8');
    expect(text, `${file} uses a Node-only global`).not.toMatch(/\bBuffer\b|\bprocess\.(env|platform|cwd)|\brequire\(/);
  });

  it.each(CORE)('%s (pure core) does not import obsidian or CodeMirror', (file) => {
    for (const spec of imports(file)) expect(spec, `${file} imports ${spec}`).not.toMatch(/^(obsidian|@codemirror\/)/);
  });
});
