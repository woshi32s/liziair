/** 分层面板：把某个 stage 的 GL 层 / 2D 层分别导出成 PNG，用来看清是哪一层出的问题
 *  用法：node _b-probe.mjs 210 4.9 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const num = process.argv[2] || '210';
const at = Number(process.argv[3] || 3.2);
const file = fs.readdirSync(path.join(ROOT, 'public/stages')).filter((f) => f.startsWith(num + '-'))[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-probe-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); return; }
  if (m.method === 'Log.entryAdded') logs.push(m.params.entry.text);
  if (m.method === 'Runtime.consoleAPICalled') logs.push('console: ' + (m.params.args || []).map((a) => String(a.value || a.description || '')).join(' ').slice(0, 400));
};
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 200); return r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable').catch(() => {});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
await sleep(1500);
const TEXTS = ['把光折进纸里', '才看见纤维在呼吸', '每一道压痕都记得', '谁的手曾经按在这里', '等风把灰吹走'];
const lines = [];
for (let i = 0; i < TEXTS.length; i++) {
  const text = TEXTS[i]; const chars = []; let acc = 0;
  for (let k = 0; k < text.length; k++) { const d = /[\u4e00-\u9fff]/.test(text[k]) ? 0.2 : 0.09; chars.push({ t: i * 2.4 + acc, d, c: text[k] }); acc += d; }
  lines.push({ t: i * 2.4, dur: 2.4, text, chars });
}
await ev(`window.postMessage({__c100:1,type:'init',payload:{lines:${JSON.stringify(lines)},accent:[212,184,148],song:{name:'probe'}}},'*');1`);
await sleep(120);
const drive = `(() => { window.__T=${at}; window.postMessage({__c100:1,type:'tick',payload:{time:${at},playing:false}},'*'); return 1; })()`;
await ev(drive);
await sleep(600);
console.log('state:', JSON.stringify(await ev('window.__stage && window.__stage()')));
/* 分层截图：靠 CSS 隐藏另一层（toDataURL 拿不到已合成的 WebGL 缓冲） */
await ev("document.getElementById('c').style.display='none';1");
await sleep(220);
let cap1 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(ROOT, `shots/review/_probe-b-${num}-gl.png`), Buffer.from(cap1.data, 'base64'));
await ev("document.getElementById('c').style.display='';document.getElementById('gl').style.display='none';1");
await sleep(220);
let cap2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(ROOT, `shots/review/_probe-b-${num}-2d.png`), Buffer.from(cap2.data, 'base64'));
await ev("document.getElementById('gl').style.display='';1");
await sleep(220);
console.log('wrote gl/2d layer shots');
const cap = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(ROOT, `shots/review/_probe-b-${num}-full.png`), Buffer.from(cap.data, 'base64'));
console.log('wrote full');
console.log('logs:', logs.length ? logs.slice(0, 12).join('\n  ') : '(none)');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
