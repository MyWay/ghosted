#!/usr/bin/env node
// End-to-end check of webhook alerts in a real Chromium.
//
//   node scripts/e2e-webhook.mjs            builds the extension, then runs the checks
//   node scripts/e2e-webhook.mjs --no-build uses the existing .output/chrome-mv3
//   CHROME=/path/to/chromium node scripts/e2e-webhook.mjs
//
// Needs a Chromium build (branded Chrome 137+ ignores --load-extension). By default it uses the
// newest one Playwright has downloaded to ~/.cache/ms-playwright (`npx playwright install chromium`).
//
// A local server stands in for the webhook. It sends no CORS headers, so a normal web page cannot
// talk to it; the extension can only because it holds host permission. The "Allow" prompt cannot be
// clicked headlessly, so a copy of the build lists the test hosts in host_permissions instead (an
// unpacked extension gets those at install). The prompt itself is therefore not covered.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, '.output/chrome-mv3');
const SEND_TIMEOUT_S = 10; // must match SEND_TIMEOUT_MS in src/notify/index.ts
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- setup ------------------------------------------------------------------

function findChromium() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)) : [];
  dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(cache, d, sub);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No Chromium found. Run `npx playwright install chromium` or set CHROME=/path/to/chromium.');
}

function build() {
  console.log('Building the extension…');
  const r = spawnSync(join(ROOT, 'node_modules/.bin/wxt'), ['build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('wxt build failed');
}

/** Copy of the build with extra host_permissions, granted at install like a clicked "Allow". */
function extensionCopy(work, name, grantedHosts) {
  const dir = join(work, name);
  cpSync(BUILD, dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [...manifest.host_permissions, ...grantedHosts];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return dir;
}

/** Chromium's id for an unpacked extension: sha256 of its absolute path, first 32 hex digits mapped 0-f -> a-p. */
const unpackedId = (dir) =>
  [...createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

// ---- fake webhook server --------------------------------------------------------

function startServer() {
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      // GET: a real page for the CORS control to run on.
      if (req.method === 'GET') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>web page</title>');
      received.push({ method: req.method, path: req.url, headers: req.headers, body });
      if (req.url === '/hang') return; // accept the request, never answer
      res.writeHead(204).end(); // deliberately no Access-Control-Allow-Origin
    });
  });
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () =>
      r({
        port: server.address().port,
        received,
        take: (path) => received.find((x) => x.path === path),
        clear: () => (received.length = 0),
        close: () => server.closeAllConnections() || server.close(),
      }),
    ),
  );
}

// ---- browser over the DevTools protocol -----------------------------------------------

async function launch(chromium, extDir, work) {
  const profile = mkdtempSync(join(work, 'profile-'));
  const proc = spawn(
    chromium,
    ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, 'about:blank'],
    { stdio: 'ignore' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) {
    proc.kill();
    throw new Error('Chromium did not start (no DevToolsActivePort). If this runs inside a sandbox, try a normal terminal.');
  }
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const done = pending.get(msg.id);
    if (!done) return;
    pending.delete(msg.id);
    done(msg);
  };
  const cdp = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const extId = unpackedId(extDir);
  const workerUrl = `chrome-extension://${extId}/background.js`;
  let loaded = false;
  for (let i = 0; i < 100 && !loaded; i++) {
    loaded = (await cdp('Target.getTargets')).targetInfos.some((t) => t.url === workerUrl);
    if (!loaded) await sleep(100);
  }
  if (!loaded) throw new Error(`Ghosted did not load (expected ${workerUrl}).`);

  /** Open a tab and return an evaluator for it, once the page (and, for extension pages, chrome.*) is ready. */
  async function open(url) {
    const { targetId } = await cdp('Target.createTarget', { url });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async (expression) => {
      const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    // Not new URL(url).origin: for non-special schemes like chrome-extension: that is "null",
    // while Chrome's location.origin is "chrome-extension://<id>".
    const origin = url.split('/').slice(0, 3).join('/');
    // The tab starts as about:blank. Wait for the real document to be parsed ('interactive' is
    // enough: 'complete' also waits for every image/font, and one stuck request keeps it from
    // ever getting there) and, on extension pages, for the chrome.* APIs.
    const needsApi = url.startsWith('chrome-extension://');
    const probe = `({
      href: location.href,
      sameOrigin: location.origin === ${JSON.stringify(origin)},
      readyState: document.readyState,
      storageApi: !!globalThis.chrome?.storage?.local,
      runtimeApi: !!globalThis.chrome?.runtime?.sendMessage,
    })`;
    let state;
    for (let i = 0; i < 150; i++) {
      state = await evaluate(probe).catch((e) => ({ error: e.message }));
      const parsed = state.readyState === 'interactive' || state.readyState === 'complete';
      if (state.sameOrigin && parsed && (!needsApi || (state.storageApi && state.runtimeApi))) return evaluate;
      await sleep(100);
    }
    throw new Error(`Page never became ready: ${url}\n       last state: ${JSON.stringify(state)}`);
  }

  async function close() {
    ws.close();
    proc.kill();
    await sleep(300);
  }
  return { extId, open, close };
}

// ---- checks ---------------------------------------------------------------

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok || process.env.VERBOSE) console.log(`      ${JSON.stringify(detail)}`);
}

/** Save a webhook config the way Settings does, then press "Send test". Returns the background's reply. */
const sendTest = (dash, webhook) =>
  dash(`(async () => {
    await chrome.storage.local.set({ notifyPrefs: { browser: false, newFollowers: false, webhook: ${JSON.stringify(webhook)} } });
    return chrome.runtime.sendMessage({ type: 'test-notify', channel: 'webhook' });
  })()`);
const storedErrors = (dash) => dash(`chrome.storage.local.get('notifyErrors').then((x) => x.notifyErrors ?? {})`);

async function withPermission(chromium, work, srv) {
  const browser = await launch(chromium, extensionCopy(work, 'granted', ['http://127.0.0.1/*', 'http://localhost/*']), work);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const local = `http://localhost:${srv.port}`;

    // Control: the server really blocks web pages (cross-origin, JSON, no CORS headers).
    const web = await browser.open(`${base}/page`);
    const control = await web(
      `fetch('${local}/cors-probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
         .then(() => 'reachable', (e) => 'blocked: ' + e.message)`,
    );
    check('control: a normal web page is blocked by CORS', control.startsWith('blocked'), control);

    const dash = await browser.open(`chrome-extension://${browser.extId}/dashboard.html`);

    srv.clear();
    let reply = await sendTest(dash, { url: `${base}/default`, headers: 'Authorization: Bearer secret' });
    let got = srv.take('/default');
    let body = got && JSON.parse(got.body);
    check(
      'default JSON body and custom header reach 127.0.0.1',
      reply?.ok === true && got?.method === 'POST' && got.headers.authorization === 'Bearer secret' &&
        got.headers['content-type'] === 'application/json' && body?.source === 'ghosted' && body.test === true &&
        body.events?.[0]?.type === 'LOST_FOLLOWER',
      { reply, headers: got?.headers, body },
    );

    srv.clear();
    reply = await sendTest(dash, { url: `${local}/slack`, template: '{"text":"{{summary}} ({{count}})","when":"{{at}}","events":{{events}}}' });
    got = srv.take('/slack');
    body = got && JSON.parse(got.body);
    check(
      'JSON template reaches localhost with placeholders filled',
      reply?.ok === true && body?.text === 'Test notification from Ghosted. (1)' && !Number.isNaN(Date.parse(body.when)) &&
        body.events?.[0]?.handle === 'example',
      { reply, body: got?.body },
    );

    srv.clear();
    reply = await sendTest(dash, { url: `${base}/text`, headers: 'Content-Type: text/plain', template: '{{summary}}' });
    got = srv.take('/text');
    check(
      'plain-text body with its own Content-Type',
      reply?.ok === true && got?.headers['content-type'] === 'text/plain' && got.body === 'Test notification from Ghosted.',
      { reply, contentType: got?.headers['content-type'], body: got?.body },
    );

    reply = await sendTest(dash, { url: 'http://127.0.0.1:1/down' });
    check('unreachable server gives a readable error', reply?.ok === false && /Could not reach/.test(reply.error), reply);

    const started = Date.now();
    reply = await sendTest(dash, { url: `${base}/hang` });
    const seconds = (Date.now() - started) / 1000;
    let errors = await storedErrors(dash);
    check(
      `server that never answers fails after ~${SEND_TIMEOUT_S} s and the error is kept for Settings`,
      reply?.ok === false && reply.error.includes(`no answer within ${SEND_TIMEOUT_S} s`) && seconds < SEND_TIMEOUT_S + 5 &&
        /no answer/.test(errors.webhook?.message ?? ''),
      { reply, seconds, errors },
    );

    reply = await sendTest(dash, { url: `${base}/ok-again` });
    errors = await storedErrors(dash);
    check('a later success clears the stored error', reply?.ok === true && !errors.webhook, { reply, errors });
  } finally {
    await browser.close();
  }
}

async function withoutPermission(chromium, work, srv) {
  const browser = await launch(chromium, extensionCopy(work, 'not-granted', []), work);
  try {
    const dash = await browser.open(`chrome-extension://${browser.extId}/dashboard.html`);
    srv.clear();
    const reply = await sendTest(dash, { url: `http://127.0.0.1:${srv.port}/denied` });
    check(
      'without permission nothing is sent and the error says why',
      reply?.ok === false && /permission/i.test(reply.error) && srv.received.length === 0,
      { reply, received: srv.received.length },
    );
  } finally {
    await browser.close();
  }
}

// ---- main -----------------------------------------------------------------

const chromium = findChromium();
if (!process.argv.includes('--no-build')) build();
if (!existsSync(join(BUILD, 'manifest.json'))) throw new Error(`No build at ${BUILD}. Run without --no-build.`);

// Resolved: Chromium derives the extension id from the real path.
const work = realpathSync(mkdtempSync(join(tmpdir(), 'ghosted-e2e-')));
const srv = await startServer();
console.log(`Chromium: ${chromium}\n`);
try {
  await withPermission(chromium, work, srv);
  await withoutPermission(chromium, work, srv);
} catch (e) {
  results.push(false);
  console.error(`\nERROR  ${e.message}`);
} finally {
  srv.close();
  rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
