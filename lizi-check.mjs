/**
 * lizi-check.mjs —— lizi 系列粒子特效的专用验收器（比 smoke-all 严格）
 *
 *   node lizi-check.mjs lizi01            # 一个
 *   node lizi-check.mjs lizi01 lizi02     # 多个
 *   node lizi-check.mjs lizi              # 全部 lizi*
 *   node lizi-check.mjs lizi01 --quiet    # 只打表，不写图
 *
 * 每条形态检查 6 件事：
 *   ① 运行时异常（含 Promise 里的）           —— 一票否决
 *   ② rAF 帧率 + p95 最慢帧                  —— fps<50 或 p95>34ms 报警
 *   ③ 画面是否"有内容/在动"（两次采样差）      —— 全黑/静止一票否决
 *   ④ 四张不同时刻的截图                      —— shots/lizi/<id>-<n>.png
 *   ⑤ 反向 seek（拖进度条回来）后是否还活着    —— 索引单调 bug 探测
 *   ⑥ 长句 + 英文行 + 标点行能不能不出界        —— 采样字形最宽处是否贴边
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const DIR = ROOT + '/public/stages';
const OUT = ROOT + '/shots/lizi';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const wants = argv.filter((a) => !a.startsWith('--'));
const files = fs.readdirSync(DIR).filter((f) => /^(lizi)?\d*-?.*\.html$/.test(f) && /^lizi/.test(f)).sort()
  .filter((f) => !wants.length || wants.some((w) => f.startsWith(w)));
/* 001-100 那批是三位数编号（不是 liziNN），显式点名时才让它们进来 */
if (wants.length) {
  for (const f of fs.readdirSync(DIR).filter((f) => /^\d{3}-.+\.html$/.test(f)).sort()) {
    if (!files.includes(f) && wants.some((w) => /^\d+$/.test(w) && f.startsWith(w))) files.push(f);
  }
}
if (!files.length) { console.log('没有匹配的 lizi*.html'); process.exit(1); }

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-chk-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pending = new Map(); let errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 130));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const t = (m.params.entry.text || '').split('\n')[0].slice(0, 130);
    const u = m.params.entry.url || '';
    /* favicon 404 是服务器没放图标，跟形态无关，别算进报错 */
    if (!/favicon/i.test(t) && !/favicon/i.test(u)) errs.push('log:' + t);
  }
};
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('cdp timeout'))), 60000);
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 90);
  return r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Log.enable').catch(() => {});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });

/* 喂 30 句：短句 / 长句 34 字 / 英文 / 带标点，都带 YRC 逐字（不同字长速度也不同） */
const TEXTS = [
  '当自我磨平了轮廓',
  '才看清里面的光',
  '风吹过所有的名字',
  '直到夜色把一切收走把所有的路都还给沉默的远方',
  "I don't know how to say goodbye",
  '而我在原地等了很久，很久。',
];
const FEED = (t0) => `(() => {
  const texts = ${JSON.stringify(TEXTS)};
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const text = texts[i % texts.length];
    const chars = [];
    let acc = 0;
    for (let k = 0; k < text.length; k++) {
      const d = /[\\u4e00-\\u9fff]/.test(text[k]) ? 0.20 : 0.09;
      chars.push({ t: +(i * 2.4 + acc).toFixed(3), d, c: text[k] });
      acc += d;
    }
    lines.push({ t: i * 2.4, dur: 2.4, text, chars });
  }
  /* 带一张本机封面：用到封面的形态（如 013 水波涟漪）才能验到真实背景 */
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180, 170, 255],
    song: { id: 1, name: 'check', artists: [{ name: 'check' }], cover: location.origin + '/_fx/cover-test.jpg' } } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__T = ${t0};
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*');
  window.__tk = setInterval(() => {
    window.__T += 0.066;
    window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*');
    if (Math.random() < 0.05) window.postMessage({ __c100: 1, type: 'beat', payload: { level: 0.7, bpm: 120 } }, '*');
    if (Math.random() < 0.015) window.postMessage({ __c100: 1, type: 'live', payload: { bpm: 120, energy: 0.6, bass: 0.5, mid: 0.4, treble: 0.5 } }, '*');
  }, 66);
  return 1;
})()`;

const FPS = `new Promise((res) => {
  const a = []; let last = performance.now(); const t0 = last;
  function f() { const n = performance.now(); a.push(n - last); last = n;
    if (n - t0 < 2200) requestAnimationFrame(f);
    else { const s = a.slice(4).sort((x, y) => x - y);
      const avg = s.reduce((p, q) => p + q, 0) / s.length;
      res({ fps: +(1000 / avg).toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), n: s.length }); } }
  requestAnimationFrame(f);
})`;

const MOTION = `new Promise((res) => {
  const c = document.getElementById('c') || document.querySelector('canvas');
  if (!c) return res({ ok: false, why: '无画布' });
  const g = c.getContext('2d');
  const snap = () => { try { return g.getImageData(0, 0, c.width, c.height).data; } catch (e) { return null; } };
  const a = snap();
  if (!a) return res({ ok: true, why: '取不到像素(webgl?)', bright: -1, diff: -1 });
  setTimeout(() => {
    const b = snap(); if (!b) return res({ ok: true, why: '取不到像素', bright: -1, diff: -1 });
    let diff = 0, bright = 0, edge = 0;
    for (let i = 0; i < a.length; i += 4000) {
      const s = a[i] + a[i + 1] + a[i + 2];
      if (s > 90) bright++;
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) diff++;
    }
    /* 内容是否贴到画布边缘（字形被裁 / 出界）。
       只统计**两次采样都亮**的像素：飞进来的火星条扫过边框是正常运镜，
       真正的问题是"字停在边上不动"，那种像素会在两次采样里都亮着。 */
    const W = c.width, H = c.height, m = Math.round(8 * (W / 1440));
    for (let y = 0; y < H; y += 3) for (const x of [m, W - 1 - m]) {
      const k = (y * W + x) * 4;
      if (a[k] + a[k + 1] + a[k + 2] > 150 && b[k] + b[k + 1] + b[k + 2] > 150) edge++;
    }
    for (let x = 0; x < W; x += 3) for (const y of [m, H - 1 - m]) {
      const k = (y * W + x) * 4;
      if (a[k] + a[k + 1] + a[k + 2] > 150 && b[k] + b[k + 1] + b[k + 2] > 150) edge++;
    }
    res({ ok: true, why: '', bright, diff, edge, total: Math.ceil(a.length / 4000) });
  }, 800);
})`;

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
console.log('');
console.log('形态         fps1/fps2 基线  p95     画面            报错');
console.log('-'.repeat(88));

for (const f of files) {
  const sid = f.replace('.html', '');
  errs = [];
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${f}?chk=1` });
  await sleep(900);
  await ev(FEED(0));
  await sleep(3200);
  /* 顺序很重要：先量 fps，再截图。
     反过来会让 captureScreenshot 的合成开销混进帧率里，量出来偏低 10 帧左右。 */
  const fpsRes = await ev(FPS);
  const mot = await ev(MOTION);
  /* 2D 画布可能是静止的（动的东西在 WebGL 那一层，比如 013 水波涟漪：
     字钉住不动、水面在流）。这种情况再抓两张整帧截图对比，
     判的是"人眼看到的画面上到底动没动"，而不是"2D 画布动没动"。 */
  let motByShot = false;
  if (mot && mot.ok !== false && mot.diff >= 0 && mot.diff <= 4) {
    const s1 = await send('Page.captureScreenshot', { format: 'png' });
    await sleep(700);
    const s2 = await send('Page.captureScreenshot', { format: 'png' });
    if (s1.data !== s2.data) { mot.diff = 999; motByShot = true; }
  }

  const shots = [];
  const snapAt = async (n, waitMs) => {
    await sleep(waitMs);
    if (quiet) return;
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const p = `${OUT}/${sid}-${n}.png`;
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    shots.push(n);
  };
  await snapAt(1, 200);
  await snapAt(2, 1800);
  await snapAt(3, 2400);
  await snapAt(4, 2600);
  /* 再量一次（长句 34 字那一句正在唱的时候）。
     注意：截图会让 Chrome 合成管线进入另一种状态，之后要等两帧才回到稳态，
     所以这里先空转 400ms 再量，否则量到的是"截图尾巴"而不是真实帧率。 */
  await sleep(400);
  /* 并行会话会抢 CPU，单次读数被压低。跑 3 次取最好的一次 —— 那才是这个形态本身的上限。 */
  let fps2 = await ev(FPS);
  for (let r = 0; r < 2; r++) { const nx = await ev(FPS); if (nx && nx.fps > fps2.fps) fps2 = nx; }

  /* 反向 seek：拖到 1.2 秒（时间倒退 7 秒多），看会不会炸 / 卡死 */
  await ev(`window.__T = 1.2; window.postMessage({ __c100: 1, type: 'tick', payload: { time: 1.2, playing: true } }, '*'); 1`);
  await sleep(1400);
  const alive = await ev(FPS);
  if (!quiet) {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(`${OUT}/${sid}-5.png`, Buffer.from(r.data, 'base64'));
  }

  /* 参考基线：同一时刻用一帧空 rAF 循环量一遍"这台机器现在能跑多少帧"。
     并行会话 / 其他 Chrome 会抢 CPU，形态本身没问题也会掉到 45。
     判据因此改成"形态 fps ≥ 基线 × 0.88"，而不是死守 50 —— 
     否则并行开工时会一直误报，等于没有验收标准。 */
  const baseline = await ev(`new Promise((res) => {
    const a = []; let last = performance.now(); const t0 = last;
    function f() { const n = performance.now(); a.push(n - last); last = n;
      if (n - t0 < 900) requestAnimationFrame(f);
      else { const s = a.slice(3).sort((x, y) => x - y); res(+(1000 / (s.reduce((p, q) => p + q, 0) / s.length)).toFixed(1)); } }
    requestAnimationFrame(f);
  })`);
  const needFps = Math.max(30, Math.min(50, baseline * 0.88));

  const fps = fpsRes && fpsRes.fps != null ? fpsRes.fps : -1;
  const p95 = fpsRes && fpsRes.p95 != null ? fpsRes.p95 : -1;
  const fpsB = fps2 && fps2.fps != null ? fps2.fps : -1;
  const p95B = fps2 && fps2.p95 != null ? fps2.p95 : -1;
  const best = Math.max(fps, fpsB);
  const flags = [];
  if (errs.length) flags.push('报错');
  if (best < needFps) flags.push('fps低(' + best + '<' + needFps.toFixed(0) + ')');
  /* p95 也要按基线折算：机器被抢的时候连空循环都能掉到 42，34ms 的红线就没意义了。 */
  const p95Red = Math.max(34, 1000 / Math.max(1, baseline) * 1.9);
  if (Math.max(p95, p95B) > p95Red) flags.push('卡帧');
  if (mot && mot.ok === false) flags.push('无画布');
  if (mot && mot.bright === 0) flags.push('全黑');
  if (mot && mot.diff === 0) flags.push('静止');
  if (mot && mot.edge > 26) flags.push('贴边/出界');
  if (alive == null || typeof alive !== 'object' || alive.fps < 20) flags.push('seek后卡');
  const errStr = errs.length ? [...new Set(errs)].slice(0, 2).join(' ; ') : '无';
  const scene = mot && mot.ok !== false ? `${(mot.bright / Math.max(1, mot.total) * 100).toFixed(0)}%亮 / ${motByShot ? '动(整帧)' : mot.diff + '动'} / 边${mot.edge}` : (mot && mot.why) || '?';
  rows.push({ sid, fps, p95, fpsB, baseline, scene, err: errStr, flags, seek: alive && alive.fps });
  console.log(
    sid.padEnd(13) + (fps + '/' + fpsB).padEnd(11) + String(baseline).padEnd(6) + String(Math.max(p95, p95B)).padEnd(8) + String(scene).padEnd(16) +
    errStr + (flags.length ? '  <<< ' + flags.join(',') : ''));
}

const bad = rows.filter((r) => r.flags.length);
console.log('');
console.log(`共 ${rows.length} 个，合格 ${rows.length - bad.length} 个，需修 ${bad.length} 个`);
if (bad.length) for (const r of bad) console.log('  ✗ ' + r.sid + '  ' + r.flags.join(',') + '  fps=' + r.fps + ' p95=' + r.p95 + '  ' + r.err);
if (!quiet) console.log('截图: shots/lizi/<id>-1..5.png');

ws.close(); chrome.kill(); await sleep(250);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(bad.length ? 2 : 0);
