/**
 * 临时剖析器 3：强制 flush（getImageData）把延迟光栅化的时间量出来，
 * 对比：矩形网格 / 格线网格 / 圆弧网络 / 折线近似网络 / 全屏 drawImage / 光点。
 * 用法: node prof3.mjs 057-truchet-dots-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const file = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-prof3-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; console.log('EXC:', ((d.exception && d.exception.description) || d.text || '').split('\n')[0]); }
};
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout'))), 60000);
});
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 400);
  return r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
await sleep(1400);
await ev(`(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','而我在原地等了很久','直到夜色把一切收走'];
  const lines = [];
  for (let i = 0; i < 30; i++) { const text = texts[i % texts.length]; const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: i * 2.4 + k * 0.22, d: 0.22, c: text[k] });
    lines.push({ t: i * 2.4, dur: 2.4, text, chars }); }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255] } }, '*');
  let t = 0; window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { t += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: t, playing: true } }, '*'); }, 66);
  return 1; })()`);
await sleep(4000);
/* 停掉主循环，改由我们手动出帧，避免互相干扰 */
await ev(`(() => { window.__stop = true; const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function () { return 0; }; window.__raf = raf; return 1; })()`);
await sleep(300);

const SETUP = `(() => {
  const blob = document.createElement('canvas');
  blob.width = cv.width; blob.height = cv.height;
  const bx = blob.getContext('2d');
  bx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bx.fillStyle = bgGrad; bx.fillRect(0, 0, W, H);
  bx.fillStyle = centerGrad; bx.fillRect(0, 0, W, H);
  bx.globalCompositeOperation = 'lighter';
  bx.lineWidth = Math.max(1.4, cell * 0.05); bx.strokeStyle = 'rgba(206,196,190,0.045)';
  bx.stroke(pat.openPath);
  window.__blob = blob;

  /* 格线版网格（和矩形版并集等价） */
  const lat = new Path2D();
  for (let i = 0; i < cols; i++) { const x = ox + i * cell + 0.5; lat.moveTo(x, oy + 0.5); lat.lineTo(x, oy + rows * cell - 0.5); }
  for (let j = 0; j < rows; j++) { const y = oy + j * cell + 0.5; lat.moveTo(ox + 0.5, y); lat.lineTo(ox + cols * cell - 0.5, y); }
  window.__lat = lat;

  /* 折线近似网络：每段 90 度弧用 3 段折线（半径 5px，弦误差 0.17px，肉眼不可见） */
  function polyNet(K) {
    const p0 = new Path2D(), p1 = new Path2D();
    const E = [[3, 1], [0, 2]];   // [type0: arc0 用 entry3, arc1 用 entry1], [type1: entry0, entry2]
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const t = j * cols + i, x = ox + i * cell, y = oy + j * cell, ty = pat.types[t];
      for (let a = 0; a < 2; a++) {
        const p = pat.loopArc[t * 2 + a] ? p1 : p0;
        dotAt(ty, a, E[ty][a], x, y, cell, 0);
        p.moveTo(_dx, _dy);
        for (let q = 1; q <= K; q++) { dotAt(ty, a, E[ty][a], x, y, cell, q / K); p.lineTo(_dx, _dy); }
      }
    }
    return [p0, p1];
  }
  window.__poly = polyNet(3);
  window.__poly6 = polyNet(6);
  window.__flush = () => { ctx.getImageData(0, 0, 1, 1); };
  return { cols: cols, rows: rows, cell: cell, N: N, loops: pat.loopTiles.length }; })()`;
console.log('setup:', JSON.stringify(await ev(SETUP)));

/* 单次计时（含强制 flush），取 5 次最小值 */
const TIME = (code) => `(() => {
  const op = () => { ${code} };
  const T = [];
  for (let r = 0; r < 6; r++) { const t0 = performance.now(); op(); window.__flush(); T.push(performance.now() - t0); }
  T.sort((a, b) => a - b);
  return { min: +T[0].toFixed(2), med: +T[3].toFixed(2) };
})()`;

const tests = [
  ['① 空 flush 基线', `window.__flush(); window.__flush();`],
  ['② bg+center 两个渐变铺底', `ctx.globalCompositeOperation='source-over'; ctx.fillStyle=bgGrad; ctx.fillRect(0,0,W,H); ctx.fillStyle=centerGrad; ctx.fillRect(0,0,W,H);`],
  ['③ 棋盘 checkerPath 填充', `ctx.globalCompositeOperation='source-over'; ctx.fillStyle='rgba(255,226,196,0.016)'; ctx.fill(checkerPath);`],
  ['④ 矩形网格 gridPath 描边', `ctx.globalCompositeOperation='source-over'; ctx.strokeStyle='rgba(255,226,196,0.028)'; ctx.lineWidth=1; ctx.stroke(gridPath);`],
  ['⑤ 格线网格 lattice 描边', `ctx.globalCompositeOperation='source-over'; ctx.strokeStyle='rgba(255,226,196,0.028)'; ctx.lineWidth=1; ctx.stroke(window.__lat);`],
  ['⑥ openPath 弧网描边(1.4)', `ctx.globalCompositeOperation='lighter'; ctx.lineWidth=1.4; ctx.strokeStyle='rgba(206,196,190,0.045)'; ctx.stroke(pat.openPath);`],
  ['⑦ closedPath 两次描边', `ctx.globalCompositeOperation='lighter'; ctx.lineWidth=3; ctx.strokeStyle='rgba(255,168,96,0.045)'; ctx.stroke(pat.closedPath); ctx.lineWidth=1.6; ctx.strokeStyle='rgba(255,196,132,0.20)'; ctx.stroke(pat.closedPath);`],
  ['⑧ 折线网(K=3) 两条', `ctx.globalCompositeOperation='lighter'; ctx.lineWidth=1.4; ctx.strokeStyle='rgba(206,196,190,0.045)'; ctx.stroke(window.__poly[0]); ctx.lineWidth=3; ctx.strokeStyle='rgba(255,168,96,0.045)'; ctx.stroke(window.__poly[1]);`],
  ['⑨ 折线网(K=6) 两条', `ctx.globalCompositeOperation='lighter'; ctx.lineWidth=1.4; ctx.strokeStyle='rgba(206,196,190,0.045)'; ctx.stroke(window.__poly6[0]); ctx.lineWidth=3; ctx.strokeStyle='rgba(255,168,96,0.045)'; ctx.stroke(window.__poly6[1]);`],
  ['⑩ 全屏 drawImage(不透明烘图)', `ctx.globalCompositeOperation='source-over'; ctx.drawImage(window.__blob, 0, 0, W, H);`],
  ['⑪ 光点 3 档合批', `{ const ac = accent; ctx.globalCompositeOperation='lighter';
      ctx.fillStyle='rgba(214,206,198,0.30)'; ctx.beginPath();
      for (let k=0;k<N;k++){ if (ptrap[k]) continue; const t=pj[k]*cols+pi[k];
        dotAt(pat.types[t], pat.arcOf[t*4+pe[k]], pe[k], ox+pi[k]*cell, oy+pj[k]*cell, cell, ps[k]); ctx.rect(_dx-0.7,_dy-0.7,1.4,1.4); }
      ctx.fill();
      ctx.fillStyle='rgba('+ac[0]+','+ac[1]+','+ac[2]+',0.14)'; ctx.beginPath();
      for (let k=0;k<N;k++){ if (!ptrap[k]) continue; const t=pj[k]*cols+pi[k];
        dotAt(pat.types[t], pat.arcOf[t*4+pe[k]], pe[k], ox+pi[k]*cell, oy+pj[k]*cell, cell, ps[k]); ctx.rect(_dx-3.4,_dy-3.4,6.8,6.8); }
      ctx.fill();
      ctx.fillStyle='rgba(255,'+Math.min(255,ac[1]+30)+','+Math.min(255,ac[2]+60)+',0.92)'; ctx.beginPath();
      for (let k=0;k<N;k++){ if (!ptrap[k]) continue; const t=pj[k]*cols+pi[k];
        dotAt(pat.types[t], pat.arcOf[t*4+pe[k]], pe[k], ox+pi[k]*cell, oy+pj[k]*cell, cell, ps[k]); ctx.rect(_dx-1.15,_dy-1.15,2.3,2.3); }
      ctx.fill(); }`],
];
for (const [name, code] of tests) console.log(name.padEnd(30), JSON.stringify(await ev(TIME(code))));

/* 整帧组合：烘焙静态层后每帧要付的钱 */
console.log('—— 组合 ——');
console.log('静态层全烘成一张 + 每帧 blit + 光点'.padEnd(30), JSON.stringify(await ev(`(() => {
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d'); x.setTransform(DPR,0,0,DPR,0,0);
  const t0 = performance.now();
  x.fillStyle = bgGrad; x.fillRect(0,0,W,H);
  x.fillStyle = centerGrad; x.fillRect(0,0,W,H);
  x.fillStyle='rgba(255,226,196,0.016)'; x.fill(checkerPath);
  x.strokeStyle='rgba(255,226,196,0.028)'; x.lineWidth=1; x.stroke(window.__lat);
  x.globalCompositeOperation='lighter';
  x.lineWidth=Math.max(1.4,cell*0.05); x.strokeStyle='rgba(206,196,190,0.045)'; x.stroke(pat.openPath);
  x.lineWidth=Math.max(3,cell*0.19); x.strokeStyle='rgba(255,168,96,0.045)'; x.stroke(pat.closedPath);
  x.lineWidth=Math.max(1.6,cell*0.075); x.strokeStyle='rgba(255,196,132,0.20)'; x.stroke(pat.closedPath);
  x.getImageData(0,0,1,1);
  const bakeMs = performance.now() - t0;
  window.__baked = c;
  return { bakeMs: +bakeMs.toFixed(1) };
})()`)));
console.log('折线网版本烘焙'.padEnd(30), JSON.stringify(await ev(`(() => {
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d'); x.setTransform(DPR,0,0,DPR,0,0);
  const t0 = performance.now();
  x.fillStyle = bgGrad; x.fillRect(0,0,W,H);
  x.fillStyle = centerGrad; x.fillRect(0,0,W,H);
  x.fillStyle='rgba(255,226,196,0.016)'; x.fill(checkerPath);
  x.strokeStyle='rgba(255,226,196,0.028)'; x.lineWidth=1; x.stroke(window.__lat);
  x.globalCompositeOperation='lighter';
  x.lineWidth=Math.max(1.4,cell*0.05); x.strokeStyle='rgba(206,196,190,0.045)'; x.stroke(window.__poly[0]);
  x.lineWidth=Math.max(3,cell*0.19); x.strokeStyle='rgba(255,168,96,0.045)'; x.stroke(window.__poly[1]);
  x.lineWidth=Math.max(1.6,cell*0.075); x.strokeStyle='rgba(255,196,132,0.20)'; x.stroke(window.__poly[1]);
  x.getImageData(0,0,1,1);
  return { bakeMs: +(performance.now()-t0).toFixed(1) };
})()`)));
console.log('STAGE', JSON.stringify(await ev('window.__stage()')));
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}