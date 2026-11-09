/* _a-audit.mjs —— 车道 A 并行版观感体检（随机 CDP 端口，可多个同时跑；只量，不生成）
   用法：node _a-audit.mjs 237,238   |   node _a-audit.mjs 237-239
   指标/阈值与 _stage-audit.mjs 完全一致（对比度≥4.5 墨量1.2–60% 字高≥4.5% 留白≥20% 色相≤3 帧差>3）
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const PORT = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const want = new Set();
for (const a of args) {
  const m = /^(\d{3})-(\d{3})$/.exec(a);
  if (m) for (let i = +m[1]; i <= +m[2]; i++) want.add(String(i).padStart(3, '0'));
  else for (const s of a.split(',')) if (/^\d{1,3}$/.test(s.trim())) want.add(String(+s.trim()).padStart(3, '0'));
}
if (!want.size) { console.error('用 node _a-audit.mjs 237,238'); process.exit(1); }

const files = fs.readdirSync(path.join(ROOT, 'public/stages')).filter((f) => /^\d{3}-.*\.html$/.test(f));
const targets = [...want].sort().map((n) => ({ n, file: files.find((f) => f.startsWith(n + '-')) })).filter((t) => t.file);

const LINES = ['雨落在没有人的站台', '灯把影子拉得很长', '我等一班不会来的车', '风从隧道那头吹过来',
  '把话咽回去的时候', '整座城市都在回声'].map((text, i) => ({ t: i * 4, text }));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const profile = path.join(os.tmpdir(), 'lizi-aaudit-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--hide-scrollbars',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--mute-audio',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
  '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

async function tabOf() {
  for (let i = 0; i < 100; i++) {
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
  if (m.method === 'Runtime.exceptionThrown') errs.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 200));
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
};
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __exc: ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 200) }; return r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

const measure = async (b64) => ev(`(async () => {
  const img = new Image(); img.src = 'data:image/png;base64,' + ${JSON.stringify(b64)}; await img.decode();
  const c = document.createElement('canvas'); c.width = 360; c.height = 225;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, 360, 225);
  const d = g.getImageData(0, 0, 360, 225).data; const N = 360 * 225;
  const buckets = new Map();
  for (let i = 0; i < N; i++) { const k = (d[i*4] >> 4) + ',' + (d[i*4+1] >> 4) + ',' + (d[i*4+2] >> 4); buckets.set(k, (buckets.get(k) || 0) + 1); }
  let bk = null, bn = -1; for (const [k, v] of buckets) if (v > bn) { bn = v; bk = k; }
  const [br, bg, bb] = bk.split(',').map((x) => (Number(x) << 4) + 8);
  let ink = 0, blank = 0, hueBins = new Array(12).fill(0), sumL = 0;
  const lum = (r, gg, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b); };
  for (let i = 0; i < N; i++) {
    const r = d[i*4], gg = d[i*4+1], b = d[i*4+2];
    const dist = Math.abs(r-br) + Math.abs(gg-bg) + Math.abs(b-bb);
    sumL += lum(r, gg, b);
    if (dist < 36) blank++;
    if (dist > 150) {
      ink++;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (sat > 0.18 && mx > 40) {
        let h = 0;
        if (mx === r) h = ((gg - b) / (mx - mn)) % 6; else if (mx === gg) h = (b - r) / (mx - mn) + 2; else h = (r - gg) / (mx - mn) + 4;
        h = ((h * 60) + 360) % 360; hueBins[Math.floor(h / 30)]++;
      }
    }
  }
  const lumOf = (i) => lum(d[i*4], d[i*4+1], d[i*4+2]);
  const inkL = [], bgL = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let y = 0; y < 225; y++) for (let x = 0; x < 360; x++) {
    const i = y * 360 + x;
    const dist = Math.abs(d[i*4]-br) + Math.abs(d[i*4+1]-bg) + Math.abs(d[i*4+2]-bb);
    const L = lumOf(i);
    if (dist > 150) { inkL.push(L); if (x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
    else if (dist < 36) bgL.push(L);
  }
  inkL.sort((a, b) => a - b); bgL.sort((a, b) => a - b);
  const p90 = inkL.length ? inkL[Math.floor(inkL.length * 0.9)] : 0;
  const bgMed = bgL.length ? bgL[Math.floor(bgL.length * 0.5)] : 0;
  const contrast = (Math.max(p90, bgMed) + 0.05) / (Math.min(p90, bgMed) + 0.05);
  const hues = hueBins.filter((v) => v > ink * 0.03).length;
  const textH = ink > 0 ? (y1 - y0) / 225 : 0;
  return { contrast: +contrast.toFixed(2), ink: +(ink / N).toFixed(3), blank: +(blank / N).toFixed(3), hues, textH: +textH.toFixed(3), meanL: +(sumL / N).toFixed(3), bg: [br, bg, bb] };
})()`);

const frameDiff = async (a, b) => ev(`(async () => {
  const load = async (s) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); return i; };
  const [ia, ib] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
  const c = document.createElement('canvas'); c.width = 160; c.height = 100; const g = c.getContext('2d');
  const px = (img) => { g.clearRect(0,0,160,100); g.drawImage(img, 0, 0, 160, 100); return g.getImageData(0,0,160,100).data; };
  const A = px(ia), B = px(ib); let s = 0;
  for (let i = 0; i < A.length; i += 4) s += Math.abs(A[i]-B[i]) + Math.abs(A[i+1]-B[i+1]) + Math.abs(A[i+2]-B[i+2]);
  return +(s / (160 * 100 * 3)).toFixed(2);
})()`);

const sheet = async (b64s) => ev(`(async () => {
  const imgs = await Promise.all(${JSON.stringify(b64s)}.map(async (s) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); return i; }));
  const w = 480, h = 300, gap = 6; const c = document.createElement('canvas');
  c.width = w * imgs.length + gap * (imgs.length - 1); c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
  imgs.forEach((im, k) => g.drawImage(im, k * (w + gap), 0, w, h));
  return c.toDataURL('image/png');
})()`);

const rows = [];
for (const t of targets) {
  errs.length = 0;
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/stages/${t.file}?v=${Date.now()}` });
  let ready = false;
  for (let i = 0; i < 60; i++) { if (await ev(`typeof window.__stage === 'function'`)) { ready = true; break; } await sleep(150); }
  await sleep(400);
  await ev(`window.postMessage({ __c100: 1, type: 'init', payload: { lines: ${JSON.stringify(LINES)}, song: { cover: '', title: '审计', artist: 'LIZI' } } }, '*'); true`);
  const shots = [];
  for (const at of [1.5, 6.0, 10.0]) {
    await ev(`window.postMessage({ __c100: 1, type: 'tick', payload: { time: ${at}, playing: true } }, '*');
              window.postMessage({ __c100: 1, type: 'live', payload: { bpm: 96, level: 0.6, bass: 0.7, mid: 0.4, treble: 0.3, playing: true } }, '*'); true`);
    await sleep(1100);
    shots.push((await send('Page.captureScreenshot', { format: 'png' })).data);
  }
  const m = []; for (const s of shots) m.push(await measure(s));
  const d1 = await frameDiff(shots[0], shots[1]); const d2 = await frameDiff(shots[1], shots[2]);
  const motion = +((d1 + d2) / 2).toFixed(2);
  const url = await sheet(shots);
  const rel = `shots/review/p300-audit-${t.n}.png`;
  if (typeof url === 'string' && url.startsWith('data:image/png;base64,')) fs.writeFileSync(path.join(ROOT, rel), Buffer.from(url.split(',')[1], 'base64'));
  const mid3 = m[1];
  const checks = {
    contrast: mid3.contrast >= 4.5, ink: mid3.ink >= 0.012 && mid3.ink <= 0.6,
    blank: mid3.blank >= 0.2, textH: mid3.textH >= 0.045, hues: mid3.hues <= 3,
    motion: motion > 3, ready, noErr: errs.length === 0
  };
  const pass = Object.values(checks).every(Boolean);
  rows.push({ n: t.n, ...mid3, motion, errs: errs.slice(0, 2), fail: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(','), sheet: rel, pass });
  console.log(`${t.n} ${pass ? 'PASS' : 'WARN'}  对比度 ${mid3.contrast}  墨量 ${mid3.ink}  字高 ${mid3.textH}  留白 ${mid3.blank}  色相 ${mid3.hues}  帧差 ${motion}  ${pass ? '' : '✗ ' + rows[rows.length-1].fail}${errs.length ? '  EXC:' + errs[0] : ''}`);
}
console.log('编号 | 结论 | 对比度 | 墨量 | 字高 | 留白 | 色相 | 帧差 | 截图');
for (const r of rows) console.log(`${r.n} | ${r.pass ? 'PASS' : 'WARN'} | ${r.contrast} | ${r.ink} | ${r.textH} | ${r.blank} | ${r.hues} | ${r.motion} | ${r.sheet}`);
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
