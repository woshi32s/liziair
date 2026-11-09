/** _019probe.mjs —— 量每一帧的耗时，抓长帧发生的那一刻在干什么 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = process.argv[2] || '019-ink-clouds-lyrics.html';
const SECS = Number(process.argv[3] || 8);
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'p019-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(((m.params.exceptionDetails || {}).exception || {}).description || 'ERR');
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 300) : r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}?probe=1` });
await sleep(1000);

const FEED = `(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','直到夜色把一切收走把所有的路都还给沉默的远方',"I don't know how to say goodbye",'而我在原地等了很久，很久。'];
  const lines = [];
  for (let i = 0; i < 30; i++) { const text = texts[i % texts.length]; const chars = [];
    let acc = 0; for (let k = 0; k < text.length; k++) { const d = /[\\u4e00-\\u9fff]/.test(text[k]) ? 0.2 : 0.09; chars.push({ t: +(i*2.4+acc).toFixed(3), d, c: text[k] }); acc += d; }
    lines.push({ t: i*2.4, dur: 2.4, text, chars }); }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180,170,255] } }, '*');
  window.__T = 0;
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { window.__T += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*');
    if (Math.random() < 0.05) window.postMessage({ __c100: 1, type: 'beat', payload: { level: 0.7 } }, '*'); }, 66);
  return 1; })()`;
console.log('feed:', await ev(FEED));
await sleep(2500);

/* 用 rAF 记录每帧间隔 + 当时的行号/行内时间，长帧单独列出来 */
const REC = `new Promise((res) => {
  const out = []; let last = performance.now(); const t0 = last;
  function f() {
    const n = performance.now(); const dt = n - last; last = n;
    const s = window.__stage ? window.__stage() : {};
    out.push([+dt.toFixed(1), s.curIdx, s.age, s.text ? s.text.slice(0, 8) : '']);
    if (n - t0 < ${SECS * 1000}) requestAnimationFrame(f);
    else res(out);
  }
  requestAnimationFrame(f);
})`;
const rows = await ev(REC);
if (typeof rows === 'string') { console.log(rows); }
else {
  const dts = rows.map((r) => r[0]).sort((a, b) => a - b);
  console.log('帧数', rows.length, ' 中位', dts[dts.length >> 1], ' p95', dts[Math.floor(dts.length * 0.95)], ' max', dts[dts.length - 1]);
  console.log('\n最慢 12 帧:');
  for (const r of rows.slice().sort((a, b) => b[0] - a[0]).slice(0, 12)) console.log('  ' + r[0] + 'ms   idx=' + r[1] + '  age=' + r[2] + '  ' + r[3]);
}
/* 手动量一次重建成本 */
const cost = await ev(`(() => {
  if (!window.__stage) return 'no-stage';
  const t = [];
  for (let i = 0; i < 5; i++) { const a = performance.now(); window.dispatchEvent(new Event('resize')); t.push(+(performance.now() - a).toFixed(1)); }
  return t;
})()`);
console.log('\nresize(含重建) 5 次耗时:', cost);
console.log('异常:', errs.length ? errs.slice(0, 3) : '无');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
