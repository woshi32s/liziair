/* _pipe-verify.mjs —— 批量验收一件/一批形态（流水线用）
   用法：
     node _pipe-verify.mjs 303,304,305            # 验收这几个编号
     node _pipe-verify.mjs 303-307                # 或给区间
   做四件事（全程一个 Chrome，串行，不会互相撞端口）：
     1) 静态：文件在不在 / 大小 / md5 与库内任何文件都不许同 / 有没有 __c100 与 __stage / ready 次数
     2) 协议：ready<2s / init 接歌词 / tick 推进 idx / seek / 空歌词不崩 / 0 console error
     3) 画面：2.4s、9.6s、16.8s 三帧截图 → 三帧必须不同；顺便算亮度均值/方差/粗略色数，判"空白/全黑"
     4) 出一张 wave 拼图（每件一行、三帧横排），我扫一眼就能判"字出来了没有、糊没糊"
   产出：shots/pipe/<num>-sheet.png、shots/pipe/wave-<...>.png、_pipe-report.json
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = 'E:/DSHdesktop/work/music-player';
const PORT = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(ROOT, 'shots/pipe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 解析编号 ---------- */
const raw = (process.argv[2] || '').trim();
if (!raw) { console.error('用 node _pipe-verify.mjs 303,304 或 303-307'); process.exit(1); }
let ids = [];
for (const part of raw.split(',')) {
  const m = /^(\d{3})\s*-\s*(\d{3})$/.exec(part.trim());
  if (m) { for (let i = +m[1]; i <= +m[2]; i++) ids.push(String(i).padStart(3, '0')); }
  else ids.push(part.trim().padStart(3, '0'));
}
ids = [...new Set(ids)];

/* ---------- 静态检查 ---------- */
const allFiles = fs.readdirSync(path.join(ROOT, 'public/stages')).filter((f) => /\.html$/i.test(f) && !/\.bak/i.test(f));
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const libHash = new Map();
for (const f of allFiles) libHash.set(md5(path.join(ROOT, 'public/stages', f)), f);

const items = [];
for (const id of ids) {
  const file = allFiles.find((f) => f.startsWith(id + '-'));
  const it = { num: id, file: file || null, static: {}, ok: false, why: [] };
  if (!file) { it.why.push('文件不存在'); items.push(it); continue; }
  const abs = path.join(ROOT, 'public/stages', file);
  const src = fs.readFileSync(abs, 'utf8');
  const h = md5(abs);
  const readyHits = (src.match(/ready/gi) || []).length;
  const title = (/<title>([^<]*)<\/title>/i.exec(src) || [, ''])[1].trim();
  const dupOf = libHash.get(h);
  Object.assign(it.static, {
    bytes: fs.statSync(abs).size,
    md5: h,
    title,
    hasProto: /__c100/.test(src),
    hasSelfCheck: /__stage\s*=/.test(src),
    readyHits,
    dupOf: dupOf && dupOf !== file ? dupOf : null,
  });
  if (it.static.bytes < 4000) it.why.push('文件太小(<4KB，多半是个空架子)');
  if (!it.static.hasProto) it.why.push('没有 __c100 协议代码');
  if (!it.static.hasSelfCheck) it.why.push('没有 window.__stage 自检口');
  if (it.static.dupOf) it.why.push('与库内文件同哈希: ' + it.static.dupOf);
  /* ready 是不是真的发了，以运行时为准（静态只能看字符串，容易被 helper 包一层绕过） */
  if (!readyHits) it.why.push('源码里连 ready 字样都没有');
  items.push(it);
}
const live = items.filter((i) => i.file);
if (!live.length) { console.log(JSON.stringify(items, null, 1)); process.exit(1); }

/* 先确认服务活着 —— 服务挂了会让所有形态都表现为"没回 ready / __stage 不是函数"，
   今晚因此误判过三件（354/356/358）。服务不在就直接退出，别把锅算到形态头上。 */
try {
  const probe = await fetch(`http://127.0.0.1:${PORT}/stages/${live[0].file}`, { method: 'HEAD' });
  if (!probe.ok) throw new Error('HTTP ' + probe.status);
} catch (e) {
  console.error('\n!! 本地服务 http://127.0.0.1:' + PORT + ' 不可用（' + e.message + '）');
  console.error('!! 请先 `node server.mjs` 再验收；现在的结果一律不可信，已中止。\n');
  process.exit(3);
}

/* ---------- 起浏览器 ---------- */
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-pipe-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

async function tabOf() {
  for (let i = 0; i < 120; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl); if (t) return t; } catch {}
    await sleep(250);
  }
  throw new Error('CDP 起不来');
}
const tab = await tabOf();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pend = new Map(); let errs = []; let logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 160));
  if (m.method === 'Log.entryAdded' && m.params.entry && m.params.entry.level === 'error') logs.push('log:' + String(m.params.entry.text || '').slice(0, 120));
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 140);
    if (m.params.type === 'error') { errs.push('console: ' + txt); }
    logs.push(m.params.type + ': ' + txt);
  }
};
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __exc: ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 240) }; return r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source:
  `window.__readyAt=0;addEventListener('message',function(e){var d=e.data;if(!d||d.__c100!==1)return;if(d.type==='ready')window.__readyAt=performance.now();},true);` });

/* ---------- 种子歌词（YRC 逐字 + 中英混排） ---------- */
const TEXTS = ['雨落在没有人的站台', '灯把影子拉得很长', 'I keep your voicemail on repeat', '我等一班不会来的车',
  '把话咽回去的时候', '整座城市都在回声', '轻得像是没发生过'];
const GAP = 3.2;
const LINES = TEXTS.map((text, i) => ({ t: +(i * GAP).toFixed(2), dur: GAP, text,
  chars: Array.from(text).map((c, k) => ({ c, t: +(i * GAP + 0.1 + k * (GAP * 0.8 / text.length)).toFixed(3) })) }));
const INIT = `(() => { window.postMessage({__c100:1,type:'init',payload:{song:{id:'P',name:'验收曲',artists:['流水线'],cover:''},accent:[214,26,30],lines:${JSON.stringify(LINES)},duration:40}},'*'); return 1; })()`;
const INIT_EMPTY = `(() => { window.postMessage({__c100:1,type:'init',payload:{song:{id:'P',name:'验收曲',artists:['流水线'],cover:''},accent:[214,26,30],lines:[],duration:40}},'*'); return 1; })()`;
/* 换歌 / 歌词晚到都会再发一次 init：这一次必须生效，否则"歌到了字永远不出" */
const REINIT = `(() => { window.postMessage({__c100:1,type:'init',payload:{song:{id:'P2',name:'第二首',artists:['流水线'],cover:''},accent:[60,120,200],lines:[
  {t:0,dur:2,text:'第二首的第一句',chars:null},
  {t:2,dur:2,text:'second line of song two',chars:null},
  {t:4,dur:2,text:'第三句',chars:null}],duration:12}},'*'); return 1; })()`;
/* 脏数据 init：播放器真实会发的东西 —— artists 是字符串（"A / B"）、空歌名、空封面、
   dur=0、text=null、空句、超长句、chars 长度和正文对不上、duration=0。这一发不许抛错。 */
const HOSTILE = `(() => { window.postMessage({__c100:1,type:'init',payload:{
  song:{ id:0, name:'', artists:'单人 / ARTIST B', cover:'' }, accent:[30,120,200],
  lines:[ {t:0,dur:0,text:'  首尾空格  ',chars:null},
          {t:0,dur:2,text:null,chars:null},
          {t:2,dur:1,text:'超长句'+'很长'.repeat(40),chars:[{c:'x',t:0}]},
          {t:2,dur:2,text:'',chars:[]} ],
  duration:0 }},'*'); return 1; })()`;
const at = (t) => `(() => { window.__T=${t}; if(window.__tk) clearInterval(window.__tk); window.__tk=setInterval(function(){ window.__T+=0.066; window.postMessage({__c100:1,type:'tick',payload:{time:window.__T,playing:true}},'*'); },66); window.postMessage({__c100:1,type:'tick',payload:{time:window.__T,playing:true}},'*'); return 1; })()`;

const capture = async () => (await send('Page.captureScreenshot', { format: 'png' })).data;

/* 统计一帧是不是"空白/全黑/死板"：在页面里画进 canvas 取像素 */
const STATS = (b64) => `(async () => {
  const img = new Image(); img.src = 'data:image/png;base64,' + ${JSON.stringify(b64)};
  await img.decode();
  const c = document.createElement('canvas'); c.width = 320; c.height = 200;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, 320, 200);
  const d = g.getImageData(0, 0, 320, 200).data;
  let sum = 0, sum2 = 0, n = 0; const set = new Set();
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
    sum += l; sum2 += l * l; n++;
    set.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
  }
  const mean = sum / n; const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  /* ink：离平均亮度超过 0.18 的像素占比。全黑/空白 ≈ 0；极简的黑底白线图（比如 310）也有 0.01+。
     std 会把"大面积纯黑 + 一条白线"误判成空白，所以判空白用 ink，std 只做参考。 */
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
    if (Math.abs(l - mean) > 0.18) ink++;
  }
  return JSON.stringify({ mean: +mean.toFixed(3), std: +std.toFixed(3), ink: +(ink / n).toFixed(4), colors: set.size });
})()`;

const results = [];
const frames = [];   /* {num, shots:[b64], stat:[..] } */

for (const it of live) {
  errs = []; logs = [];
  const t0 = Date.now();
  const url = `http://127.0.0.1:${PORT}/stages/${it.file}?pv=${Date.now()}`;
  await send('Page.navigate', { url });
  let ready = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    ready = await ev('window.__readyAt || 0');
    if (typeof ready === 'number' && ready > 0) break;
    ready = 0;
  }
  const hasSelf = await ev(`typeof window.__stage === 'function'`);
  it.r = { ready: Math.round(ready), hasSelf: !!hasSelf };
  if (!ready) it.why.push('2s 内没回 ready');
  if (!hasSelf) { it.why.push('__stage 不是函数'); results.push(compact(it)); continue; }

  await ev(INIT); await sleep(150);
  const s0 = await ev('window.__stage()');
  if (s0 && s0.__exc) it.why.push('__stage() 抛错: ' + s0.__exc.slice(0, 60));
  it.r.linesOk = !!(s0 && s0.lines === LINES.length);
  if (!it.r.linesOk) it.why.push('lines 不是行数(' + JSON.stringify(s0 && s0.lines) + ')');

  await ev(at(0.1)); await sleep(200);
  await ev(at(2.4)); await sleep(500);
  const s1 = await ev('window.__stage()');
  await ev(at(9.6)); await sleep(500);
  const s2 = await ev('window.__stage()');
  await ev(at(16.8)); await sleep(600);
  const s3 = await ev('window.__stage()');
  it.r.idx = [s1 && s1.idx, s2 && s2.idx, s3 && s3.idx];
  it.r.t = [s1 && +(+s1.t).toFixed(2), s3 && +(+s3.t).toFixed(2)];
  it.r.adv = !!(s1 && s2 && s3 && s2.idx > s1.idx && s3.idx > s2.idx);
  it.r.seekOk = !!(s3 && s3.idx >= 4);
  /* 时钟抖动/首帧慢会给出假失败（308 就误判过一次）：只在这一条上重试一回 */
  if (!it.r.adv || !it.r.seekOk) {
    await sleep(900);
    await ev(at(16.8)); await sleep(800);
    const s3b = await ev('window.__stage()');
    if (s3b && !s3b.__exc && s3b.idx >= 4 && s3b.idx > (s1 && s1.idx > -1 ? s1.idx : -1)) {
      it.r.idx[2] = s3b.idx; it.r.adv = true; it.r.seekOk = true; it.r.retried = true;
    }
  }
  it.r.text = (s3 && s3.text) || '';
  it.r.err = (s0 && s0.err) || (s1 && s1.err) || '';
  if (!it.r.adv) it.why.push('歌词不推进 idx=' + JSON.stringify(it.r.idx));
  if (!it.r.seekOk) it.why.push('seek 后 idx<4 (' + it.r.idx[2] + ')');
  if (it.r.err) it.why.push('舞台自报错: ' + String(it.r.err).slice(0, 60));

  /* 三帧（每帧前先回到对应时间，保证画面不等于空白） */
  const shots = [], stat = [];
  for (const [k, tv] of [[0, 2.4], [1, 9.6], [2, 16.8]]) {
    await ev(at(tv)); await sleep(520);
    const b64 = await capture();
    shots.push(b64);
    const st = await ev(STATS(b64));
    try { stat.push(JSON.parse(st)); } catch { stat.push(null); }
  }
  it.r.stat = stat;
  const same01 = shots[0] === shots[1], same12 = shots[1] === shots[2];
  it.r.moving = !(same01 && same12);
  if (!it.r.moving) it.why.push('三帧完全一样（画面是死的）');
  const flat = stat.every((s) => !s || s.ink < 0.004 || s.colors < 6);
  it.r.flat = flat;
  if (flat) it.why.push('画面像空白/全黑 (ink=' + (stat[2] && stat[2].ink) + ' colors=' + (stat[2] && stat[2].colors) + ')');

  /* 空歌词不该崩、不该编词 */
  await ev(INIT_EMPTY); await sleep(350);
  const s4 = await ev('window.__stage()');
  it.r.emptyOk = !!(s4 && s4.lines === 0 && !s4.err);
  if (!it.r.emptyOk) it.why.push('空 lyrics:[] 没生效（lines=' + JSON.stringify(s4 && s4.lines) + '）—— 多半是"重复 init 忽略"挡住了');

  /* 换歌：第二次 init 必须生效（歌词晚到 / 换歌 / 取色完成都会重发 init） */
  await ev(REINIT); await sleep(350);
  const s5 = await ev('window.__stage()');
  it.r.reinitOk = !!(s5 && s5.lines === 3 && !s5.err);
  if (!it.r.reinitOk) it.why.push('二次 init 不生效（lines=' + JSON.stringify(s5 && s5.lines) + '）→ 歌词晚到的歌会整首没字');

  /* 脏数据 init 不许抛错（artists 字符串是真实会发生的，app.js 第 3390 行就是 join 成字符串发的） */
  const errsBefore = errs.length;
  await ev(HOSTILE); await sleep(400);
  const s6 = await ev('window.__stage()');
  it.r.hostileOk = !(s6 && s6.__exc) && !(s6 && s6.err) && errs.length === errsBefore;
  if (!it.r.hostileOk) {
    it.why.push('脏数据 init 报错（artists 字符串 / 空句 / 超长句 / duration=0）：' +
      String((s6 && (s6.__exc || s6.err)) || errs.slice(errsBefore, errsBefore + 1).join('')).slice(0, 90));
  }

  it.r.ms = Date.now() - t0;
  it.r.errs = errs.slice(0, 3);
  if (errs.length) it.why.push('控制台报错 ' + errs.length + ' 条');

  fs.writeFileSync(path.join(OUT, it.num + '-sheet.png'), Buffer.from(shots[2], 'base64'));
  frames.push({ num: it.num, title: it.static.title, shots });
  results.push(compact(it));
}

function compact(it) {
  const r = it.r || {};
  return {
    num: it.num, file: it.file, title: it.static.title, bytes: it.static.bytes,
    ready: r.ready, linesOk: r.linesOk, idx: r.idx, t: r.t, adv: r.adv, seekOk: r.seekOk,
    moving: r.moving, emptyOk: r.emptyOk, reinitOk: r.reinitOk, flat: r.flat, err: r.err, errs: r.errs,
    stat: r.stat ? r.stat.map((s) => s && s.std) : null, ms: r.ms,
    ok: it.why.length === 0, why: it.why, md5: it.static.md5, readyHits: it.static.readyHits, dupOf: it.static.dupOf,
    logs: logs.slice(-5),
  };
}

/* ---------- wave 拼图：每件一行、三帧横排 ---------- */
let wavePath = null;
if (frames.length) {
  await send('Page.navigate', { url: 'about:blank' });
  const grid = await ev(`(async () => {
    const rows = ${JSON.stringify(frames.map((f) => ({ num: f.num, title: f.title, shots: f.shots })))};
    const cw = 440, chh = 275, gap = 8, label = 26;
    const c = document.createElement('canvas');
    c.width = cw * 3 + gap * 2;
    c.height = (chh + label) * rows.length;
    const g = c.getContext('2d');
    g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < rows.length; i++) {
      const y0 = i * (chh + label);
      g.fillStyle = '#9aa'; g.font = '600 16px monospace';
      g.fillText(rows[i].num + '  ' + rows[i].title, 6, y0 + 18);
      for (let k = 0; k < 3; k++) {
        const img = new Image(); img.src = 'data:image/png;base64,' + rows[i].shots[k]; await img.decode();
        g.drawImage(img, k * (cw + gap), y0 + label, cw, chh);
      }
    }
    return c.toDataURL('image/png');
  })()`);
  if (typeof grid === 'string' && grid.startsWith('data:image/png;base64,')) {
    wavePath = path.join(OUT, `wave-${live[0].num}-${live[live.length - 1].num}.png`);
    fs.writeFileSync(wavePath, Buffer.from(grid.split(',')[1], 'base64'));
  }
}

/* ---------- 汇总 ---------- */
const pass = results.filter((r) => r.ok).length;
console.log(`\n=== 验收 ${results.length} 件：PASS ${pass} / FAIL ${results.length - pass}`);
for (const r of results) {
  console.log(`${r.num} ${r.ok ? 'PASS' : 'FAIL'}  ${(r.title || '').slice(0, 12)}  ready=${r.ready} idx=${JSON.stringify(r.idx)} ` +
    `seek=${r.seekOk} empty=${r.emptyOk} move=${r.moving} std=${JSON.stringify(r.stat)} ${r.bytes}b ${r.ms}ms` +
    (r.ok ? '' : '\n      ✗ ' + r.why.join(' / ')));
}
if (wavePath) console.log('\n拼图: ' + path.relative(ROOT, wavePath).replace(/\\/g, '/'));
fs.writeFileSync(path.join(ROOT, '_pipe-report.json'), JSON.stringify({ at: new Date().toISOString(), wave: wavePath, results }, null, 1));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(pass === results.length ? 0 : 2);
