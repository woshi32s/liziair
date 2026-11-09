/** 临时探针：看 013 的 WebGL 是否活着 / 封面有没有加载 / 截图一张自己看 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-probe-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Log.entryAdded') logs.push(m.params.entry.level + ': ' + (m.params.entry.text || '').slice(0, 200) + ' @' + (m.params.entry.url || ''));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + ((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0].slice(0, 300));
  if (m.method === 'Network.loadingFailed') logs.push('FAIL: ' + m.params.errorText + ' ' + (m.params.requestId || ''));
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) logs.push('HTTP ' + m.params.response.status + ' ' + m.params.response.url.slice(0, 140));
};
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 120);
  return r.result.value;
};

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable').catch(() => {});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/013-ripple-lyrics.html?probe=1` });
await sleep(1200);

const FEED = `(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','直到夜色把一切收走把所有的路都还给沉默的远方',"I don't know how to say goodbye",'而我在原地等了很久，很久。'];
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const text = texts[i % texts.length]; const chars = []; let acc = 0;
    for (let k = 0; k < text.length; k++) { const d = /[\\u4e00-\\u9fff]/.test(text[k]) ? 0.20 : 0.09; chars.push({ t: +(i*2.4+acc).toFixed(3), d, c: text[k] }); acc += d; }
    lines.push({ t: i*2.4, dur: 2.4, text, chars });
  }
  const cover = ${JSON.stringify(process.argv[3] === 'badcover' ? '/_fx/__missing__.jpg' : '/_fx/cover-test.jpg')};
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180,170,255], song: { id: 1, name: 'p', artists: [], cover: location.origin + cover } } }, '*');
  window.__T = 0;
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { window.__T += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*'); }, 66);
  return 1;
})()`;

await ev(FEED);
const wait = Number(process.argv[2] || 5000);
await sleep(wait);
console.log('state:', JSON.stringify(await ev('window.__stage && window.__stage()')));
/* 踩一拍，看看波峰经过时字还读不读得出来 */
await ev(`window.postMessage({ __c100: 1, type: 'beat', payload: { level: 0.8, bpm: 120 } }, '*'); 1`);
await sleep(380);
let r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`E:/DSHdesktop/work/music-player/shots/lizi/_probe013.png`, Buffer.from(r.data, 'base64'));
console.log('shot(beat) -> shots/lizi/_probe013.png');
await sleep(1600);
r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`E:/DSHdesktop/work/music-player/shots/lizi/_probe013b.png`, Buffer.from(r.data, 'base64'));
console.log('shot(calm) -> shots/lizi/_probe013b.png');
console.log('logs:', logs.length ? logs.join('\n  ') : '(none)');

ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
