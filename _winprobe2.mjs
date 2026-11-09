/** _winprobe2.mjs —— 探针 2：OS 级鼠标事件能不能到 drag 区，双击拖窗带会不会最大化。
 *  （探针 1 的坐标在最大化后失效了，这次每次动作前重算 rect。） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const PORT = 9224;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), 'lizi-winprobe2-' + Date.now());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;

const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], {
  cwd: ROOT, env, stdio: 'ignore',
});
console.log('electron pid', app.pid);

let ws = null;
async function cleanup(code) {
  try { ws && ws.close(); } catch {}
  try { app.kill(); } catch {}
  await sleep(1200);
  try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  process.exit(code);
}

let page = null;
for (let i = 0; i < 80; i++) {
  await sleep(300);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url));
    if (page) break;
  } catch {}
}
if (!page) { console.log('no CDP page'); await cleanup(1); }
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m.result); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + String((r.exceptionDetails.exception || {}).description).split('\n')[0];
  return r.result ? r.result.value : undefined;
};
await send('Runtime.enable');
for (let i = 0; i < 80; i++) { await sleep(300); if (await ev('typeof window.__desktop === "object"')) break; }
await sleep(1500);

/* 页面里装 dblclick 计数（不 toggle，纯观察） */
await ev(`(() => { window.__dbg = { dom: 0, tgt: '' };
  addEventListener('dblclick', (e) => { window.__dbg.dom++; window.__dbg.tgt = (e.target.id || e.target.className || e.target.tagName) + ''; }, true);
  window.__isMax = () => window.__desktop.winControls.isMaximized(); return 1; })()`);

const geom = async () => JSON.parse(await ev(`(()=>{const m=document.getElementById('win-max').getBoundingClientRect();
  const s=document.getElementById('drag-strip').getBoundingClientRect();
  return JSON.stringify({sx:window.screenX, sy:window.screenY,
    max:[Math.round(s.x+s.width/2), Math.round(s.y+s.height/2)],
    strip:[Math.round(s.width/2), 7],
    stripRect:[s.x,s.y,s.width,s.height],
    vw: innerWidth, vh: innerHeight})})()`));

/** 用 pwsh + user32 发真实的 OS 鼠标事件（前台化窗口后再点） */
async function osClick(pts, gapMs) {
  const parts = pts.map(([x, y]) => `    Move(${x}, ${y}); Click();`).join('\n');
  const ps = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class U {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
"@
$h = (Get-Process -Id ${app.pid}).MainWindowHandle
if ($h -ne [IntPtr]::Zero) { [U]::ShowWindow($h, 5) | Out-Null; [U]::SetForegroundWindow($h) | Out-Null }
Start-Sleep -Milliseconds 200
function Move($x, $y) { [U]::SetCursorPos($x, $y) | Out-Null; Start-Sleep -Milliseconds 60 }
function Click() { [U]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 15; [U]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds ${gapMs} }
${parts}
"hwnd=$h";
`;
  const p = spawn('pwsh', ['-NoProfile', '-Command', ps], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => out += d);
  await new Promise((r) => p.on('close', r));
  return out.trim();
}

console.log('\n## A. OS 单击 #win-max（基线', await ev('__isMax()'), '）');
let g = await geom();
console.log('geom', JSON.stringify(g));
console.log(await osClick([[g.sx + g.max[0], g.sy + g.max[1]]], 120));
await sleep(700);
console.log('isMaximized ->', await ev('__isMax()'), '| __dbg', await ev('JSON.stringify(__dbg)'));

/* 复位（用 CDP DOM 点击最稳） */
if (await ev('__isMax()')) { await ev('document.getElementById("win-max").click()'); await sleep(700); }
console.log('复位后 isMaximized', await ev('__isMax()'));
await sleep(600);

console.log('\n## B. OS 双击 #drag-strip（y=7）');
g = await geom();
await ev('__dbg={dom:0,tgt:""}');
console.log(await osClick([[g.sx + g.strip[0], g.sy + 7], [g.sx + g.strip[0], g.sy + 7]], 70));
await sleep(900);
console.log('isMaximized ->', await ev('__isMax()'), '| __dbg', await ev('JSON.stringify(__dbg)'));

/* 复位 */
if (await ev('__isMax()')) { await ev('document.getElementById("win-max").click()'); await sleep(700); }

console.log('\n## C. OS 双击 topbar 空白拖动区（y=48, x=0.72W）');
g = await geom();
await ev('__dbg={dom:0,tgt:""}');
const tx = g.sx + Math.round(g.vw * 0.72), ty = g.sy + 48;
console.log(await osClick([[tx, ty], [tx, ty]], 70));
await sleep(900);
console.log('isMaximized ->', await ev('__isMax()'), '| __dbg', await ev('JSON.stringify(__dbg)'),
  '| elementFromPoint', await ev(`(()=>{const e=document.elementFromPoint(${Math.round(g.vw*0.72)},48);return e?(e.id||e.className||e.tagName):'null'})()`));

if (await ev('__isMax()')) { await ev('document.getElementById("win-max").click()'); await sleep(700); }

console.log('\n## D. CDP 双击 #drag-strip（对照，看渲染进程收不收得到）');
await ev('__dbg={dom:0,tgt:""}');
const sc = await ev(`(()=>{const s=document.getElementById('drag-strip').getBoundingClientRect();return [s.width/2, 7]})()`);
for (const cc of [1, 2]) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sc[0], y: sc[1], button: 'left', clickCount: cc, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sc[0], y: sc[1], button: 'left', clickCount: cc, buttons: 0 });
}
await sleep(500);
console.log('__dbg', await ev('JSON.stringify(__dbg)'), '| isMaximized', await ev('__isMax()'));

await cleanup(0);
