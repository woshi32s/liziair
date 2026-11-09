/**
 * _maforms.mjs —— 「我的专辑」第二轮打回验收（重写版）
 *
 * 对应用户第二轮的五条：
 *   ① 绿封面必须出绿脊（整图色相直方图取色，不再抓单簇）
 *   ② 侧立封面 ≥ 840px（1440 宽下 864）、无横向溢出
 *   ③ 底部提示语整行删除（[data-hint] 不存在）、舞台下面不留空隙
 *   ④ 特写有真实纵深：|rotateY| ≥ 12°、rotateX ≥ 4°、黑胶滑出 ≥ 45%、label 可见
 *   ⑤ 指针微动（3D 视差）：0.5°~6°、500ms 内变化、离开归零、reduce 下不生效
 * 外加回归：拖拽 / ←→ / 抽屉 / 计数 / 空状态 / 形态切换（flow 仍 300px、点击直接进页）/
 *   0 console error / 0 未捕获异常，以及三张截图。
 *
 * 无头 Chrome + CDP，端口读 .port（11701）。不碰 Electron 窗口。
 *   node _maforms.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440, H = 900;
/* 截图用的高视口：封面 864 + 舞台 968 在 900 高的窗口里必然要滚，
   截"整架"时临时把高度放到 1500（宽度仍是 1440，验收要求的 1440 宽不变）。 */
const WH = 1500;
const OUT = path.join(HERE, 'shots', 'review');
fs.mkdirSync(OUT, { recursive: true });

const R = { pass: 0, fail: 0, rows: [] };
const ok = (n, name, detail, pass) => {
  R.rows.push({ n, name, detail, pass });
  if (pass) R.pass++; else R.fail++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  [${n}] ${name} —— ${detail}`);
};

/* ---------- 颜色：sRGB ↔ OKLCH + WCAG 对比度（Node 侧算，和页面无关） ---------- */
const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
function oklchOf([r, g, b]) {
  const R_ = lin(r), G_ = lin(g), B_ = lin(b);
  const l = Math.cbrt(0.4122214708 * R_ + 0.5363325363 * G_ + 0.0514459929 * B_);
  const m = Math.cbrt(0.2119034982 * R_ + 0.6806995451 * G_ + 0.1073969566 * B_);
  const s = Math.cbrt(0.0883024619 * R_ + 0.2817188376 * G_ + 0.6299787005 * B_);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  let h = (Math.atan2(B, A) * 180) / Math.PI; if (h < 0) h += 360;
  return { L, C: Math.hypot(A, B), h };
}
const hexOf = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const lumOf = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const x = lumOf(a), y = lumOf(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const fmtOklch = (o) => `oklch(${(o.L * 100).toFixed(1)}% ${o.C.toFixed(3)} ${o.h.toFixed(0)})`;
const dh = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/* ---------- 无头 Chrome ---------- */
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-maforms7-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-gpu',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pend = new Map();
let consoleErrs = []; let exceptions = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result || {}); }
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
  return r.result ? r.result.value : undefined;
};
const j = async (x) => {
  const s = await ev(x);
  if (typeof s !== 'string' || s.startsWith('EXC:')) return { exc: s };
  try { return JSON.parse(s); } catch { return { exc: 'BADJSON:' + s.slice(0, 120) }; }
};
const gate = async (cond, tries = 60, ms = 250) => {
  for (let i = 0; i < tries; i++) { if (await ev(cond)) return true; await sleep(ms); }
  return false;
};
const shot = async (name, clip) => {
  const png = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, Buffer.from(png.data, 'base64'));
  console.log('    →', `shots/review/${name}`, `(${Math.round(fs.statSync(p).size / 1024)} KB)`);
  return png.data;
};
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const moveTo = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
};
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};
const viewport = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const rectOf = async (sel) => j(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return JSON.stringify({ ok: false });
  const b = e.getBoundingClientRect();
  return JSON.stringify({ ok: true, x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, left: b.left, top: b.top, right: b.right, bottom: b.bottom });
})()`);
const clickSel = async (sel) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' }); return 1; })()`);
  await sleep(160);
  const r = await rectOf(sel);
  if (!r.ok) return false;
  await clickAt(r.x, r.y);
  return true;
};

const waitCovers = async (ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const done = await ev(`(() => {
      const imgs = [...document.querySelectorAll('#view-myalbums .ma-item img')];
      return imgs.length > 0 && imgs.every((m) => !m || m.complete);
    })()`);
    if (done === true) return true;
    await sleep(200);
  }
  return false;
};
/** 顶栏左键在非大厅视图里就是「返回」（app.js 的 setTopLeftMode('back')） */
const backToShelf = async () => {
  const tBack = await ev(`Math.round(performance.now())`);
  await clickSel('#btn-settings');
  return gate(`document.body.dataset.view === 'myalbums'
    && document.getElementById('view-myalbums').classList.contains('is-active')
    && window.__lastShow.view === 'myalbums' && window.__lastShow.t > ${tBack}`, 100, 200);
};
const openShelf = async () => {
  await ev(`if (!window.__navMark) {
    window.__navMark = 1;
    window.__lastShow = { view: '', t: 0 };
    document.addEventListener('lizi:show', (e) => {
      window.__lastShow = { view: (e.detail && e.detail.view) || '', t: Math.round(performance.now()) };
    });
  } 'ok'`);
  const viaHall = await ev(`(() => {
    const b = [...document.querySelectorAll('#hall-tools .hrow, #hall-tools button')]
      .find((x) => /我的专辑/.test(x.textContent || ''));
    if (!b) return 0;
    b.click(); return 1;
  })()`);
  if (!viaHall) await ev(`document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view: 'myalbums' } }))`);
  return gate(`document.body.dataset.view === 'myalbums' && document.querySelectorAll('#view-myalbums .ma-item').length > 0`, 100, 200);
};

/* 一屏几何 + 配色 + 提示语存在性（一次拿全） */
const geo = () => j(`(() => {
  const v = document.getElementById('view-myalbums');
  const st = v.querySelector('.ma-stage');
  const world = v.querySelector('.ma-world');
  const player = document.getElementById('player');
  const items = [...v.querySelectorAll('.ma-item')];
  const cs = getComputedStyle(v);
  const wr = world.getBoundingClientRect();
  const sr = st.getBoundingClientRect();
  const pr = player ? player.getBoundingClientRect() : null;
  const one = (it, i) => {
    const sp = it.querySelector('.ma-item__spine');
    const sc = getComputedStyle(sp);
    return {
      i, key: it.dataset.key,
      sel: it.classList.contains('is-sel'),
      open: it.classList.contains('is-open'),
      tx: it.style.transform,
      w: it.offsetWidth, h: it.offsetHeight,
      spineW: Math.round(sp.getBoundingClientRect().width),
      spineH: Math.round(sp.getBoundingClientRect().height),
      bg: sc.backgroundColor,
      fg: sc.color,
      spBgVar: sc.getPropertyValue('--sp-bg').trim(),
      amb: it.dataset.amb || '',
      hue: Number(it.dataset.spHue || 'NaN'),
      src: it.dataset.spSrc || '',
    };
  };
  return JSON.stringify({
    form: (v.querySelector('[data-ma]') || { dataset: {} }).dataset.form,
    bg: v.dataset.bg || '',
    sizeVar: cs.getPropertyValue('--ma-size').trim(),
    world: [Math.round(wr.width), Math.round(wr.height)],
    worldTx: world.style.transform || getComputedStyle(world).transform,
    stage: [Math.round(sr.width), Math.round(sr.height), st.scrollHeight, st.scrollWidth, st.clientHeight, st.clientWidth],
    stageBox: [Math.round(sr.top), Math.round(sr.bottom)],
    view: [v.scrollHeight, v.clientHeight, v.scrollWidth, v.clientWidth, v.scrollTop],
    playerTop: pr ? Math.round(pr.top) : null,
    hint: !!v.querySelector('[data-hint]'),
    note: !!v.querySelector('[data-note]'),
    ambient: cs.getPropertyValue('--ambient-color').trim(),
    bgImage: getComputedStyle(v).backgroundImage.slice(0, 90),
    count: (v.querySelector('[data-count]') || {}).textContent,
    pos: Math.round(window.__LIZI_MYALBUMS.pos() * 100) / 100,
    mid: window.__LIZI_MYALBUMS.index(),
    openIdx: window.__LIZI_MYALBUMS.openIndex(),
    openP: window.__LIZI_MYALBUMS.openP(),
    metrics: window.__LIZI_MYALBUMS.metrics(),
    tilt: window.__LIZI_MYALBUMS.tilt(),
    all: items.map(one),
  });
})()`);

/* 截图/验收共用的裁切框：从页面顶（含玻璃顶栏）截到舞台底下 40px，
   不把 1500 高视口下部那片空白纸面带进图里 */
const clipToStage = async (pad = 40) => {
  const r = await rectOf('#view-myalbums .ma-stage');
  return { x: 0, y: 0, width: W, height: Math.round(Math.min(WH, r.bottom + pad)), scale: 1 };
};

/** 页面里把任意 CSS 颜色（oklch 也行）解析成 RGB（canvas 读像素；带 alpha 的读前三个通道） */
const RGB_HELPER = `window.__rgb = (css) => {
  const c = window.__rgbc || (window.__rgbc = document.createElement('canvas'));
  c.width = c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, 1, 1);
  x.fillStyle = '#000'; x.fillStyle = css;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}; 'ok'`;

await send('Page.enable');
await send('Runtime.enable');
await viewport(W, H);
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });

console.log(`\nLIZI 我的专辑 第二轮验收（取色 / 尺寸 / 特写 3D / 指针微动）  ·  http://127.0.0.1:${APP}/  ·  ${W}×${H} 无头 Chrome`);

/* ================================================================
 * 0. 准备：6 张真专辑 + 2 张纯色测试封面（绿 / 红，data URL 在页面里现画）
 * ================================================================ */
console.log('\n[0] 准备');
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 100, 400))) {
  console.log('!! 大厅没起来，先看服务'); process.exit(2);
}
const ALBUMS = JSON.parse(await ev(`fetch('/api/artist/albums/6452?limit=6&offset=0')
  .then(r => r.json())
  .then(d => JSON.stringify((d.albums || []).slice(0, 6).map((a, i) => ({
    id: 'netease:' + a.id, name: a.name, artists: '周杰伦', cover: a.cover,
    publishTime: a.publishTime, trackCount: a.size, source: 'netease', addedAt: Date.now() - i * 1000,
  }))))`));
if (!Array.isArray(ALBUMS) || ALBUMS.length < 6) { console.log('!! 拿不到专辑列表', ALBUMS); process.exit(2); }

const GREEN_KEY = 'netease:990001';
const RED_KEY = 'netease:990002';
const seeded = await ev(`(() => {
  const mk = (css) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = css; x.fillRect(0, 0, 64, 64);
    return c.toDataURL('image/png');
  };
  const base = ${JSON.stringify(ALBUMS)};
  const green = { id: '${GREEN_KEY}', name: '测试封面·纯绿 hsl(140 60% 40%)', artists: '色相验收',
    cover: mk('hsl(140 60% 40%)'), source: 'netease', addedAt: Date.now() };
  const red = { id: '${RED_KEY}', name: '测试封面·纯红 hsl(0 100% 50%)', artists: '色相验收',
    cover: mk('hsl(0 100% 50%)'), source: 'netease', addedAt: Date.now() - 1 };
  localStorage.setItem('lizi.myAlbums.v1', JSON.stringify([green, red, ...base]));
  localStorage.removeItem('lizi.myAlbums.form');
  localStorage.removeItem('lizi.myAlbums.bg');
  return 'seeded ' + (base.length + 2);
})()`);
console.log('    ' + seeded);
await send('Page.reload');
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0 && !!window.__LIZI_MYALBUMS`, 120, 400))) {
  console.log('!! 刷新后没回来'); process.exit(2);
}
await openShelf();
await gate(`document.querySelectorAll('#view-myalbums .ma-item').length === 8`, 80, 200);
await waitCovers();
await sleep(1000);                      /* 等封面取色 + 惯性收敛 */
await ev(RGB_HELPER);

const g0 = await geo();
console.log(`    form=${g0.form}  bg=${g0.bg}  --ma-size=${g0.sizeVar}  舞台 ${g0.stage[0]}×${g0.stage[1]}`);
console.log('    8 张：' + g0.all.map((x) => x.key).join(' | '));

/* ================================================================
 * 1. 取色：绿封面 → 绿脊（120°~165°）；红封面 → 红脊（0°~40°）
 * ================================================================ */
console.log('\n[1] 整图色相直方图取色（绿 / 红测试封面）');
const pick = async (key, idx) => {
  /* 选中它（openUp 会 paintSel → applyAmbient），读脊色 + 环境色，再收回去 */
  const raw = await j(`(() => {
    const it = [...document.querySelectorAll('#view-myalbums .ma-item')]
      .find((x) => x.dataset.key === ${JSON.stringify(key)});
    if (!it) return JSON.stringify({ found: false });
    window.__LIZI_MYALBUMS.openUp(${idx});
    const sp = it.querySelector('.ma-item__spine');
    const sc = getComputedStyle(sp);
    const v = document.getElementById('view-myalbums');
    const amb = getComputedStyle(v).getPropertyValue('--ambient-color').trim();
    return JSON.stringify({
      found: true, key: it.dataset.key, src: it.dataset.spSrc || '',
      spine: sc.backgroundColor, spineVar: sc.getPropertyValue('--sp-bg').trim(),
      letter: sc.color, amb, hueTag: Number(it.dataset.spHue || 'NaN'),
      bgRgb: window.__rgb(sc.backgroundColor), fgRgb: window.__rgb(sc.color), ambRgb: window.__rgb(amb),
      ambRaw: it.dataset.amb || '',
    });
  })()`);
  await sleep(260);
  await ev(`window.__LIZI_MYALBUMS.closeUp(); 'closed'`);
  await sleep(400);
  return raw;
};
const greenIdx = g0.all.findIndex((x) => x.key === GREEN_KEY);
const redIdx = g0.all.findIndex((x) => x.key === RED_KEY);
const gG = await pick(GREEN_KEY, greenIdx);
const gR = await pick(RED_KEY, redIdx);
const oG = oklchOf(gG.bgRgb), oR = oklchOf(gR.bgRgb);
const aG = oklchOf(gG.ambRgb), aR = oklchOf(gR.ambRgb);
console.log(`    绿封面：脊色 ${gG.spineVar}  = ${hexOf(gG.bgRgb)}  ${fmtOklch(oG)}  脊字 ${hexOf(gG.fgRgb)} 对比度 ${contrast(gG.bgRgb, gG.fgRgb).toFixed(1)}:1`);
console.log(`            环境色 ${gG.amb}  = ${hexOf(gG.ambRgb)}  ${fmtOklch(aG)}   取色来源=${gG.src}`);
console.log(`    红封面：脊色 ${gR.spineVar}  = ${hexOf(gR.bgRgb)}  ${fmtOklch(oR)}  脊字 ${hexOf(gR.fgRgb)} 对比度 ${contrast(gR.bgRgb, gR.fgRgb).toFixed(1)}:1`);
console.log(`            环境色 ${gR.amb}  = ${hexOf(gR.ambRgb)}  ${fmtOklch(aR)}   取色来源=${gR.src}`);
ok('1a', '绿封面 → 绿脊：脊色色相落在 120°~165°',
  `脊色 ${gG.spineVar}（${hexOf(gG.bgRgb)}）= ${fmtOklch(oG)}，色相 ${oG.h.toFixed(1)}°；来源=${gG.src}`,
  gG.found && gG.src === 'cover' && oG.h >= 120 && oG.h <= 165);
ok('1b', '绿封面的环境色同色相族（±20°）',
  `环境色 ${gG.amb} = ${fmtOklch(aG)}，色相 ${aG.h.toFixed(1)}°，与脊色差 ${dh(aG.h, oG.h).toFixed(1)}°`,
  gG.found && gG.ambRgb[3] > 0 && dh(aG.h, oG.h) <= 20);
ok('1c', '红封面 → 红脊：脊色色相落在 0°~40°',
  `脊色 ${gR.spineVar}（${hexOf(gR.bgRgb)}）= ${fmtOklch(oR)}，色相 ${oR.h.toFixed(1)}°；来源=${gR.src}`,
  gR.found && gR.src === 'cover' && oR.h >= 0 && oR.h <= 40);
ok('1d', '红封面的环境色同色相族（±20°）',
  `环境色 ${gR.amb} = ${fmtOklch(aR)}，色相 ${aR.h.toFixed(1)}°，与脊色差 ${dh(aR.h, oR.h).toFixed(1)}°`,
  gR.found && gR.ambRgb[3] > 0 && dh(aR.h, oR.h) <= 20);
/* 绿 ≠ 红：证明"跟着封面走"而不是固定色 */
ok('1e', '绿 / 红两组的脊色确实是两种颜色（不是同一套预置色）',
  `绿 ${hexOf(gG.bgRgb)} ${oG.h.toFixed(0)}° / 红 ${hexOf(gR.bgRgb)} ${oR.h.toFixed(0)}°`,
  dh(oG.h, oR.h) > 60 && hexOf(gG.bgRgb) !== hexOf(gR.bgRgb));

/* 把两张测试封面撤掉，后面用 6 张真专辑 */
await ev(`window.__LIZI_MYALBUMS.collection.remove(${JSON.stringify(GREEN_KEY)});
  window.__LIZI_MYALBUMS.collection.remove(${JSON.stringify(RED_KEY)}); 'removed'`);
await sleep(700);
await gate(`document.querySelectorAll('#view-myalbums .ma-item').length === 6`, 60, 200);
await sleep(600);

/* ================================================================
 * 2. 尺寸：1440 宽下 ≥ 840px（实测 864）、无横向溢出
 * ================================================================ */
console.log('\n[2] 尺寸');
const pxOf = (s) => Number(String(s).replace('px', '')) || 0;
const g2 = await geo();
const coverSize = pxOf(g2.sizeVar);
const stageOverX = g2.stage[3] - g2.stage[5];
const viewOverX = g2.view[2] - g2.view[3];
const midItem = g2.all[g2.mid];
const stageOv = await ev(`getComputedStyle(document.querySelector('#view-myalbums .ma-stage')).overflowX`);
console.log(`    --ma-size=${coverSize}px  .ma-world=${g2.world[0]}×${g2.world[1]}px  单张卡 offsetWidth=${midItem.w}px`);
console.log(`    舞台：${g2.stage[0]}×${g2.stage[1]}px，overflow-x=${stageOv}；自身 scrollWidth=${g2.stage[3]}（这台 Chrome 对被 clip 掉的内容仍计入 scrollWidth，所以它不是"溢出"判据）`);
console.log(`    视图：#view-myalbums scrollWidth=${g2.view[2]} / clientWidth=${g2.view[3]}（横向溢出 ${viewOverX}px）`);
console.log(`    视图纵向：scrollHeight=${g2.view[0]} / clientHeight=${g2.view[1]}（封面 864 → 页面可纵向滚动，这是"大两倍多"的必然）`);
console.log(`    中卡立脊：${midItem.spineW}×${midItem.spineH}px = 2×--ma-half（参考 420/18px → 864/37px）`);
ok('2a', '1440 宽：侧立封面 ≥ 840px（实测 864 = min(880, vw*0.60)）',
  `--ma-size=${coverSize}px；.ma-world ${g2.world[0]}×${g2.world[1]}px；单张卡 ${midItem.w}px；立脊 ${midItem.spineW}px`,
  coverSize >= 840 && g2.world[0] === coverSize && midItem.w === coverSize);
const docOver = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
ok('2b', '无横向溢出（视图 / 文档 scrollWidth <= clientWidth）',
  `视图 ${g2.view[2]}<=${g2.view[3]}；文档溢出 ${docOver}px；舞台 overflow-x=${stageOv} 把两侧超出的卡裁在舞台内`
  + `（舞台自身 scrollWidth=${g2.stage[3]} 含被裁内容的包围盒，不是可视溢出）`,
  viewOverX <= 0 && Number(docOver) <= 0 && stageOv === 'clip');
/* 断点：仍按视口算，且 1440 档要 ≥ 840 */
await viewport(1024, 900); await sleep(700);
const g1024 = await geo();
await viewport(860, 900); await sleep(700);
const g860 = await geo();
await viewport(W, H); await sleep(700);
const gBack = await geo();
console.log(`    断点：1024 宽 → ${g1024.sizeVar}；860 宽 → ${g860.sizeVar}；回到 1440 → ${gBack.sizeVar}`);
ok('2c', '断点跟着基准值改（>900 → ≥840 / ≤900 → 480 / ≤640 → 260）',
  `1024px → ${g1024.sizeVar}；860px → ${g860.sizeVar}；1440px → ${gBack.sizeVar}`,
  pxOf(g1024.sizeVar) >= 840 && pxOf(g860.sizeVar) === 480 && pxOf(gBack.sizeVar) === 864);

/* ================================================================
 * 3. 底部提示语整行删除 + 舞台下面没有空隙
 * ================================================================ */
console.log('\n[3] 提示语');
const g3 = await geo();
/* 滚到底再看"舞台底边 → 播放条顶"的间隙（页面可以纵向滚，所以要滚到底再量） */
const gap = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  v.scrollTop = v.scrollHeight;
  const st = v.querySelector('.ma-stage').getBoundingClientRect();
  const pr = document.getElementById('player').getBoundingClientRect();
  const hint = v.querySelector('[data-hint]');
  const q = (s) => v.querySelector(s);
  return JSON.stringify({
    hintExists: !!hint, hintQuery: document.querySelectorAll('[data-hint]').length,
    noteExists: !!q('[data-note]'), noteHidden: q('[data-note]') ? q('[data-note]').hidden : null,
    stageBottom: Math.round(st.bottom), playerTop: Math.round(pr.top),
    gap: Math.round(pr.top - st.bottom),
    maBottomPad: getComputedStyle(v).paddingBottom,
    textAfterStage: (q('.ma') ? q('.ma').innerText.replace(/\\s+/g, ' ').slice(-90) : ''),
  });
})()`);
await sleep(200);
console.log(`    [data-hint] 存在=${gap.hintExists}（querySelectorAll 命中 ${gap.hintQuery} 个）；[data-note] 存在=${gap.noteExists} hidden=${gap.noteHidden}`);
console.log(`    滚到底：舞台底边 y=${gap.stageBottom}，播放条顶 y=${gap.playerTop} → 间隙 ${gap.gap}px（视图 padding-bottom=${gap.maBottomPad}）`);
console.log(`    舞台之后的内容：「${gap.textAfterStage}」`);
ok('3a', '[data-hint] 已从 DOM 删除（querySelector 返回 null）',
  `document.querySelectorAll('[data-hint]').length = ${gap.hintQuery}；舞台后最后一个元素是 .ma-note（hidden=${gap.noteHidden}，只在音源不支持时出现 3.2s）`,
  gap.hintExists === false && gap.hintQuery === 0);
ok('3b', '舞台下面没有多余空白（底边到播放条顶 < 60px）',
  `间隙 ${gap.gap}px = 视图 padding-bottom ${gap.maBottomPad}（提示行删掉后没有残留占位）`,
  gap.gap >= 0 && gap.gap < 60);
await ev(`document.getElementById('view-myalbums').scrollTop = 0; 'top'`);
await sleep(300);

/* ================================================================
 * 4. 特写：真实 3D 纵深 + 黑胶滑出 + label 可见
 * ================================================================ */
console.log('\n[4] 特写 3D');
await sleep(400);
const stg = await rectOf('#view-myalbums .ma-stage');
const idx4 = await ev(`window.__LIZI_MYALBUMS.index()`);
const t0 = await ev(`document.querySelectorAll('#view-myalbums .ma-item')[${idx4}].style.transform`);
const url0 = await ev(`location.href`);
const view0 = await ev(`document.body.dataset.view`);
/* 先把指针挪开，别让微动混进 closeup 的 transform 读数（微动只作用在 .ma-world 上） */
await moveTo(4, 4); await sleep(500);
await clickAt(stg.x, stg.y);
await sleep(120);
const t1 = await ev(`document.querySelectorAll('#view-myalbums .ma-item')[${idx4}].style.transform`);
await gate(`window.__LIZI_MYALBUMS.openP()[${idx4}] > 0.999`, 60, 100);
await sleep(300);
const t2 = await ev(`document.querySelectorAll('#view-myalbums .ma-item')[${idx4}].style.transform`);
const s4 = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const it = v.querySelectorAll('.ma-item')[${idx4}];
  const vin = it.querySelector('.ma-item__vinyl');
  const vc = getComputedStyle(vin);
  const vr = vin.getBoundingClientRect();
  const lb = it.querySelector('.ma-item__vlabel');
  const art = it.querySelector('.ma-item__art');
  const lr = lb.getBoundingClientRect(), ar = art.getBoundingClientRect();
  const ix = Math.max(0, Math.min(lr.right, ar.right) - Math.max(lr.left, ar.left));
  const iy = Math.max(0, Math.min(lr.bottom, ar.bottom) - Math.max(lr.top, ar.top));
  const inter = ix * iy, area = lr.width * lr.height;
  /* 遮挡的硬判定：临时让 label 可命中，看正封中心点最上层是谁（vinyl 平时是 pointer-events:none） */
  const cx = lr.left + lr.width / 2, cy = lr.top + lr.height / 2;
  const prev = lb.style.pointerEvents;
  lb.style.pointerEvents = 'auto';
  const topEl = document.elementFromPoint(cx, cy);
  lb.style.pointerEvents = prev;
  const m = new DOMMatrixReadOnly(vc.transform);
  return JSON.stringify({
    view: document.body.dataset.view, url: location.href,
    openIdx: window.__LIZI_MYALBUMS.openIndex(), openP: window.__LIZI_MYALBUMS.openP(),
    isOpen: it.classList.contains('is-open'), tx: it.style.transform,
    vinyl: { w: Math.round(vr.width), h: Math.round(vr.height), opacity: vc.opacity,
      anim: vc.animationName, dur: vc.animationDuration, tx: vc.transform,
      boxW: vin.offsetWidth, boxH: vin.offsetHeight,
      slidePx: Math.round(m.m41), slidePct: Math.round((m.m41 / vin.offsetWidth) * 1000) / 10,
      cardW: it.offsetWidth },
    label: { w: Math.round(lr.width), h: Math.round(lr.height),
      rect: [Math.round(lr.left), Math.round(lr.top), Math.round(lr.right), Math.round(lr.bottom)],
      artRect: [Math.round(ar.left), Math.round(ar.top), Math.round(ar.right), Math.round(ar.bottom)],
      coverRatio: Math.round((inter / area) * 1000) / 10,
      topEl: topEl ? (topEl.className || topEl.tagName) : '',
      onTop: !!(topEl && (topEl === lb || lb.contains(topEl))) },
    cta: (() => { const g = v.querySelector('[data-cta]'); if (!g) return null;
      const r = g.getBoundingClientRect();
      return { hidden: g.hidden, text: g.textContent.replace(/\\s+/g, ' ').trim(), w: Math.round(r.width), h: Math.round(r.height) }; })(),
  });
})()`);
const ang = (s, name) => {
  const mm = new RegExp(name + '\\((-?[0-9.]+)deg\\)').exec(String(s) || '');
  return mm ? Number(mm[1]) : NaN;
};
const ryOpen = ang(t2, 'rotateY'), rxOpen = ang(t2, 'rotateX'), rzOpen = ang(t2, 'rotateZ');
console.log(`    点击前 transform = ${t0}`);
console.log(`    点击 120ms     = ${t1}`);
console.log(`    开态 transform = ${t2}`);
console.log(`    → rotateY ${ryOpen}°  rotateX ${rxOpen}°  rotateZ ${rzOpen}°；openProgress=${s4.openP[idx4].toFixed(4)}`);
console.log(`    黑胶：${s4.vinyl.w}×${s4.vinyl.h}px  opacity=${s4.vinyl.opacity}  animation=${s4.vinyl.anim} ${s4.vinyl.dur}`);
console.log(`          滑出 ${s4.vinyl.slidePct}% = ${s4.vinyl.slidePx}px / 碟宽 ${s4.vinyl.boxW}px（参考 38%，本轮要求 ≥45%）`);
console.log(`    label：${s4.label.w}×${s4.label.h}px rect=${s4.label.rect} 正封 rect=${s4.label.artRect}`);
console.log(`          与正封 AABB 相交 ${s4.label.coverRatio}%；命中测试最上层=${s4.label.topEl}（label 在最上层=${s4.label.onTop}）`);
ok('4a', '点击 → 60ms 内盒体 transform 变化、开态 |rotateY| ≥ 12° 且 rotateX ≥ 4°',
  `前 ${t0}\n                            120ms ${t1}\n                            开态 ${t2}\n`
  + `                            rotateY ${ryOpen}° / rotateX ${rxOpen}° / rotateZ ${rzOpen}°`,
  t0 !== t1 && t0 !== t2 && Math.abs(ryOpen) >= 12 && Math.abs(rxOpen) >= 4 && Math.abs(rxOpen) <= 7
  && rzOpen < 0 && Math.abs(rzOpen) <= 2);
ok('4b', '黑胶滑出量 ≥ 45%（原 38%）',
  `translateX = ${s4.vinyl.slidePct}%（${s4.vinyl.slidePx}px / ${s4.vinyl.boxW}px 宽的碟）；animation=${s4.vinyl.anim}`,
  s4.vinyl.slidePct >= 45);
ok('4c', '黑胶中心 label 可见（宽 > 0 且没有被正封完全盖住）',
  `label ${s4.label.w}×${s4.label.h}px，与正封 AABB 仅相交 ${s4.label.coverRatio}%，`
  + `label 中心点上最上层是 ${s4.label.topEl}（onTop=${s4.label.onTop}）`,
  s4.label.w > 0 && s4.label.h > 0 && s4.label.onTop === true && s4.label.coverRatio < 100);
ok('4d', '特写是原地开合（不跳页），「查看专辑」入口还在',
  `body[data-view] ${view0} → ${s4.view}；location 不变=${s4.url === url0}；`
  + `CTA ${s4.cta ? `${s4.cta.w}×${s4.cta.h}px hidden=${s4.cta.hidden}「${s4.cta.text}」` : '缺失'}`,
  s4.view === 'myalbums' && s4.url === url0 && !!s4.cta && s4.cta.hidden === false);

/* 特写截图（1440 宽 × 1500 高视口，等封面落定后按舞台裁切） */
await viewport(W, WH);
await sleep(600);
await waitCovers();
await sleep(400);
await ev(`document.activeElement && document.activeElement.blur()`);
await shot('maform-8-closeup-3d.png', await clipToStage());
/* 收回：Esc */
await key('Escape', 'Escape', 27);
await sleep(1200);
const t4e = await ev(`document.querySelectorAll('#view-myalbums .ma-item')[${idx4}].style.transform`);
const p4e = await ev(`JSON.stringify(window.__LIZI_MYALBUMS.openP().map((v) => Math.round(v * 1e4) / 1e4))`);
console.log(`    Esc 后收回：openIndex=${await ev(`window.__LIZI_MYALBUMS.openIndex()`)}，openP=${p4e}`);
console.log(`    收回后 transform = ${t4e}`);
ok('4e', 'Esc 收回架上（transform 逐字复原）',
  `openIndex=${await ev(`window.__LIZI_MYALBUMS.openIndex()`)}；openP=${p4e}；`
  + `transform ${t4e === t0 ? '与点击前逐字相同' : `不同：收回后 "${t4e}" ≠ 点击前 "${t0}"`}`,
  t4e === t0);

/* ================================================================
 * 5. 指针微动（3D 视差）
 * ================================================================ */
console.log('\n[5] 指针微动');
const st5 = await rectOf('#view-myalbums .ma-stage');
const pt = (fx, fy) => {
  const x = Math.min(W - 20, Math.max(20, st5.left + st5.w * fx));
  const y = Math.min(H - 60, Math.max(90, st5.top + st5.h * fy));
  return [Math.round(x), Math.round(y)];
};
const [tlx, tly] = pt(0.02, 0.03);              /* 舞台左上角附近：nx≈-0.96、ny≈-0.94 */
const [brx, bry] = pt(0.98, 0.97);              /* 右下角附近 */
const readTilt = () => j(`(() => {
  const w = document.querySelector('#view-myalbums .ma-world');
  const cs = getComputedStyle(w);
  return JSON.stringify({ inline: w.style.transform || '', computed: cs.transform,
    tilt: window.__LIZI_MYALBUMS.tilt() });
})()`);
await moveTo(4, 4); await sleep(900);          /* 先归零 */
const tA = await readTilt();
await moveTo(tlx, tly);
/* 500ms 内必须变（每帧 8% 缓动，第一帧就会动） */
let tB = await readTilt();
for (let i = 0; i < 10 && tB.inline === tA.inline; i++) { await sleep(50); tB = await readTilt(); }
await sleep(700);                              /* 再等缓动追上目标 */
const tB2 = await readTilt();
const rx1 = ang(tB2.inline, 'rotateX'), ry1 = ang(tB2.inline, 'rotateY');
await moveTo(brx, bry);
await sleep(900);
const tC = await readTilt();
const rx2 = ang(tC.inline, 'rotateX'), ry2 = ang(tC.inline, 'rotateY');
/* 左上那一帧留一张截图（微动是缓动追上去的，等它追上再拍） */
await moveTo(tlx, tly); await sleep(900);
await ev(`document.activeElement && document.activeElement.blur()`);   /* 别把焦点环拍进图里 */
await sleep(120);
await shot('maform-9-tilt.png', await clipToStage());
await moveTo(4, 4);                            /* 离开舞台 */
await sleep(1000);
const tD = await readTilt();
console.log(`    归零       : inline="${tA.inline}"  computed=${tA.computed.slice(0, 40)}…  (${JSON.stringify(tA.tilt)})`);
console.log(`    左上 (${tlx},${tly}) : inline="${tB.inline}"（50ms 内就变了）→ 追上后 "${tB2.inline}"`);
console.log(`    右下 (${brx},${bry}) : inline="${tC.inline}"`);
console.log(`    指针离开   : inline="${tD.inline}"  tilt=${JSON.stringify(tD.tilt)}`);
ok('5a', 'pointermove → .ma-world 的 transform 500ms 内变化（左上 / 右下各一次）',
  `归零 "${tA.inline}" → 左上 "${tB.inline}" → 追上 "${tB2.inline}" → 右下 "${tC.inline}"`,
  tB.inline !== tA.inline && tC.inline !== tB2.inline && tB2.inline !== tA.inline);
ok('5b', '微动角度在 0.5°~6° 之间（rotateX = -ny*4，rotateY = nx*5）',
  `左上 rotateX ${rx1}° / rotateY ${ry1}°；右下 rotateX ${rx2}° / rotateY ${ry2}°`,
  [rx1, ry1, rx2, ry2].every((v) => Math.abs(v) >= 0.5 && Math.abs(v) <= 6) && rx1 * rx2 < 0 && ry1 * ry2 < 0);
ok('5c', 'pointerleave 后归零（±0.3°）',
  `inline="${tD.inline}"；tilt=${JSON.stringify(tD.tilt)}`,
  Math.abs(Number(tD.tilt.x)) <= 0.3 && Math.abs(Number(tD.tilt.y)) <= 0.3);

/* 拖拽期间暂停微动：按住拖 60px，world 的 transform 必须回到 0 */
await moveTo(tlx, tly); await sleep(700);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: st5.x, y: st5.y, button: 'none', buttons: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: st5.x, y: st5.y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(120);
for (let i = 1; i <= 5; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: st5.x + i * 14, y: st5.y, button: 'left', buttons: 1 });
  await sleep(30);
}
await sleep(1800);          /* 缓动每帧 8%，从 4.7° 收到 0 大约 1.4s */
const tDrag = await readTilt();
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: st5.x + 70, y: st5.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(500);
console.log(`    拖拽中     : inline="${tDrag.inline}"  tilt=${JSON.stringify(tDrag.tilt)}`);
ok('5d', '拖拽期间微动暂停（transform 归 0，不和拖拽打架）',
  `按住拖 70px 时 inline="${tDrag.inline}"，tilt.x=${Number(tDrag.tilt.x).toFixed(3)}° / tilt.y=${Number(tDrag.tilt.y).toFixed(3)}°（目标 tx/ty=${tDrag.tilt.tx}/${tDrag.tilt.ty}）`,
  tDrag.inline === '' && Math.abs(Number(tDrag.tilt.x)) <= 0.3 && Math.abs(Number(tDrag.tilt.y)) <= 0.3
  && Number(tDrag.tilt.tx) === 0 && Number(tDrag.tilt.ty) === 0);
await moveTo(4, 4); await sleep(600);

/* 特写态也生效（同一套微动，作用在包着所有卡的 .ma-world 上） */
const idx5 = await ev(`window.__LIZI_MYALBUMS.index()`);
await ev(`window.__LIZI_MYALBUMS.openUp(${idx5}); 'open'`);
await gate(`window.__LIZI_MYALBUMS.openP()[${idx5}] > 0.99`, 60, 100);
await sleep(300);
const cA = await readTilt();
await moveTo(tlx, tly); await sleep(900);
const cB = await readTilt();
const cx = ang(cB.inline, 'rotateX'), cy = ang(cB.inline, 'rotateY');
console.log(`    特写态：归零 "${cA.inline}" → 左上 "${cB.inline}"（rotateX ${cx}° / rotateY ${cy}°）`);
ok('5e', '特写态也吃这套微动，且不超过 ±6°',
  `开态 pointermove 后 "${cB.inline}"；openIndex=${await ev(`window.__LIZI_MYALBUMS.openIndex()`)}`,
  cB.inline !== cA.inline && Math.abs(cx) <= 6 && Math.abs(cy) <= 6 && Math.abs(cx) >= 0.5 && Math.abs(cy) >= 0.5);
await key('Escape', 'Escape', 27);
await sleep(1000);
await moveTo(4, 4); await sleep(700);

/* ================================================================
 * 6. prefers-reduced-motion: reduce → 微动不生效
 * ================================================================ */
console.log('\n[6] reduce');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.reload');
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0 && !!window.__LIZI_MYALBUMS`, 120, 400);
await openShelf();
await gate(`document.querySelectorAll('#view-myalbums .ma-item').length === 6`, 80, 200);
await waitCovers();
await sleep(600);
const rMedia = await ev(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
const st6 = await rectOf('#view-myalbums .ma-stage');
const rA = await readTilt();
await moveTo(Math.round(st6.left + st6.w * 0.12), Math.round(Math.min(H - 80, st6.top + st6.h * 0.25)));
await sleep(900);
const rB = await readTilt();
await moveTo(Math.round(st6.left + st6.w * 0.9), Math.round(Math.min(H - 80, st6.top + st6.h * 0.7)));
await sleep(900);
const rC = await readTilt();
console.log(`    matchMedia(reduce)=${rMedia}；before="${rA.inline}" → 左上 "${rB.inline}" → 右下 "${rC.inline}"；tilt=${JSON.stringify(rB.tilt)}`);
ok('6', 'reduce 下微动不生效（transform 不随 pointermove 变）',
  `matchMedia=${rMedia}；三次读数 "${rA.inline}" / "${rB.inline}" / "${rC.inline}"；reduce 标记=${rB.tilt.reduce}`,
  rMedia === true && rA.inline === '' && rB.inline === '' && rC.inline === '' && rB.tilt.reduce === true);

/* 恢复媒体 + 刷新 */
await send('Emulation.setEmulatedMedia', { features: [] });
await send('Page.reload');
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0 && !!window.__LIZI_MYALBUMS`, 120, 400);
await openShelf();
await gate(`document.querySelectorAll('#view-myalbums .ma-item').length === 6`, 80, 200);
await waitCovers();
await sleep(800);
console.log(`    媒体已恢复：matchMedia(reduce)=${await ev(`matchMedia('(prefers-reduced-motion: reduce)').matches`)}`);

/* ================================================================
 * 7. 回归：拖拽 / ←→ / 抽屉 / 计数 / 空状态 / 形态切换
 * ================================================================ */
console.log('\n[7] 回归');
const r7 = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  return JSON.stringify({ idx: window.__LIZI_MYALBUMS.index(), pos: window.__LIZI_MYALBUMS.pos(),
    form: v.querySelector('[data-ma]').dataset.form, count: (v.querySelector('[data-count]') || {}).textContent,
    rows: v.querySelectorAll('.ma-row').length });
})()`);
const stg7 = await rectOf('#view-myalbums .ma-stage');
await moveTo(stg7.x, stg7.y);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: stg7.x, y: stg7.y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 6; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: stg7.x + i * 22, y: stg7.y, button: 'left', buttons: 1 });
  await sleep(16);
}
const dragMid = await ev(`window.__LIZI_MYALBUMS.pos()`);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: stg7.x + 132, y: stg7.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(800);
const dragEnd = await j(`JSON.stringify({ pos: window.__LIZI_MYALBUMS.pos(), idx: window.__LIZI_MYALBUMS.index(), open: window.__LIZI_MYALBUMS.openIndex() })`);
await ev(`document.activeElement && document.activeElement.blur()`);
await key('ArrowLeft', 'ArrowLeft', 37);
await sleep(400);
const idxArrow = await ev(`window.__LIZI_MYALBUMS.index()`);
const selDom = await ev(`[...document.querySelectorAll('#view-myalbums .ma-item')].findIndex(e => e.classList.contains('is-sel'))`);
await clickSel('#view-myalbums [data-drawerbtn]');
await sleep(350);
const drawer1 = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  return JSON.stringify({ open: v.querySelector('.ma-drawer').classList.contains('is-open'),
    aria: v.querySelector('[data-drawerbtn]').getAttribute('aria-expanded'),
    rows: v.querySelectorAll('.ma-row').length,
    bar: v.querySelector('[data-drawer-count]').textContent });
})()`);
await clickSel('#view-myalbums [data-drawerbtn]');
await sleep(350);
const drawer2 = await ev(`document.querySelector('#view-myalbums .ma-drawer').classList.contains('is-open')`);
console.log(`    拖拽：pos ${r7.pos.toFixed(2)} → 按住 ${dragMid.toFixed(2)} → 松手 ${dragEnd.pos.toFixed(2)}；← 键 index ${dragEnd.idx} → ${idxArrow}（DOM is-sel=${selDom}）`);
console.log(`    抽屉：关 ${drawer1.open} → 开 rows=${drawer1.rows} aria=${drawer1.aria} ${drawer1.bar} → 再点 ${drawer2}`);
ok('7a', '拖拽 / 惯性 / ←→ 选中（原有行为不回退）',
  `pos ${r7.pos.toFixed(2)} → ${dragMid.toFixed(2)} → ${dragEnd.pos.toFixed(2)}；index ${dragEnd.idx} → ${idxArrow}；is-sel=${selDom}`,
  Number(dragMid) < Number(r7.pos) - 0.3 && Math.abs(Number(dragEnd.pos) - Number(dragMid)) < 3.2
  && idxArrow === Math.max(0, dragEnd.idx - 1) && selDom === idxArrow);
ok('7b', '抽屉 / 计数（原有行为不回退）',
  `抽屉 is-open ${drawer1.open} → ${drawer2}；aria-expanded=${drawer1.aria}；${drawer1.rows} 行；计数「${r7.count} 张」`,
  drawer1.open === true && drawer2 === false && drawer1.aria === 'true' && drawer1.rows === 6 && r7.count === '6');

/* flow 形态：--ma-size 仍是 300、点击直接进专辑页 */
await ev(`document.dispatchEvent(new CustomEvent('lizi:ma-form', { detail: { form: 'flow' } })); 'ok'`);
await sleep(600);
const gF = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const cs = getComputedStyle(v);
  const st = v.querySelector('.ma-stage').getBoundingClientRect();
  return JSON.stringify({ form: v.querySelector('[data-ma]').dataset.form,
    size: cs.getPropertyValue('--ma-size').trim(),
    stage: [Math.round(st.width), Math.round(st.height)],
    idx: window.__LIZI_MYALBUMS.index(), open: window.__LIZI_MYALBUMS.openIndex(),
    tilt: window.__LIZI_MYALBUMS.tilt() });
})()`);
const flowName = await ev(`window.__LIZI_MYALBUMS.list()[${gF.idx}].name`);
const stgF = await rectOf('#view-myalbums .ma-stage');
await moveTo(Math.round(stgF.left + stgF.w * 0.2), Math.round(Math.min(H - 80, stgF.top + stgF.h * 0.4)));
await sleep(600);
const flowTilt = await readTilt();
const t6 = await ev(`Math.round(performance.now())`);
await clickAt(stgF.x, stgF.y);
const flowEntered = await gate(`document.body.dataset.view === 'album'
  && window.__lastShow.view === 'album' && window.__lastShow.t > ${t6}
  && (document.querySelector('#view-album .pg-album-name') || {}).textContent === ${JSON.stringify(flowName)}`, 90, 200);
const flowGot = await ev(`(document.querySelector('#view-album .pg-album-name') || {}).textContent || ''`);
console.log(`    flow：data-form=${gF.form}，--ma-size=${gF.size}，舞台 ${gF.stage[0]}×${gF.stage[1]}px，微动 inline="${flowTilt.inline}"（flow 下不启用）`);
console.log(`    点击 → view=${await ev(`document.body.dataset.view`)}，标题「${flowGot}」=「${flowName}」，openIndex=${await ev(`window.__LIZI_MYALBUMS.openIndex()`)}`);
ok('7c', '形态切换：flow 仍是 300px、点击直接进专辑页、不启用微动',
  `data-form=${gF.form}；--ma-size=${gF.size}；舞台 ${gF.stage[0]}×${gF.stage[1]}px；`
  + `微动 inline="${flowTilt.inline}"；点击进入=${flowEntered}，标题「${flowGot}」`,
  gF.form === 'flow' && pxOf(gF.size) === 300 && gF.stage[1] > 300 && flowEntered
  && flowGot === flowName && gF.open === -1 && flowTilt.inline === '');
const back7 = await backToShelf();
console.log(`    返回架子：${back7}`);
await sleep(500);
await ev(`window.__LIZI_MYALBUMS.setForm('spine'); 'ok'`);
await sleep(700);
const gSpineBack = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  return JSON.stringify({ form: v.querySelector('[data-ma]').dataset.form,
    size: getComputedStyle(v).getPropertyValue('--ma-size').trim(),
    ls: localStorage.getItem('lizi.myAlbums.form') });
})()`);
ok('7d', '切回 spine：data-form / --ma-size / localStorage 都对',
  `data-form=${gSpineBack.form}，--ma-size=${gSpineBack.size}，localStorage=${gSpineBack.ls}`,
  gSpineBack.form === 'spine' && pxOf(gSpineBack.size) === 864 && gSpineBack.ls === 'spine');

/* 空状态 */
await ev(`window.__LIZI_MYALBUMS.collection.clear(); 'cleared'`);
await sleep(700);
const empty = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const e = v.querySelector('.ma-empty');
  return JSON.stringify({ items: v.querySelectorAll('.ma-item').length,
    count: (v.querySelector('[data-count]') || {}).textContent,
    visible: !!(e && !e.hidden && e.offsetHeight > 0),
    stage: getComputedStyle(v.querySelector('.ma-stage')).display });
})()`);
console.log(`    空状态：items=${empty.items}，计数=${empty.count}，提示可见=${empty.visible}，舞台 ${empty.stage}`);
ok('7e', '空状态不回退（没有空架子 / 计数归零 / 空状态可见）',
  `.ma-item=${empty.items}，计数=${empty.count}，空状态可见=${empty.visible}，舞台 display=${empty.stage}`,
  empty.items === 0 && empty.count === '0' && empty.visible === true && empty.stage === 'none');

/* 恢复：6 张真专辑 + spine + ambient，刷新 */
await ev(`localStorage.setItem('lizi.myAlbums.v1', ${JSON.stringify(JSON.stringify(ALBUMS))});
  localStorage.setItem('lizi.myAlbums.form','spine'); localStorage.removeItem('lizi.myAlbums.bg'); 'restored'`);
await send('Page.reload');
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0 && !!window.__LIZI_MYALBUMS`, 120, 400);
await openShelf();
await gate(`document.querySelectorAll('#view-myalbums .ma-item').length === 6`, 80, 200);
await waitCovers();
await sleep(900);

/* ================================================================
 * 8. 控制台
 * ================================================================ */
console.log('\n[8] 控制台');
console.log('    console.error:', consoleErrs.length, consoleErrs.slice(0, 6));
console.log('    uncaught    :', exceptions.length, exceptions.slice(0, 6));
ok('8', '0 console error / 0 未捕获异常',
  `console.error=${consoleErrs.length}，exceptionThrown=${exceptions.length}`,
  consoleErrs.length === 0 && exceptions.length === 0);

/* ================================================================
 * 9. 截图：大架子（2 倍尺寸 + 多色立脊 + 无提示语）
 * ================================================================ */
console.log('\n[9] 截图');
await viewport(W, WH);
await sleep(700);
await ev(`document.getElementById('view-myalbums').scrollTop = 0; 'top'`);
await moveTo(4, 4);
await sleep(900);
await waitCovers();
await sleep(500);
const gBig = await geo();
await ev(RGB_HELPER);                  /* 刷过几次页面，helpers 要重注入 */
const colors = JSON.parse(await ev(`JSON.stringify(${JSON.stringify(gBig.all)}.map((x) => ({
  key: x.key, rgb: window.__rgb(x.bg), fg: window.__rgb(x.fg), src: x.src, amb: x.amb, hue: x.hue,
})))`));
const colRows = colors.map((c, i) => ({ ...c, o: oklchOf(c.rgb), name: gBig.all[i].key, i: gBig.all[i].i }));
console.log('    序号  专辑 key               脊色(computed→hex)  OKLCH                     文字对比度  来源');
for (const r of colRows) {
  console.log(`    ${String(r.i).padEnd(4)}  ${r.key.slice(0, 22).padEnd(22)}  ${hexOf(r.rgb)}  ${fmtOklch(r.o).padEnd(26)}  ${contrast(r.rgb, r.fg).toFixed(1)}:1   ${r.src}`);
}
const uniqHue = new Set(colRows.map((r) => Math.round(r.o.h / 10) * 10));
await ev(`document.activeElement && document.activeElement.blur()`);
await shot('maform-7-big.png', await clipToStage());
ok('9a', '截图 maform-7-big.png：封面 864px、多色立脊、没有提示语',
  `${gBig.all.length} 张立脊去重色相组 ${uniqHue.size} 组：${[...uniqHue].sort((a, b) => a - b).join(' / ')}°；`
  + `--ma-size=${gBig.sizeVar}；[data-hint]=${gBig.hint}`,
  uniqHue.size >= 3 && pxOf(gBig.sizeVar) === 864 && gBig.hint === false
  && fs.statSync(path.join(OUT, 'maform-7-big.png')).size > 60000);
const files = ['maform-7-big.png', 'maform-8-closeup-3d.png', 'maform-9-tilt.png'];
ok('9b', '三张截图都在（大架子 / 特写 3D / 左上微动帧）',
  files.map((f) => `${f} ${Math.round(fs.statSync(path.join(OUT, f)).size / 1024)}KB`).join(' · '),
  files.every((f) => fs.existsSync(path.join(OUT, f)) && fs.statSync(path.join(OUT, f)).size > 50000));

/* ================================================================
 * 10. 兜底：无封面 → 预置色板（10 组，按 id 哈希）
 * ================================================================ */
console.log('\n[10] 无封面 → 预置色板兜底');
await ev(`window.__LIZI_MYALBUMS.collection.add({ id: 'netease:999000111', name: '无封面兜底测试',
  artists: '—', cover: '', source: 'netease', addedAt: Date.now() }); 'added'`);
await sleep(900);
await ev(RGB_HELPER);
const fb = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const it = [...v.querySelectorAll('.ma-item')].find((x) => x.dataset.key === 'netease:999000111');
  if (!it) return JSON.stringify({ found: false });
  const sp = it.querySelector('.ma-item__spine');
  const cs = getComputedStyle(sp);
  return JSON.stringify({ found: true, bg: cs.backgroundColor, fg: cs.color,
    bgRgb: window.__rgb(cs.backgroundColor), fgRgb: window.__rgb(cs.color),
    src: it.dataset.spSrc || '', ph: !!it.querySelector('.ma-item__ph') });
})()`);
const fbO = oklchOf(fb.bgRgb);
console.log(`    无封面那张：脊色 ${hexOf(fb.bgRgb)} ${fmtOklch(fbO)}，来源=${fb.src}，占位字=${fb.ph}，文字对比度 ${contrast(fb.bgRgb, fb.fgRgb).toFixed(1)}:1`);
ok('10', '无封面 / 取色失败 → 预置色板兜底（有彩度、不是纯黑/纯白）',
  `脊色 ${hexOf(fb.bgRgb)} ${fmtOklch(fbO)}，src=${fb.src}，对比度 ${contrast(fb.bgRgb, fb.fgRgb).toFixed(1)}:1`,
  fb.found === true && fb.src === 'palette' && fbO.C > 0.006 && fbO.L >= 0.15 && fbO.L <= 0.92);
await ev(`window.__LIZI_MYALBUMS.collection.remove('netease:999000111'); 'removed'`);
await sleep(400);

/* ================================================================
 * 11. 提示语删掉之后，"音源打不开"这种一次性消息去哪了（气泡，不占布局）
 * ================================================================ */
console.log('\n[11] 一次性提示气泡（替代被删掉的常驻提示行）');
await ev(`window.__LIZI_MYALBUMS.collection.add({ id: 'qq:990003', name: 'QQ 音源测试',
  artists: '—', cover: '', source: 'qq', addedAt: Date.now() }); 'added'`);
await sleep(900);
const qqIdx = await ev(`window.__LIZI_MYALBUMS.keys().indexOf('qq:990003')`);
const heightBefore = await ev(`document.querySelector('#view-myalbums .ma-stage').getBoundingClientRect().height`);
await ev(`window.__LIZI_MYALBUMS.openUp(${qqIdx}); 'open'`);
await gate(`window.__LIZI_MYALBUMS.openP()[${qqIdx}] > 0.9`, 60, 100);
await sleep(400);
await clickSel('#view-myalbums [data-cta]');
await sleep(500);
const noteState = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const n = v.querySelector('[data-note]');
  return JSON.stringify({ hidden: n ? n.hidden : null, text: n ? n.textContent : '',
    pos: n ? getComputedStyle(n).position : '', view: document.body.dataset.view,
    stageH: Math.round(v.querySelector('.ma-stage').getBoundingClientRect().height),
    hint: !!v.querySelector('[data-hint]') });
})()`);
console.log(`    点「查看专辑」（qq 音源）→ view=${noteState.view}，气泡 hidden=${noteState.hidden} position=${noteState.pos}`);
console.log(`    气泡文字：「${noteState.text}」；舞台高 ${heightBefore} → ${noteState.stageH}px（不占布局）`);
ok('11', '不支持的音源 → 弹一次性气泡（不跳页、不加高、不留常驻提示）',
  `view=${noteState.view}；气泡「${noteState.text}」hidden=${noteState.hidden}；舞台高 ${Math.round(heightBefore)} → ${noteState.stageH}px；[data-hint]=${noteState.hint}`,
  noteState.view === 'myalbums' && noteState.hidden === false && /QQ 音源测试/.test(noteState.text)
  && noteState.pos === 'absolute' && Math.abs(noteState.stageH - Math.round(heightBefore)) <= 1
  && noteState.hint === false);
await ev(`window.__LIZI_MYALBUMS.closeUp(); window.__LIZI_MYALBUMS.collection.remove('qq:990003'); 'clean'`);
await sleep(500);

console.log(`\n===== ${R.pass} PASS / ${R.fail} FAIL =====`);
for (const r of R.rows) if (!r.pass) console.log(`  ✗ [${r.n}] ${r.name}`);
ws.close();
ch.kill();
await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exit(R.fail ? 1 : 0);
