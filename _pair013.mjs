/** 临时：抓一对间隔 0.35s 的帧（前 0.2s 踩一拍），用来量"字区域动多少 / 背景区域动多少" */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const TAG = process.argv[2] || 'pair';
const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-pair-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 120); return r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/013-ripple-lyrics.html?pair=1` });
await sleep(1000);

await ev(`(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字'];
  const lines = [];
  for (let i = 0; i < 20; i++) lines.push({ t: i * 2.4, dur: 2.4, text: texts[i % texts.length], chars: null });
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180,170,255], song: { id: 1, name: 'p', artists: [], cover: location.origin + '/_fx/cover-test.jpg' } } }, '*');
  window.__T = 0;
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { window.__T += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*'); }, 66);
  return 1;
})()`);
await sleep(3200);

/* ① 静息：同一句内抓两帧（不踩拍），量"字自己会不会动" */
let r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`E:/DSHdesktop/work/music-player/shots/lizi/_${TAG}-idle-a.png`, Buffer.from(r.data, 'base64'));
await sleep(350);
r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`E:/DSHdesktop/work/music-player/shots/lizi/_${TAG}-idle-b.png`, Buffer.from(r.data, 'base64'));

/* ② 踩一拍：0.2s 后抓 A，再 0.35s 抓 B（仍在这一句内） */
await ev(`window.postMessage({ __c100: 1, type: 'beat', payload: { level: 0.9 } }, '*'); 1`);
await sleep(200);
r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`E:/DSHdesktop/work/music-player/shots/lizi/_${TAG}-a.png`, Buffer.from(r.data, 'base64'));
await sleep(350);
r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`E:/DSHdesktop/work/music-player/shots/lizi/_${TAG}-b.png`, Buffer.from(r.data, 'base64'));
console.log('state:', JSON.stringify(await ev('window.__stage()')));
console.log('shots: _' + TAG + '-idle-a/b.png  _' + TAG + '-a/b.png');

ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
