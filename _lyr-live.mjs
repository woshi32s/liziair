/* _lyr-live.mjs — 在真实播放器里测「歌词跟不跟得上」
   用法: node _lyr-live.mjs 295,296
   做的事: 开一首**有歌词**的歌 → 播放 → 进形态 → 数 init/tick 频率 →
           每 1.2s 采一次 __stage()，和 audio.currentTime + 该时间的应有歌词对比 → 截图 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const PORT = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(ROOT, 'shots/review');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = (process.argv[2] || '295,296').split(',').map((s) => s.trim()).filter(Boolean);

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-ll-' + Date.now());
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
  if (m.method === 'Runtime.exceptionThrown') errs.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 160));
};
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 240); return r.result.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };

await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('lizi.tour.v1','1')}catch(e){}" });
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
for (let i = 0; i < 90; i++) { await sleep(250); if (await ev("document.querySelectorAll('.hall-pl').length") > 0) break; }
await sleep(900);
for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });

/* 开歌单 → 挑一首真的有词的歌 */
await ev("(() => { const c = document.querySelectorAll('.hall-pl')[0]; if (c) c.click(); return 1; })()");
for (let i = 0; i < 60; i++) { await sleep(250); if (await ev("document.querySelectorAll('.track').length") > 2) break; }
const ntracks = await ev("document.querySelectorAll('.track').length");
console.log('曲目数:', ntracks);
let picked = -1, lyricLines = 0;
for (let k = 0; k < Math.min(6, ntracks); k++) {
  await ev(`(() => { const r = document.querySelectorAll('.track')[${k}]; if (r) r.click(); return 1; })()`);
  await sleep(4200);
  const info = await ev(`(() => { const el=document.querySelector('.lyrics'); const ls=el?String(el.innerText||'').split('\\n').map(t=>t.trim()).filter(Boolean):[]; return JSON.stringify({n:ls.length, head:ls.slice(0,3)}); })()`);
  console.log(`  第${k + 1}首歌词:`, info);
  try { const o = JSON.parse(info); if (o.n >= 3) { picked = k; lyricLines = o.n; break; } } catch {}
}
if (picked < 0) { console.log('!! 没找到有词的歌，仍然继续'); }
console.log('选中曲目:', picked, '歌词行数:', lyricLines);
console.log('play():', await ev("(() => { const a=document.querySelector('audio'); if(!a) return 'no audio'; a.play().catch(()=>{}); return 'ok paused='+a.paused+' t='+a.currentTime; })()"));
await sleep(1500);
console.log('播放状态:', await ev("(() => { const a=document.querySelector('audio'); return a? JSON.stringify({t:+a.currentTime.toFixed(2),paused:a.paused,d:+(a.duration||0).toFixed(1)}):'none'; })()"));

/* 装探针（同源，可从父页给 iframe 的 window 挂监听） */
const INSTALL = `(() => {
  const w = document.getElementById('stage-frame').contentWindow;
  if (!w) return 'no win';
  if (w.__probe) return 'already';
  w.__probe = { init:0, tick:0, beat:0, live:0, lastInit:null, inits:[] };
  w.addEventListener('message', function(e){
    const d = e.data; if (!d || d.__c100 !== 1) return;
    const p = w.__probe;
    if (d.type === 'init') { p.init++; p.lastInit = (d.payload||{}).lines || []; if (p.inits.length < 8) p.inits.push({n:(d.payload||{}).lines ? d.payload.lines.length : -1}); }
    else if (d.type === 'tick') p.tick++;
    else if (d.type === 'beat') p.beat++;
    else if (d.type === 'live') p.live++;
  });
  return 'installed';
})()`;
const SNAP = `(() => {
  const f = document.getElementById('stage-frame');
  const a = document.querySelector('audio');
  const w = f && f.contentWindow; const p = w && w.__probe;
  let st = null; try { st = w.__stage ? w.__stage() : null; } catch(e){ st = {err:'throw '+e.message}; }
  return JSON.stringify({
    audio: a ? {t:+a.currentTime.toFixed(2), paused:a.paused, d:+(a.duration||0).toFixed(1)} : null,
    probe: p ? {init:p.init, tick:p.tick, beat:p.beat, live:p.live, nlines:(p.lastInit||[]).length} : null,
    stage: st ? {idx:st.idx, t:+(st.t||0).toFixed(2), playing:st.playing, text:st.text, err:st.err, frames:st.frames} : null,
  });
})()`;
const RESET = `(() => { const w=document.getElementById('stage-frame').contentWindow; if(w&&w.__probe){ w.__probe.init=0; w.__probe.tick=0; w.__probe.beat=0; w.__probe.live=0; } return 1; })()`;

const openDrawer = () => ev("(() => { const b = document.getElementById('btn-drawer'); if (!b) return 'no btn'; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 'ok'; })()");

for (const sid of IDS) {
  console.log('\n================ ' + sid);
  await openDrawer(); await sleep(700);
  await ev(`(() => { const row = [...document.querySelectorAll('#drawer .drawer__row, #drawer [role=button], #drawer button')].find(e=>/进入形态/.test(e.innerText||'')); if(row) row.click(); return 1; })()`);
  await sleep(900);
  console.log('点形态:', await ev(`(() => { const it = document.querySelector('#drawer-stage-list .stage-item[data-id="${sid}"]'); if(!it) return 'no item'; it.scrollIntoView({block:'center'}); it.click(); return 'clicked'; })()`));
  await sleep(2500);
  await ev("(() => { const a=document.querySelector('audio'); if(a&&a.paused) a.play().catch(()=>{}); return 1; })()");
  await sleep(1200);
  console.log('探针:', await ev(INSTALL));
  await ev(RESET);
  for (let i = 0; i < 6; i++) {
    await sleep(1200);
    const s = await ev(SNAP);
    console.log(`  [${i}] ${s}`);
    if (i === 1 || i === 4) await shot(`lyr-live-${sid}-${i}.png`);
  }
  await ev(RESET);
  await sleep(1000);
  console.log('  1s 内报文:', await ev(`(() => { const p=document.getElementById('stage-frame').contentWindow.__probe; return JSON.stringify(p); })()`));
}
if (errs.length) console.log('\nEXC:', errs.slice(0, 5));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
