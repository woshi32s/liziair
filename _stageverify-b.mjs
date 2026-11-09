/**
 * _stageverify-b.mjs —— B 组（材质与光影）验收：210-219 与 240-249
 * 无头 Chrome + CDP，端口读 .port；逐个体检：
 *   ready(<2s) / __stage / tick 推进 idx / 跳 5 秒 / 空歌词 init / 0 console error
 *   3s rAF 采样（帧间隔 + 每帧 JS）/ 截图 1440x900 → shots/review/batch-b-<NNN>.png
 * 用法：
 *   node _stageverify-b.mjs         → 默认测本批 249 + 270-279
 *   node _stageverify-b.mjs 27      → 只测 270-279
 *   node _stageverify-b.mjs 249     → 只测某一个
 *   node _stageverify-b.mjs 24 27   → 测 240-249 与 270-279
 *   node _stageverify-b.mjs 21      → 测上一批 210-219
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const BASE = `http://127.0.0.1:${APP}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(ROOT, 'shots/review');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 选文件 ---------------- */
const only = process.argv.slice(2).length ? process.argv.slice(2) : ['249', '270', '271', '272', '273', '274', '275', '276', '277', '278', '279'];
const files = fs.readdirSync(path.join(ROOT, 'public/stages'))
  .filter((f) => /^(21|24|27)[0-9]-[a-z0-9-]+\.html$/.test(f))
  .filter((f) => only.some((p) => f.startsWith(p)))
  .sort();
if (!files.length) { console.error('没有找到编号前缀 ' + only.join('/') + ' 的 stage 文件（B 组：210-219 / 240-249 / 270-279）'); process.exit(1); }
console.log('待测：' + files.join(' '));

/* ---------------- 起浏览器 ---------------- */
const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP_PORT = srv.address().port;
await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-verify-b-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP_PORT, '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(250); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pend = new Map();
let consoleErrors = [], exceptions = [], netFails = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id); pend.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Log.entryAdded') {
    const t = m.params.entry;
    const txt = (t.text || '') + ' @' + (t.url || '');
    if (t.level === 'error' && !/favicon/i.test(txt)) consoleErrors.push(txt.slice(0, 240));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const txt = (m.params.args || []).map((a) => String(a.value ?? a.description ?? '')).join(' ');
    if (!/favicon/i.test(txt)) consoleErrors.push('console.error: ' + txt.slice(0, 240));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 240));
  }
  if (m.method === 'Network.loadingFailed') netFails.push(m.params.errorText + ' ' + (m.params.requestId || ''));
  if (m.method === 'Network.requestWillBeSent' && !/^(data|blob|about):/.test(m.params.request.url)) {
    if (!m.params.request.url.startsWith(BASE)) netFails.push('外部请求: ' + m.params.request.url.slice(0, 120));
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pend.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __exc: ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 240) };
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable').catch(() => {});
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

/* 每次导航前注入：捕获 ready 时刻 + 消息日志 */
const HOOK = `
  window.__msgs = []; window.__readyAt = 0; window.__nframes = 0;
  addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__c100 !== 1) return;
    window.__msgs.push({ t: d.type, at: Math.round(performance.now()) });
    if (d.type === 'ready') window.__readyAt = Math.round(performance.now());
  }, true);
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });

/* ---------------- 种子歌词 ---------------- */
const TEXTS = ['把光折进纸里', '才看见纤维在呼吸', '每一道压痕都记得', '谁的手曾经按在这里', '等风把灰吹走'];
function seedLines(gap = 2.4) {
  const lines = [];
  for (let i = 0; i < TEXTS.length; i++) {
    const text = TEXTS[i];
    const chars = [];
    let acc = 0;
    for (let k = 0; k < text.length; k++) {
      const d = /[\u4e00-\u9fff]/.test(text[k]) ? 0.20 : 0.09;
      chars.push({ t: +(i * gap + acc).toFixed(3), d: d, c: text[k] });
      acc += d;
    }
    lines.push({ t: +(i * gap).toFixed(3), dur: gap, text: text, chars: chars });
  }
  return lines;
}
const ACCENT = [212, 184, 148];

const INIT = (lines, accent = ACCENT) => `(() => {
  window.postMessage({ __c100: 1, type: 'init', payload: {
    lines: ${JSON.stringify(lines)}, accent: ${JSON.stringify(accent)},
    song: { id: 1, name: '验收曲', artists: [{ name: 'B 组' }], duration: 240, cover: '' }
  } }, '*');
  return 1;
})()`;

/* 以 15Hz 推进 tick 的页面内驱动器 */
const DRIVER = (from) => `(() => {
  if (window.__tk) clearInterval(window.__tk);
  window.__T = ${from};
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*');
  window.__tk = setInterval(function () {
    window.__T += 0.066;
    window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*');
  }, 66);
  return window.__T;
})()`;
const FREEZE = `(() => {
  if (window.__tk) clearInterval(window.__tk);
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: false } }, '*');
  return window.__T;
})()`;

const results = [];
for (const file of files) {
  const num = file.slice(0, 3);
  consoleErrors = []; exceptions = []; netFails = [];
  const url = `${BASE}/stages/${file}?v=${Date.now()}`;
  const r = { file, num, name: file.replace(/^\d+-/, '').replace(/\.html$/, '') };

  await send('Page.navigate', { url });
  /* 等 ready */
  let ready = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    ready = await ev('window.__readyAt || 0');
    if (typeof ready === 'number' && ready > 0) break;
    ready = 0;
  }
  r.ready = ready;
  await sleep(250);

  /* ---- init 真实歌词 ---- */
  const lines = seedLines();
  await ev(INIT(lines));
  await sleep(180);
  const st0 = await ev('window.__stage ? window.__stage() : null');
  r.stageAfterInit = st0;
  r.linesOk = !!(st0 && st0.lines === lines.length);

  /* ---- tick 推进到第一句中间 + 第二句 ---- */
  await ev(DRIVER(0.05));
  await ev('window.__T');
  await sleep(1500);
  const st1 = await ev('window.__stage()');
  r.idx0 = st1 ? st1.idx : -1;
  r.t1 = st1 ? st1.t : -1;
  /* 直接推到 2.6s（第二句） */
  await ev(`window.__T = 2.62; window.postMessage({ __c100: 1, type: 'tick', payload: { time: 2.62, playing: true } }, '*'); 1`);
  await sleep(400);
  const st2 = await ev('window.__stage()');
  r.idx1 = st2 ? st2.idx : -1;
  r.idxAdvanced = st1 && st2 && st2.idx > st1.idx;

  /* ---- seek：跳 5 秒 ---- */
  const jumpTo = 8.4;
  await ev(`window.__T = ${jumpTo}; window.postMessage({ __c100: 1, type: 'tick', payload: { time: ${jumpTo}, playing: true } }, '*'); 1`);
  await sleep(500);
  const st3 = await ev('window.__stage()');
  r.idxSeek = st3 ? st3.idx : -1;
  r.seekOk = !!(st3 && st3.idx >= 3 && !st3.err);
  r.seekFrames = st3 ? st3.frames : 0;

  /* ---- 3s rAF 采样（带 tick，正常播放） ---- */
  await ev(`(() => {
    window.__samp = { iv: [], js: [], n: 0 };
    var p = 0;
    function tk(ms) {
      if (window.__samp.n++ > 260) return;
      if (p) { window.__samp.iv.push(+(ms - p).toFixed(2)); }
      p = ms;
      var s = window.__stage && window.__stage();
      if (s) window.__samp.js.push(s.js);
      requestAnimationFrame(tk);
    }
    requestAnimationFrame(tk);
    return 1;
  })()`);
  await sleep(3200);
  const samp = await ev('window.__samp');
  const iv = (samp && samp.iv) || [];
  const js = (samp && samp.js) || [];
  const q = (arr, p) => { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); return +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2); };
  r.n = iv.length;
  r.median = q(iv, 0.5); r.p95 = q(iv, 0.95);
  r.jsMedian = q(js, 0.5); r.jsP95 = q(js, 0.95);
  r.jsMax = js.length ? +Math.max.apply(null, js).toFixed(2) : 0;

  /* ---- 空歌词 init：不崩 ---- */
  await ev(`window.__T = 0; 1`);
  await ev(INIT([]));
  await sleep(400);
  const st4 = await ev('window.__stage()');
  r.emptyOk = !!(st4 && st4.lines === 0 && st4.err === '');

  /* ---- 暂停冻结：playing:false 后 600ms，两帧应当逐字节一致 ---- */
  await ev(INIT(lines));
  await sleep(100);
  await ev(DRIVER(1.2));
  await sleep(900);
  await ev(FREEZE);
  await sleep(1400);   /* 让"压下"的过渡收敛 */
  await ev(`window.__h2 = () => { const c = document.getElementById('c'); const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data; let h = 0;
    for (let i = 0; i < d.length; i += 613) h = (h * 31 + d[i]) | 0; return h; }; 1`);
  const hA = await ev('window.__h2()');
  const tA = await ev('window.__stage().t');
  const shotA = await send('Page.captureScreenshot', { format: 'png' });
  await sleep(700);
  const hB = await ev('window.__h2()');
  const tB = await ev('window.__stage().t');
  const shotB = await send('Page.captureScreenshot', { format: 'png' });
  r.tA = tA; r.tB = tB; r.hA = hA; r.hB = hB;
  r.tStable = tA === tB;
  r.hStable = hA === hB;
  r.frozen = (shotA.data === shotB.data) || (r.tStable && r.hStable);
  r.frozenPix = shotA.data === shotB.data;

  /* ---- resize：换到 1200×760 再回来，不许崩 ---- */
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 760, deviceScaleFactor: 2, mobile: false });
  await sleep(700);
  const stR = await ev('window.__stage()');
  r.resizeOk = !!(stR && stR.err === '' && stR.glyph !== false);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(700);

  /* ---- prefers-reduced-motion：切到 reduce，不崩、还在出帧 ---- */
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(500);
  const f0 = await ev('window.__stage().frames');
  await sleep(400);
  const st5r = await ev('window.__stage()');
  r.rmOk = !!(st5r && st5r.err === '' && f0 > 0 && st5r.frames > f0);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await sleep(300);

  /* ---- 重新 init 真歌词，停在一个"唱到第二句 1.5s"的位置截图 ---- */
  await ev(INIT(lines));
  await sleep(120);
  await ev(DRIVER(2.4));
  await sleep(1100);
  await ev('window.__T = 3.9; window.postMessage({ __c100: 1, type: "tick", payload: { time: 3.9, playing: true } }, "*"); 1');
  await sleep(700);
  await ev(FREEZE);
  await sleep(320);
  const st5 = await ev('window.__stage()');
  r.shotIdx = st5 ? st5.idx : -1;
  r.shotText = st5 ? st5.text : '';

  fs.mkdirSync(OUT, { recursive: true });
  const png = path.join(OUT, `batch-b-${num}.png`);
  const cap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(png, Buffer.from(cap.data, 'base64'));
  r.shot = `shots/review/batch-b-${num}.png`;
  r.shotBytes = fs.statSync(png).size;

  r.consoleErrors = consoleErrors.slice();
  r.exceptions = exceptions.slice();
  r.netFails = netFails.filter((x) => !/favicon/i.test(x)).slice();
  r.stageFinal = st5;
  r.ok = r.ready > 0 && r.ready < 2000 && r.linesOk && r.idxAdvanced && r.seekOk &&
    r.emptyOk && r.frozen && r.resizeOk && r.rmOk &&
    r.consoleErrors.length === 0 && r.exceptions.length === 0 &&
    r.jsP95 <= 8 && r.n > 30;
  results.push(r);
  console.log(`${num} ${r.ok ? 'OK  ' : 'FAIL'} ready=${r.ready}ms idx0=${r.idx0} idx1=${r.idx1} seek=${r.idxSeek} ` +
    `iv=${r.median}/${r.p95} js=${r.jsMedian}/${r.jsP95}(max ${r.jsMax}) err=${r.consoleErrors.length} exc=${r.exceptions.length}` +
    (r.ok ? '' : '\n     ' + JSON.stringify({ linesOk: r.linesOk, adv: r.idxAdvanced, seekOk: r.seekOk, emptyOk: r.emptyOk, frozen: r.frozen, tA: r.tA, tB: r.tB, hA: r.hA, hB: r.hB, frozenPix: r.frozenPix, resizeOk: r.resizeOk, rmOk: r.rmOk, net: r.netFails, ce: r.consoleErrors, ex: r.exceptions })));
}

/* ---------------- 汇总 ---------------- */
console.log('\n| 编号 | 名称 | ready(ms) | 中位帧(ms) | p95(ms) | JS中位 | JS p95 | 截图 | 结论 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.num} | ${r.name} | ${r.ready} | ${r.median} | ${r.p95} | ${r.jsMedian} | ${r.jsP95} | ${r.frozen ? 'ok' : 'NO'} | ${(r.shotText || '').length} | ${r.shot} | ${r.ok ? 'PASS' : 'FAIL'} |`);
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 通过`);
if (bad.length) console.log('未通过:', bad.map((b) => b.num).join(', '));
fs.writeFileSync(path.join(ROOT, '_stageverify-b.json'), JSON.stringify(results, null, 2));

ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
