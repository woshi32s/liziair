/** _lizibench4.mjs —— 用真实 rAF 帧率对比几种画法（不强制 readback，不跟别的循环抢） */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-b4-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 300) : r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
/* 开一个空白页，避免和任何形态的循环抢 CPU */
await send('Page.navigate', { url: 'data:text/html,<body style="margin:0;background:%23000"><canvas id=c width=1440 height=810></canvas></body>' });
await sleep(600);

const B = `(async () => {
  const W = 1440, H = 810, SMK = 4, SMW = Math.round(W/SMK), SMH = Math.round(H/SMK);
  const g = document.getElementById('c').getContext('2d', { alpha: false });
  const sm = document.createElement('canvas'); sm.width = SMW; sm.height = SMH;
  const sg = sm.getContext('2d');
  const pts = []; for (let i = 0; i < 6200; i++) pts.push([Math.random()*SMW, Math.random()*SMH, 3+Math.random()*8]);

  /* 真·rAF 帧率：跑 N 帧，看实际过了多少毫秒 */
  function fpsOf(fn, frames) {
    return new Promise((res) => {
      let n = 0; const t0 = performance.now();
      function step() {
        fn();
        if (++n < frames) requestAnimationFrame(step);
        else res(+(n / ((performance.now() - t0) / 1000)).toFixed(1));
      }
      requestAnimationFrame(step);
    });
  }
  const clear = () => { g.fillStyle='#000'; g.fillRect(0,0,W,H); sg.clearRect(0,0,SMW,SMH); };
  const out = {};
  out.空帧           = await fpsOf(() => { clear(); }, 60);
  out.blit只贴一次小图 = await fpsOf(() => { clear(); sg.fillStyle='rgba(255,180,140,0.2)'; sg.fillRect(0,0,SMW,SMH); g.drawImage(sm,0,0,W,H); }, 60);
  out.arc_6200_小画布 = await fpsOf(() => { clear();
      sg.fillStyle='rgba(255,180,140,0.2)'; sg.beginPath();
      for (const p of pts) { sg.moveTo(p[0]+p[2],p[1]); sg.arc(p[0],p[1],p[2],0,6.2832); }
      sg.fill(); g.drawImage(sm,0,0,W,H); }, 60);
  out.rect_6200_小画布 = await fpsOf(() => { clear();
      sg.fillStyle='rgba(255,180,140,0.2)'; sg.beginPath();
      for (const p of pts) sg.rect(p[0]-p[2],p[1]-p[2],p[2]*2,p[2]*2);
      sg.fill(); g.drawImage(sm,0,0,W,H); }, 60);
  out.rect_6200_主画布 = await fpsOf(() => { clear();
      g.fillStyle='rgba(255,180,140,0.2)'; g.beginPath();
      for (const p of pts) g.rect(p[0]*SMK,p[1]*SMK,p[2]*SMK*2,p[2]*SMK*2);
      g.fill(); }, 60);
  out.rect_3000_主画布 = await fpsOf(() => { clear();
      g.fillStyle='rgba(255,180,140,0.2)'; g.beginPath();
      for (let i = 0; i < 3000; i++) { const p = pts[i]; g.rect(p[0]*SMK,p[1]*SMK,p[2]*SMK*2,p[2]*SMK*2); }
      g.fill(); }, 60);
  out.物理4000次math = await fpsOf(() => { clear();
      let s = 0;
      for (let i = 0; i < 4000; i++) { s += Math.sin(i*0.01)*Math.cos(i*0.02) + Math.sqrt(i); }
      if (s === -1) console.log(s); }, 60);
  return out;
})()`;
console.log(JSON.stringify(await ev(B), null, 2));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
