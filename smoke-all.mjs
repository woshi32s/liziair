/**
 * 全量冒烟：逐个加载每个形态，喂歌词，检查运行时错误 + 帧率 + 画面是否真的在动。
 *
 * 为什么需要它：子代理只做了**语法检查**，语法过不等于运行时不出错
 * （1-10 里就踩过 "Cannot access 'CS' before initialization" 这种）。
 * 这里按 1-10 的验收标准过一遍：零报错 + 有帧率 + 画布不是全黑。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const DIR = 'E:/DSHdesktop/work/music-player/public/stages';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const only = process.argv[2];                 // 可选：只测某些前缀，如 "01"
const files = fs.readdirSync(DIR).filter((f) => /^\d{3}-.+\.html$/.test(f)).sort()
  .filter((f) => !only || f.startsWith(only));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-all-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pending = new Map(); let errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push((d.exception && d.exception.description || d.text || '').split('\n')[0].slice(0, 120));
  }
};
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout'))), 60000);
});
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 90);
  return r.result.value;
};

await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__BEAT_SILENT = true' });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });

/* 喂 30 句，每 2.4 秒一句；带 chars 让它和真实数据一致 */
const FEED = `(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','而我在原地等了很久','直到夜色把一切收走'];
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const text = texts[i % texts.length];
    const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: i * 2.4 + k * 0.22, d: 0.22, c: text[k] });
    lines.push({ t: i * 2.4, dur: 2.4, text, chars });
  }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255] } }, '*');
  let t = 0;
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => {
    t += 0.066;
    window.postMessage({ __c100: 1, type: 'tick', payload: { time: t, playing: true } }, '*');
    if (Math.random() < 0.06) window.postMessage({ __c100: 1, type: 'beat', payload: { level: 0.7, bpm: 120 } }, '*');
  }, 66);
  return 1;
})()`;

const rows = [];
console.log('形态'.padEnd(34) + 'fps     画面        报错');
console.log('-'.repeat(96));

for (const f of files) {
  errs = [];
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${f}` });
  await sleep(1400);
  const feedRes = await ev(FEED);
  await sleep(5200);

  const fps = await ev(`new Promise((res) => {
    const ts = []; let last = performance.now(); const t0 = last;
    function f() { const n = performance.now(); ts.push(n - last); last = n;
      if (n - t0 < 2000) requestAnimationFrame(f);
      else { const a = ts.slice(3).sort((x,y)=>x-y); res(+(1000 / (a.reduce((p,q)=>p+q,0)/a.length)).toFixed(1)); } }
    requestAnimationFrame(f);
  })`);

  /* 画面有没有在动：采样两次画布像素，比差异 */
  const motion = await ev(`new Promise((res) => {
    const c = document.getElementById('c') || document.querySelector('canvas');
    if (!c) return res('无画布');
    const g = c.getContext('2d');
    if (!g) return res('无 2d 上下文');
    const snap = () => { try { return g.getImageData(0,0,c.width,c.height).data; } catch(e){ return null; } };
    const a = snap();
    if (!a) return res('取不到像素');
    setTimeout(() => {
      const b = snap();
      if (!b) return res('取不到像素');
      let diff = 0, bright = 0;
      for (let i = 0; i < a.length; i += 4000) {
        if (a[i] + a[i+1] + a[i+2] > 90) bright++;
        if (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]) > 12) diff++;
      }
      res((bright > 6 ? '有内容' : '★全黑') + '/' + (diff > 4 ? '在动' : '★静止'));
    }, 700);
  })`);

  const errStr = errs.length ? errs.slice(0, 2).join(' ; ') : '无';
  const flag = (errs.length || String(motion).includes('★') || Number(fps) < 25) ? '  <<<' : '';
  rows.push({ f, fps, motion, err: errStr, flag });
  console.log(f.padEnd(34) + String(fps).padEnd(8) + String(motion).padEnd(12) + errStr + flag);
}

const bad = rows.filter((r) => r.flag);
console.log('');
console.log('共 ' + rows.length + ' 个，需要关注的 ' + bad.length + ' 个');
if (bad.length) for (const r of bad) console.log('  ' + r.f + '  fps=' + r.fps + '  ' + r.motion + '  ' + r.err);

ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}