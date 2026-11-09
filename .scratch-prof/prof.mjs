/**
 * 临时性能剖析器（不参与产品，用完即删）：
 * 加载单个形态，喂歌词，然后按 canvas 调用类别 / 顶层函数统计每帧耗时。
 * 用法: node prof.mjs 057-truchet-dots-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-prof-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; console.log('EXC:', ((d.exception && d.exception.description) || d.text || '').split('\n')[0]); }
};
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout'))), 60000);
});
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 200);
  return r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });

const FEED = `(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','而我在原地等了很久','直到夜色把一切收走'];
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const text = texts[i % texts.length];
    const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: i * 2.4 + k * 0.22, d: 0.22, c: text[k] });
    lines.push({ t: i * 2.4, dur: 2.4, text, chars });
  }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255] } }, '*');
  let t = 0;
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => {
    t += 0.066;
    window.postMessage({ __c100: 1, type: 'tick', payload: { time: t, playing: true } }, '*');
    if (Math.random() < 0.06) window.postMessage({ __c100: 1, type: 'beat', payload: { level: 0.7, bpm: 120 } }, '*');
  }, 66);
  return 1;
})()`;

await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
await sleep(1400);
console.log('feed:', await ev(FEED));
await sleep(4200);

/* 装探针：canvas 调用分类计时 + 顶层函数计时 + rAF 计数 */
const INSTR = `(() => {
  const P = window.__P = { op: {}, fn: {}, frames: 0, big: [] };
  const c = document.getElementById('c') || document.querySelector('canvas');
  const ctx = c.getContext('2d');
  const bump = (o, k, t, n) => { const e = o[k] || (o[k] = { t: 0, n: 0 }); e.t += t; e.n += n; };
  const wrap = (name, keyFn) => {
    const orig = ctx[name];
    if (typeof orig !== 'function') return;
    ctx[name] = function (...a) {
      const t0 = performance.now(); const r = orig.apply(this, a); const d = performance.now() - t0;
      const k = keyFn ? keyFn(a, this) : name;
      bump(window.__P.op, k, d, 1);
      return r;
    };
  };
  wrap('stroke', (a, th) => 'stroke w=' + (th.lineWidth || 1) + ' ' + String(th.strokeStyle).slice(0, 30));
  wrap('fill', (a, th) => 'fill ' + (a[0] && a[0].constructor ? a[0].constructor.name : '') + ' ' + String(th.fillStyle).slice(0, 24));
  wrap('fillRect', (a, th) => 'fillRect ' + String(th.fillStyle).slice(0, 24));
  wrap('drawImage');
  wrap('clearRect');
  wrap('getImageData');
  wrap('putImageData');
  for (const fn of ['draw', 'stepParticles', 'timing', 'buildPattern', 'makeSet', 'makeVariant', 'drawBolt']) {
    const orig = window[fn];
    if (typeof orig !== 'function') continue;
    window[fn] = function (...a) { const t0 = performance.now(); const r = orig.apply(this, a); bump(window.__P.fn, fn, performance.now() - t0, 1); return r; };
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) { return raf(function (n) { window.__P.frames++; return cb(n); }); };
  return 'ok';
})()`;
console.log('instr:', await ev(INSTR));

const fps = await ev(`new Promise((res) => {
  const ts = []; let last = performance.now(); const t0 = last; const big = [];
  function f() { const n = performance.now(); const d = n - last; ts.push(d); if (d > 40) big.push(+d.toFixed(1)); last = n;
    if (n - t0 < 2500) requestAnimationFrame(f);
    else { const a = ts.slice(3).sort((x, y) => x - y); res({ fps: +(1000 / (a.reduce((p, q) => p + q, 0) / a.length)).toFixed(1), big: big, n: ts.length }); } }
  requestAnimationFrame(f);
})`);
console.log('FPS', JSON.stringify(fps));
const prof = await ev(`(() => { const P = window.__P; const F = P.frames || 1;
  const out = { frames: P.frames, op: {}, fn: {} };
  for (const k in P.op) out.op[k] = { ms: +(P.op[k].t / F).toFixed(3), n: +(P.op[k].n / F).toFixed(1) };
  for (const k in P.fn) out.fn[k] = { ms: +(P.fn[k].t / F).toFixed(3), n: +(P.fn[k].n / F).toFixed(1) };
  return out; })()`);
console.log(JSON.stringify(prof, null, 1));
console.log('STAGE', JSON.stringify(await ev('window.__stage ? window.__stage() : null')));

ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}