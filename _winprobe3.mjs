/** _winprobe3.mjs —— 探针 3：修好坐标 bug + pwsh 语法。
 *  回答：OS 级单击/双击能不能驱动 drag 区（-webkit-app-region: drag）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const PORT = 9225;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), 'lizi-winprobe3-' + Date.now());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;

const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], { cwd: ROOT, env, stdio: 'ignore' });
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

await ev(`(() => { window.__dbg = { dom: 0, tgt: '' };
  addEventListener('dblclick', (e) => { window.__dbg.dom++; window.__dbg.tgt = (e.target.id || e.target.className || e.target.tagName) + ''; }, true);
  window.__isMax = () => window.__desktop.winControls.isMaximized(); return 1; })()`);

const geom = async () => JSON.parse(await ev(`(()=>{
  const m = document.getElementById('win-max').getBoundingClientRect();
  const s = document.getElementById('drag-strip').getBoundingClientRect();
  return JSON.stringify({ sx: window.screenX, sy: window.screenY, dpr: devicePixelRatio,
    max: [Math.round(m.x + m.width / 2), Math.round(m.y + m.height / 2)],
    strip: [Math.round(s.width / 2), Math.round(s.y + s.height / 2)],
    topbar: [Math.round(innerWidth * 0.72), 48], vw: innerWidth, vh: innerHeight })})()`));

function psPointsScript(pid, pts, gapMs) {
  const rows = pts.map(([x, y]) => `  $pts += ,@(${x},${y})`).join('\n');
  return `
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
$h = (Get-Process -Id ${pid}).MainWindowHandle
if ($h -ne [IntPtr]::Zero) { [U]::ShowWindow($h, 5) | Out-Null; [U]::SetForegroundWindow($h) | Out-Null }
Start-Sleep -Milliseconds 250
$pts = @()
${rows}
foreach ($p in $pts) {
  [U]::SetCursorPos($p[0], $p[1]) | Out-Null
  Start-Sleep -Milliseconds 60
  [U]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
  [U]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds ${gapMs}
}
'hwnd=' + $h + ' pts=' + $pts.Count
`;
}
async function osClicks(pts, gapMs = 70) {
  const p = spawn('pwsh', ['-NoProfile', '-Command', psPointsScript(app.pid, pts, gapMs)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => out += d);
  await new Promise((r) => p.on('close', r));
  return out.trim();
}
const toPhys = ([x, y], g) => [Math.round(g.sx * g.dpr + x * g.dpr), Math.round(g.sy * g.dpr + y * g.dpr)];

let g = await geom();
console.log('geom', JSON.stringify(g));
console.log('dpr=', g.dpr, ' max center(px) =', toPhys(g.max, g));

console.log('\n## A. OS 单击 #win-max  基线 isMax=', await ev('__isMax()'));
console.log(await osClicks([toPhys(g.max, g)], 120));
await sleep(800);
console.log('isMax ->', await ev('__isMax()'));
if (await ev('__isMax()')) { await ev('document.getElementById("win-max").click()'); await sleep(700); }
console.log('复位 isMax', await ev('__isMax()'));

console.log('\n## B. OS 双击 #drag-strip (y=7)');
g = await geom();
await ev('__dbg={dom:0,tgt:""}');
console.log(await osClicks([toPhys(g.strip, g), toPhys(g.strip, g)], 70));
await sleep(900);
console.log('isMax ->', await ev('__isMax()'), '| __dbg', await ev('JSON.stringify(__dbg)'));
if (await ev('__isMax()')) { await ev('document.getElementById("win-max").click()'); await sleep(700); }

console.log('\n## C. OS 双击 topbar 拖动区 (x=0.72W, y=48)');
g = await geom();
await ev('__dbg={dom:0,tgt:""}');
console.log(await osClicks([toPhys(g.topbar, g), toPhys(g.topbar, g)], 70));
await sleep(900);
console.log('isMax ->', await ev('__isMax()'), '| __dbg', await ev('JSON.stringify(__dbg)'),
  '| el@point', await ev(`(()=>{const e=document.elementFromPoint(${g.topbar[0]},48);return e?(e.id||(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className)||e.tagName):'null'})()`));
if (await ev('__isMax()')) { await ev('document.getElementById("win-max").click()'); await sleep(700); }

console.log('\n## D. CDP 双击 #drag-strip 对照');
await ev('__dbg={dom:0,tgt:""}');
for (const cc of [1, 2]) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.strip[0], y: 7, button: 'left', clickCount: cc, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.strip[0], y: 7, button: 'left', clickCount: cc, buttons: 0 });
}
await sleep(600);
console.log('__dbg', await ev('JSON.stringify(__dbg)'), '| isMax', await ev('__isMax()'));

await cleanup(0);
