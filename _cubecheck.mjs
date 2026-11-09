/** _cubecheck.mjs —— 最小验证：能否从 CDP 改 yaw/pitch，以及 v8 每帧是否真在跑。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-cc-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 200));
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    console.log('  [console]', m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').split('\n')[0];
  return r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1192, height: 910, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/cube-menu.html` });
await sleep(2200);

console.log('typeof __dbg      :', await ev('typeof window.__dbg'));
console.log('typeof yaw        :', await ev('typeof yaw'));
console.log('typeof FACES      :', await ev('typeof FACES'));
console.log('typeof AXIS_U     :', await ev('typeof AXIS_U'));
console.log('typeof CELL       :', await ev('typeof CELL + "=" + CELL'));
console.log('typeof DOT_R      :', await ev('typeof DOT_R + "=" + DOT_R'));
console.log('typeof BG/FONT    :', await ev('typeof BG + "/" + typeof FONT'));
console.log('typeof dpr        :', await ev('typeof dpr'));
console.log('before            :', await ev('yaw.toFixed(2) + " / " + pitch.toFixed(2)'));
console.log('set               :', await ev('yaw = 1.3; pitch = 8.12; vyaw = 0; vpitch = 0; "set ok"'));
console.log('after             :', await ev('yaw.toFixed(2) + " / " + pitch.toFixed(2)'));
await sleep(400);
console.log('after+400ms       :', await ev('yaw.toFixed(2) + " / " + pitch.toFixed(2)'));
console.log('dbg.front         :', await ev('JSON.stringify(window.__dbg.front.map(v=>+v.toFixed(2)))'));
console.log('quads             :', await ev('window.__dbg.quads'));
console.log('loop alive        :', await ev(`new Promise(res => { const a = window.__dbg.quads; setTimeout(() => res('quads ' + a + ' -> ' + window.__dbg.quads), 300); })`));
console.log('fps               :', await ev(`new Promise((res) => { const ts = []; let last = performance.now(); const t0 = last;
  function f(){ const n = performance.now(); ts.push(n - last); last = n;
    if (n - t0 < 1200) requestAnimationFrame(f);
    else { const a = ts.slice(4).sort((x,y)=>x-y); res((1000 / a[Math.floor(a.length/2)]).toFixed(1) + ' fps'); } }
  requestAnimationFrame(f); })`));
console.log('errs              :', errs.length ? errs.slice(0, 5).join(' ; ') : '无');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
