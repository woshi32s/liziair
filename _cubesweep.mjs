/** _cubesweep.mjs —— 扫一遍拖动全程（模拟用户真实操作），逐帧采样：
 *  ① 有多少面同时出白字（>1 就是「叠成一坨白块」）
 *  ② 有多少格的投影面积低于 1px²（掠射面堆成锯齿条的来源）
 *  ③ 白字压在非实心面上的帧数（「字浮在黑洞上」）
 *  用法: node _cubesweep.mjs
 *  产物: shots/review/sweep-<k>-<tag>.png（关键帧） */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1192, H = 910;

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-cs-' + Date.now());
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
    errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 160));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return r.result.value;
};
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`shots/review/${name}.png`, Buffer.from(png.data, 'base64'));
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/cube-menu.html` });
await sleep(2000);

/* 在页面里装个探针：每帧记录上面那三个指标 */
await ev(`(() => {
  window.__log = [];
  window.__probe = true;
  return 1;
})()`);

/* 扫：pitch 从 -180° 一路转到 +180°，每 5° 取一次 */
const rows = [];
let k = 0;
for (let deg = -180; deg <= 180; deg += 10) {
  const rad = deg * Math.PI / 180;
  await ev(`yaw = 0.62; pitch = ${rad}; vyaw = 0; vpitch = 0; 1`);
  await sleep(120);
  const d = await ev(`(() => {
    const g = window.__dbg;
    const words = g.texts.filter(t => t.win && t.reveal > 0.02).length;   // 出白字的面数
    return { words, reveal: g.reveal.map(v => +v.toFixed(2)), plate: g.plate.map(v => +v.toFixed(2)),
             front: g.front.map(v => +v.toFixed(2)), quads: g.quads };
  })()`);
  rows.push({ deg, ...d });
  console.log(String(deg).padStart(4) + '° 白字面数=' + d.words + '  front=[' + d.front.join(',') + ']  plate=[' + d.plate.join(',') + ']  reveal=[' + d.reveal.join(',') + ']');
  if (deg === -180 || deg === -90 || deg === 0 || deg === 90 || deg === 180) {
    await shot('sweep-' + String(k++).padStart(2, '0') + '-deg' + deg);
  }
}

const bad = rows.filter(r => r.words > 1);
console.log('\n白字面数 > 1 的角度数量:', bad.length, bad.length ? '→ ' + bad.map(r => r.deg + '°').join(', ') : '（没有，通过）');
const noWord = rows.filter(r => r.words === 0);
console.log('完全没白字的角度:', noWord.map(r => r.deg + '°').join(', ') || '（没有）');
console.log('异常:', errs.length ? errs.slice(0, 4).join(' ; ') : '无');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
