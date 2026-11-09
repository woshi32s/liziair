/** _liziprof.mjs —— CDP CPU profile：找出 lizi 形态每帧真正的热点函数
 *  用法: node _liziprof.mjs lizi01-thrown-splat.html [秒数] */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = process.argv[2] || 'lizi01-thrown-splat.html';
const SECS = Number(process.argv[3] || 4);
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-pf-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 140)); }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 200) : r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Profiler.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
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
await ev(FEED);
await sleep(2200);

const fpsOf = `new Promise((res) => { const a=[]; let last=performance.now(); const t0=last;
  function f(){ const n=performance.now(); a.push(n-last); last=n;
    if(n-t0<2000) requestAnimationFrame(f); else { const s=a.slice(4).sort((x,y)=>x-y); res(+(1000/(s.reduce((p,q)=>p+q,0)/s.length)).toFixed(1)); } }
  requestAnimationFrame(f); })`;
console.log('基线 fps:', await ev(fpsOf));

await send('Profiler.start');
await sleep(SECS * 1000);
const { profile } = await send('Profiler.stop');

/* 自下而上累计 self time */
const byId = new Map();
for (const n of profile.nodes) byId.set(n.id, n);
const self = new Map();
const total = profile.samples.length;
for (const s of profile.samples) {
  const n = byId.get(s); if (!n) continue;
  const f = n.callFrame;
  const key = (f.functionName || '(anonymous)') + ' @' + (f.lineNumber + 1);
  self.set(key, (self.get(key) || 0) + 1);
}
const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22);
console.log(`\n采样 ${total} 帧（${SECS}s），按自身耗时排序：`);
for (const [k, v] of rows) {
  const pct = (v / total * 100);
  if (pct < 0.6) continue;
  console.log('  ' + pct.toFixed(1).padStart(5) + '%  ' + k);
}
console.log('\n异常:', errs.length ? errs.slice(0, 3).join(' | ') : '无');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
