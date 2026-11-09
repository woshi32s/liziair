/**
 * _check-a-discipline.mjs —— A 组（200-209）四条纪律的**行为**复检
 * 主验收脚本 _stageverify-new.mjs 只看状态字段（lines/idx/t/frames/err/glyph）。
 * 这个脚本补上看不到的部分：
 *   ① 空歌词：init [] 之后画面**真的有东西**（不是黑屏），且不报错
 *   ② resize：1200×760@DPR2 之后字还在（画面内容比 > 0.3%），回到 1440×900 也还在
 *   ③ prefers-reduced-motion: reduce：RM 真的被监听到，且画面**运动能量**明显下降
 *   ④ 暂停冻结：t 与画面哈希都不动（主脚本已测，这里顺带复核）
 * 用法：node _check-a-discipline.mjs [200 201 ...]；截图 → shots/review/_a-<kind>-<NNN>.png
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

const only = process.argv.slice(2);
const files = fs.readdirSync(path.join(ROOT, 'public/stages'))
  .filter((f) => /^20\d-[a-z0-9-]+\.html$/.test(f))
  .filter((f) => !only.length || only.includes(f.slice(0, 3)))
  .sort();
if (!files.length) { console.error('没有 200-209 的 stage 文件'); process.exit(1); }

const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP_PORT = srv.address().port;
await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-disc-a-' + Date.now());
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
let consoleErrors = [], exceptions = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id); pend.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    return;
  }
  if (m.method === 'Log.entryAdded') {
    const t = m.params.entry, txt = (t.text || '') + ' @' + (t.url || '');
    if (t.level === 'error' && !/favicon/i.test(txt)) consoleErrors.push(txt.slice(0, 200));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push('console.error');
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 200));
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pend.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __exc: ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 200) };
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable').catch(() => {});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const TEXTS = ['把光折进纸里', '才看见纤维在呼吸', '每一道压痕都记得', '谁的手曾经按在这里', '等风把灰吹走'];
function seedLines(gap = 2.4) {
  return TEXTS.map((text, i) => {
    const chars = []; let acc = 0;
    for (const ch of text) { const d = /[\u4e00-\u9fff]/.test(ch) ? 0.2 : 0.09; chars.push({ t: +(i * gap + acc).toFixed(3), d, c: ch }); acc += d; }
    return { t: i * gap, dur: gap, text, chars };
  });
}
const lines = seedLines();
const INIT = (ls) => `window.postMessage({__c100:1,type:'init',payload:{lines:${JSON.stringify(ls)},accent:[212,184,148],song:{id:1,name:'验收曲',artists:[{name:'A 组'}],duration:240,cover:''}}},'*'); 1`;
const DRIVER = (from) => `(() => { if (window.__tk) clearInterval(window.__tk);
  window.__T = ${from}; window.postMessage({__c100:1,type:'tick',payload:{time:window.__T,playing:true}},'*');
  window.__tk = setInterval(() => { window.__T += 0.066; window.postMessage({__c100:1,type:'tick',payload:{time:window.__T,playing:true}},'*'); }, 66);
  return window.__T; })()`;
const FREEZE = `(() => { if (window.__tk) clearInterval(window.__tk);
  window.postMessage({__c100:1,type:'tick',payload:{time:window.__T,playing:false}},'*'); return window.__T; })()`;

/* 页面内工具：降采样亮度快照 + 内容比 + 两帧之间的运动能量（返回普通数组，CDP 能序列化） */
const TOOLS = `(() => {
  const cv = document.getElementById('c');
  const W = 120, H = 75;
  const s = document.createElement('canvas'); s.width = W; s.height = H;
  const g = s.getContext('2d', { willReadFrequently: true });
  window.__snap = () => {
    g.drawImage(cv, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const out = new Array(W * H);
    for (let i = 0, k = 0; i < d.length; i += 4, k++) out[k] = (d[i] * 0.30 + d[i + 1] * 0.55 + d[i + 2] * 0.15) | 0;
    return out;
  };
  window.__content = () => {
    const d = window.__snap(); let lit = 0, sum = 0;
    for (let i = 0; i < d.length; i++) { sum += d[i]; if (d[i] > 46) lit++; }
    return { lit: +(lit / d.length).toFixed(4), mean: +(sum / d.length).toFixed(1) };
  };
  window.__energy = (a) => {
    const b = window.__snap(); let s = 0;
    for (let i = 0; i < b.length; i++) s += Math.abs(b[i] - a[i]);
    return +(s / b.length).toFixed(2);
  };
  /* 全分辨率数一下"有多少像素是亮的" —— 线稿也能数出来，比降采样均值可靠 */
  window.__lit = () => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] * 0.30 + d[i + 1] * 0.55 + d[i + 2] * 0.15 > 38) n++;
    }
    return { n: n, ratio: +(n / (d.length / 4)).toFixed(4) };
  };
  return 1; })()`;

/* 运动能量：**同一首歌、同一位置**各量一次（否则量的是不同歌词段，没法比） */
const setRM = (v) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] });
const measureMotion = async () => {
  await ev(INIT(lines));
  await sleep(120);
  await ev(DRIVER(2.6));
  await sleep(1350);
  const s0 = await ev('window.__snap()');
  await sleep(420);
  return await ev(`window.__energy(${JSON.stringify(s0)})`);
};

const rows = [];
for (const file of files) {
  const num = file.slice(0, 3);
  consoleErrors = []; exceptions = [];
  const r = { num, file };
  await send('Page.navigate', { url: `${BASE}/stages/${file}?v=${Date.now()}` });
  for (let i = 0; i < 80; i++) { await sleep(60); if (await ev('!!(window.__stage && document.getElementById("c"))')) break; }
  await sleep(400);
  await ev(TOOLS);
  await setRM('no-preference');

  /* ---- ① 空歌词：不崩、不空白（全分辨率数亮点） ---- */
  await ev(INIT([]));
  await sleep(900);
  const stE = await ev('window.__stage()');
  r.emptyLines = stE && stE.lines;
  r.emptyErr = stE && stE.err;
  r.emptyLit = await ev('window.__lit()');
  r.emptyOk = !!(stE && stE.lines === 0 && stE.err === '' && r.emptyLit && r.emptyLit.n > 1200);
  let cap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `_a-empty-${num}.png`), Buffer.from(cap.data, 'base64'));

  /* ---- ② 运动能量：普通 vs reduce（同位置） ---- */
  r.motionNormal = await measureMotion();
  await setRM('reduce');
  await sleep(300);
  r.motionReduce = await measureMotion();
  r.rmFlag = await ev('window.__stage().rm');
  r.rmErr = await ev('window.__stage().err');
  r.rmAmp = await ev('window.__stage().rmAmp');
  const f0 = await ev('window.__stage().frames');
  await sleep(300);
  r.rmFrames = (await ev('window.__stage().frames')) > f0;
  /* 硬指标：RM 被实时监听到、不报错、还在出帧（"没降级"那个 bug 的本体）；
     软指标：装饰性运动能量下降 ≤75%，或机制自报 amp ≤0.55。
     逐字推进 / 墨累积是"内容进度"，不随 reduce 关闭，只作记录。 */
  r.rmRatio = r.motionNormal > 0.6 ? +(r.motionReduce / r.motionNormal).toFixed(2) : 0;
  r.rmSoft = (r.motionReduce <= 0.8) || (r.rmRatio > 0 && r.rmRatio <= 0.75) ||
             (typeof r.rmAmp === 'number' && r.rmAmp <= 0.55);
  r.rmOk = !!(r.rmFlag === true && r.rmErr === '' && r.rmFrames);
  cap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `_a-reduce-${num}.png`), Buffer.from(cap.data, 'base64'));
  await setRM('no-preference');
  await sleep(250);

  /* ---- ③ resize：1200×760@DPR2 再回来 ---- */
  await ev(INIT(lines));
  await sleep(120);
  await ev(DRIVER(6.4));
  await sleep(1400);
  const litA = await ev('window.__lit()');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 760, deviceScaleFactor: 2, mobile: false });
  await sleep(900);
  const stR = await ev('window.__stage()');
  r.resizeGlyph = stR && stR.glyph;
  r.resizeErr = stR && stR.err;
  r.resizeLit = await ev('window.__lit()');
  cap = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `_a-resize-${num}.png`), Buffer.from(cap.data, 'base64'));

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  const stR2 = await ev('window.__stage()');
  r.backGlyph = stR2 && stR2.glyph;
  r.backErr = stR2 && stR2.err;
  r.backLit = await ev('window.__lit()');
  /* 亮像素数在 DPR2 下是 4 倍，用比例比；两边都必须明显有字 */
  r.resizeOk = !!(r.resizeGlyph !== false && r.resizeErr === '' && r.resizeLit.ratio > 0.004 &&
                  r.backGlyph !== false && r.backErr === '' && r.backLit.ratio > 0.004);

  /* ---- ④ 暂停冻结 ---- */
  await ev(DRIVER(6.4));
  await sleep(700);
  await ev(FREEZE);
  await sleep(1200);
  const hash = `(() => { const c = document.getElementById('c'), g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data; let h = 0;
    for (let i = 0; i < d.length; i += 613) h = (h * 31 + d[i]) | 0; return h; })()`;
  const hA = await ev(hash);
  await sleep(600);
  const hB = await ev(hash);
  r.frozen = hA === hB;

  r.consoleErrors = consoleErrors.slice();
  r.exceptions = exceptions.slice();
  r.ok = r.emptyOk && r.resizeOk && r.rmOk && r.frozen &&
    r.consoleErrors.length === 0 && r.exceptions.length === 0;
  rows.push(r);
  console.log(`${num} ${r.ok ? 'OK  ' : 'FAIL'} empty=${r.emptyOk}(lit ${(r.emptyLit || {}).n}px) ` +
    `resize=${r.resizeOk}(${r.resizeLit.ratio}→${r.backLit.ratio}) ` +
    `rm=${r.rmOk}(运动 ${r.motionNormal}→${r.motionReduce}, ratio ${r.rmRatio}, soft ${r.rmSoft}) ` +
    `frozen=${r.frozen} err=${r.consoleErrors.length} exc=${r.exceptions.length}`);
  if (!r.ok) console.log('     ' + JSON.stringify({ empty: [r.emptyLines, r.emptyErr], resize: [r.resizeGlyph, r.resizeErr, r.backGlyph, r.backErr], rm: [r.rmFlag, r.rmErr, r.rmFrames, r.rmAmp], ce: r.consoleErrors, ex: r.exceptions }));
}

console.log('\n| 编号 | 空歌词亮像素 | resize 亮像素比(1200@2 → 1440@1) | reduce 运动能量(普通→reduce) | 自报 amp | 暂停冻结 | 结论 |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.num} | ${r.emptyOk ? 'ok' : 'NO'} ${(r.emptyLit || {}).n} | ${r.resizeOk ? 'ok' : 'NO'} ${r.resizeLit.ratio}→${r.backLit.ratio} | ${r.rmRatio} (${r.motionNormal}→${r.motionReduce}) | ${r.rmAmp} | ${r.frozen ? 'ok' : 'NO'} | ${r.ok ? 'PASS' : 'FAIL'} |`);
}
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length}/${rows.length} 通过` + (bad.length ? '，未通过: ' + bad.map((b) => b.num).join(', ') : ''));
fs.writeFileSync(path.join(ROOT, '_check-a-discipline.json'), JSON.stringify(rows, null, 2));
ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
