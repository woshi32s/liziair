/**
 * 临时校验：把"原版静态层"（铺底 + 整张网按原样描边）和"烘焙层"逐像素比。
 * 用法: node cmp057.mjs 057-truchet-dots-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-cmp-' + Date.now());
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
  window.__tk = setInterval(() => { t += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: t, playing: true } }, '*'); }, 66);
  return 1; })()`);
await sleep(6000);
await ev(`(() => { window.requestAnimationFrame = function () { return 0; }; return 1; })()`);
await sleep(200);
console.log('stage:', JSON.stringify(await ev('window.__stage()')));

console.log(JSON.stringify(await ev(`(() => {
  /* 原版静态层：铺底 + 整张网（round 端帽，和改动前一模一样） */
  const A = document.createElement('canvas'); A.width = cv.width; A.height = cv.height;
  const x = A.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0);
  x.lineCap = 'round'; x.lineJoin = 'round';
  const g1 = x.createLinearGradient(0, 0, 0, H);
  g1.addColorStop(0, '#0a0806'); g1.addColorStop(0.5, '#0b0806'); g1.addColorStop(1, '#070505');
  x.fillStyle = g1; x.fillRect(0, 0, W, H);
  const g2 = x.createRadialGradient(W*0.5, H*0.45, 0, W*0.5, H*0.45, Math.max(W,H)*0.72);
  g2.addColorStop(0, 'rgba(255,168,108,0.055)'); g2.addColorStop(0.6, 'rgba(180,90,70,0.02)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g2; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,226,196,0.016)'; x.fill(checkerPath);
  x.strokeStyle = 'rgba(255,226,196,0.028)'; x.lineWidth = 1; x.stroke(gridPath);
  x.globalCompositeOperation = 'lighter';
  const open = new Path2D(), closed = new Path2D();
  for (let j = 0; j < rows; j++) { const y = oy + j*cell, row = j*cols;
    for (let i = 0; i < cols; i++) { const t = row + i, xx = ox + i*cell, ty = pat.types[t];
      const c0 = pat.loopArc[t*2], c1 = pat.loopArc[t*2+1];
      addArc(c0 ? closed : open, ty, 0, xx, y, cell); addArc(c1 ? closed : open, ty, 1, xx, y, cell); } }
  x.lineWidth = Math.max(1.4, cell*0.05); x.strokeStyle = 'rgba(206,196,190,0.045)'; x.stroke(open);
  x.lineWidth = Math.max(3, cell*0.19); x.strokeStyle = 'rgba(255,168,96,0.045)'; x.stroke(closed);
  x.lineWidth = Math.max(1.6, cell*0.075); x.strokeStyle = 'rgba(255,196,132,0.20)'; x.stroke(closed);
  x.globalCompositeOperation = 'source-over';
  const da = x.getImageData(0, 0, cv.width, cv.height).data;
  const B = pat.bc.getContext('2d');
  const db = B.getImageData(0, 0, cv.width, cv.height).data;
  let sum = 0, n = 0, mx = 0, big = 0, brightA = 0, brightB = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d0 = Math.abs(da[i]-db[i]) + Math.abs(da[i+1]-db[i+1]) + Math.abs(da[i+2]-db[i+2]);
    sum += d0; n++; if (d0 > mx) mx = d0; if (d0 > 24) big++;
    brightA += da[i] + da[i+1] + da[i+2]; brightB += db[i] + db[i+1] + db[i+2];
  }
  return { mean: +(sum/n).toFixed(3), max: mx, 'bigPct': +(big/n*100).toFixed(3),
           brightA: Math.round(brightA/1000), brightB: Math.round(brightB/1000),
           ratio: +(brightB/brightA).toFixed(4) };
})()`)));
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}