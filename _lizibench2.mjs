/** _lizibench2.mjs —— 精确定位：往墨墙上画东西之后，blit 变得更贵了吗？ */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-b2-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 200) : r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });
await sleep(1800);

/* 关键：把"每帧真的画到屏幕"这个动作也算进去（不画到屏幕，光栅化会被推迟/跳过） */
const B = `(async () => {
  const W = 1440, H = 810;
  const cv = document.getElementById('c') || (() => { const c = document.createElement('canvas'); c.id='c'; document.body.appendChild(c); return c; })();
  const g = cv.getContext('2d', { alpha: false });
  const spr = document.createElement('canvas'); spr.width = spr.height = 26;
  const sg = spr.getContext('2d');
  const rg = sg.createRadialGradient(13, 13, 0, 13, 13, 13);
  rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  sg.fillStyle = rg; sg.beginPath(); sg.arc(13, 13, 13, 0, 6.2832); sg.fill();
  const ink = document.createElement('canvas'); ink.width = W; ink.height = H;
  const ig = ink.getContext('2d', { alpha: true });
  const pts = []; for (let i = 0; i < 9000; i++) pts.push([Math.random()*W, Math.random()*H]);

  /* 真·逐帧：必须在 rAF 里画，才反映真实的合成代价 */
  function measure(setup, reps) {
    return new Promise((res) => {
      let n = 0, tSum = 0;
      function step() {
        const t0 = performance.now();
        setup();
        /* 强制提交这一帧 */
        g.getImageData(0, 0, 1, 1);
        tSum += performance.now() - t0;
        if (++n < reps) requestAnimationFrame(step);
        else res(+(tSum / reps).toFixed(2));
      }
      requestAnimationFrame(step);
    });
  }

  const out = {};
  out.A_仅blit静态墨墙 = await measure(() => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.drawImage(ink, 0, 0);
  }, 30);

  out.B_画210颗drawImage再blit = await measure(() => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 210; i++) { const p = pts[i]; ig.drawImage(spr, p[0]-9, p[1]-9, 18, 18); }
    g.drawImage(ink, 0, 0);
  }, 30);

  out.C_画210颗drawImage_不blit = await measure(() => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 210; i++) { const p = pts[i]; ig.drawImage(spr, p[0]-9, p[1]-9, 18, 18); }
  }, 30);

  out.D_墨墙用batchedRect画210颗再blit = await measure(() => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    ig.fillStyle = 'rgba(200,210,255,0.5)';
    ig.beginPath();
    for (let i = 0; i < 210; i++) { const p = pts[i]; ig.rect(p[0]-3, p[1]-3, 6, 6); }
    ig.fill();
    g.drawImage(ink, 0, 0);
  }, 30);

  out.E_主画布直接batch9000rect = await measure(() => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(200,210,255,0.9)';
    g.beginPath();
    for (let i = 0; i < 9000; i++) { const p = pts[i]; g.rect(p[0], p[1], 2.4, 2.4); }
    g.fill();
  }, 30);

  return out;
})()`;
console.log(JSON.stringify(await ev(B), null, 2));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
