/** _cubestate.mjs —— 打印某个姿态下的 plate/reveal/winner，定位「明明正对却没有字」。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-st-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1192, height: 910, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/cube-menu.html` });
await sleep(2200);

/* 复现 _cubemenushot.mjs 的 c 帧：两次拖动之后的姿态 */
const st = await ev(`(() => ({ yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3),
  front: window.__dbg.front.map(v=>+v.toFixed(3)),
  plate: window.__dbg.plate.map(v=>+v.toFixed(3)),
  reveal: window.__dbg.reveal.map(v=>+v.toFixed(3)),
  win: window.__dbg.winFi, texts: window.__dbg.texts }))()`);
console.log('当前姿态:', JSON.stringify(st, null, 1));

/* 手摆：把「系统设置」（底面 fi=5，法线 0,-1,0）转到正对。pitch = -90° */
await ev(`yaw = 0.62; pitch = -Math.PI/2; vyaw = 0; vpitch = 0; 1`);
await sleep(300);
console.log('\n底面正对 (%):', await ev(`JSON.stringify({ front: window.__dbg.front.map(v=>+v.toFixed(3)), plate: window.__dbg.plate.map(v=>+v.toFixed(3)), reveal: window.__dbg.reveal.map(v=>+v.toFixed(3)), win: window.__dbg.winFi })`));
await ev(`yaw = 0.62; pitch = Math.PI/2; vyaw = 0; vpitch = 0; 1`);
await sleep(300);
console.log('顶面正对   :', await ev(`JSON.stringify({ front: window.__dbg.front.map(v=>+v.toFixed(3)), plate: window.__dbg.plate.map(v=>+v.toFixed(3)), reveal: window.__dbg.reveal.map(v=>+v.toFixed(3)), win: window.__dbg.winFi })`));

ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
