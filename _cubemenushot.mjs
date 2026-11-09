/** _cubemenushot.mjs —— 立方体菜单概念稿截图（初始视角 / 拖到正面 / 再换一面）。
 *  用法: node _cubemenushot.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1192, H = 910;

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-cm-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 140));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC' : r.result.value; };
const shot = async (tag) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`shots/review/cubemenu-${tag}.png`, Buffer.from(png.data, 'base64'));
  console.log('  →', `shots/review/cubemenu-${tag}.png`);
};
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', {
  type, x, y, button: type === 'mouseReleased' ? 'left' : 'left', buttons: type === 'mouseReleased' ? 0 : 1,
  clickCount: type === 'mousePressed' ? 1 : 0, ...extra,
});

/** 拖一段：按下 → 分步移动 → 松开 */
async function drag(fromX, fromY, toX, toY, steps = 14) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX, y: fromY, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const x = fromX + ((toX - fromX) * i) / steps;
    const y = fromY + ((toY - fromY) * i) / steps;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await sleep(16);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', buttons: 0, clickCount: 1 });
}

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/cube-menu.html` });
await sleep(2400);
await shot('a');

/* 往右拖 → 吸附到某一面 */
await drag(520, 430, 760, 460);
await sleep(1400);
await shot('b');
console.log('第二张朝向:', await ev("1"));

/* 往下拖 → 翻到顶/底面 */
await drag(700, 300, 700, 560);
await sleep(1400);
await shot('c');

/* 翻过极点（pitch 转过 180°）看侧面文字 */
await drag(700, 180, 700, 850, 30);
await sleep(1200);
await shot('e');

/* 点一下正面 */
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 596, y: 455, button: 'none', clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 596, y: 455, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 596, y: 455, button: 'left', buttons: 0, clickCount: 1 });
await sleep(350);
await shot('d');

console.log('帧率', await ev(`new Promise((res) => { const ts = []; let last = performance.now(); const t0 = last;
  function f(){ const n = performance.now(); ts.push(n - last); last = n;
    if (n - t0 < 1500) requestAnimationFrame(f);
    else { const a = ts.slice(4).sort((x,y)=>x-y); res('med ' + (1000 / a[Math.floor(a.length/2)]).toFixed(1) + ' fps · p95 ' + a[Math.floor(a.length*0.95)].toFixed(2) + 'ms'); } }
  requestAnimationFrame(f); })`));
console.log('点数', await ev("document.getElementById('n').textContent"), '异常: ' + (errs.length ? errs.slice(0, 3).join(' ; ') : '无'));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
