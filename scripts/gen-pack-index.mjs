// Regenerate src/pack/index.ts from schema-pack/, so the embedded pack always lists every file.
//   node scripts/gen-pack-index.mjs
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ROOT } from './lib/paths.mjs';

const dir = join(ROOT, 'schema-pack');
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const rank = { registry: 0, modules: 1, vocabularies: 2, types: 3 };
const files = walk(dir)
  .map((p) => relative(dir, p).split(sep).join('/'))
  .filter((p) => p.endsWith('.yaml') || p === 'REFERENCE.md')
  .sort((a, b) => (rank[a.split('/')[0]] ?? 4) - (rank[b.split('/')[0]] ?? 4) || a.localeCompare(b));
const ident = (p) => {
  const parts = p.replace(/\.(yaml|md)$/, '').split(/[/_-]/);
  return parts[0] + parts.slice(1).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('');
};
const seen = new Set();
for (const p of files) {
  const i = ident(p);
  if (seen.has(i)) throw new Error(`two files give the same name ${i}: ${p}`);
  seen.add(i);
}
const text =
  '// The starter schema pack, embedded as text so a release needs only main.js, manifest.json and styles.css.\n' +
  '// Generated from schema-pack/ by scripts/gen-pack-index.mjs; do not edit by hand.\n' +
  files.map((p) => `import ${ident(p)} from '../../schema-pack/${p}';`).join('\n') +
  '\n\n/** Path inside the schema folder -> file text. */\nexport const STARTER_PACK: Readonly<Record<string, string>> = {\n' +
  files.map((p) => `  '${p}': ${ident(p)},`).join('\n') +
  '\n};\n';
writeFileSync(join(ROOT, 'src', 'pack', 'index.ts'), text);
console.log(`${files.length} files`);
