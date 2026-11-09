/** _winprobe9.mjs —— 抓 console 看 app.js 的窗口控制块到底跑到哪一步。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), 'lizi-winprobe9-' + Date.now());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], { cwd: ROOT, env, stdio: 'ignore' });
console.log('pid', app.pid);
let ws = null;
async function cleanup(c) { try { ws && ws.close(); } catch {} try { spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} await sleep(1000); try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(c); }
let page = null;
for (let i = 0; i < 100 && !page; i++) {
  await sleep(300);
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = l.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url)); } catch {}
}
if (!page) await cleanup(1);
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const logs = []; const exc = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m.result); pend.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`${m.params.type}: ` + (m.params.args || []).map((a) => a.value !== undefined ? a.value : (a.description || a.type)).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    exc.push(String((d.exception && d.exception.description) || d.text).split('\n').slice(0, 4).join(' | '));
  }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + String((r.exceptionDetails.exception || {}).description).split('\n')[0];
  return r.result ? r.result.value : undefined;
};
await send('Runtime.enable');
for (let i = 0; i < 100; i++) { await sleep(250); if (await ev('document.readyState === "complete" && typeof window.__desktop === "object"')) break; }
await sleep(1500);

console.log('\n## 加载期 console（含 wc-debug）');
logs.filter((l) => /wc-debug/.test(l)).forEach((l) => console.log('  ' + l));
console.log('  （全部 console 条数 ' + logs.length + '）');

logs.length = 0;
console.log('\n## 点 #win-max');
const rc = JSON.parse(await ev(`(()=>{const r=document.getElementById('win-max').getBoundingClientRect();return JSON.stringify([Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)])})()`));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rc[0], y: rc[1], button: 'left', clickCount: 1, buttons: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rc[0], y: rc[1], button: 'left', clickCount: 1, buttons: 0 });
await sleep(1200);
logs.forEach((l) => console.log('  ' + l));
console.log('  isMaximized=', await ev('window.__desktop.winControls.isMaximized()'));
console.log('  #win-max:', await ev('(()=>{const b=document.getElementById("win-max");return b.getAttribute("aria-label")+" | "+b.className})()'));

console.log('\n## 手动跑一遍同样的注册代码（对照）');
console.log('  ', await ev(`(() => { try {
  const wc = document.getElementById('win-controls');
  const api = window.__desktop.winControls;
  const b = wc.querySelector('#win-max');
  b.classList.toggle('is-max', true);
  const okClass = b.classList.contains('is-max');
  const restoreDisp = getComputedStyle(b.querySelector('.ico-restore')).display;
  api.onWinState((s) => { b.classList.toggle('is-max', !!(s && s.maximized)); });
  return 'classToggle=' + okClass + ' restoreDisplay=' + restoreDisp;
} catch (e) { return 'THREW: ' + e.message } })()`));

console.log('\n## 异常:', exc.length ? exc.slice(0, 4) : '无');
await cleanup(0);
