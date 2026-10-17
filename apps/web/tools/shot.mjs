// Dev-only screenshot helper via Chrome DevTools Protocol (no npm deps).
// Usage: node tools/shot.mjs <chromePath> <outDir> <url> <name> <width> <height> [waitMs]
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';

const [chromePath, outDir, url, name, w = '1280', h = '1600', waitMs = '2500'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const port = 9222 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--window-size=${w},${h}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Runs in the page: flips the mock localStorage db to signed-in.
function seedDemo() {
  const raw = localStorage.getItem('oli.mock.v1');
  if (raw) {
    const db = JSON.parse(raw);
    db.signedIn = true;
    localStorage.setItem('oli.mock.v1', JSON.stringify(db));
  }
}
const getJSON = (path) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});

async function main() {
  for (let i = 0; i < 40; i++) { try { await getJSON('/json/version'); break; } catch { await sleep(250); } }
  const list = await getJSON('/json/list');
  const t = list.find((x) => x.type === 'page') ?? list[0];
  const ws = t.webSocketDebuggerUrl;
  const WS = globalThis.WebSocket ? globalThis.WebSocket : (await import('ws')).WebSocket;
  const sock = new WS(ws);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => { const m = ++id; pending.set(m, res); sock.send(JSON.stringify({ id: m, method, params })); });
  await new Promise((r) => (sock.onopen = r));
  sock.onmessage = (e) => { const m = JSON.parse(e.data.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await send('Page.enable');
  await send('Runtime.enable');
  // Optional pre-seed: sign the mock session in so authed routes render.
  if (process.env.SHOT_DEMO === '1') {
    await send('Page.navigate', { url: new URL('/', url).href });
    await sleep(1800);
    await send('Runtime.evaluate', { expression: `(${seedDemo.toString()})()`, awaitPromise: true });
    await sleep(500);
  }
  await send('Page.navigate', { url });
  await sleep(Number(waitMs));
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: undefined });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, 'base64'));
  sock.close();
  chrome.kill();
  console.log(`wrote ${name}.png`);
  process.exit(0);
}
main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
