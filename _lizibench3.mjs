/** _lizibench3.mjs —— 到底什么在吃帧：arc 批 / rect 批 / 物理循环 / blit */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-b3-' + Date.now());
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
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });
await sleep(1800);

const B = `(async () => {
  const W = 1440, H = 810, SMK = 4, SMW = Math.round(W/SMK), SMH = Math.round(H/SMK);
  let cv = document.getElementById('c');
  if (!cv) { cv = document.createElement('canvas'); cv.id='c'; cv.width=W; cv.height=H; document.body.appendChild(cv); }
  const g = cv.getContext('2d', { alpha: false });
  const sm = document.createElement('canvas'); sm.width = SMW; sm.height = SMH;
  const sg = sm.getContext('2d');
  const pts = []; for (let i = 0; i < 6200; i++) pts.push([Math.random()*SMW, Math.random()*SMH, 3+Math.random()*9]);

  function measure(fn, reps) {
    return new Promise((res) => {
      let n = 0, tSum = 0;
      function step() {
        const t0 = performance.now();
        fn();
        g.getImageData(0, 0, 1, 1);
        tSum += performance.now() - t0;
        if (++n < reps) requestAnimationFrame(step); else res(+(tSum/reps).toFixed(2));
      }
      requestAnimationFrame(step);
    });
  }
  const clear = () => { g.fillStyle = '#000'; g.fillRect(0,0,W,H); sg.clearRect(0,0,SMW,SMH); };
  const out = {};

  out.arc6200_小画布 = await measure(() => { clear();
    sg.fillStyle='rgba(255,180,140,0.2)'; sg.beginPath();
    for (const p of pts) { sg.moveTo(p[0]+p[2], p[1]); sg.arc(p[0],p[1],p[2],0,6.2832); }
    sg.fill();
    g.drawImage(sm, 0, 0, W, H);
  }, 24);

  out.rect6200_小画布 = await measure(() => { clear();
    sg.fillStyle='rgba(255,180,140,0.2)'; sg.beginPath();
    for (const p of pts) sg.rect(p[0]-p[2], p[1]-p[2], p[2]*2, p[2]*2);
    sg.fill();
    g.drawImage(sm, 0, 0, W, H);
  }, 24);

  out.仅blit小画布 = await measure(() => { clear();
    sg.fillStyle='rgba(255,180,140,0.2)'; sg.fillRect(0,0,SMW,SMH);
    g.drawImage(sm, 0, 0, W, H);
  }, 24);

  out.rect6200_主画布 = await measure(() => { clear();
    g.fillStyle='rgba(255,180,140,0.2)'; g.beginPath();
    for (const p of pts) g.rect(p[0]*SMK, p[1]*SMK, p[2]*SMK*2, p[2]*SMK*2);
    g.fill();
  }, 24);

  out.空帧 = await measure(() => { clear(); }, 24);

  return out;
})()`;
console.log(JSON.stringify(await ev(B), null, 2));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
