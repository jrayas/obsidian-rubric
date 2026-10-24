// Real-app checks: launches an isolated Obsidian with a scratch vault, drives the built plugin over CDP and
// prints PASS/FAIL per check. Exit code 1 if anything fails.
//   npm run e2e            build, launch, run all checks, stop
//   npm run e2e -- --keep  leave Obsidian running afterwards
//   npm run e2e -- --only <text>  run only checks whose name contains <text>
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, PLUGIN_ID } from './lib/paths.mjs';
import { connect, evaluate, pickTarget, sleep } from './lib/cdp.mjs';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

function run(script, scriptArgs = []) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...scriptArgs], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${script} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

console.log('Launching isolated Obsidian…');
try {
  run('debug.mjs', ['stop']);
} catch {
  /* nothing running */
}
run('debug-launch.mjs', ['--empty']);

const client = await connect(await pickTarget('main'));
await evaluate(client, 'app.setting.close(); 0'); // the trust flow leaves Obsidian's settings dialog open
// The window need not be the focused app: make the page behave as if it is (focus events, keyboard routing).
await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }); // never bring the window to the front: that would steal the keyboard from whatever you are using
// Hands off while this runs: a real pointer moving over the window carries no Option flag and would (rightly) count as a key release.
console.log('Running against a real Obsidian window. Please do not touch the mouse or keyboard over it until this finishes.');
const consoleErrors = [];
client.onEvent((m) => {
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
});
await client.send('Runtime.enable');
const ev = (expr) => evaluate(client, expr);
const P = `app.plugins.plugins['${PLUGIN_ID}']`;

const keyEvent = (type, key, code, vk, extra = {}) =>
  client.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...extra });
// Park the pointer in a corner first: a real pointer resting over the list would (correctly) keep it open on release.
const altDown = async () => {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await keyEvent('rawKeyDown', 'Alt', 'AltLeft', 18, { modifiers: 1 });
};
const altUp = () => keyEvent('keyUp', 'Alt', 'AltLeft', 18, { modifiers: 0 });
const press = async (key, code, vk) => {
  await keyEvent('keyDown', key, code, vk);
  await keyEvent('keyUp', key, code, vk);
};
const escape = () => press('Escape', 'Escape', 27);

const results = [];
async function check(name, fn) {
  if (only && !name.includes(only)) return;
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
async function waitFor(fn, what, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}
// Close plugin dialogs with Escape (they have no close button); Obsidian's own settings dialog is left alone.
const strayModals = () =>
  ev(`[...activeDocument.querySelectorAll('.modal')].filter(m => !m.querySelector('.vertical-tab-nav-item')).length`);
async function closeStrayModals() {
  for (let i = 0; i < 5 && (await strayModals()) > 0; i++) {
    await escape();
    await sleep(250);
  }
}
const clickButton = (text) =>
  ev(`(() => { const b = [...activeDocument.querySelectorAll('.modal button')].find(x => x.textContent === ${JSON.stringify(text)}); b?.click(); return !!b; })()`);
const choiceShown = () => ev(`activeDocument.querySelectorAll('.vschema-choice-list').length`);
const read = (path) => ev(`app.vault.adapter.read(${JSON.stringify(path)})`);
const write = (path, text) => ev(`app.vault.adapter.write(${JSON.stringify(path)}, ${JSON.stringify(text)}).then(() => 0)`);
const fmLines = async (path) => (await read(path)).split('---')[1].split('\n');

// ---------------------------------------------------------------- Phase 1: schema foundation
await ev(`${P}.settings.onCreate = 'nothing'; 0`); // the older checks seed many bare notes; the new automation is tested in Phase 7
await check('P1 plugin loads with no console errors and reports no schema folder yet', async () => {
  eq(await ev(`!!${P}`), true, 'plugin loaded');
  eq(await ev(`${P}.schemas.status.problems.map(p => p.code)`), ['folder-missing'], 'problems');
  eq(consoleErrors, [], 'console errors');
});

await check('P1 starter pack installs through the command and loads without problems', async () => {
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:install-starter-schemas'); 0`);
  await waitFor(() => clickButton('Create files'), 'the confirm dialog');
  await waitFor(() => ev(`${P}.schemas.pack !== null`), 'pack to load');
  eq(await ev(`${P}.schemas.status.problems.length`), 0, 'problems');
  eq(await ev(`${P}.schemas.pack.typeNames.length`), 8, 'types');
  // running it again creates nothing and never overwrites
  await write('_schema/types/note.yaml', (await read('_schema/types/note.yaml')) + '# edited\n');
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:install-starter-schemas'); 0`);
  await sleep(400);
  assert((await read('_schema/types/note.yaml')).includes('# edited'), 'an existing file was overwritten');
  eq(await ev(`activeDocument.querySelectorAll('.modal').length`), 0, 'dialog open for nothing to do');
});

await check('P1 a broken schema file keeps the last good copy with one notice; fixing it recovers', async () => {
  const orig = await read('_schema/modules/review.yaml');
  try {
    await write('_schema/modules/review.yaml', orig + '\n  bad: [unclosed\n');
    await waitFor(() => ev(`${P}.schemas.status.usingLastGood`), 'last-good flag');
    const st = await ev(`({ pack: !!${P}.schemas.pack, errors: ${P}.schemas.status.problems.filter(p => p.severity === 'error').map(p => p.file + ':' + p.line) })`);
    eq(st.pack, true, 'pack kept');
    assert(st.errors[0]?.startsWith('modules/review.yaml:'), `error should name the file and line: ${st.errors}`);
    const notices = await ev(`[...activeDocument.querySelectorAll('.notice')].filter(n => /Schema problem in modules\\/review/.test(n.textContent)).length`);
    eq(notices, 1, 'notices about the broken file');
  } finally {
    await write('_schema/modules/review.yaml', orig);
  }
  await waitFor(() => ev(`!${P}.schemas.status.usingLastGood && ${P}.schemas.status.problems.length === 0`), 'recovery');
});

await check('P1 a hidden .schema folder is read and watched by polling', async () => {
  await ev(`(async () => {
    const ad = app.vault.adapter;
    const copy = async (from, to) => { await ad.mkdir(to).catch(() => {}); const l = await ad.list(from); for (const f of l.files) await ad.write(to + '/' + f.split('/').pop(), await ad.read(f)); for (const d of l.folders) await copy(d, to + '/' + d.split('/').pop()); };
    await copy('_schema', '.schema'); await ad.rmdir('_schema', true);
    ${P}.settings.schemaFolder = '.schema'; await ${P}.saveSettings(); await ${P}.schemas.reload('manual'); return 0; })()`);
  eq(await ev(`({ hidden: ${P}.schemas.status.detection.hidden, types: ${P}.schemas.pack.typeNames.length })`), { hidden: true, types: 8 }, 'hidden load');
  const orig = await read('.schema/modules/review.yaml');
  await write('.schema/modules/review.yaml', orig.replace('default: 6-months', 'default: 9-months'));
  await waitFor(() => ev(`${P}.schemas.status.problems.some(p => p.code === 'bad-default')`), 'poll to notice the break', 6000);
  await write('.schema/modules/review.yaml', orig);
  await waitFor(() => ev(`${P}.schemas.status.problems.length === 0`), 'poll to notice the fix', 6000);
  // move it back to the visible default for the remaining checks
  await ev(`(async () => {
    const ad = app.vault.adapter;
    const copy = async (from, to) => { await ad.mkdir(to).catch(() => {}); const l = await ad.list(from); for (const f of l.files) await ad.write(to + '/' + f.split('/').pop(), await ad.read(f)); for (const d of l.folders) await copy(d, to + '/' + d.split('/').pop()); };
    await copy('.schema', '_schema'); await ad.rmdir('.schema', true);
    ${P}.settings.schemaFolder = '_schema'; await ${P}.saveSettings(); await ${P}.schemas.reload('manual'); return 0; })()`);
  await waitFor(() => ev(`${P}.schemas.status.detection.folder === '_schema' && ${P}.schemas.pack !== null`), 'back to _schema');
});

// ---------------------------------------------------------------- Phase 2: matching, scope, prompts
await ev(`(async () => { for (const f of ['Inbox', 'Elsewhere', 'Templates', 'Knowledge', 'Tasks', 'Synced']) await app.vault.createFolder(f).catch(() => {}); return 0; })()`);

await check('P2 a new note in an unknown folder asks which schema; Apply with remember writes folders.yaml and keeps comments', async () => {
  await ev(`app.vault.create('Inbox/first.md', '').then(() => 0)`);
  await waitFor(() => choiceShown(), 'the schema prompt', 5000);
  const title = await ev(`[...activeDocument.querySelectorAll('.modal')].pop().querySelector('.modal-title').textContent`);
  eq(title, 'No schema for Inbox/', 'prompt title');
  eq(await ev(`[...activeDocument.querySelectorAll('.vschema-choice')].length`), 9, 'choices (8 types + leave unmanaged)');
  await ev(`[...activeDocument.querySelectorAll('.vschema-choice input')][1].click(); 0`);
  await sleep(100);
  await clickButton('Apply');
  await waitFor(() => read('_schema/registry/folders.yaml').then((t) => /Inbox: kb/.test(t)), 'mapping to be written');
  const yaml = await read('_schema/registry/folders.yaml');
  assert(yaml.includes('# Root folder -> type.') && yaml.includes('# Fixed by design'), 'comments were lost');
  await waitFor(() => ev(`${P}.notes.context(app.vault.getFileByPath('Inbox/first.md')).type?.name === 'kb'`), 'note to match kb');
});

await check('P2 "Not now" stops further prompts for that folder', async () => {
  await ev(`app.vault.create('Elsewhere/a.md', '').then(() => 0)`);
  await waitFor(() => choiceShown(), 'the schema prompt', 5000);
  await clickButton('Not now');
  await sleep(300);
  await ev(`app.vault.create('Elsewhere/b.md', '').then(() => 0)`);
  await sleep(1800);
  eq(await choiceShown(), 0, 'prompts after Not now');
  eq(await ev(`${P}.settings.skippedFolders`), ['elsewhere'], 'skipped folders');
});

await check('P2 notes arriving like sync (with an id), and notes in excluded folders, never prompt', async () => {
  await write('Synced/arrived.md', '---\nid: KB-2026-0001\n---\nx');
  await ev(`app.vault.create('Templates/t.md', '').then(() => 0)`);
  await sleep(2000);
  eq(await choiceShown(), 0, 'prompts');
  eq(await ev(`${P}.notes.context(app.vault.getFileByPath('Templates/t.md')).verdict`), { managed: false, reason: 'excluded' }, 'verdict');
});

await check('P2 the "Choose schema" command always asks', async () => {
  await ev(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Elsewhere/a.md')).then(() => 0)`);
  await sleep(500);
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:choose-schema'); 0`);
  await waitFor(() => choiceShown(), 'the prompt');
  await clickButton('Not now');
});

await check('P2 settings page shows every group, and scope changes write scope.yaml', async () => {
  await ev(`app.setting.open(); app.setting.openTabById('${PLUGIN_ID}'); 0`);
  const settings = await connect(await waitFor(() => pickTarget('settings'), 'the settings window'));
  const sev = (expr) => evaluate(settings, expr);
  await sleep(1500);
  const headings = await sev(`[...document.querySelectorAll('.setting-group-heading, .setting-item-heading')].map(e => e.textContent)`);
  for (const h of ['Schema folder', 'Matching', 'Scope', 'Properties area', 'Automation', 'Folder mapping', 'Problems']) assert(headings.includes(h), `missing group "${h}" in ${headings}`);
  const includedVisible = () => sev(`[...document.querySelectorAll('div, h3, h4')].filter(e => e.children.length === 0 && e.textContent === 'Included folders').some(e => !!e.offsetParent)`);
  eq(await includedVisible(), false, 'Included folders visible in exclude mode');
  await sev(`(() => { const row = [...document.querySelectorAll('.setting-item')].find(r => r.querySelector('.setting-item-name')?.textContent === 'Mode' && /Exclude always wins/.test(r.textContent)); const s = row.querySelector('select'); s.value = 'include-only'; s.dispatchEvent(new Event('change', { bubbles: true })); return 0; })()`);
  await waitFor(() => read('_schema/registry/scope.yaml').then((t) => /mode: include-only/.test(t)), 'scope.yaml to change');
  await waitFor(() => includedVisible(), 'Included folders to appear in include-only mode');
  assert((await read('_schema/registry/scope.yaml')).includes('# Which notes are managed.'), 'scope.yaml lost its comments');
  await sev(`(() => { const row = [...document.querySelectorAll('.setting-item')].find(r => r.querySelector('.setting-item-name')?.textContent === 'Mode' && /Exclude always wins/.test(r.textContent)); const s = row.querySelector('select'); s.value = 'exclude'; s.dispatchEvent(new Event('change', { bubbles: true })); return 0; })()`);
  await waitFor(() => read('_schema/registry/scope.yaml').then((t) => /mode: exclude/.test(t)), 'scope.yaml to change back');
  settings.close();
  await ev(`app.setting.close(); 0`);
});

// ---------------------------------------------------------------- Phase 3: Properties area
// A real mouse over the test window sends events without the Option flag; the safety that treats those as a key release
// is switched off here and on again only in the checks that test it.
await ev(`${P}.layer.releaseSafety = false; 0`);
await ev(`${P}.watcher.enabled = false; 0`); // prompts for tags, status and type changes are tested in Phase 4
const KB = `---\ntype: kb\nschema: 2\nid: KB-2026-0143\nname: Wave\nstatus: draft\ntags:\n  - sop\ndescription: hello\nlanguage: en-GB\nbreadcrumb: Knowledge/Physics\nkind: concept\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n`;
await write('Knowledge/Wave.md', KB);
await write('Templates/Plain.md', '---\nstatus: whatever\n---\nbody\n');
await write('Tasks/Review.md', '---\ntype: task\nschema: 2\nid: TK-2026-0012\nname: Review\nstatus: doing\npriority: 2\ncreated: 2026-10-18T10:15\nmodified: 2026-10-18T10:15\n---\nbody\n');

const openNote = async (path) => {
  await closeStrayModals();
  await ev(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(${JSON.stringify(path)})).then(() => 0)`);
  await waitFor(() => ev(`document.querySelectorAll('.metadata-property').length > 0`), 'properties to render');
  await sleep(500);
};
const focusValue = (k) =>
  ev(`(() => { const r = document.querySelector('.metadata-property[data-property-key="${k}"]'); const t = r.querySelector('.metadata-property-value .multi-select-input') ?? r.querySelector('.metadata-property-value [contenteditable="true"], .metadata-property-value input'); t.focus(); if (t.isContentEditable) getSelection().selectAllChildren(t); return document.activeElement.className; })()`);
const popover = () =>
  ev(`(() => { const p = document.querySelector('.vschema-popover'); return p ? { options: [...p.querySelectorAll('.vschema-option-label')].map(e => e.textContent), checked: [...p.querySelectorAll('.vschema-option.is-checked .vschema-option-label')].map(e => e.textContent), note: p.querySelector('.vschema-lock-note')?.textContent ?? null, filter: !!p.querySelector('.vschema-filter'), auto: p.classList.contains('vschema-autocomplete'), notes: [...p.querySelectorAll('.vschema-option-note')].map(e => e.textContent) } : null; })()`);

await check('P3 schema notes get a ▾ button on option fields and a lock on locked ones; other notes are untouched', async () => {
  await openNote('Knowledge/Wave.md');
  const rows = await ev(`[...document.querySelectorAll('.metadata-property')].map(r => r.dataset.propertyKey + (r.querySelector('.vschema-chevron') ? ':chevron' : '') + (r.classList.contains('vschema-locked') ? ':locked' : ''))`);
  for (const want of ['status:chevron', 'tags:chevron', 'language:chevron', 'kind:chevron', 'id:locked', 'schema:locked', 'breadcrumb:locked', 'created:locked', 'modified:locked', 'name', 'description'])
    assert(rows.includes(want), `row ${want} missing in ${rows}`);
  await openNote('Templates/Plain.md');
  eq(await ev(`[...document.querySelectorAll('.vschema-chevron, .vschema-locked')].map(e => e.closest('.metadata-property')?.dataset.propertyKey + ' in ' + (e.closest('.workspace-leaf-content')?.dataset.type ?? '?') + ' file=' + document.querySelector('.workspace-leaf.mod-active .view-header-title')?.textContent)`), [], 'decorations on an excluded note');
  await openNote('Tasks/Review.md');
  eq(await ev(`[...document.querySelectorAll('.metadata-property')].filter(r => r.querySelector('.vschema-chevron')).map(r => r.dataset.propertyKey)`), ['type', 'status', 'priority'], 'task option fields');
});

await check('P3 hold shows the list only after the delay and hides on release', async () => {
  await openNote('Knowledge/Wave.md');
  await focusValue('status');
  await altDown();
  await sleep(150);
  eq(await popover(), null, 'list before the delay');
  await sleep(450);
  const p = await popover();
  eq(p?.options, ['draft', 'review', 'published', 'outdated', 'archived'], 'kb status options');
  eq(p?.checked, ['draft'], 'ticked');
  await altUp();
  await sleep(300);
  eq(await popover(), null, 'list after release');
});

await check('P3 another key during the hold cancels it (Option+G types a symbol)', async () => {
  await focusValue('status');
  await altDown();
  await sleep(100);
  await keyEvent('rawKeyDown', 'g', 'KeyG', 71, { modifiers: 1, text: 'g' });
  await keyEvent('keyUp', 'g', 'KeyG', 71, { modifiers: 1 });
  await sleep(600);
  eq(await popover(), null, 'list after another key');
  await altUp();
  await sleep(200);
});

await check('P3 a pick while holding saves at once and keeps the list until release', async () => {
  await focusValue('status');
  await altDown();
  await sleep(600);
  await ev(`[...document.querySelectorAll('.vschema-option')].find(o => o.textContent.includes('review')).click(); 0`);
  await waitFor(async () => (await fmLines('Knowledge/Wave.md')).includes('status: review'), 'the file to change');
  await sleep(500);
  const p = await popover();
  eq(p?.checked, ['review'], 'tick moved');
  await altUp();
  await sleep(300);
  eq(await popover(), null, 'list after release');
  // the rest of the note is unchanged and the order is kept
  const lines = (await fmLines('Knowledge/Wave.md')).filter(Boolean);
  eq(lines.slice(0, 6), ['type: kb', 'schema: 2', 'id: KB-2026-0143', 'name: Wave', 'status: review', 'description: hello'], 'schema order (description comes before tags)');
  assert((await read('Knowledge/Wave.md')).endsWith('---\nbody\n'), 'body changed');
});

await check('P3 the release rule: pointer over the list keeps it until Escape', async () => {
  await focusValue('status');
  await altDown();
  await sleep(600);
  const box = await ev(`(() => { const r = document.querySelector('.vschema-popover').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 20 }; })()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, modifiers: 1 });
  await sleep(300);
  await altUp();
  await sleep(300);
  assert(await popover(), 'list should stay open with the pointer over it');
  await escape();
  await sleep(300);
  eq(await popover(), null, 'list after Escape');
});

await check('P3 "always hide on release" setting hides even over the list', async () => {
  await ev(`${P}.settings.alwaysHideOnRelease = true; 0`);
  await focusValue('status');
  await altDown();
  await sleep(600);
  const box = await ev(`(() => { const r = document.querySelector('.vschema-popover').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 20 }; })()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, modifiers: 1 });
  await sleep(300);
  await altUp();
  await sleep(300);
  eq(await popover(), null, 'list after release');
  await ev(`${P}.settings.alwaysHideOnRelease = false; 0`);
});

await check('P3 locked properties ignore the hold and say who manages them', async () => {
  for (const [key, text] of [
    ['id', 'Vault Schema'],
    ['schema', 'Vault Schema'],
    ['created', 'Vault Schema'],
    ['modified', 'Vault Schema'],
    ['breadcrumb', 'breadcrumb plugin'],
  ]) {
    await focusValue(key);
    await altDown();
    await sleep(600);
    const p = await popover();
    assert(p?.note?.includes(text) && p.options.length === 0, `${key}: expected a lock note mentioning ${text}, got ${JSON.stringify(p)}`);
    await altUp();
    await sleep(250);
  }
});

await check('P3 latched list: hotkey command opens it with a filter; Space ticks; each change saves; list stays open', async () => {
  await focusValue('tags');
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:show-all-options'); 0`);
  await waitFor(() => popover(), 'the latched list');
  const p = await popover();
  eq(p.filter, true, 'filter box');
  eq(p.checked, ['procedure'], 'ticked (sop resolved to procedure)');
  // filter by synonym
  await ev(`(() => { const f = document.querySelector('.vschema-filter'); f.value = 'sop'; f.dispatchEvent(new Event('input')); return 0; })()`);
  await sleep(200);
  eq((await popover()).options, ['procedure'], 'filtered by synonym');
  await ev(`(() => { const f = document.querySelector('.vschema-filter'); f.value = ''; f.dispatchEvent(new Event('input')); return 0; })()`);
  await sleep(100);
  // arrows + Space on the filter box
  await ev(`(() => { const f = document.querySelector('.vschema-filter'); for (const k of ['ArrowDown', 'ArrowDown', ' ']) f.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); return 0; })()`);
  await waitFor(async () => (await fmLines('Knowledge/Wave.md')).includes('  - quantum'), 'quantum to be saved');
  assert(await popover(), 'latched list closed after a save');
  eq((await popover()).checked, ['quantum', 'procedure'], 'ticks after save');
});

await check('P3 first Escape closes only the list; the same hotkey also closes it', async () => {
  await escape();
  await sleep(300);
  eq(await popover(), null, 'list after Escape');
  await focusValue('tags');
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:show-all-options'); 0`);
  await waitFor(() => popover(), 'latched list');
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:show-all-options'); 0`);
  await sleep(400);
  eq(await popover(), null, 'list after the hotkey');
  eq(await ev(`activeDocument.querySelectorAll('.modal').length`), 0, 'picker window opened instead of closing the list');
});

await check('P3 hold then the hotkey latches the list, and it survives release', async () => {
  await focusValue('status');
  await altDown();
  await sleep(600);
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:show-all-options'); 0`);
  await sleep(300);
  await altUp();
  await sleep(300);
  const p = await popover();
  assert(p?.filter, 'list should be latched (with filter) after release');
  await escape();
  await sleep(300);
});

await check('P3 the ▾ button opens the same list and is a labelled button', async () => {
  const aria = await ev(`document.querySelector('.metadata-property[data-property-key="status"] .vschema-chevron').getAttribute('aria-label')`);
  eq(aria, 'Show all options for status', 'aria-label');
  eq(await ev(`document.querySelector('.metadata-property[data-property-key="status"] .vschema-chevron').tagName`), 'BUTTON', 'element');
  await ev(`document.querySelector('.metadata-property[data-property-key="status"] .vschema-chevron').click(); 0`);
  await waitFor(() => popover(), 'the list');
  eq(await ev(`document.querySelector('.metadata-property[data-property-key="status"] .vschema-chevron').getAttribute('aria-expanded')`), 'true', 'aria-expanded');
  await escape();
  await sleep(300);
});

await check('P3 clicking into another property closes an open list', async () => {
  await focusValue('status');
  await waitFor(() => ev(`!!document.querySelector('.metadata-property[data-property-key="status"] .vschema-chevron')`), 'the ▾ button');
  await ev(`document.querySelector('.metadata-property[data-property-key="status"] .vschema-chevron').click(); 0`);
  await waitFor(() => popover(), 'the list');
  await ev(`(() => { const t = document.querySelector('.metadata-property[data-property-key="description"] .metadata-property-value [contenteditable="true"], .metadata-property[data-property-key="description"] .metadata-property-value input'); t.focus(); return 0; })()`);
  await sleep(400);
  eq(await popover(), null, 'list after focusing another property');
});

await check('P3 a short hint appears when a field with options is focused (and the setting turns it off)', async () => {
  await focusValue('description');
  await sleep(300);
  eq(await ev(`document.querySelectorAll('.vschema-hint').length`), 0, 'hint on a field without options');
  await ev(`document.activeElement.blur(); 0`);
  await focusValue('status');
  await waitFor(() => ev(`document.querySelector('.vschema-hint')?.textContent`), 'the hint');
  eq(await ev(`document.querySelector('.vschema-hint').textContent`), 'Hold Option for all options', 'hint text on Mac');
  eq(await ev(`document.querySelector('.vschema-hint').getAttribute('role')`), 'status', 'hint role');
  await ev(`document.activeElement.blur(); 0`);
  await sleep(300);
  eq(await ev(`document.querySelectorAll('.vschema-hint').length`), 0, 'hint after leaving the field');
  await ev(`${P}.settings.showHint = false; 0`);
  await focusValue('status');
  await sleep(400);
  eq(await ev(`document.querySelectorAll('.vschema-hint').length`), 0, 'hint with the setting off');
  await ev(`document.activeElement.blur(); ${P}.settings.showHint = true; 0`);
});

await check('P3 typing in a property autocompletes from the note’s schema (native vault suggestions are muted); Enter picks', async () => {
  await focusValue('status');
  await client.send('Input.insertText', { text: 'dr' });
  await waitFor(() => popover(), 'autocomplete');
  const p = await popover();
  eq(p.options, ['draft'], 'only matching schema values');
  eq(p.auto, true, 'autocomplete popover');
  eq(await ev(`document.querySelectorAll('.suggestion-container').length`), 0, 'native suggestions open');
  await press('Enter', 'Enter', 13);
  await waitFor(async () => (await fmLines('Knowledge/Wave.md')).includes('status: draft'), 'Enter to pick draft');
  await sleep(800);
  eq(await popover(), null, 'autocomplete after pick');
  // Regression: the typed fragment must not be committed over the pick when the field is left.
  eq(await ev(`document.querySelector('.metadata-property[data-property-key="status"] .metadata-property-value').textContent`), 'draft', 'field text after pick');
  assert(!(await fmLines('Knowledge/Wave.md')).includes('status: dr'), 'fragment committed over the pick');
});

await check('P3 autocomplete resolves a synonym to its preferred term', async () => {
  await focusValue('tags');
  await client.send('Input.insertText', { text: 'sop' });
  await waitFor(() => popover(), 'autocomplete').catch(async (e) => {
    const d = await ev(`(() => { const p = ${P}; const fc = [...p.layer.fields.values()].find(x => x.key === 'tags'); const row = document.querySelector('.metadata-property[data-property-key="tags"]'); return JSON.stringify({ fc: !!fc, hasList: fc?.hasList, state: fc?.state, rowConnected: fc?.row.isConnected, sameRow: fc?.row === row, active: document.activeElement.className, typed: document.activeElement.textContent, pops: document.querySelectorAll('.vschema-popover').length, modals: document.querySelectorAll('.modal').length }); })()`);
    throw new Error(e.message + ' ' + d);
  });
  const p = await popover();
  eq(p.options, ['procedure'], 'synonym resolved');
  assert(p.notes.some((n) => n.includes('sop')), 'should say it matched sop');
  await escape();
  await sleep(300);
  eq(await popover(), null, 'autocomplete after first Escape');
  await ev(`document.activeElement.blur(); 0`);
});

await check('P3 commands-only switches the Properties features off; the picker window still works', async () => {
  await ev(`(async () => { ${P}.settings.commandsOnly = true; await ${P}.onSettingChanged('commandsOnly'); return 0; })()`);
  await sleep(1200);
  eq(await ev(`document.querySelectorAll('.vschema-chevron').length`), 0, 'chevrons');
  await openNote('Tasks/Review.md');
  await openNote('Knowledge/Wave.md');
  eq(await ev(`document.querySelectorAll('.vschema-chevron, .vschema-locked').length`), 0, 'decorations after reopening');
  await focusValue('status');
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:show-all-options'); 0`);
  await waitFor(() => ev(`!!activeDocument.querySelector('.modal .vschema-option-list')`), 'the picker window');
  const options = await ev(`[...activeDocument.querySelectorAll('.modal .vschema-option-label')].map(e => e.textContent)`);
  eq(options, ['draft', 'review', 'published', 'outdated', 'archived'], 'picker options');
  await ev(`[...activeDocument.querySelectorAll('.modal .vschema-option')].find(o => o.textContent.includes('published')).click(); 0`);
  await waitFor(async () => (await fmLines('Knowledge/Wave.md')).includes('status: published'), 'picker pick to save');
  await closeStrayModals();
  await ev(`(async () => { ${P}.settings.commandsOnly = false; await ${P}.onSettingChanged('commandsOnly'); return 0; })()`);
  await sleep(1200);
});

await check('P3 a locked property in the picker window shows who manages it', async () => {
  await ev(`(async () => { ${P}.settings.commandsOnly = true; await ${P}.onSettingChanged('commandsOnly'); return 0; })()`);
  await sleep(800);
  await openNote('Knowledge/Wave.md');
  await focusValue('id');
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:show-all-options'); 0`);
  await waitFor(() => ev(`!!activeDocument.querySelector('.modal .vschema-lock-note')`), 'lock note');
  assert((await ev(`activeDocument.querySelector('.modal .vschema-lock-note').textContent`)).includes('Vault Schema'), 'wrong note');
  await closeStrayModals();
  await ev(`(async () => { ${P}.settings.commandsOnly = false; await ${P}.onSettingChanged('commandsOnly'); return 0; })()`);
  await sleep(800);
});

await check('P3 source-mode autocomplete suggests schema values after `key: ` and in lists', async () => {
  await openNote('Knowledge/Wave.md');
  // In Live Preview the frontmatter is the Properties widget and the cursor cannot enter it: switch to Source mode.
  await ev(`(async () => { const leaf = app.workspace.getLeavesOfType('markdown')[0]; const st = leaf.getViewState(); st.state.mode = 'source'; st.state.source = true; await leaf.setViewState(st); return 0; })()`);
  await sleep(800);
  const res = await ev(`(async () => {
    const view = app.workspace.getActiveViewOfType(app.workspace.activeLeaf.view.constructor);
    const editor = app.workspace.activeEditor.editor; const file = app.workspace.getActiveFile();
    const suggest = app.workspace.editorSuggest.suggests.find(s => s.plugin && s.plugin.manifest && s.plugin.manifest.id === '${PLUGIN_ID}');
    const lines = editor.getValue().split('\\n'); const out = {};
    const at = (lineText, ch) => { const l = lines.findIndex(x => x.startsWith(lineText)); return { line: l, ch: ch ?? lines[l].length }; };
    editor.setCursor(at('status: '));
    let t = suggest.onTrigger(editor.getCursor(), editor, file); out.status = t ? suggest.getSuggestions({ editor, file, ...t, query: 'ar' }).map(s => s.label) : null;
    editor.setCursor(at('description: ')); t = suggest.onTrigger(editor.getCursor(), editor, file); out.freeText = t;
    editor.setCursor(at('  - procedure')); t = suggest.onTrigger(editor.getCursor(), editor, file); out.tagListItem = t ? suggest.getSuggestions({ editor, file, ...t, query: 'sop' }).map(s => s.label) : null;
    editor.setCursor({ line: lines.length - 1, ch: 0 }); out.body = suggest.onTrigger(editor.getCursor(), editor, file);
    return out; })()`);
  eq(res.status, ['archived'], 'status suggestions for "ar"');
  await ev(`(async () => { const leaf = app.workspace.getLeavesOfType('markdown')[0]; const st = leaf.getViewState(); st.state.mode = 'preview'; st.state.source = false; await leaf.setViewState(st); return 0; })()`);
  eq(res.freeText, null, 'free-text property');
  eq(res.tagListItem, ['procedure'], 'tag list item');
  eq(res.body, null, 'body');
});

// ---------------------------------------------------------------- Phase 4: writes and automation
await ev(`${P}.watcher.enabled = true; 0`);
const modalInfo = () =>
  ev(`(() => { const m = [...activeDocument.querySelectorAll('.modal')].filter(x => !x.querySelector('.vertical-tab-nav-item')).pop(); return m ? { title: m.querySelector('.modal-title')?.textContent, text: m.textContent, buttons: [...m.querySelectorAll('button')].map(b => b.textContent), pre: [...m.querySelectorAll('pre')].map(p => p.textContent) } : null; })()`);
const waitModal = (titlePart) => waitFor(async () => { const m = await modalInfo(); return m && m.title && m.title.includes(titlePart) ? m : null; }, `a dialog titled "${titlePart}"`, 6000);
const nowStamp = () => ev(`(() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); })()`);
const minutesApart = (a, b) => Math.abs(new Date(a + ':00').getTime() - new Date(b + ':00').getTime()) / 60000;
const fm = async (path) => Object.fromEntries((await fmLines(path)).filter((l) => /^[A-Za-z_]+:/.test(l)).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
const YEAR = await ev('new Date().getFullYear()');

await check('P4 create note from schema: ID, created, every default, schema order, created and modified last', async () => {
  await closeStrayModals();
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:create-note-from-schema'); 0`);
  await waitModal('Create note from schema');
  await ev(`(() => { const m = [...activeDocument.querySelectorAll('.modal')].pop(); const sel = m.querySelectorAll('select')[0]; sel.value = 'kb'; sel.dispatchEvent(new Event('change', { bubbles: true })); const t = m.querySelector('input[type=text]'); t.value = 'Created One'; t.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
  await sleep(300);
  await clickButton('Create');
  await waitFor(() => ev(`!!app.vault.getFileByPath('Knowledge/Created One.md')`), 'the note');
  const lines = (await fmLines('Knowledge/Created One.md')).filter(Boolean);
  const f = await fm('Knowledge/Created One.md');
  eq(lines.map((l) => l.split(':')[0]), ['type', 'schema', 'id', 'name', 'status', 'aliases', 'language', 'related', 'supersedes', 'review_cycle', 'kind', 'audience', 'confidence', 'created', 'modified'], 'property order');
  assert(new RegExp(`^KB-${YEAR}-\\d{4}$`).test(f.id), `ID shape: ${f.id}`);
  eq([f.type, f.status, f.kind, f.name, f.schema], ['kb', 'draft', 'concept', 'Created One', '2'], 'values');
  eq(f.created, f.modified, 'created equals modified at creation');
  assert(minutesApart(f.created, await nowStamp()) <= 2, 'created is local time now');
  eq(await ev(`activeDocument.querySelectorAll('.vschema-choice-list').length`), 0, 'no schema prompt for a note that already has an id');
});

await check('P4 an illegal file name is rejected on create (macOS and Windows characters)', async () => {
  await closeStrayModals();
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:create-note-from-schema'); 0`);
  await waitModal('Create note from schema');
  const messages = [];
  for (const bad of ['a:b', 'what?', 'CON', 'end.']) {
    await ev(`(() => { const m = [...activeDocument.querySelectorAll('.modal')].pop(); const t = m.querySelector('input[type=text]'); t.value = ${JSON.stringify(bad)}; t.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
    await sleep(100);
    await clickButton('Create');
    await sleep(200);
    messages.push(await ev(`[...activeDocument.querySelectorAll('.modal')].pop().querySelector('.vschema-error').textContent`));
  }
  assert(messages.every((m) => m.length > 0), `each bad name needs a message: ${JSON.stringify(messages)}`);
  eq(await ev(`app.vault.getMarkdownFiles().filter(f => /^Knowledge\\/(a:b|what|CON|end)/.test(f.path)).length`), 0, 'files created');
  await closeStrayModals();
});

await check('P4 two notes created at once get different numbers; numbering is per type and year', async () => {
  const ids = await ev(`(async () => { const p = ${P}; const [a, b] = await Promise.all([p.ids.exclusive(async () => p.ids.allocate('KB', ${YEAR})), p.ids.exclusive(async () => p.ids.allocate('KB', ${YEAR}))]); const t = p.ids.allocate('TK', ${YEAR}); const next = p.ids.allocate('KB', ${YEAR + 1}); return { a, b, t, next }; })()`);
  assert(ids.a !== ids.b, `same ID twice: ${ids.a}`);
  eq(ids.next, `KB-${YEAR + 1}-0001`, 'a new year restarts at 0001');
  assert(ids.t.startsWith('TK-'), 'prefix per type');
});

await check('P4 modified: an edit stamps once after the pause, with no loop', async () => {
  await write('Knowledge/Stamp.md', '---\ntype: kb\nschema: 2\nid: KB-2026-0900\nname: Stamp\nstatus: draft\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n');
  await sleep(1500);
  await ev(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Knowledge/Stamp.md')).then(() => 0)`);
  await sleep(500);
  await ev(`(() => { window.__mods = []; app.vault.on('modify', f => { if (f.path === 'Knowledge/Stamp.md') window.__mods.push(Date.now()); }); return 0; })()`);
  await write('Knowledge/Stamp.md', (await read('Knowledge/Stamp.md')).replace('body', 'body edited'));
  await sleep(1000);
  eq((await fm('Knowledge/Stamp.md')).modified, '2026-10-20T14:32', 'stamped before the pause ended');
  await waitFor(async () => (await fm('Knowledge/Stamp.md')).modified !== '2026-10-20T14:32', 'the stamp', 6000);
  const m = (await fm('Knowledge/Stamp.md')).modified;
  assert(minutesApart(m, await nowStamp()) <= 2, `stamped local time, got ${m}`);
  eq((await fm('Knowledge/Stamp.md')).created, '2026-10-20T14:32', 'created untouched');
  await sleep(3500);
  eq(await ev('window.__mods.length'), 2, 'file writes: our edit and exactly one stamp');
  eq((await fm('Knowledge/Stamp.md')).modified, m, 'modified changed again (loop)');
});

await check('P4 modified: a burst of edits is stamped once, after it stops', async () => {
  const before = (await fm('Knowledge/Stamp.md')).modified;
  await sleep(61000 - (Date.now() % 60000) + 1500); // cross a minute boundary so a second stamp would show
  await ev(`(() => { window.__mods = []; return 0; })()`);
  for (let i = 0; i < 4; i++) {
    await write('Knowledge/Stamp.md', (await read('Knowledge/Stamp.md')).replace(/body[^\n]*/, `body burst ${i}`));
    await sleep(500);
  }
  await waitFor(async () => (await fm('Knowledge/Stamp.md')).modified !== before, 'the stamp', 6000);
  await sleep(2500);
  eq(await ev('window.__mods.length'), 5, 'four edits plus one stamp');
});

await check('P4 modified: a move, a breadcrumb-only change and the plugin’s own writes do not change it', async () => {
  const fixed = '2026-10-20T14:32';
  await write('Knowledge/Quiet.md', `---\ntype: kb\nschema: 2\nid: KB-2026-0901\nname: Quiet\nstatus: draft\nbreadcrumb: Knowledge\ncreated: ${fixed}\nmodified: ${fixed}\n---\nbody\n`);
  await sleep(1500);
  await ev(`app.fileManager.renameFile(app.vault.getFileByPath('Knowledge/Quiet.md'), 'Projects/Quiet.md').then(() => 0)`).catch(async () => {
    await ev(`app.vault.createFolder('Projects').catch(() => {}).then(() => app.fileManager.renameFile(app.vault.getFileByPath('Knowledge/Quiet.md'), 'Projects/Quiet.md')).then(() => 0)`);
  });
  await sleep(3500);
  eq((await fm('Projects/Quiet.md')).modified, fixed, 'modified after a move');
  await write('Projects/Quiet.md', (await read('Projects/Quiet.md')).replace('breadcrumb: Knowledge', 'breadcrumb: Projects/Alpha'));
  await sleep(3500);
  eq((await fm('Projects/Quiet.md')).modified, fixed, 'modified after a breadcrumb-only change');
  // the plugin's own write (a pick through the queue)
  await ev(`(async () => { const f = app.vault.getFileByPath('Projects/Quiet.md'); await ${P}.queue.set(f, { status: 'review' }); return 0; })()`);
  await sleep(3500);
  eq((await fm('Projects/Quiet.md')).status, 'review', 'the pick');
  eq((await fm('Projects/Quiet.md')).modified, fixed, 'modified after our own write');
});

await check('P4 modified: a change arriving with a newer modified inside is accepted as it is (sync); one without gets stamped', async () => {
  await write('Knowledge/Sync.md', '---\ntype: kb\nschema: 2\nid: KB-2026-0902\nname: Sync\nstatus: draft\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n');
  await sleep(1500);
  await write('Knowledge/Sync.md', '---\ntype: kb\nschema: 2\nid: KB-2026-0902\nname: Sync\nstatus: draft\ncreated: 2026-10-20T14:32\nmodified: 2026-11-30T08:15\n---\nbody changed elsewhere\n');
  await sleep(4000);
  eq((await fm('Knowledge/Sync.md')).modified, '2026-11-30T08:15', 'the incoming modified was overwritten');
  await write('Knowledge/Sync.md', (await read('Knowledge/Sync.md')).replace('changed elsewhere', 'changed again'));
  await waitFor(async () => (await fm('Knowledge/Sync.md')).modified !== '2026-11-30T08:15', 'a stamp for the change without a new modified', 6000);
});

await check('P4 modified: switched off by the setting', async () => {
  await ev(`${P}.settings.stampModified = false; 0`);
  const before = (await fm('Knowledge/Sync.md')).modified;
  await write('Knowledge/Sync.md', (await read('Knowledge/Sync.md')).replace('changed again', 'changed thrice'));
  await sleep(3500);
  eq((await fm('Knowledge/Sync.md')).modified, before, 'stamped with the setting off');
  await ev(`${P}.settings.stampModified = true; 0`);
});

await check('P4 excluded notes are never stamped', async () => {
  await write('Templates/T2.md', '---\nid: KB-2026-0903\nmodified: 2026-10-20T14:32\n---\nbody\n');
  await sleep(1500);
  await write('Templates/T2.md', '---\nid: KB-2026-0903\nmodified: 2026-10-20T14:32\n---\nbody 2\n');
  await sleep(3500);
  eq((await fm('Templates/T2.md')).modified, '2026-10-20T14:32', 'modified in an excluded folder');
});

await check('P4 tag synonyms ask first, showing old and new; Replace writes the preferred term', async () => {
  await write('Knowledge/Tagged.md', '---\ntype: kb\nschema: 2\nid: KB-2026-0904\nname: Tagged\nstatus: draft\ntags:\n  - idea\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n');
  await sleep(1500);
  await ev(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Knowledge/Tagged.md')).then(() => 0)`);
  await sleep(800);
  await write('Knowledge/Tagged.md', (await read('Knowledge/Tagged.md')).replace('  - idea', '  - idea\n  - sop'));
  const m = await waitModal('Replace tag synonyms');
  assert(m.pre.join('\n').includes('sop → procedure'), `preview should show old and new: ${m.pre}`);
  assert((await fmLines('Knowledge/Tagged.md')).includes('  - sop'), 'replaced before approval');
  await clickButton('Replace');
  await waitFor(async () => (await fmLines('Knowledge/Tagged.md')).includes('  - procedure'), 'the replacement');
  assert(!(await fmLines('Knowledge/Tagged.md')).includes('  - sop'), 'synonym still there');
});

await check('P4 an unknown tag asks: Add to vocabulary writes one term and keeps comments; Cancel changes nothing and is not repeated', async () => {
  await write('Knowledge/Tagged.md', (await read('Knowledge/Tagged.md')).replace('  - idea', '  - idea\n  - mystery'));
  const m = await waitModal('Add “mystery” to the tags vocabulary');
  assert(m.buttons.includes('Add to vocabulary') && m.buttons.includes('Cancel'), `buttons: ${m.buttons}`);
  await clickButton('Add to vocabulary');
  await waitFor(async () => (await read('_schema/vocabularies/tags.yaml')).includes('mystery'), 'the vocabulary file');
  assert((await read('_schema/vocabularies/tags.yaml')).includes('# Controlled tags.'), 'vocabulary comments lost');
  await waitFor(() => ev(`${P}.schemas.pack.vocabularies.get('tags').lookup.has('mystery')`), 'the vocabulary to reload');
  assert((await fmLines('Knowledge/Tagged.md')).includes('  - mystery'), 'the tag was removed from the note');
  // cancel path
  await write('Knowledge/Tagged.md', (await read('Knowledge/Tagged.md')).replace('  - idea', '  - idea\n  - nonsense'));
  await waitModal('Add “nonsense” to the tags vocabulary');
  await clickButton('Cancel');
  await sleep(500);
  assert((await fmLines('Knowledge/Tagged.md')).includes('  - nonsense'), 'cancel changed the note');
  assert(!(await read('_schema/vocabularies/tags.yaml')).includes('nonsense'), 'cancel wrote the vocabulary');
  await write('Knowledge/Tagged.md', (await read('Knowledge/Tagged.md')).replace('body', 'body 2'));
  await sleep(3500);
  eq(await ev(`[...activeDocument.querySelectorAll('.modal')].filter(m => /nonsense/.test(m.textContent)).length`), 0, 'asked again for the same tag');
});

await check('P4 an invalid status asks with the allowed values as choices', async () => {
  await write('Knowledge/Tagged.md', (await read('Knowledge/Tagged.md')).replace('status: draft', 'status: live'));
  const m = await waitModal('is not a kb status');
  for (const v of ['draft', 'review', 'published', 'outdated', 'archived']) assert(m.buttons.includes(v), `missing choice ${v}: ${m.buttons}`);
  await clickButton('review');
  await waitFor(async () => (await fmLines('Knowledge/Tagged.md')).includes('status: review'), 'the chosen status');
});

await check('P4 changing `type` previews the conversion; Convert keeps every old value in archived_fields and deletes nothing', async () => {
  await write('Knowledge/Conv.md', '---\ntype: kb\nschema: 2\nid: KB-2026-0905\nname: Conv\nstatus: published\ntags:\n  - idea\nlanguage: en-GB\nkind: how-to\naudience: team\nconfidence: high\nmy_custom: keep me\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n');
  await sleep(1500);
  await ev(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Knowledge/Conv.md')).then(() => 0)`);
  await sleep(800);
  await write('Knowledge/Conv.md', (await read('Knowledge/Conv.md')).replace('type: kb', 'type: task'));
  const m = await waitModal('Convert “Conv” from kb to task');
  const pre = m.pre.join('\n');
  assert(pre.includes('priority: 3') && pre.includes('status: todo'), `added defaults should show: ${pre}`);
  assert(pre.includes('kind: how-to') && pre.includes('status: published'), `archived values should show: ${pre}`);
  assert((await fmLines('Knowledge/Conv.md')).includes('type: task'), 'precondition');
  await clickButton('Convert');
  await waitFor(async () => (await read('Knowledge/Conv.md')).includes('archived_fields'), 'archived_fields');
  const text = await read('Knowledge/Conv.md');
  for (const kept of ['kind: how-to', 'audience: team', 'confidence: high', 'status: published', 'my_custom: keep me', 'id: KB-2026-0905']) assert(text.includes(kept), `value lost: ${kept}`);
  const f = await fm('Knowledge/Conv.md');
  eq([f.type, f.status, f.priority], ['task', 'todo', '3'], 'new type values');
  const keys = (await fmLines('Knowledge/Conv.md')).filter((l) => /^[a-z_]+:/.test(l)).map((l) => l.split(':')[0]);
  eq(keys.slice(-3), ['archived_fields', 'created', 'modified'], 'archived_fields sits before created and modified');
  assert(text.endsWith('---\nbody\n'), 'body changed');
});

await check('P4 "Not now" on a conversion changes nothing and does not ask again', async () => {
  await write('Knowledge/Conv.md', (await read('Knowledge/Conv.md')).replace('type: task', 'type: project'));
  await waitModal('Convert “Conv” from task to project');
  await clickButton('Not now');
  await sleep(500);
  assert((await fmLines('Knowledge/Conv.md')).includes('type: project'), 'precondition');
  // the note now carries a task status that a project does not allow: a separate, legitimate prompt on the next change
  await write('Knowledge/Conv.md', (await read('Knowledge/Conv.md')).replace('body', 'body 1'));
  await waitModal('is not a project status');
  await clickButton('Not now');
  await sleep(300);
  assert(!(await read('Knowledge/Conv.md')).includes('priority: 3\n  '), 'unexpected change');
  await write('Knowledge/Conv.md', (await read('Knowledge/Conv.md')).replace('body', 'body 2'));
  await sleep(3500);
  eq(await ev(`[...activeDocument.querySelectorAll('.modal')].filter(m => /Convert/.test(m.textContent)).length`), 0, 'asked again');
});

await check('P4 the convert command works from the palette', async () => {
  await write('Knowledge/Cmd.md', '---\ntype: kb\nschema: 2\nid: KB-2026-0906\nname: Cmd\nstatus: draft\nkind: faq\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n');
  await sleep(1500);
  await ev(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Knowledge/Cmd.md')).then(() => 0)`);
  await sleep(800);
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:convert-note-type'); 0`);
  await waitModal('Convert “Cmd”');
  await ev(`[...activeDocument.querySelectorAll('.vschema-choice')].find(l => l.textContent === 'task').querySelector('input').click(); 0`);
  await sleep(100);
  await clickButton('Preview');
  await waitModal('Convert “Cmd” from kb to task');
  await clickButton('Convert');
  await waitFor(async () => (await read('Knowledge/Cmd.md')).includes('archived_fields'), 'the conversion');
  assert((await read('Knowledge/Cmd.md')).includes('kind: faq'), 'kind lost');
});

await check('P4 a move that changes the first breadcrumb segment asks to convert; the preview equals what is written', async () => {
  await write('Knowledge/Mover.md', '---\ntype: kb\nschema: 2\nid: KB-2026-0907\nname: Mover\nstatus: draft\nbreadcrumb: Knowledge/Physics\nkind: concept\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n');
  await sleep(1500);
  await ev(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Knowledge/Mover.md')).then(() => 0)`);
  await sleep(800);
  await ev(`app.fileManager.renameFile(app.vault.getFileByPath('Knowledge/Mover.md'), 'Tasks/Mover.md').then(() => 0)`);
  await sleep(500);
  await write('Tasks/Mover.md', (await read('Tasks/Mover.md')).replace('breadcrumb: Knowledge/Physics', 'breadcrumb: Tasks/Today'));
  const m = await waitModal('Convert “Mover” from kb to task');
  const before = await read('Tasks/Mover.md');
  await clickButton('Convert');
  await waitFor(async () => (await read('Tasks/Mover.md')).includes('type: task'), 'the conversion');
  const after = await read('Tasks/Mover.md');
  const shown = m.pre[m.pre.length - 1].split('\n');
  for (const line of shown) {
    const key = line.replace(/^[+-]\s*/, '').split(':')[0];
    assert(after.includes(key + ':') || line.startsWith('-'), `a previewed change was not written: ${line}`);
  }
  assert(after.includes('breadcrumb: Tasks/Today'), 'the breadcrumb must stay as the breadcrumb plugin wrote it');
  assert(before !== after, 'nothing was written');
});

await check('P4 a one-off schema choice (remember off) adds the type’s properties after a preview', async () => {
  await ev(`app.vault.createFolder('Loose').catch(() => {}).then(() => 0)`);
  await ev(`app.vault.create('Loose/Solo.md', '').then(() => 0)`);
  await waitFor(() => choiceShown(), 'the schema prompt', 6000);
  await ev(`[...activeDocument.querySelectorAll('.vschema-choice')].find(l => l.textContent === 'task').querySelector('input').click(); 0`);
  await ev(`(() => { const m = [...activeDocument.querySelectorAll('.modal')].pop(); const t = m.querySelector('.checkbox-container'); if (t.classList.contains('is-enabled')) t.click(); return 0; })()`);
  await sleep(200);
  await clickButton('Apply');
  const m = await waitModal('Add task properties');
  assert(m.pre.join('\n').includes('+ id: TK-'), `the preview should show the ID it will use: ${m.pre}`);
  eq(await ev(`activeDocument.querySelectorAll('.vschema-choice-list').length`), 0, 'prompt still open');
  assert((await read('Loose/Solo.md')) === '', 'written before approval');
  await clickButton('Add properties');
  await waitFor(async () => (await read('Loose/Solo.md')).includes('id: TK-'), 'the properties');
  const f = await fm('Loose/Solo.md');
  eq([f.type, f.status, f.priority, f.name], ['task', 'todo', '3', 'Solo'], 'values');
  assert(!(await read('_schema/registry/folders.yaml')).includes('Loose'), 'folder mapping written although remember was off');
});

await check('P4 unchanged notes are never rewritten', async () => {
  const mtimeBefore = await ev(`app.vault.adapter.stat('Knowledge/Created One.md').then(s => s.mtime)`);
  await sleep(1100);
  const out = await ev(`${P}.queue.set(app.vault.getFileByPath('Knowledge/Created One.md'), { status: 'draft', kind: 'concept' }).then(o => o)`);
  eq(out.written, false, 'written flag');
  eq(await ev(`app.vault.adapter.stat('Knowledge/Created One.md').then(s => s.mtime)`), mtimeBefore, 'mtime changed');
});

// ---------------------------------------------------------------- Phase 5: vault check and migration
await closeStrayModals();
const nm = (title, extra = '', over = {}) => {
  const base = { type: 'kb', schema: 2, id: null, name: title, status: 'draft', breadcrumb: 'Knowledge/Physics', created: '2026-01-05T10:00', modified: '2026-12-31T10:00', ...over };
  const lines = Object.entries(base).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n${extra}---\nbody\n`;
};
const seed = async () => {
  await write('Knowledge/V5 NoId.md', nm('V5 NoId'));
  await write('Knowledge/V5 NoCreated.md', nm('V5 NoCreated', '', { id: 'KB-2026-0701', created: null }));
  await write('Knowledge/V5 BadStatus.md', nm('V5 BadStatus', '', { id: 'KB-2026-0702', status: 'live' }));
  await write('Knowledge/V5 OldId.md', nm('V5 OldId', '', { id: 'KB-000146', created: '2026-02-03T09:00' }));
  await write('Knowledge/V5 DupA.md', nm('V5 DupA', '', { id: 'KB-2026-0777', created: '2026-01-01T10:00' }));
  await write('Knowledge/V5 DupB.md', nm('V5 DupB', '', { id: 'KB-2026-0777', created: '2026-02-01T10:00' }));
  await write('Knowledge/V5 Syn.md', nm('V5 Syn', 'tags:\n  - sop\n', { id: 'KB-2026-0703' }));
  await write('Knowledge/V5 Unknown.md', nm('V5 Unknown', 'tags:\n  - xyzzy\n', { id: 'KB-2026-0704' }));
  await write('Knowledge/V5 Body.md', nm('V5 Body', '', { id: 'KB-2026-0705' }).replace('body\n', 'Notes on #sop and #ghosts here.\n'));
  await write('Knowledge/V5 NameMismatch.md', nm('V5 NameMismatch', '', { id: 'KB-2026-0706', name: 'Something else' }));
  await write('Knowledge/V5 NoCrumb.md', nm('V5 NoCrumb', '', { id: 'KB-2026-0707', breadcrumb: null }));
  await write('Knowledge/V5 BadCrumb.md', nm('V5 BadCrumb', '', { id: 'KB-2026-0708', breadcrumb: 'Nonsense/x' }));
  await write('Knowledge/V5 Domain.md', nm('V5 Domain', 'domain: Knowledge\n', { id: 'KB-2026-0709' }));
  await write('Knowledge/V5 Time.md', nm('V5 Time', '', { id: 'KB-2026-0710', created: '2026-09-01T10:00', modified: '2026-08-01T10:00' }));
  for (const n of [1, 2, 3]) {
    await write(`Knowledge/V5 Old${n}.md`, nm(`V5 Old${n}`, `source:\n  title: Lectures ${n}\n  author: Feynman\n  notes: free text\nreview:\n  cycle: 3-months\n  last: 2026-01-01\ndomain: Elsewhere\n`, { schema: 1, id: `KB-00020${n}`, created: '2026-02-03T09:00', modified: '2026-02-04T09:00' }));
  }
};
const V5 = ['V5 NoId', 'V5 NoCreated', 'V5 BadStatus', 'V5 OldId', 'V5 DupA', 'V5 DupB', 'V5 Syn', 'V5 Unknown', 'V5 Body', 'V5 NameMismatch', 'V5 NoCrumb', 'V5 BadCrumb', 'V5 Domain', 'V5 Time', 'V5 Old1', 'V5 Old2', 'V5 Old3'];
const hashAll = () => ev(`(async () => { const out = {}; for (const f of app.vault.getMarkdownFiles()) if (f.basename.startsWith('V5 ')) out[f.path] = await app.vault.adapter.read(f.path); return out; })()`);
const report = () => ev(`(() => { const out = {}; const m = document.querySelector('.mod-vschema-check'); for (const sec of m.querySelectorAll('.vschema-section')) { const t = sec.querySelector('h4 a')?.textContent; if (!t) continue; out[t] = [...sec.querySelectorAll('.vschema-finding')].map(r => r.dataset.code); } return { summary: m.querySelector('.vschema-check-summary').textContent, notes: out, globals: [...m.querySelectorAll('.vschema-section')].filter(s => !s.querySelector('h4 a')).flatMap(s => [...s.querySelectorAll('.vschema-finding-msg')].map(e => e.textContent)) }; })()`);
const openCheck = async () => {
  await closeStrayModals();
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:check-vault'); 0`);
  await waitFor(() => ev(`!!document.querySelector('.mod-vschema-check')`), 'the report window');
  await waitFor(() => ev(`!/Scanning/.test(document.querySelector('.vschema-check-summary').textContent)`), 'the scan to finish', 15000);
  await sleep(300);
};
const clickFix = (note, code, label) =>
  ev(`(() => { const m = document.querySelector('.mod-vschema-check'); const sec = [...m.querySelectorAll('.vschema-section')].find(s => s.querySelector('h4 a')?.textContent === ${JSON.stringify(note)}); if (!sec) throw new Error('no section for ${note}; have: ' + [...m.querySelectorAll('.vschema-section h4 a')].map(a => a.textContent).join(', ')); const row = [...sec.querySelectorAll('.vschema-finding')].find(r => r.dataset.code === ${JSON.stringify(code)}); if (!row) throw new Error('no ${code} for ${note}; have: ' + [...sec.querySelectorAll('.vschema-finding')].map(r => r.dataset.code)); const b = [...row.querySelectorAll('button')].find(x => x.textContent === ${JSON.stringify(label)}); if (!b) throw new Error('no button ${label}; have: ' + [...row.querySelectorAll('button')].map(x => x.textContent)); b.click(); return row.querySelector('.vschema-finding-msg').textContent; })()`);
const findingMsg = (note, code) =>
  ev(`(() => { const m = document.querySelector('.mod-vschema-check'); const sec = [...m.querySelectorAll('.vschema-section')].find(s => s.querySelector('h4 a')?.textContent === ${JSON.stringify(note)}); if (!sec) return null; const row = [...sec.querySelectorAll('.vschema-finding')].find(r => r.dataset.code === ${JSON.stringify(code)}); return row ? { msg: row.querySelector('.vschema-finding-msg').textContent, pre: row.querySelector('pre')?.textContent ?? null, buttons: [...row.querySelectorAll('button')].map(b => b.textContent) } : null; })()`);
const gone = (note, code) => waitFor(async () => !(await findingMsg(note, code)), `${note}/${code} to disappear`, 6000);

await seed();
await sleep(4000); // let the first-seen index and baselines settle

await check('P5 the vault check window finds a seeded problem for each check and writes nothing', async () => {
  const before = await hashAll();
  await openCheck();
  const r = await report();
  const want = {
    'V5 NoId': 'missing-id', 'V5 NoCreated': 'missing-created', 'V5 BadStatus': 'value-enum', 'V5 OldId': 'old-id', 'V5 DupB': 'duplicate-id',
    'V5 Syn': 'tag-synonym', 'V5 Unknown': 'tag-unknown', 'V5 Body': 'body-tag-synonym', 'V5 NameMismatch': 'name-mismatch', 'V5 NoCrumb': 'no-breadcrumb',
    'V5 BadCrumb': 'breadcrumb-unmapped', 'V5 Domain': 'leftover-domain', 'V5 Time': 'created-after-modified', 'V5 Old1': 'old-schema',
  };
  for (const [title, code] of Object.entries(want)) assert((r.notes[title] ?? []).includes(code), `${title} should have ${code}, has ${JSON.stringify(r.notes[title])}`);
  assert(!r.notes['V5 DupA'], 'the older duplicate must keep its ID and have no finding');
  assert(/notes scanned/.test(r.summary) && /need you/.test(r.summary), `summary: ${r.summary}`);
  eq(await hashAll(), before, 'files changed by a scan');
});

await check('P5 fixes show exactly what they will write; nothing is written before the button is pressed', async () => {
  const noId = await findingMsg('V5 NoId', 'missing-id');
  const idNoId = /KB-\d{4}-\d{4}/.exec(noId.msg)[0];
  assert(!(await read('Knowledge/V5 NoId.md')).includes('id: KB'), 'written before approval');
  await clickFix('V5 NoId', 'missing-id', 'Assign ID');
  await gone('V5 NoId', 'missing-id');
  eq((await fm('Knowledge/V5 NoId.md')).id, idNoId, 'the ID that was shown is the ID that was written');

  await clickFix('V5 BadStatus', 'value-enum', 'review');
  await gone('V5 BadStatus', 'value-enum');
  eq((await fm('Knowledge/V5 BadStatus.md')).status, 'review', 'status');

  await clickFix('V5 OldId', 'old-id', 'Convert ID');
  await gone('V5 OldId', 'old-id');
  eq((await fm('Knowledge/V5 OldId.md')).id, 'KB-2026-0146', 'converted ID');

  const created = await findingMsg('V5 NoCreated', 'missing-created');
  assert(created.msg.includes('estimated'), `should be listed as estimated: ${created.msg}`);
  await clickFix('V5 NoCreated', 'missing-created', 'Fill created');
  await gone('V5 NoCreated', 'missing-created');
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test((await fm('Knowledge/V5 NoCreated.md')).created), 'created format');

  await clickFix('V5 NameMismatch', 'name-mismatch', 'Set name to the file name');
  await gone('V5 NameMismatch', 'name-mismatch');
  eq((await fm('Knowledge/V5 NameMismatch.md')).name, 'V5 NameMismatch', 'name');

  await clickFix('V5 Domain', 'leftover-domain', 'Remove domain');
  await gone('V5 Domain', 'leftover-domain');
  assert(!(await read('Knowledge/V5 Domain.md')).includes('domain:'), 'domain still there');
});

await check('P5 duplicate IDs: the older note keeps its ID, the newer gets the next free number, never reused', async () => {
  const dup = await findingMsg('V5 DupB', 'duplicate-id');
  const newId = /will get (KB-\d{4}-\d{4})/.exec(dup.msg)[1];
  assert(newId !== 'KB-2026-0777', 'no new number');
  await clickFix('V5 DupB', 'duplicate-id', 'Renumber');
  await gone('V5 DupB', 'duplicate-id');
  eq((await fm('Knowledge/V5 DupB.md')).id, newId, 'newer note');
  eq((await fm('Knowledge/V5 DupA.md')).id, 'KB-2026-0777', 'older note');
  assert(await ev(`${P}.settings.retiredIds.includes('KB-2026-0777')`), 'the renumbered ID must be retired');
});

await check('P5 tags: synonym replace, one-click vocabulary add (comments kept), body tag only with approval', async () => {
  await clickFix('V5 Syn', 'tag-synonym', 'Replace');
  await gone('V5 Syn', 'tag-synonym');
  assert((await fmLines('Knowledge/V5 Syn.md')).includes('  - procedure'), 'synonym not replaced');
  await clickFix('V5 Unknown', 'tag-unknown', 'Add to vocabulary');
  await gone('V5 Unknown', 'tag-unknown');
  assert((await read('_schema/vocabularies/tags.yaml')).includes('xyzzy') && (await read('_schema/vocabularies/tags.yaml')).includes('# Controlled tags.'), 'vocabulary');
  assert((await read('Knowledge/V5 Body.md')).includes('#sop'), 'body changed before approval');
  const body = await findingMsg('V5 Body', 'body-tag-unknown');
  assert(body && body.buttons.length === 0, 'an unknown body tag is only reported');
  await clickFix('V5 Body', 'body-tag-synonym', 'Replace in the note');
  await gone('V5 Body', 'body-tag-synonym');
  const text = await read('Knowledge/V5 Body.md');
  assert(text.includes('#procedure') && text.includes('#ghosts'), `body: ${text}`);
});

await check('P5 migration: exact diff shown, then flat properties, archived_fields where info would be lost, created and modified last', async () => {
  const f = await findingMsg('V5 Old1', 'old-schema');
  assert(f.pre.includes('source_title: Lectures 1') && f.pre.includes('schema: 1 → 2') && f.pre.includes('id: KB-000201 → KB-2026-0201'), `diff: ${f.pre}`);
  assert((await read('Knowledge/V5 Old1.md')).includes('source:'), 'written before approval');
  await clickFix('V5 Old1', 'old-schema', 'Apply migration');
  await gone('V5 Old1', 'old-schema');
  const text = await read('Knowledge/V5 Old1.md');
  const f1 = await fm('Knowledge/V5 Old1.md');
  eq([f1.schema, f1.id, f1.source_title, f1.source_author, f1.review_cycle, f1.review_last], ['2', 'KB-2026-0201', 'Lectures 1', 'Feynman', '3-months', '2026-01-01'], 'flattened values');
  assert(!/^source:/m.test(text) && !/^review:/m.test(text) && !/^domain:/m.test(text), 'nested blocks or domain remain');
  assert(text.includes('archived_fields') && text.includes('free text') && text.includes('Elsewhere'), 'the information that does not fit was lost');
  const keys = (await fmLines('Knowledge/V5 Old1.md')).filter((l) => /^[a-z_]+:/.test(l)).map((l) => l.split(':')[0]);
  eq(keys.slice(-3), ['archived_fields', 'created', 'modified'], 'created and modified last');
  eq([f1.created, f1.modified], ['2026-02-03T09:00', '2026-02-04T09:00'], 'timestamps kept');
});

await check('P5 migrate all notes of a type: one approval, progress, every note written from its own diff', async () => {
  const label = await ev(`[...document.querySelectorAll('.mod-vschema-check .setting-item-name')].map(e => e.textContent).find(t => /^Migrate all kb notes/.test(t))`);
  assert(label, 'the batch button should offer both remaining kb notes');
  await ev(`[...document.querySelectorAll('.mod-vschema-check .setting-item')].find(r => /^Migrate all kb notes/.test(r.querySelector('.setting-item-name').textContent)).querySelector('button').click(); 0`);
  await waitModal('Migrate 2 kb notes');
  assert(!(await read('Knowledge/V5 Old2.md')).includes('schema: 2'), 'written before approval');
  await clickButton('Migrate');
  await waitFor(async () => (await fm('Knowledge/V5 Old3.md')).schema === '2' && (await fm('Knowledge/V5 Old2.md')).schema === '2', 'both notes to migrate', 10000);
  eq([(await fm('Knowledge/V5 Old2.md')).source_title, (await fm('Knowledge/V5 Old3.md')).source_title], ['Lectures 2', 'Lectures 3'], 'flattened');
  const prog = await ev(`document.querySelector('.vschema-progress').textContent`);
  assert(/Migrated 2 of 2/.test(prog), `progress text: ${prog}`);
});

await check('P5 running the check again leaves no problem on the seeded notes (warnings without a fix remain)', async () => {
  await ev(`[...document.querySelectorAll('.mod-vschema-check button')].find(b => b.textContent === 'Run again').click(); 0`);
  await sleep(500);
  await waitFor(() => ev(`!/Scanning/.test(document.querySelector('.vschema-check-summary').textContent)`), 'the rescan', 15000);
  const r = await report();
  const left = Object.entries(r.notes).filter(([t]) => t.startsWith('V5 ')).map(([t, codes]) => `${t}: ${codes.join(',')}`);
  const expected = ['V5 NoCrumb: no-breadcrumb', 'V5 BadCrumb: breadcrumb-unmapped', 'V5 Time: created-after-modified', 'V5 Body: body-tag-unknown'];
  eq(left.sort(), expected.sort(), 'remaining findings');
});

await check('P5 an ID changed outside the plugin is noticed from the local index and can be restored', async () => {
  await closeStrayModals();
  await write('Knowledge/V5 Idx.md', nm('V5 Idx', '', { id: 'KB-2026-0801' }));
  await sleep(4500); // first sight goes into the index
  await write('Knowledge/V5 Idx.md', (await read('Knowledge/V5 Idx.md')).replace('KB-2026-0801', 'KB-2026-0802'));
  await sleep(1500);
  await openCheck();
  const f = await findingMsg('V5 Idx', 'id-changed');
  assert(f && f.msg.includes('KB-2026-0801') && f.buttons.includes('Restore KB-2026-0801') && f.buttons.includes('Accept the new ID'), `finding: ${JSON.stringify(f)}`);
  await clickFix('V5 Idx', 'id-changed', 'Restore KB-2026-0801');
  await gone('V5 Idx', 'id-changed');
  eq((await fm('Knowledge/V5 Idx.md')).id, 'KB-2026-0801', 'restored');
});

await check('P5 schema problems are listed with file and line', async () => {
  const orig = await read('_schema/modules/review.yaml');
  try {
    await write('_schema/modules/review.yaml', orig.replace('default: 6-months', 'default: 9-months'));
    await waitFor(() => ev(`${P}.schemas.status.problems.some(p => p.code === 'bad-default')`), 'the schema reload');
    await ev(`[...document.querySelectorAll('.mod-vschema-check button')].find(b => b.textContent === 'Run again').click(); 0`);
    await sleep(500);
    await waitFor(() => ev(`!/Scanning/.test(document.querySelector('.vschema-check-summary').textContent)`), 'the rescan', 15000);
    const r = await report();
    assert(r.globals.some((g) => /9-months/.test(g) && /modules\/review\.yaml:\d+/.test(g)), `globals: ${JSON.stringify(r.globals)}`);
  } finally {
    await write('_schema/modules/review.yaml', orig);
    await waitFor(() => ev(`${P}.schemas.status.problems.length === 0`), 'schema recovery');
  }
  await closeStrayModals();
});

await check('P5 batch mode: a folder reorganisation of many notes is processed once, with progress', async () => {
  await closeStrayModals();
  await ev(`app.vault.createFolder('Knowledge/Batch').catch(() => {}).then(() => 0)`);
  const N = 12;
  for (let i = 1; i <= N; i++) await write(`Knowledge/Batch/B${i}.md`, nm(`B${i}`, '', { id: `KB-2026-09${String(i).padStart(2, '0')}`, breadcrumb: 'Knowledge/Batch', kind: 'faq' }));
  await sleep(3000);
  const stampsBefore = {};
  for (let i = 1; i <= N; i++) stampsBefore[i] = (await fm(`Knowledge/Batch/B${i}.md`)).modified;
  // the folder moves (many rename events) and the breadcrumb plugin rewrites each breadcrumb
  await ev(`(async () => { await app.vault.createFolder('Tasks').catch(() => {}); await app.fileManager.renameFile(app.vault.getFolderByPath('Knowledge/Batch'), 'Tasks/Batch'); return 0; })()`);
  await sleep(600);
  for (let i = 1; i <= N; i++) await write(`Tasks/Batch/B${i}.md`, (await read(`Tasks/Batch/B${i}.md`)).replace('breadcrumb: Knowledge/Batch', 'breadcrumb: Tasks/Batch'));
  const m = await waitModal('Convert 12 notes');
  assert(m.text.includes('kb → task (12)'), `one window should group all twelve: ${m.text.slice(0, 200)}`);
  eq(await ev(`[...activeDocument.querySelectorAll('.modal')].filter(x => /Convert/.test(x.textContent)).length`), 1, 'windows');
  for (let i = 1; i <= N; i++) assert((await fm(`Tasks/Batch/B${i}.md`)).type === 'kb', 'written before approval');
  await clickButton('Convert 12 notes');
  await waitFor(async () => { for (let i = 1; i <= N; i++) if ((await fm(`Tasks/Batch/B${i}.md`)).type !== 'task') return false; return true; }, 'all twelve conversions', 20000);
  await sleep(1500);
  for (let i = 1; i <= N; i++) {
    const text = await read(`Tasks/Batch/B${i}.md`);
    assert(text.includes('archived_fields') && text.includes('faq'), `B${i} lost kind`);
    eq((await fm(`Tasks/Batch/B${i}.md`)).modified, stampsBefore[i], `B${i} modified changed by a move, a breadcrumb rewrite or a conversion`);
  }
  eq(await ev(`[...activeDocument.querySelectorAll('.modal')].filter(x => /Convert|status/.test(x.textContent)).length`), 0, 'a second window appeared');
});

await check('P5 batch mode: many edits are each stamped once, one after another, with a progress notice', async () => {
  const N = 12;
  await ev(`(() => { window.__noticeTexts = new Set(); window.__writes = {}; new MutationObserver(() => { for (const n of document.querySelectorAll('.notice')) window.__noticeTexts.add(n.textContent); }).observe(document.body, { childList: true, subtree: true, characterData: true }); app.vault.on('modify', f => { window.__writes[f.path] = (window.__writes[f.path] ?? 0) + 1; }); return 0; })()`);
  for (let i = 1; i <= N; i++) await write(`Tasks/Batch/B${i}.md`, (await read(`Tasks/Batch/B${i}.md`)).replace('body', 'edited'));
  await waitFor(async () => { for (let i = 1; i <= N; i++) if ((await fm(`Tasks/Batch/B${i}.md`)).modified === '2026-12-31T10:00') return false; return true; }, 'every note to be stamped', 25000);
  await sleep(3000);
  const writes = await ev('window.__writes');
  for (let i = 1; i <= N; i++) eq(writes[`Tasks/Batch/B${i}.md`], 2, `writes to B${i} (our edit and exactly one stamp)`);
  const texts = await ev('[...window.__noticeTexts]');
  assert(texts.some((t) => /Stamping modified: \d+ of \d+ notes/.test(t)), `a progress notice should have shown: ${JSON.stringify(texts.slice(0, 5))}`);
  eq(await strayModals(), 0, 'dialogs');
});

// ---------------------------------------------------------------- Phase 6: hardening
await check('P6 only the three release files are installed, and the bundle has no eval, network or storage use', async () => {
  const files = await ev(`app.vault.adapter.list('.obsidian/plugins/${PLUGIN_ID}').then(l => l.files.map(f => f.split('/').pop()).sort())`);
  eq(files.filter((f) => f !== 'data.json'), ['main.js', 'manifest.json', 'styles.css'], 'plugin folder');
  const js = await ev(`app.vault.adapter.read('.obsidian/plugins/${PLUGIN_ID}/main.js')`);
  for (const bad of ['eval(', 'new Function', 'innerHTML', 'XMLHttpRequest', 'fetch(', 'localStorage']) assert(!js.includes(bad), `bundle contains ${bad}`);
});

await check('P6 latched single-choice pick saves at once and keeps the list open', async () => {
  await ev(`${P}.watcher.enabled = false; 0`);
  await openNote('Knowledge/Wave.md');
  await focusValue('status');
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:show-all-options'); 0`);
  await waitFor(() => popover(), 'the latched list');
  await ev(`[...document.querySelectorAll('.vschema-option')].find(o => o.textContent.includes('outdated')).click(); 0`);
  await waitFor(async () => (await fmLines('Knowledge/Wave.md')).includes('status: outdated'), 'the pick to save');
  await sleep(500);
  const p = await popover();
  assert(p, 'the latched list closed after a single-choice pick');
  eq(p.checked, ['outdated'], 'tick moved');
  await escape();
  await sleep(300);
  await ev(`${P}.watcher.enabled = true; 0`);
});

await check('P6 an Obsidian update that removes the widget layer: one notice, no errors, commands still work', async () => {
  await ev(`(() => { ${P}.layer.uninstall(); return 0; })()`);
  await sleep(500);
  const before = consoleErrors.length;
  // Swap the internals only for the span of one synchronous call, so just the plugin's detection sees a manager without the features.
  await ev(`(() => { const real = app.metadataTypeManager; app.metadataTypeManager = {}; try { ${P}.syncLayer(); ${P}.syncLayer(); ${P}.syncLayer(); } finally { app.metadataTypeManager = real; } return 0; })()`);
  await sleep(300);
  const notices = await ev(`[...activeDocument.querySelectorAll('.notice')].filter(n => /Properties area features are unavailable/.test(n.textContent)).length`);
  eq(notices, 1, 'notices after three attempts');
  eq(await ev(`${P}.layer.installed`), false, 'layer installed');
  eq(consoleErrors.length, before, 'console errors');
  // the picker window still works
  await openNote('Knowledge/Wave.md');
  await focusValue('status');
  await ev(`app.commands.executeCommandById('${PLUGIN_ID}:show-all-options'); 0`);
  await waitFor(() => ev(`!!activeDocument.querySelector('.modal .vschema-option-list')`), 'the picker window');
  await closeStrayModals();
  await ev(`${P}.syncLayer(); 0`);
  await waitFor(() => ev(`${P}.layer.installed`), 'the layer to come back');
});

await check('P6 an error inside the layer switches it off once; the notes and native editing stay usable', async () => {
  await ev(`(() => { ${P}.layer.eligibility = () => { throw new Error('simulated layer failure'); }; return 0; })()`);
  const before = consoleErrors.length;
  await openNote('Tasks/Review.md');
  await openNote('Knowledge/Wave.md');
  await sleep(800);
  eq(await ev(`${P}.layer.installed`), false, 'layer should be off after the failure');
  const switchedOff = await ev(`[...activeDocument.querySelectorAll('.notice')].filter(n => /switched off after an error/.test(n.textContent)).length`);
  eq(switchedOff, 1, 'switch-off notices');
  eq(consoleErrors.length - before, 1, 'logged errors (one, not repeated)');
  consoleErrors.splice(before); // that single error was the one this check provokes
  assert((await ev(`document.querySelectorAll('.metadata-property').length`)) > 5, 'the Properties area stopped rendering');
  eq(await ev(`document.querySelectorAll('.vschema-chevron, .vschema-popover').length`), 0, 'controls left behind');
  await ev(`delete ${P}.layer.eligibility; ${P}.layer.failed = false; ${P}.syncLayer(); 0`);
  await waitFor(() => ev(`${P}.layer.installed`), 'the layer to come back');
});

await check('P6 disabling the plugin removes every patch and control; enabling it restores them', async () => {
  await ev(`(async () => { await app.plugins.disablePlugin('${PLUGIN_ID}'); return 0; })()`);
  await sleep(800);
  const state = await ev(`(() => { const m = app.metadataTypeManager; const info = m.getTypeInfo('status', 'x'); return { unpatched: info.inferred === m.registeredTypeWidgets.text, nativeValues: /iterateFileCache/.test(app.metadataCache.getFrontmatterPropertyValuesForKey.toString()), chevrons: document.querySelectorAll('.vschema-chevron, .vschema-popover, .vschema-hint').length, loaded: !!${P} }; })()`).catch(async () => ev(`(() => { const m = app.metadataTypeManager; const info = m.getTypeInfo('status', 'x'); return { unpatched: info.inferred === m.registeredTypeWidgets.text, nativeValues: /iterateFileCache/.test(app.metadataCache.getFrontmatterPropertyValuesForKey.toString()), chevrons: document.querySelectorAll('.vschema-chevron, .vschema-popover, .vschema-hint').length, loaded: false }; })()`));
  eq([state.unpatched, state.nativeValues, state.chevrons], [true, true, 0], 'Obsidian internals after disabling');
  await ev(`(async () => { await app.plugins.enablePlugin('${PLUGIN_ID}'); return 0; })()`);
  await waitFor(() => ev(`!!${P}?.schemas?.pack`), 'the schemas to load again', 8000);
  await waitFor(() => ev(`${P}.layer.installed`), 'the layer to install again');
  await openNote('Tasks/Review.md');
  await openNote('Knowledge/Wave.md');
  assert((await ev(`document.querySelectorAll('.vschema-chevron').length`)) > 0, 'no controls after enabling again');
});

await check('P6 a change arriving through sync while a stamp is pending is accepted, not overwritten (sync conflict)', async () => {
  await ev(`${P}.watcher.enabled = false; 0`);
  await write('Knowledge/Conflict.md', '---\ntype: kb\nschema: 2\nid: KB-2026-0910\nname: Conflict\nstatus: draft\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n');
  await sleep(1500);
  await write('Knowledge/Conflict.md', (await read('Knowledge/Conflict.md')).replace('body', 'local edit')); // starts the stamp timer
  await sleep(600);
  await write('Knowledge/Conflict.md', '---\ntype: kb\nschema: 2\nid: KB-2026-0910\nname: Conflict\nstatus: review\ncreated: 2026-10-20T14:32\nmodified: 2027-01-02T03:04\n---\nbody from the other device\n');
  await sleep(4500);
  const f = await fm('Knowledge/Conflict.md');
  eq(f.modified, '2027-01-02T03:04', 'the other device’s modified was overwritten');
  assert((await read('Knowledge/Conflict.md')).includes('body from the other device'), 'the incoming body was lost');
  await ev(`${P}.watcher.enabled = true; 0`);
});

await check('P6 a note written with a newer schema is read-only: nothing writes to it, the picker says why, the check reports it', async () => {
  await ev(`${P}.watcher.enabled = false; 0`);
  const text = '---\ntype: kb\nschema: 3\nid: KB-2026-0920\nname: Future\nstatus: draft\nfuture_field: x\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n';
  await write('Knowledge/Future.md', text);
  await sleep(1500);
  const out = await ev(`${P}.queue.set(app.vault.getFileByPath('Knowledge/Future.md'), { status: 'review' }).then(o => o)`);
  assert(out.error && /read-only/.test(out.error), `expected a read-only error, got ${JSON.stringify(out)}`);
  eq(await read('Knowledge/Future.md'), text, 'the note was changed');
  await write('Knowledge/Future.md', text.replace('body', 'edited elsewhere'));
  await sleep(4000);
  eq((await fm('Knowledge/Future.md')).modified, '2026-10-20T14:32', 'modified stamped on a read-only note');
  await openNote('Knowledge/Future.md');
  await focusValue('status');
  await ev(`${P}.layer.toggleFocused(); 0`);
  await ev(`document.querySelector('.metadata-property[data-property-key="status"] .vschema-chevron')?.click(); 0`);
  await sleep(600);
  const p = await popover();
  assert(!p || (p.note ?? '').length > 0 || p.options.length === 0, 'the list must not offer picks for a read-only note');
  await escape();
  await openCheck();
  const f = await findingMsg('Future', 'newer-schema');
  assert(f && f.buttons.length === 0 && /read-only/.test(f.msg), `finding: ${JSON.stringify(f)}`);
  await closeStrayModals();
  await ev(`${P}.watcher.enabled = true; 0`);
});

await check('P6 the matching mode setting writes registry/folders.yaml and the plugin follows it', async () => {
  await ev(`app.setting.open(); app.setting.openTabById('${PLUGIN_ID}'); 0`);
  const settings = await connect(await waitFor(() => pickTarget('settings'), 'the settings window'));
  await sleep(1200);
  try {
    await evaluate(settings, `(() => { const row = [...document.querySelectorAll('.setting-item')].find(r => r.querySelector('.setting-item-name')?.textContent === 'Mode' && /Combined: type/.test(r.textContent)); const s = row.querySelector('select'); s.value = 'manual'; s.dispatchEvent(new Event('change', { bubbles: true })); return 0; })()`);
    await waitFor(() => read('_schema/registry/folders.yaml').then((t) => /mode: manual/.test(t)), 'folders.yaml to change');
    await waitFor(() => ev(`${P}.schemas.pack.folders.mode === 'manual'`), 'the pack to reload');
    // manual mode does not guess a folder from a schema name
    await ev(`app.vault.createFolder('kb').catch(() => {}).then(() => 0)`);
    await write('kb/Guess.md', '---\nstatus: draft\n---\nx');
    await sleep(800);
    eq(await ev(`${P}.notes.context(app.vault.getFileByPath('kb/Guess.md')).match.kind`), 'ask', 'manual mode should ask, not guess');
  } finally {
    await evaluate(settings, `(() => { const row = [...document.querySelectorAll('.setting-item')].find(r => r.querySelector('.setting-item-name')?.textContent === 'Mode' && /Combined: type/.test(r.textContent)); const s = row.querySelector('select'); s.value = 'combined'; s.dispatchEvent(new Event('change', { bubbles: true })); return 0; })()`);
    await waitFor(() => read('_schema/registry/folders.yaml').then((t) => /mode: combined/.test(t)), 'folders.yaml to change back');
    settings.close();
    await ev(`app.setting.close(); 0`);
  }
  assert((await read('_schema/registry/folders.yaml')).includes('# Fixed by design'), 'comments lost');
});

await check('P6 a note with Windows line endings keeps them through a pick, a stamp and a conversion', async () => {
  await ev(`${P}.watcher.enabled = false; 0`);
  const crlf = '---\r\ntype: kb\r\nschema: 2\r\nid: KB-2026-0930\r\nname: Crlf\r\nstatus: draft\r\ntags:\r\n  - idea\r\ncreated: 2026-10-20T14:32\r\nmodified: 2026-10-20T14:32\r\n---\r\nline one\r\nline two\r\n';
  await write('Knowledge/Crlf.md', crlf);
  await sleep(1500);
  const lone = (t) => /[^\r]\n/.test(t) || t.startsWith('\n');
  await ev(`${P}.queue.set(app.vault.getFileByPath('Knowledge/Crlf.md'), { status: 'review', language: 'en-GB' }).then(() => 0)`);
  let text = await read('Knowledge/Crlf.md');
  assert(text.includes('status: review') && !lone(text), `a pick broke the line endings: ${JSON.stringify(text.slice(0, 120))}`);
  await write('Knowledge/Crlf.md', text.replace('line one', 'line one edited'));
  await waitFor(async () => !(await read('Knowledge/Crlf.md')).includes('modified: 2026-10-20T14:32'), 'the stamp', 6000);
  text = await read('Knowledge/Crlf.md');
  assert(!lone(text), `a stamp broke the line endings: ${JSON.stringify(text.slice(0, 160))}`);
  assert(text.endsWith('line one edited\r\nline two\r\n'), 'the body changed');
  const task = await ev(`${P}.schemas.pack.types.get('task') !== undefined`);
  assert(task, 'no task type');
  await ev(`(async () => { const f = app.vault.getFileByPath('Knowledge/Crlf.md'); return ${P}.actions.planConvert(f, ${P}.schemas.pack.types.get('task')).then(p => ${P}.actions.applyConversion(p)); })()`);
  text = await read('Knowledge/Crlf.md');
  assert(text.includes('type: task') && !lone(text), `a conversion broke the line endings: ${JSON.stringify(text.slice(0, 160))}`);
  await ev(`${P}.watcher.enabled = true; 0`);
});

// ---------------------------------------------------------------- Phase 7: creation, rename and prompt settings
const setS = (obj) => ev(`Object.assign(${P}.settings, ${JSON.stringify(obj)}); 0`);
const noteKeys = async (path) => (await fmLines(path)).filter((l) => /^[a-z_]+:/.test(l)).map((l) => l.split(':')[0]);
await closeStrayModals();
await setS({ onCreate: 'fill', createDelayMs: 1500, syncName: true, breadcrumbFromFolder: false, promptScope: 'open', promptTags: true, promptStatus: true, promptTypeChange: true });
await ev(`app.vault.createFolder('Knowledge/Physics').catch(() => {}).then(() => 0)`);

await check('P7 fill automatically: a new note in a mapped folder gets every property with no dialog', async () => {
  await ev(`app.vault.create('Knowledge/Auto1.md', '').then(() => 0)`);
  await waitFor(async () => (await read('Knowledge/Auto1.md')).includes('id: KB-'), 'the properties', 8000);
  const f = await fm('Knowledge/Auto1.md');
  eq([f.type, f.schema, f.name, f.status, f.kind, f.language], ['kb', '2', 'Auto1', 'draft', 'concept', 'en-GB'], 'values');
  assert(new RegExp(`^KB-${YEAR}-\\d{4}$`).test(f.id), `ID: ${f.id}`);
  eq(f.created, f.modified, 'created equals modified');
  eq((await noteKeys('Knowledge/Auto1.md')).slice(0, 5), ['type', 'schema', 'id', 'name', 'status'], 'schema order');
  eq((await noteKeys('Knowledge/Auto1.md')).slice(-2), ['created', 'modified'], 'created and modified last');
  assert(!(await read('Knowledge/Auto1.md')).includes('breadcrumb'), 'breadcrumb written although the setting is off');
  eq(await strayModals(), 0, 'a dialog appeared');
});

await check('P7 a template-style note keeps everything it already has; only missing properties are added', async () => {
  await write('Knowledge/Auto2.md', '---\nstatus: review\ntags:\n  - idea\nmy_field: keep me\n---\nbody text\nsecond line\n');
  await waitFor(async () => (await read('Knowledge/Auto2.md')).includes('id: KB-'), 'the properties', 8000);
  const text = await read('Knowledge/Auto2.md');
  const f = await fm('Knowledge/Auto2.md');
  eq([f.status, f.my_field, f.type, f.kind, f.name], ['review', 'keep me', 'kb', 'concept', 'Auto2'], 'values');
  assert(text.includes('  - idea') && text.endsWith('---\nbody text\nsecond line\n'), 'template values or the body changed');
});

await check('P7 no ID is given to a note that already has one, to excluded folders, or to a note left alone by "Do nothing"', async () => {
  const withId = '---\ntype: kb\nid: KB-2026-0990\nname: HasId\nstatus: draft\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n';
  await write('Knowledge/HasId.md', withId);
  await ev(`app.vault.create('Templates/TplBare.md', '').then(() => 0)`);
  await sleep(4000);
  eq(await read('Knowledge/HasId.md'), withId, 'a note with an ID changed');
  eq(await read('Templates/TplBare.md'), '', 'an excluded note changed');
  await setS({ onCreate: 'nothing' });
  await ev(`app.vault.create('Knowledge/Auto3.md', '').then(() => 0)`);
  await sleep(4000);
  eq(await read('Knowledge/Auto3.md'), '', 'Do nothing wrote to the note');
  eq(await strayModals(), 0, 'a dialog appeared');
});

await check('P7 ask: a preview first; Not now writes nothing; Add properties writes exactly what was shown', async () => {
  await setS({ onCreate: 'ask' });
  await ev(`app.vault.create('Knowledge/Auto4.md', '').then(() => 0)`);
  await waitModal('Add kb properties');
  eq(await read('Knowledge/Auto4.md'), '', 'written before approval');
  await clickButton('Not now');
  await sleep(2500);
  eq(await read('Knowledge/Auto4.md'), '', 'Not now wrote to the note');
  await ev(`app.vault.create('Knowledge/Auto5.md', '').then(() => 0)`);
  const m = await waitModal('Add kb properties');
  const shownId = /\+ id: (KB-\d{4}-\d{4})/.exec(m.pre.join('\n'))[1];
  await clickButton('Add properties');
  await waitFor(async () => (await read('Knowledge/Auto5.md')).includes('id: KB-'), 'the properties');
  eq((await fm('Knowledge/Auto5.md')).id, shownId, 'the ID shown is the ID written');
});

await check('P7 the wait before filling is adjustable', async () => {
  await setS({ onCreate: 'fill', createDelayMs: 4000 });
  await ev(`app.vault.create('Knowledge/Auto6.md', '').then(() => 0)`);
  await sleep(2500);
  eq(await read('Knowledge/Auto6.md'), '', 'filled before the wait ended');
  await waitFor(async () => (await read('Knowledge/Auto6.md')).includes('id: KB-'), 'the properties after the wait', 8000);
  await setS({ createDelayMs: 1500 });
});

await check('P7 rename: name follows the file name when it was filled by the plugin, never when you wrote it, and not with the setting off', async () => {
  await ev(`app.vault.create('Knowledge/Untitled.md', '').then(() => 0)`);
  await waitFor(async () => (await read('Knowledge/Untitled.md')).includes('id: KB-'), 'the fill', 8000);
  eq((await fm('Knowledge/Untitled.md')).name, 'Untitled', 'name at creation');
  const modifiedBefore = (await fm('Knowledge/Untitled.md')).modified;
  await ev(`app.fileManager.renameFile(app.vault.getFileByPath('Knowledge/Untitled.md'), 'Knowledge/Renamed One.md').then(() => 0)`);
  await waitFor(async () => (await fm('Knowledge/Renamed One.md')).name === 'Renamed One', 'name to follow the rename', 6000);
  await sleep(3000);
  eq((await fm('Knowledge/Renamed One.md')).modified, modifiedBefore, 'a rename changed modified');
  eq((await read('Knowledge/Renamed One.md')).includes('Untitled'), false, 'old name left behind');
  // a name the user wrote
  await write('Knowledge/Renamed One.md', (await read('Knowledge/Renamed One.md')).replace('name: Renamed One', 'name: My Own Title'));
  await sleep(1500);
  await ev(`app.fileManager.renameFile(app.vault.getFileByPath('Knowledge/Renamed One.md'), 'Knowledge/Renamed Two.md').then(() => 0)`);
  await sleep(2500);
  eq((await fm('Knowledge/Renamed Two.md')).name, 'My Own Title', 'a name the user wrote was overwritten');
  // setting off
  await setS({ syncName: false });
  await write('Knowledge/Renamed Two.md', (await read('Knowledge/Renamed Two.md')).replace('name: My Own Title', 'name: Renamed Two'));
  await sleep(1500);
  await ev(`app.fileManager.renameFile(app.vault.getFileByPath('Knowledge/Renamed Two.md'), 'Knowledge/Renamed Three.md').then(() => 0)`);
  await sleep(2500);
  eq((await fm('Knowledge/Renamed Three.md')).name, 'Renamed Two', 'name followed with the setting off');
  await setS({ syncName: true });
});

await check('P7 move and rename together: name and breadcrumb follow, the conversion is offered, modified is untouched', async () => {
  await setS({ breadcrumbFromFolder: true });
  await ev(`app.vault.create('Knowledge/Physics/Untitled 2.md', '').then(() => 0)`);
  await waitFor(async () => (await read('Knowledge/Physics/Untitled 2.md')).includes('breadcrumb:'), 'the fill with breadcrumb', 8000);
  eq((await fm('Knowledge/Physics/Untitled 2.md')).breadcrumb, 'Knowledge/Physics', 'breadcrumb at creation');
  const keys = await noteKeys('Knowledge/Physics/Untitled 2.md');
  assert(keys.indexOf('breadcrumb') < keys.indexOf('created'), `breadcrumb in schema order: ${keys}`);
  const modifiedBefore = (await fm('Knowledge/Physics/Untitled 2.md')).modified;
  await ev(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Knowledge/Physics/Untitled 2.md')).then(() => 0)`);
  await sleep(800);
  await ev(`app.fileManager.renameFile(app.vault.getFileByPath('Knowledge/Physics/Untitled 2.md'), 'Tasks/Moved And Renamed.md').then(() => 0)`);
  await waitFor(async () => (await fm('Tasks/Moved And Renamed.md')).breadcrumb === 'Tasks', 'breadcrumb to follow the folder', 6000);
  eq((await fm('Tasks/Moved And Renamed.md')).name, 'Moved And Renamed', 'name');
  const m = await waitModal('Convert “Moved And Renamed” from kb to task');
  assert(m.text.includes('Kept in archived_fields'), 'preview');
  await clickButton('Not now');
  await sleep(500);
  eq((await fm('Tasks/Moved And Renamed.md')).type, 'kb', 'declined conversion wrote');
  await sleep(3000);
  eq((await fm('Tasks/Moved And Renamed.md')).modified, modifiedBefore, 'modified changed by move + rename');
  // setting off: the breadcrumb is left to the breadcrumb plugin
  await setS({ breadcrumbFromFolder: false });
  await ev(`app.fileManager.renameFile(app.vault.getFileByPath('Tasks/Moved And Renamed.md'), 'Knowledge/Back Again.md').then(() => 0)`);
  await sleep(3000);
  eq((await fm('Knowledge/Back Again.md')).breadcrumb, 'Tasks', 'breadcrumb written with the setting off');
  await closeStrayModals();
});

await check('P7 prompt scope and toggles: open notes only by default; every note on request; each prompt can be switched off', async () => {
  await setS({ onCreate: 'nothing' });
  await write('Knowledge/Scope1.md', '---\ntype: kb\nschema: 2\nid: KB-2026-0991\nname: Scope1\nstatus: draft\ntags:\n  - idea\ncreated: 2026-10-20T14:32\nmodified: 2026-10-20T14:32\n---\nbody\n');
  await sleep(1500);
  await ev(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Knowledge/Wave.md')).then(() => 0)`);
  await sleep(800);
  // not open, default scope: no prompt
  await write('Knowledge/Scope1.md', (await read('Knowledge/Scope1.md')).replace('  - idea', '  - idea\n  - sop'));
  await sleep(4500);
  eq(await strayModals(), 0, 'prompted for a note that is not open');
  // every note
  await setS({ promptScope: 'all' });
  await write('Knowledge/Scope1.md', (await read('Knowledge/Scope1.md')).replace('body', 'body 2'));
  await waitModal('Replace tag synonyms');
  await clickButton('Not now');
  await sleep(500);
  // each prompt can be turned off
  await setS({ promptTags: false });
  await write('Knowledge/Scope1.md', (await read('Knowledge/Scope1.md')).replace('body 2', 'body 3').replace('  - sop', '  - sop\n  - sop-two'));
  await sleep(4500);
  eq(await strayModals(), 0, 'prompted with tag prompts off');
  await write('Knowledge/Scope1.md', (await read('Knowledge/Scope1.md')).replace('  - sop-two\n', '').replace('  - sop\n', ''));
  await sleep(1500);
  await setS({ promptTags: true, promptStatus: false });
  await write('Knowledge/Scope1.md', (await read('Knowledge/Scope1.md')).replace('status: draft', 'status: live'));
  await sleep(4500);
  eq(await strayModals(), 0, 'prompted for status with the status prompt off');
  await setS({ promptStatus: true, promptScope: 'open', promptTypeChange: false });
  await ev(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Knowledge/Scope1.md')).then(() => 0)`);
  await sleep(800);
  await write('Knowledge/Scope1.md', (await read('Knowledge/Scope1.md')).replace('type: kb', 'type: task'));
  await sleep(4500);
  assert(!(await modalInfo())?.title?.includes('Convert'), 'a conversion was offered with that prompt off');
  await closeStrayModals();
  await setS({ promptTypeChange: true });
});

await check('P7 the new settings appear on the settings page', async () => {
  await ev(`app.setting.open(); app.setting.openTabById('${PLUGIN_ID}'); 0`);
  const settings = await connect(await waitFor(() => pickTarget('settings'), 'the settings window'));
  await sleep(1200);
  const names = await evaluate(settings, `[...document.querySelectorAll('.setting-item-name')].map(e => e.textContent)`);
  for (const n of ['When a note is created in a mapped folder', 'Wait before filling a new note (milliseconds)', 'Keep the name property in step with the file name', 'Set breadcrumb from the folder', 'Ask about changes in', 'Ask about tag synonyms and unknown tags', 'Ask about an invalid status', 'Ask when the type changes'])
    assert(names.includes(n), `missing setting "${n}"`);
  await evaluate(settings, `(() => { const row = [...document.querySelectorAll('.setting-item')].find(r => r.querySelector('.setting-item-name')?.textContent === 'When a note is created in a mapped folder'); const s = row.querySelector('select'); s.value = 'fill'; s.dispatchEvent(new Event('change', { bubbles: true })); return 0; })()`);
  await sleep(500);
  eq(await ev(`${P}.settings.onCreate`), 'fill', 'the dropdown did not change the setting');
  settings.close();
  await ev(`app.setting.close(); 0`);
  await setS({ onCreate: 'nothing' });
});

// ---------------------------------------------------------------- what the row shows after a pick
const shownValue = (k) => ev(`document.querySelector('.metadata-property[data-property-key="${k}"] .metadata-property-value').textContent`);
await check('P9 a pick made while the field has focus is shown in the row and is not put back when focus leaves', async () => {
  await ev(`${P}.watcher.enabled = false; 0`);
  await openNote('Knowledge/Wave.md');
  await sleep(800);
  const cur = (await fm('Knowledge/Wave.md')).status;
  const target = cur === 'review' ? 'published' : 'review';
  await focusValue('status');
  await altDown();
  await sleep(600);
  await ev(`[...document.querySelectorAll('.vschema-option')].find(o => o.textContent.trim() === ${JSON.stringify(target)}).click(); 0`);
  await waitFor(async () => (await fmLines('Knowledge/Wave.md')).includes(`status: ${target}`), 'the file to change');
  await waitFor(async () => (await shownValue('status')) === target, `the row to show ${target}`, 4000);
  await altUp();
  await sleep(400);
  await ev(`document.activeElement.blur(); 0`);
  await sleep(1500);
  eq((await fm('Knowledge/Wave.md')).status, target, 'file after leaving the field (the pick was put back)');
  eq(await shownValue('status'), target, 'row after leaving the field');
});

await check('P9 the same holds for a multi-choice list, a typed autocomplete, and a pick from the ▾ list', async () => {
  await sleep(800);
  // multi-choice
  await focusValue('tags');
  await altDown();
  await sleep(600);
  await ev(`[...document.querySelectorAll('.vschema-option')].find(o => o.textContent.trim() === 'health').click(); 0`);
  await waitFor(async () => (await fmLines('Knowledge/Wave.md')).includes('  - health'), 'the tag to be saved');
  await waitFor(async () => /health/.test(await shownValue('tags')), 'the pill to appear', 4000);
  await altUp();
  await sleep(400);
  await ev(`document.activeElement.blur(); 0`);
  await sleep(1500);
  assert((await fmLines('Knowledge/Wave.md')).includes('  - health'), 'the tag was put back');
  assert(/health/.test(await shownValue('tags')), 'the pill disappeared after leaving the field');
  // typed autocomplete, picked by a real click on the suggestion
  await sleep(800);
  await focusValue('status');
  await client.send('Input.insertText', { text: 'out' });
  await waitFor(() => popover(), 'the suggestions');
  const pt = await ev(`(() => { const o = [...document.querySelectorAll('.vschema-option')].find(x => /outdated/.test(x.textContent)); const r = o.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await waitFor(async () => (await fmLines('Knowledge/Wave.md')).includes('status: outdated'), 'the typed pick to save');
  await waitFor(async () => (await shownValue('status')) === 'outdated', 'the row to show outdated', 4000);
  await sleep(1200);
  eq((await fm('Knowledge/Wave.md')).status, 'outdated', 'file after the typed pick (the fragment was committed over it)');
  // a pick from the ▾ list
  await sleep(800);
  await focusValue('status');
  await waitFor(() => ev(`!!document.querySelector('.metadata-property[data-property-key="status"] .vschema-chevron')`), 'the ▾ button');
  await ev(`document.querySelector('.metadata-property[data-property-key="status"] .vschema-chevron').click(); 0`);
  await waitFor(() => popover(), 'the latched list');
  await ev(`[...document.querySelectorAll('.vschema-option')].find(o => o.textContent.trim() === 'archived').click(); 0`);
  await waitFor(async () => (await shownValue('status')) === 'archived', 'the row to show archived', 4000);
  await escape();
  await sleep(1200);
  eq((await fm('Knowledge/Wave.md')).status, 'archived', 'file after the ▾ pick');
  await ev(`${P}.watcher.enabled = true; 0`);
});

// ---------------------------------------------------------------- naming
const focusTitle = () => ev(`(() => { const t = activeDocument.querySelector('.inline-title'); t.focus(); getSelection().selectAllChildren(t); return t.textContent; })()`);
const openFresh = async (path) => {
  await ev(`(async () => { const f = await app.vault.create(${JSON.stringify(path)}, ''); await app.workspace.getLeaf(false).openFile(f); return 0; })()`);
  await waitFor(() => ev(`!!activeDocument.querySelector('.inline-title')`), 'the title field');
  await sleep(300);
};

await check('P10 a new note is filled after you have typed its name and pressed Enter, not while you are typing', async () => {
  await ev(`${P}.watcher.enabled = false; 0`);
  await setS({ onCreate: 'fill', createDelayMs: 1500 });
  await openFresh('Knowledge/Untitled 9.md');
  await focusTitle();
  await client.send('Input.insertText', { text: 'Naming' });
  await sleep(300);
  await client.send('Input.insertText', { text: ' test' });
  await sleep(4000); // well past the usual wait
  eq(await read('Knowledge/Untitled 9.md'), '', 'filled while the name was still being typed');
  await press('Enter', 'Enter', 13);
  await waitFor(() => ev(`!!app.vault.getFileByPath('Knowledge/Naming test.md')`), 'the rename', 6000);
  await waitFor(async () => (await read('Knowledge/Naming test.md')).includes('id: KB-'), 'the fill after the rename', 8000);
  eq((await fm('Knowledge/Naming test.md')).name, 'Naming test', 'name should be the typed name, not Untitled');
  eq(await strayModals(), 0, 'a dialog appeared');
});

await check('P10 keeping the default name: the note is filled once you leave the title field', async () => {
  await openFresh('Knowledge/Untitled 8.md');
  await focusTitle();
  await sleep(3500);
  eq(await read('Knowledge/Untitled 8.md'), '', 'filled while the title field still had focus');
  await ev(`activeDocument.activeElement.blur(); 0`);
  await waitFor(async () => (await read('Knowledge/Untitled 8.md')).includes('id: KB-'), 'the fill after leaving the title', 10000);
  eq((await fm('Knowledge/Untitled 8.md')).name, 'Untitled 8', 'name');
});

await check('P10 ask mode also waits for the name, then shows the preview', async () => {
  await setS({ onCreate: 'ask' });
  await openFresh('Knowledge/Untitled 7.md');
  await focusTitle();
  await client.send('Input.insertText', { text: 'Asked after naming' });
  await sleep(3500);
  eq(await strayModals(), 0, 'a preview appeared while the name was being typed');
  await press('Enter', 'Enter', 13);
  const m = await waitModal('Add kb properties');
  assert(m.title.includes('Asked after naming'), `the preview should use the new name: ${m.title}`);
  await clickButton('Not now');
  await sleep(500);
  eq(await read('Knowledge/Asked after naming.md'), '', 'Not now wrote to the note');
  await setS({ onCreate: 'fill' });
});

// ---------------------------------------------------------------- Option key robustness
await ev(`${P}.layer.releaseSafety = true; 0`);
await check('P8 a lost key release never leaves the list stuck: any event without the Option flag, or the window losing focus, closes it', async () => {
  await ev(`${P}.watcher.enabled = false; 0`);
  await openNote('Knowledge/Wave.md');
  // 1. the release is never delivered; the next mouse move shows Option is up
  await focusValue('status');
  await altDown();
  await sleep(600);
  assert(await popover(), 'the list should be open while held');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 400, modifiers: 0 });
  await sleep(400);
  eq(await popover(), null, 'list after a mouse move with Option up');
  await altUp();
  // 2. the window loses focus while held
  await focusValue('status');
  await altDown();
  await sleep(600);
  assert(await popover(), 'the list should be open while held (2)');
  await ev(`window.dispatchEvent(new Event('blur')); 0`);
  await sleep(400);
  eq(await popover(), null, 'list after the window lost focus');
  await altUp();
  // 3. a key press without Option
  await focusValue('status');
  await altDown();
  await sleep(600);
  await keyEvent('rawKeyDown', 'ArrowLeft', 'ArrowLeft', 37, { modifiers: 0 }); // a key that types nothing
  await keyEvent('keyUp', 'ArrowLeft', 'ArrowLeft', 37, { modifiers: 0 });
  await sleep(400);
  eq(await popover(), null, 'list after a key pressed with Option up');
  await altUp();
});

await check('P8 a list kept open because the pointer was on it closes after a single pick, and when the pointer leaves', async () => {
  const overList = async () => {
    const b = await ev(`(() => { const r = document.querySelector('.vschema-popover').getBoundingClientRect(); return { x: r.left + 30, y: r.top + 20 }; })()`);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, modifiers: 1 });
    await sleep(250);
  };
  // pointer on the list at release: it stays (the spec rule)...
  await sleep(1200);
  await focusValue('status');
  await altDown();
  await sleep(600);
  await overList();
  await altUp();
  await sleep(300);
  assert(await popover(), 'list should stay while the pointer is on it');
  // ...and a single choice closes it
  await ev(`[...document.querySelectorAll('.vschema-option')].find(o => o.textContent.includes('review')).click(); 0`);
  await waitFor(async () => (await fmLines('Knowledge/Wave.md')).includes('status: review'), 'the pick');
  await sleep(500);
  eq(await popover(), null, 'list after a single pick in a kept-open list');
  // leaving the list closes it
  await sleep(1200);
  await focusValue('status');
  await altDown();
  await sleep(600);
  await overList();
  await altUp();
  await sleep(300);
  assert(await popover(), 'list should stay while the pointer is on it (2)');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3, modifiers: 0 });
  await sleep(500);
  eq(await popover(), null, 'list after the pointer left it');
  // a multi-choice list stays through a pick and closes when the pointer leaves
  await sleep(1200);
  await focusValue('tags');
  await altDown();
  await sleep(600);
  await overList();
  await altUp();
  await sleep(300);
  await ev(`[...document.querySelectorAll('.vschema-option')].find(o => o.textContent.includes('experiment')).click(); 0`);
  await waitFor(async () => (await fmLines('Knowledge/Wave.md')).includes('  - experiment'), 'the tag pick');
  await sleep(500);
  assert(await popover(), 'a multi-choice list closed after a pick');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3, modifiers: 0 });
  await sleep(500);
  eq(await popover(), null, 'multi-choice list after the pointer left');
  await ev(`${P}.watcher.enabled = true; 0`);
});

await check('P8 stress: 24 hold and release cycles, pointer away or on the list, quick taps and slow holds: nothing ever stays stuck', async () => {
  await ev(`${P}.watcher.enabled = false; 0`);
  const stuck = [];
  for (let i = 0; i < 24; i++) {
    const onList = i % 3 === 0;
    const quick = i % 4 === 1;
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, modifiers: 0 });
    await focusValue(i % 2 === 0 ? 'status' : 'kind');
    await altDown();
    await sleep(quick ? 120 : 650);
    if (onList && !quick) {
      const b = await ev(`(() => { const p = document.querySelector('.vschema-popover'); if (!p) return null; const r = p.getBoundingClientRect(); return { x: r.left + 30, y: r.top + 20 }; })()`);
      if (b) {
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, modifiers: 1 });
        await sleep(150);
      }
    }
    await altUp();
    await sleep(350);
    if (onList && !quick) {
      // allowed to remain (pointer rule); leaving must close it
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3, modifiers: 0 });
      await sleep(400);
    }
    if (await popover()) stuck.push(`cycle ${i} (${onList ? 'on list' : 'away'}, ${quick ? 'tap' : 'hold'})`);
    if (await popover()) await escape();
  }
  eq(stuck, [], 'cycles that left the list open');
  await ev(`${P}.watcher.enabled = true; ${P}.layer.releaseSafety = false; 0`);
});

// ---------------------------------------------------------------- summary
await check('no dialog is left open at the end', async () => {
  eq(await strayModals(), 0, 'open dialogs');
});

await check('no console errors during the whole run', async () => {
  eq(consoleErrors, [], 'console errors');
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
client.close();
if (!keep) run('debug.mjs', ['stop']);
process.exit(failed.length ? 1 : 0);
