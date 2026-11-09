/** 临时：看 013 的帧率随时间/句数是否退化（有没有泄漏） */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-perf-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 120); return r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/013-ripple-lyrics.html?perf=1` });
await sleep(1000);

const FEED = `(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','直到夜色把一切收走把所有的路都还给沉默的远方',"I don't know how to say goodbye",'而我在原地等了很久，很久。'];
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const text = texts[i % texts.length]; const chars = []; let acc = 0;
    for (let k = 0; k < text.length; k++) { const d = /[\\u4e00-\\u9fff]/.test(text[k]) ? 0.20 : 0.09; chars.push({ t: +(i*2.4+acc).toFixed(3), d, c: text[k] }); acc += d; }
    lines.push({ t: i*2.4, dur: 2.4, text, chars });
  }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180,170,255], song: { id: 1, name: 'p', artists: [], cover: location.origin + '/_fx/cover-test.jpg' } } }, '*');
  window.__T = 0;
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { window.__T += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*'); if (Math.random() < 0.05) window.postMessage({ __c100: 1, type: 'beat', payload: { level: 0.7 } }, '*'); }, 66);
  return 1;
})()`;
await ev(FEED);

const FPS = `new Promise((res) => {
  const a = []; let last = performance.now(); const t0 = last;
  function f() { const n = performance.now(); a.push(n - last); last = n;
    if (n - t0 < 1500) requestAnimationFrame(f);
    else { const s = a.slice(3).sort((x,y)=>x-y); res({ fps: +(1000/(s.reduce((p,q)=>p+q,0)/s.length)).toFixed(1), p95: +s[Math.floor(s.length*0.95)].toFixed(1) }); } }
  requestAnimationFrame(f);
})`;

for (let i = 0; i < 6; i++) {
  await sleep(2500);
  const f = await ev(FPS);
  const base = await ev(FPS);
  const mem = await ev(`(performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1)`);
  const st = await ev(`window.__stage()`);
  console.log(`t=${((i + 1) * 2.5).toFixed(1)}s  fps=${f.fps} p95=${f.p95}  base=${base.fps}  heap=${mem}MB  curIdx=${st.curIdx}`);
}
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
