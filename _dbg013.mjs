/** 临时：踩拍前后每 100ms 采样一次，看字亮度/位移到底被什么驱动 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-dbg-' + Date.now());
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
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 160); return r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/013-ripple-lyrics.html?dbg=1` });
await sleep(1000);

await ev(`(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字'];
  const lines = [];
  for (let i = 0; i < 20; i++) lines.push({ t: i * 2.4, dur: 2.4, text: texts[i % texts.length], chars: null });
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180,170,255], song: { id: 1, name: 'p', artists: [], cover: location.origin + '/_fx/cover-test.jpg' } } }, '*');
  window.__T = 0;
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { window.__T += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*'); }, 66);
  return 1;
})()`);
await sleep(3200);
/* 每帧记一次 cr2 均值，用来对"截图亮度变化" */
await ev(`(() => { window.__log = []; const f = () => { window.__log.push([performance.now(), window.__dbg()]); if (window.__log.length < 400) requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`);
for (let i = 0; i < 8; i++) {
  const d = await ev('window.__dbg()');
  console.log(`t0=${d.t0} mean=${d.mean} lo=${d.lo} hi=${d.hi} kick=${d.kick}`);
  if (i === 2) await ev(`window.postMessage({ __c100: 1, type: 'beat', payload: { level: 0.9 } }, '*'); 1`);
  await sleep(100);
}
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
