/** _liziprobe.mjs —— 对 lizi 形态做一次深度探针：吐 __stage() + 采样点包围盒 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = process.argv[2];
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-pr-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = []; const reqs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 140)); }
  if (m.method === 'Log.entryAdded') { const t = m.params.entry; if (t.level === 'error') errs.push('log:' + (t.url || '') + ' ' + t.text); }
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) reqs.push(m.params.response.status + ' ' + m.params.response.url);
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 300) : r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
await sleep(1200);
const FEED = `(() => {
  const lines = [
    { t: 0, dur: 2.4, text: '当自我磨平了轮廓', chars: [0,1,2,3,4,5,6,7].map(k => ({ t: k * 0.2, d: .2, c: '' })) },
    { t: 2.4, dur: 2.6, text: '直到夜色把一切收走把所有的路都还给沉默的远方', chars: null },
    { t: 5.0, dur: 2.4, text: "I don't know how to say goodbye", chars: null },
  ];
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180,170,255] } }, '*');
  window.__T = 0;
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { window.__T += 0.066;
    window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*'); }, 66);
  return 1; })()`;
await ev(FEED);
await sleep(2600);
console.log('stage:', JSON.stringify(await ev('window.__stage ? window.__stage() : "no __stage"')));
console.log('bboxTx:', await ev(`(() => {
  // 直接重算一次采样点包围盒，绕开形态内部
  const g = window.__L || null; return g ? 'has __L' : 'no __L'; })()`));
console.log('---');
const probe = await ev(`(() => {
  const c = document.getElementById('c'); const g = c.getContext('2d');
  /* 逐列 / 逐行统计亮度，看内容到底铺在哪 */
  const W = c.width, H = c.height;
  const d = g.getImageData(0, 0, W, H).data;
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const k = (y * W + x) * 4;
    if (d[k] + d[k+1] + d[k+2] > 260) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return { n, minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
})()`);
console.log('亮区包围盒:', JSON.stringify(probe));
console.log('http>=400:', reqs.slice(0, 5).join(' | ') || '无');
console.log('errs:', errs.length ? errs.slice(0, 4).join(' | ') : '无');
const png = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(ROOT + '/shots/lizi/_probe.png', Buffer.from(png.data, 'base64'));
console.log('→ shots/lizi/_probe.png');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
