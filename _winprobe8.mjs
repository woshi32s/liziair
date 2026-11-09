/** _winprobe8.mjs —— 页面里跑的 app.js 到底是不是新版？监听器到底有没有挂上？ */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), 'lizi-winprobe8-' + Date.now());
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
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; errs.push(String((d.exception && d.exception.description) || d.text).split('\n').slice(0, 2).join(' | ')); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const msg = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
  const r = (msg && msg.result) || {};
  if (r.exceptionDetails) return 'EXC:' + String((r.exceptionDetails.exception || {}).description).split('\n')[0];
  return r.result ? r.result.value : undefined;
};
await send('Runtime.enable'); await send('DOM.enable');
for (let i = 0; i < 100; i++) { await sleep(250); if (await ev('document.readyState === "complete" && typeof window.__desktop === "object"')) break; }
await sleep(800);

console.log('\n## 页面里执行到的 app.js 是新版吗？');
console.log('fetch(app.js) 长度/含 paintMax:', await ev(`fetch('app.js', {cache:'no-store'}).then(r=>r.text()).then(t=>t.length + ' / ' + t.includes('paintMax') + ' / onWinState=' + t.includes('onWinState'))`));
console.log('script 资源:', await ev(`JSON.stringify(performance.getEntriesByType('resource').filter(r=>/app\\.js/.test(r.name)).map(r=>({n:r.name.split('/').pop(), size:r.transferSize, dur:Math.round(r.duration)})))`));
console.log('SW controller:', await ev('navigator.serviceWorker ? !!navigator.serviceWorker.controller : "no-sw-api"'));
console.log('SW 注册数:', await ev('navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(a=>a.length) : -1'));
console.log('#win-max 里 svg 数（新版=2）:', await ev('document.querySelectorAll("#win-max svg").length'));
console.log('#win-controls role:', await ev('document.getElementById("win-controls").getAttribute("role")'));

console.log('\n## 实际挂上的监听器（DOMDebugger）');
for (const sel of ['#drag-strip', '#topbar', '#win-max', '#win-min']) {
  const r = await send('Runtime.evaluate', { expression: `document.querySelector('${sel}')` });
  if (!r.result || !r.result.objectId) { console.log(sel, 'no element'); continue; }
  const l = await send('DOMDebugger.getEventListeners', { objectId: r.result.objectId, depth: 0, pierce: true });
  const list = (l.result && l.result.listeners) || [];
  console.log(sel, '→', list.map((x) => `${x.type}${x.passive ? '(passive)' : ''}`).join(', ') || '(none)');
}

console.log('\n## 点一次 #win-max，看 paintMax 有没有改 DOM');
await ev(`window.__ui = () => { const b = document.getElementById('win-max');
  return b.getAttribute('aria-label') + '|is-max=' + b.classList.contains('is-max'); }`);
console.log('before', await ev('__ui()'));
const r2 = JSON.parse(await ev(`(()=>{const r=document.getElementById('win-max').getBoundingClientRect();return JSON.stringify([Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)])})()`));
for (const t of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type: t, x: r2[0], y: r2[1], button: 'left', clickCount: 1, buttons: t === 'mousePressed' ? 1 : 0 });
}
for (const w of [200, 700, 1500]) { await sleep(w); console.log(`+${w}ms`, await ev('__ui()'), 'max=', await ev('window.__desktop.winControls.isMaximized()')); }

console.log('\n异常:', errs.length ? errs : '无');
await cleanup(0);
