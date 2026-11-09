/** _lizibench.mjs —— 在一次页面里直接量 drawImage vs rect 批处理 的真实吞吐 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-bn-' + Date.now());
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

const B = `(() => {
  const W = 1440, H = 810;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { alpha: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  /* 造一个 26px 的软光斑精灵 */
  const spr = document.createElement('canvas'); spr.width = spr.height = 26;
  const sg = spr.getContext('2d');
  const rg = sg.createRadialGradient(13, 13, 0, 13, 13, 13);
  rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  sg.fillStyle = rg; sg.beginPath(); sg.arc(13, 13, 13, 0, 6.2832); sg.fill();
  const ink = document.createElement('canvas'); ink.width = W; ink.height = H;
  const ig = ink.getContext('2d');

  const pts = [];
  for (let i = 0; i < 8400; i++) pts.push([Math.random() * W, Math.random() * H]);

  function timeIt(fn, reps) {
    fn();                       // warmup
    const t0 = performance.now();
    for (let r = 0; r < reps; r++) fn();
    return (performance.now() - t0) / reps;
  }

  const out = {};
  /* A: 逐颗 drawImage 进离屏墨墙（我现在的做法） */
  out.drawImage_8400 = +timeIt(() => {
    ig.clearRect(0, 0, W, H);
    for (let i = 0; i < 8400; i++) { const p = pts[i]; ig.drawImage(spr, p[0] - 9, p[1] - 9, 18, 18); }
  }, 4).toFixed(2);

  /* B: 逐颗 drawImage，颗数减半 */
  out.drawImage_3000 = +timeIt(() => {
    ig.clearRect(0, 0, W, H);
    for (let i = 0; i < 3000; i++) { const p = pts[i]; ig.drawImage(spr, p[0] - 12, p[1] - 12, 24, 24); }
  }, 4).toFixed(2);

  /* C: 一次路径里的 8400 个 rect（001/065 的做法） */
  out.rect_batch_8400 = +timeIt(() => {
    g.fillStyle = 'rgba(200,210,255,0.9)';
    g.beginPath();
    for (let i = 0; i < 8400; i++) { const p = pts[i]; g.rect(p[0], p[1], 2.4, 2.4); }
    g.fill();
  }, 4).toFixed(2);

  /* D: 全屏 blit 一张墨墙（每帧都要做一次） */
  out.blit_1to1 = +timeIt(() => { g.drawImage(ink, 0, 0); }, 4).toFixed(2);
  out.blit_scaled = +timeIt(() => { g.drawImage(ink, 0, 0, W * 1.05, H * 1.05); }, 4).toFixed(2);

  /* E: fillText 一整行（做烘焙辉光用） */
  out.fillText_line = +timeIt(() => {
    ig.clearRect(0, 0, W, H);
    ig.font = '800 84px "Microsoft YaHei",sans-serif';
    ig.textAlign = 'center'; ig.textBaseline = 'middle'; ig.fillStyle = '#fff';
    ig.fillText('风吹过所有的名字', W / 2, H / 2);
  }, 6).toFixed(2);

  return out;
})()`;
console.log(JSON.stringify(await ev(B), null, 2));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
