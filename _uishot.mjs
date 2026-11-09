/** _uishot.mjs —— 主界面 / 播放页截图，用于改前改后对照。
 *  用法: node _uishot.mjs before   |   node _uishot.mjs after */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const TAG = process.argv[2] || 'shot';
const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-ui-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
    errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 160));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 120) : r.result.value; };
const shot = async (n) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`E:/DSHdesktop/work/music-player/shots/review/ui-${TAG}-${n}.png`, Buffer.from(r.data, 'base64'));
  console.log('  →', `shots/review/ui-${TAG}-${n}.png`);
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });

/* 等歌单 */
for (let i = 0; i < 60; i++) { await sleep(300); const n = await ev("document.querySelectorAll('.track').length"); if (n > 0) break; }
await sleep(900);
await shot('main');

/* 滚到中间，让行封面色带进画面 */
await ev("document.querySelector('#tracks') && (document.querySelector('#tracks').scrollTop = 520)");
await sleep(600);
await shot('rows');

/* 进播放页（直接点第一首） */
await ev("(() => { const t = document.querySelector('.track'); if (t) t.click(); return 1; })()");
await sleep(2600);
await shot('now');

/* 打开歌词面板 */
await ev("(() => { const b = document.getElementById('btn-lyrics-toggle'); if (b) b.click(); return 1; })()");
await sleep(1200);
await shot('now-lyrics');

console.log('异常: ' + (errs.length ? errs.slice(0, 3).join(' ; ') : '无'));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
