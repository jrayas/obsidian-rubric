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
const altDown = () => keyEvent('rawKeyDown', 'Alt', 'AltLeft', 18, { modifiers: 1 });
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
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
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
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
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
