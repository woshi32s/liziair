/**
 * _hero.mjs —— 大厅宽幅播放海报的验收（悬停展开歌词 → 点一下飞进播放页）
 *
 * 只用无头 Chrome + CDP；自己起临时 profile，跑完删掉。端口从 .port 读，不写死。
 * 所有数字都从页面上实测：getBoundingClientRect / getComputedStyle / naturalWidth /
 * document.elementFromPoint / Web Animations 的替身层矩形。
 *
 *   node _hero.mjs
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
const PROFILE = path.join(os.tmpdir(), 'lg-hero-acc-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(250); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pend = new Map();
const consoleErrs = []; const exceptions = []; let frames = []; let ackFrames = true;
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
  if (m.method === 'Page.screencastFrame') {
    frames.push({ t: (m.params.metadata.timestamp || 0) * 1000, data: m.params.data });
    if (ackFrames) send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
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
const gate = async (cond, tries = 60, ms = 300) => { for (let i = 0; i < tries; i++) { if (await ev(cond)) return true; await sleep(ms); } return false; };
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, Buffer.from(png.data, 'base64'));
  const st = fs.statSync(p);
  console.log('    →', `shots/review/${name}`, `(${Math.round(st.size / 1024)} KB)`);
};
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
const heroRect = async () => JSON.parse(await ev(`JSON.stringify(document.getElementById('hall-hero').getBoundingClientRect())`));
const hoverHero = async () => {
  const r = await heroRect();
  await move(r.x + r.width / 2, r.y + r.height / 2);
};
/* 重置到干净的大厅（不能 Page.reload：now 页会把 #now 写进 hash，刷新会直接进播放页） */
let navN = 0;
const reset = async () => {
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/?r=${++navN}` });
  await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 80, 400);
  await sleep(700);
};

await send('Page.enable');
await send('Runtime.enable');
/* 无头窗口默认没有文档焦点，focus() 不派发 focusin；打开焦点模拟，键盘路径才测得准 */
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await viewport();
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });
function viewport() { return send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }); }

console.log(`\nLIZI 大厅海报验收  ·  http://127.0.0.1:${APP}/  ·  ${W}×${H} 无头 Chrome`);

/* ================================================================
 * 0. 种一首"上次听到"的歌（真封面 + 真歌词），刷新
 * ================================================================ */
console.log('\n[0] 准备：种一首上次听到的歌');
let seed = null;
try {
  const r = await fetch(`http://127.0.0.1:${APP}/api/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ s: '晴天 周杰伦', limit: 20 }),
  });
  const d = await r.json();
  seed = (d.tracks || []).find((t) => t.id === 186016) || (d.tracks || []).find((t) => t.cover) || null;
  if (seed) {
    seed = {
      id: seed.id, name: seed.name, artists: seed.artists, artistIds: seed.artistIds || [],
      album: seed.album || '', albumId: seed.albumId || null, cover: seed.cover,
      duration: seed.duration || 0, at: Date.now() - 47 * 60000,
    };
  }
} catch { /* 下面有兜底 */ }
if (!seed) {
  seed = {
    id: 186016, name: '晴天', artists: '周杰伦', artistIds: [6452], album: '叶惠美', albumId: 18875,
    cover: 'https://p1.music.126.net/F0fTkmBTVykCa2o7Vgu1rQ==/109951173569626660.jpg',
    duration: 269000, at: Date.now() - 47 * 60000,
  };
}
const seedId = await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { if (!localStorage.getItem('lizi.hall.lastTrack')) localStorage.setItem('lizi.hall.lastTrack', ${JSON.stringify(JSON.stringify(seed))}); } catch (e) {}`,
});
console.log(`    种子曲目：${seed.name} · ${seed.artists} · id=${seed.id}`);
await reset();
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 80, 400))) {
  console.log('!! 大厅没起来，先看服务'); process.exit(2);
}
/* 1200px 封面还在路上时 naturalWidth 是 0 —— 等它真的解码完再量 */
if (!(await gate(`(() => { const i = document.getElementById('hall-hero-cover-img'); return !!i && i.complete && i.naturalWidth > 0; })()`, 60, 200))) {
  console.log('!! 海报封面没加载出来');
}
await sleep(600);

/* ================================================================
 * 1. 初始态：海报高度 / 封面覆盖宽度 / 可见文字
 * ================================================================ */
console.log('\n[1] 初始态');
const rest = JSON.parse(await ev(`(() => {
  const h = document.getElementById('hall-hero');
  const hr = h.getBoundingClientRect();
  const img = document.getElementById('hall-hero-cover-img');
  const cr = img.getBoundingClientRect();
  const badge = document.querySelector('.hall-hero__badge').innerText.replace(/\\s+/g, ' ').trim();
  const title = document.getElementById('hall-hero-title').textContent.trim();
  const sub = document.getElementById('hall-hero-sub').innerText.replace(/\\s+/g, ' ').trim();
  return JSON.stringify({
    hero: { h: +hr.height.toFixed(1), w: +hr.width.toFixed(1) },
    cover: { l: +cr.left.toFixed(1), t: +cr.top.toFixed(1), w: +cr.width.toFixed(1), h: +cr.height.toFixed(1) },
    nat: img.naturalWidth, hasArt: h.classList.contains('has-art'),
    coverOpacity: +getComputedStyle(document.getElementById('hall-hero-cover')).opacity,
    badge, title, sub,
  });
})()`));
console.log(`    海报 ${rest.hero.w}×${rest.hero.h} · 封面盖满 ${rest.cover.w}×${rest.cover.h}（natural ${rest.nat}）· 徽标「${rest.badge}」· 标题「${rest.title}」· 副题「${rest.sub}」`);
ok(1, '初始态：海报高度 / 封面覆盖宽度 / 可见文字',
  `hero=${rest.hero.w}×${rest.hero.h} cover.w=${rest.cover.w}（= 海报宽 ${rest.hero.w}）cover.h=${rest.cover.h} natural=${rest.nat} 徽标="${rest.badge}" 标题="${rest.title}" 副题="${rest.sub}"`,
  Math.abs(rest.hero.h - 400) < 2 && Math.abs(rest.cover.w - rest.hero.w) <= 1 && rest.nat > 200
    && /上次听到/.test(rest.badge) && rest.title.length > 0 && rest.sub.length > 0);
await shot('hero-1-rest.png');

/* ================================================================
 * 2. 悬停 / 移开 / 再悬停
 * ================================================================ */
console.log('\n[2] 悬停：封面缩到左下角 + 右侧歌词');
await hoverHero();
if (!(await gate(`document.getElementById('hall-hero').classList.contains('is-hover')
  && document.querySelectorAll('#hall-hero-rows .ly').length >= 3`, 50, 200))) {
  console.log('!! 悬停态没起来');
}
await sleep(650);   // 等 460ms 的形变收尾
const hover = JSON.parse(await ev(`(() => {
  const h = document.getElementById('hall-hero').getBoundingClientRect();
  const img = document.getElementById('hall-hero-cover-img');
  const c = img.getBoundingClientRect();
  const rows = [...document.querySelectorAll('#hall-hero-rows .ly')];
  const act = document.querySelector('#hall-hero-rows .ly.is-active');
  const cs = rows[0] ? getComputedStyle(rows[0]) : null;
  const box = document.getElementById('hall-hero-lyrics').getBoundingClientRect();
  const visible = rows.filter((r) => {
    const b = r.getBoundingClientRect();
    return b.bottom > box.top + 4 && b.top < box.bottom - 4;
  }).length;
  const hitCover = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
  const hitLyr = document.elementFromPoint(box.left + 120, box.top + box.height / 2);
  const note = document.getElementById('hall-hero-note');
  return JSON.stringify({
    hero: [h.left, h.top, h.width, h.height].map((v) => +v.toFixed(1)),
    cover: [c.left, c.top, c.width, c.height].map((v) => +v.toFixed(1)),
    nat: img.naturalWidth,
    rows: rows.length, visible,
    active: act ? act.textContent.slice(0, 12) : '',
    font: cs && cs.fontSize, lh: cs && cs.lineHeight, ls: cs && cs.letterSpacing,
    colorActive: act ? getComputedStyle(act).color : '',
    noteHidden: note.hidden, noteText: note.textContent.trim(),
    hitCover: hitCover && (hitCover.id || hitCover.className),
    hitLyr: hitLyr && (hitLyr.id || hitLyr.className),
    rad: getComputedStyle(document.getElementById('hall-hero-cover')).borderTopLeftRadius,
    trans: getComputedStyle(document.getElementById('hall-hero-cover')).transitionDuration,
    dim: +getComputedStyle(document.querySelector('.hall-hero__dim')).opacity,
  });
})()`));
const dLeft = +num(hover.cover[0] - hover.hero[0]);
const dBottom = +num((hover.hero[1] + hover.hero[3]) - (hover.cover[1] + hover.cover[3]));
const dSq = +num(Math.abs(hover.cover[2] - hover.cover[3]), 2);
console.log(`    封面 ${hover.cover[2]}×${hover.cover[3]} @ (${hover.cover[0]},${hover.cover[1]}) · left差 ${dLeft}px · bottom差 ${dBottom}px · 正方形差 ${dSq}px · natural ${hover.nat}`);
console.log(`    歌词 ${hover.rows} 行（视口内 ${hover.visible} 行）· active「${hover.active}」· 字号 ${hover.font} / 行距 ${hover.lh} / 字距 ${hover.ls} · 圆角 ${hover.rad} · 时长 ${hover.trans}`);
ok(2, '悬停：封面贴左下角 / 正方形 / 真图，右侧歌词 ≥3 行',
  `left差=${dLeft}px bottom差=${dBottom}px |w-h|=${dSq}px naturalWidth=${hover.nat} 行数=${hover.rows}（可见 ${hover.visible}） 字号=${hover.font} 行距=${hover.lh} 命中=${hover.hitCover}/${hover.hitLyr}`,
  dLeft <= 2 && dBottom <= 2 && dSq <= 1 && hover.nat > 200 && hover.rows >= 3 && hover.visible >= 3);
await shot('hero-2-hover.png');

/* 移开 100ms：必须在回位途中 */
await move(8, 8);
await sleep(100);
const back100 = JSON.parse(await ev(`(() => { const c = document.getElementById('hall-hero-cover-img').getBoundingClientRect(); return JSON.stringify({ w: +c.width.toFixed(1), cls: document.getElementById('hall-hero').className }); })()`));
await sleep(700);
const backRest = JSON.parse(await ev(`(() => {
  const c = document.getElementById('hall-hero-cover-img').getBoundingClientRect();
  return JSON.stringify([c.left, c.top, c.width, c.height].map((v) => +v.toFixed(1)));
})()`));
const dRest = Math.max(...[0, 1, 2, 3].map((i) => Math.abs(backRest[i] - [rest.cover.l, rest.cover.t, rest.cover.w, rest.cover.h][i])));
const returning = back100.w > hover.cover[2] + 8;
console.log(`    移开 100ms：封面宽 ${back100.w}px（悬停时 ${hover.cover[2]}，静止 ${rest.cover.w}）· 回到静止矩形误差 ${num(dRest, 2)}px · cls="${back100.cls}"`);
ok(3, '悬停 → 移开：100ms 内开始回位，回到初始矩形（≤2px）',
  `100ms 宽=${back100.w}px（回位中=${returning}）· 静止矩形 ${backRest.join('×')} vs 初始 ${[rest.cover.l, rest.cover.t, rest.cover.w, rest.cover.h].join('×')} → 最大误差 ${num(dRest, 2)}px`,
  returning && dRest <= 2);

/* 再悬停回来（点之前要停在悬停态，模拟用户操作） */
await hoverHero();
await gate(`document.getElementById('hall-hero').classList.contains('is-hover')`, 30, 100);
await sleep(600);

const hoverFont = JSON.parse(await ev(`(() => {
  const ly = document.querySelector('#hall-hero-rows .ly');
  const cs = getComputedStyle(ly);
  return JSON.stringify({ font: cs.fontSize, lh: cs.lineHeight });
})()`));

/* ================================================================
 * 3. 点击 → 播放页（FLIP 替身层）
 * ================================================================ */
console.log('\n[4] 点击 → 飞进播放页');
/* 在页面里每帧记录替身层的矩形和消失时刻 —— 比在 Node 里轮询准，
   长任务也不会把起飞那几帧漏掉。 */
await ev(`(() => {
  window.__fly = { t0: performance.now(), seen: false, last: null, firstSeen: null, gone: null };
  const tick = () => {
    if (window.__fly.gone != null) return;
    const f = document.querySelector('.hero-fly');
    if (f) {
      const a = f.querySelector('.hero-fly__art');
      if (a) { const r = a.getBoundingClientRect(); window.__fly.last = [r.left, r.top, r.width, r.height]; }
      window.__fly.seen = true;
      if (window.__fly.firstSeen == null) window.__fly.firstSeen = +(performance.now() - window.__fly.t0).toFixed(1);
    } else if (window.__fly.seen) {
      window.__fly.gone = +(performance.now() - window.__fly.t0).toFixed(1);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 1;
})()`);
const tClick = Date.now();
await ev(`document.getElementById('hall-hero').click()`);
await sleep(1000);
const flyLog = JSON.parse(await ev(`JSON.stringify(window.__fly)`));
const lastProxy = flyLog.last ? { a: flyLog.last } : null;
const removedAt = flyLog.gone ? Math.round(flyLog.gone) : 0;
const nowM = JSON.parse(await ev(`(() => {
  const disc = document.querySelector('#view-now .disc');
  const d = disc.getBoundingClientRect();
  const ly = document.querySelector('#view-now #lyrics .ly');
  const cs = ly && getComputedStyle(ly);
  return JSON.stringify({
    view: document.getElementById('view-now').classList.contains('is-active'),
    fly: document.querySelectorAll('.hero-fly').length,
    disc: [d.left, d.top, d.width, d.height].map((v) => +v.toFixed(1)),
    font: cs && cs.fontSize, lh: cs && cs.lineHeight,
    rows: document.querySelectorAll('#view-now #lyrics .ly').length,
    title: document.getElementById('now-title').textContent.trim(),
  });
})()`));
const px = lastProxy ? +num(Math.abs(lastProxy.a[0] - nowM.disc[0])) : 999;
const py = lastProxy ? +num(Math.abs(lastProxy.a[1] - nowM.disc[1])) : 999;
const fontD = hoverFont.font === nowM.font ? 0 : Math.abs(parseFloat(hoverFont.font) - parseFloat(nowM.font));
const lhD = hoverFont.lh === nowM.lh ? 0 : Math.abs(parseFloat(hoverFont.lh) - parseFloat(nowM.lh));
console.log(`    播放页激活=${nowM.view} 标题="${nowM.title}" · 替身最后落点 ${lastProxy ? lastProxy.a.map((v) => num(v)).join(',') : '—'} → 真封面 ${nowM.disc.join(',')} · 落位差 ΔX=${px}px ΔY=${py}px`);
console.log(`    歌词字号 悬停 ${hoverFont.font} / 播放页 ${nowM.font}（差 ${num(fontD, 2)}px）· 行距 ${hoverFont.lh} / ${nowM.lh}（差 ${num(lhD, 2)}px）· 替身回收 ${removedAt || '>1000'}ms · 残留 ${nowM.fly}`);
ok(4.1, '点击 → #view-now 激活，替身层 ≤700ms 移除',
  `view-now=${nowM.view} 替身残留=${nowM.fly} 回收耗时=${removedAt || '>1000'}ms`, nowM.view && nowM.fly === 0 && removedAt > 0 && removedAt <= 700);
ok(4.2, '飞行落位：替身终点 vs 播放页真封面 ≤3px（X/Y 各算）',
  `ΔX=${px}px ΔY=${py}px`, px <= 3 && py <= 3);
ok(2.2, '右侧歌词与播放页歌词同字号 / 同行距（≤0.5px）',
  `字号 ${hoverFont.font} vs ${nowM.font}（差 ${num(fontD, 2)}px）· 行距 ${hoverFont.lh} vs ${nowM.lh}（差 ${num(lhD, 2)}px）`,
  fontD <= 0.5 && lhD <= 0.5 && nowM.rows >= 3);
await shot('hero-4-now.png');

/* ================================================================
 * 5. 中点截图：回到大厅再飞一次，用 screencast 抓飞行中的一帧
 * ================================================================ */
console.log('\n[5] 飞行中截图');
await ev(`document.getElementById('btn-back').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 150);
await sleep(700);
await hoverHero();
await gate(`document.getElementById('hall-hero').classList.contains('is-hover')
  && document.querySelectorAll('#hall-hero-rows .ly').length >= 3`, 40, 150);
await sleep(550);
frames = [];
await send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 });
await sleep(120);
const tShot = Date.now();
await ev(`document.getElementById('hall-hero').click()`);
await sleep(850);
await send('Page.stopScreencast');
let mid = frames.filter((f) => f.t - tShot >= 120 && f.t - tShot <= 380).sort((a, b) => Math.abs(a.t - tShot - 220) - Math.abs(b.t - tShot - 220))[0]
  || frames[Math.floor(frames.length / 2)];
if (mid) {
  fs.writeFileSync(path.join(OUT, 'hero-3-mid-flight.png'), Buffer.from(mid.data, 'base64'));
  console.log(`    → shots/review/hero-3-mid-flight.png（帧 @ ${Math.round(mid.t - tShot)}ms，共 ${frames.length} 帧）`);
} else {
  console.log('    !! 没抓到帧');
}
const midOk = !!mid;
ok(5.1, '飞行中截到一帧（screencast）', `${frames.length} 帧，取 ${mid ? Math.round(mid.t - tShot) + 'ms' : '—'}`, midOk);
await sleep(600);
await shot('hero-4-now.png');

/* ================================================================
 * 6. prefers-reduced-motion: reduce
 * ================================================================ */
console.log('\n[6] reduced-motion');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await reset();
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 80, 400);
await sleep(700);
const rmMedia = await ev(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
await hoverHero();
await gate(`document.getElementById('hall-hero').classList.contains('is-hover')`, 30, 100);
await sleep(300);
const tRm = Date.now();
await ev(`document.getElementById('hall-hero').click()`);
await sleep(40);
const rm = JSON.parse(await ev(`(() => {
  const v = document.getElementById('view-now');
  return JSON.stringify({ view: v.classList.contains('is-active'), fly: document.querySelectorAll('.hero-fly').length, hero: document.getElementById('hall-hero').className });
})()`));
console.log(`    media.reduce=${rmMedia} · 点击后 40ms：view-now=${rm.view} 替身=${rm.fly} · 用时 ${Date.now() - tRm}ms`);
ok(6, 'prefers-reduced-motion: reduce → 不飞（0ms，无替身层），直接进播放页',
  `reduce=${rmMedia} view-now=${rm.view} .hero-fly=${rm.fly}`, rmMedia && rm.view && rm.fly === 0);

/* ================================================================
 * 7. 无歌词曲目：不留空框，给一句提示
 * ================================================================ */
console.log('\n[7] 无歌词曲目');
await send('Emulation.setEmulatedMedia', { features: [] });
await ev(`localStorage.setItem('lizi.hall.lastTrack', JSON.stringify({
  id: 999999999, name: '纯音乐（无歌词测试）', artists: '—', artistIds: [],
  album: '', albumId: null, cover: ${JSON.stringify(seed.cover)}, duration: 0, at: Date.now() - 60000
}))`);
await reset();
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 80, 400);
await sleep(700);
await hoverHero();
await gate(`document.getElementById('hall-hero').classList.contains('is-hover')`, 30, 100);
await sleep(900);
const noLyr = JSON.parse(await ev(`(() => {
  const note = document.getElementById('hall-hero-note');
  const box = document.getElementById('hall-hero-lyrics').getBoundingClientRect();
  const n = note.getBoundingClientRect();
  return JSON.stringify({
    rows: document.querySelectorAll('#hall-hero-rows .ly').length,
    noteHidden: note.hidden, noteText: note.textContent.trim(),
    noteVisible: note.offsetHeight > 0,
    box: [box.width, box.height].map((v) => +v.toFixed(0)),
    noteBox: [n.width, n.height].map((v) => +v.toFixed(0)),
    hasArt: document.getElementById('hall-hero').classList.contains('has-art'),
    coverNat: document.getElementById('hall-hero-cover-img').naturalWidth,
  });
})()`));
console.log(`    行数=${noLyr.rows} 提示「${noLyr.noteText}」可见=${noLyr.noteVisible} 提示盒=${noLyr.noteBox.join('×')} 歌词盒=${noLyr.box.join('×')} 封面=${noLyr.hasArt}(natural ${noLyr.coverNat})`);
ok(7, '无歌词：不出现空框，提示文案可见',
  `ly 行数=${noLyr.rows} note.hidden=${noLyr.noteHidden} note="${noLyr.noteText}" 可见=${noLyr.noteVisible}`,
  noLyr.rows === 0 && !noLyr.noteHidden && noLyr.noteText.length > 0 && noLyr.noteVisible);

/* ================================================================
 * 8. 键盘：Tab 聚焦 → 悬停态；Enter → 播放页
 * ================================================================ */
console.log('\n[8] 键盘');
await ev(`localStorage.setItem('lizi.hall.lastTrack', ${JSON.stringify(JSON.stringify(seed))})`);
await reset();
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 80, 400);
await sleep(700);
const kb1 = JSON.parse(await ev(`(() => {
  const h = document.getElementById('hall-hero');
  h.focus();
  return JSON.stringify({ focused: document.activeElement === h, focusVisible: h.matches(':focus-visible'), cls: h.className, tab: h.getAttribute('tabindex') });
})()`));
/* 聚焦后歌词是异步取的：等它到齐再断言 */
await gate(`document.querySelectorAll('#hall-hero-rows .ly').length >= 3`, 50, 200);
await sleep(250);
const kb2 = JSON.parse(await ev(`(() => {
  const h = document.getElementById('hall-hero');
  return JSON.stringify({ cls: h.className, rows: document.querySelectorAll('#hall-hero-rows .ly').length });
})()`));
await ev(`document.getElementById('hall-hero').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
await sleep(900);
const kb3 = JSON.parse(await ev(`JSON.stringify({ view: document.getElementById('view-now').classList.contains('is-active'), fly: document.querySelectorAll('.hero-fly').length })`));
console.log(`    聚焦=${kb1.focused} focus-visible=${kb1.focusVisible} tabindex=${kb1.tab} → 悬停态 cls="${kb2.cls}" 歌词 ${kb2.rows} 行 → Enter 后 view-now=${kb3.view}`);
ok(8, '键盘：Tab 聚焦进悬停态，Enter 进播放页',
  `focus=${kb1.focused} is-hover=${/is-hover/.test(kb2.cls)} 歌词行=${kb2.rows} -> view-now=${kb3.view}`,
  kb1.focused && /is-hover/.test(kb2.cls) && kb2.rows >= 3 && kb3.view);

/* ================================================================
 * 9. 回归：大厅滚动 / 播放键 / 实验室 / 歌手页 / console
 * ================================================================ */
console.log('\n[9] 回归');
await ev(`document.getElementById('btn-back').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 150);
await sleep(600);
/* 9.1 下滑推荐歌单还能滚 */
const feed = JSON.parse(await ev(`(async () => {
  const v = document.getElementById('view-hall');
  v.scrollTop = 900;
  await new Promise((r) => setTimeout(r, 500));
  return JSON.stringify({ top: Math.round(v.scrollTop), cards: document.querySelectorAll('#hall-feed .hall-pl').length, sh: v.scrollHeight, ch: v.clientHeight });
})()`));
console.log(`    大厅滚动 top=${feed.top} 推荐歌单 ${feed.cards} 张（内容 ${feed.sh} / 视口 ${feed.ch}）`);
ok(9.1, '大厅下滑推荐歌单仍能滚', `scrollTop=${feed.top} feed=${feed.cards} 张`, feed.top > 200 && feed.cards > 0);
/* 9.1b 顶栏滚动态（内容从玻璃顶栏下经过的那套）仍跟着大厅 */
const stuck = JSON.parse(await ev(`(async () => {
  const v = document.getElementById('view-hall');
  const tb = document.getElementById('topbar');
  v.scrollTop = 600; await new Promise((r) => setTimeout(r, 400));
  const down = tb.classList.contains('is-stuck');
  v.scrollTop = 0; await new Promise((r) => setTimeout(r, 400));
  return JSON.stringify({ down, up: tb.classList.contains('is-stuck'), y: Math.round(v.scrollTop) });
})()`));
console.log(`    顶栏 is-stuck：下滑=${stuck.down} 回顶=${stuck.up}`);
ok('9.1b', '顶栏滚动态（logo 收缩 / 玻璃暗部）仍跟着大厅滚动',
  `下滑 is-stuck=${stuck.down}；回到顶 is-stuck=${stuck.up}`, stuck.down && !stuck.up);/* 9.2 播放键仍能播 */
await ev(`document.getElementById('view-hall').scrollTop = 0`);
await sleep(300);
await ev(`document.getElementById('hall-hero-play').click()`);
const played = await gate(`(() => { const a = Player.audio; return document.body.classList.contains('is-playing') && a && a.currentTime > 0.15; })()`, 40, 300);
const playState = JSON.parse(await ev(`JSON.stringify({ playing: document.body.classList.contains('is-playing'), t: +(Player.audio.currentTime || 0).toFixed(2), src: !!Player.audio.src })`));
console.log(`    播放键：playing=${playState.playing} currentTime=${playState.t}s src=${playState.src}`);
ok(9.2, '海报播放键仍能播（不触发飞行）',
  `is-playing=${playState.playing} currentTime=${playState.t}s`, played && playState.t > 0.15);
/* 9.3 实验室 */
await ev(`document.querySelector('#hall-tools [data-tool="0"]').click()`);
const labOk = await gate(`document.getElementById('view-lab').classList.contains('is-active')`, 40, 200);
console.log(`    #view-lab 打开=${labOk}`);
ok(9.3, '#view-lab 仍能打开', `is-active=${labOk}`, labOk);
await ev(`document.getElementById('btn-back').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 150);
await sleep(400);
/* 9.4 歌手页：点海报副题里的歌手名 */
const artistClicked = await ev(`(() => {
  const a = document.querySelector('#hall-hero-sub [data-aid]');
  if (!a) return false;
  a.click();
  return true;
})()`);
const artistOk = artistClicked && await gate(`document.getElementById('view-artist').classList.contains('is-active')
  && document.querySelectorAll('#view-artist .pg-album').length > 0`, 60, 300);
console.log(`    #view-artist 打开=${artistOk}（点了 ${artistClicked ? '歌手名' : '没找到入口'}）`);
ok(9.4, '#view-artist 仍能打开', `入口=${artistClicked} is-active=${!!artistOk}`, !!artistOk);

/* ================================================================
 * 10. console / 总结
 * ================================================================ */
await sleep(300);
console.log(`\n[10] console：error ${consoleErrs.length} 条，异常 ${exceptions.length} 条`);
if (consoleErrs.length) console.log('    errs:', consoleErrs.slice(0, 4).join(' | '));
if (exceptions.length) console.log('    excs:', exceptions.slice(0, 4).join(' | '));
ok(10, '0 console error / 0 未捕获异常', `errors=${consoleErrs.length} exceptions=${exceptions.length}`, consoleErrs.length === 0 && exceptions.length === 0);

console.log(`\n===== 结果：${R.pass} PASS / ${R.fail} FAIL =====\n`);

ws.close();
ch.kill();
await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(R.fail ? 1 : 0);
