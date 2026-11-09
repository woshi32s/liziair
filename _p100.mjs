import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'p100-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout'))), 30000); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 200);
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/lizi100-finale.html?chk=1` });
await sleep(1200);
const FEED = (t0) => `(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','直到夜色把一切收走把所有的路都还给沉默的远方',"I don't know how to say goodbye",'而我在原地等了很久，很久。'];
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const text = texts[i % texts.length];
    const chars = []; let acc = 0;
    for (let k = 0; k < text.length; k++) {
      const d = /[\\u4e00-\\u9fff]/.test(text[k]) ? 0.20 : 0.09;
      chars.push({ t: +(i * 2.4 + acc).toFixed(3), d, c: text[k] }); acc += d;
    }
    lines.push({ t: i * 2.4, dur: 2.4, text, chars });
  }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255] } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__T = ${t0};
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*');
  window.__tk = setInterval(() => { window.__T += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*'); }, 66);
  return 1;
})()`;

const INFO = `(()=>{
  const g = lastUse100 && lastUse100.g; if (!g) return 'no g';
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for (let i=0;i<g.pc;i++){const x=g.px[i],y=g.py[i]; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;}
  /* y 直方图，3 单位一格 */
  const NB=Math.ceil((y1-y0)/3)+2, h=new Uint16Array(NB);
  for (let i=0;i<g.pc;i++){let b=((g.py[i]-y0)/3)|0; if(b<0)b=0; if(b>=NB)b=NB-1; h[b]++;}
  let s=''; for(let b=0;b<NB;b++) s += (h[b]>0?String.fromCharCode(97+h[b]%26):'.');
  return {text:(L.text||''), n:L.n, pc:g.pc, x0:+x0.toFixed(0), x1:+x1.toFixed(0), y0:+y0.toFixed(0), y1:+y1.toFixed(0),
          groups: groups100?groups100.length:0,
          ginfo: groups100?groups100.map(G=>({y0:+G.y0.toFixed(0),y1:+G.y1.toFixed(0),xa:+G.xa.toFixed(0),xb:+G.xb.toFixed(0),K:+G.K.toFixed(3),a:+G.th[0].toFixed(2),b:+G.th[96].toFixed(2)})):null,
          hist: s};
})()`;

for (const t of [1.0, 5.2, 8.2]) {
  await ev(FEED(t));
  await sleep(2600);
  console.log('=== T=' + t);
  console.log(JSON.stringify(await ev(INFO)));
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${ROOT}/shots/lizi/_probe${t}.png`, Buffer.from(r.data, 'base64'));
}
ws.close(); chrome.kill(); await sleep(250);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch { }
