/** 单个形态探针：node _probe-a.mjs 200 [t] [waitMs] [out.png] [--dpr=2] */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const no = process.argv[2] || '200';
const TT = +(process.argv[3] || 4.4);
const WAIT = +(process.argv[4] || 1200);
const OUT = process.argv[5] || (ROOT + '/shots/review/_probe-' + no + '.png');
const dprArg = process.argv.find((a) => a.startsWith('--dpr='));
const DPR = dprArg ? +dprArg.split('=')[1] : 1;
const file = fs.readdirSync(ROOT + '/public/stages').filter((f) => f.startsWith(no + '-'))[0];
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'pa-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(250); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map((a) => a.value || a.description).join(' '));
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 30000); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) { errs.push('EVAL ' + ((r.exceptionDetails.exception || {}).description || '')); return null; } return r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: DPR, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
await sleep(1200);
const FEED = `(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','而我在原地等了很久','直到夜色把一切收走','把所有的路都还给沉默的远方'];
  const lines = [];
  for (let i = 0; i < texts.length; i++) { const text = texts[i]; const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: i*2.6 + k*0.18, d: 0.18, c: text[k] });
    lines.push({ t: i*2.6, dur: 2.6, text, chars }); }
  window.__lines = lines;
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [138,200,224], song: { title: '夜航', artist: 'LIZI', cover: '' }, duration: 210 } }, '*');
  window.__T = ${TT - 0.6};
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { window.__T += 0.05; window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*'); }, 50);
  return 1; })()`;
await ev(FEED);
await sleep(WAIT);
const st = await ev('JSON.stringify(window.__stage ? window.__stage() : null)');
console.log('STATE', st);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('PNG', OUT, 'errs', errs.length ? errs.slice(0, 4) : 0);
ws.close(); chrome.kill(); await sleep(250);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch { }
