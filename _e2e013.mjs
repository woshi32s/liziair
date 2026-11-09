/** 临时：在真实播放器页面里打开 ?stage=013，截图确认集成没崩、字在画面里读得清 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-e2e-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0].slice(0, 160));
};
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC' : r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/?stage=013` });
await sleep(3500);

console.log('frame src:', await ev(`(document.getElementById('stage-frame')||{}).getAttribute && document.getElementById('stage-frame').getAttribute('src')`));
console.log('stage menu:', await ev(`(document.getElementById('stage-current')||{}).textContent`));

/* 往 iframe 里喂一场假播放（带封面），验证 app 的 init 通路 + 封面代理 */
await ev(`(() => {
  const f = document.getElementById('stage-frame');
  if (!f || !f.contentWindow) return 0;
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字'];
  const lines = [];
  for (let i = 0; i < 20; i++) {
    const text = texts[i % texts.length];
    lines.push({ t: i * 2.4, dur: 2.4, text, chars: null });
  }
  f.contentWindow.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180,170,255], song: { id: 1, name: 'e2e', artists: [], cover: location.origin + '/_fx/cover-test.jpg' } } }, '*');
  window.__tk2 = setInterval(() => { window.__T = (window.__T || 0) + 0.066; f.contentWindow.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*'); }, 66);
  return 1;
})()`);
await sleep(4200);
console.log('iframe state:', await ev(`(() => { try { const w = document.getElementById('stage-frame').contentWindow; return JSON.stringify(w.__stage && w.__stage()); } catch (e) { return 'ERR ' + e.message; } })()`));
const r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('E:/DSHdesktop/work/music-player/shots/lizi/_e2e013.png', Buffer.from(r.data, 'base64'));
console.log('shot -> shots/lizi/_e2e013.png');
console.log('exceptions:', errs.length ? errs.slice(0, 3).join(' ; ') : '无');

ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
