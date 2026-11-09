/** _winprobe4.mjs —— 诊断：为什么 probe3 里 #win-max 的 rect 是 0。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const PORT = 9226;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), 'lizi-winprobe4-' + Date.now());
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
    console.log('targets:', list.map((t) => `${t.type} ${t.url}`).join(' | '));
    page = list.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url));
    if (page) break;
  } catch {}
}
if (!page) await cleanup(1);
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = []; const conErrs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; errs.push(((d.exception && d.exception.description) || d.text || '').split('\n').slice(0, 3).join(' | ')); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') conErrs.push((m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + String((r.exceptionDetails.exception || {}).description).split('\n')[0];
  return r.result ? r.result.value : undefined;
};
await send('Runtime.enable');
for (let i = 0; i < 80; i++) { await sleep(300); if (await ev('document.readyState === "complete" && typeof window.__desktop === "object"')) break; }
for (const w of [300, 1000, 2000]) {
  await sleep(w);
  console.log('\n--', w, 'ms --');
  console.log('href        ', await ev('location.href'));
  console.log('title       ', await ev('document.title'));
  console.log('readyState  ', await ev('document.readyState'));
  console.log('isDesktop   ', await ev('window.__desktop && window.__desktop.isDesktop'));
  console.log('body.class  ', await ev('document.body.className'));
  console.log('wc display  ', await ev('(()=>{const e=document.getElementById("win-controls");return e?getComputedStyle(e).display:"NO-EL"})()'));
  console.log('max rect    ', await ev('(()=>{const e=document.getElementById("win-max");if(!e)return"NO-EL";const r=e.getBoundingClientRect();return JSON.stringify([r.x,r.y,r.width,r.height])})()'));
  console.log('strip rect  ', await ev('(()=>{const e=document.getElementById("drag-strip");if(!e)return"NO-EL";const r=e.getBoundingClientRect();return JSON.stringify([r.x,r.y,r.width,r.height,getComputedStyle(e).display])})()'));
  console.log('scripts     ', await ev('[...document.scripts].map(s=>s.src.split("/").pop()).join(",")'));
}
console.log('\nuncaught:', errs.length ? errs.slice(0, 5) : 'none');
console.log('console.error:', conErrs.length ? conErrs.slice(0, 5) : 'none');
console.log('isMaximized', await ev('window.__desktop.winControls.isMaximized()'));
await cleanup(0);
