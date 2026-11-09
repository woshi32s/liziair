/**
 * _herolive.mjs —— 大厅海报「实时歌词」的验收（悬停 → 跟着播放头上滚 → 点一下飞播放页）
 *
 * 只用无头 Chrome + CDP；自己起临时 profile，跑完删掉。端口从 .port 读，不写死。
 * 所有数字都从页面上实测：
 *   · 当前行号 / 5 行窗口 / translateY  —— 读 window.__heroLive 与 getComputedStyle 的 matrix
 *   · 跳行不经过中间行                   —— 每帧采样行号序列，看第一个变化量
 *   · 监听摘干净                         —— window.__heroLive.active / armed / easing
 *   · FLIP 落位                          —— 替身层每帧矩形 vs 播放页真封面
 *
 * 音源：匿名拿不到免费直链（实测全 -110 / 无 url），按任务书允许的兜底，
 * 用本地生成的 330s WAV blob 直接喂给 Player.audio —— 队列/曲目/歌词仍走 Player.playQueue，
 * 只有音频字节是本地的（和 _djlab.mjs 造 WAV 的做法一致）。
 *
 *   node _herolive.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440, H = 1000;
const OUT = path.join(HERE, 'shots', 'review');
fs.mkdirSync(OUT, { recursive: true });

const R = { pass: 0, fail: 0 };
const ok = (n, name, detail, pass) => {
  if (pass) R.pass++; else R.fail++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  [${n}] ${name} —— ${detail}`);
};
const num = (v, d = 1) => Number(v).toFixed(d);

/* ---------- 起无头 Chrome ---------- */
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-herolive-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(250); }
}
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
    exceptions.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 240));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrs.push(m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 240));
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
const $j = async (x) => JSON.parse(await ev(x));
const gate = async (cond, tries = 60, ms = 300) => { for (let i = 0; i < tries; i++) { if (await ev(cond)) return true; await sleep(ms); } return false; };
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, Buffer.from(png.data, 'base64'));
  const st = fs.statSync(p);
  console.log('    →', `shots/review/${name}`, `(${Math.round(st.size / 1024)} KB)`);
};
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
const heroRect = async () => $j(`JSON.stringify(document.getElementById('hall-hero').getBoundingClientRect())`);
const hoverHero = async () => { const r = await heroRect(); await move(r.x + r.width / 2, r.y + r.height / 2); };
const unHover = () => move(6, 6);

/* 页面里的"当前行 + 位移"读数（位移取 getComputedStyle 的真实 matrix，不信缓存） */
const READ = `(() => {
  const L = window.__heroLive;
  if (!L) return null;
  const rows = document.getElementById('hall-hero-rows');
  const cs = rows ? getComputedStyle(rows).transform : 'none';
  const m = /matrix\\(([^)]+)\\)/.exec(cs);
  const ty = m ? +m[1].split(',')[5] : 0;
  const act = document.querySelector('#hall-hero-rows .ly.is-active');
  return {
    index: L.index, shift: +ty.toFixed(2), from: L.from, to: L.to,
    lines: L.lines, state: L.state, active: L.active, armed: L.armed, easing: L.easing, id: L.id,
    n: document.querySelectorAll('#hall-hero-rows .ly').length,
    cur: +(Player.audio.currentTime || 0).toFixed(2),
    dur: +(Player.audio.duration || 0).toFixed(1),
    playing: !!Player.state.playing,
    text: act ? act.textContent.replace(/\\s+/g, ' ').trim().slice(0, 24) : '',
  };
})()`;
const read = async () => JSON.parse(await ev(`JSON.stringify(${READ})`));

/* 重置到干净的大厅（不能 Page.reload：now 页会把 #now 写进 hash，刷新会直接进播放页） */
let navN = 0;
const reset = async () => {
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/?r=${++navN}` });
  await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 80, 400);
  await sleep(700);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

console.log(`\nLIZI 海报实时歌词验收  ·  http://127.0.0.1:${APP}/  ·  ${W}×${H} 无头 Chrome`);

/* ================================================================
 * 0. 种一首"上次听到"的歌（有 YRC/LRC 歌词），刷新
 * ================================================================ */
console.log('\n[0] 准备');
let seed = null, seed2 = null;
try {
  const r = await fetch(`http://127.0.0.1:${APP}/api/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ s: '晴天 周杰伦', limit: 30 }),
  });
  const d = await r.json();
  const pool = (d.tracks || []).filter((x) => x.cover);
  const p0 = pool.find((x) => x.id === 186016) || pool[0];
  seed = {
    id: p0.id, name: p0.name, artists: p0.artists, artistIds: p0.artistIds || [],
    album: p0.album || '', albumId: p0.albumId || null, cover: p0.cover || '',
    duration: p0.duration || 0, at: Date.now() - 12 * 60000,
  };
  /* 换歌用：另一首（有歌词） */
  const p1 = pool.find((x) => x.id !== p0.id && x.name !== p0.name);
  if (p1) {
    seed2 = {
      id: p1.id, name: p1.name, artists: p1.artists, artistIds: p1.artistIds || [],
      album: p1.album || '', albumId: p1.albumId || null, cover: p1.cover || '',
      duration: p1.duration || 0, at: Date.now(),
    };
  }
} catch { /* 下面有兜底 */ }
if (!seed) {
  seed = {
    id: 186016, name: '晴天', artists: '周杰伦', artistIds: [6452], album: '叶惠美', albumId: 18875,
    cover: 'https://p1.music.126.net/F0fTkmBTVykCa2o7Vgu1rQ==/109951173569626660.jpg',
    duration: 269000, at: Date.now() - 12 * 60000,
  };
}
const seedId = await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('lizi.hall.lastTrack', ${JSON.stringify(JSON.stringify(seed))}); } catch (e) {}`,
});
console.log(`    种子曲目：${seed.name} · ${seed.artists} · id=${seed.id}（歌词真取，音频走本地 WAV）`);
await reset();
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 80, 400))) {
  console.log('!! 大厅没起来，先看服务'); process.exit(2);
}
/* 海报封面是 1200px 的原图，偶尔会栽在 CDN 上：等它真解码完（截图才有内容），失败就重来一次 */
const coverOk = () => gate(`(() => { const i = document.getElementById('hall-hero-cover-img');
  return !!i && i.complete && i.naturalWidth > 0; })()`, 60, 250);
let coverReady = await coverOk();
if (!coverReady) { await reset(); coverReady = await coverOk(); }
console.log(`    海报封面解码完成：${coverReady}`);
await sleep(600);

/* ================================================================
 * 1. 悬停 → 5 行歌词 + 当前行 i0
 * ================================================================ */
console.log('\n[1] 悬停：5 行窗口 + 当前行');
await hoverHero();
await gate(`!!window.__heroLive && window.__heroLive.state === 'ok'
  && document.querySelectorAll('#hall-hero-rows .ly').length === 5`, 80, 250);
await sleep(500);
const hov = await read();
console.log(`    窗口 ${hov.from}~${hov.to}（${hov.n} 行）· 当前行 index=${hov.index}「${hov.text}」· 位移 ${hov.shift}px · state=${hov.state} 词条 ${hov.lines}`);
ok(1, '悬停后正好 5 行（当前行前后各 2 行），当前行 index = i0',
  `行数=${hov.n} (${hov.from}~${hov.to}) index=${hov.index}「${hov.text}」shift=${hov.shift}px`,
  hov.n === 5 && hov.state === 'ok' && hov.index >= 0 && hov.to - hov.from === 4);

/* ================================================================
 * 2. 起播：Player.playQueue 装队列，音频用本地 WAV —— 然后播 6 秒
 * ================================================================ */
console.log('\n[2] 起播 + 播 6 秒（当前行要往前走、容器要上滚）');
const start = await $j(`(async () => {
  /* 队列/曲目/歌词照走 Player.playQueue（不自动播，音频我们自己喂 —— 匿名拿不到免费直链） */
  const track = ${JSON.stringify(seed)};
  await Player.playQueue([track], 0, false);
  const sr = 8000, sec = 330, n = sr * sec;
  const ab = new ArrayBuffer(44 + n * 2);          // 静音 PCM：只写 WAV 头
  const dv = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  window.__wav = URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
  Player.audio.src = window.__wav;
  Player.audio.currentTime = 0;
  await Player.audio.play();
  await new Promise((r) => setTimeout(r, 250));
  return JSON.stringify({
    dur: +(Player.audio.duration || 0).toFixed(1),
    playing: !!Player.state.playing,
    t: +(Player.audio.currentTime || 0).toFixed(2),
    bodyPlaying: document.body.classList.contains('is-playing'),
    live: window.__heroLive && { active: window.__heroLive.active, armed: window.__heroLive.armed, index: window.__heroLive.index },
  });
})()`);
console.log(`    音频 ${start.dur}s  playing=${start.playing} currentTime=${start.t}s body.is-playing=${start.bodyPlaying} · 跟随档 armed=${start.live && start.live.armed} active=${start.live && start.live.active} index=${start.live && start.live.index}`);
ok(2.0, '音频在走（本地 WAV）、跟随档已 armed + active',
  `dur=${start.dur}s playing=${start.playing} t=${start.t}s armed=${start.live && start.live.armed} active=${start.live && start.live.active}`,
  start.dur > 300 && start.playing && start.t > 0.1 && !!(start.live && start.live.armed && start.live.active));

/* 先在页里挑一个"再过 1~2 秒就会换句"的位置，6 秒窗口里一定能看到走字 */
const planA = await $j(`(() => {
  const times = window.__heroLive.times, dur = Player.audio.duration || 300;
  let k = -1;
  for (let i = 2; i < times.length - 4; i++) {
    const g1 = times[i + 1] - times[i], g2 = times[i + 2] - times[i + 1];
    if (g1 > 1.4 && g1 < 2.6 && g2 > 1.4 && times[i + 2] < dur - 3) { k = i; break; }
  }
  return JSON.stringify({ k, t: k >= 0 ? +(times[k] + 0.15).toFixed(2) : -1, n: times.length });
})()`);
if (planA.k < 0) console.log('!! 没找到合适的歌词段落');
await ev(`Player.audio.currentTime = ${planA.t}`);
await gate(`window.__heroLive.index === ${planA.k}`, 30, 100);
await sleep(900);                       // 等缓动收尾，起点是"已经落位"的一帧

/* 逐帧采样 6 秒：行号 + translateY */
await ev(`(() => {
  window.__rec = { on: true, samples: [] };
  const tick = () => {
    if (!window.__rec.on) return;
    const L = window.__heroLive;
    const rows = document.getElementById('hall-hero-rows');
    const m = rows ? /matrix\\(([^)]+)\\)/.exec(getComputedStyle(rows).transform) : null;
    const ty = m ? +m[1].split(',')[5] : 0;
    window.__rec.samples.push([Math.round(performance.now()), L ? L.index : -1, +ty.toFixed(2), +(Player.audio.currentTime || 0).toFixed(2)]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 1;
})()`);
await sleep(6000);
const rec = await $j(`(() => { window.__rec.on = false; return JSON.stringify(window.__rec.samples); })()`);
const idxSeq = []; for (const s of rec) if (!idxSeq.length || idxSeq[idxSeq.length - 1] !== s[1]) idxSeq.push(s[1]);
const shMin = Math.min(...rec.map((s) => s[2]));
const shMax = Math.max(...rec.map((s) => s[2]));
const t0 = rec.length ? rec[0][3] : 0, t1 = rec.length ? rec[rec.length - 1][3] : 0;
console.log(`    起点：第 ${planA.k} 行（第 ${planA.k + 1} 行在 ${planA.t}s 之后 ${'≈'}1~2s 开始）`);
console.log(`    6 秒内采了 ${rec.length} 帧（currentTime ${t0}s → ${t1}s）`);
console.log(`    行号序列 ${idxSeq.join(' → ')}（变化 ${idxSeq.length - 1} 次）`);
console.log(`    translateY 实测范围 ${num(shMin, 2)}px ~ ${num(shMax, 2)}px（幅度 ${num(shMax - shMin, 2)}px）`);
ok(2.1, '播放 6 秒：当前行 index 变化 ≥ 1',
  `${idxSeq.join('→')}（Δ=${Math.abs(idxSeq[idxSeq.length - 1] - idxSeq[0])}，变化 ${idxSeq.length - 1} 次）`,
  Math.abs(idxSeq[idxSeq.length - 1] - idxSeq[0]) >= 1);
ok(2.2, '播放 6 秒：容器 translateY 变化 > 20px',
  `范围 ${num(shMin, 2)} ~ ${num(shMax, 2)}px → 幅度 ${num(shMax - shMin, 2)}px（逐句走过 ${idxSeq.length - 1} 段）`,
  shMax - shMin > 20);

/* ================================================================
 * 2b. 两张截图（间隔 ≥3 秒，当前行必须不同）
 *     首选：找"再往后两句加起来 ≥3.5 秒"的位置 —— 第一张拍在第一句落位的样子，
 *           第二张卡在第 k+2 句刚开始缓动的那 560ms 里（能同时看到"换句"和"正在上滚"）。
 *     兜底：找一段密集段落，固定隔 3.3 秒拍第二张（行号一定不同）。
 * ================================================================ */
console.log('\n[2b] 截图（间隔 ≥3s，当前行不同）');
const planB = await $j(`(() => {
  const times = window.__heroLive.times, dur = Player.audio.duration || 300;
  let k = -1, mode = '';
  for (let i = 3; i < times.length - 4; i++) {
    const span = times[i + 2] - times[i];
    if (span >= 3.5 && span <= 7 && times[i + 3] < dur - 3) { k = i; mode = 'mid'; break; }
  }
  if (k < 0) for (let i = 3; i < times.length - 6; i++) {
    const g = [1, 2, 3, 4].map((d) => times[i + d] - times[i + d - 1]);
    if (g.every((x) => x < 2.0) && times[i + 4] < dur - 3) { k = i; mode = 'dense'; break; }
  }
  return JSON.stringify({ k, mode, t: k >= 0 ? +(times[k] + 0.12).toFixed(2) : -1, t2: k >= 0 ? times[k + 2] : -1 });
})()`);
console.log(`    截图落点：第 ${planB.k} 行起（模式 ${planB.mode}，t=${planB.t}s，第 ${planB.k + 2} 行 @ ${num(planB.t2, 2)}s）`);
if (planB.k < 0) console.log('!! 没找到合适的截图段落');
await ev(`Player.audio.currentTime = ${planB.k >= 0 ? planB.t : 0}`);
await gate(`window.__heroLive.index === ${planB.k}`, 30, 100);
await sleep(300);
const shot1 = await read();
const tShot1 = Date.now();
await shot('hero-live-1.png');
/* 第二张：等它走到第 k+2 句、而且正在缓动里（index 变了 + easing=true 同时成立） */
const caught = planB.mode === 'mid'
  ? await gate(`window.__heroLive.index === ${planB.k + 2} && window.__heroLive.easing === true`, 400, 50)
  : false;
if (!caught) await sleep(3300);
const shot2 = await read();
await shot('hero-live-2.png');
const gap = Date.now() - tShot1;
console.log(`    第 1 张 index ${shot1.index}「${shot1.text}」 位移 ${shot1.shift}px · 窗口 ${shot1.from}~${shot1.to}`);
console.log(`    第 2 张 index ${shot2.index}「${shot2.text}」 位移 ${shot2.shift}px · 窗口 ${shot2.from}~${shot2.to} · 缓动中=${shot2.easing} · 间隔 ${gap}ms`);
ok(8.1, '截图 hero-live-1/2.png：间隔 ≥3 秒且当前行不同',
  `1:index ${shot1.index}「${shot1.text}」 2:index ${shot2.index}「${shot2.text}」 间隔 ${gap}ms（第 2 张缓动中=${shot2.easing}，位移 ${shot1.shift}→${shot2.shift}px）`,
  planB.k >= 0 && shot1.index !== shot2.index && !!shot1.text && !!shot2.text && gap >= 3000);

/* ================================================================
 * 3. 拖进度条（直接改 currentTime）→ 直接跳行，不经过中间行
 * ================================================================ */
console.log('\n[3] seek：直接跳行');
const plan = await $j(`(() => {
  const L = window.__heroLive, times = L.times, cur = L.index;
  const dur = Player.audio.duration || 300;
  let target = -1;
  for (let i = cur + 3; i < times.length; i++) { if (times[i] < dur - 2) { target = i; break; } }
  return JSON.stringify({ cur, target, t: target >= 0 ? +(times[target] + 0.1).toFixed(2) : -1, dur: +dur.toFixed(1) });
})()`);
await ev(`(() => {
  window.__seek = { on: true, samples: [] };
  const tick = () => {
    if (!window.__seek.on) return;
    window.__seek.samples.push([Math.round(performance.now()), window.__heroLive.index, +(Player.audio.currentTime || 0).toFixed(2)]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 1;
})()`);
const tSeek = Date.now();
await ev(`(async () => { Player.audio.currentTime = ${plan.t}; return 1; })()`);
await sleep(700);
const seekRec = await $j(`(() => { window.__seek.on = false; return JSON.stringify(window.__seek.samples); })()`);
const afterSeek = await read();
const seq = []; for (const s of seekRec) if (!seq.length || seq[seq.length - 1] !== s[1]) seq.push(s[1]);
const firstJump = seq.findIndex((v) => v !== plan.cur);
const jumpTo = firstJump >= 0 ? seq[firstJump] : -1;
const intermediates = seq.slice(1, firstJump + 1).filter((v) => v !== plan.cur && v !== jumpTo);
console.log(`    拖到 ${plan.t}s（目标第 ${plan.target} 行）· 行号序列 ${seq.join(' → ')}`);
console.log(`    第一跳：${plan.cur} → ${jumpTo}（Δ=${jumpTo - plan.cur}）· 中间行 ${intermediates.length} 个 · 用时 ${Date.now() - tSeek}ms · 落位后 index=${afterSeek.index} shift=${afterSeek.shift}px`);
ok(3, 'seek 到后半段：当前行直接跳（Δ ≥ 2，不经过中间行）',
  `${plan.cur} → ${jumpTo}（Δ=${jumpTo - plan.cur}），中间行=${intermediates.length}，final=${afterSeek.index}`,
  plan.target >= 0 && jumpTo === plan.target && jumpTo - plan.cur >= 2 && intermediates.length === 0);

/* ================================================================
 * 4. 暂停 → 停在原地不动
 * ================================================================ */
console.log('\n[4] 暂停');
const beforePause = await read();
await ev(`Player.audio.pause()`);
await sleep(150);
const atPause = await read();
await sleep(1500);
const afterPause = await read();
console.log(`    暂停前 index=${beforePause.index} shift=${beforePause.shift}px → 暂停 150ms 后 index=${atPause.index} shift=${atPause.shift}px → 再等 1.5s index=${afterPause.index} shift=${afterPause.shift}px`);
console.log(`    跟随档：armed=${afterPause.armed} active=${afterPause.active} easing=${afterPause.easing} playing=${afterPause.playing}`);
ok(4.1, '暂停 → 1.5s 内当前行不变、位移不变',
  `index ${atPause.index} → ${afterPause.index}（差 ${afterPause.index - atPause.index}）· shift ${atPause.shift} → ${afterPause.shift}（差 ${num(afterPause.shift - atPause.shift, 2)}px）`,
  afterPause.index === atPause.index && Math.abs(afterPause.shift - atPause.shift) < 0.5);
ok(4.2, '暂停 → 摘掉 timeupdate 与 rAF（armed 留着，才能知道何时恢复）',
  `armed=${afterPause.armed} active=${afterPause.active} easing=${afterPause.easing}`,
  afterPause.active === false && afterPause.easing === false);

/* ================================================================
 * 5. 移开鼠标 → 监听 / rAF 摘干净
 * ================================================================ */
console.log('\n[5] 移开鼠标');
await ev(`Player.audio.play()`);
await sleep(400);
const playingAgain = await read();
await unHover();
await sleep(400);
const leftHover = await read();
const s0 = await read();
await sleep(1200);
const s1 = await read();
console.log(`    恢复播放后：armed=${playingAgain.armed} active=${playingAgain.active} index=${playingAgain.index}`);
console.log(`    移开 400ms：hover=${await ev(`document.getElementById('hall-hero').classList.contains('is-hover')`)} armed=${leftHover.armed} active=${leftHover.active} easing=${leftHover.easing}`);
console.log(`    再等 1.2s：index ${s0.index} → ${s1.index}，shift ${s0.shift} → ${s1.shift}`);
ok(5, '移开鼠标 → __heroLive.active=false，监听/rAF 摘干净，字不再动',
  `armed=${leftHover.armed} active=${leftHover.active} easing=${leftHover.easing} · index ${s0.index}→${s1.index} shift ${s0.shift}→${s1.shift}`,
  playingAgain.active === true && leftHover.active === false && leftHover.armed === false
  && leftHover.easing === false && s0.index === s1.index && Math.abs(s1.shift - s0.shift) < 0.5);

/* ================================================================
 * 6. 切视图（#view-lab）→ 同上，且 0 console error
 * ================================================================ */
console.log('\n[6] 切到 #view-lab');
const errBefore = consoleErrs.length + exceptions.length;
await hoverHero();
await gate(`!!window.__heroLive && window.__heroLive.active === true`, 40, 120);
const beforeSwitch = await read();
await ev(`document.querySelector('#hall-tools [data-tool="0"]').click()`);
const labOn = await gate(`document.getElementById('view-lab').classList.contains('is-active')`, 40, 200);
await sleep(500);
const inLab = await read();
const s2 = await read();
await sleep(1200);
const s3 = await read();
const errAfter = consoleErrs.length + exceptions.length;
console.log(`    切换前 active=${beforeSwitch.active} armed=${beforeSwitch.armed} index=${beforeSwitch.index}`);
console.log(`    view-lab=${labOn} → active=${inLab.active} armed=${inLab.armed} easing=${inLab.easing} · index ${s2.index}→${s3.index} shift ${s2.shift}→${s3.shift}`);
console.log(`    console error：切换前 ${errBefore} 条 → 切换后 ${errAfter} 条${errAfter > errBefore ? '：' + consoleErrs.concat(exceptions).slice(errBefore).join(' / ') : ''}`);
ok(6, '切到 #view-lab → 监听/rAF 摘干净、字不再动、0 console error',
  `active=${inLab.active} armed=${inLab.armed} easing=${inLab.easing} index ${s2.index}→${s3.index} err ${errBefore}→${errAfter}`,
  labOn && beforeSwitch.active === true && inLab.active === false && inLab.armed === false
  && inLab.easing === false && s2.index === s3.index && errAfter === errBefore);

/* ================================================================
 * 7. FLIP 回归：悬停中点击 → 飞行落位 ΔX/ΔY ≤ 2px，替身 700ms 内移除
 *    另外验"起飞帧"：替身里的歌词块首帧矩形 == 点击前那一帧的可视矩形
 * ================================================================ */
console.log('\n[7] FLIP 回归');
await ev(`document.getElementById('btn-back').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 150);
await sleep(700);
await hoverHero();
await gate(`document.getElementById('hall-hero').classList.contains('is-hover')
  && document.querySelectorAll('#hall-hero-rows .ly').length === 5`, 40, 150);
await sleep(650);
/* 每帧记录：替身层封面矩形 / 替身歌词块矩形 / 消失时刻 */
await ev(`(() => {
  window.__fly = { t0: performance.now(), seen: false, lastArt: null, firstLyr: null, gone: null, pre: null, preTr: '' };
  const tick = () => {
    if (window.__fly.gone != null) return;
    const f = document.querySelector('.hero-fly');
    if (f) {
      const a = f.querySelector('.hero-fly__art');
      if (a) { const r = a.getBoundingClientRect(); window.__fly.lastArt = [r.left, r.top, r.width, r.height]; }
      if (window.__fly.firstLyr == null) {
        const l = f.querySelector('.hero-fly__lyrics');
        const cl = l ? l.querySelector('.hall-hero__rows') : null;
        if (cl) {
          const b = cl.getBoundingClientRect(), lb = l.getBoundingClientRect();
          window.__fly.firstLyr = [b.left, b.top, b.width, b.height];
          /* 容器自己在飞（有 translate），所以比"块在容器里的相对位置"，这个量与飞行进度无关 */
          window.__fly.firstIn = [+(b.left - lb.left).toFixed(2), +(b.top - lb.top).toFixed(2)];
          window.__fly.firstSize = [+b.width.toFixed(1), +b.height.toFixed(1)];
          window.__fly.cloneTr = cl.style.transform;
        }
      }
      window.__fly.seen = true;
    } else if (window.__fly.seen) { window.__fly.gone = +(performance.now() - window.__fly.t0).toFixed(1); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 1;
})()`);
/* 复核 + 点击放在同一个任务里：量到的 pre 就是屏幕上那一帧，中间的缓动一点都插不进来 */
await ev(`(() => {
  const rows = document.getElementById('hall-hero-rows');
  const box = document.getElementById('hall-hero-lyrics');
  const r = rows.getBoundingClientRect(), b = box.getBoundingClientRect();
  window.__fly.pre = [r.left, r.top, r.width, r.height];
  window.__fly.preIn = [+(r.left - b.left).toFixed(2), +(r.top - b.top).toFixed(2)];
  window.__fly.preSize = [+r.width.toFixed(1), +r.height.toFixed(1)];
  window.__fly.preBox = [+b.width.toFixed(1), +b.height.toFixed(1)];
  window.__fly.preTr = rows.style.transform;
  document.getElementById('hall-hero').click();
  return 1;
})()`);
await sleep(1100);
const flyLog = await $j(`JSON.stringify(window.__fly)`);
const nowM = await $j(`(() => {
  const d = document.querySelector('#view-now .disc').getBoundingClientRect();
  return JSON.stringify({
    view: document.getElementById('view-now').classList.contains('is-active'),
    fly: document.querySelectorAll('.hero-fly').length,
    live: window.__heroLive ? { active: window.__heroLive.active, armed: window.__heroLive.armed } : null,
    disc: [d.left, d.top, d.width, d.height].map((v) => +v.toFixed(1)),
    rows: document.querySelectorAll('#view-now #lyrics .ly').length,
    heroRows: document.querySelectorAll('#hall-hero-rows .ly').length,
  });
})()`);
const removedAt = flyLog.gone ? Math.round(flyLog.gone) : 0;
const px = flyLog.lastArt ? +num(Math.abs(flyLog.lastArt[0] - nowM.disc[0])) : 999;
const py = flyLog.lastArt ? +num(Math.abs(flyLog.lastArt[1] - nowM.disc[1])) : 999;
const lyrDx = (flyLog.firstIn && flyLog.preIn) ? +num(Math.abs(flyLog.firstIn[0] - flyLog.preIn[0])) : 999;
const lyrDy = (flyLog.firstIn && flyLog.preIn) ? +num(Math.abs(flyLog.firstIn[1] - flyLog.preIn[1])) : 999;
const sizeOk = (flyLog.firstSize && flyLog.preSize)
  && Math.abs(flyLog.firstSize[0] - flyLog.preSize[0]) <= 1 && Math.abs(flyLog.firstSize[1] - flyLog.preSize[1]) <= 1;
console.log(`    点击前：歌词盒 ${flyLog.preBox.join('×')}，块位置 (${flyLog.preIn.join(',')}) 尺寸 ${flyLog.preSize.join('×')} · inline transform "${flyLog.preTr}"`);
console.log(`    替身首帧：歌词块在歌词盒里的位置 (${flyLog.firstIn ? flyLog.firstIn.join(',') : '—'}) 尺寸 ${flyLog.firstSize ? flyLog.firstSize.join('×') : '—'} · inline transform "${flyLog.cloneTr}"`);
console.log(`    → 起飞帧差 ΔX=${lyrDx}px ΔY=${lyrDy}px · 尺寸一致=${sizeOk} · transform 一字不差=${flyLog.cloneTr === flyLog.preTr}`);
console.log(`    替身最后落点 ${flyLog.lastArt ? flyLog.lastArt.map((v) => num(v)).join(',') : '—'} → 播放页真封面 ${nowM.disc.join(',')} · 落位差 ΔX=${px}px ΔY=${py}px · 替身回收 ${removedAt || '>1000'}ms · 残留 ${nowM.fly}`);
console.log(`    进播放页后：view-now=${nowM.view} 播放页歌词 ${nowM.rows} 行 · 海报 active=${nowM.live && nowM.live.active}`);
ok(7.1, '点击 → 飞行落位 ΔX ≤ 2px / ΔY ≤ 2px，替身 700ms 内移除',
  `ΔX=${px}px ΔY=${py}px 回收=${removedAt}ms 残留=${nowM.fly}`, px <= 2 && py <= 2 && removedAt > 0 && removedAt <= 700 && nowM.fly === 0);
ok(7.2, '飞行起始帧 = 点击前看到的那一帧（clone 的 inline transform 与位置原样带走）',
  `相对位置差 ΔX=${lyrDx}px ΔY=${lyrDy}px · 尺寸一致=${sizeOk} · transform "${flyLog.cloneTr}" == "${flyLog.preTr}"`,
  lyrDx <= 2 && lyrDy <= 2 && sizeOk && flyLog.cloneTr === flyLog.preTr);
ok(7.3, '飞走即摘监听（离开大厅时 active=false）',
  `active=${nowM.live && nowM.live.active} armed=${nowM.live && nowM.live.armed}`, !!(nowM.live && !nowM.live.active && !nowM.live.armed));

/* ================================================================
 * 7b. 悬停中换歌 → 重新取新歌歌词、窗口重置、跟随继续（要求 3 的换歌分支）
 * ================================================================ */
console.log('\n[7b] 悬停中换歌');
await ev(`document.getElementById('btn-back').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 150);
await sleep(650);
await hoverHero();
await gate(`!!window.__heroLive && window.__heroLive.active === true`, 40, 120);
await sleep(500);
const beforeSwap = await read();
if (seed2) {
  await ev(`(async () => {
    await Player.playQueue([${JSON.stringify(seed2)}], 0, false);
    Player.audio.src = window.__wav;
    Player.audio.currentTime = 0;
    await Player.audio.play();
    return 1;
  })()`);
}
const swappedOk = seed2 ? await gate(`window.__heroLive.id === ${JSON.stringify(String(seed2.id))}
  && window.__heroLive.state === 'ok'
  && document.querySelectorAll('#hall-hero-rows .ly').length === 5`, 80, 250) : false;
await sleep(800);
const afterSwap = await read();
const swapNote = await ev(`document.getElementById('hall-hero-note').hidden`);
console.log(`    换歌前：id=${beforeSwap.id} index=${beforeSwap.index}「${beforeSwap.text}」 currentTime=${beforeSwap.cur}s / ${beforeSwap.dur}s`);
console.log(`    换歌后：id=${afterSwap.id} index=${afterSwap.index}「${afterSwap.text}」 窗口 ${afterSwap.from}~${afterSwap.to} · currentTime=${afterSwap.cur}s / ${afterSwap.dur}s · 提示条 hidden=${swapNote} · active=${afterSwap.active} armed=${afterSwap.armed}`);
ok(7.4, '悬停中换歌：重新取到新歌歌词、窗口重置、跟随接上、不出空框',
  seed2 ? `id ${beforeSwap.id} → ${afterSwap.id}（新歌 ${seed2.name}）· 窗口 ${afterSwap.from}~${afterSwap.to} · 5 行=${afterSwap.n === 5} · 提示条 hidden=${swapNote} · active=${afterSwap.active}`
    : '搜索没给出第二首，跳过',
  !!seed2 && swappedOk && afterSwap.id === String(seed2.id) && afterSwap.n === 5
  && swapNote === true && afterSwap.active === true);

/* ================================================================
 * 7c. 冷启动（localStorage 里没播过任何歌）→ 保持原有提示，不报错
 * ================================================================ */
console.log('\n[7c] 冷启动：没播过任何歌');
try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedId.identifier }); } catch {}
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/?cold=1` });
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 60, 300);
await ev(`localStorage.clear()`);
const errCold0 = consoleErrs.length + exceptions.length;
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/?cold=2` });
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 60, 300);
await sleep(800);
await hoverHero();
await sleep(1000);
const cold = await $j(`(() => {
  const note = document.getElementById('hall-hero-note');
  return JSON.stringify({
    seeded: localStorage.getItem('lizi.hall.lastTrack'),
    rows: document.querySelectorAll('#hall-hero-rows .ly').length,
    noteHidden: note.hidden, noteText: note.textContent.trim(), noteVisible: note.offsetHeight > 0,
    title: document.getElementById('hall-hero-title').textContent.trim(),
    live: window.__heroLive ? { active: window.__heroLive.active, armed: window.__heroLive.armed, state: window.__heroLive.state } : null,
  });
})()`);
const errCold = consoleErrs.length + exceptions.length;
console.log(`    localStorage=${cold.seeded ? '有种子' : '空'} · 标题「${cold.title}」· 行数 ${cold.rows} · 提示「${cold.noteText}」可见=${cold.noteVisible}`);
console.log(`    跟随档 active=${cold.live && cold.live.active} armed=${cold.live && cold.live.armed} state=${cold.live && cold.live.state} · console error ${errCold0} → ${errCold}`);
ok(7.5, '冷启动没播过：保持原提示、不出现空框、不起监听、0 报错',
  `行数=${cold.rows} note="${cold.noteText}" 可见=${cold.noteVisible} active=${cold.live && cold.live.active} err ${errCold0}→${errCold}`,
  !cold.seeded && cold.rows === 0 && cold.noteHidden === false && cold.noteText.length > 0
  && cold.noteVisible && !!(cold.live && !cold.live.active && !cold.live.armed) && errCold === errCold0);

/* ================================================================
 * 8. 收尾
 * ================================================================ */
const allErrs = consoleErrs.concat(exceptions);
console.log(`\n[8] console error ${consoleErrs.length} 条 / 未捕获异常 ${exceptions.length} 条`);
if (allErrs.length) allErrs.slice(0, 8).forEach((e) => console.log('    !', e));
console.log(`\n结果：${R.pass} 通过 / ${R.fail} 失败`);

/* 清理 */
try { await send('Page.navigate', { url: 'about:blank' }); } catch {}
ws.close();
ch.kill();
await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
process.exit(R.fail ? 1 : 0);
