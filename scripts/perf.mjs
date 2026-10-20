// Performance sanity check on a synthetic vault. Not part of the normal e2e run.
//   node scripts/perf.mjs [notes]     (default 3000)
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, PLUGIN_ID } from './lib/paths.mjs';
import { connect, evaluate, pickTarget, sleep } from './lib/cdp.mjs';

const N = Number(process.argv[2] ?? 3000);
const run = (script, args = []) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${script}: ${r.stderr || r.stdout}`);
};
try { run('debug.mjs', ['stop']); } catch { /* not running */ }
run('debug-launch.mjs', ['--empty']);
const c = await connect(await pickTarget('main'));
const ev = (e) => evaluate(c, e);
const P = `app.plugins.plugins['${PLUGIN_ID}']`;
await ev('app.setting.close(); 0'); // the trust flow leaves the settings dialog open and it becomes activeDocument

// starter pack and a vault of N notes
await ev(`app.commands.executeCommandById('${PLUGIN_ID}:install-starter-schemas'); 0`);
await sleep(500);
await ev(`[...activeDocument.querySelectorAll('.modal button')].find(b => b.textContent === 'Create files')?.click(); 0`);
await sleep(2000);
const types = ['kb', 'task', 'project', 'note'];
const t0 = Date.now();
await ev(`(async () => {
  const ad = app.vault.adapter; const types = ${JSON.stringify(types)}; const folders = { kb: 'Knowledge', task: 'Tasks', project: 'Projects', note: 'Notes' };
  const prefix = { kb: 'KB', task: 'TK', project: 'PR', note: 'NT' }; const status = { kb: 'draft', task: 'todo', project: 'planning', note: 'draft' };
  for (const f of Object.values(folders)) await app.vault.createFolder(f).catch(() => {});
  for (let i = 0; i < ${N}; i++) {
    const t = types[i % 4]; const n = Math.floor(i / 4) + 1;
    const text = '---\\ntype: ' + t + '\\nschema: 2\\nid: ' + prefix[t] + '-2026-' + String(n).padStart(4, '0') + '\\nname: Note ' + i + '\\nstatus: ' + status[t] + '\\ntags:\\n  - idea\\nbreadcrumb: ' + folders[t] + '\\ncreated: 2026-01-01T10:00\\nmodified: 2026-01-02T10:00\\n---\\n' + 'Lorem ipsum dolor sit amet. '.repeat(40) + '\\n';
    await ad.write(folders[t] + '/Note ' + i + '.md', text);
  }
  return 0; })()`);
console.log(`created ${N} notes in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await sleep(8000);

// reload the plugin and watch the main thread
await ev(`(() => { window.__long = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); return 0; })()`);
const mem0 = await ev(`process.getProcessMemoryInfo().then(m => m.private)`);
const load = await ev(`(async () => { const t = performance.now(); await app.plugins.disablePlugin('${PLUGIN_ID}'); const t1 = performance.now(); await app.plugins.enablePlugin('${PLUGIN_ID}'); return { onloadMs: Math.round(performance.now() - t1), disableMs: Math.round(t1 - t) }; })()`);
await ev(`new Promise(r => { const w = () => ${P}?.schemas?.pack ? r(0) : setTimeout(w, 100); w(); })`);
await sleep(15000);
const long = await ev('window.__long');
const mem1 = await ev(`process.getProcessMemoryInfo().then(m => m.private)`);

// full vault check through the window
const check = await ev(`(async () => {
  const t = performance.now(); app.commands.executeCommandById('${PLUGIN_ID}:check-vault');
  await new Promise(r => { const w = () => { const s = activeDocument.querySelector('.vschema-check-summary'); if (s && !/Scanning/.test(s.textContent)) r(0); else setTimeout(w, 100); }; w(); });
  return { ms: Math.round(performance.now() - t), summary: activeDocument.querySelector('.vschema-check-summary').textContent };
})()`);
const long2 = await ev('window.__long');
const mem2 = await ev(`process.getProcessMemoryInfo().then(m => m.private)`);
const stampBytes = await ev(`app.vault.adapter.stat('.obsidian/plugins/${PLUGIN_ID}/data.json').then(s => s?.size)`);

console.log(JSON.stringify({
  notes: N,
  pluginOnloadMs: load.onloadMs,
  longTasksDuringStartup: { count: long.length, worstMs: Math.max(0, ...long), over100ms: long.filter((d) => d > 100).length },
  memoryMB: { before: Math.round(mem0 / 1024), afterStartup: Math.round(mem1 / 1024), afterCheck: Math.round(mem2 / 1024) },
  vaultCheck: check,
  longTasksIncludingCheck: { count: long2.length, worstMs: Math.max(0, ...long2) },
  dataJsonBytes: stampBytes,
}, null, 2));
c.close();
run('debug.mjs', ['stop']);
