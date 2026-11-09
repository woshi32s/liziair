/** 快速看片：单文件、单时刻截图（无头 Chrome + CDP）
 *  用法：node _b-look.mjs 240 [时刻=3.9] [宽=1440] [高=900]
 *  产出：shots/review/_look-<num>.png，并打印 __stage 状态与 console 日志
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const num = process.argv[2] || '240';
const at = Number(process.argv[3] || 3.9);
const VW = Number(process.argv[4] || 1440), VH = Number(process.argv[5] || 900);
const file = fs.readdirSync(path.join(ROOT, 'public/stages')).filter((f) => f.startsWith(num + '-'))[0];
if (!file) { console.error('没有 ' + num + ' 的 stage 文件'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-look-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--window-size=' + VW + ',' + VH, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG: ' + (m.params.entry.text || '').slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error: ' + (m.params.args || []).map((a) => String(a.value || a.description || '')).join(' ').slice(0, 300));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 300));
};
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 240);
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable').catch(() => {});
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}?v=${Date.now()}` });
await sleep(1400);
const TEXTS = ['把光折进纸里', '才看见纤维在呼吸', '每一道压痕都记得', '谁的手曾经按在这里', '等风把灰吹走'];
const lines = [];
for (let i = 0; i < TEXTS.length; i++) {
  const text = TEXTS[i]; const chars = []; let acc = 0;
  for (let k = 0; k < text.length; k++) { const d = /[\u4e00-\u9fff]/.test(text[k]) ? 0.2 : 0.09; chars.push({ t: i * 2.4 + acc, d, c: text[k] }); acc += d; }
  lines.push({ t: i * 2.4, dur: 2.4, text, chars });
}
await ev(`window.postMessage({__c100:1,type:'init',payload:{lines:${JSON.stringify(lines)},accent:[212,184,148],song:{name:'probe'}}},'*');1`);
await sleep(150);
/* 先跑到 2.4 让状态稳定，再钉到目标时刻 */
await ev(`window.postMessage({__c100:1,type:'tick',payload:{time:2.4,playing:true}},'*');1`);
await sleep(900);
await ev(`window.postMessage({__c100:1,type:'tick',payload:{time:${at},playing:true}},'*');1`);
await sleep(1100);
await ev(`window.postMessage({__c100:1,type:'tick',payload:{time:${at},playing:false}},'*');1`);
await sleep(500);
console.log('state:', JSON.stringify(await ev('window.__stage && window.__stage()')));
const png = path.join(ROOT, `shots/review/_look-${num}.png`);
const cap = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(png, Buffer.from(cap.data, 'base64'));
console.log('wrote', png);
console.log('logs:', logs.length ? '\n  ' + logs.slice(0, 8).join('\n  ') : '(none)');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
