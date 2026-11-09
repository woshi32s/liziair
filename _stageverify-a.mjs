/**
 * A 组（字形与排版）形态验收：无头 Chrome + CDP。
 * 用法：
 *   node _stageverify-a.mjs 200-209        # 按编号段跑
 *   node _stageverify-a.mjs 200 201 205    # 指定几个
 * 每个形态：
 *   1) 打开 /stages/<NNN>-*.html，等 ready（自带 body 里也发一次）
 *   2) 真 init（6 句中文 + 主色 + 曲目）→ 断言 2s 内 ready、lines/idx/t 正常
 *   3) tick 推进 → idx 前进；跳 5s → 无异常；空歌词 init → 不崩
 *   4) rAF 采样 3s：报告每帧 JS 耗时中位/p95 + 帧间隔中位/p95
 *   5) 截图 shots/review/batch-a-<NNN>.png（1440×900）
 *   6) 0 console error / 0 未捕获异常 / 0 外部请求
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const DIR = ROOT + '/public/stages';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = ROOT + '/shots/review';
fs.mkdirSync(SHOTS, { recursive: true });

/* ---------- 参数：编号列表 ---------- */
const argv = process.argv.slice(2);
let wants = [];
for (const a of argv) {
  const m = /^(\d{3})-(\d{3})$/.exec(a);
  if (m) { for (let i = +m[1]; i <= +m[2]; i++) wants.push(String(i)); }
  else if (/^\d{3}$/.test(a)) wants.push(a);
}
if (!wants.length) wants = ['200', '201', '202', '203', '204', '205', '206', '207', '208', '209'];

const files = fs.readdirSync(DIR).filter((f) => /^\d{3}-.+\.html$/.test(f));
const pick = [];
for (const w of wants) {
  const f = files.filter((x) => x.startsWith(w + '-')).sort()[0];
  if (f) pick.push({ no: w, file: f });
  else console.log('!! 缺少编号 ' + w);
}
if (!pick.length) { console.log('没有可跑的形态'); process.exit(1); }

/* ---------- Chrome ---------- */
const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port;
await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'sa-verify-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP,
  '--hide-scrollbars', '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(250); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
const exceptions = [];
const netUrls = new Set();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(((d.exception && (d.exception.description || d.exception.value)) || d.text || '').slice(0, 300));
  }
  if (m.method === 'Network.requestWillBeSent') netUrls.add(m.params.request.url);
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++msgId;
  pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('cdp timeout ' + method)); } }, 30000);
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    exceptions.push('EVAL: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || '').slice(0, 300));
    return null;
  }
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* 文档一开始就装：导航时刻、ready 时刻、rAF 采样器 */
const BOOT = `(() => {
  window.__navAt = performance.now();
  window.__readyAt = 0;
  window.__jt = [];
  window.__gap = [];
  window.__err = [];
  window.addEventListener('error', (e) => window.__err.push(String(e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) => window.__err.push('rej:' + String(e.reason)));
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.__c100 === 1 && d.type === 'ready' && !window.__readyAt) window.__readyAt = performance.now();
  });
  const RAF = window.requestAnimationFrame.bind(window);
  let last = 0;
  window.__sampling = false;
  window.requestAnimationFrame = function (cb) {
    return RAF(function (ts) {
      const t0 = performance.now();
      try { cb(ts); } finally {
        const t1 = performance.now();
        if (window.__sampling) {
          window.__jt.push(t1 - t0);
          if (last) window.__gap.push(ts - last);
          last = ts;
        }
      }
    });
  };
})();`;

const LYRICS = [
  '当自我磨平了轮廓',
  '才看清里面的光',
  '风吹过所有的名字',
  '而我在原地等了很久',
  '直到夜色把一切收走',
  '把所有的路都还给沉默的远方'
];

const feed = (t0) => `(() => {
  const texts = ${JSON.stringify(LYRICS)};
  const lines = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const chars = [];
    for (let k = 0; k < text.length; k++) {
      chars.push({ t: +(i * 2.6 + k * 0.18).toFixed(3), d: 0.18, c: text[k] });
    }
    lines.push({ t: +(i * 2.6).toFixed(2), dur: 2.6, text, chars });
  }
  window.__lines = lines;
  window.postMessage({ __c100: 1, type: 'init', payload: {
    lines,
    accent: [138, 200, 224],
    song: { title: '夜航', artist: 'LIZI', cover: '', duration: 210 },
    duration: 210
  } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__T = ${t0};
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*');
  window.__tk = setInterval(() => {
    window.__T += 0.066;
    window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*');
  }, 66);
  return 1;
})()`;

const st = () => ev('window.__stage ? window.__stage() : null');
const advance = (sec) => ev(`(() => {
  if (!window.__tk) return 0;
  window.__T += ${sec};
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*');
  return window.__T;
})()`);
const pause = () => ev(`(() => {
  clearInterval(window.__tk); window.__tk = 0;
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: false } }, '*');
  return window.__T;
})()`);
const empty = () => ev(`(() => {
  if (window.__tk) { clearInterval(window.__tk); window.__tk = 0; }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines: [], accent: [120, 200, 210], song: { title: '无词', artist: '', cover: '' } } }, '*');
  return 1;
})()`);

const median = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[(b.length / 2) | 0]; };
const p95 = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * 0.95))]; };

const rows = [];
let hardFail = 0;
for (const item of pick) {
  consoleErrors.length = 0; exceptions.length = 0; netUrls.clear();
  await send('Page.addScriptToEvaluateOnNewDocument', { source: BOOT });
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${item.file}?verify=1` });
  /* 等 ready（最多 3s） */
  let readyMs = -1;
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    const r = await ev('window.__readyAt || 0');
    if (r) { readyMs = Math.round(r); break; }
  }
  const bootErr = await ev('(window.__err||[]).slice(0,4)');

  await sleep(150);
  await ev(feed(0.2));
  await sleep(1700);
  const s1 = await st();

  /* rAF 采样 3s（此时正在放第一句） */
  await ev('window.__jt = []; window.__gap = []; window.__sampling = true');
  await sleep(3000);
  await ev('window.__sampling = false');
  const jt = await ev('window.__jt.slice()') || [];
  const gap = await ev('window.__gap.slice()') || [];

  /* tick 推进 → idx 要变 */
  await advance(3.0);
  await sleep(260);
  const s2 = await st();
  const idxMoved = !!(s1 && s2 && s2.idx > s1.idx);

  /* 跳 5 秒 */
  const jumpT = await advance(5.0);
  await sleep(500);
  const s3 = await st();

  /* 暂停：画面必须冻住（两帧之间的 __stage().t 不再变化） */
  await pause();
  const tp1 = await ev('window.__stage ? window.__stage().t : -1');
  await sleep(700);
  const tp2 = await ev('window.__stage ? window.__stage().t : -1');
  const frozen = Math.abs((tp2 || 0) - (tp1 || 0)) < 0.05;

  /* 截图：回到第 2 句，进入 0.9s，动画铺开 */
  await ev(`(() => { if (window.__tk) clearInterval(window.__tk); window.__tk = 0;
    window.__T = 3.5;
    window.postMessage({ __c100: 1, type: 'tick', payload: { time: 3.5, playing: true } }, '*');
    window.__T = 4.4;
    window.postMessage({ __c100: 1, type: 'tick', payload: { time: 4.4, playing: true } }, '*');
    return 1; })()`);
  await sleep(950);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const outPng = `${SHOTS}/batch-a-${item.no}.png`;
  fs.writeFileSync(outPng, Buffer.from(shot.data, 'base64'));

  /* 空歌词 init：不许崩 */
  await empty();
  await sleep(700);
  const s4 = await st();
  const errAfterEmpty = await ev('(window.__err||[]).slice(0,4)');

  /* resize + DPR2 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 700, deviceScaleFactor: 2, mobile: false });
  await sleep(600);
  await ev(`window.postMessage({ __c100: 1, type: 'tick', payload: { time: 12.0, playing: true } }, '*')`);
  await sleep(400);
  const s5 = await st();
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /* 外部请求检查（同源的 /stages /api 之外都算） */
  const ext = [...netUrls].filter((u) => !u.startsWith(`http://127.0.0.1:${APP}/`) && !u.startsWith('data:') && !u.startsWith('blob:'));

  const errs = [...consoleErrors, ...exceptions, ...(bootErr || []), ...(errAfterEmpty || [])];
  const uniqErrs = [...new Set(errs.map((s) => String(s).slice(0, 160)))].filter(Boolean);

  const okReady = readyMs > 0 && readyMs <= 2000;
  const okState = !!(s1 && s1.lines === LYRICS.length && s1.idx >= 0 && s1.t > 0);
  const okEmpty = !!s4 && s4.lines === 0;
  const okDpr = s5 !== null;
  const medJS = median(jt), p95JS = p95(jt);
  const medGap = median(gap), p95Gap = p95(gap);
  const ok = okReady && okState && idxMoved && frozen && okEmpty && okDpr && uniqErrs.length === 0;

  rows.push({
    no: item.no, file: item.file, readyMs, ok, okReady, okState, idxMoved, frozen, okEmpty, okDpr,
    med: +medJS.toFixed(2), p95: +p95JS.toFixed(2), medGap: +medGap.toFixed(1), p95Gap: +p95Gap.toFixed(1),
    frames: jt.length, errs: uniqErrs, ext: ext.length, png: outPng.replace(ROOT + '/', ''),
    idx: s1 ? s1.idx : '?', t1: s1 ? s1.t : '?', t3: s3 ? s3.t : '?', jumpT
  });
  if (!ok) hardFail++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${item.no} ${item.file}  ready=${readyMs}ms  js med=${medJS.toFixed(2)} p95=${p95JS.toFixed(2)}  gap med=${medGap.toFixed(1)} p95=${p95Gap.toFixed(1)}  idxMove=${idxMoved} frozen=${frozen} empty=${okEmpty} dpr=${okDpr} ext=${ext.length}`);
  if (uniqErrs.length) console.log('    ERR:', uniqErrs.slice(0, 5));
}

fs.writeFileSync(ROOT + '/_stageverify-a.json', JSON.stringify(rows, null, 2));
console.log('\n---- 汇总 ----');
for (const r of rows) {
  console.log(`${r.no} | ${r.file.replace(/^\d+-/, '').replace('.html', '')} | ready ${r.readyMs} | js ${r.med}/${r.p95} | gap ${r.medGap}/${r.p95Gap} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.png}`);
}
console.log(hardFail ? `\n${hardFail} 个不合格` : '\n全部通过');

ws.close();
chrome.kill();
await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch { }
