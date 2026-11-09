/**
 * 临时剖析器 10：058 每帧按"上一帧干了什么"分类统计帧间隔。
 * 用法: node prof10.mjs 058-lightning-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-prof10-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; console.log('EXC:', ((d.exception && d.exception.description) || d.text || '').split('\n')[0]); } };
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout'))), 60000); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 400);
  return r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
await sleep(1400);
await ev(`(() => { const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','而我在原地等了很久','直到夜色把一切收走'];
  const lines = [];
  for (let i = 0; i < 30; i++) { const text = texts[i % texts.length]; const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: i * 2.4 + k * 0.22, d: 0.22, c: text[k] });
    lines.push({ t: i * 2.4, dur: 2.4, text, chars }); }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255] } }, '*');
  let t = 0; window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { t += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: t, playing: true } }, '*');
    if (Math.random() < 0.06) window.postMessage({ __c100: 1, type: 'beat', payload: { level: 0.7, bpm: 120 } }, '*'); }, 66);
  return 1; })()`);
await sleep(2500);

console.log('instr:', await ev(`(() => {
  window.__kind = 0; window.__rec = []; window.__lastN = performance.now();
  const K = (m) => { window.__kind |= m; };
  for (const [name, m] of [['bakeBand', 1], ['makeVariant', 2], ['makeSet', 4], ['drawBolt', 8], ['bakeSky', 16]]) {
    const o = window[name]; if (typeof o !== 'function') continue;
    window[name] = function (...a) { K(m); return o.apply(this, a); };
  }
  const oclip = CanvasRenderingContext2D.prototype.clip;
  CanvasRenderingContext2D.prototype.clip = function (...a) { K(32); return oclip.apply(this, a); };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf(function (n) {
      const dt = n - window.__lastN; window.__lastN = n;
      window.__rec.push([dt, window.__kind]);
      window.__kind = 0;
      return cb(n);
    });
  };
  return 'ok'; })()`));

const r = await ev(`new Promise((res) => {
  setTimeout(() => {
    const rec = window.__rec.slice(3);
    const g = {};
    for (const [dt, k] of rec) { const key = k === 0 ? 'plain' : (k & 1 ? 'bakeBand ' : '') + (k & 2 ? 'makeVariant ' : '') + (k & 32 ? 'growth' : ''); (g[key] = g[key] || []).push(dt); }
    const out = {};
    for (const key in g) { const a = g[key].slice().sort((x, y) => x - y);
      out[key] = { n: a.length, med: +a[(a.length / 2) | 0].toFixed(1), mean: +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(1) }; }
    const all = rec.map((x) => x[0]).sort((x, y) => x - y);
    res({ fpsAll: +(1000 / (all.reduce((p, q) => p + q, 0) / all.length)).toFixed(1), frames: all.length, byKind: out });
  }, 2500);
})`);
console.log(JSON.stringify(r, null, 1));
console.log('stage:', JSON.stringify(await ev('window.__stage()')));
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}