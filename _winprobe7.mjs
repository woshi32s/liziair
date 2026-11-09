/** _winprobe7.mjs —— 为什么点 #win-max 后图标不变成「还原」？
 *  记录每条 win:state 的 payload + 当时 #win-max 的 class/aria，看 paintMax 到底跑没跑。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), 'lizi-winprobe7-' + Date.now());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], { cwd: ROOT, env, stdio: 'ignore' });
console.log('pid', app.pid);

let ws = null;
async function cleanup(c) { try { ws && ws.close(); } catch {} try { spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} await sleep(1200); try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(c); }

let page = null;
for (let i = 0; i < 100 && !page; i++) {
  await sleep(300);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url));
  } catch {}
}
if (!page) await cleanup(1);
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; errs.push(String((d.exception && d.exception.description) || d.text).split('\n').slice(0, 2).join(' | ')); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + String((r.exceptionDetails.exception || {}).description).split('\n')[0];
  return r.result ? r.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable');
for (let i = 0; i < 100; i++) { await sleep(250); if (await ev('document.readyState === "complete" && typeof window.__desktop === "object"')) break; }
await sleep(1000);

/* 观察器：在 app.js 之后注册，所以 paintMax 已经先跑完了 */
console.log('\n# 安装观察器');
console.log(await ev(`(() => {
  window.__log = [];
  const snap = () => { const b = document.getElementById('win-max');
    return b.getAttribute('aria-label') + '|is-max=' + b.classList.contains('is-max') + '|restore=' + getComputedStyle(b.querySelector('.ico-restore')).display; };
  window.__desktop.onWinState((s) => window.__log.push({ t: Math.round(performance.now()), s, ui: snap() }));
  window.__snap = snap;
  return 'ok';
})()`));

const rect = async () => JSON.parse(await ev(`(()=>{const r=document.getElementById('win-max').getBoundingClientRect();return JSON.stringify([Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)])})()`));
async function click(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
}

let r = await rect();
console.log('\n# 初始 UI :', await ev('__snap()'), '| isMaximized=', await ev('window.__desktop.winControls.isMaximized()'));
console.log('# 点 #win-max @', r);
await click(r[0], r[1]);
for (const t of [50, 150, 400, 900]) {
  await sleep(t === 50 ? 50 : t - 50);
  console.log(`  +${t}ms  ui=${await ev('__snap()')}  max=${await ev('window.__desktop.winControls.isMaximized()')}`);
}
console.log('# 事件时间线:', JSON.stringify(await ev('window.__log'), null, 1));

/* 再用 API 直接 toggle 一次（不走鼠标） */
await ev('window.__log = []');
r = await rect();
await click(r[0], r[1]);
await sleep(800);
console.log('\n# 还原后 ui=', await ev('__snap()'), '| max=', await ev('window.__desktop.winControls.isMaximized()'));
console.log('# 事件时间线:', JSON.stringify(await ev('window.__log')));

console.log('\n# 直接调 toggleMaximize()');
await ev('window.__log = []');
await ev('window.__desktop.winControls.toggleMaximize()');
await sleep(800);
console.log('ui=', await ev('__snap()'), '| max=', await ev('window.__desktop.winControls.isMaximized()'));
console.log('事件:', JSON.stringify(await ev('window.__log')));

console.log('\n# 异常:', errs.length ? errs.slice(0, 3) : '无');
await cleanup(0);
