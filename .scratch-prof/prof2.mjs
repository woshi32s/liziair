/**
 * 临时剖析器 2：把 draw() 拆成若干开关，逐个关掉测 fps，定位到底是哪几行在吃时间。
 * 用法: node prof2.mjs 057-truchet-dots-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-prof2-' + Date.now());
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
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 300);
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
await ev(FEED);
await sleep(4200);

/* 参数化重写 draw：F 里每个开关控制一段 */
const MK = `(() => {
  window.__F = {};
  const F = window.__F;
  window.__mkdraw = () => function draw() {
    ctx.globalCompositeOperation = 'source-over';
    if (F.bg) { ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H); }
    if (F.center) { ctx.fillStyle = centerGrad; ctx.fillRect(0, 0, W, H); }
    if (F.checker) { ctx.fillStyle = 'rgba(255,226,196,0.016)'; ctx.fill(checkerPath); }
    if (F.grid) { ctx.strokeStyle = 'rgba(255,226,196,0.028)'; ctx.lineWidth = 1; ctx.stroke(gridPath);
                  ctx.strokeStyle = 'rgba(255,226,196,0.028)'; ctx.stroke(gridPath); }
    ctx.globalCompositeOperation = 'lighter';
    if (pat && F.net) {
      ctx.lineWidth = Math.max(1.4, cell * 0.05);
      ctx.strokeStyle = 'rgba(206,196,190,0.045)'; ctx.stroke(pat.openPath);
      ctx.lineWidth = Math.max(3, cell * 0.19);
      ctx.strokeStyle = 'rgba(255,168,96,0.045)'; ctx.stroke(pat.closedPath);
      ctx.lineWidth = Math.max(1.6, cell * 0.075);
      ctx.strokeStyle = 'rgba(255,196,132,0.20)'; ctx.stroke(pat.closedPath);
    }
    if (pat && N && F.dots) {
      const ac = accent;
      ctx.fillStyle = 'rgba(214,206,198,0.30)'; ctx.beginPath();
      for (let k = 0; k < N; k++) { if (ptrap[k]) continue; const t = pj[k] * cols + pi[k];
        dotAt(pat.types[t], pat.arcOf[t * 4 + pe[k]], pe[k], ox + pi[k] * cell, oy + pj[k] * cell, cell, ps[k]);
        ctx.rect(_dx - 0.7, _dy - 0.7, 1.4, 1.4); }
      ctx.fill();
      ctx.fillStyle = 'rgba(' + ac[0] + ',' + ac[1] + ',' + ac[2] + ',0.14)'; ctx.beginPath();
      for (let k = 0; k < N; k++) { if (!ptrap[k]) continue; const t = pj[k] * cols + pi[k];
        dotAt(pat.types[t], pat.arcOf[t * 4 + pe[k]], pe[k], ox + pi[k] * cell, oy + pj[k] * cell, cell, ps[k]);
        ctx.rect(_dx - 3.4, _dy - 3.4, 6.8, 6.8); }
      ctx.fill();
      ctx.fillStyle = 'rgba(255,' + Math.min(255, ac[1] + 30) + ',' + Math.min(255, ac[2] + 60) + ',0.92)'; ctx.beginPath();
      for (let k = 0; k < N; k++) { if (!ptrap[k]) continue; const t = pj[k] * cols + pi[k];
        dotAt(pat.types[t], pat.arcOf[t * 4 + pe[k]], pe[k], ox + pi[k] * cell, oy + pj[k] * cell, cell, ps[k]);
        ctx.rect(_dx - 1.15, _dy - 1.15, 2.3, 2.3); }
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (F.vig) { ctx.fillStyle = vigGrad; ctx.fillRect(0, 0, W, H); }
  };
  window.__cb = 0; window.__cbN = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) { return raf(function (n) { const a = performance.now(); window.__cbN++; cb(n); window.__cb += performance.now() - a; }); };
  return 1;
})()`;
console.log('mk:', await ev(MK));

const MEASURE = (flags) => `(() => {
  for (const k in window.__F) delete window.__F[k];
  Object.assign(window.__F, ${JSON.stringify(flags)});
  window.draw = window.__mkdraw();
  window.__cb = 0; window.__cbN = 0;
  return new Promise((res) => {
    const ts = []; let last = performance.now(); const t0 = last;
    function f() { const n = performance.now(); ts.push(n - last); last = n;
      if (n - t0 < 1800) requestAnimationFrame(f);
      else { const a = ts.slice(3).sort((x, y) => x - y); res({ fps: +(1000 / (a.reduce((p, q) => p + q, 0) / a.length)).toFixed(1), cb: +(window.__cb / Math.max(1, window.__cbN)).toFixed(2), n: ts.length }); } }
    requestAnimationFrame(f);
  });
})()`;

const cases = [
  ['全部（基线）', { bg: 1, center: 1, checker: 1, grid: 1, net: 1, dots: 1, vig: 1 }],
  ['不画网格 gridPath', { bg: 1, center: 1, checker: 1, net: 1, dots: 1, vig: 1 }],
  ['不画网格 + 画两遍测双倍', { bg: 1, center: 1, checker: 1, grid: 1, net: 1, dots: 1, vig: 1 }],
  ['不画 checker 棋盘', { bg: 1, center: 1, grid: 1, net: 1, dots: 1, vig: 1 }],
  ['不画网（3 条 stroke）', { bg: 1, center: 1, checker: 1, grid: 1, dots: 1, vig: 1 }],
  ['不画光点', { bg: 1, center: 1, checker: 1, grid: 1, net: 1, vig: 1 }],
  ['不画背景(2渐变)+暗角', { checker: 1, grid: 1, net: 1, dots: 1 }],
  ['只画光点', { dots: 1 }],
  ['什么都不画', {}],
];
for (const [name, fl] of cases) {
  const r = await ev(MEASURE(fl));
  console.log(String(name).padEnd(26), JSON.stringify(r));
}
console.log('STAGE', JSON.stringify(await ev('window.__stage ? window.__stage() : null')));
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}