/** _winprobe13.mjs —— 记录一次最大化/还原的完整 win:state 序列，
 *  确认最后一条 payload 与真实状态一致（否则图标会停在旧值）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), 'lizi-winprobe13-' + Date.now());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], { cwd: ROOT, env, stdio: 'ignore' });
console.log('pid', app.pid);
let ws = null;
async function cleanup(c) { try { ws && ws.close(); } catch {} try { spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} await sleep(900); try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(c); }
let page = null;
for (let i = 0; i < 100 && !page; i++) {
  await sleep(300);
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = l.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url)); } catch {}
}
if (!page) await cleanup(1);
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m.result); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + String((r.exceptionDetails.exception || {}).description).split('\n')[0];
  return r.result ? r.result.value : undefined;
};
await send('Runtime.enable');
for (let i = 0; i < 100; i++) { await sleep(250); if (await ev('document.readyState === "complete" && typeof window.__desktop === "object"')) break; }
await sleep(1200);
await ev(`(()=>{ window.__p = []; window.__ui = [];
  window.__desktop.onWinState((s) => {
    const b = document.getElementById('win-max');
    window.__p.push([Math.round(performance.now()), s.maximized, b.getAttribute('aria-label')]);
  });
  return 1; })()`);
const max = () => ev('window.__desktop.winControls.isMaximized()');
async function dbl(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2, buttons: 0 });
}
const vw = await ev('innerWidth');
if (await max()) { await ev('window.__desktop.winControls.toggleMaximize()'); await sleep(800); }

for (const n of [1, 2, 3]) {
  await ev('window.__p = []');
  await dbl(vw / 2, 7);
  await sleep(1500);
  console.log(`\n# 第 ${n} 次双击 → 真实 max=${await max()}，aria=${await ev('document.getElementById("win-max").getAttribute("aria-label")')}`);
  console.log('  推送序列 [t, payload.maximized, 收到时 aria]:', await ev('JSON.stringify(window.__p)'));
}
await cleanup(0);
