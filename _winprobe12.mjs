/** _winprobe12.mjs —— 复现 _wincheck 第 8 段的前置条件：先 OS 最大化、再 OS 还原、再双击。
 *  看 pushes 是 2 条（翻一次）还是 4 条（翻两次）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), 'lizi-winprobe12-' + Date.now());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], { cwd: ROOT, env, stdio: 'ignore' });
console.log('pid', app.pid);
let ws = null;
async function cleanup(c) { try { ws && ws.close(); } catch {} try { spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} await sleep(900); try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(c); }
async function run(cmd, args) { const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (d) => o += d); p.stderr.on('data', (d) => o += d); await new Promise((r) => p.on('close', r)); return o.trim(); }
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
const HWND = Number((await run('pwsh', ['-NoProfile', '-Command', `$h=(Get-Process -Id ${app.pid}).MainWindowHandle; "$h"`])).replace(/[^\d]/g, ''));
console.log('hwnd', HWND);
async function showWin(cmd) {
  return run('pwsh', ['-NoProfile', '-Command', `Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class S { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h); }
"@
$h=[IntPtr]${HWND}; [S]::ShowWindow($h, ${cmd}) | Out-Null; "zoomed=$([S]::IsZoomed($h))"`]);
}
await ev(`(()=>{ window.__p = []; window.__dbl = 0;
  window.__desktop.onWinState((s) => window.__p.push([Math.round(performance.now()), s.maximized]));
  addEventListener('dblclick', () => window.__dbl++, true); return 1; })()`);
const max = () => ev('window.__desktop.winControls.isMaximized()');
async function dbl(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2, buttons: 0 });
}

console.log('\n## 1) OS 最大化');
console.log('  ', await showWin(3));
await sleep(900);
console.log('  isMax =', await max(), '| innerWidth =', await ev('innerWidth'));

console.log('\n## 2) OS 还原');
console.log('  ', await showWin(9));
await sleep(900);
console.log('  isMax =', await max(), '| innerWidth =', await ev('innerWidth'));

console.log('\n## 3) 双击拖动带（此时窗口刚从最大化被系统还原）');
await ev('window.__p = []; window.__dbl = 0');
await dbl(Math.round(await ev('innerWidth') / 2), 7);
for (const t of [100, 400, 1000]) {
  await sleep(t === 100 ? 100 : t - 100);
  console.log(`  +${t}ms max=${await max()} pushes=${await ev('JSON.stringify(window.__p)')}`);
}
console.log('  dblclick 数 =', await ev('window.__dbl'));

console.log('\n## 4) 再双击一次（回到还原）');
await ev('window.__p = []; window.__dbl = 0');
await dbl(Math.round(await ev('innerWidth') / 2), 7);
await sleep(900);
console.log('  max=', await max(), '| pushes=', await ev('JSON.stringify(window.__p)'), '| dbl=', await ev('window.__dbl'));

await cleanup(0);
