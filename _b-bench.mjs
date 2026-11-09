/** 临时：headless 里跑 _b-bench.html，量 0.6 降采样片元着色器的帧时间 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-bench-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Log.entryAdded') logs.push(m.params.entry.level + ': ' + (m.params.entry.text || '').slice(0, 160));
  if (m.method === 'Runtime.consoleAPICalled') { logs.push('CONSOLE ' + m.params.type + ': ' + (m.params.args||[]).map(a=>String(a.value||a.description||'')).join(' ').slice(0,600)); }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + ((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0].slice(0, 200));
};
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 160); return r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable').catch(() => {});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/_b-bench.html` });
await sleep(1500);
await sleep(3000);
console.log('bench:', JSON.stringify(await ev('window.__bench && window.__bench()')));
const gpu = await ev(`(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl');
  const d = g && g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })()`);
console.log('renderer:', gpu);
console.log('logs:', logs.length ? logs.join('\n  ') : '(none)');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}

