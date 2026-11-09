/** _winprobe.mjs —— 临时探针：真实 Electron + CDP，回答三个问题
 *   ① 现在点 #win-max 到底有没有反应（isMaximized 真实返回值）
 *   ② -webkit-app-region: drag 区域会不会把 dblclick 吞掉（CDP 合成 vs OS 级）
 *   ③ OS 原生双击拖窗带会不会自动最大化
 *  跑完自己退出（app.quit 走 preload 暴露的 close? 不，直接 kill 自己的 pid 树）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), 'lizi-winprobe-' + Date.now());

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], {
  cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
});
const logs = [];
app.stdout.on('data', (d) => logs.push('[out] ' + String(d).trim()));
app.stderr.on('data', (d) => logs.push('[err] ' + String(d).trim()));
console.log('electron pid', app.pid);

async function cleanup(code) {
  try { ws && ws.close(); } catch {}
  try { app.kill(); } catch {}
  await sleep(1500);
  try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  process.exit(code);
}

/* 等 CDP */
let page = null;
for (let i = 0; i < 80; i++) {
  await sleep(300);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url));
    if (page) break;
  } catch {}
}
if (!page) { console.log('没等到 CDP 页面', logs.join('\n')); await cleanup(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = []; const consoleErrs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 200));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrs.push((m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'EXC:' + String((res.exceptionDetails.exception || {}).description).split('\n')[0];
  return res.result ? res.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable');

/* 等页面就绪 */
for (let i = 0; i < 80; i++) {
  await sleep(300);
  if (await ev('document.readyState') === 'complete' &&
      await ev('typeof window.__desktop === "object"')) break;
}
await sleep(1200);

console.log('\n== 基线 ==');
console.log('url            ', await ev('location.href'));
console.log('__desktop      ', await ev('typeof window.__desktop'));
console.log('isDesktop      ', await ev('window.__desktop && window.__desktop.isDesktop'));
console.log('isMaximized()  ', await ev('window.__desktop && window.__desktop.winControls.isMaximized()'));
console.log('has winControls', await ev('Object.keys(window.__desktop.winControls).join(",")'));
console.log('body.class     ', await ev('document.body.className'));
console.log('win-controls display', await ev('getComputedStyle(document.getElementById("win-controls")).display'));
console.log('btn count      ', await ev('document.querySelectorAll("#win-controls button").length'));
console.log('#win-max 命中   ', await ev('(()=>{const r=document.getElementById("win-max").getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()'));
console.log('elementFromPoint(center win-max)', await ev('(()=>{const r=document.getElementById("win-max").getBoundingClientRect();const e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e?(e.id||e.className||e.tagName):"null"})()'));
console.log('drag-strip rect', await ev('(()=>{const e=document.getElementById("drag-strip");const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height,disp:getComputedStyle(e).display})})()'));
console.log('screenX/screenY', await ev('window.screenX + "," + window.screenY + " outer=" + window.outerWidth + "x" + window.outerHeight'));

/* 埋在页面里的 dblclick 计数器 */
await ev(`(() => {
  window.__dbg = { dom: 0, target: '' };
  addEventListener('dblclick', (e) => {
    window.__dbg.dom++;
    window.__dbg.target = (e.target && (e.target.id || e.target.className || e.target.tagName)) + '';
    const w = window.__desktop && window.__desktop.winControls;
    if (w) w.toggleMaximize();
  }, true);
  return 'ok';
})()`);

console.log('\n== ① 真实鼠标点击 #win-max（CDP Input，不走 DOM .click） ==');
const rect = await ev('(()=>{const r=document.getElementById("win-max").getBoundingClientRect();return [r.x+r.width/2, r.y+r.height/2]})()');
console.log('center', rect);
async function mouseClick(x, y, clickCount = 1) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount, buttons: 0 });
}
const before1 = await ev('window.__desktop.winControls.isMaximized()');
await mouseClick(rect[0], rect[1], 1);
await sleep(500);
const after1 = await ev('window.__desktop.winControls.isMaximized()');
console.log('click #win-max : isMaximized', before1, '->', after1, '| __dbg', await ev('JSON.stringify(window.__dbg)'));

/* 还原，好做双击测试 */
if (after1) { await mouseClick(rect[0], rect[1], 1); await sleep(500); }
console.log('复位 isMaximized', await ev('window.__desktop.winControls.isMaximized()'));

console.log('\n== ② CDP 合成双击 drag-strip ==');
const strip = await ev('(()=>{const r=document.getElementById("drag-strip").getBoundingClientRect();return [r.x+r.width/2, r.y+r.height/2]})()');
console.log('strip center', strip);
await ev('window.__dbg={dom:0,target:""}');
await mouseClick(strip[0], strip[1], 1);
await mouseClick(strip[0], strip[1], 2);
await sleep(600);
console.log('after cdp dbl: __dbg', await ev('JSON.stringify(window.__dbg)'),
  '| isMaximized', await ev('window.__desktop.winControls.isMaximized()'));

/* 复位 */
if (await ev('window.__desktop.winControls.isMaximized()')) { await mouseClick(rect[0], rect[1], 1); await sleep(500); }

console.log('\n== ③ OS 级双击 drag-strip（P/Invoke mouse_event） ==');
await ev('window.__dbg={dom:0,target:""}');
const scr = await ev('JSON.stringify({sx: window.screenX, sy: window.screenY})');
const { sx, sy } = JSON.parse(scr);
const px = Math.round(sx + strip[0]);
const py = Math.round(sy + strip[1]);
const ps = `
Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${px}, ${py});
Start-Sleep -Milliseconds 120;
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, System.UIntPtr e); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);';
[W.U]::SetForegroundWindow([System.Diagnostics.Process]::GetProcessById(${app.pid}).MainWindowHandle) | Out-Null;
Start-Sleep -Milliseconds 120;
for ($i = 0; $i -lt 2; $i++) { [W.U]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 20; [W.U]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; }
"click at ${px},${py}";
`;
const psr = spawn('pwsh', ['-NoProfile', '-Command', ps], { stdio: ['ignore', 'pipe', 'pipe'] });
let psout = '';
psr.stdout.on('data', (d) => psout += d);
psr.stderr.on('data', (d) => psout += d);
await new Promise((r) => psr.on('close', r));
console.log('pwsh:', psout.trim());
await sleep(900);
console.log('after os dbl: __dbg', await ev('JSON.stringify(window.__dbg)'),
  '| isMaximized', await ev('window.__desktop.winControls.isMaximized()'));

console.log('\n== 错误 ==');
console.log('未捕获异常', errs.length ? errs.slice(0, 3) : '无');
console.log('console.error', consoleErrs.length ? consoleErrs.slice(0, 5) : '无');
console.log('\n== electron 日志(尾) ==');
console.log(logs.slice(-15).join('\n'));

await cleanup(0);
