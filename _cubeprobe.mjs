/** _cubeprobe.mjs —— 立方体菜单「姿态扫描」诊断：把 yaw/pitch 摆到指定角度，逐张截图 + 打印六面朝前度。
 *  用法: node _cubeprobe.mjs [poseName]
 *  poseName: all(默认) / 极点 / 棱 / 背面
 *  产物: shots/review/probe-<n>-<label>.png */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1192, H = 910;
const only = process.argv[2] || 'all';

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-cp-' + Date.now());
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
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200) : r.result.value; };
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`shots/review/${name}.png`, Buffer.from(png.data, 'base64'));
  console.log('  → shots/review/' + name + '.png');
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/cube-menu.html` });
await sleep(2000);

/* 姿态表：[标签, yaw, pitch]  —— pitch 单位弧度，正 = 往下拖 */
const POSES = [
  ['p00-正面',   0,     0],
  ['p01-斜45',   0.7,   0.6],
  ['p02-近极点85', 0.7, 1.483],
  ['p03-极点90', 0.7,   1.5708],
  ['p04-过极点95', 0.7, 1.658],
  ['p05-过极点120', 0.7, 2.094],
  ['p06-过极点180', 0.7, 3.1416],
  ['p07-v7-e姿态', 1.30, 8.12],
  ['p08-棱视角', 0.785,  0.0],
];
const pick = only === '极点' ? POSES.slice(2, 7)
  : only === '棱' ? [POSES[1], POSES[8]]
  : only === '背面' ? [POSES[0], POSES[6]]
  : POSES;

let k = 0;
for (const [label, y, p] of pick) {
  await ev(`yaw = ${y}; pitch = ${p}; vyaw = 0; vpitch = 0; dragging = false; 1`);
  await sleep(320);
  const diag = await ev(`(() => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), rx0 = -pitch, cx = Math.cos(rx0), sx = Math.sin(rx0);
    const fr = FACES.map((fc) => { const nz1 = fc.n[0]*sy + fc.n[2]*cy; const nz = fc.n[1]*sx + nz1*cx; return +Math.max(0,-nz).toFixed(2); });
    return { yaw:+yaw.toFixed(2), pitch:+pitch.toFixed(2), front: fr };
  })()`);
  console.log(`\n[${label}] yaw=${diag.yaw} pitch=${diag.pitch}  朝前度=[${diag.front.join(', ')}]`);
  const dbg = await ev(`JSON.stringify({ front: window.__dbg.front.map(v=>+v.toFixed(2)), plate: window.__dbg.plate.map(v=>+v.toFixed(2)), reveal: window.__dbg.reveal.map(v=>+v.toFixed(2)), texts: window.__dbg.texts, quads: window.__dbg.quads })`);
  console.log('  dbg', dbg);
  await shot(`probe-${String(k++).padStart(2, '0')}-${label}`);
}

console.log('\n异常:', errs.length ? errs.slice(0, 4).join(' ; ') : '无');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
