/**
 * _djlab.mjs —— 音乐实验室 DJ 台验收（LAB-DJ.md §6 的 12 条）
 *
 * 只用无头 Chrome + CDP；自己起临时 profile，跑完删掉。
 * 端口从 .port 读，不写死。
 *
 *   node _djlab.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440, H = 1080;
const OUT = 'shots/review';
fs.mkdirSync(OUT, { recursive: true });

const R = { pass: 0, fail: 0, rows: [] };
const ok = (n, name, detail, pass) => {
  R.rows.push({ n, name, detail, pass });
  if (pass) R.pass++; else R.fail++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  [${n}] ${name} —— ${detail}`);
};

/* ---------- 起无头 Chrome ---------- */
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-djlab-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pend = new Map();
const consoleErrs = []; const exceptions = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    exceptions.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 300));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrs.push(m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, timeout: 120000 });
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
  console.log('    →', `${OUT}/${name}`);
};
const rectOf = async (sel) => JSON.parse(await ev(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return 'null';
  const r = e.getBoundingClientRect();
  return JSON.stringify({ x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height });
})()`));

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });

/* ================================================================
 * 0. 进实验室
 * ================================================================ */
console.log('\n[0] 打开音乐实验室');
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length>0`, 60, 500))) {
  console.log('!! 大厅没起来'); process.exit(2);
}
await ev(`document.querySelectorAll('#hall-tools .hrow')[0].click()`);
await gate(`document.getElementById('view-lab')?.classList.contains('is-active')`, 30, 300);
await gate(`!!window.__DJLAB`, 40, 300);

/* ================================================================
 * 1. 页面能开、无 console error
 * ================================================================ */
console.log('\n[1] console error');
await sleep(600);
const viewOk = await ev(`document.getElementById('view-lab')?.classList.contains('is-active') === true
  && document.getElementById('lab-pane-dj')?.classList.contains('is-on') === true`);
const errAll = [...exceptions, ...consoleErrs];
ok(1, '页面能开 + 无 console error',
  `view=${viewOk} exceptions=${exceptions.length} consoleErrors=${consoleErrs.length}` +
  (errAll.length ? ' :: ' + errAll.slice(0, 3).join(' | ') : ''), viewOk && errAll.length === 0);

/* ================================================================
 * 2. DOM 齐全
 * ================================================================ */
console.log('\n[2] DOM');
const dom = JSON.parse(await ev(`(() => {
  const n = (s) => document.querySelectorAll(s).length;
  return JSON.stringify({
    deck: n('.djx-deck'), platter: n('.djx-platter'), wave: n('.djx-wave'), over: n('.djx-over'),
    hotcue: n('.djx-hc__b'), knob: n('.djx-knob'), fader: n('.djx-fader'),
    meter: n('.djx-meter'), libTable: n('#djx-lib'), libBody: n('#djx-lib tbody'),
    xf: n('.djx-xf'), keylock: n('[data-act=keylock]'), sync: n('[data-act=sync]'),
  });
})()`));
const domWant = { deck: 2, platter: 2, wave: 2, over: 2, hotcue: 16, knob: 12, fader: 3, meter: 3, libTable: 1 };
const domDiff = Object.entries(domWant).filter(([k, v]) => dom[k] !== v).map(([k, v]) => `${k}:${dom[k]}≠${v}`);
ok(2, 'DOM 齐全', `deck=${dom.deck} 转盘=${dom.platter} 细节波形=${dom.wave} 概览=${dom.over} 热键=${dom.hotcue} ` +
  `旋钮=${dom.knob} 推子=${dom.fader}（+横推/速度）电平表=${dom.meter}（2 deck + master）曲库表=${dom.libTable}` +
  (domDiff.length ? ' 不符:' + domDiff.join(',') : ''),
  domDiff.length === 0);

/* ================================================================
 * 3. 载入网易云曲目（API 搜一首）
 * ================================================================ */
console.log('\n[3] 载入网易云曲目');
/* 网易云偶尔抽风（song/url 全返回空），搜三首能播的最多重试 3 轮 */
let found = [];
for (let attempt = 0; attempt < 3 && found.length < 2; attempt++) {
  if (attempt) await sleep(1500);
  found = await ev(`(async () => {
    const kws = ['daft punk', 'disclosure', 'moderat', 'starboy', 'daft'];
    const out = [];
    for (const kw of kws) {
      let d;
      try { d = await API.search(kw, 20); } catch (e) { continue; }
      for (const tr of (d.tracks || [])) {
        if (!tr || !tr.id || out.some((x) => x.id === tr.id)) continue;
        try {
          const u = await API.songUrl(tr.id); const it = (u.data || [])[0];
          if (it && it.url) { out.push(tr); }   /* 整条留着：cover 也要带着，否则转盘没封面 */
        } catch (e) { /* 下一首 */ }
        if (out.length >= 4) break;
      }
      if (out.length >= 4) break;
    }
    return out;
  })()`);
}
if (!Array.isArray(found) || found.length < 2) {
  console.log('!! 搜不到能播的歌（网易云接口这会儿不给直链）：', found);
  ws.close(); ch.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  process.exit(2);
}
await ev(`(() => {
  const L = window.__DJLAB;
  const arr = ${JSON.stringify(found || [])};
  L.libAdd(arr.map(t => L.entryFrom(t)));
  L.libRender();
  window.__tracks = arr;
  return arr.length;
})()`);
await ev(`(() => {
  const L = window.__DJLAB, es = L.entries();
  L.loadInto('A', es[0]); if (es[1]) L.loadInto('B', es[1]);
  return 1;
})()`);
const loaded = await gate(`(() => { const d = window.__DJLAB.decks();
  return !!(d.A.buf && d.B.buf && d.A.bpmBase && d.B.bpmBase); })()`, 120, 500);
const loadInfo = JSON.parse(await ev(`(() => { const d = window.__DJLAB.decks();
  return JSON.stringify({
    a: { dur: d.A.dur, bpm: d.A.bpmBase, first: d.A.firstBeat, title: d.A.track && d.A.track.title, peaks: d.A.peaks ? d.A.peaks.length : 0 },
    b: { dur: d.B.dur, bpm: d.B.bpmBase, first: d.B.firstBeat, title: d.B.track && d.B.track.title },
  }); })()`));
console.log('    A:', JSON.stringify(loadInfo.a));
console.log('    B:', JSON.stringify(loadInfo.b));
ok(3, '网易云曲目：时长 > 30s 且 BPM 60~200',
  `A「${loadInfo.a.title}」${loadInfo.a.dur.toFixed(1)}s ${loadInfo.a.bpm.toFixed(2)}BPM 首拍 ${loadInfo.a.first}s 峰值点 ${loadInfo.a.peaks} ; ` +
  `B「${loadInfo.b.title}」${loadInfo.b.dur.toFixed(1)}s ${loadInfo.b.bpm.toFixed(2)}BPM`,
  loaded && loadInfo.a.dur > 30 && loadInfo.b.dur > 30
  && loadInfo.a.bpm >= 60 && loadInfo.a.bpm <= 200 && loadInfo.b.bpm >= 60 && loadInfo.b.bpm <= 200);

/* ================================================================
 * 4. 真出声：analyser 量 RMS
 * ================================================================ */
console.log('\n[4] 真出声');
const rms = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  await E.ctx.resume();
  const an = E.ctx.createAnalyser();
  an.fftSize = 2048;
  E.masterIn.connect(an);
  an.connect(E.meterSink);
  const d = E.decks.A;
  d.seek(20);
  document.querySelector('[data-act="play"][data-deck="A"]').click();
  const buf = new Float32Array(2048);
  let max = 0, acc = 0, n = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 2100) {
    await new Promise((r) => setTimeout(r, 80));
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const v = Math.sqrt(s / buf.length);
    if (v > max) max = v;
    acc += v; n++;
  }
  const state = E.ctx.state;
  E.masterIn.disconnect(an);
  return JSON.stringify({ maxRms: +max.toFixed(4), avgRms: +(acc / Math.max(1, n)).toFixed(4), ctx: state, samples: n });
})()`));
ok(4, '真出声（播放 2s 内 max RMS > 0.02）',
  `maxRMS=${rms.maxRms} avgRMS=${rms.avgRms} ctx=${rms.ctx} 采样 ${rms.samples} 次`, rms.maxRms > 0.02);

/* ================================================================
 * 5. 波形不是空白
 * ================================================================ */
console.log('\n[5] 波形像素');
const wavePix = JSON.parse(await ev(`(() => {
  const c = document.querySelector('#djx-deck-A .djx-wave');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let ink = 0, total = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 12) ink++;
  }
  const o = document.querySelector('#djx-deck-A .djx-over');
  const d2 = o.getContext('2d').getImageData(0, 0, o.width, o.height).data;
  let ink2 = 0;
  for (let i = 0; i < d2.length; i += 4) if (d2[i + 3] > 12) ink2++;
  return JSON.stringify({ pct: +(100 * ink / total).toFixed(2), total, overPct: +(100 * ink2 / (d2.length / 4)).toFixed(2) });
})()`));
ok(5, '波形 canvas 非背景像素 > 15%',
  `细节波形 ${wavePix.pct}% 非透明像素（${wavePix.total} px）· 概览 ${wavePix.overPct}%`, wavePix.pct > 15);

/* ================================================================
 * 6. 变速不变调（频谱质心）
 * ================================================================ */
console.log('\n[6] keylock');
await ev(`(() => {
  window.__centroid = (data, sr) => {
    const N = 16384;
    const re = new Float64Array(N), im = new Float64Array(N);
    const seg = Math.min(N, data.length);
    for (let i = 0; i < N; i++) {
      const v = i < seg ? data[i] : 0;
      re[i] = v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    }
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
    let sum = 0, wsum = 0;
    for (let i = 1; i < N / 2; i++) {
      const m = Math.hypot(re[i], im[i]);
      const f = i * sr / N;
      if (f > 40 && f < 9000) { sum += f * m; wsum += m; }
    }
    return wsum ? sum / wsum : 0;
  };
  return 1;
})()`);
const kl = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const grab = async (rate, keylock) => {
    const buf = await E.renderOffline({ deckKey: 'A', from: 40, seconds: 1.6, rate, keylock });
    const d = buf.getChannelData(0);
    return +window.__centroid(d, buf.sampleRate).toFixed(2);
  };
  const c100 = await grab(1.0, true);
  const c108 = await grab(1.08, true);
  const p108 = await grab(1.08, false);
  return JSON.stringify({
    c100, c108, p108,
    keylockDiff: +(100 * Math.abs(c108 - c100) / c100).toFixed(3),
    plainDiff: +(100 * Math.abs(p108 - c100) / c100).toFixed(3),
  });
})()`));
ok(6, 'keylock：rate 1.0 vs 1.08 质心差 < 3%；关掉后 > 3%',
  `质心 ${kl.c100}Hz → keylock ${kl.c108}Hz（差 ${kl.keylockDiff}%）· 关 keylock ${kl.p108}Hz（差 ${kl.plainDiff}%）`,
  kl.keylockDiff < 3 && kl.plainDiff > 3);

/* ================================================================
 * 7. SYNC
 * ================================================================ */
console.log('\n[7] SYNC');
const syn = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const before = { a: E.decks.A.bpmNow, b: E.decks.B.bpmNow };
  document.querySelector('[data-act="sync"][data-deck="B"]').click();
  await new Promise((r) => setTimeout(r, 250));
  const after = { a: E.decks.A.bpmNow, b: E.decks.B.bpmNow };
  const err = Math.abs(after.b - after.a) / Math.max(1e-9, after.a) * 100;
  return JSON.stringify({ before, after, err: +err.toFixed(4), rate: +E.decks.B.rate.toFixed(5), range: E.decks.B.range });
})()`));
ok(7, 'SYNC：两 deck 相对误差 < 0.2%',
  `A ${syn.before.a.toFixed(2)} → ${syn.after.a.toFixed(2)} BPM · B ${syn.before.b.toFixed(2)} → ${syn.after.b.toFixed(2)} BPM ` +
  `· 相对误差 ${syn.err}% · B rate ${syn.rate} · 档位 ±${syn.range}%`, syn.err < 0.2);

/* ================================================================
 * 8. Loop
 * ================================================================ */
console.log('\n[8] Loop');
const loop = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const d = E.decks.B;
  d.seek(50);
  document.querySelector('[data-beat="4"][data-deck="B"]').click();
  const a = d.loop.a, b = d.loop.b;
  document.querySelector('[data-act="play"][data-deck="B"]').click();
  const xs = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 2000) {
    xs.push(d.audioPos());
    await new Promise((r) => setTimeout(r, 40));
  }
  d.pause();
  const min = Math.min(...xs), max = Math.max(...xs);
  const inside = xs.every((x) => x >= a - 0.02 && x <= b + 0.02);
  const wraps = xs.some((x, i) => i > 0 && x < xs[i - 1] - 0.05);
  return JSON.stringify({
    a: +a.toFixed(3), b: +b.toFixed(3), len: +(b - a).toFixed(3),
    beat: +(60 / d.bpmNow).toFixed(3),
    min: +min.toFixed(3), max: +max.toFixed(3), inside, wraps, n: xs.length,
    on: d.loop.on,
  });
})()`));
ok(8, 'Loop：4 拍 loop，2s 内位置始终在区间内',
  `区间 ${loop.a}–${loop.b}s（长 ${loop.len}s = 4 拍 × ${loop.beat}s）· 实测 ${loop.min}–${loop.max}s ` +
  `· 全在区间=${loop.inside} · 检测到回绕=${loop.wraps} · 采样 ${loop.n} 次`, loop.inside && loop.on);

/* ================================================================
 * 9. 热键
 * ================================================================ */
console.log('\n[9] 热键');
const hc = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const d = E.decks.A;
  d.seek(41.5);
  if (!d.playing) document.querySelector('[data-act="play"][data-deck="A"]').click();
  await new Promise((r) => setTimeout(r, 120));
  document.querySelector('[data-hc="3"][data-deck="A"]').click();
  const setAt = d.audioPos();
  const stored = d.hotcues[2];
  d.seek(96.0);
  await new Promise((r) => setTimeout(r, 120));
  const mid = d.audioPos();
  document.querySelector('[data-hc="3"][data-deck="A"]').click();
  const after = d.audioPos();
  const ls = localStorage.getItem('lizi.dj.cues.' + (d.track && d.track.key));
  return JSON.stringify({
    setAt: +setAt.toFixed(4), stored: stored == null ? null : +stored.toFixed(4),
    mid: +mid.toFixed(4), after: +after.toFixed(4),
    errMs: +Math.abs(after - setAt) * 1000, ls: ls ? JSON.parse(ls) : null,
  });
})()`));
ok(9, '热键：设 3 号 → 跳到别处 → 点击跳回，误差 < 50ms',
  `set@${hc.setAt}s → 跳到 ${hc.mid}s → 点回 ${hc.after}s · 误差 ${hc.errMs.toFixed(1)}ms ` +
  `· localStorage 命中=${!!hc.ls && Array.isArray(hc.ls.cues)}`, hc.errMs < 50 && !!hc.ls);

/* ================================================================
 * 10. 横推
 * ================================================================ */
console.log('\n[10] 横推');
const xf = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const sr = 44100, N = 4410;
  const mk = () => {
    const off = new OfflineAudioContext(2, N * 4, sr);
    return off;
  };
  /* 用真音频量增益：白噪 → gain(A) → destination */
  const measure = async (gain) => {
    const off = new OfflineAudioContext(2, N, sr);
    const b = off.createBuffer(2, N, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < N; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    }
    const s = off.createBufferSource(); s.buffer = b;
    const g = off.createGain(); g.gain.value = gain;
    s.connect(g).connect(off.destination); s.start();
    const out = await off.startRendering();
    let si = 0, so = 0;
    const di = b.getChannelData(0), doo = out.getChannelData(0);
    for (let i = 0; i < N; i++) { si += di[i] * di[i]; so += doo[i] * doo[i]; }
    return { gain, db: +(10 * Math.log10(so / si)).toFixed(3) };
  };
  const rows = [];
  for (const x of [-1, -0.5, 0, 0.5, 1]) {
    E.setCross(x);
    const g = E.crossGains();
    const ma = await measure(g.a);
    const mb = await measure(g.b);
    rows.push({ x, a: +g.a.toFixed(5), b: +g.b.toFixed(5), aDb: ma.db, bDb: mb.db });
  }
  E.setCross(0);
  const center = rows.find((r) => r.x === 0);
  const monoA = rows.every((r, i) => i === 0 || r.a <= rows[i - 1].a + 1e-9);
  const monoB = rows.every((r, i) => i === 0 || r.b >= rows[i - 1].b - 1e-9);
  /* sharp 曲线也量一下 */
  E.setCrossCurve('sharp');
  const sharp = [];
  for (const x of [-1, 0, 1]) { E.setCross(x); const g = E.crossGains(); sharp.push({ x, a: +g.a.toFixed(4), b: +g.b.toFixed(4) }); }
  E.setCrossCurve('power'); E.setCross(0);
  return JSON.stringify({ rows, center, monoA, monoB, sharp });
})()`));
const cd = xf.center.aDb;
ok(10, '横推：A 单调降 / B 单调升 / 居中 ≈ -3dB',
  `A 增益 ${xf.rows.map((r) => r.aDb).join(' → ')} dB · B ${xf.rows.map((r) => r.bDb).join(' → ')} dB ` +
  `· 居中 ${cd} dB（±0.3）· A单调=${xf.monoA} B单调=${xf.monoB} · sharp 居中 ${xf.sharp[1].a}/-9dB 档`,
  xf.monoA && xf.monoB && Math.abs(cd + 3.01) <= 0.3);

/* ================================================================
 * 11. 本地文件（构造 WAV 派发 drop）
 * ================================================================ */
console.log('\n[11] 本地文件 drop');
const wav = JSON.parse(await ev(`(async () => {
  const sr = 44100, sec = 2.0, n = sr * sec;
  const bytes = 44 + n * 4;                     // 16bit stereo
  const ab = new ArrayBuffer(bytes);
  const dv = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 2000, (n - i) / 2000);
    const v = Math.round(12000 * env * (0.6 * Math.sin(2 * Math.PI * 220 * i / sr) + 0.4 * Math.sin(2 * Math.PI * 440 * i / sr)));
    dv.setInt16(o, v, true); dv.setInt16(o + 2, v, true); o += 4;
  }
  const file = new File([ab], 'djlab-2s.wav', { type: 'audio/wav' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const evt = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
  document.getElementById('djx-deck-B').dispatchEvent(evt);
  return JSON.stringify({ size: file.size, name: file.name });
})()`));
const dropOk = await gate(`(() => { const d = window.__DJLAB.decks().B;
  return !!d.buf && Math.abs(d.dur - 2) < 0.1; })()`, 80, 400);
const dropInfo = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const d = E.decks.B;
  const an = E.ctx.createAnalyser(); an.fftSize = 2048;
  d.nodes.post.connect(an); an.connect(E.meterSink);
  d.seek(0.2);
  d.play();
  const buf = new Float32Array(2048);
  let max = 0;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 80));
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let j = 0; j < buf.length; j++) s += buf[j] * buf[j];
    max = Math.max(max, Math.sqrt(s / buf.length));
  }
  const dur = d.dur, title = d.track && d.track.title, bpm = d.bpmBase;
  d.pause();
  d.nodes.post.disconnect(an);
  return JSON.stringify({ dur: +dur.toFixed(3), title, bpm, rms: +max.toFixed(4), playing: d.playing });
})()`));
ok(11, '本地文件：drop 后能播、时长 ≈ 2s',
  `文件 ${wav.name} ${wav.size}B → B 台时长 ${dropInfo.dur}s · 播放 RMS ${dropInfo.rms} · 标题「${dropInfo.title}」· BPM ${dropInfo.bpm}`,
  dropOk && Math.abs(dropInfo.dur - 2) < 0.1 && dropInfo.rms > 0.02);

/* ================================================================
 * 12. 截图
 * ================================================================ */
console.log('\n[12] 截图');
/* 先把 B 换回真歌（第 11 条用的是 2s 测试 WAV），并让它 SYNC + 设一个 8 拍 loop，
   这样四张图里两台 deck 都是真实数据，loop 区间／热键／拍网格也都看得见 */
await ev(`(async () => {
  const L = window.__DJLAB;
  const real = L.entries().filter((e) => e.kind === 'netease' && e.dur > 60);
  await L.loadInto('B', real[real.length - 1]);
  document.querySelector('[data-act="sync"][data-deck="B"]').click();
  const d = L.decks().B;
  d.seek(62);
  document.querySelector('[data-beat="8"][data-deck="B"]').click();
  d.seek(63.2);
  return 1;
})()`);
await ev(`(() => {
  const d = window.__DJLAB.decks();
  d.A.seek(45); d.A.play();
  document.getElementById('view-lab').scrollTop = 0;
  window.__DJLAB.paint();
  return 1;
})()`);
await sleep(1100);
await shot('dj-1-overall.png');
const rDeck = await rectOf('#djx-deck-A');
await shot('dj-2-deck-a.png', { ...rDeck, scale: 2 });
const rPlat = await rectOf('#djx-deck-A .djx-platter-wrap');
await shot('dj-5-cover.png', { ...rPlat, scale: 3 });
await ev(`(() => { const el = document.getElementById('djx-lib-wrap'); el.scrollIntoView({block:'end'}); return el.getBoundingClientRect().top; })()`);
await sleep(600);
const rLib = await rectOf('#djx-lib-wrap');
await shot('dj-3-library.png', { ...rLib, scale: 2 });
const rMix = await rectOf('#djx-mix');
await shot('dj-4-mixer.png', { ...rMix, scale: 2 });
const shots = ['dj-1-overall.png', 'dj-2-deck-a.png', 'dj-3-library.png', 'dj-4-mixer.png', 'dj-5-cover.png'];
const shotOk = shots.every((f) => fs.existsSync(`${OUT}/${f}`) && fs.statSync(`${OUT}/${f}`).size > 8000);
ok(12, '截图 ≥ 5 张（整体 / A deck / 曲库 / 混音台 / 转盘封面）', shots.join(' · '), shotOk);

/* ================================================================
 * 附加：搓碟 / 键盘 / 旋钮 / 速度推子（不在 §6 的 12 条里，但必须真能用）
 * ================================================================ */
console.log('\n[E1] 搓碟（拖转盘）');
const platter = JSON.parse(await ev(`(() => {
  const r = document.querySelector('#djx-deck-A .djx-platter').getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 });
})()`));
await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const d = E.decks.A;
  d.seek(60); d.play();
  window.__scrAn = E.ctx.createAnalyser(); window.__scrAn.fftSize = 1024;
  d.nodes.post.connect(window.__scrAn); window.__scrAn.connect(E.meterSink);
  await new Promise((r) => setTimeout(r, 200));
  return 1;
})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: platter.x, y: platter.y - platter.r * 0.7, button: 'none', clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: platter.x, y: platter.y - platter.r * 0.7, button: 'left', buttons: 1, clickCount: 1 });
let scrMax = 0;
const posBefore = await ev(`window.__DJLAB.decks().A.audioPos()`);
for (let i = 1; i <= 16; i++) {
  const a = (-90 + i * 13) * Math.PI / 180;
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: platter.x + Math.cos(a) * platter.r * 0.7,
    y: platter.y + Math.sin(a) * platter.r * 0.7, button: 'left', buttons: 1,
  });
  await sleep(28);
  const r = await ev(`(() => { const b = new Float32Array(1024); window.__scrAn.getFloatTimeDomainData(b);
    let s = 0; for (const v of b) s += v * v; return Math.sqrt(s / b.length); })()`);
  scrMax = Math.max(scrMax, Number(r) || 0);
}
const scrState = JSON.parse(await ev(`(() => { const d = window.__DJLAB.decks().A;
  return JSON.stringify({ scratching: d.scratching, rate: +d.scrRate.toFixed(2), pos: +d.pos.toFixed(2), playing: d.playing }); })()`));
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: platter.x, y: platter.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(600);
const scrAfter = JSON.parse(await ev(`(() => { const d = window.__DJLAB.decks().A;
  return JSON.stringify({ scratching: d.scratching, playing: d.playing, pos: +d.audioPos().toFixed(2) }); })()`));
console.log(`    搓碟中：scratching=${scrState.scratching} scrRate=${scrState.rate} 播放头 ${posBefore.toFixed(2)}→${scrState.pos}s · 颗粒 RMS 峰值 ${scrMax.toFixed(4)}`);
console.log(`    松手后：scratching=${scrAfter.scratching} playing=${scrAfter.playing} pos=${scrAfter.pos}s`);
ok('E1', '搓碟：拖动时进入搓碟态、有颗粒声、松手回 1.0 并继续',
  `拖动中 scratching=${scrState.scratching} rate=${scrState.rate} · 颗粒 RMS ${scrMax.toFixed(4)} · 松手后 playing=${scrAfter.playing}`,
  scrState.scratching === true && scrMax > 0.01 && scrAfter.scratching === false && scrAfter.playing === true);

console.log('\n[E2] 键盘');
const kb = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const d = E.decks.A;
  const fire = (key, opts) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
  d.pause();
  fire(' ');                                    // A 播放
  await new Promise((r) => setTimeout(r, 150));
  const afterSpace = d.playing;
  fire(' ');
  await new Promise((r) => setTimeout(r, 100));
  const afterSpace2 = d.playing;
  d.seek(30);
  fire('c');                                    // 暂停时 CUE = 设点
  const cue = d.cue;
  d.seek(70); d.play();                         // 播放中再按 CUE = 回跳 + 暂停
  await new Promise((r) => setTimeout(r, 150));
  fire('c');
  await new Promise((r) => setTimeout(r, 120));
  const backToCue = d.audioPos();
  const pausedByCue = !d.playing;
  d.seek(33);
  fire('5');                                    // A 热键 5 = 设点
  const hc5 = d.hotcues[4];
  d.seek(12);
  fire('5');                                    // 再按 = 跳回
  const jump = d.audioPos();
  fire('[');                                    // A loop 开关
  const loopOn = d.loop.on;
  E.setCross(0.9); fire('\\\\');
  const cross = E.cross;
  return JSON.stringify({
    afterSpace, afterSpace2, cue, backToCue: +backToCue.toFixed(3), pausedByCue,
    hc5: hc5 == null ? null : +hc5.toFixed(3), jump: +jump.toFixed(3), loopOn, cross,
  });
})()`));
console.log('    ', JSON.stringify(kb));
ok('E2', '键盘：Space / C / 1-8 / [ / \\ 都生效',
  `Space 播放=${kb.afterSpace}→暂停=${kb.afterSpace2} · C 设点 ${kb.cue.toFixed(2)}s · 再按回跳 ${kb.backToCue}s ` +
  `· 热键 5 设于 ${kb.hc5} 跳回 ${kb.jump} · [ loop=${kb.loopOn} · \\ 横推=${kb.cross}`,
  kb.afterSpace === true && kb.afterSpace2 === false && kb.pausedByCue === true && Math.abs(kb.backToCue - kb.cue) < 0.05
  && kb.hc5 != null && Math.abs(kb.jump - kb.hc5) < 0.05 && kb.cross === 0 && kb.loopOn === true);

console.log('\n[E3] EQ：旋钮拖动 + 双击回中 + 真的改变声音');
const knob = JSON.parse(await ev(`(() => {
  const r = document.querySelector('.djx-knob[data-knob="low"][data-deck="A"]').getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
})()`));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: knob.x, y: knob.y, button: 'none', clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: knob.x, y: knob.y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 6; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: knob.x, y: knob.y - i * 10, button: 'left', buttons: 1 });
  await sleep(25);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: knob.x, y: knob.y - 60, button: 'left', buttons: 0, clickCount: 1 });
await sleep(200);
const knobUp = JSON.parse(await ev(`(() => { const d = window.__DJLAB.engine().decks.A;
  return JSON.stringify({ ctl: +window.__DJLAB.state.ctl.A.low.toFixed(3), cmdDb: +d.eqDb.low.toFixed(2),
    rot: document.querySelector('.djx-knob[data-knob="low"][data-deck="A"]').style.getPropertyValue('--rot') }); })()`));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: knob.x, y: knob.y, button: 'left', buttons: 1, clickCount: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: knob.x, y: knob.y, button: 'left', buttons: 0, clickCount: 2 });
await sleep(200);
const knobReset = JSON.parse(await ev(`(() => { const d = window.__DJLAB.engine().decks.A;
  return JSON.stringify({ ctl: +window.__DJLAB.state.ctl.A.low.toFixed(3), cmdDb: +d.eqDb.low.toFixed(2) }); })()`));

/* 听得出才算数：拿 B 台那个恒定 220+440Hz 的测试 WAV，反复量推子后的 RMS */
const eqRms = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const d = E.decks.B;
  d.loop = { on: true, a: 0.05, b: 1.9 };
  const an = E.ctx.createAnalyser(); an.fftSize = 2048;
  d.nodes.post.connect(an); an.connect(E.meterSink);
  await E.ctx.resume();
  d.seek(0.1); d.play();
  const meas = async (v) => {
    d.setEq('low', v);
    await new Promise((r) => setTimeout(r, 220));
    const b = new Float32Array(2048);
    let acc = 0, n = 0;
    for (let k = 0; k < 6; k++) {
      await new Promise((r) => setTimeout(r, 60));
      an.getFloatTimeDomainData(b);
      let s = 0;
      for (let i = 0; i < b.length; i++) s += b[i] * b[i];
      acc += Math.sqrt(s / b.length); n++;
    }
    return +(acc / n).toFixed(5);
  };
  const kill = await meas(0);
  const flat = await meas(0.5);
  const boost = await meas(1);
  d.setEq('low', 0.5);
  d.pause();
  d.loop = { on: false, a: 0, b: 0 };
  d.nodes.post.disconnect(an);
  return JSON.stringify({ kill, flat, boost });
})()`));
console.log(`    旋钮上拖 → ctl=${knobUp.ctl} 命令 ${knobUp.cmdDb}dB 角 ${String(knobUp.rot).trim()} · 双击 → ${knobReset.ctl} / ${knobReset.cmdDb}dB`);
console.log(`    推子后 RMS：kill(-80dB)=${eqRms.kill} < 0dB=${eqRms.flat} < +6dB=${eqRms.boost}`);
ok('E3', 'EQ：拖动改值、双击回 0dB、kill 真的把低频掐掉（RMS 单调）',
  `上拖 ${knobUp.cmdDb}dB → 双击 ${knobReset.cmdDb}dB · RMS kill ${eqRms.kill} / 平 ${eqRms.flat} / 提升 ${eqRms.boost}`,
  knobUp.ctl > 0.55 && Math.abs(knobReset.cmdDb) < 0.3
  && eqRms.kill < eqRms.flat * 0.9 && eqRms.flat < eqRms.boost);
console.log('\n[E4] 速度推子');
const pf = JSON.parse(await ev(`(() => {
  const r = document.querySelector('[data-fader="pitch"][data-deck="A"] .djx-pitchf__track').getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom, h: r.height });
})()`));
await ev(`(async () => { const d = window.__DJLAB.decks().A; d.seek(20); if (!d.playing) d.play(); return 1; })()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pf.x, y: pf.bottom - 4, button: 'none', clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pf.x, y: pf.bottom - 4, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pf.x, y: pf.top + 2, button: 'left', buttons: 1 });
await sleep(120);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pf.x, y: pf.top + 2, button: 'left', buttons: 0, clickCount: 1 });
await sleep(300);
const rateA = JSON.parse(await ev(`(() => { const E = window.__DJLAB.engine(); const d = E.decks.A;
  const k = E.ctx.createAnalyser(); k.fftSize = 1024;
  return JSON.stringify({ pitch: +d.pitchPct.toFixed(2), rate: +d.rate.toFixed(4), bpm: +d.bpmNow.toFixed(2),
    srcRate: d.src ? +d.src.playbackRate.value.toFixed(4) : null }); })()`));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pf.x, y: pf.top + 2, button: 'left', buttons: 1, clickCount: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pf.x, y: pf.top + 2, button: 'left', buttons: 0, clickCount: 2 });
await sleep(300);
const rateB = JSON.parse(await ev(`(() => { const d = window.__DJLAB.engine().decks.A;
  return JSON.stringify({ pitch: +d.pitchPct.toFixed(2), rate: +d.rate.toFixed(4) }); })()`));
console.log(`    拖到 65% → ${JSON.stringify(rateA)} · 双击后 ${JSON.stringify(rateB)}`);
ok('E4', '速度推子：拖动改速率（BPM 跟着变）、双击回 0',
  `推子 65% → pitch ${rateA.pitch}% rate ${rateA.rate} BPM ${rateA.bpm}（源 playbackRate ${rateA.srcRate}）· 双击 → ${rateB.pitch}% / ${rateB.rate}`,
  Math.abs(rateA.pitch - 8) < 0.6 && Math.abs(rateB.pitch) < 0.01);

console.log('\n[E5] 另外两个分页没被搞坏（自动过渡 / 插件）');
await ev(`document.querySelector('#lab-tabs [data-tab="xfade"]').click()`);
await sleep(400);
const xfPane = JSON.parse(await ev(`(() => {
  const c = document.getElementById('xfade-curve');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
  return JSON.stringify({
    pane: document.getElementById('lab-pane-xfade').classList.contains('is-on'),
    djPane: document.getElementById('lab-pane-dj').classList.contains('is-on'),
    ink: n,
    a: document.getElementById('xfade-a').textContent,
    b: document.getElementById('xfade-b').textContent,
    run: !document.getElementById('xfade-run').disabled,
  });
})()`));
/* 自动过渡要 Player 队列里有两首歌；无头会话没播过歌，先塞一个队列 */
await ev(`(() => {
  const L = window.__DJLAB;
  const tracks = L.entries().filter((e) => e.kind === 'netease' && e.dur > 30)
    .map((e) => ({ id: e.id, name: e.title, artists: e.artist, duration: e.dur * 1000 }));
  if (typeof Player !== 'undefined') Player.playQueue(tracks, 0, false);
  return tracks.length;
})()`);
await ev(`document.getElementById('xfade-run').click()`);
let xfRun = '';
for (let i = 0; i < 48; i++) {          // 「跑一遍」要下两首完整音频再解码，给足 24s
  await sleep(500);
  xfRun = String(await ev(`document.getElementById('lab-sub').textContent`));
  if (/过渡中|过渡完成|失败|至少/.test(xfRun)) break;
}
const xfQueue = await ev(`(typeof Player !== 'undefined' && Player.state.queue || []).length`);
await ev(`document.querySelector('#lab-tabs [data-tab="vst"]').click()`);
await sleep(300);
const vstPane = await ev(`document.getElementById('lab-pane-vst').classList.contains('is-on')`);
await ev(`document.querySelector('#lab-tabs [data-tab="dj"]').click()`);
await sleep(500);
const backOk = JSON.parse(await ev(`(() => JSON.stringify({
  pane: document.getElementById('lab-pane-dj').classList.contains('is-on'),
  rafAlive: !!window.__DJLAB,
  aBuf: !!(window.__DJLAB && window.__DJLAB.decks().A.buf),
}))()`));
console.log(`    自动过渡：曲线画布 ${xfPane.ink} 个不透明像素 · 跑一遍后副标题「${xfRun}」· 插件页 ${vstPane} · 切回 DJ 台 ${JSON.stringify(backOk)}`);
ok('E5', '分页切换：自动过渡能跑、插件页正常、切回 DJ 台状态还在',
  `曲线像素 ${xfPane.ink} · 过渡「${xfRun}」· vst=${vstPane} · 回 DJ 台 pane=${backOk.pane} A 台还在=${backOk.aBuf}`,
  xfPane.pane && !xfPane.djPane && xfPane.ink > 1000 && xfPane.run && vstPane === true
  && backOk.pane === true && backOk.aBuf === true);
/* ================================================================
 * C1. 转盘中央的专辑封面
 * ================================================================ */
console.log('\n[C1] 转盘封面');
const waitImgs = `(async () => {
  const imgs = [...document.querySelectorAll('.djx-platter__cover')];
  const one = (im) => new Promise((res) => {
    if (im.complete && im.naturalWidth) return res();
    im.addEventListener('load', res, { once: true });
    im.addEventListener('error', res, { once: true });
    setTimeout(res, 4000);
  });
  await Promise.all(imgs.map(one));
  return 1;
})()`;
await ev(waitImgs);
const cov = JSON.parse(await ev(`(() => {
  const imgs = [...document.querySelectorAll('.djx-platter__cover')];
  const d = window.__DJLAB.decks();
  const info = (im, dk) => ({
    src: (im.currentSrc || im.src || '').slice(0, 120),
    nw: im.naturalWidth,
    real: im.dataset.real,
    empty: im.classList.contains('is-empty'),
    title: dk.track && dk.track.title,
  });
  return JSON.stringify({ a: info(imgs[0], d.A), b: info(imgs[1], d.B) });
})()`));
console.log('    A:', JSON.stringify(cov.a));
console.log('    B:', JSON.stringify(cov.b));

/* 换一首歌，封面要跟着换 */
const swap = JSON.parse(await ev(`(async () => {
  const L = window.__DJLAB;
  const es = L.entries();
  const aKey = L.decks().A.track && L.decks().A.track.key;
  const other = es.find((e) => e.kind === 'netease' && e.key !== aKey) || es[0];
  const before = document.querySelectorAll('.djx-platter__cover')[0].src;
  await L.loadInto('A', other);
  const im = document.querySelectorAll('.djx-platter__cover')[0];
  /* 封面是在 rAF 的 paintDeck 里换 src 的，等它真的变（不是等 load） */
  await new Promise((res) => {
    const t0 = performance.now();
    const tick = () => {
      const cur = im.currentSrc || im.src || '';
      if (cur && cur !== before) return res();
      if (performance.now() - t0 > 5000) return res();
      requestAnimationFrame(tick);
    };
    tick();
  });
  await new Promise((res) => {
    if (im.complete && im.naturalWidth) return res();
    im.addEventListener('load', res, { once: true });
    setTimeout(res, 4000);
  });
  const after = im.currentSrc || im.src || '';
  return JSON.stringify({ before, after, same: before === after,
    beforeShort: before.slice(-46), afterShort: after.slice(-46),
    nw: im.naturalWidth, title: L.decks().A.track && L.decks().A.track.title });
})()`));
console.log('    换歌:', JSON.stringify(swap));
ok('C1', '两台 deck 的转盘中央是真封面（naturalWidth > 80），换歌跟着变',
  `A nw=${cov.a.nw} real=${cov.a.real}「${cov.a.title}」· B nw=${cov.b.nw} real=${cov.b.real}「${cov.b.title}」`
  + ` · 换歌后 nw=${swap.nw}「${swap.title}」${swap.before !== swap.after ? ' src 已变' : ' src 未变!'}`,
  cov.a.nw > 80 && cov.b.nw > 80 && cov.a.real === '1' && cov.b.real === '1'
  && swap.nw > 80 && swap.same === false);

/* 本地文件的 ID3 内嵌封面：造一个带 APIC 的文件，直接验解析 */
const id3 = JSON.parse(await ev(`(async () => {
  /* 用一段 200×200 的 SVG 当内嵌图（省得打一套 PNG 编码器） */
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#c33"/><circle cx="100" cy="100" r="60" fill="#fff"/></svg>');
  const mime = 'image/svg+xml';
  const desc = 0;
  /* APIC body: enc(1) + mime\\0 + type(1) + desc\\0 + data */
  const bodyLen = 1 + mime.length + 1 + 1 + 1 + svg.length;
  const tagLen = 10 + 10 + bodyLen;
  const u8 = new Uint8Array(tagLen);
  let p = 0;
  u8[p++] = 0x49; u8[p++] = 0x44; u8[p++] = 0x33;   // ID3
  u8[p++] = 3; u8[p++] = 0; u8[p++] = 0;            // v2.3 / flags 0
  const sz = bodyLen + 10;
  u8[p++] = (sz >> 21) & 0x7f; u8[p++] = (sz >> 14) & 0x7f; u8[p++] = (sz >> 7) & 0x7f; u8[p++] = sz & 0x7f;
  const put = (s) => { for (let i = 0; i < s.length; i++) u8[p++] = s.charCodeAt(i); };
  put('APIC');
  const fs = bodyLen;
  u8[p++] = (fs >>> 24) & 255; u8[p++] = (fs >>> 16) & 255; u8[p++] = (fs >>> 8) & 255; u8[p++] = fs & 255;
  u8[p++] = 0; u8[p++] = 0;                          // flags
  u8[p++] = 0;                                       // enc latin1
  put(mime); u8[p++] = 0;                            // mime + 0
  u8[p++] = 3;                                       // picture type: front cover
  u8[p++] = desc;                                    // 空描述 + 0
  u8.set(svg, p);
  const file = new File([u8], 'id3-test.mp3', { type: 'audio/mpeg' });
  const url = await window.__DJLAB.coverFromFile(file);
  const im = new Image();
  im.src = url;
  await new Promise((res) => { im.onload = res; im.onerror = res; setTimeout(res, 3000); });
  return JSON.stringify({ url: url.slice(0, 24), w: im.naturalWidth, h: im.naturalHeight, bytes: u8.length });
})()`));
console.log('    ID3 内嵌封面:', JSON.stringify(id3));
ok('C1b', '本地文件 ID3v2(APIC) 内嵌封面能抠出来',
  `造的 ID3 文件 ${id3.bytes}B → 取出 ${id3.url}… ${id3.w}×${id3.h}`,
  id3.w > 0 && id3.h > 0);

/* ================================================================
 * C2. 退出碟机 = 暂停（不是清零），且完全没声
 * ================================================================ */
console.log('\n[C2] 退出即暂停');
const px = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const d = E.decks.A;
  await E.ctx.resume();
  if (!d.playing) { d.seek(30); d.play(); }
  await new Promise((r) => setTimeout(r, 450));
  const an = E.ctx.createAnalyser();
  an.fftSize = 2048;
  E.masterIn.connect(an);
  an.connect(E.meterSink);
  /* 前置条件（很重要）：E5 跑过「自动过渡 → 跑一遍」，那两个一次性 BufferSource
     会在共享 master 上响 ~8s。第一版没掐它，这里量到 maxRMS=0.1115，看起来像
     「deck 没静音」，其实是上一段演示的余音。先点 #xfade-stop 再量。 */
  const stopDemo = document.getElementById('xfade-stop');
  if (stopDemo) stopDemo.click();
  await new Promise((r) => setTimeout(r, 300));
  const before = { pos: d.audioPos(), playing: d.playing, title: d.track && d.track.title };
  document.querySelector('#lab-tabs [data-tab="xfade"]').click();
  const t0 = performance.now();
  let maxRms = 0, peak = 0;
  const buf = new Float32Array(2048);
  while (performance.now() - t0 < 2000) {
    await new Promise((r) => setTimeout(r, 70));
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) { s += buf[i] * buf[i]; peak = Math.max(peak, Math.abs(buf[i])); }
    maxRms = Math.max(maxRms, Math.sqrt(s / buf.length));
  }
  const during = { playing: d.playing, pos: d.audioPos(), status: d.status };
  document.querySelector('#lab-tabs [data-tab="dj"]').click();
  await new Promise((r) => setTimeout(r, 400));
  const after = {
    playing: d.playing, pos: d.audioPos(), status: d.status,
    djPane: document.getElementById('lab-pane-dj').classList.contains('is-on'),
    title: d.track && d.track.title,
  };
  E.masterIn.disconnect(an);
  return JSON.stringify({ before, during, after, maxRms: +maxRms.toFixed(5), peak: +peak.toFixed(5),
    drift: +(after.pos - before.pos).toFixed(4) });
})()`));
console.log('    ', JSON.stringify(px));
ok('C2', '切到「自动过渡」分页：2s 内 maxRMS < 0.005，切回来还是暂停在原位',
  `离开前 ${px.before.pos.toFixed(3)}s（播放中）→ 2s 内 maxRMS=${px.maxRms}（峰值 ${px.peak}）`
  + ` → 回来后 playing=${px.after.playing}、pos=${px.after.pos.toFixed(3)}s、漂移 ${px.drift}s、状态「${px.after.status}」`,
  px.maxRms < 0.005 && px.during.playing === false && px.after.playing === false
  && Math.abs(px.drift) < 0.08 && px.after.djPane === true && px.after.title === px.before.title);

/* 第三条退出路径：顶栏返回（真实的 #btn-settings 按钮在 lab 里就是「返回大厅」） */
const px2 = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  const d = E.decks.A;
  await E.ctx.resume();
  d.seek(41); d.play();
  await new Promise((r) => setTimeout(r, 400));
  const an = E.ctx.createAnalyser();
  an.fftSize = 2048;
  E.masterIn.connect(an);
  an.connect(E.meterSink);
  const before = { pos: d.audioPos(), playing: d.playing };
  document.getElementById('btn-settings').click();      // lab 里这个键 = 返回大厅
  const t0 = performance.now();
  let maxRms = 0;
  const buf = new Float32Array(2048);
  while (performance.now() - t0 < 1400) {
    await new Promise((r) => setTimeout(r, 70));
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    maxRms = Math.max(maxRms, Math.sqrt(s / buf.length));
  }
  const viewLeft = !document.getElementById('view-lab').classList.contains('is-active');
  /* 回 DJ 台 */
  document.querySelectorAll('#hall-tools .hrow')[0].click();
  await new Promise((r) => setTimeout(r, 500));
  const after = { pos: d.audioPos(), playing: d.playing,
    pane: document.getElementById('lab-pane-dj').classList.contains('is-on') };
  E.masterIn.disconnect(an);
  return JSON.stringify({ before, after, viewLeft, maxRms: +maxRms.toFixed(5),
    drift: +(after.pos - before.pos).toFixed(4) });
})()`));
console.log('    顶栏返回:', JSON.stringify(px2));
ok('C2b', '顶栏返回（离开 view-lab）：同样暂停、无声、位置不丢',
  `离开前 ${px2.before.pos.toFixed(3)}s → 1.4s 内 maxRMS=${px2.maxRms} → 回来 playing=${px2.after.playing}`
  + ` pos=${px2.after.pos.toFixed(3)}s 漂移 ${px2.drift}s · view 已切走=${px2.viewLeft}`,
  px2.maxRms < 0.005 && px2.after.playing === false && Math.abs(px2.drift) < 0.08
  && px2.viewLeft === true && px2.after.pane === true);

/* ================================================================
 * C3. 曲库每行都有小封面
 * ================================================================ */
console.log('\n[C3] 曲库缩略图');
const thumbs = JSON.parse(await ev(`(() => {
  const trs = [...document.querySelectorAll('#djx-lib tbody tr')];
  const imgs = [...document.querySelectorAll('#djx-lib tbody img')];
  const localTr = trs.find((tr) => {
    const t = tr.querySelector('td.c-t');
    const a = tr.querySelector('td.c-a');
    return a && /本地文件/.test(a.textContent) || (t && /\\.wav$/i.test(t.textContent));
  });
  const localImg = localTr ? localTr.querySelector('img') : null;
  const rowH = trs.length ? Math.round(trs[0].getBoundingClientRect().height) : 0;
  return JSON.stringify({
    rows: trs.length, imgs: imgs.length,
    first: imgs[0] ? { nw: imgs[0].naturalWidth, nh: imgs[0].naturalHeight, real: imgs[0].dataset.cover } : null,
    realCount: imgs.filter((i) => i.dataset.cover === '1').length,
    local: localImg ? { nw: localImg.naturalWidth, real: localImg.dataset.cover,
      src: (localImg.currentSrc || localImg.src || '').slice(0, 22) } : null,
    rowH,
  });
})()`));
console.log('    ', JSON.stringify(thumbs));
ok('C3', '曲库每行一张小封面（本地文件那行用占位），行高不跳',
  `${thumbs.rows} 行 / ${thumbs.imgs} 张 img · 真实封面 ${thumbs.realCount} 张 · 首行 ${thumbs.first && thumbs.first.nw}px`
  + ` · 本地行 ${thumbs.local && thumbs.local.nw}px(${thumbs.local && thumbs.local.src}…) · 行高 ${thumbs.rowH}px`,
  thumbs.rows > 0 && thumbs.imgs === thumbs.rows
  && thumbs.first && thumbs.first.nw > 0 && thumbs.local && thumbs.local.nw > 0 && thumbs.rowH <= 48);

/* ================================================================
 * C4. 曲库行拖进 A 台（拖动中 deck 高亮）
 * ================================================================ */
console.log('\n[C4] 拖行到 deck');
const dragStart = JSON.parse(await ev(`(() => {
  const trs = [...document.querySelectorAll('#djx-lib tbody tr')];
  /* 拖本地文件那行：既验证行拖拽，也验证本地文件的占位封面 */
  const tr = trs.find((x) => {
    const t = x.querySelector('td.c-t');
    return t && /\\.wav$/i.test(t.textContent);
  }) || trs[trs.length - 1];
  tr.scrollIntoView({ block: 'nearest' });
  const dt = new DataTransfer();
  window.__dt = dt;
  tr.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const deckA = document.getElementById('djx-deck-A');
  deckA.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
  deckA.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return JSON.stringify({
    key: tr.dataset.key, title: tr.querySelector('td.c-t').textContent,
    hot: deckA.classList.contains('is-over'), types: [...dt.types],
    rowDragging: tr.classList.contains('is-dragging'),
    thumbNw: (tr.querySelector('img') || {}).naturalWidth || 0,
  });
})()`));
console.log('    拖动中:', JSON.stringify(dragStart));
const rDrag = await rectOf('#djx-deck-A');
await shot('dj-6-drag.png', { ...rDrag, scale: 1.4 });
const dropRes = JSON.parse(await ev(`(async () => {
  const deckA = document.getElementById('djx-deck-A');
  deckA.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
  const d = window.__DJLAB.decks().A;
  const WANT = ${JSON.stringify(dragStart.key)};
  for (let i = 0; i < 60; i++) {
    if (d.buf && d.track && d.track.key === WANT) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return JSON.stringify({
    key: d.track && d.track.key, title: d.track && d.track.title,
    loaded: !!(d.buf && d.dur > 0), dur: +(d.dur || 0).toFixed(2),
    hot: deckA.classList.contains('is-over'),
    platterEmpty: document.querySelector('#djx-deck-A .djx-platter').classList.contains('is-empty'),
  });
})()`));
console.log('    松手后:', JSON.stringify(dropRes));
ok('C4', '从曲库拖到 A deck：deck 高亮、松手载入、本地无封面回落',
  `拖「${dragStart.title}」→ 高亮=${dragStart.hot} · types=${dragStart.types.join(',')}`
  + ` · 松手后 A=「${dropRes.title}」loaded=${dropRes.loaded} ${dropRes.dur}s · 高亮已消=${!dropRes.hot}`
  + ` · 无封面回落=${dropRes.platterEmpty}`,
  dragStart.hot === true && dragStart.rowDragging === true
  && dropRes.key === dragStart.key && dropRes.loaded === true && dropRes.hot === false);

/* ================================================================
 * C5. 自动过渡的演示音源：离开实验室/切分页必须立刻停（不是自己响完）
 * ================================================================ */
console.log('\n[C5] 自动过渡演示退出即停');
const c5 = JSON.parse(await ev(`(async () => {
  const E = window.__DJLAB.engine();
  await E.ctx.resume();
  /* 演示要 Player 队列里有两首；前面的 E5 塞过，没了就补 */
  if ((typeof Player === 'undefined') || (Player.state.queue || []).length < 2) {
    const L = window.__DJLAB;
    const tracks = L.entries().filter((e) => e.kind === 'netease' && e.id)
      .map((e) => ({ id: e.id, name: e.title, artists: e.artist, duration: e.dur * 1000 }));
    if (tracks.length >= 2) Player.playQueue(tracks, 0, false);
  }
  const an = E.ctx.createAnalyser();
  an.fftSize = 2048;
  E.masterIn.connect(an);
  an.connect(E.meterSink);
  const buf = new Float32Array(2048);
  const rms = async (ms) => {
    let max = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 70));
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      max = Math.max(max, Math.sqrt(s / buf.length));
    }
    return +max.toFixed(4);
  };
  const now = () => {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  };
  /* 干净起点 */
  document.getElementById('xfade-stop').click();
  await new Promise((r) => setTimeout(r, 250));
  document.querySelector('#lab-tabs [data-tab="xfade"]').click();
  await new Promise((r) => setTimeout(r, 350));
  const base = await rms(250);
  document.getElementById('xfade-run').click();
  /* 等它真的响（要下两首完整音频再解码，最多 30s） */
  const t0 = performance.now();
  let started = 0;
  while (performance.now() - t0 < 30000) {
    await new Promise((r) => setTimeout(r, 120));
    started = now();
    if (started > 0.02) break;
  }
  const playing = await rms(300);
  const sub = document.getElementById('lab-sub').textContent;
  /* 立刻从顶栏返回大厅 */
  document.getElementById('btn-settings').click();
  const after = await rms(2000);
  const leftLab = !document.getElementById('view-lab').classList.contains('is-active');
  /* 回 DJ 台，别把后面的东西留在大厅 */
  document.querySelectorAll('#hall-tools .hrow')[0].click();
  await new Promise((r) => setTimeout(r, 450));
  E.masterIn.disconnect(an);
  return JSON.stringify({ base, started: +started.toFixed(4), playing, after, sub, leftLab,
    backInLab: document.getElementById('view-lab').classList.contains('is-active'),
    queue: (typeof Player !== 'undefined' && (Player.state.queue || []).length) || 0 });
})()`));
console.log('    ', JSON.stringify(c5));
ok('C5', '自动过渡演示：响着离开实验室 → 2s 内 master maxRMS = 0',
  `静默基线 ${c5.base} · 演示响时 ${c5.playing}（副标题「${c5.sub}」）→ 顶栏返回后 2s 内 maxRMS=${c5.after}`
  + ` · 已离开 lab=${c5.leftLab} · 回到 lab=${c5.backInLab} · 队列 ${c5.queue} 首`,
  c5.playing > 0.02 && c5.after < 0.005 && c5.leftLab === true && c5.backInLab === true);
/* ================================================================
 * 收尾
 * ================================================================ */
console.log('\n============ 汇总 ============');
const main = R.rows.filter((r) => typeof r.n === 'number');
const extra = R.rows.filter((r) => typeof r.n !== 'number');
for (const r of R.rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${String(r.n).padStart(2)}] ${r.name}`);
console.log(`\n§6 十二条：通过 ${main.filter((r) => r.pass).length} / ${main.length}`);
console.log(`附加功能：通过 ${extra.filter((r) => r.pass).length} / ${extra.length}`);
if (R.pass !== R.rows.length) console.log('失败项：', R.rows.filter((r) => !r.pass).map((r) => r.n).join(','));
console.log('console error:', errAll.length ? errAll.slice(0, 5) : '无');

ws.close(); ch.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(R.fail ? 1 : 0);
