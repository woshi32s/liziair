/**
 * 临时剖析器 7：058 主通道描边的候选优化（join/cap、jagged 层数、缓存贴图）。
 * 用法: node prof7.mjs 058-lightning-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-prof7-' + Date.now());
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
  window.__tk = setInterval(() => { t += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: t, playing: true } }, '*'); }, 66);
  return 1; })()`);
await sleep(4600);
await ev(`(() => { window.requestAnimationFrame = function () { return 0; }; window.__flush = () => { ctx.getImageData(0, 0, 1, 1); }; return 1; })()`);
await sleep(200);
console.log('build:', JSON.stringify(await ev(`(() => {
  const v = set.vars[0];
  const b0 = set.base;
  const b1 = jagged(b0, 1, 1.15); const p1 = pathOf(b1); const L1 = lengthOf(b1);
  const b2 = jagged(b0, 2, 1.15); const p2 = pathOf(b2); const L2 = lengthOf(b2);
  const b3 = jagged(b0, 3, 1.15); const p3 = pathOf(b3); const L3 = lengthOf(b3);
  window.__V = { b0n: b0.length/2, p0: pathOf(b0), L0: lengthOf(b0),
                 n1: b1.length/2, p1: p1, L1: L1, n2: b2.length/2, p2: p2, L2: L2, n3: b3.length/2, p3: p3, L3: L3 };
  /* 缓存：把整根闪电按全 alpha 画进一张离屏图 */
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d'); x.setTransform(DPR,0,0,DPR,0,0);
  x.globalCompositeOperation = 'lighter'; x.lineCap='round'; x.lineJoin='round';
  x.strokeStyle='hsla(240,100%,72%,0.10)'; x.lineWidth=13; x.stroke(p2);
  x.strokeStyle='hsla(225,100%,82%,0.28)'; x.lineWidth=6; x.stroke(p2);
  x.strokeStyle='rgba(190,205,255,0.20)'; x.lineWidth=9; x.stroke(p2);
  x.strokeStyle='hsla(212,100%,88%,0.62)'; x.lineWidth=2.2; x.stroke(p2);
  x.strokeStyle='hsla(210,100%,97%,0.95)'; x.lineWidth=1.1; x.stroke(p2);
  x.getImageData(0,0,1,1);
  window.__cache = c;
  return { base: b0.length/2, n1: b1.length/2, L1: L1.toFixed(0), n2: b2.length/2, L2: L2.toFixed(0), n3: b3.length/2, L3: L3.toFixed(0), L0: lengthOf(b0).toFixed(0) }; })()`)));

const TIME = (code, pre) => `(() => { ${pre || ''}
  const op = () => { ${code} };
  const T = [];
  for (let r = 0; r < 6; r++) { const t0 = performance.now(); op(); window.__flush(); T.push(performance.now() - t0); }
  T.sort((a, b) => a - b); return { min: +T[0].toFixed(2), med: +T[3].toFixed(2) }; })()`;

const S = (p, join, cap, dash) => `${p} ctx.globalCompositeOperation='lighter'; ctx.lineJoin='${join}'; ctx.lineCap='${cap}'; ctx.setLineDash(${dash});
   ctx.strokeStyle='hsla(212,100%,88%,0.62)'; ctx.lineWidth=2.2; ctx.stroke(${p === 'v.main' ? 'v.main' : p});
   ctx.strokeStyle='hsla(210,100%,97%,0.95)'; ctx.lineWidth=1.1; ctx.stroke(${p === 'v.main' ? 'v.main' : p}); ctx.setLineDash([]);`;

const cases = [
  ['现状 round/round 实线 (v.main)', `const v=set.vars[0]; prog=1;`, S('v.main', 'round', 'round', '[]')],
  ['bevel/butt 实线', `const v=set.vars[0]; prog=1;`, S('v.main', 'bevel', 'butt', '[]')],
  ['miter/butt 实线', `const v=set.vars[0]; prog=1;`, S('v.main', 'miter', 'butt', '[]')],
  ['miter/butt 实线 (jagged1, ½点)', `const v={main:window.__V.p1,mainLen:window.__V.L1};`, S('v.main', 'miter', 'butt', '[]')],
  ['miter/butt 实线 (jagged0, ¼点)', `const v={main:window.__V.p0,mainLen:window.__V.L0};`, S('v.main', 'miter', 'butt', '[]')],
  ['miter/butt 5 条全画(jagged2)', `const v=set.vars[0]; prog=1;`, `ctx.globalCompositeOperation='lighter'; ctx.lineJoin='miter'; ctx.lineCap='butt'; ctx.setLineDash([]);
     ctx.strokeStyle='hsla(240,100%,72%,0.10)'; ctx.lineWidth=13; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(225,100%,82%,0.28)'; ctx.lineWidth=6; ctx.stroke(v.main);
     ctx.strokeStyle='rgba(190,205,255,0.20)'; ctx.lineWidth=9; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(212,100%,88%,0.62)'; ctx.lineWidth=2.2; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(210,100%,97%,0.95)'; ctx.lineWidth=1.1; ctx.stroke(v.main);`],
  ['miter/butt 5 条全画(jagged1)', `const v={main:window.__V.p1,mainLen:window.__V.L1}; prog=1;`, `ctx.globalCompositeOperation='lighter'; ctx.lineJoin='miter'; ctx.lineCap='butt'; ctx.setLineDash([]);
     ctx.strokeStyle='hsla(240,100%,72%,0.10)'; ctx.lineWidth=13; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(225,100%,82%,0.28)'; ctx.lineWidth=6; ctx.stroke(v.main);
     ctx.strokeStyle='rgba(190,205,255,0.20)'; ctx.lineWidth=9; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(212,100%,88%,0.62)'; ctx.lineWidth=2.2; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(210,100%,97%,0.95)'; ctx.lineWidth=1.1; ctx.stroke(v.main);`],
  ['miter/butt 5 条 + dash prog=1', `const v=set.vars[0]; prog=1;`, `ctx.globalCompositeOperation='lighter'; ctx.lineJoin='miter'; ctx.lineCap='butt';
     const dl=prog*v.mainLen; ctx.setLineDash([dl, v.mainLen]);
     ctx.strokeStyle='hsla(240,100%,72%,0.10)'; ctx.lineWidth=13; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(225,100%,82%,0.28)'; ctx.lineWidth=6; ctx.stroke(v.main);
     ctx.strokeStyle='rgba(190,205,255,0.20)'; ctx.lineWidth=9; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(212,100%,88%,0.62)'; ctx.lineWidth=2.2; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(210,100%,97%,0.95)'; ctx.lineWidth=1.1; ctx.stroke(v.main); ctx.setLineDash([]);`],
  ['miter/butt 5 条 + dash prog=0.4', `const v=set.vars[0]; prog=0.4;`, `ctx.globalCompositeOperation='lighter'; ctx.lineJoin='miter'; ctx.lineCap='butt';
     const dl=prog*v.mainLen; ctx.setLineDash([dl, v.mainLen]);
     ctx.strokeStyle='hsla(240,100%,72%,0.10)'; ctx.lineWidth=13; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(225,100%,82%,0.28)'; ctx.lineWidth=6; ctx.stroke(v.main);
     ctx.strokeStyle='rgba(190,205,255,0.20)'; ctx.lineWidth=9; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(212,100%,88%,0.62)'; ctx.lineWidth=2.2; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(210,100%,97%,0.95)'; ctx.lineWidth=1.1; ctx.stroke(v.main); ctx.setLineDash([]);`],
  ['缓存图 blit (globalAlpha=1)', ``, `ctx.globalCompositeOperation='lighter'; ctx.globalAlpha=0.8; ctx.drawImage(window.__cache,0,0,W,H); ctx.globalAlpha=1;`],
];
for (const [n, pre, code] of cases) console.log(n.padEnd(34), JSON.stringify(await ev(TIME(code, pre))));

console.log('—— 缓存重建一次要多久（含 5 条 stroke + flush）——');
console.log(JSON.stringify(await ev(`(() => {
  const x = window.__cache.getContext('2d');
  const t0 = performance.now();
  x.setTransform(1,0,0,1,0,0); x.clearRect(0,0,cv.width,cv.height); x.setTransform(DPR,0,0,DPR,0,0);
  x.globalCompositeOperation='lighter'; x.lineJoin='miter'; x.lineCap='butt';
  const v = set.vars[0]; const p = window.__V.p2;
  x.strokeStyle='hsla(240,100%,72%,0.10)'; x.lineWidth=13; x.stroke(p);
  x.strokeStyle='hsla(225,100%,82%,0.28)'; x.lineWidth=6; x.stroke(p);
  x.strokeStyle='rgba(190,205,255,0.20)'; x.lineWidth=9; x.stroke(p);
  x.strokeStyle='hsla(212,100%,88%,0.62)'; x.lineWidth=2.2; x.stroke(p);
  x.strokeStyle='hsla(210,100%,97%,0.95)'; x.lineWidth=1.1; x.stroke(p);
  x.getImageData(0,0,1,1);
  return +(performance.now()-t0).toFixed(1); })()`)));
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}