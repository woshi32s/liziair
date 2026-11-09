/**
 * 临时剖析器 6：058 闪电的分段耗时定位（强制 flush）。
 * 用法: node prof6.mjs 058-lightning-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-prof6-' + Date.now());
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
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { t += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: t, playing: true } }, '*'); }, 66);
  return 1; })()`);
await sleep(4600);
console.log('stage:', JSON.stringify(await ev('window.__stage()')));
await ev(`(() => { window.__stop = 1; const raf = window.requestAnimationFrame; window.requestAnimationFrame = function () { return 0; }; window.__raf = raf; window.__flush = () => { ctx.getImageData(0, 0, 1, 1); }; return 1; })()`);
await sleep(200);
console.log('vet:', JSON.stringify(await ev(`(() => ({ n: set ? set.base.length / 2 : 0, vars: set ? set.vars.length : 0,
  main: set && set.vars[0] ? set.vars[0].mainLen.toFixed(0) : 0, br: set && set.vars[0] && set.vars[0].br ? 1 : 0 }))()`)));

/* 分段计时（含 flush），取最小值 */
const TIME = (code, pre) => `(() => { ${pre || ''}
  const op = () => { ${code} };
  const T = [];
  for (let r = 0; r < 6; r++) { const t0 = performance.now(); op(); window.__flush(); T.push(performance.now() - t0); }
  T.sort((a, b) => a - b); return { min: +T[0].toFixed(2), med: +T[3].toFixed(2) }; })()`;

const pre = `const v = set.vars[0]; prog = 1; strikeAge = 1.0;`;
const seg = [
  ['① 空 flush', `window.__flush(); window.__flush();`],
  ['② 天空 skyTop 全屏贴', `ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1; ctx.drawImage(skyTop,0,0,W,H);`],
  ['③ 星星两批 arc', `ctx.globalCompositeOperation='lighter'; ctx.fillStyle='rgba(190,208,255,0.34)'; ctx.beginPath();
     for (let i=0;i<stars.length;i++){ const s=stars[i]; const a=0.5+0.5*Math.sin(t0*0.7+s.p); if(a<0.5) continue; ctx.moveTo(s.x*W+s.r,s.y*H); ctx.arc(s.x*W,s.y*H,s.r,0,6.283);} ctx.fill();
     ctx.fillStyle='rgba(150,170,230,0.16)'; ctx.beginPath();
     for (let i=0;i<stars.length;i++){ const s=stars[i]; const a=0.5+0.5*Math.sin(t0*0.7+s.p); if(a>=0.5) continue; ctx.moveTo(s.x*W+s.r,s.y*H); ctx.arc(s.x*W,s.y*H,s.r,0,6.283);} ctx.fill();`],
  ['④ 云 14 次 drawImage', `ctx.globalCompositeOperation='lighter'; const lit=Math.min(1,flash);
     for (let i=0;i<clouds.length;i++){ const c=clouds[i]; const x=c.x*W+Math.sin(t0*0.06+c.s)*12; const y=c.y*H; const sz=c.s*(W/1400+0.55)*2.6;
       ctx.globalAlpha=c.a*0.85*(1-lit*0.6); ctx.drawImage(cloudDark,x-sz*0.5,y-sz*0.22,sz,sz*0.45);
       if(lit>0.02){ ctx.globalAlpha=c.a*lit*0.9; ctx.drawImage(cloudLit,x-sz*0.5,y-sz*0.22,sz,sz*0.45);} }
     ctx.globalAlpha=1;`],
  ['⑤ 远山 skyLand 全屏贴', `ctx.globalCompositeOperation='source-over'; ctx.drawImage(skyLand,0,0,W,H);`],
  ['⑥ 闪光 fillRect+topSprite', `flash=1; ctx.globalCompositeOperation='lighter';
     ctx.fillStyle='rgba(140,160,255,'+(flash*0.09).toFixed(3)+')'; ctx.fillRect(0,0,W,H);
     ctx.globalAlpha=Math.min(1,flash*0.8); ctx.drawImage(topSprite,W*0.5-H*0.6,-H*0.5,H*1.2,H*1.2); ctx.globalAlpha=1;`],
  ['⑦ 主通道 3 条辉光(实线)', `${pre} ctx.globalCompositeOperation='lighter'; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.setLineDash([]);
     ctx.strokeStyle='hsla(240,100%,72%,0.10)'; ctx.lineWidth=13; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(225,100%,82%,0.28)'; ctx.lineWidth=6; ctx.stroke(v.main);
     ctx.strokeStyle='rgba(190,205,255,0.20)'; ctx.lineWidth=9; ctx.stroke(v.main);`],
  ['⑧ 主通道 2 条实心细线(实线)', `${pre} ctx.globalCompositeOperation='lighter'; ctx.setLineDash([]);
     ctx.strokeStyle='hsla(212,100%,88%,0.62)'; ctx.lineWidth=2.2; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(210,100%,97%,0.95)'; ctx.lineWidth=1.1; ctx.stroke(v.main);`],
  ['⑨ 主通道 2 条细线(dash, prog=1)', `${pre} ctx.globalCompositeOperation='lighter';
     const dl=Math.max(0,Math.min(1,prog))*v.mainLen; ctx.setLineDash([dl,v.mainLen]);
     ctx.strokeStyle='hsla(212,100%,88%,0.62)'; ctx.lineWidth=2.2; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(210,100%,97%,0.95)'; ctx.lineWidth=1.1; ctx.stroke(v.main); ctx.setLineDash([]);`],
  ['⑩ 主通道 2 条细线(dash, prog=0.35)', `${pre} prog=0.35; ctx.globalCompositeOperation='lighter';
     const dl=Math.max(0,Math.min(1,prog))*v.mainLen; ctx.setLineDash([dl,v.mainLen]);
     ctx.strokeStyle='hsla(212,100%,88%,0.62)'; ctx.lineWidth=2.2; ctx.stroke(v.main);
     ctx.strokeStyle='hsla(210,100%,97%,0.95)'; ctx.lineWidth=1.1; ctx.stroke(v.main); ctx.setLineDash([]);`],
  ['⑪ 分支 dash 两条', `${pre} ctx.globalCompositeOperation='lighter';
     if (v.br) { const dl=Math.max(0,Math.min(1,prog))*v.brMax; ctx.setLineDash([dl,v.brMax]);
       ctx.strokeStyle='hsla(215,100%,70%,0.20)'; ctx.lineWidth=3; ctx.stroke(v.br);
       ctx.strokeStyle='hsla(215,100%,92%,0.55)'; ctx.lineWidth=0.9; ctx.stroke(v.br); ctx.setLineDash([]); }`],
  ['⑫ 落点辉光 drawImage', `${pre} ctx.globalCompositeOperation='lighter';
     for (let i=0;i<v.hits.length;i++){ const h=v.hits[i]; const rad=90+strikeAge*70; ctx.globalAlpha=0.5; ctx.drawImage(glowSprite,h.x-rad,h.y-rad,rad*2,rad*2);} ctx.globalAlpha=1;`],
];
for (const [n, c] of seg) console.log(n.padEnd(32), JSON.stringify(await ev(TIME(c))));

/* 整帧基线 */
console.log('—— 整帧 ——');
console.log(JSON.stringify(await ev(`(() => { prog=1; strikeAge=1.0; flash=0.5;
  const T=[]; for (let r=0;r<6;r++){ const t0=performance.now(); draw(); window.__flush(); T.push(performance.now()-t0);} T.sort((a,b)=>a-b);
  return { min:+T[0].toFixed(2), med:+T[3].toFixed(2) }; })()`)));
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}