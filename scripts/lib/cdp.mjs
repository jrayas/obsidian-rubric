// Minimal Chrome DevTools Protocol client (Node 22+: global fetch and WebSocket).
export const PORT = Number(process.env.VAULT_SCHEMA_CDP_PORT ?? 9222);

export async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return res.json();
}

/** Pick a page target. `which` is 'main' (first app:// page that is not Settings) or 'settings'. */
export async function pickTarget(which = 'main') {
  const pages = (await listTargets()).filter((t) => t.type === 'page');
  // The settings window can be an about:blank page, so match it by title.
  if (which === 'settings') return pages.find((t) => /^Settings/.test(t.title));
  const targets = pages.filter((t) => t.url.startsWith('app://'));
  return targets.find((t) => !/^Settings/.test(t.title)) ?? targets[0];
}

export async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    onEvent(fn) {
      listeners.push(fn);
    },
    close() {
      ws.close();
    },
  };
}

/** Evaluate an expression in the page; async expressions are awaited. Returns the value or throws. */
export async function evaluate(client, expression) {
  const res = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(d.exception?.description ?? d.text ?? 'evaluation failed');
  }
  return res.result.value;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
