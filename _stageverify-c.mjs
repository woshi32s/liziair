/**
 * _stageverify-c.mjs —— C 组（空间与粒子 220–229）验收
 *
 * 对每个形态：
 *   1. 打开 → 注入真实 init（6 句中文 + 主色）→ 断言 ready 在 2s 内、__stage() 正常
 *   2. tick 推进 → idx 前进；跳 5 秒 → 状态重建、无异常
 *   3. 空歌词 init → 不崩
 *   4. 0 console error / 0 未捕获异常
 *   5. rAF 采样 3s → 帧间隔中位/p95 + 每帧 JS 执行时间中位/p95（包装 requestAnimationFrame 实测）
 *   6. 1440×900 截图 → shots/review/batch-c-<NNN>.png
 *
 * 用法: node _stageverify-c.mjs [220 221 ...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const DIR = path.join(ROOT, 'public/stages');
const OUT = path.join(ROOT, 'shots/review');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wants = process.argv.slice(2).filter((a) => /^\d{3}$/.test(a));
const files = fs.readdirSync(DIR).filter((f) => /^2[2-8]\d-.+\.html$/.test(f)).sort()
  .filter((f) => !wants.length || wants.includes(f.slice(0, 3)));

fs.mkdirSync(OUT, { recursive: true });

/* ---------------- Chrome / CDP ---------------- */
const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP_PORT = srv.address().port;
await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-vc-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--no-first-run', '--mute-audio', '--hide-scrollbars',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--enable-unsafe-swiftshader',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP_PORT,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

for (let i = 0; i < 60; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; }
  catch { await sleep(250); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  } else if (m.method) events.push(m);
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++msgId; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('cdp timeout: ' + method)); } }, 30000);
});

const INJECT = `
window.__c = { ready: 0, readyAt: 0, errs: [], msgs: 0 };
window.addEventListener('message', function (e) {
  var d = e.data; if (!d || d.__c100 !== 1) return;
  window.__c.msgs++;
  if (d.type === 'ready' && !window.__c.ready) { window.__c.ready = 1; window.__c.readyAt = performance.now(); }
});
window.addEventListener('error', function (e) { window.__c.errs.push('onerror: ' + (e.message || e.type)); });
window.addEventListener('unhandledrejection', function (e) { window.__c.errs.push('reject: ' + String(e.reason)); });
/* 实测每帧 JS 执行时间：包装 rAF，只统计形态自己注册的回调 */
window.__js = [];
(function () {
  var raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf(function (ts) {
      if (typeof cb !== 'function') return;
      var a = performance.now();
      try { cb(ts); } finally {
        var d = performance.now() - a;
        if (window.__js.length < 5000) window.__js.push(d);
      }
    });
  };
  window.__rawRaf = raf;
})();
window.__drive = function (startT) {
  window.__t = startT;
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(function () {
    window.__t += 0.066;
    postMessage({ __c100: 1, type: 'tick', payload: { time: window.__t, playing: true } }, '*');
  }, 66);
};
window.__setT = function (t) {
  window.__t = t;
  postMessage({ __c100: 1, type: 'tick', payload: { time: t, playing: true } }, '*');
};
window.__pauseT = function () { if (window.__tk) { clearInterval(window.__tk); window.__tk = 0; } };
`;

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    return { __exc: (d.exception && d.exception.description) || d.text || 'exception' };
  }
  return r.result.value;
};

/* 真实 init：6 句中文 + 逐字时间 */
const LYRICS = [
  '当自我磨平了轮廓',
  '才看清里面的光',
  '风吹过所有的名字',
  '而我在原地等了很久',
  '把黑夜折成一条船',
  '沿着星轨慢慢漂走',
];
function makePayload(withLyrics) {
  const lines = [];
  if (!withLyrics) return { lines: [], accent: [122, 176, 255], song: { title: '纯音乐', artist: '', cover: '' } };
  let t = 0;
  for (let i = 0; i < LYRICS.length; i++) {
    const text = LYRICS[i];
    const dur = 3.2;
    const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: +(t + k * (dur * 0.8) / Math.max(1, text.length - 1)).toFixed(3), d: 0.2, c: text[k] });
    lines.push({ t: +t.toFixed(3), dur: dur, text: text, chars: chars });
    t += dur;
  }
  return { lines, accent: [122, 176, 255], song: { title: '夜航', artist: 'LIZI', cover: '' }, duration: 40 };
}

function stats(arr) {
  if (!arr.length) return { n: 0, med: 0, p95: 0, max: 0 };
  const a = arr.slice().sort((x, y) => x - y);
  const q = (p) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  return { n: a.length, med: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +a[a.length - 1].toFixed(2) };
}

const results = [];
for (const f of files) {
  const num = f.slice(0, 3);
  const name = f.replace(/^\d{3}-/, '').replace('.html', '');
  events.length = 0;
  const errs = [];
  const t0 = Date.now();

  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${f}` });
  /* 等 ready */
  let readyMs = -1;
  for (let i = 0; i < 80; i++) {
    const st = await ev('window.__c ? {r: window.__c.ready, at: window.__c.readyAt} : null');
    if (st && st.r) { readyMs = Math.round(Date.now() - t0); break; }
    await sleep(50);
  }
  await sleep(250);
  const stage0 = await ev('typeof window.__stage === "function" ? window.__stage() : null');

  /* init + 驱动 */
  await ev(`postMessage({__c100:1,type:'init',payload:${JSON.stringify(makePayload(true))}},'*')`);
  await ev('window.__drive(0)');
  await sleep(700);
  const stA = await ev('window.__stage()');

  /* 采样 3s：帧间隔 + 每帧 JS */
  const sample = await ev(`new Promise(function(res){
    window.__js.length = 0;
    var iv = [], last = 0, t0 = 0;
    var raf = window.__rawRaf;
    function step(ts){
      if (!t0) t0 = ts;
      if (last) iv.push(ts - last);
      last = ts;
      if (ts - t0 < 3000) raf(step); else res({ iv: iv, js: window.__js.slice() });
    }
    raf(step);
  })`);
  const ivStat = stats((sample && sample.iv) || []);
  const jsStat = stats((sample && sample.js) || []);

  const stA2 = await ev('window.__stage()');
  /* idx 前进：推进到 7.2s（第 3 句） */
  await ev('window.__setT(7.2)');
  await sleep(800);
  const stB = await ev('window.__stage()');

  /* 跳 5 秒 */
  await ev('window.__setT(9.8)');
  await sleep(500);
  const stC = await ev('window.__stage()');

  /* 空歌词 */
  await ev(`postMessage({__c100:1,type:'init',payload:${JSON.stringify(makePayload(false))}},'*')`);
  await sleep(600);
  const stD = await ev('window.__stage()');
  const errEmpty = await ev('window.__c.errs.length');
  await ev('window.__setT(0.4)');
  await sleep(400);
  const stE = await ev('window.__stage()');

  /* 恢复真实歌词 → 截图（落在第二句中间，字已完全成形） */
  await ev(`postMessage({__c100:1,type:'init',payload:${JSON.stringify(makePayload(true))}},'*')`);
  await ev('window.__setT(3.6)');
  await ev('window.__drive(3.6)');
  await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const shotPath = path.join(OUT, `batch-c-${num}.png`);
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

  /* 错误汇总 */
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails;
      errs.push('exception: ' + ((d.exception && d.exception.description) || d.text));
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      errs.push('console.error: ' + e.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      const u = e.params.entry.url || '';
      /* favicon 之类的取资源失败不算形态的错 */
      if (/favicon|\.ico($|\?)/i.test(u)) continue;
      errs.push('log: ' + e.params.entry.text + (u ? ' @ ' + u : ''));
    }
  }
  const inPage = (await ev('window.__c.errs.slice(0,4)')) || [];
  for (const s of inPage) errs.push(s);

  const okReady = readyMs >= 0 && readyMs < 2000;
  const okStage = stage0 && typeof stage0 === 'object';
  const okLines = stA && stA.lines === LYRICS.length;
  const okIdx = stA && stB && stB.idx > stA.idx;
  const okSeek = stC && stC.idx >= 2 && !stC.__exc;
  const okEmpty = stD && stD.lines === 0 && !stD.__exc && stE && !stE.__exc;
  const okErr = errs.length === 0;
  const okJs = jsStat.med <= 8 && jsStat.p95 <= 16;
  const pass = okReady && okStage && okLines && okIdx && okSeek && okEmpty && okErr && okJs;

  results.push({
    num, name, pass, readyMs, jsStat, ivStat,
    idx0: st0(stage0), idxA: stA && stA.idx, idxB: stB && stB.idx, idxC: stC && stC.idx,
    flags: { okReady, okStage, okLines, okIdx, okSeek, okEmpty, okErr, okJs },
    errs: errs.slice(0, 5), shot: `shots/review/batch-c-${num}.png`,
    state: stA,
  });
  console.log(
    `${num} ${name.padEnd(24)} ${pass ? 'PASS' : 'FAIL'} ready=${readyMs}ms ` +
    `js med=${jsStat.med} p95=${jsStat.p95} | iv med=${ivStat.med} p95=${ivStat.p95} | ` +
    `idx ${stA && stA.idx}→${stB && stB.idx}→${stC && stC.idx} | ` +
    `flags=${JSON.stringify({ r: okReady, s: okStage, l: okLines, i: okIdx, k: okSeek, e: okEmpty, x: okErr, j: okJs })}` +
    (errs.length ? `\n   ERR: ${errs.slice(0, 3).join(' | ')}` : '')
  );
  if (stA && stA.__exc) console.log('   STAGE EXC:', stA.__exc);
}
function st0(s) { return s && !s.__exc ? s.idx : 'x'; }

fs.writeFileSync(path.join(ROOT, '_stageverify-c.json'), JSON.stringify(results, null, 2));

console.log('\n=== 汇总 ===');
console.log('编号 | 名称 | ready | JS中位 | JSp95 | 帧中位 | 帧p95 | idx | 结论');
for (const r of results) {
  console.log(`${r.num} | ${r.name} | ${r.readyMs}ms | ${r.jsStat.med} | ${r.jsStat.p95} | ${r.ivStat.med} | ${r.ivStat.p95} | ${r.idxA}→${r.idxB}→${r.idxC} | ${r.pass ? 'PASS' : 'FAIL ' + JSON.stringify(r.flags)}`);
}
const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} 通过`);

ws.close();
chrome.kill();
await sleep(400);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(fails ? 1 : 0);
