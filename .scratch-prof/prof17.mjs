/* 临时性能归因：同一个页面里依次关掉各图层，量 fps。
   用法: node prof17.mjs [file] */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2] || '017-truchet-glow-lyrics.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lp-prof-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout'))), 60000); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 200);
  return r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
await sleep(1200);
await ev(`(() => { const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','而我在原地等了很久'];
  const lines = [];
  for (let i = 0; i < 30; i++) { const text = texts[i % texts.length]; const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: i * 2.4 + k * 0.22, d: 0.22, c: text[k] });
    lines.push({ t: i * 2.4, dur: 2.4, text, chars }); }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255] } }, '*');
  window.__t = 0;
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  window.__tk = setInterval(() => { window.__t += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__t, playing: true } }, '*'); }, 66);
  return 1; })()`);

const MEASURE = (ms) => `new Promise((res) => {
  const a = []; let last = performance.now(); const t0 = last;
  function f() { const n = performance.now(); a.push(n - last); last = n;
    if (n - t0 < ${ms}) requestAnimationFrame(f);
    else { const s = a.slice(4).sort((x, y) => x - y);
      res({ fps: +(1000 / (s.reduce((p, q) => p + q, 0) / s.length)).toFixed(1),
            p95: +s[Math.floor(s.length * 0.95)].toFixed(1) }); } }
  requestAnimationFrame(f); })`;

const cases = [
  ['all', null],
  ['-glyph', { glyph: 1 }],
  ['-track', { track: 1 }],
  ['-band', { band: 1 }],
  ['-grid', { grid: 1 }],
  ['-vig', { vig: 1 }],
  ['bare', { glyph: 1, track: 1, band: 1, grid: 1, vig: 1 }],
];
console.log('case      fps    p95');
for (const [name, skip] of cases) {
  await ev(`window.__skip = ${JSON.stringify(skip || {})}; 1`);
  await sleep(350);
  const r = await ev(MEASURE(1500));
  console.log(name.padEnd(9), String(r.fps).padStart(5), String(r.p95).padStart(6));
}
await ev('window.__skip = {}; 1');
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
