/** _qcheck.mjs —— 校验「形态渲染」画质档位真的把 iframe 缩小了。
 *  用法: node _qcheck.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-q-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
    errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 140));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 120) : r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });
await sleep(2500);

const probe = `(() => { const f = document.getElementById('stage-frame');
  const r = f.getBoundingClientRect();
  return '变量 ' + getComputedStyle(document.documentElement).getPropertyValue('--stage-scale').trim()
    + '  iframe ' + Math.round(r.width) + 'x' + Math.round(r.height)
    + '  视口 ' + f.contentWindow.innerWidth + 'x' + f.contentWindow.innerHeight
    + '  选中 ' + [...document.querySelectorAll('#stage-quality button')].filter(b=>b.classList.contains('is-on')).map(b=>b.textContent).join(','); })()`;

console.log('默认:', await ev(probe));
await ev("document.getElementById('btn-settings').click(); 1");
await sleep(300);
await ev("document.querySelector('#stage-quality button[data-q=\"0.7\"]').click(); 1");
await sleep(500);
console.log('点 70%:', await ev(probe));
const png = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('shots/review/settings-quality.png', Buffer.from(png.data, 'base64'));
console.log('  → shots/review/settings-quality.png');
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/?stage=013` });
await sleep(2600);
console.log('重载后:', await ev(probe));
console.log('异常: ' + (errs.length ? errs.slice(0, 3).join(' ; ') : '无'));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
