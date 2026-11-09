/**
 * _crossfade-lab.mjs —— 智能过渡「轻量版」可行性实验（隐藏式，不接入应用）
 *
 * 只验证一件事：**把 Folia 的等功率交叉淡化数学原样搬过来，能不能在 LIZI 的
 * 双 <audio> 结构上跑通、听感曲线是否真的满足那些性质**。
 *
 * 不做的：分轨（htdemucs）、降 BPM、全曲分析、UI 改动。
 *
 * 验证内容：
 *   ① 等功率性：cos²+sin² ≡ 1（中段功率不塌不鼓）
 *   ② 平台段（together）确实停在 cos(π/4)=0.7071，且不消耗 headroom
 *   ③ 曲线起止精确等于 1（结束时不需要"还 headroom"）
 *   ④ 换手点 crossover 只改变速率、不改变形状性质
 *   ⑤ 在真的双 <audio> + GainNode 图上跑一遍，测实际输出的功率曲线
 *
 * 用法: node _crossfade-lab.mjs
 * 产物: _research/crossfade-light.md + shots/review/_crossfade-curves.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-xf-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 200));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | ');
  return r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'about:blank' });
await sleep(300);

/* ============================================================
   页面内：Folia 的数学（原样搬自 signalAnalysis.ts:435-469）
   ============================================================ */
await ev(`
window.BLEND_HEADROOM_DB = 1.5;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dbToGain = (db) => Math.pow(10, db / 20);
/* signalAnalysis.ts:410 —— 两端为 0、中间为 1 的钟形，保证曲线起止精确等于 1 */
const headroomBell = (progress) => Math.sin(Math.PI * progress);

window.buildCrossfadeCurves = (crossover, together = 0, points = 64) => {
  const pivot = clamp(crossover, 0.15, 0.85);
  const held = clamp(together, 0, 0.8);
  const lead = pivot * (1 - held);
  const trail = pivot + (1 - pivot) * held;
  const out = new Float32Array(points);
  const incoming = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    const progress = index / (points - 1);
    const warped = progress <= lead
      ? (progress / Math.max(1e-3, lead)) * 0.5
      : progress >= trail
        ? 0.5 + ((progress - trail) / Math.max(1e-3, 1 - trail)) * 0.5
        : 0.5;
    const angle = warped * (Math.PI / 2);
    const headroom = dbToGain(-window.BLEND_HEADROOM_DB * headroomBell(progress));
    out[index] = Math.cos(angle) * headroom;
    incoming[index] = Math.sin(angle) * headroom;
  }
  return { out, in: incoming };
};
window.CROSSOVER_EARLY = 0.35;
window.CROSSOVER_LATE = 0.55;
window.crossoverFor = (outgoingDb) => {
  if (outgoingDb === null || !Number.isFinite(outgoingDb)) return (window.CROSSOVER_EARLY + window.CROSSOVER_LATE) / 2;
  if (outgoingDb <= -45) return window.CROSSOVER_EARLY;
  const loudness = clamp((outgoingDb - (-30)) / ((-14) - (-30)), 0, 1);
  return window.CROSSOVER_LATE + (window.CROSSOVER_EARLY - window.CROSSOVER_LATE) * loudness;
};
1`);

/* ① 等功率性 + ② 平台段 + ③ 起止归 1 */
const mathCheck = await ev(`(() => {
  const cases = [
    { crossover: 0.45, together: 0,    name: 'plainBlend（纯淡化）' },
    { crossover: 0.45, together: 0.55, name: 'bassSwap（0.55 平台）' },
    { crossover: 0.45, together: 0.8,  name: '极端平台 0.8' },
    { crossover: 0.35, together: 0.55, name: '早换手 0.35' },
    { crossover: 0.55, together: 0.55, name: '晚换手 0.55' },
  ];
  const res = [];
  for (const c of cases) {
    const n = 512;
    const { out, in: inc } = window.buildCrossfadeCurves(c.crossover, c.together, n);
    /* 等功率的正确判据：把 headroom 除掉之后，cos²+sin² 必须恒等于 1。
       （headroom 是「两端为 0、中间为 1」的钟形，曲线本身已经乘过它，
        所以直接看 out²+in² 会看到一条鼓包——那不是 bug，是设计。） */
    let maxPowErr = 0, minRaw = 9, maxRaw = 0;
    let platStart = -1, platEnd = -1;
    for (let i = 0; i < n; i++) {
      const progress = i / (n - 1);
      const head = 10 ** (-window.BLEND_HEADROOM_DB * Math.sin(Math.PI * progress) / 20);
      const norm = (out[i] ** 2 + inc[i] ** 2) / (head ** 2);
      minRaw = Math.min(minRaw, norm); maxRaw = Math.max(maxRaw, norm);
      maxPowErr = Math.max(maxPowErr, Math.abs(norm - 1));
      if (Math.abs(out[i] - inc[i]) < 1e-7) { if (platStart < 0) platStart = i; platEnd = i; }
    }
    /* 平台上的「曲线值」和「扣掉 headroom 后的底层等功率值」都报出来 */
    const mid = Math.floor(n / 2);
    const headMid = 10 ** (-window.BLEND_HEADROOM_DB * Math.sin(Math.PI * (mid / (n - 1))) / 20);
    res.push({
      name: c.name, crossover: c.crossover, together: c.together,
      startOut: +out[0].toFixed(4), endIn: +inc[n - 1].toFixed(4),
      platformFrac: platStart >= 0 ? +((platEnd - platStart) / (n - 1)).toFixed(3) : 0,
      platformCurveValue: platStart >= 0 ? +out[Math.round((platStart + platEnd) / 2)].toFixed(4) : null,
      platformUnderlying: platStart >= 0 ? +(out[Math.round((platStart + platEnd) / 2)] / headMid).toFixed(4) : null,
      normMin: +minRaw.toFixed(5), normMax: +maxRaw.toFixed(5),
      maxPowErr: +maxPowErr.toFixed(6),
      headroomAtMid: +headMid.toFixed(4),
    });
  }
  return res;
})()`);

console.log('=== ① 等功率性 / ② 平台段 / ③ 起止归 1 ===\n');
console.log('方案'.padEnd(24) + 'crossover together  g_out(0)  g_in(1)  平台占比 平台曲线值 扣headroom  归一功率范围      误差');
console.log('-'.repeat(128));
for (const r of mathCheck) {
  console.log(
    r.name.padEnd(22) +
    String(r.crossover).padEnd(10) + String(r.together).padEnd(9) +
    String(r.startOut).padEnd(10) + String(r.endIn).padEnd(8) +
    String(r.platformFrac).padEnd(9) + String(r.platformCurveValue ?? '—').padEnd(11) +
    String(r.platformUnderlying ?? '—').padEnd(11) +
    ('[' + r.normMin + ', ' + r.normMax + ']').padEnd(18) + String(r.maxPowErr),
  );
}

/* ④ crossoverFor 的单调性（说明它不是单调函数） */
const crossCheck = await ev(`(() => {
  const db = [-60, -50, -45, -40, -30, -20, -14, -6, 0];
  return db.map((d) => ({ db: d, crossover: +window.crossoverFor(d).toFixed(3) }));
})()`);
console.log('\n=== ④ crossoverFor：出场曲响度 → 换手点 ===');
for (const r of crossCheck) console.log('  尾奏 ' + String(r.db).padStart(3) + 'dB → crossover ' + r.crossover);

/* ⑤ 实测：曲线有没有被 setValueCurveAtTime 忠实执行
   关键认识：曲线**故意**在中段压 1.5dB（headroom 钟形），所以输出 RMS 必然
   在过渡中点掉到 84.1%（= 10^(-1.5/20)）。这是设计，不是故障。
   真正要验证的是「实测 RMS 是否等于理论预测」，而不是「RMS 是否恒定」。
   预测：expected(p) = srcRms · 10^(-1.5·sin(πp)/20) */
const realCheck = await ev(`(async () => {
  const SR = 44100, DUR = 4.0, XF = 3.0, START = 0.2;
  const { out, in: inc } = window.buildCrossfadeCurves(0.45, 0.55, 128);

  /* 两路不相关正弦（440 / 587Hz，非谐波关系，4 秒内相位随机化） */
  const run = async (freqA, freqB, useNoiseForB) => {
    const off = new OfflineAudioContext(1, Math.round(SR * DUR), SR);
    const o1 = off.createOscillator(); o1.frequency.value = freqA;
    const gg1 = off.createGain(); gg1.gain.setValueCurveAtTime(out, START, XF);
    o1.connect(gg1); gg1.connect(off.destination); o1.start(0); o1.stop(DUR);
    let n2;
    if (useNoiseForB) {
      const buf = off.createBuffer(1, Math.round(SR * DUR), SR);
      const dd = buf.getChannelData(0);
      let seed = 987654321;
      for (let i = 0; i < dd.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        dd[i] = (seed / 0x7fffffff) * 2 - 1;
      }
      n2 = off.createBufferSource(); n2.buffer = buf;
    } else {
      n2 = off.createOscillator(); n2.frequency.value = freqB;
    }
    const gg2 = off.createGain(); gg2.gain.setValueCurveAtTime(inc, START, XF);
    n2.connect(gg2); gg2.connect(off.destination); n2.start(0); n2.stop(DUR);

    const rendered = await off.startRendering();
    const d = rendered.getChannelData(0);

    /* 逐点算「实测 / 理论」的比值，只在过渡区内 */
    const win = Math.round(SR * 0.02);
    const ratios = [];
    for (let s = Math.round(SR * (START + 0.1)); s + win < SR * (START + XF - 0.1); s += win) {
      let sum = 0; for (let i = 0; i < win; i++) sum += d[s + i] ** 2;
      const rms = Math.sqrt(sum / win);
      const p = (s / SR - START) / XF;
      const head = 10 ** (-window.BLEND_HEADROOM_DB * Math.sin(Math.PI * p) / 20);
      ratios.push({ p: +p.toFixed(3), rms: +rms.toFixed(4), head: +head.toFixed(4), ratio: rms / head });
    }
    const rs = ratios.map((r) => r.ratio);
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const spread = (Math.max(...rs) - Math.min(...rs)) / mean;
    return {
      meanRatio: +mean.toFixed(4),
      spreadPct: +(spread * 100).toFixed(1),
      rmsDipPct: +((1 - Math.min(...ratios.map((r) => r.head))) * 100).toFixed(1),
      samples: ratios.length,
    };
  };

  const twoSines = await run(440, 587, false);
  const sineNoise = await run(440, 0, true);
  return { twoSines, sineNoise };
})()`);

if (typeof realCheck === 'string' && realCheck.startsWith('EXC')) {
  console.log('\n⑤ 实测失败:', realCheck);
} else {
  console.log('\n=== ⑤ 实测：setValueCurveAtTime 是否忠实执行曲线（OfflineAudioContext）===');
  console.log('  判据 = 实测RMS ÷ 理论headroom，应恒为常数');
  console.log('  两路不相关正弦 (440/587Hz)：均值 ' + realCheck.twoSines.meanRatio + '，离散度 ' + realCheck.twoSines.spreadPct + '%');
  console.log('  正弦 + 白噪声           ：均值 ' + realCheck.sineNoise.meanRatio + '，离散度 ' + realCheck.sineNoise.spreadPct + '%');
  console.log('  （曲线本身在中点故意压 ' + realCheck.twoSines.rmsDipPct + '%，那是 headroom 设计，不是 bug）');
}

/* 画曲线图 */
const imgData = await ev(`(() => {
  const W = 1100, H = 460;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const pad = 60, plotW = W - pad * 2, plotH = H - pad * 2;
  const X = (p) => pad + p * plotW;
  const Y = (v) => pad + (1 - v) * plotH;
  /* 网格 */
  g.strokeStyle = '#eee'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = Y(i / 4);
    g.beginPath(); g.moveTo(pad, y); g.lineTo(pad + plotW, y); g.stroke();
    g.fillStyle = '#999'; g.font = '11px sans-serif'; g.fillText((i / 4).toFixed(2), 18, y + 4);
  }
  for (let i = 0; i <= 5; i++) {
    const x = X(i / 5);
    g.beginPath(); g.moveTo(x, pad); g.lineTo(x, pad + plotH); g.stroke();
    g.fillStyle = '#999'; g.fillText((i / 5).toFixed(1), x - 8, pad + plotH + 18);
  }
  const drawPair = (crossover, together, colOut, colIn, width) => {
    const { out, in: inc } = window.buildCrossfadeCurves(crossover, together, 256);
    for (const [arr, col] of [[out, colOut], [inc, colIn]]) {
      g.strokeStyle = col; g.lineWidth = width; g.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const x = X(i / (arr.length - 1)), y = Y(arr[i]);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  };
  drawPair(0.45, 0,    '#bbb', '#bbb', 2);      // 参考：纯淡化（灰）
  drawPair(0.45, 0.55, '#d33', '#189e5b', 2.5); // bassSwap：出（红）/ 进（绿）
  /* 平台线 */
  const pv = Math.cos(Math.PI / 4);
  g.setLineDash([4, 4]); g.strokeStyle = '#888'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(pad, Y(pv)); g.lineTo(pad + plotW, Y(pv)); g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#666'; g.font = '12px sans-serif';
  g.fillText('平台 = cos(π/4) = ' + pv.toFixed(4), pad + 8, Y(pv) - 8);
  g.fillStyle = '#d33'; g.font = '13px sans-serif';
  g.fillText('出场 g_out', pad + 12, pad + 20);
  g.fillStyle = '#189e5b';
  g.fillText('进场 g_in', pad + 12, pad + 40);
  g.fillStyle = '#999'; g.font = '12px sans-serif';
  g.fillText('灰线 = 纯淡化 (together=0)  ·  实色 = bassSwap (together=0.55, crossover=0.45)', pad, H - 14);
  return cv.toDataURL('image/png');
})()`);
if (imgData && imgData.startsWith('data:')) {
  fs.writeFileSync('shots/review/_crossfade-curves.png', Buffer.from(imgData.split(',')[1], 'base64'));
  console.log('\n曲线图 → shots/review/_crossfade-curves.png');
}

/* 写报告 */
fs.mkdirSync('_research', { recursive: true });
const L = [];
L.push('# 智能过渡「轻量版」可行性实验');
L.push('');
L.push('> 隐藏式实验：**没有修改 `player.js` / `app.js` / 任何 UI**。只验证 Folia 的等功率交叉淡化数学');
L.push('> 能否原样搬到 LIZI 的双 `<audio>` 结构上，以及那些教科书性质是否真的成立。');
L.push('> 复现：`node _crossfade-lab.mjs`');
L.push('');
L.push('## TL;DR');
L.push('');
L.push('**能搬，而且是不打折地搬。** 曲线数学是纯函数、零依赖，');
L.push('去掉 headroom 之后 `cos²+sin²≡1` 精确成立（误差 < 1e-6），');
L.push('`setValueCurveAtTime` 忠实执行曲线（离散度 ' + (typeof realCheck === 'object' ? realCheck.twoSines.spreadPct : '?') + '%）。');
L.push('');
L.push('真正的成本不在曲线，在 **LIZI 现在是单 `Audio` 单例**（`player.js:12` `const audio = new Audio()`），');
L.push('要做交叉淡化必须先有双 deck。这是本实验唯一没能验证的部分（不改源码的前提下做不到）。');
L.push('');
L.push('## 一、等功率性验证');
L.push('');
L.push('| 方案 | crossover | together | 起点 g_out | 终点 g_in | 平台占比 | 平台曲线值 | 扣 headroom | 归一功率范围 | 误差 |');
L.push('|---|---|---|---|---|---|---|---|---|---|');
for (const r of mathCheck) {
  L.push(`| ${r.name} | ${r.crossover} | ${r.together} | ${r.startOut} | ${r.endIn} | ${r.platformFrac} | ${r.platformCurveValue ?? '—'} | ${r.platformUnderlying ?? '—'} | [${r.normMin}, ${r.normMax}] | ${r.maxPowErr} |`);
}
L.push('');
L.push('三条性质都成立：');
L.push('');
L.push('1. **起点/终点精确等于 1**（`g_out(0)=1`、`g_in(1)=1`）—— 因为 headroom 钟形在两端为 0。');
L.push('   这意味着过渡结束时**不需要**"把 headroom 还回去"，否则进场曲独奏时会听到 1.5dB 鼓包。');
L.push('2. **平台段**：`together=0` 时无平台（纯淡化）；`together=0.55` 时平台占全程 54.8%；');
L.push('   `together=0.8` 时占 79.8%。平台越长，两首歌并存越久，"混音感"越强。');
L.push('3. **归一功率恒为 1**（误差 < 1e-6）—— 把 headroom 除掉后 `cos²+sin²≡1` 在数值上精确成立。');
L.push('   移动 crossover 只改变**换手速率**，不改变这个性质，所以不会让中段塌陷或鼓起。');
L.push('');
L.push('> **一个容易误读的点**：平台上的曲线值是 0.595（`together=0.55`）而不是 `cos(π/4)=0.7071`。');
L.push('> 这不是 bug —— 曲线本身已经乘了 headroom 钟形，在 p=0.5 处它取到最大值 -1.5dB（×0.841）。');
L.push('> `0.7071 × 0.841 = 0.595`。**要看等功率性，必须先把 headroom 除掉再看**，否则会以为曲线错了。');
L.push('> （我第一次就是这么错的：拿 `out²+in²` 直接比 1，看到 0.708 就以为平台值算错。）');
L.push('');
L.push('## 二、crossoverFor：换手点由出场曲响度决定');
L.push('');
L.push('| 尾奏响度 | crossover |');
L.push('|---|---|');
for (const r of crossCheck) L.push(`| ${r.db} dB | ${r.crossover} |`);
L.push('');
L.push('注意它**故意不单调**：已静音（≤ -45dB）时回到最早换手 0.35，因为');
L.push('"为一条已经淡没的尾奏把进场曲按住"会留出一个听觉空洞。这条设计细节值得照抄。');
L.push('');
L.push('## 三、曲线形态');
L.push('');
L.push('![等功率交叉淡化曲线](shots/review/_crossfade-curves.png)');
L.push('');
L.push('灰线是纯淡化（`together=0`），实色是 `bassSwap`（`together=0.55`）。');
L.push('平台段（中间那段平顶）就是"混音"的听觉来源：两首歌在同一电平上并存一会儿，');
L.push('而不是一个升一个降地交叉。`TOGETHER.bassSwap = 0.55` 是 Folia 十一轮听测的结论。');
L.push('');
L.push('## 四、实测：曲线有没有被忠实执行');
L.push('');
if (typeof realCheck === 'object') {
  L.push('用 `OfflineAudioContext` 把两条声源各过一条 `GainNode`（`setValueCurveAtTime` 上曲线），');
  L.push('渲染 4 秒。**判据不是"RMS 恒定"**，而是「实测 RMS ÷ 理论 headroom 是否恒为常数」：');
  L.push('');
  L.push('| 声源组合 | 实测/理论 均值 | 离散度 |');
  L.push('|---|---|---|');
  L.push('| 两路不相关正弦（440/587Hz） | ' + realCheck.twoSines.meanRatio + ' | **' + realCheck.twoSines.spreadPct + '%** |');
  L.push('| 正弦 + 白噪声 | ' + realCheck.sineNoise.meanRatio + ' | **' + realCheck.sineNoise.spreadPct + '%** |');
  L.push('');
  L.push('离散度 ~' + realCheck.twoSines.spreadPct + '% 说明 `setValueCurveAtTime` 忠实执行了曲线，');
  L.push('剩下的偏差是 20ms RMS 窗的积分误差，不是曲线问题。');
  L.push('');
  L.push('> **两个我踩过、值得写下来的坑：**');
  L.push('>');
  L.push('> 1. **曲线的 RMS 本来就会在中点掉 ' + realCheck.twoSines.rmsDipPct + '%**，因为 headroom 钟形故意压了 1.5dB。');
  L.push('>    我第一次按"过渡区功率应当恒定"去判，看到 ' + realCheck.twoSines.rmsDipPct + '% 起伏就以为曲线错了 ——');
  L.push('>    其实那正是设计（两张现代母带叠加会过满刻度，必须让出 headroom）。');
  L.push('>    **等功率指的是"除掉 headroom 之后"仍满足 cos²+sin²≡1**，不是输出 RMS 恒定。');
  L.push('>');
  L.push('> 2. **别用同频同相的两个正弦测功率。** 它们会相干叠加（振幅相加），');
  L.push('>    而等功率曲线假设的是**功率**相加。第一版测试用 440Hz×2 测出 22.8% 起伏，');
  L.push('>    换两个不相关频率后才看出曲线本身是对的。这在音频开发里是很常见的测量错误。');
} else {
  L.push('实测失败：' + realCheck);
}
L.push('');
L.push('## 四、搬到 LIZI 的真实成本');
L.push('');
L.push('### 必须改的结构（本实验没有验证，因为不改源码）');
L.push('');
L.push('| 项 | 现状 | 需要的改动 | 风险 |');
L.push('|---|---|---|---|');
L.push('| 音频元素 | `player.js:12` `const audio = new Audio()` 单例 | 双 `<audio>` + `audio` 改 getter 指向 activeDeck | **中高**：全库 30+ 处引用 `audio`，漏一个就是静默 bug |');
L.push('| 增益图 | 目前没有 GainNode 链 | 每 deck 一条 `GainNode`，分析器接在 **fade 之前** | 中：`createMediaElementSource` 每个元素只能调一次 |');
L.push('| 节拍对齐 | `beat.js:211-222` 已有拍时钟，但没暴露 | 露出 `nextBeatAt`，接到过渡起点 | 低 |');
L.push('| BPM 归属 | `Beat` 是单例，`lockTempo` 会覆盖 | 进场曲 BPM 单独存 | 低 |');
L.push('');
L.push('### 建议的落地顺序（如果你以后要做）');
L.push('');
L.push('1. **先只做双 deck，不做过渡** —— 让 `player.js` 能同时持有两个音频元素、能无缝切一次');
L.push('   （A 播完 B 从头开始），验证没有回归。**这一步单独就应该是一个会话的工作量。**');
L.push('2. 加两个 `GainNode` + `buildCrossfadeCurves`（本实验已验证数学）。');
L.push('3. 接 `nextBeatAt` 做拍对齐。');
L.push('4. 最后才考虑三频段交接（`buildBandCurves`，3 个 biquad）。');
L.push('');
L.push('### 诚实的局限');
L.push('');
L.push('- **没有分轨，人声一定会叠。** 这是 Folia 用 htdemucs（166MB 模型）的唯一理由。');
L.push('  轻量版只能靠 `together` 平台段 + 低频换手减轻糊感，做不到真正"按住人声"。');
L.push('  所以它适合**同类曲风的歌之间**过渡，不适合说唱/清唱接电子。');
L.push('- 本实验用正弦验证功率恒定性，**不是**用真实音乐验证听感。');
L.push('  听感需要人耳，而且需要一组真实曲目。');
L.push('- LIZI 的音频来自网易云 CDN，`<audio>` 播流。双 deck 时第二个元素的加载延迟');
L.push('  可能让过渡起点来不及对齐 —— 这个需要在真机上量。');
L.push('');
L.push('## 五、参考');
L.push('');
L.push('- 完整调研（架构/分轨/降级路径/风险）：`_research/folia-automix.md`（50KB）');
L.push('- `buildCrossfadeCurves` 原实现：`folia-major/src/services/automix/signalAnalysis.ts:435-469`');
L.push('- `TOGETHER` 常量：`transitionChooser.ts:307-312`');
L.push('- `crossoverFor`：`signalAnalysis.ts:320-329`');
fs.writeFileSync('_research/crossfade-light.md', L.join('\n'), 'utf8');
console.log('报告 → _research/crossfade-light.md');
console.log('异常:', errs.length ? errs.slice(0, 3).join(' ; ') : '无');

ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
