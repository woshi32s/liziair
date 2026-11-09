/**
 * _c-shot.mjs —— 快速预览（只看画面对不对，不做完整验收）
 * 用法：node _c-shot.mjs 226 [秒] [宽] [高]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const BASE = `http://127.0.0.1:${APP}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const num = process.argv[2] || '226';
const at = parseFloat(process.argv[3] || '3.9');
const VW = parseInt(process.argv[4] || '1440', 10);
const VH = parseInt(process.argv[5] || '900', 10);

const file = fs.readdirSync(path.join(ROOT, 'public/stages')).filter((f) => f.startsWith(num + '-') && f.endsWith('.html'))[0];
if (!file) { console.error('没有 ' + num); process.exit(1); }

const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port;
await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-shot-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--force-device-scale-factor=1', `--window-size=${VW},${VH}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(200); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push((m.params.entry.text || '').slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error ' + (m.params.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + ((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0].slice(0, 200));
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __exc: ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 200) };
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable').catch(() => {});
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

const TEXTS = ['把光折进纸里', '才看见纤维在呼吸', '每一道压痕都记得', '谁的手曾经按在这里', '等风把灰吹走'];
function seedLines(gap = 2.4) {
  const out = [];
  for (let i = 0; i < TEXTS.length; i++) {
    const text = TEXTS[i], chars = []; let acc = 0;
    for (let k = 0; k < text.length; k++) {
      const d = /[\u4e00-\u9fff]/.test(text[k]) ? 0.20 : 0.09;
      chars.push({ t: +(i * gap + acc).toFixed(3), d: d, c: text[k] }); acc += d;
    }
    out.push({ t: +(i * gap).toFixed(3), dur: gap, text, chars });
  }
  return out;
}
const lines = seedLines();
await send('Page.navigate', { url: `${BASE}/stages/${file}?v=${Date.now()}` });
await sleep(700);
await ev(`window.postMessage({__c100:1,type:'init',payload:{lines:${JSON.stringify(lines)},accent:[212,184,148],song:{id:1,name:'验收曲',artists:[{name:'C 组'}],duration:240,cover:''}}},'*');1`);
await sleep(200);
/* 用真实 tick 推进到 at 秒 */
const steps = Math.ceil(at / 0.066);
await ev(`(()=>{window.__T=${(at - steps * 0.066).toFixed(3)};window.postMessage({__c100:1,type:'tick',payload:{time:window.__T,playing:true}},'*');
  window.__tk=setInterval(()=>{window.__T+=0.066;window.postMessage({__c100:1,type:'tick',payload:{time:window.__T,playing:true}},'*');},66);return 1})()`);
await sleep(steps * 66 + 500);
await ev(`(()=>{clearInterval(window.__tk);window.postMessage({__c100:1,type:'tick',payload:{time:window.__T,playing:false}},'*');return 1})()`);
await sleep(300);
const st = await ev('window.__stage ? JSON.stringify(window.__stage()) : "no __stage"');
const cap = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.join(ROOT, 'shots/review'), { recursive: true });
const out = path.join(ROOT, `shots/review/_prev-${num}.png`);
fs.writeFileSync(out, Buffer.from(cap.data, 'base64'));
console.log(st);
console.log('err:', errs.length ? errs : 'none');
console.log('→ shots/review/_prev-' + num + '.png');
ws.close(); chrome.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
