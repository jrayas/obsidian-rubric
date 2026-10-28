// Real-app checks for the mobile-lite behaviour: launches an isolated Obsidian, switches it to Obsidian's mobile emulation
// (app.emulateMobile, which reloads the window) and drives the built plugin there. It cannot prove anything about a real
// phone: layout, touch input, memory and the mobile file system need a device.
//   npm run e2e:mobile            build, launch, run all checks, stop
//   npm run e2e:mobile -- --keep  leave Obsidian running afterwards
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ROOT, PLUGIN_ID, SCRATCH } from './lib/paths.mjs';
import { connect, evaluate, pickTarget, sleep } from './lib/cdp.mjs';

const keep = process.argv.includes('--keep');
const run = (script, args = []) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${script} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
};
const P = `app.plugins.plugins['${PLUGIN_ID}']`;

console.log('Launching isolated Obsidian…');
try {
  run('debug.mjs', ['stop']);
} catch {
  /* nothing running */
}
run('debug-launch.mjs', ['--empty']);

let client = await connect(await pickTarget('main'));
const ev = (expr) => evaluate(client, expr);
await ev('app.setting.close(); 0');

// ---- set up the schema (the frozen rule pack), a note and the settings, on the desktop, then switch to mobile
const walk = (d, o = []) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, o);
    else if (p.endsWith('.yaml')) o.push(p);
  }
  return o;
};
const base = join(ROOT, 'tests', 'fixtures', 'rule-pack');
await ev(`app.vault.adapter.mkdir('_schema').then(() => 0)`);
for (const f of walk(base)) {
  const rel = relative(base, f).split(sep).join('/');
  const dir = rel.split('/').slice(0, -1).join('/');
  if (dir) await ev(`(async () => { let cur = '_schema'; for (const p of '${dir}'.split('/')) { cur += '/' + p; if (!(await app.vault.adapter.exists(cur))) await app.vault.adapter.mkdir(cur); } return 0; })()`);
  await ev(`app.vault.adapter.write(${JSON.stringify('_schema/' + rel)}, ${JSON.stringify(readFileSync(f, 'utf8'))}).then(() => 0)`);
}
await ev(`app.vault.adapter.mkdir('Tasks').then(() => 0)`);
const NOTE = '---\ntype: task\nid: TK-2026-0001\nstatus: todo\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\n# Phone note\n';
await ev(`app.vault.adapter.write('Tasks/Phone.md', ${JSON.stringify(NOTE)}).then(() => 0)`);
await ev(`(async () => { ${P}.settings.enabled = true; ${P}.settings.onCreate = 'nothing'; await ${P}.saveSettings(); await ${P}.schemas.reload('manual'); return 0; })()`);
await sleep(1500);

console.log('Switching to mobile emulation (the window reloads)…');
client.send('Runtime.evaluate', { expression: 'app.emulateMobile(true)' }).catch(() => undefined);
client.close();
await sleep(1500);
async function reconnect(ready) {
  for (let i = 0; i < 80; i++) {
    try {
      const t = await pickTarget('main');
      if (t) {
        const c = await connect(t);
        const ok = await evaluate(c, ready).catch(() => false);
        if (ok) return c;
        c.close();
      }
    } catch {
      /* the window is reloading */
    }
    await sleep(500);
  }
  throw new Error('Obsidian did not come back after switching the mobile emulation');
}
client = await reconnect(`app.isMobile === true && !!${P}?.schemas?.pack`);
await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
const consoleErrors = [];
client.onEvent((m) => {
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
});
await client.send('Runtime.enable');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`FAIL  ${name}\n        ${e.message}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
async function waitFor(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}
const read = (path) => ev(`app.vault.adapter.read(${JSON.stringify(path)})`);
const fmStatus = async () => /status: (\S+)/.exec(await read('Tasks/Phone.md'))?.[1];
const openPhoneNote = () => ev(`(async () => { const f = app.vault.getFileByPath('Tasks/Phone.md'); const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(f); app.workspace.setActiveLeaf(leaf, { focus: true }); await new Promise(r => setTimeout(r, 600)); return 0; })()`);
const clickSuggestion = (text) =>
  ev(`(() => { const s = [...activeDocument.querySelectorAll('.suggestion-item')].find(x => x.textContent.startsWith(${JSON.stringify(text)})); s?.click(); return !!s; })()`);

await check('M1 the plugin loads in mobile emulation, with the schemas, and without console errors', async () => {
  eq(await ev(`({ mobile: app.isMobile, pack: !!${P}.schemas.pack, enabled: ${P}.settings.enabled })`), { mobile: true, pack: true, enabled: true }, 'state');
  eq(consoleErrors, [], 'console errors');
});

await check('M2 the Properties-area layer is not installed on mobile, and the saved "commands only" setting is left alone', async () => {
  await ev(`${P}.syncLayer(); 0`);
  eq(await ev(`${P}.layer.installed`), false, 'layer installed');
  eq(await ev(`${P}.settings.commandsOnly`), false, 'the saved setting');
});

await check('M3 the settings page shows the phone note instead of the hold-key settings', async () => {
  await ev(`app.setting.open(); app.setting.openTabById('${PLUGIN_ID}'); 0`);
  await sleep(1500);
  // Hidden settings stay in the page, so look at what is actually shown.
  const shown = await ev(`[...document.querySelectorAll('.setting-item, .setting-item-heading, .setting-group-heading')].filter(e => e.offsetParent !== null).map(e => e.querySelector('.setting-item-name')?.textContent ?? e.textContent)`);
  assert(shown.includes('On phones and tablets') || shown.includes('Properties area features'), `the phone note is not shown: ${shown.slice(0, 12)}`);
  for (const name of ['Hold key', 'Hold delay', 'Always hide the list on release', 'Latched list hotkey', 'Commands only']) assert(!shown.includes(name), `"${name}" is still shown`);
  for (const name of ['Retired IDs', 'Saved presets', 'Save the schema as a preset']) assert(shown.includes(name), `"${name}" is not shown`);
  await ev(`app.setting.close(); 0`);
});

await check('M4 "Choose a property to edit": no focused property needed; pick a property, pick a value, it is saved', async () => {
  await openPhoneNote();
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:choose-property'); 0`);
  await waitFor(() => ev(`activeDocument.querySelectorAll('.suggestion-item').length > 0`), 'the property list');
  const items = await ev(`[...activeDocument.querySelectorAll('.suggestion-item')].map(x => x.textContent)`);
  assert(items.some((t) => t.startsWith('status')), `properties offered: ${items}`);
  assert(items.find((t) => t.startsWith('status')).includes('todo'), 'the current value is shown beside the property');
  assert(!items.some((t) => t.startsWith('id')), 'a locked property must not be offered');
  assert(await clickSuggestion('status'), 'status not found');
  await waitFor(() => ev(`activeDocument.querySelectorAll('.rubric-option').length > 0`), 'the value list');
  eq(await ev(`!!activeDocument.activeElement?.classList.contains('rubric-filter')`), false, 'the filter field must not take the focus (it would raise the keyboard)');
  await ev(`(() => { const o = [...activeDocument.querySelectorAll('.rubric-option')].find(x => x.textContent.startsWith('doing')); o.click(); return 0; })()`);
  await waitFor(async () => (await fmStatus()) === 'doing', 'status to be saved');
  await ev(`[...activeDocument.querySelectorAll('.modal-close-button')].forEach(b => b.click()); 0`);
});

await check('M5 "Show all options" with nothing focused opens the same property list instead of a dead end', async () => {
  await openPhoneNote();
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:show-all-options'); 0`);
  await waitFor(() => ev(`activeDocument.querySelectorAll('.suggestion-item').length > 0`), 'the property list');
  await ev(`[...activeDocument.querySelectorAll('.modal-close-button, .prompt')].forEach(b => b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); 0`);
  await ev(`app.workspace.activeEditor?.editor?.focus(); 0`);
});

await check('M6 modified is still stamped after an edit to an opened note (baseline taken on open, no start-up scan)', async () => {
  await openPhoneNote();
  const before = /modified: (\S+)/.exec(await read('Tasks/Phone.md'))[1];
  await ev(`(async () => { const f = app.vault.getFileByPath('Tasks/Phone.md'); await app.vault.process(f, t => t + 'edited on the phone\\n'); return 0; })()`);
  await waitFor(async () => /modified: (\S+)/.exec(await read('Tasks/Phone.md'))[1] !== before, 'modified to change', 8000);
});

await check('M7 presets and the zip export work on mobile; "open schema folder" says where the folder is', async () => {
  eq(await ev(`${P}.presets.save('Phone preset')`), 'phone-preset', 'preset saved');
  const zip = await ev(`${P}.presets.exportZip()`);
  const bytes = await ev(`app.vault.adapter.readBinary(${JSON.stringify(zip)}).then(b => [...new Uint8Array(b).slice(0, 4)])`);
  eq(bytes, [0x50, 0x4b, 0x03, 0x04], 'zip signature');
  const test = spawnSync('unzip', ['-tq', join(SCRATCH, 'vault', zip)], { encoding: 'utf8' });
  if (!test.error) assert(test.status === 0, `unzip -t: ${test.stdout}${test.stderr}`);
  await ev(`[...activeDocument.querySelectorAll('.notice')].forEach(n => n.remove()); app.commands.executeCommandById('${PLUGIN_ID}:open-schema-folder'); 0`);
  await waitFor(() => ev(`[...activeDocument.querySelectorAll('.notice')].some(n => /The schema folder is "_schema" in your vault/.test(n.textContent))`), 'the folder notice');
});

await check('M8 no console errors during the whole mobile run', async () => {
  eq(consoleErrors, [], 'console errors');
});

console.log('Switching mobile emulation off…');
client.send('Runtime.evaluate', { expression: 'app.emulateMobile(false)' }).catch(() => undefined);
client.close();
await sleep(2000);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (!keep) run('debug.mjs', ['stop']);
process.exit(failed.length ? 1 : 0);
