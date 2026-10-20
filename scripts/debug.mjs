// Drive the isolated Obsidian started by debug:launch.
//   npm run debug -- status
//   npm run debug -- eval "<js>" [--window settings]
//   npm run debug -- reload
//   npm run debug -- console [ms]
//   npm run debug -- screenshot [file]
//   npm run debug -- stop
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT, SCRATCH, PLUGIN_ID } from './lib/paths.mjs';
import { PORT, connect, evaluate, pickTarget, sleep } from './lib/cdp.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const wi = rest.indexOf('--window');
const which = wi >= 0 ? rest[wi + 1] : 'main';
const pos = wi >= 0 ? rest.filter((_, i) => i !== wi && i !== wi + 1) : rest;

async function open() {
  const t = await pickTarget(which);
  if (!t) throw new Error(`No ${which} window. Is Obsidian running (npm run debug:launch)?`);
  return connect(t);
}

async function collect(client, ms) {
  const out = [];
  client.onEvent((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      out.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      out.push('[exception] ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    }
  });
  await client.send('Runtime.enable');
  await sleep(ms);
  return out;
}

switch (cmd) {
  case 'status': {
    const c = await open();
    console.log(
      JSON.stringify(
        await evaluate(
          c,
          `(() => { const p = app.plugins.plugins['${PLUGIN_ID}'];
            return { obsidian: window.electron ? undefined : undefined, loaded: !!p, restrictedMode: app.plugins.isEnabled?.() === false,
              files: app.vault.getFiles().length, version: (typeof apiVersion !== 'undefined' ? apiVersion : null) }; })()`,
        ),
      ),
    );
    c.close();
    break;
  }
  case 'eval': {
    const c = await open();
    const v = await evaluate(c, `(async () => (${pos[0]}))()`).catch(async (e) => {
      // allow statements: retry as an async function body
      if (/SyntaxError/.test(String(e))) return evaluate(c, `(async () => { ${pos[0]} })()`);
      throw e;
    });
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    c.close();
    break;
  }
  case 'reload': {
    const dir = join(SCRATCH, 'vault', '.obsidian', 'plugins', PLUGIN_ID);
    for (const f of ['main.js', 'manifest.json', 'styles.css']) {
      if (existsSync(join(ROOT, f))) copyFileSync(join(ROOT, f), join(dir, f));
    }
    const c = await open();
    const logs = [];
    c.onEvent((m) => {
      if (m.method === 'Runtime.consoleAPICalled')
        logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      if (m.method === 'Runtime.exceptionThrown')
        logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description ?? ''));
    });
    await c.send('Runtime.enable');
    await evaluate(
      c,
      `(async () => { await app.plugins.disablePlugin('${PLUGIN_ID}'); await app.plugins.enablePlugin('${PLUGIN_ID}'); })()`,
    );
    await sleep(1500);
    console.log(logs.join('\n') || '(no console output)');
    c.close();
    break;
  }
  case 'console': {
    const c = await open();
    const logs = await collect(c, Number(pos[0] ?? 2000));
    console.log(logs.join('\n') || '(no console output)');
    c.close();
    break;
  }
  case 'screenshot': {
    const c = await open();
    const file = pos[0] ?? join(SCRATCH, 'shot.png');
    mkdirSync(dirname(file), { recursive: true });
    const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(file);
    c.close();
    break;
  }
  case 'stop': {
    try {
      const c = await open();
      await c.send('Browser.close').catch(() => {});
      c.close();
    } catch {
      /* not running */
    }
    const pidFile = join(SCRATCH, 'pid');
    if (existsSync(pidFile)) {
      try {
        process.kill(Number(readFileSync(pidFile, 'utf8')));
      } catch {
        /* already gone */
      }
    }
    for (let i = 0; i < 20; i++) {
      try {
        await fetch(`http://127.0.0.1:${PORT}/json/version`);
        await sleep(500);
      } catch {
        console.log('stopped');
        process.exit(0);
      }
    }
    console.error('Port still busy.');
    process.exit(1);
  }
  default:
    console.log('Usage: debug -- status | eval "<js>" [--window settings] | reload | console [ms] | screenshot [file] | stop');
}
