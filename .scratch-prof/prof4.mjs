/**
 * 临时剖析器 4：验证候选画法（butt 端帽 / 折线近似 / 分带烘焙）的单次光栅化成本。
 * 用法: node prof4.mjs 057-truchet-dots-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-prof4-' + Date.now());
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
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 400);
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
await sleep(1400);
await ev(`(() => { const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','而我在原地等了很久','直到夜色把一切收走'];
  const lines = [];
  for (let i = 0; i < 30; i++) { const text = texts[i % texts.length]; const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: i * 2.4 + k * 0.22, d: 0.22, c: text[k] });
    lines.push({ t: i * 2.4, dur: 2.4, text, chars }); }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255] } }, '*'); return 1; })()`);
await sleep(3200);
await ev(`(() => { window.requestAnimationFrame = function () { return 0; }; return 1; })()`);
await sleep(200);

const SETUP = `(() => {
  window.__flush = () => { ctx.getImageData(0, 0, 1, 1); };
  const E = [[3, 1], [0, 2]];
  /* 折线网：每段 90 度弧用 K 段折线 */
  function polyNet(K, band) {
    const p0 = new Path2D(), p1 = new Path2D();
    const j0 = band ? band[0] : 0, j1 = band ? band[1] : rows;
    for (let j = j0; j < j1; j++) for (let i = 0; i < cols; i++) {
      const t = j * cols + i, x = ox + i * cell, y = oy + j * cell, ty = pat.types[t];
      for (let a = 0; a < 2; a++) {
        const p = pat.loopArc[t * 2 + a] ? p1 : p0;
        dotAt(ty, a, E[ty][a], x, y, cell, 0); p.moveTo(_dx, _dy);
        for (let q = 1; q <= K; q++) { dotAt(ty, a, E[ty][a], x, y, cell, q / K); p.lineTo(_dx, _dy); }
      }
    }
    return [p0, p1];
  }
  /* 同样分带的弧版（原版几何） */
  function arcNet(band) {
    const p0 = new Path2D(), p1 = new Path2D();
    const j0 = band ? band[0] : 0, j1 = band ? band[1] : rows;
    for (let j = j0; j < j1; j++) { const y = oy + j * cell, row = j * cols;
      for (let i = 0; i < cols; i++) { const t = row + i, x = ox + i * cell, ty = pat.types[t];
        const c0 = pat.loopArc[t * 2], c1 = pat.loopArc[t * 2 + 1];
        addArc(c0 ? p1 : p0, ty, 0, x, y, cell); addArc(c1 ? p1 : p0, ty, 1, x, y, cell); } }
    return [p0, p1];
  }
  window.__polyNet = polyNet; window.__arcNet = arcNet;
  window.__p2 = polyNet(2); window.__p3 = polyNet(3); window.__arcFull = arcNet(null);
  window.__bands8 = []; for (let b = 0; b < 8; b++) window.__bands8.push(arcNet([Math.floor(b * rows / 8), Math.floor((b + 1) * rows / 8)]));
  window.__bands8p = []; for (let b = 0; b < 8; b++) window.__bands8p.push(polyNet(2, [Math.floor(b * rows / 8), Math.floor((b + 1) * rows / 8)]));
  window.__bands16p = []; for (let b = 0; b < 16; b++) window.__bands16p.push(polyNet(2, [Math.floor(b * rows / 16), Math.floor((b + 1) * rows / 16)]));
  return { cols: cols, rows: rows, cell: cell }; })()`;
console.log('setup:', JSON.stringify(await ev(SETUP)));

const TIME = (code, pre) => `(() => { ${pre || ''}
  const op = () => { ${code} };
  const T = [];
  for (let r = 0; r < 6; r++) { const t0 = performance.now(); op(); window.__flush(); T.push(performance.now() - t0); }
  T.sort((a, b) => a - b); return { min: +T[0].toFixed(2), med: +T[3].toFixed(2) }; })()`;

const P = `ctx.globalCompositeOperation='lighter';`;
const tests = [
  ['A 弧 + round 端帽（现状）', `${P} ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=1.4; ctx.strokeStyle='rgba(206,196,190,0.045)'; ctx.stroke(window.__arcFull[0]);`],
  ['B 弧 + butt/bevel', `${P} ctx.lineCap='butt'; ctx.lineJoin='bevel'; ctx.lineWidth=1.4; ctx.strokeStyle='rgba(206,196,190,0.045)'; ctx.stroke(window.__arcFull[0]);`],
  ['C 折线K=2 + butt/miter', `${P} ctx.lineCap='butt'; ctx.lineJoin='miter'; ctx.lineWidth=1.4; ctx.strokeStyle='rgba(206,196,190,0.045)'; ctx.stroke(window.__p2[0]);`],
  ['D 折线K=3 + butt/miter', `${P} ctx.lineCap='butt'; ctx.lineJoin='miter'; ctx.lineWidth=1.4; ctx.strokeStyle='rgba(206,196,190,0.045)'; ctx.stroke(window.__p3[0]);`],
  ['E 折线K=2 两条(开+闭)', `${P} ctx.lineCap='butt'; ctx.lineJoin='miter'; ctx.lineWidth=1.4; ctx.stroke(window.__p2[0]); ctx.lineWidth=3; ctx.stroke(window.__p2[1]);`],
];
for (const [name, code] of tests) console.log(name.padEnd(28), JSON.stringify(await ev(TIME(code))));

console.log('—— 分带（弧版，8 带）——');
console.log(JSON.stringify(await ev(`(() => {
  const out = []; ${P} ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=1.4; ctx.strokeStyle='rgba(206,196,190,0.045)';
  for (let b = 0; b < 8; b++) { const t0 = performance.now(); ctx.stroke(window.__bands8[b][0]); window.__flush(); out.push(+(performance.now()-t0).toFixed(1)); }
  return out; })()`)));
console.log('—— 分带（折线K=2, 8 带）——');
console.log(JSON.stringify(await ev(`(() => {
  const out = []; ${P} ctx.lineCap='butt'; ctx.lineJoin='miter'; ctx.lineWidth=1.4; ctx.strokeStyle='rgba(206,196,190,0.045)';
  for (let b = 0; b < 8; b++) { const t0 = performance.now(); ctx.stroke(window.__bands8p[b][0]); window.__flush(); out.push(+(performance.now()-t0).toFixed(1)); }
  return out; })()`)));
console.log('—— 分带（折线K=2, 16 带）——');
console.log(JSON.stringify(await ev(`(() => {
  const out = []; ${P} ctx.lineCap='butt'; ctx.lineJoin='miter'; ctx.lineWidth=1.4; ctx.strokeStyle='rgba(206,196,190,0.045)';
  for (let b = 0; b < 16; b++) { const t0 = performance.now(); ctx.stroke(window.__bands16p[b][0]); window.__flush(); out.push(+(performance.now()-t0).toFixed(1)); }
  return out; })()`)));
console.log('—— 全屏 blit + 光点 的整帧成本 ——');
console.log(JSON.stringify(await ev(`(() => {
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  window.__vig = document.createElement('canvas'); window.__vig.width = cv.width >> 1; window.__vig.height = cv.height >> 1;
  const v = window.__vig.getContext('2d'); v.setTransform(DPR/2, 0, 0, DPR/2, 0, 0); v.fillStyle = vigGrad; v.fillRect(0, 0, W, H);
  window.__T = { blit: [], vig: [], dots: [] };
  for (let r = 0; r < 5; r++) {
    let t0 = performance.now(); ctx.globalCompositeOperation='source-over'; ctx.drawImage(c,0,0,W,H); window.__flush(); window.__T.blit.push(performance.now()-t0);
    t0 = performance.now(); ctx.drawImage(window.__vig,0,0,W,H); window.__flush(); window.__T.vig.push(performance.now()-t0);
    t0 = performance.now(); const ac = accent;
    ctx.globalCompositeOperation='lighter'; ctx.fillStyle='rgba(214,206,198,0.30)'; ctx.beginPath();
    for (let k=0;k<N;k++){ if (ptrap[k]) continue; const t=pj[k]*cols+pi[k]; dotAt(pat.types[t], pat.arcOf[t*4+pe[k]], pe[k], ox+pi[k]*cell, oy+pj[k]*cell, cell, ps[k]); ctx.rect(_dx-0.7,_dy-0.7,1.4,1.4); } ctx.fill();
    ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.14)'; ctx.beginPath();
    for (let k=0;k<N;k++){ if (!ptrap[k]) continue; const t=pj[k]*cols+pi[k]; dotAt(pat.types[t], pat.arcOf[t*4+pe[k]], pe[k], ox+pi[k]*cell, oy+pj[k]*cell, cell, ps[k]); ctx.rect(_dx-3.4,_dy-3.4,6.8,6.8); } ctx.fill();
    ctx.fillStyle='rgba(255,'+Math.min(255,ac[1]+30)+','+Math.min(255,ac[2]+60)+',0.92)'; ctx.beginPath();
    for (let k=0;k<N;k++){ if (!ptrap[k]) continue; const t=pj[k]*cols+pi[k]; dotAt(pat.types[t], pat.arcOf[t*4+pe[k]], pe[k], ox+pi[k]*cell, oy+pj[k]*cell, cell, ps[k]); ctx.rect(_dx-1.15,_dy-1.15,2.3,2.3); } ctx.fill();
    window.__flush(); window.__T.dots.push(performance.now()-t0);
  }
  const mn = (a) => +Math.min.apply(null, a).toFixed(2);
  return { blit: mn(window.__T.blit), vig: mn(window.__T.vig), dots: mn(window.__T.dots) }; })()`)));
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}