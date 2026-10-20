// Start an isolated Obsidian (own profile, scratch vault, CDP on localhost).
// Usage: npm run debug:launch [-- --release] [-- --template <dir>] [-- --empty]
//   default  : scratch vault copied from dev/testvault, plugin files copied from the repo root
//   --empty  : scratch vault with no template
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, ROOT, SCRATCH, PLUGIN_ID, obsidianBinary } from './lib/paths.mjs';
import { PORT, connect, evaluate, pickTarget, sleep } from './lib/cdp.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

try {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
  if (r.ok) {
    console.error(`Port ${PORT} is already in use. Run "npm run debug -- stop" first.`);
    process.exit(1);
  }
} catch {
  /* port free */
}

const vault = join(SCRATCH, 'vault');
const profile = join(SCRATCH, 'profile');
rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(vault, { recursive: true });
mkdirSync(profile, { recursive: true });

const template = arg('--template') ?? join(DEV, 'testvault');
if (!flag('--empty') && existsSync(template)) {
  cpSync(template, vault, { recursive: true, filter: (s) => !s.includes('.obsidian') });
}

const pluginDir = join(vault, '.obsidian', 'plugins', PLUGIN_ID);
mkdirSync(pluginDir, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
  if (existsSync(join(ROOT, f))) copyFileSync(join(ROOT, f), join(pluginDir, f));
}
writeFileSync(join(vault, '.obsidian', 'community-plugins.json'), JSON.stringify([PLUGIN_ID]));

writeFileSync(
  join(profile, 'obsidian.json'),
  JSON.stringify({ vaults: { scratch0001: { path: vault, ts: Date.now(), open: true } } }),
);

const child = spawn(
  obsidianBinary(),
  [
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${profile}`,
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
  { detached: true, stdio: 'ignore' },
);
child.unref();
writeFileSync(join(SCRATCH, 'pid'), String(child.pid));

let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(500);
  try {
    target = await pickTarget('main');
  } catch {
    /* not up yet */
  }
}
if (!target) {
  console.error('Obsidian did not expose a window in 30 s.');
  process.exit(1);
}

const client = await connect(target);
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const state = await evaluate(
    client,
    `(() => { if (typeof app === 'undefined' || !app.workspace) return 'loading';
      const b=[...document.querySelectorAll('button')].find(x=>/Trust author and enable plugins/i.test(x.textContent));
      if (b) { b.click(); return 'trusted'; } return 'ready'; })()`,
  ).catch(() => 'loading');
  if (state === 'ready') break;
}
client.close();
console.log(`Obsidian running. vault=${vault} port=${PORT}`);
