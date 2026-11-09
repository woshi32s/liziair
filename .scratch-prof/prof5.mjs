/**
 * 临时剖析器 5：对比两种"整张网"烘焙方式的真实总耗时（含强制 flush）。
 *  A 弧线描边（butt 端帽，分 16 带）
 *  B 4 种弧精灵 drawImage 贴图
 *  C 背景用周期性 pattern 一次铺 + 只画字形区（bb）的弧
 * 用法: node prof5.mjs 057-truchet-dots-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-prof5-' + Date.now());
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
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255] } }, '*'); return 1; })()`);
await sleep(3200);
await ev(`(() => { window.requestAnimationFrame = function () { return 0; }; return 1; })()`);
await sleep(200);

console.log('setup:', JSON.stringify(await ev(`(() => {
  window.__flush = () => { ctx.getImageData(0, 0, 1, 1); };
  /* --- 精灵：4 种弧样 × 3 种线型 --- */
  const styles = [
    { k: 'open', w: Math.max(1.4, cell * 0.05), col: 'rgba(206,196,190,0.045)' },
    { k: 'cg', w: Math.max(3, cell * 0.19), col: 'rgba(255,168,96,0.045)' },
    { k: 'cc', w: Math.max(1.6, cell * 0.075), col: 'rgba(255,196,132,0.20)' },
  ];
  const spr = {}; let pad = 0;
  for (const s of styles) {
    const p = Math.ceil(s.w / 2) + 1; if (p > pad) pad = p;
  }
  window.__pad = pad;
  for (const s of styles) for (let ty = 0; ty < 2; ty++) for (let a = 0; a < 2; a++) {
    const S = cell + pad * 2;
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d');
    x.translate(pad, pad); x.lineCap = 'butt'; x.lineJoin = 'bevel';
    x.lineWidth = s.w; x.strokeStyle = s.col;
    const pth = new Path2D(); addArc(pth, ty, a, 0, 0, cell); x.stroke(pth);
    spr[s.k + ty + a] = c;
  }
  window.__spr = spr; window.__pad = pad;
  /* --- 分带 Path2D（弧，butt）--- */
  function arcBand(j0, j1) {
    const p0 = new Path2D(), p1 = new Path2D();
    for (let j = j0; j < j1; j++) { const y = oy + j * cell, row = j * cols;
      for (let i = 0; i < cols; i++) { const t = row + i, x = ox + i * cell, ty = pat.types[t];
        const c0 = pat.loopArc[t * 2], c1 = pat.loopArc[t * 2 + 1];
        addArc(c0 ? p1 : p0, ty, 0, x, y, cell); addArc(c1 ? p1 : p0, ty, 1, x, y, cell); } }
    return [p0, p1];
  }
  window.__arcBand = arcBand;
  /* --- 周期性背景 pattern（类型只由 i&1 决定，2 格周期）--- */
  const pw = cell * 2, ph = cell;
  const pc = document.createElement('canvas'); pc.width = pw; pc.height = ph;
  const px = pc.getContext('2d'); px.lineCap = 'butt'; px.lineJoin = 'bevel';
  const so = styles[0];
  px.lineWidth = so.w; px.strokeStyle = so.col;
  for (let i = 0; i < 2; i++) { const pth = new Path2D(); addArc(pth, i & 1, 0, i * cell, 0, cell); addArc(pth, i & 1, 1, i * cell, 0, cell); px.stroke(pth); }
  window.__patTile = pc;
  window.__pat = ctx.createPattern(pc, 'repeat');
  window.__bb = pat.bb;
  return { cols: cols, rows: rows, cell: cell, pad: pad, bb: pat.bb, loops: pat.loopTiles.length }; })()`)));

const backdrop = (x) => `
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  x.fillStyle = bgGrad; x.fillRect(0, 0, W, H);
  x.fillStyle = centerGrad; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,226,196,0.016)'; x.fill(checkerPath);
  x.strokeStyle = 'rgba(255,226,196,0.028)'; x.lineWidth = 1; x.stroke(gridPath);`;

/* A: 分带弧线描边 */
console.log('A 弧线描边(butt, 16带) 总耗时', JSON.stringify(await ev(`(() => {
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d'); x.setTransform(DPR,0,0,DPR,0,0);
  const t0 = performance.now();
  ${backdrop('x')}
  x.globalCompositeOperation = 'lighter'; x.lineCap = 'butt'; x.lineJoin = 'bevel';
  const w1 = Math.max(1.4, cell*0.05), w2 = Math.max(3, cell*0.19), w3 = Math.max(1.6, cell*0.075);
  for (let b = 0; b < 16; b++) {
    const [p0, p1] = window.__arcBand(Math.floor(b*rows/16), Math.floor((b+1)*rows/16));
    x.lineWidth = w1; x.strokeStyle = 'rgba(206,196,190,0.045)'; x.stroke(p0);
    x.lineWidth = w2; x.strokeStyle = 'rgba(255,168,96,0.045)'; x.stroke(p1);
    x.lineWidth = w3; x.strokeStyle = 'rgba(255,196,132,0.20)'; x.stroke(p1);
  }
  x.getImageData(0,0,1,1);
  return +(performance.now() - t0).toFixed(1); })()`)));

/* B: 精灵贴图 */
const spriteBake = `
  const spr = window.__spr, pad = window.__pad;
  for (let j = 0; j < rows; j++) { const y = oy + j * cell, row = j * cols;
    for (let i = 0; i < cols; i++) { const t = row + i, x0 = ox + i * cell, ty = pat.types[t];
      const c0 = pat.loopArc[t*2], c1 = pat.loopArc[t*2+1];
      x.drawImage(spr['open' + ty + 0], x0 - pad, y - pad);
      x.drawImage(spr['open' + ty + 1], x0 - pad, y - pad);
      if (c0) { x.drawImage(spr['cg' + ty + 0], x0 - pad, y - pad); x.drawImage(spr['cc' + ty + 0], x0 - pad, y - pad); }
      if (c1) { x.drawImage(spr['cg' + ty + 1], x0 - pad, y - pad); x.drawImage(spr['cc' + ty + 1], x0 - pad, y - pad); }
    } }`;
console.log('B 弧精灵贴图 总耗时', JSON.stringify(await ev(`(() => {
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d'); x.setTransform(DPR,0,0,DPR,0,0);
  const t0 = performance.now();
  ${backdrop('x')}
  x.globalCompositeOperation = 'lighter';
  ${spriteBake}
  x.getImageData(0,0,1,1);
  return +(performance.now() - t0).toFixed(1); })()`)));

/* C: 背景 pattern 一次铺 + bb 内弧线描边 */
console.log('C pattern铺背景 + bb内描边', JSON.stringify(await ev(`(() => {
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d'); x.setTransform(DPR,0,0,DPR,0,0);
  const t0 = performance.now();
  ${backdrop('x')}
  x.globalCompositeOperation = 'lighter';
  const bb = window.__bb;
  if (bb) {
    const bx0 = ox + bb.i0 * cell, bx1 = ox + (bb.i1+1) * cell, by0 = oy + bb.j0 * cell, by1 = oy + (bb.j1+1) * cell;
    x.fillStyle = window.__pat;
    x.save(); x.beginPath(); x.rect(-10, -10, W + 20, by0 + 10); x.rect(-10, by1, W + 20, H - by1 + 20);
    x.rect(-10, by0, bx0 + 10, by1 - by0); x.rect(bx1, by0, W - bx1 + 20, by1 - by0); x.clip();
    x.fillRect(0, 0, W, H); x.restore();
    x.lineCap='butt'; x.lineJoin='bevel';
    const p0 = new Path2D(), p1 = new Path2D();
    for (let j = bb.j0; j <= bb.j1; j++) for (let i = bb.i0; i <= bb.i1; i++) {
      const t = j * cols + i, ty = pat.types[t], x0 = ox + i * cell, y0 = oy + j * cell;
      const c0 = pat.loopArc[t*2], c1 = pat.loopArc[t*2+1];
      addArc(c0 ? p1 : p0, ty, 0, x0, y0, cell); addArc(c1 ? p1 : p0, ty, 1, x0, y0, cell);
    }
    x.lineWidth=Math.max(1.4,cell*0.05); x.strokeStyle='rgba(206,196,190,0.045)'; x.stroke(p0);
    x.lineWidth=Math.max(3,cell*0.19); x.strokeStyle='rgba(255,168,96,0.045)'; x.stroke(p1);
    x.lineWidth=Math.max(1.6,cell*0.075); x.strokeStyle='rgba(255,196,132,0.20)'; x.stroke(p1);
  }
  x.getImageData(0,0,1,1);
  return +(performance.now() - t0).toFixed(1); })()`)));

/* D: 只铺背景不带网，看底价 */
console.log('D 只有背景(无网) 总耗时', JSON.stringify(await ev(`(() => {
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d'); x.setTransform(DPR,0,0,DPR,0,0);
  const t0 = performance.now();
  ${backdrop('x')}
  x.getImageData(0,0,1,1);
  return +(performance.now() - t0).toFixed(1); })()`)));
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}