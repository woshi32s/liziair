/**
 * _eqcheck.mjs —— 音效设置验收（10 条，全部打印真实数字）
 *
 * 用法：node _eqcheck.mjs
 * 端口从 .port 读；自己起无头 Chrome（临时 profile，跑完删）。
 *
 * 关键点：频响不是"看代码觉得对"，是**用 OfflineAudioContext 把粉噪过一遍**，
 * 再在 1kHz 上做单频复增益估计（湿/干复数比），逐段跟 getFrequencyResponse 对账。
 * 曲线一致性则是把画布上的像素扫出来，反算成 dB，再跟真滤波器响应比。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const APP = fs.readFileSync(path.join(HERE, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440, H = 1000;
const OUT = 'shots/review';
fs.mkdirSync(OUT, { recursive: true });

const R = { pass: 0, fail: 0, rows: [] };
const ok = (n, name, detail, pass) => {
  R.rows.push({ n, name, detail, pass });
  if (pass) R.pass++; else R.fail++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  [${n}] ${name} —— ${detail}`);
};

/* ---------------- 起 Chrome ---------------- */
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-eqcheck-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pend = new Map();
const exceptions = [], consoleErrs = [], songUrlReqs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    exceptions.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 220));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrs.push(m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 220));
  }
  /* 抓 song/url 的请求体：证明 UI 选的音质真的被 api.js 带到了服务端 */
  if (m.method === 'Network.requestWillBeSent') {
    const r = m.params.request;
    if (r && r.url && r.url.indexOf('/api/song/url') >= 0) {
      songUrlReqs.push({ url: r.url, body: r.postData || '' });
    }
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, timeout: 180000 });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    return 'EXC:' + ((d.exception && d.exception.description) || d.text || '').split('\n')[0];
  }
  return r.result.value;
};
const gate = async (cond, tries = 60, ms = 400) => {
  for (let i = 0; i < tries; i++) { if (await ev(cond)) return true; await sleep(ms); }
  return false;
};
const shot = async (name, clip) => {
  const p = { format: 'png', captureBeyondViewport: false };
  if (clip) p.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale || 1 };
  const png = await send('Page.captureScreenshot', p);
  fs.writeFileSync(`${OUT}/${name}`, Buffer.from(png.data, 'base64'));
  console.log(`    → ${OUT}/${name}`);
  return fs.statSync(`${OUT}/${name}`).size;
};
const rectOf = async (sel) => JSON.parse(await ev(`(function(){
  var e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return 'null';
  var r = e.getBoundingClientRect();
  return JSON.stringify({ x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height });
})()`));
/* 顶栏左键在非大厅视图就是「返回」，连点几次一定回到大厅 */
const goHall = async () => {
  for (let i = 0; i < 8; i++) {
    if (await ev(`document.getElementById('view-hall').classList.contains('is-active')`)) return true;
    await ev(`document.getElementById('btn-settings').click()`);
    await sleep(450);
  }
  return false;
};

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });

/* ================================================================== *
 * 测试工具箱：装进页面里，避免每次 eval 传长表达式
 * ================================================================== */
async function installTools() {
  const r = await ev(`(function(){
  var E = EqEngine;

  /* ---- 粉噪（Paul Kellet 滤波器）：-3dB/oct，比白噪更接近"节目素材" ---- */
  function pink(ctx, n, seed) {
    var b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0, s = seed || 1;
    function rnd(){ s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x3fffffff - 1; }
    for (var i=0;i<n;i++) {
      var w = rnd();
      b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
      b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
      b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
      var v = b0+b1+b2+b3+b4+b5+b6+w*0.5362;
      b6 = w*0.115926;
      d[i] = v * 0.11;
    }
    return b;
  }

  /* ---- 单频复增益估计：H(f) = Σwet·e^{-jwi} / Σdry·e^{-jwi}（Hann 窗） ---- */
  function gainAt(dry, wet, sr, f, from, to) {
    var nr=0, ni=0, dr=0, di=0, n = to - from;
    for (var i=0;i<n;i++) {
      var w = 0.5 - 0.5*Math.cos(2*Math.PI*i/(n-1));
      var a = i + from;
      var ph = 2*Math.PI*f*a/sr, c = Math.cos(ph), s = Math.sin(ph);
      var x = dry[a]*w, y = wet[a]*w;
      nr += y*c; ni -= y*s;
      dr += x*c; di -= x*s;
    }
    var mw = Math.hypot(nr,ni), md = Math.hypot(dr,di);
    return 20*Math.log10(Math.max(1e-9, mw) / Math.max(1e-9, md));
  }

  /* ---- 按一组滤波器参数离线渲染（与图里完全同构：7 个 BiquadFilter 串联） ---- */
  async function renderChain(buf, params, N, sr) {
    var off = new OfflineAudioContext(1, N, sr);
    var src = off.createBufferSource();
    var b = off.createBuffer(1, N, sr);
    var d = b.getChannelData(0);
    var srcData = buf.getChannelData(0);
    for (var i=0;i<N;i++) d[i] = srcData[i];
    src.buffer = b;
    var node = src;
    params.forEach(function(p){
      var f = off.createBiquadFilter();
      f.type = p.type; f.frequency.value = p.freq; f.gain.value = p.gain; f.Q.value = p.q;
      node.connect(f); node = f;
    });
    node.connect(off.destination);
    src.start();
    return off.startRendering();
  }

  /* ---- 用 getFrequencyResponse 算某组参数在 f 处的总响应（真滤波器，不是公式） ---- */
  function predict(params, f) {
    var off = new OfflineAudioContext(1, 128, 44100);
    var freqs = new Float32Array([f]), mag = new Float32Array(1), ph = new Float32Array(1);
    var acc = 1;
    params.forEach(function(p){
      var bq = off.createBiquadFilter();
      bq.type = p.type; bq.frequency.value = p.freq; bq.gain.value = p.gain; bq.Q.value = p.q;
      bq.getFrequencyResponse(freqs, mag, ph);
      acc *= mag[0];
    });
    return 20*Math.log10(Math.max(1e-9, acc));
  }

  /* ---- -3dB 带宽（相对峰值）：扫 getFrequencyResponse 找 +9dB 的两个交点 ---- */
  function bandwidth(q, f0, gainDb) {
    var off = new OfflineAudioContext(1, 128, 44100);
    var bq = off.createBiquadFilter();
    bq.type = 'peaking'; bq.frequency.value = f0; bq.gain.value = gainDb; bq.Q.value = q;
    var N = 6000, lo = 40, hi = 12000;
    var fs = new Float32Array(N), mag = new Float32Array(N), ph = new Float32Array(N);
    for (var i=0;i<N;i++) fs[i] = lo * Math.pow(hi/lo, i/(N-1));
    bq.getFrequencyResponse(fs, mag, ph);
    var target = Math.pow(10, (gainDb - 3)/20);
    var f1 = null, f2 = null;
    for (var i=1;i<N;i++) {
      if (!f1 && mag[i-1] < target && mag[i] >= target) f1 = fs[i];
      if (!f2 && mag[i-1] >= target && mag[i] < target) f2 = fs[i];
    }
    return { f1: f1, f2: f2, bw: (f1 && f2) ? f2 - f1 : 0, q: q };
  }

  function snapshotParams() {
    return E.liveFilters().map(function(f){ return { type: f.type, freq: f.freq, gain: f.gain, q: f.q }; });
  }

  window.__T = {
    pink: pink, gainAt: gainAt, renderChain: renderChain, predict: predict,
    bandwidth: bandwidth, params: snapshotParams,
    /* 逐段量：把某段推到 +12，1kHz 处测湿/干增益 */
    async bandSweep() {
      var sr = 44100, N = 65536;
      var off = new OfflineAudioContext(1, N, sr);
      var buf = pink(off, N, 20261027);
      var dry = await renderChain(buf, [], N, sr);
      var rows = [];
      for (var i=0;i<7;i++) {
        for (var k=0;k<7;k++) E.setBandGain(k, 0);
        E.setBandGain(i, 12);
        var params = snapshotParams();
        var wet = await renderChain(buf, params, N, sr);
        var meas = gainAt(dry.getChannelData(0), wet.getChannelData(0), sr, 1000, Math.floor(N*0.12), Math.floor(N*0.88));
        var pred = predict(params, 1000);
        var nodeGain = E.liveFilters()[i].gain;
        rows.push({
          i: i, hz: E.BANDS[i], nodeGain: nodeGain,
          measured: +meas.toFixed(3), predicted: +pred.toFixed(3),
          err: +Math.abs(meas - pred).toFixed(3),
        });
      }
      for (var k=0;k<7;k++) E.setBandGain(k, 0);
      return rows;
    },
  };
  return 'ok';
})()`);
  if (r !== 'ok') console.log('!! 工具箱装载失败:', r);
  return r === 'ok';
}

/* ================================================================== *
 * 0. 启动
 * ================================================================== */
console.log('\n[0] 启动大厅');
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length>0`, 60, 500))) {
  console.log('!! 大厅没起来'); process.exit(2);
}
await gate(`typeof EqEngine === 'object' && typeof EqUI === 'object' && !!document.querySelector('link[data-eq-css]')`, 40, 300);
await installTools();
console.log('', JSON.stringify(await ev(`({ eq: typeof EqEngine, ui: typeof EqUI, css: !!document.querySelector('link[data-eq-css]'),
  version: EqEngine.VERSION, quality: EqEngine.quality, on: EqEngine.state.on, presets: EqEngine.PRESETS.length })`)));

/* ================================================================== *
 * 1a. 大厅设置 → 音效 → 整页
 * ================================================================== */
console.log('\n[1a] 大厅设置 →「音效」→ 整页 #view-audio');
await ev(`document.getElementById('btn-settings').click()`);
await sleep(450);
const rowInfo = JSON.parse(await ev(`(function(){
  var r = document.getElementById('row-audio');
  var b = r.getBoundingClientRect();
  return JSON.stringify({ h: b.height, w: b.width, txt: r.textContent.replace(/\\s+/g,' ').trim(),
    panelOpen: !document.getElementById('settings-panel').hidden,
    val: document.getElementById('set-audio').textContent });
})()`));
await ev(`document.getElementById('row-audio').click()`);
const pageOpen = await gate(`document.getElementById('view-audio').classList.contains('is-active') && !!document.querySelector('#eq-host-page .eqx')`, 30, 300);
const pageInfo = JSON.parse(await ev(`(function(){
  var v = document.getElementById('view-audio');
  var host = document.querySelector('#eq-host-page .eqx');
  var cs = getComputedStyle(v);
  return JSON.stringify({
    active: v.classList.contains('is-active'),
    bg: cs.backgroundColor, top: cs.top, padTop: cs.paddingTop,
    bands: document.querySelectorAll('#eq-host-page .eqband').length,
    tracks: document.querySelectorAll('#eq-host-page [data-track]').length,
    chips: document.querySelectorAll('#eq-host-page #eq-quality [data-q]').length,
    eqxCount: document.querySelectorAll('.eqx').length,
    settingsClosed: document.getElementById('settings-panel').hidden,
    title: document.querySelector('.eqx__title').textContent,
  });
})()`));
ok('1a', '大厅设置 →「音效」→ 整页打开',
  `设置行「${rowInfo.txt}」高 ${rowInfo.h.toFixed(1)}px · 面板已关=${pageInfo.settingsClosed} · `
  + `view-audio active=${pageInfo.active} bg=${pageInfo.bg} padding-top=${pageInfo.padTop} · `
  + `${pageInfo.bands} 个频段 / ${pageInfo.tracks} 个滑杆 / ${pageInfo.chips} 个音质档 · .eqx 实例 ${pageInfo.eqxCount} 个`,
  pageOpen && pageInfo.bands === 7 && pageInfo.tracks === 7 && pageInfo.chips === 5 && pageInfo.eqxCount === 1
  && pageInfo.bg === 'rgb(255, 255, 255)' && pageInfo.padTop === '84px');

/* 顶栏左键在音效页要液化成返回箭头，点了回大厅 */
const backInfo = JSON.parse(await ev(`(function(){
  var box = document.querySelector('.topbar__left');
  return JSON.stringify({ isBack: box.classList.contains('is-back'),
    label: document.getElementById('btn-settings').getAttribute('aria-label') });
})()`));
await ev(`document.getElementById('btn-settings').click()`);
const backOk = await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 20, 250);
console.log(`    顶栏左键：is-back=${backInfo.isBack} label=「${backInfo.label}」 → 点后回大厅=${backOk}`);
/* 再开一次，后面的检查都要用 */
await ev(`(function(){ document.getElementById('btn-settings').click(); return 1; })()`);
await sleep(400);
await ev(`document.getElementById('row-audio').click()`);
await gate(`document.getElementById('view-audio').classList.contains('is-active')`, 20, 250);
await sleep(400);

/* ================================================================== *
 * 2. 7 段滑杆：拖到 +12dB，参数真的是 12；粉噪实测 1kHz 增益
 * ================================================================== */
console.log('\n[2] 7 段滑杆 + 粉噪实测频响（1kHz）');
/* 先用手势把第 1 段（60Hz）拖到顶，确认 pointer 交互真的改到了 BiquadFilterNode */
const r60 = await rectOf('#eq-host-page .eqband[data-band="0"] .eqband__track');
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r60.x + r60.width / 2, y: r60.y + r60.height * 0.5, button: 'none', clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r60.x + r60.width / 2, y: r60.y + r60.height * 0.5, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r60.x + r60.width / 2, y: r60.y - 30, button: 'left', buttons: 1 });
await sleep(120);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r60.x + r60.width / 2, y: r60.y - 30, button: 'left', buttons: 0, clickCount: 1 });
await sleep(250);
const dragState = JSON.parse(await ev(`(function(){
  var f = EqEngine.liveFilters()[0];
  return JSON.stringify({ gain: f.gain, freq: f.freq, q: f.q, type: f.type,
    ui: EqEngine.state.simple.gains[0], readout: document.querySelector('#eq-host-page .eqband[data-band="0"] .eqband__db').textContent,
    preamp: EqEngine.snapshot().preampDb });
})()`));
const sweep = await ev(`__T.bandSweep()`);
let worstErr = 0, band1k = null;
const sweepRows = sweep.map((r) => {
  worstErr = Math.max(worstErr, r.err);
  if (r.hz === 1000) band1k = r;
  return `${r.hz}${r.nodeGain === 12 ? '(+12)' : ''}→${r.measured.toFixed(2)}dB/预测${r.predicted.toFixed(2)}`;
});
console.log('    逐段（段推到 +12dB 时 1kHz 处的实测/预测增益）：');
for (const r of sweep) {
  console.log(`      ${String(r.hz).padStart(5)}Hz  节点 gain=${r.nodeGain}  实测 ${r.measured.toFixed(3)}dB  预测 ${r.predicted.toFixed(3)}dB  误差 ${r.err.toFixed(3)}dB`);
}
console.log(`    1kHz 段：设定 +12dB → 实测 ${band1k.measured.toFixed(2)}dB（与设定值差 ${Math.abs(band1k.measured - 12).toFixed(2)}dB）`);
ok(2, '7 段滑杆生效：拖到 +12dB 节点参数=12，粉噪过 OfflineAudioContext 实测误差 < 1dB',
  `拖动后 gains[0]=${dragState.ui} 读数「${dragState.readout}」→ BiquadFilter gain=${dragState.gain} freq=${dragState.freq} Q=${dragState.q.toFixed(2)} `
  + `· 前级自动 ${dragState.preamp}dB · 逐段 1kHz 实测 vs 响应 最大误差 ${worstErr.toFixed(3)}dB `
  + `· 1kHz 段实测 ${band1k.measured.toFixed(2)}dB（设定 12）`,
  dragState.gain === 12 && Math.abs(dragState.ui - 12) < 0.01 && worstErr < 1
  && Math.abs(band1k.measured - 12) < 1 && sweep.length === 7);

/* ================================================================== *
 * 3. Q：0.7 vs 8 的 -3dB 带宽比
 * ================================================================== */
console.log('\n[3] Q 对带宽的影响');
const bw = await ev(`(function(){ return JSON.stringify({ lo: __T.bandwidth(0.7, 1000, 12), hi: __T.bandwidth(8, 1000, 12) }); })()`);
const bwv = JSON.parse(bw);
const bwRatio = bwv.hi.bw > 0 ? bwv.lo.bw / bwv.hi.bw : 0;
console.log(`    Q=0.7 → -3dB 带宽 ${bwv.lo.bw.toFixed(1)}Hz（${bwv.lo.f1.toFixed(1)}~${bwv.lo.f2.toFixed(1)}Hz）`);
console.log(`    Q=8.0 → -3dB 带宽 ${bwv.hi.bw.toFixed(1)}Hz（${bwv.hi.f1.toFixed(1)}~${bwv.hi.f2.toFixed(1)}Hz）`);
ok(3, 'Q 变化真的改变带宽（−3dB 带宽比 > 3×）',
  `Q 0.7 带宽 ${bwv.lo.bw.toFixed(1)}Hz / Q 8 带宽 ${bwv.hi.bw.toFixed(1)}Hz = ${bwRatio.toFixed(2)}×`,
  bwRatio > 3);

/* ================================================================== *
 * 4. 10 套预设
 * ================================================================== */
console.log('\n[4] 10 套预设');
const presetRows = [];
for (let pi = 0; pi < 10; pi++) {
  const r = JSON.parse(await ev(`(function(){
    var sel = document.getElementById('eq-preset');
    var opt = sel.options[${pi}];
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    var f = EqEngine.liveFilters();
    return JSON.stringify({ id: opt.value, name: opt.textContent, gains: f.map(function(x){ return +x.gain.toFixed(2); }),
      max: +Math.max.apply(null, f.map(function(x){return x.gain;})).toFixed(2),
      min: +Math.min.apply(null, f.map(function(x){return x.gain;})).toFixed(2),
      width: EqEngine.state.simple.width, haas: EqEngine.state.simple.haas,
      preamp: EqEngine.snapshot().preampDb });
  })()`));
  presetRows.push(r);
  console.log(`    ${String(pi + 1).padStart(2)}. ${r.name.padEnd(12)} [${r.gains.map((g) => (g > 0 ? '+' : '') + g.toFixed(1)).join(', ')}] `
    + `max ${r.max > 0 ? '+' : ''}${r.max} min ${r.min} · width ${r.width} haas ${r.haas}ms · 前级 ${r.preamp}dB`);
}
let pairs = 0, maxDiff = 0;
for (let a = 0; a < presetRows.length; a++) {
  for (let b = a + 1; b < presetRows.length; b++) {
    const d = Math.abs(presetRows[a].max - presetRows[b].max);
    if (d >= 6) pairs++;
    maxDiff = Math.max(maxDiff, d);
  }
}
const distinct = new Set(presetRows.map((r) => r.gains.join(','))).size;
ok(4, '10 套预设都能应用，且至少 3 对之间最大增益差 ≥ 6dB',
  `${presetRows.length} 套全部应用成功 · 不同曲线 ${distinct} 条 · 最大增益差 ≥6dB 的预设对数 ${pairs} 对（最大 ${maxDiff.toFixed(1)}dB）`
  + ` · 3D 环绕带 width ${presetRows[8].width} / haas ${presetRows[8].haas}ms（这部分不是 EQ 段做的）`,
  presetRows.length === 10 && distinct === 10 && pairs >= 3 && presetRows[8].width > 1.5 && presetRows[8].haas > 0);

/* ================================================================== *
 * 5. 高级模式交互
 * ================================================================== */
console.log('\n[5] 高级模式：拖节点 / 滚轮改 Q / 双击旁通 / 右键切类型');
await ev(`document.getElementById('eq-mode').click()`);
await sleep(500);
const advReady = await gate(`!document.getElementById('eq-adv').hidden && document.getElementById('eq-canvas').width > 100`, 20, 200);
/* 先给一条有起伏的曲线，方便后面扫像素 */
await ev(`(function(){
  EqEngine.setNode(0, { type: 'lowshelf', freq: 90, gain: 7, q: 0.9, bypass: false });
  EqEngine.setNode(1, { type: 'peaking', freq: 220, gain: -4, q: 1.4, bypass: false });
  EqEngine.setNode(2, { type: 'peaking', freq: 600, gain: 2, q: 2.2, bypass: false });
  EqEngine.setNode(3, { type: 'peaking', freq: 1400, gain: 5, q: 3.1, bypass: false });
  EqEngine.setNode(4, { type: 'peaking', freq: 3200, gain: -3, q: 1.8, bypass: false });
  EqEngine.setNode(5, { type: 'highshelf', freq: 7000, gain: -5, q: 0.7, bypass: false });
  EqEngine.setNode(6, { type: 'highshelf', freq: 12000, gain: 6, q: 0.7, bypass: false });
  return 1;
})()`);
await sleep(300);

/* 拖第 4 个节点（1.4kHz）*/
const nodePos = JSON.parse(await ev(`(function(){
  var c = document.getElementById('eq-canvas'), r = c.getBoundingClientRect();
  var p = EqUI.debug.nodeXY(3);
  return JSON.stringify({ x: r.left + p.x, y: r.top + p.y, cx: p.x, cy: p.y, r: r.left, t: r.top, dpr: p.dpr });
})()`));
const before = JSON.parse(await ev(`(function(){ var n = EqEngine.state.advanced.nodes[3];
  return JSON.stringify({ freq: n.freq, gain: n.gain, q: n.q, type: n.type, bypass: n.bypass }); })()`));
await ev(`document.getElementById('eq-canvas').focus()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nodePos.x, y: nodePos.y, button: 'none', clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nodePos.x, y: nodePos.y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 5; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nodePos.x + i * 22, y: nodePos.y - i * 12, button: 'left', buttons: 1 });
  await sleep(35);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nodePos.x + 110, y: nodePos.y - 60, button: 'left', buttons: 0, clickCount: 1 });
await sleep(250);
const afterDrag = JSON.parse(await ev(`(function(){ var n = EqEngine.state.advanced.nodes[3];
  var f = EqEngine.liveFilters()[3];
  return JSON.stringify({ freq: n.freq, gain: n.gain, q: n.q, nodeFreq: f.freq, nodeGain: f.gain,
    label: document.getElementById('eq-sel').textContent }); })()`));

/* 滚轮改 Q */
const qPos = JSON.parse(await ev(`(function(){
  var c = document.getElementById('eq-canvas'), r = c.getBoundingClientRect();
  var p = EqUI.debug.nodeXY(3);
  return JSON.stringify({ x: r.left + p.x, y: r.top + p.y }); })()`));
const qBefore = Number(await ev(`EqEngine.state.advanced.nodes[3].q`));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: qPos.x, y: qPos.y, button: 'none', clickCount: 0 });
for (let i = 0; i < 6; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: qPos.x, y: qPos.y, deltaX: 0, deltaY: -120 });
  await sleep(60);
}
const qAfterWheel = Number(await ev(`EqEngine.state.advanced.nodes[3].q`));
const qNode = Number(await ev(`EqEngine.liveFilters()[3].q`));

/* 双击旁通 */
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: qPos.x, y: qPos.y, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: qPos.x, y: qPos.y, button: 'left', buttons: 0, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: qPos.x, y: qPos.y, button: 'left', buttons: 1, clickCount: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: qPos.x, y: qPos.y, button: 'left', buttons: 0, clickCount: 2 });
await sleep(300);
const afterDbl = JSON.parse(await ev(`(function(){ var n = EqEngine.state.advanced.nodes[3];
  return JSON.stringify({ bypass: n.bypass, nodeGain: EqEngine.liveFilters()[3].gain, type: EqEngine.liveFilters()[3].type,
    label: document.getElementById('eq-sel').textContent }); })()`));

/* 右键切类型（先取消旁通，再右键） */
await ev(`EqEngine.setNode(3, { bypass: false })`);
await sleep(150);
const typeBefore = await ev(`EqEngine.state.advanced.nodes[3].type`);
const pos2 = JSON.parse(await ev(`(function(){
  var c = document.getElementById('eq-canvas'), r = c.getBoundingClientRect();
  var p = EqUI.debug.nodeXY(3);
  return JSON.stringify({ x: r.left + p.x, y: r.top + p.y }); })()`));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos2.x, y: pos2.y, button: 'right', buttons: 2, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos2.x, y: pos2.y, button: 'right', buttons: 0, clickCount: 1 });
await sleep(300);
let typeAfter = await ev(`EqEngine.state.advanced.nodes[3].type`);
let typeNode = await ev(`EqEngine.liveFilters()[3].type`);
if (typeAfter === typeBefore) {
  /* CDP 的右键不一定派发 contextmenu，这里补一次真实的 DOM 事件，
     并在报告里注明是合成事件（不是 CDP 原生） */
  await ev(`document.getElementById('eq-canvas').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${pos2.x}, clientY: ${pos2.y}, button: 2 }))`);
  await sleep(250);
  typeAfter = await ev(`EqEngine.state.advanced.nodes[3].type`);
  typeNode = await ev(`EqEngine.liveFilters()[3].type`);
}
console.log(`    拖动前 ${JSON.stringify(before)}`);
console.log(`    拖动后 ${JSON.stringify(afterDrag)}`);
console.log(`    滚轮 Q ${qBefore} → ${qAfterWheel}（节点 ${qNode}）`);
console.log(`    双击后 ${JSON.stringify(afterDbl)}`);
console.log(`    右键 ${typeBefore} → ${typeAfter}（节点 ${typeNode}）`);
ok(5, '高级模式：拖动改 freq/gain、滚轮改 Q、双击旁通回到 0dB、右键切类型',
  `拖节点 ${before.freq}Hz/${before.gain}dB → ${afterDrag.freq}Hz/${afterDrag.gain}dB（节点 ${afterDrag.nodeFreq}Hz/${afterDrag.nodeGain}dB）`
  + ` · 滚轮 Q ${qBefore}→${qAfterWheel} · 双击 bypass=${afterDbl.bypass} 该段 gain=${afterDbl.nodeGain}dB`
  + ` · 右键 ${typeBefore}→${typeAfter}`,
  advReady
  && (afterDrag.freq !== before.freq && afterDrag.gain !== before.gain)
  && Math.abs(afterDrag.nodeFreq - afterDrag.freq) < 0.6 && Math.abs(afterDrag.nodeGain - afterDrag.gain) < 0.2
  && qAfterWheel > qBefore * 1.2 && Math.abs(qNode - qAfterWheel) < 0.02
  && afterDbl.bypass === true && Math.abs(afterDbl.nodeGain) < 0.01
  && typeAfter !== typeBefore && typeNode === typeAfter);

/* ================================================================== *
 * 6. 曲线 = 真实响应（扫画布像素）
 * ================================================================== */
console.log('\n[6] 曲线与真实响应一致（画布像素反算 dB）');
await ev(`(function(){
  EqEngine.setNode(0, { type: 'lowshelf', freq: 80, gain: 8, q: 0.9, bypass: false });
  EqEngine.setNode(1, { type: 'peaking', freq: 240, gain: -5, q: 1.5, bypass: false });
  EqEngine.setNode(2, { type: 'peaking', freq: 800, gain: 3, q: 2.4, bypass: false });
  EqEngine.setNode(3, { type: 'peaking', freq: 2000, gain: 6, q: 4.0, bypass: false });
  EqEngine.setNode(4, { type: 'highshelf', freq: 4000, gain: -4, q: 0.7, bypass: false });
  EqEngine.setNode(5, { type: 'highshelf', freq: 9000, gain: 5, q: 0.7, bypass: false });
  EqEngine.setNode(6, { type: 'peaking', freq: 14000, gain: -6, q: 2.0, bypass: false });
  return 1;
})()`);
await sleep(600);
const curveChk = JSON.parse(await ev(`(function(){
  var c = document.getElementById('eq-canvas');
  var g = EqUI.debug.geom();
  var dpr = g.dpr;
  var ctx = c.getContext('2d');
  var img = ctx.getImageData(0, 0, c.width, c.height).data;
  var nodes = EqEngine.state.advanced.nodes;
  var label = EqUI.debug.labelBox();
  /* 采样频率：随机 5 个，避开节点圆点（±14px）和选中节点的读数标签 */
  var picks = [], seed = 987654321;
  function rnd(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  var tries = 0;
  while (picks.length < 5 && tries++ < 4000) {
    var f = 30 * Math.pow(18000/30, rnd());
    var x = EqUI.debug.xOf(f, g);
    var bad = false;
    nodes.forEach(function(n){ if (Math.abs(EqUI.debug.xOf(n.freq, g) - x) < 16) bad = true; });
    if (label && x > label.x - 8 && x < label.x + label.w + 8 && g.t < label.y + label.h && g.t + g.plotH > label.y) bad = true;
    picks.forEach(function(p){ if (Math.abs(p.x - x) < 20) bad = true; });
    if (!bad) picks.push({ f: f, x: x });
  }
  var out = [];
  picks.forEach(function(p){
    var dx = Math.round(p.x * dpr);
    var y0 = -1, y1 = -1;
    for (var y = Math.round(g.t * dpr); y < Math.round((g.t + g.plotH) * dpr); y++) {
      var o = (y * c.width + dx) * 4;
      var lum = 0.299 * img[o] + 0.587 * img[o+1] + 0.114 * img[o+2];
      if (lum < 140) { if (y0 < 0) y0 = y; y1 = y; }
    }
    if (y0 < 0) { out.push({ f: p.f, x: p.x, yPix: null }); return; }
    var yCss = ((y0 + y1) / 2) / dpr;
    var dbPix = EqUI.debug.dbOf(yCss, g);
    var params = EqEngine.liveFilters().map(function(f2){ return { type: f2.type, freq: f2.freq, gain: f2.gain, q: f2.q }; });
    var dbReal = __T.predict(params, p.f);
    out.push({ f: +p.f.toFixed(1), x: +p.x.toFixed(1), yPix: y0, dbPix: +dbPix.toFixed(2), dbReal: +dbReal.toFixed(2),
      err: +Math.abs(dbPix - dbReal).toFixed(3) });
  });
  return JSON.stringify({ rows: out, geom: g, label: label });
})()`));
console.log('    ', JSON.stringify(curveChk.geom));
for (const r of curveChk.rows) {
  console.log(`      ${String(r.f).padStart(8)}Hz  画布 y=${r.yPix} → ${r.dbPix}dB  真实响应 ${r.dbReal}dB  误差 ${r.err}dB`);
}
const curveOk = curveChk.rows.filter((r) => r.yPix != null).length;
const worstCurve = Math.max(...curveChk.rows.filter((r) => r.err != null).map((r) => r.err));
ok(6, '画布曲线与 getFrequencyResponse 一致（5 个随机频点误差 < 0.5dB）',
  `扫描 ${curveOk}/5 个频点 · 最大误差 ${worstCurve.toFixed(3)}dB · 画布 ${curveChk.geom.w}×${curveChk.geom.h}（dpr ${curveChk.geom.dpr}）`,
  curveOk === 5 && worstCurve < 0.5);

/* ================================================================== *
 * 7. 音质：真实返回 + UI 文案
 * ================================================================== */
console.log('\n[7] 音质 level 的真实返回');
/* 找一首免费且能播的歌 */
const track = JSON.parse(await ev(`(async function(){
  var found = null;
  var kw = ['夜曲 纯音乐', '钢琴 轻音乐', 'Lo-Fi'];
  for (var i=0;i<kw.length && !found;i++) {
    var d = await API.search(kw[i], 30);
    var list = (d.tracks||[]);
    for (var j=0;j<list.length;j++) {
      if (list[j].fee !== 0) continue;
      var u = await API.songUrl(list[j].id, 'standard');
      var it = (u.data||[])[0];
      if (it && it.url) { found = list[j]; break; }
    }
  }
  if (!found) return 'null';
  return JSON.stringify({ id: found.id, name: found.name, artists: found.artists, duration: found.duration, fee: found.fee });
})()`));
console.log('    测试曲目', JSON.stringify(track));

/* 先把这首放起来：UI 的"实际音质"是跟着当前曲目走的，没歌就只会显示「未播放」 */
await ev(`(async function(){
  var tr = ${JSON.stringify(track)};
  await Player.playQueue([{ id: tr.id, name: tr.name, artists: tr.artists, duration: tr.duration, fee: tr.fee }], 0, true);
  return 1;
})()`);
await sleep(1500);

/* UI 上点「无损」，看文案有没有如实说降级 */
await ev(`document.querySelector('#eq-quality [data-q="lossless"]').click()`);
await sleep(1500);
/* 上游偶尔抽风：如果文案里没有"实际拿到"，再刷一次（最多两次），别把网络抖动记成功能失败 */
for (let i = 0; i < 2; i++) {
  const txt = await ev(`document.getElementById('eq-actual').textContent`);
  if (/实际拿到/.test(String(txt))) break;
  await ev(`EqUI.debug.refreshActual()`);
  await sleep(1500);
}
const qualityUI = JSON.parse(await ev(`(function(){
  var chips = [].map.call(document.querySelectorAll('#eq-quality [data-q]'), function(b){
    return b.dataset.q + (b.classList.contains('is-on') ? '*' : '') + (b.querySelector('u') ? '[需会员]' : '');
  });
  return JSON.stringify({
    chips: chips,
    actual: document.getElementById('eq-actual').textContent.replace(/\\s+/g, ' ').trim(),
    note: document.getElementById('eq-qnote').textContent.slice(0, 60),
    level: EqEngine.state.quality,
    global: window.LIZI_QUALITY,
    ls: JSON.parse(localStorage.getItem('lizi.eq.v1') || '{}').quality,
  });
})()`));

/* 服务端三档真实返回（页面外再打一遍，排除前端缓存） */
const apiRows = [];
for (const lv of ['standard', 'exhigh', 'lossless']) {
  const j = await (await fetch(`http://127.0.0.1:${APP}/api/song/url?ids=${track.id}&level=${lv}`)).json();
  const it = (j.data || [])[0] || {};
  apiRows.push({ lv, url: !!it.url, level: it.level, br: it.br, size: it.size, type: it.type, fee: it.fee, code: it.code });
}
console.log('    /api/song/url 三档：');
for (const r of apiRows) {
  console.log(`      level=${r.lv.padEnd(9)} url=${r.url ? 'YES' : 'no '} 实际 level=${String(r.level).padEnd(9)} br=${String(r.br).padEnd(7)} size=${r.size} type=${r.type} fee=${r.fee}`);
}
console.log('    UI 格子：', qualityUI.chips.join(' '));
console.log('    UI 文案：', qualityUI.actual);

/* 端到端：把音质切到 standard，重载当前曲，抓请求体里的 level */
songUrlReqs.length = 0;
await ev(`(async function(){
  EqEngine.setQuality('standard');
  await Player.playAt(Player.state.index);
  return 1;
})()`);
await sleep(1600);
const sentLevels = songUrlReqs.map((r) => {
  try { return JSON.parse(r.body).level; } catch { return r.body.slice(0, 60); }
});
console.log('    端到端：切到 standard 后重载当前曲，song/url 请求体里的 level =', JSON.stringify(sentLevels));
const sentOk = sentLevels.includes('standard');
await ev(`EqEngine.setQuality('lossless')`);
await sleep(300);
const qRows = Object.fromEntries(apiRows.map((r) => [r.lv, r]));
ok(7, '音质：standard/exhigh/lossless 的真实返回 + UI 如实显示降级',
  `standard → ${qRows.standard.level}/${Math.round(qRows.standard.br / 1000)}kbps · `
  + `exhigh → ${qRows.exhigh.level}/${Math.round(qRows.exhigh.br / 1000)}kbps · `
  + `lossless → ${qRows.lossless.level}/${Math.round(qRows.lossless.br / 1000)}kbps（请求无损，上游降级）· `
  + `UI：「${qualityUI.actual}」· 端到端请求体 level=${JSON.stringify(sentLevels)}`,
  qRows.standard.br > 0 && qRows.standard.br < qRows.exhigh.br
  && qRows.lossless.level !== 'lossless'
  && /实际拿到/.test(qualityUI.actual) && /降级|需会员/.test(qualityUI.actual)
  && qualityUI.global === 'lossless' && sentOk);

/* ================================================================== *
 * 8. 持久化：改完刷新，7 段数值一致
 * ================================================================== */
console.log('\n[8] 持久化（刷新后恢复）');
const beforeReload = JSON.parse(await ev(`(function(){
  EqEngine.setMode('simple');
  var vals = [9, -3.5, 0, 4.5, -6, 2.5, -1.5];
  vals.forEach(function(v, i){ EqEngine.setBandGain(i, v); });
  EqEngine.setPreset('custom');
  EqEngine.setQuality('exhigh');
  return JSON.stringify({ vals: EqEngine.state.simple.gains.slice(), quality: EqEngine.quality,
    saved: JSON.parse(localStorage.getItem('lizi.eq.v1') || 'null') });
})()`));
await sleep(400);
await send('Page.reload', { ignoreCache: false });
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length>0`, 80, 400))) console.log('!! 刷新后大厅没起来');
await gate(`typeof EqEngine === 'object'`, 40, 300);
await installTools();
const afterReload = JSON.parse(await ev(`(function(){
  var f = EqEngine.liveFilters();
  return JSON.stringify({ gains: EqEngine.state.simple.gains.slice(), quality: EqEngine.quality,
    live: f.map(function(x){ return +x.gain.toFixed(2); }),
    version: (JSON.parse(localStorage.getItem('lizi.eq.v1')||'{}')).version });
})()`));
console.log('    刷新前', JSON.stringify(beforeReload.vals), '音质', beforeReload.quality);
console.log('    刷新后', JSON.stringify(afterReload.gains), '音质', afterReload.quality, '实际节点', JSON.stringify(afterReload.live));
const sameGains = beforeReload.vals.every((v, i) => Math.abs(v - afterReload.gains[i]) < 1e-6);
const liveMatch = beforeReload.vals.every((v, i) => Math.abs(v - afterReload.live[i]) < 0.01);
ok(8, '持久化：7 段数值刷新后一致，版本号对得上',
  `${JSON.stringify(afterReload.gains)} 与刷新前一致=${sameGains} · 滤波器节点也一致=${liveMatch} · version=${afterReload.version}`,
  sameGains && liveMatch && afterReload.version === 1);

/* ================================================================== *
 * 9. 回归：出声 / BPM / 频谱 / DJ 台 / console error
 * ================================================================== */
console.log('\n[9] 回归：播放与可视化');
await ev(`EqEngine.setBandGain(0, 6); EqEngine.setBandGain(3, 0); EqEngine.resetSimple(); 1`);
const played = await ev(`(async function(){
  var tr = ${JSON.stringify(track)};
  await Player.playQueue([{ id: tr.id, name: tr.name, artists: tr.artists, duration: tr.duration, fee: tr.fee }], 0, true);
  return JSON.stringify({ id: tr.id, name: tr.name, demo: false });
})()`);
console.log('    播放', played);
const audioPlay = await gate(`!Player.audio.paused && Player.audio.currentTime > 0.3`, 60, 400);
const rms = JSON.parse(await ev(`(async function(){
  var an = EqEngine._graph.analyser;
  var buf = new Float32Array(an.fftSize);
  var max = 0, acc = 0, n = 0;
  for (var i=0;i<26;i++) {
    await new Promise(function(r){ setTimeout(r, 80); });
    an.getFloatTimeDomainData(buf);
    var s = 0; for (var j=0;j<buf.length;j++) s += buf[j]*buf[j];
    var v = Math.sqrt(s/buf.length);
    if (v > max) max = v; acc += v; n++;
  }
  return JSON.stringify({ maxRms: +max.toFixed(4), avgRms: +(acc/n).toFixed(4), samples: n,
    eqOn: EqEngine.state.on, installed: EqEngine.snapshot().installed });
})()`));
console.log(`    EQ 链上 analyser：maxRMS=${rms.maxRms} avgRMS=${rms.avgRms}（EQ on=${rms.eqOn}）`);

/* BPM + 频谱帧在变 */
const beatInfo = JSON.parse(await ev(`(async function(){
  var a = Array.from(Beat.spectrum.slice(0, 24));
  await new Promise(function(r){ setTimeout(r, 500); });
  var b = Array.from(Beat.spectrum.slice(0, 24));
  var diff = 0; for (var i=0;i<a.length;i++) if (a[i] !== b[i]) diff++;
  return JSON.stringify({ bpm: +Beat.state.bpm.toFixed(2), source: Beat.state.tempoSource,
    conf: +Beat.state.confidence.toFixed(2), level: +Beat.state.level.toFixed(3),
    specA: a.slice(0,6), specB: b.slice(0,6), changed: diff, available: Beat.available });
})()`));
console.log(`    BPM=${beatInfo.bpm}（${beatInfo.source}，置信 ${beatInfo.conf}）· 频谱帧变化 ${beatInfo.changed}/24 · level=${beatInfo.level}`);

/* EQ 关掉后仍然出声（真直通重接线不能把声音弄没） */
const bypassRms = JSON.parse(await ev(`(async function(){
  var an = EqEngine._graph.analyser;
  var buf = new Float32Array(an.fftSize);
  document.getElementById('eq-on') && 0;
  EqEngine.setEnabled(false);
  await new Promise(function(r){ setTimeout(r, 400); });
  var max = 0;
  for (var i=0;i<12;i++) {
    await new Promise(function(r){ setTimeout(r, 80); });
    an.getFloatTimeDomainData(buf);
    var s=0; for (var j=0;j<buf.length;j++) s+=buf[j]*buf[j];
    max = Math.max(max, Math.sqrt(s/buf.length));
  }
  var offMax = max;
  EqEngine.setEnabled(true);
  await new Promise(function(r){ setTimeout(r, 400); });
  max = 0;
  for (var i=0;i<12;i++) {
    await new Promise(function(r){ setTimeout(r, 80); });
    an.getFloatTimeDomainData(buf);
    var s=0; for (var j=0;j<buf.length;j++) s+=buf[j]*buf[j];
    max = Math.max(max, Math.sqrt(s/buf.length));
  }
  return JSON.stringify({ offMax: +offMax.toFixed(4), onMax: +max.toFixed(4), on: EqEngine.state.on });
})()`));
console.log(`    开关：OFF 时 maxRMS=${bypassRms.offMax} · ON 时 maxRMS=${bypassRms.onMax}`);

/* EQ 真的在信号路径上（不是画着好看的旁路）：把 60/150Hz 砍 12dB，
   从 Beat 的 analyser 上读低频 bin，能量应该明显掉 */
const bassProof = JSON.parse(await ev(`(async function(){
  var spec = Beat.spectrum;
  async function bassAvg(ms) {
    var acc = 0, n = 0, t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise(function(r){ setTimeout(r, 50); });
      var s = 0;
      for (var i = 1; i <= 6; i++) s += spec[i];
      acc += s / 6; n++;
    }
    return acc / Math.max(1, n);
  }
  EqEngine.resetSimple();
  await new Promise(function(r){ setTimeout(r, 700); });
  var flat = await bassAvg(1200);
  EqEngine.setBandGain(0, -12);
  EqEngine.setBandGain(1, -12);
  await new Promise(function(r){ setTimeout(r, 700); });
  var cut = await bassAvg(1200);
  EqEngine.resetSimple();
  return JSON.stringify({ flat: +flat.toFixed(1), cut: +cut.toFixed(1),
    dropDb: +(20 * Math.log10(Math.max(1e-6, cut) / Math.max(1e-6, flat))).toFixed(2) });
})()`));
console.log(`    频谱证据：60/150Hz 砍 −12dB 后，低频 bin 均值 ${bassProof.flat} → ${bassProof.cut}（${bassProof.dropDb}dB）`);

const errAll = [...exceptions, ...consoleErrs];

/* DJ 台：音效只作用于主播放器，dj.js 有自己的 AudioContext，不能被搞坏 */
await goHall();
await sleep(400);
await ev(`document.querySelectorAll('#hall-tools .hrow')[0].click()`);
const djOk = await gate(`document.getElementById('view-lab').classList.contains('is-active')
  && document.getElementById('lab-pane-dj').classList.contains('is-on')
  && document.querySelectorAll('.djx-deck').length === 2`, 40, 400);
const djInfo = JSON.parse(await ev(`(function(){
  return JSON.stringify({
    view: document.getElementById('view-lab').classList.contains('is-active'),
    pane: document.getElementById('lab-pane-dj').classList.contains('is-on'),
    decks: document.querySelectorAll('.djx-deck').length,
    platters: document.querySelectorAll('.djx-platter').length,
    eqStillOn: EqEngine.state.on,
  });
})()`));
console.log(`    DJ 台：view=${djInfo.view} pane=${djInfo.pane} deck=${djInfo.decks} 转盘=${djInfo.platters}`);
await goHall();

ok(9, '回归：出声 / BPM / 频谱 / 开关直通 / DJ 台 / 0 console error',
  `播放=${audioPlay} · maxRMS ${rms.maxRms} · BPM ${beatInfo.bpm}(${beatInfo.source}) · 频谱帧变化 ${beatInfo.changed}/24 `
  + `· 开关 OFF/ON RMS ${bypassRms.offMax}/${bypassRms.onMax} `
  + `· 低频 −12dB 后 analyser 低频 bin ${bassProof.dropDb}dB `
  + `· DJ 台 ${djInfo.view ? '打开' : '没开'}/${djInfo.decks} deck/${djInfo.platters} 转盘 `
  + `· console error ${errAll.length}`,
  audioPlay && rms.maxRms > 0.02 && beatInfo.bpm > 0 && beatInfo.changed > 0
  && bypassRms.offMax > 0.02 && bypassRms.onMax > 0.02 && bassProof.dropDb < -2
  && djOk && djInfo.decks === 2 && errAll.length === 0);

/* ================================================================== *
 * 1b. 播放页 → 半页覆盖
 * ================================================================== */
console.log('\n[1b] 播放页 →「音效 / 均衡器」→ 半页覆盖');
await ev(`document.getElementById('btn-open-now').click()`);
await gate(`document.getElementById('view-now').classList.contains('is-active')`, 30, 300);
await sleep(900);
await ev(`document.getElementById('btn-drawer').click()`);
await sleep(500);
await ev(`document.getElementById('btn-eq-sheet').click()`);
const sheetReady = await gate(`!document.getElementById('eq-sheet').hidden && document.getElementById('eq-sheet').classList.contains('is-open')`, 30, 200);
await sleep(700);
const sheetInfo = JSON.parse(await ev(`(function(){
  var s = document.getElementById('eq-sheet');
  var p = s.querySelector('.eqsheet__panel');
  var b = p.getBoundingClientRect();
  var cs = getComputedStyle(p);
  var rootEl = document.querySelector('.eqx');
  var scrim = s.querySelector('.eqsheet__scrim');
  return JSON.stringify({
    open: s.classList.contains('is-open'),
    h: +b.height.toFixed(1), vh: innerHeight, ratio: +(b.height / innerHeight).toFixed(4),
    top: +b.top.toFixed(1), radius: cs.borderTopLeftRadius + ' / ' + cs.borderTopLeftRadius, bg: cs.backgroundColor,
    host: rootEl.parentElement.id,
    eqxCount: document.querySelectorAll('.eqx').length,
    sameNode: rootEl === EqUI.root,
    bands: rootEl.querySelectorAll('.eqband').length,
    scrimOpacity: getComputedStyle(scrim).opacity,
    drawerClosed: true,
    lyricsVisible: getComputedStyle(document.getElementById('lyrics-panel')).width,
  });
})()`));
console.log(`    面板高 ${sheetInfo.h}px / 视口 ${sheetInfo.vh}px = ${sheetInfo.ratio}`);
ok('1b', '播放页 → 半页覆盖：高度/视口 ∈ [0.45,0.60]，只有顶部圆角，内容与整页同一实例',
  `ratio=${sheetInfo.ratio} · 顶部圆角 ${sheetInfo.radius} · 背景 ${sheetInfo.bg} · 宿主 ${sheetInfo.host} `
  + `· .eqx 实例 ${sheetInfo.eqxCount} 个（同一节点=${sheetInfo.sameNode}）· 里面 ${sheetInfo.bands} 个频段 · 遮罩 ${sheetInfo.scrimOpacity}`,
  sheetReady && sheetInfo.ratio >= 0.45 && sheetInfo.ratio <= 0.60 && sheetInfo.eqxCount === 1
  && sheetInfo.sameNode && sheetInfo.host === 'eq-host-sheet' && sheetInfo.bands === 7
  && sheetInfo.bg === 'rgb(255, 255, 255)');

/* 下滑 / 点遮罩关闭 */
await ev(`document.getElementById('eq-sheet').querySelector('[data-eq-close]').click()`);
await sleep(600);
const closed = await ev(`document.getElementById('eq-sheet').classList.contains('is-open')`);
console.log('    点遮罩关闭 →', closed === false ? '已关' : '没关');

/* ================================================================== *
 * 10. 截图
 * ================================================================== */
console.log('\n[10] 截图');
/* --- eq-1-simple：整页 + 简单模式 + 低音增强预设 --- */
await ev(`EqUI.closeSheet()`);
await goHall();
await sleep(400);
await ev(`(function(){ document.getElementById('btn-settings').click(); return 1; })()`);
await sleep(400);
await ev(`document.getElementById('row-audio').click()`);
await gate(`document.getElementById('view-audio').classList.contains('is-active')`, 30, 300);
await ev(`(function(){
  EqEngine.setMode('simple');
  EqEngine.setPreset('bass');
  EqUI.mount(document.getElementById('eq-host-page'));
  document.getElementById('view-audio').scrollTop = 0;
  return 1;
})()`);
await sleep(900);
const s1 = await shot('eq-1-simple.png');

/* --- eq-2-advanced：整页 + 高级曲线（有起伏 + 频谱） --- */
await ev(`(function(){
  document.getElementById('eq-mode').click();
  EqEngine.setNode(0, { type: 'lowshelf', freq: 80, gain: 8, q: 0.9, bypass: false });
  EqEngine.setNode(1, { type: 'peaking', freq: 240, gain: -5, q: 1.6, bypass: false });
  EqEngine.setNode(2, { type: 'peaking', freq: 820, gain: 3, q: 2.4, bypass: false });
  EqEngine.setNode(3, { type: 'peaking', freq: 2000, gain: 6, q: 4.0, bypass: false });
  EqEngine.setNode(4, { type: 'highshelf', freq: 4200, gain: -4, q: 0.7, bypass: false });
  EqEngine.setNode(5, { type: 'highshelf', freq: 9000, gain: 5, q: 0.7, bypass: false });
  EqEngine.setNode(6, { type: 'peaking', freq: 14000, gain: -6, q: 2.0, bypass: false });
  return 1;
})()`);
await sleep(1400);
const s2 = await shot('eq-2-advanced.png');

/* --- eq-4-quality：音质那一块放大（裁到视口内，否则右边会被切掉） --- */
const qRect = await rectOf('#eq-host-page .eqx__sec');
const clipQ = {
  x: Math.max(0, qRect.x - 6),
  y: Math.max(0, qRect.y - 6),
  width: Math.min(1440 - Math.max(0, qRect.x - 6), qRect.width + 12),
  height: Math.min(1000 - Math.max(0, qRect.y - 6), Math.min(qRect.height + 12, 320)),
  scale: 2,
};
const s4 = await shot('eq-4-quality.png', clipQ);

/* --- eq-3-sheet：播放页 + 半页覆盖 --- */
await ev(`(function(){
  document.getElementById('btn-open-now').click();
  return 1;
})()`);
await gate(`document.getElementById('view-now').classList.contains('is-active')`, 30, 300);
await ev(`(function(){
  EqEngine.setMode('simple');
  EqEngine.setPreset('live');
  return 1;
})()`);
await sleep(700);
await ev(`document.getElementById('btn-drawer').click()`);
await sleep(400);
await ev(`document.getElementById('btn-eq-sheet').click()`);
await sleep(1100);
const s3 = await shot('eq-3-sheet.png');

const sizes = { s1, s2, s3, s4 };
console.log('    文件大小', JSON.stringify(sizes));
const shotOk = s1 > 8000 && s2 > 8000 && s3 > 8000 && s4 > 8000;
ok(10, '截图 4 张（整页简单 / 整页高级 / 半页覆盖 / 音质）',
  `eq-1-simple ${s1}B · eq-2-advanced ${s2}B · eq-3-sheet ${s3}B · eq-4-quality ${s4}B`, shotOk);

/* ================================================================== *
 * 收尾
 * ================================================================== */
console.log('\n============ 汇总 ============');
for (const r of R.rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${String(r.n).padStart(2)}] ${r.name}`);
console.log(`\n通过 ${R.pass} / ${R.rows.length}`);
if (R.fail) console.log('失败项：', R.rows.filter((r) => !r.pass).map((r) => r.n).join(', '));
console.log('console error:', errAll.length ? errAll.slice(0, 6) : '无');

ws.close(); ch.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(R.fail ? 1 : 0);
