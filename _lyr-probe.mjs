/* _lyr-probe.mjs —— 照抄真实播放器的报文（init 里 accent 在顶层、tick 15Hz）
   用法: node _lyr-probe.mjs 295-y2k-extreme.html 296b-trapmetal.html
   产出: shots/review/lyr-<file>-t<at>.png + 控制台里所有可见歌词节点的文本/位置 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const PORT = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(ROOT, 'shots/review');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EMPTY = process.argv.includes('--empty');
const files = process.argv.slice(2).filter((s) => s && !s.startsWith('--'));
if (!files.length) { console.error('node _lyr-probe.mjs 295-y2k-extreme.html'); process.exit(1); }

const TEXTS = ['雨落在没有人的站台', '灯把影子拉得很长', '我等一班不会来的车', '风从隧道那头吹过来',
  '把话咽回去的时候', '整座城市都在回声'];
const LINES = TEXTS.map((text, i) => ({ t: i * 4, dur: 4, text,
  chars: Array.from(text).map((c, k) => ({ c, t: +(i * 4 + 0.12 + k * 0.32).toFixed(3) })) }));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-lp-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP,
  '--window-size=1600,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

async function tabOf() {
  for (let i = 0; i < 120; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t;
    } catch {}
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console:' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 160));
};
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __exc: ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 300) }; return r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

const INIT = `(() => { window.postMessage({__c100:1,type:'init',payload:{
  song:{id:'T1',name:'WOUND PROTOCOL',artists:['TEST CREW','NULL'],cover:''},
  accent:[214,26,30], lines:${EMPTY ? '[]' : JSON.stringify(LINES)}, duration:24}},'*'); return 1; })()`;

/* 真实播放器：init 之后每 66ms 一条 tick，time 是 audio.currentTime */
const startTicks = (at) => `(() => {
  window.__tbase = ${at}; window.__twall = performance.now();
  if(window.__tick) clearInterval(window.__tick);
  window.__tick = setInterval(function(){
    var t = window.__tbase + (performance.now()-window.__twall)/1000;
    window.postMessage({__c100:1,type:'tick',payload:{time:t,playing:true}},'*');
  }, 66); return 1; })()`;

const DUMP = `(() => {
  const out = [];
  const seen = new Set();
  function walk(root){
    for(const el of root.querySelectorAll('*')){
      if(el.children.length) continue;
      const t=(el.textContent||'').trim(); if(!t) continue;
      const cs=getComputedStyle(el), r=el.getBoundingClientRect();
      if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0) continue;
      if(r.width<2||r.height<2) continue;
      if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth) continue;
      const key=Math.round(r.left)+','+Math.round(r.top)+','+t.slice(0,8);
      if(seen.has(key)) continue; seen.add(key);
      out.push({t:t.slice(0,26), x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height), fs:Math.round(parseFloat(cs.fontSize)), col:cs.color, op:cs.opacity, id:el.id||'', cls:(el.className||'').toString().slice(0,26)});
    }
  }
  walk(document.body);
  return JSON.stringify(out);
})()`;

for (const f of files) {
  for (const at of [1.5, 6.0, 10.0]) {
    errs.length = 0;
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/stages/${f}?v=${Date.now()}-${at}` });
    for (let i = 0; i < 80; i++) { if (await ev(`typeof window.__stage === 'function' && window.__stage().frames > 2`)) break; await sleep(120); }
    await ev(INIT);
    await sleep(120);
    await ev(startTicks(at));
    await sleep(1500);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `lyr-${f.replace('.html', '')}-t${at}.png`), Buffer.from(r.data, 'base64'));
    const st = await ev('window.__stage ? window.__stage() : null');
    const st2 = typeof st === 'object' && st ? { idx: st.idx, t: st.t, playing: st.playing, text: st.text, err: st.err, frames: st.frames } : st;
    console.log(`\n=== ${f} @${at}s  __stage=${JSON.stringify(st2)}`);
    const dump = await ev(DUMP);
    let arr = [];
    try { arr = JSON.parse(dump); } catch (e) { console.log('dump fail', dump); }
    for (const d of arr) console.log(`  "${d.t}"  @${d.x},${d.y} ${d.w}x${d.h} fs${d.fs} op${d.op} col${d.col} #${d.id}.${d.cls}`);
    if (errs.length) console.log('  EXC:', errs.slice(0, 4).join(' | '));
  }
}
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
