/** _lizisw.mjs —— 开关法定位掉帧：逐个关掉渲染层，看 fps 归谁
 *  用法: node _lizisw.mjs lizi01-thrown-splat.html */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = process.argv[2];
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-sw-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC' : r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });

const FEED = `(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','直到夜色把一切收走把所有的路都还给沉默的远方'];
  const lines = [];
  for (let i = 0; i < 30; i++) { const text = texts[i % texts.length]; const chars = [];
    let acc = 0; for (let k = 0; k < text.length; k++) { const d = 0.2; chars.push({ t: +(i*2.4+acc).toFixed(3), d, c: text[k] }); acc += d; }
    lines.push({ t: i*2.4, dur: 2.4, text, chars }); }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180,170,255] } }, '*');
  window.__T = 0;
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { window.__T += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*'); }, 66);
  return 1; })()`;

const FPS = `new Promise((res) => { const a=[]; let last=performance.now(); const t0=last;
  function f(){ const n=performance.now(); a.push(n-last); last=n;
    if(n-t0<1800) requestAnimationFrame(f); else { const s=a.slice(3).sort((x,y)=>x-y);
      res({ fps:+(1000/(s.reduce((p,q)=>p+q,0)/s.length)).toFixed(1), p95:+s[Math.floor(s.length*0.95)].toFixed(1) }); } }
  requestAnimationFrame(f); })`;

const cases = [
  ['A 全开',''],
  ['B 关烟层','off=smoke'],
  ['C 关已落定的字','off=ash'],
  ['D 关热灰','off=hot'],
  ['E 关烟+字','off=smoke,ash'],
  ['F 全关','off=smoke,ash,hot'],
];
const casesOld = [
  ['全开', ''],
  ['关墨墙', 'off=ink'],
  ['关火星条', 'off=fly'],
  ['关光斑', 'off=bokeh'],
  ['关墨墙+火星条', 'off=ink,fly'],
  ['全关(墨墙+条+光斑)', 'off=ink,fly,bokeh'],
];
console.log('用例'.padEnd(24) + 'fps    p95');
console.log('-'.repeat(44));
for (const [name, q] of cases) {
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}${q ? '?' + q : ''}` });
  await sleep(900);
  await ev(FEED);
  await sleep(3400);          // 走到第 2 句、墨还没落满
  const r = await ev(FPS);
  console.log(name.padEnd(24) + String(r.fps).padEnd(7) + r.p95);
}
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
