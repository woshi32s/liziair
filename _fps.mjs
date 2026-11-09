/** _fps.mjs —— 形态页「真实管线」帧率对比（父页面里跑 iframe + 顶部操作条 + 液态玻璃）。
 *  用法: node _fps.mjs 013 020 035
 *  和 smoke-all 的区别：
 *   ① 不关 GPU，且解除 vsync 上限，测的是「能力」不是刷新率；
 *   ② 测的是父页面里的形态（iframe + 操作条 + 玻璃），不是裸形态页；
 *   ③ 先 clearInterval 掐掉父页面 tick（否则 tick 一直喂 time=0，形态会停），再自己喂；
 *   ④ 中位帧间隔算 fps；同一档跑两遍看噪声。
 *  渲染缩放：iframe 布局尺寸缩到 s，再用 transform: scale(1/s) 拉满 ——
 *  形态按缩小的视口重新算 canvas，像素数按 s² 掉，画面略微变软。 */
import { spawn } from 'node:child_process';
import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import fs from 'node:fs';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stages = process.argv.slice(2);
if (!stages.length) stages.push('013');

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-fps-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,900',
  '--disable-frame-rate-limit', '--disable-gpu-vsync'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 120) : r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const FEED = `(() => {
  const w = document.getElementById('stage-frame').contentWindow;
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','而我在原地等了很久','直到夜色把一切收走'];
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const text = texts[i % texts.length];
    const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: i * 2.4 + k * 0.22, d: 0.22, c: text[k] });
    lines.push({ t: i * 2.4, dur: 2.4, text, chars });
  }
  w.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255] } }, '*');
  window.__ft = 0;
  clearInterval(window.__feed);
  window.__feed = setInterval(() => {
    window.__ft += 0.05;
    w.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__ft, playing: true } }, '*');
    if (Math.random() < 0.08) w.postMessage({ __c100: 1, type: 'beat', payload: { level: 0.7, bpm: 120 } }, '*');
  }, 50);
  return 1;
})()`;

const MEASURE = (ms) => `new Promise((res) => {
  const ts = []; let last = performance.now(); const t0 = last;
  function f() { const n = performance.now(); ts.push(n - last); last = n;
    if (n - t0 < ${ms}) requestAnimationFrame(f);
    else { const a = ts.slice(5).sort((x, y) => x - y);
      const med = a[Math.floor(a.length / 2)];
      const mean = a.reduce((p, q) => p + q, 0) / a.length;
      const p95 = a[Math.floor(a.length * 0.95)];
      res({ med: +(1000 / med).toFixed(1), mean: +(1000 / mean).toFixed(1), p95ms: +p95.toFixed(2) }); } }
  requestAnimationFrame(f);
})`;

const DIMS = `(() => { const f = document.getElementById('stage-frame'); const w = f.contentWindow;
  const c = w.document.querySelector('canvas');
  return '视口 ' + Math.round(w.innerWidth) + 'x' + Math.round(w.innerHeight) + '  canvas ' + (c ? c.width + 'x' + c.height : '无'); })()`;

const setBar = (on, glass = true, plain = false) => ev(`(() => {
  const h = document.getElementById('stage-hud');
  h.classList.toggle('is-idle', ${!on}); h.classList.toggle('is-near', ${on});
  h.querySelectorAll('.lg-surface').forEach((e) => {
    if (${plain}) { e.style.backdropFilter = 'blur(18px) saturate(1.35)'; e.style.webkitBackdropFilter = 'blur(18px) saturate(1.35)'; }
    else if (${glass}) { e.style.backdropFilter = ''; e.style.webkitBackdropFilter = ''; e.style.background = ''; }
    else { e.style.backdropFilter = 'none'; e.style.webkitBackdropFilter = 'none'; e.style.background = 'rgba(22,22,30,.72)'; }
  });
  return 1; })()`);

const setScale = (s) => ev(`(() => {
  const f = document.getElementById('stage-frame');
  if (${s} === 1) { f.style.width = ''; f.style.height = ''; f.style.transform = ''; f.style.transformOrigin = ''; }
  else { f.style.width = (${s} * 100) + '%'; f.style.height = (${s} * 100) + '%';
         f.style.transformOrigin = '0 0'; f.style.transform = 'scale(' + (1 / ${s}) + ')'; }
  return 1; })()`);

for (const st of stages) {
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/?stage=${st}` });
  await sleep(2600);
  await ev(`(() => { for (let i = 1; i < 200000; i++) clearInterval(i); return 1; })()`);
  await sleep(300);
  console.log('');
  console.log('=== ' + st + ' ===');
  let fed = false;

  const run = async (label, scale, barOn, glass = true, plain = false) => {
    await setScale(scale);
    await setBar(barOn, glass, plain);
    if (!fed) { fed = true; await ev(FEED); } else { await ev('window.__ft = 0; 1'); }
    await sleep(1100);
    const r = await ev(MEASURE(1800));
    const dims = await ev(DIMS);
    console.log('  ' + label.padEnd(24) + 'med ' + String(r.med).padStart(6) + ' fps   mean ' + String(r.mean).padStart(6)
      + '   p95 ' + String(r.p95ms).padStart(5) + 'ms  | ' + dims);
  };

  await run('A 原样（条+玻璃）', 1, true);
  await run('A2 原样 复测', 1, true);
  await run('B 条隐藏', 1, false);
  await run('C 85% + 条隐藏', 0.85, false);
  await run('D 70% + 条隐藏', 0.7, false);
  await run('E 55% + 条隐藏', 0.55, false);
  await run('F 条显示但玻璃关掉', 1, true, false);
  await run('G 条显示 / 只留普通 blur', 1, true, true, true);
}

ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
