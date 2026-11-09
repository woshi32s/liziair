/** _winprobe5.mjs —— OS 级鼠标测试（坐标已修）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const PORT = 9227;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), 'lizi-winprobe5-' + Date.now());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], { cwd: ROOT, env, stdio: 'ignore' });
console.log('pid', app.pid);

let ws = null;
async function cleanup(c) { try { ws && ws.close(); } catch {} try { app.kill(); } catch {} await sleep(1000); try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(c); }

let page = null;
for (let i = 0; i < 80; i++) {
  await sleep(300);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url));
    if (page) break;
  } catch {}
}
if (!page) await cleanup(1);
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
for (let i = 0; i < 80; i++) { await sleep(300); if (await ev('document.readyState === "complete" && typeof window.__desktop === "object"')) break; }
await sleep(1200);
await ev(`window.__dbg={dom:0,tgt:''};addEventListener('dblclick',e=>{__dbg.dom++;__dbg.tgt=(e.target.id||e.target.className||e.target.tagName)+''},true);window.__isMax=()=>window.__desktop.winControls.isMaximized();1`);

async function geom() {
  const raw = await ev(`JSON.stringify({
    sx: window.screenX, sy: window.screenY, dpr: devicePixelRatio,
    max: [Math.round(document.getElementById('win-max').getBoundingClientRect().x + 23),
          Math.round(document.getElementById('win-max').getBoundingClientRect().y + 20)],
    strip: [Math.round(innerWidth / 2), 7],
    topbar: [Math.round(innerWidth * 0.72), 48],
    vw: innerWidth, vh: innerHeight })`);
  return JSON.parse(raw);
}
function ps(pid, pts, gap) {
  const rows = pts.map(([x, y]) => `$pts += ,@(${x},${y})`).join('\n');
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
Start-Sleep -Milliseconds 300
$pts = @()
${rows}
foreach ($p in $pts) {
  [U]::SetCursorPos($p[0], $p[1]) | Out-Null
  Start-Sleep -Milliseconds 80
  [U]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 25
  [U]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds ${gap}
}
'hwnd=' + $h
`;
}
async function osClicks(pts, gap = 70) {
  const p = spawn('pwsh', ['-NoProfile', '-Command', ps(app.pid, pts, gap)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => out += d);
  await new Promise((r) => p.on('close', r));
  return out.trim();
}
const phys = ([x, y], g) => [Math.round(g.sx + x), Math.round(g.sy + y)];   // dpr=1

let g = await geom();
console.log('geom', JSON.stringify(g));

console.log('\n## A. OS 单击 #win-max  基线 isMax=', await ev('__isMax()'));
await ev('__dbg={dom:0,tgt:""}');
console.log(await osClicks([phys(g.max, g)], 120));
await sleep(900);
console.log('isMax ->', await ev('__isMax()'), '| dbg', await ev('JSON.stringify(__dbg)'));
if (await ev('__isMax()')) { await ev('document.getElementById("win-max").click()'); await sleep(900); }
console.log('复位 isMax', await ev('__isMax()'));

console.log('\n## B. OS 双击 #drag-strip (W/2, 7)');
g = await geom();
await ev('__dbg={dom:0,tgt:""}');
console.log(await osClicks([phys(g.strip, g), phys(g.strip, g)], 70));
await sleep(1000);
console.log('isMax ->', await ev('__isMax()'), '| dbg', await ev('JSON.stringify(__dbg)'));
if (await ev('__isMax()')) { await ev('document.getElementById("win-max").click()'); await sleep(900); }

console.log('\n## C. OS 双击 topbar 拖动区 (0.72W, 48)');
g = await geom();
await ev('__dbg={dom:0,tgt:""}');
console.log(await osClicks([phys(g.topbar, g), phys(g.topbar, g)], 70));
await sleep(1000);
console.log('isMax ->', await ev('__isMax()'), '| dbg', await ev('JSON.stringify(__dbg)'));
if (await ev('__isMax()')) { await ev('document.getElementById("win-max").click()'); await sleep(900); }

console.log('\n## D. OS 双击 topbar 上的可见内容区 (brand 左侧 300,40)');
g = await geom();
await ev('__dbg={dom:0,tgt:""}');
console.log(await osClicks([[Math.round(g.sx + 300), Math.round(g.sy + 40)], [Math.round(g.sx + 300), Math.round(g.sy + 40)]], 70));
await sleep(1000);
console.log('isMax ->', await ev('__isMax()'), '| dbg', await ev('JSON.stringify(__dbg)'));

await cleanup(0);
