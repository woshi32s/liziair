/**
 * 临时剖析器 9：058 修完后 draw() 的分段实测（含强制 flush）。
 * 用法: node prof9.mjs 058-lightning-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-prof9-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; console.log('EXC:', ((d.exception && d.exception.description) || d.text || '').split('\n')[0]); } };
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout'))), 60000); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 400);
  return r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
await sleep(1400);
await ev(`(() => { const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','而我在原地等了很久','直到夜色把一切收走'];
  const lines = [];
  for (let i = 0; i < 30; i++) { const text = texts[i % texts.length]; const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: i * 2.4 + k * 0.22, d: 0.22, c: text[k] });
    lines.push({ t: i * 2.4, dur: 2.4, text, chars }); }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255] } }, '*');
  let t = 0; window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  window.__tk = setInterval(() => { t += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: t, playing: true } }, '*'); }, 66);
  return 1; })()`);
await sleep(6000);
await ev(`(() => { window.requestAnimationFrame = function () { return 0; }; window.__flush = () => { ctx.getImageData(0, 0, 1, 1); }; return 1; })()`);
await sleep(200);
console.log('stage:', JSON.stringify(await ev('window.__stage()')));

const TIME = (code, pre) => `(() => { ${pre || ''}
  const op = () => { ${code} };
  const T = [];
  for (let r = 0; r < 7; r++) { const t0 = performance.now(); op(); window.__flush(); T.push(performance.now() - t0); }
  T.sort((a, b) => a - b); return { min: +T[0].toFixed(2), med: +T[3].toFixed(2) }; })()`;

const pre = `const v = set.vars[0]; prog = 1; strikeAge = 1.2; flash = 0;`;
const segs = [
  ['① 天空 skyTop 贴', `${pre} ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1; ctx.drawImage(skyTop,0,0,W,H);`],
  ['② 云 7 块(lit=0)', `${pre} const lit=0; ctx.globalCompositeOperation='lighter';
     for (let i=0;i<clouds.length;i++){ const c=clouds[i]; const x=c.x*W+Math.sin(t0*0.06+c.s)*12; const y=c.y*H; const sz=c.s*(W/1400+0.55)*2.6;
       ctx.globalAlpha=c.a*0.85; ctx.drawImage(cloudDark,x-sz*0.5,y-sz*0.22,sz,sz*0.45);} ctx.globalAlpha=1;`],
  ['③ 云 14 块(lit=1)', `${pre} const lit=1; ctx.globalCompositeOperation='lighter';
     for (let i=0;i<clouds.length;i++){ const c=clouds[i]; const x=c.x*W+Math.sin(t0*0.06+c.s)*12; const y=c.y*H; const sz=c.s*(W/1400+0.55)*2.6;
       ctx.globalAlpha=c.a*0.85*(1-lit*0.6); ctx.drawImage(cloudDark,x-sz*0.5,y-sz*0.22,sz,sz*0.45);
       ctx.globalAlpha=c.a*lit*0.9; ctx.drawImage(cloudLit,x-sz*0.5,y-sz*0.22,sz,sz*0.45);} ctx.globalAlpha=1;`],
  ['④ 远山 skyLand 贴', `${pre} ctx.globalCompositeOperation='source-over'; ctx.drawImage(skyLand,0,0,W,H);`],
  ['⑤ 闪光 fillRect+topSprite', `${pre} flash=1; ctx.globalCompositeOperation='lighter';
     ctx.fillStyle='rgba(140,160,255,0.09)'; ctx.fillRect(0,0,W,H);
     ctx.globalAlpha=0.8; ctx.drawImage(topSprite,W*0.5-H*0.6,-H*0.5,H*1.2,H*1.2); ctx.globalAlpha=1;`],
  ['⑥ 闪电整根 blit (prog=1)', `${pre} blitBolt(v, 1, 1);`],
  ['⑦ 闪电整根 blit (生长 clip, prog=0.5)', `${pre} blitBolt(v, 0.5, 1);`],
  ['⑧ 只 blit 不画落点(strikeAge 大)', `${pre} strikeAge=1.2; const fl=0.82+0.18*Math.sin(strikeAge*95); ctx.globalCompositeOperation='lighter'; ctx.globalAlpha=Math.min(1,fl); ctx.drawImage(v.cv,0,0,W,H); ctx.globalAlpha=1;`],
  ['⑨ 只落点辉光(6 个, rad=174)', `${pre} strikeAge=1.2; const k=Math.exp(-strikeAge*2.2);
     ctx.globalCompositeOperation='lighter';
     for (let i=0;i<6;i++){ const rad=90+strikeAge*70; ctx.globalAlpha=0.5; ctx.drawImage(glowSprite, (i*180)%1200, 200, rad*2, rad*2);} ctx.globalAlpha=1;`],
  ['⑩ 整帧 draw()', `${pre} draw();`],
];
for (const [n, c] of segs) console.log(n.padEnd(36), JSON.stringify(await ev(TIME(c))));

/* 分开测：一次 draw 里各段的累计（用包装计数） */
console.log('—— draw 内部累计（跑 30 帧）——');
console.log(JSON.stringify(await ev(`(() => {
  const c = document.getElementById('c').getContext('2d');
  const acc = {}; const wrap = (n) => { const o = c[n]; c[n] = function (...a) { const t0 = performance.now(); const r = o.apply(this, a);
    acc[n] = (acc[n] || 0) + (performance.now() - t0); return r; }; };
  ['drawImage', 'fillRect'].forEach(wrap);
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) { prog = 1; strikeAge = 1.2; flash = 0.4; draw(); }
  const total = performance.now() - t0;
  return { perFrameTotal: +(total / 30).toFixed(2), perOp: { drawImage: +(acc.drawImage / 30).toFixed(2), fillRect: +(acc.fillRect / 30).toFixed(2) } };
})()`)));
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}