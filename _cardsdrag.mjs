/**
 * _cardsdrag.mjs —— 卡片大厅交互验证（隐藏式实验，不改应用）
 * 验证：拖动右下角把柄 → 卡片按整数格改尺寸 → 其余卡片自动重排、永不重叠。
 * 用法: node _cardsdrag.mjs
 * 产物: shots/review/cards-drag-*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1192, H = 910;

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-cd-' + Date.now());
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
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/lobby-cards.html` });
await sleep(1600);

/* 从干净布局开始 */
await ev(`localStorage.removeItem('lizi.lobby.cards.v1'); location.reload(); 1`);
await sleep(1600);

const fmt = (ls) => ls.map((c) => `${c.id}:${c.w}x${c.h}@${c.x},${c.y}`).join('  ');
const before = await ev('JSON.stringify(window.__layout())');
console.log('初始布局:');
console.log('  ' + fmt(JSON.parse(before)));

/* 检查重叠 */
const overlapCheck = (ls) => {
  const occ = new Map();
  for (const c of ls) {
    for (let j = c.y; j < c.y + c.h; j++) {
      for (let i = c.x; i < c.x + c.w; i++) {
        const k = i + ',' + j;
        if (occ.has(k)) return `重叠: ${k} 被 ${occ.get(k)} 和 ${c.id} 同时占用`;
        occ.set(k, c.id);
      }
    }
  }
  return null;
};
console.log('  重叠检查:', overlapCheck(JSON.parse(before)) || '无重叠 ✓');

/* 拖动「搜索」卡右下角把柄：2×1 → 3×1 */
const grip = await ev(`(() => {
  const el = document.getElementById('card-search');
  const g = el.querySelector('.grip');
  const r = g.getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 });
})()`);
const g = JSON.parse(grip);
const cell = await ev(`(() => { const r = document.getElementById('grid').getBoundingClientRect();
  return JSON.stringify({ cw: (r.width - 28) / 3 + 14 }); })()`);
const cw = JSON.parse(cell).cw;

console.log(`\n拖动搜索卡把柄 (${Math.round(g.x)},${Math.round(g.y)}) 向右 ${Math.round(cw)}px → 期望 3×1`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y, button: 'none', clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 10; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x + (cw * i) / 10, y: g.y, button: 'left', buttons: 1 });
  await sleep(20);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x + cw, y: g.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(600);
await shot('cards-drag-1-after-grow');

const after = JSON.parse(await ev('JSON.stringify(window.__layout())'));
console.log('改后布局:');
console.log('  ' + fmt(after));
const search = after.find((c) => c.id === 'search');
console.log('  搜索卡尺寸:', search.w + '×' + search.h, search.w === 3 && search.h === 1 ? '✓ 按预期变成 3×1' : '✗ 不符合预期');
console.log('  重叠检查:', overlapCheck(after) || '无重叠 ✓');

/* 再把它缩回 1×1 */
const grip2 = JSON.parse(await ev(`(() => {
  const g = document.querySelector('#card-search .grip'); const r = g.getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 });
})()`));
console.log(`\n缩回：向左 ${Math.round(cw * 2)}px → 期望 1×1`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip2.x, y: grip2.y, button: 'none', clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip2.x, y: grip2.y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 10; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip2.x - (cw * 2 * i) / 10, y: grip2.y, button: 'left', buttons: 1 });
  await sleep(20);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip2.x - cw * 2, y: grip2.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(600);
await shot('cards-drag-2-after-shrink');

const after2 = JSON.parse(await ev('JSON.stringify(window.__layout())'));
console.log('改后布局:');
console.log('  ' + fmt(after2));
const s2 = after2.find((c) => c.id === 'search');
console.log('  搜索卡尺寸:', s2.w + '×' + s2.h, s2.w === 1 && s2.h === 1 ? '✓ 按预期变成 1×1' : '✗ 不符合预期');
console.log('  重叠检查:', overlapCheck(after2) || '无重叠 ✓');

/* 刷新验证 localStorage 持久化 */
await ev(`location.reload(); 1`);
await sleep(1500);
const after3 = JSON.parse(await ev('JSON.stringify(window.__layout())'));
/* 按 id 比较：重排会改变数组顺序，按数组下标比会误判成「丢了」 */
const kk = (c) => c.id + ':' + c.w + 'x' + c.h + '@' + c.x + ',' + c.y;
const norm = (ls) => ls.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).map(kk).join('  ');
console.log('  存档后:', norm(after2));
console.log('  刷新后:', norm(after3));
console.log('\n刷新后布局保持:', norm(after2) === norm(after3) ? '✓ 持久化生效' : '✗ 丢了');

console.log('\n异常:', errs.length ? errs.slice(0, 3).join(' ; ') : '无');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
