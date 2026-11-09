/* 逐字状态检查：把 #cur 里每个 .ch 的 class / 计算色 / 矩形全打出来
   用法: node _lyr-cells.mjs 296b-trapmetal.html 10 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const PORT = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILE = process.argv[2] || '296b-trapmetal.html';
const AT = Number(process.argv[3] || 10);

const TEXTS = ['雨落在没有人的站台', '灯把影子拉得很长', '我等一班不会来的车', '风从隧道那头吹过来'];
const LRC = process.argv.includes('--lrc');
const LINES = TEXTS.map((text, i) => ({ t: i * 4, dur: 4, text,
  chars: LRC ? null : Array.from(text).map((c, k) => ({ c, t: +(i * 4 + 0.12 + k * 0.32).toFixed(3) })) }));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-lc-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--window-size=1600,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

async function tabOf() {
  for (let i = 0; i < 120; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl); if (t) return t; } catch {}
    await sleep(250);
  }
  throw new Error('CDP 起不来');
}
const tab = await tabOf();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 200));
};
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 300); return r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/stages/${FILE}?v=${Date.now()}` });
for (let i = 0; i < 80; i++) { if (await ev(`typeof window.__stage === 'function' && window.__stage().frames > 2`)) break; await sleep(120); }
await ev(`(() => { window.postMessage({__c100:1,type:'init',payload:{song:{id:'T',name:'X',artists:['Y'],cover:''},accent:[214,26,30],lines:${JSON.stringify(LINES)},duration:24}},'*'); return 1; })()`);
await sleep(150);
await ev(`(() => { window.__tb=${AT}; window.__tw=performance.now(); if(window.__ti) clearInterval(window.__ti);
  window.__ti=setInterval(function(){ window.postMessage({__c100:1,type:'tick',payload:{time:window.__tb+(performance.now()-window.__tw)/1000,playing:true}},'*'); },66); return 1; })()`);
await sleep(900);

const SAMPLE = `(() => {
  const cur = document.getElementById('cur');
  const cs = getComputedStyle(cur);
  const st = window.__stage ? window.__stage() : {};
  return JSON.stringify({ idx: st.idx, t: +(st.t||0).toFixed(2), cls: cur.className, fs: cs.fontSize,
    filter: cs.filter.slice(0, 60), anim: cs.animationName + ' ' + cs.animationPlayState });
})()`;
for (let i = 0; i < 8; i++) { console.log('  s' + i, await ev(SAMPLE)); await sleep(300); }

const DUMP = `(() => {
  const cur = document.getElementById('cur');
  const st = window.__stage ? window.__stage() : {};
  const cells = [...cur.querySelectorAll('.ch')].map(function(el){
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return { c: el.textContent, cls: el.className, col: cs.color, op: cs.opacity,
             inline: el.getAttribute('style') || '', x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
  });
  const cs = getComputedStyle(cur);
  return JSON.stringify({ stage: { idx: st.idx, t: st.t, text: st.text },
    curBox: { fs: cs.fontSize, col: cs.color, op: cs.opacity, filter: cs.filter, cls: cur.className,
              rect: (function(r){ return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(cur.getBoundingClientRect()) },
    bodyCls: document.body.className, cells: cells }, null, 1);
})()`;
const out = await ev(DUMP);
console.log(String(out).slice(0, 6000));
if (errs.length) console.log('EXC:', errs.slice(0, 4));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
