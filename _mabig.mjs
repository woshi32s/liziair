/**
 * _mabig.mjs —— 「我的专辑」第三轮验收（四点改进）
 *
 *   ① 尺寸：视口自适应（vw + vh 都参与），1440×900 / 1920×1080 / 1280×800 三档
 *      封面边长 / 窗口短边 ≥ 0.72 且 ≤ 0.92；resize 后 120ms 内更新；无横向溢出
 *   ② 高清：正封 / 封底按显示尺寸 2 倍取图（640~2000），naturalWidth ≥ 显示宽 × 1.6；
 *      1920 档也够（同一张图升级到 1700）；立脊小标 / 抽屉仍是小图
 *   ③ 立脊小标：每张卡 .ma-item__spine 里有 <img>（无封面时是占位），20~28px，naturalWidth > 40
 *   ④ 背景：--ambient-color alpha ≥ 0.30（0.38）、落地光、暗角；换专辑色相变化且补间 300~500ms
 *   回归：拖拽 / ←→ / 抽屉 / 计数 / 空状态 / 形态切换 / 特写开合与黑胶 / 0 console error
 *
 * 截图：shots/review/mabig-1-1440.png、mabig-2-1920.png、mabig-3-1280.png、mabig-4-spine-badge.png
 *
 * 无头 Chrome + CDP，端口读 .port。不碰 Electron 窗口。
 *   node _mabig.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(HERE, 'shots', 'review');
fs.mkdirSync(OUT, { recursive: true });

const R = { pass: 0, fail: 0, rows: [] };
const ok = (n, name, detail, pass) => {
  R.rows.push({ n, name, detail, pass });
  if (pass) R.pass++; else R.fail++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  [${n}] ${name} —— ${detail}`);
};

/* ---------- 无头 Chrome ---------- */
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-mabig-' + Date.now());
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
const consoleErrs = []; const exceptions = [];
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
  try { return JSON.parse(s); } catch { return { exc: 'BADJSON:' + s.slice(0, 160) }; }
};
const gate = async (cond, tries = 60, ms = 250) => {
  for (let i = 0; i < tries; i++) { if (await ev(cond)) return true; await sleep(ms); }
  return false;
};
const shot = async (name, clip, scale = 1) => {
  const png = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale } } : {}) });
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
  return JSON.stringify({ ok: true, x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height,
    left: b.left, top: b.top, right: b.right, bottom: b.bottom });
})()`);
const clickSel = async (sel) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' }); return 1; })()`);
  await sleep(160);
  const r = await rectOf(sel);
  if (!r.ok) return false;
  await clickAt(r.x, r.y);
  return true;
};

const waitCovers = async (ms = 25000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const done = await ev(`(() => {
      const imgs = [...document.querySelectorAll('#view-myalbums .ma-item img')];
      return imgs.length > 0 && imgs.every((m) => !m || (m.complete && m.naturalWidth > 0));
    })()`);
    if (done === true) return true;
    await sleep(200);
  }
  return false;
};
const openShelf = async () => {
  const viaHall = await ev(`(() => {
    const b = [...document.querySelectorAll('#hall-tools .hrow, #hall-tools button')]
      .find((x) => /我的专辑/.test(x.textContent || ''));
    if (!b) return 0;
    b.click(); return 1;
  })()`);
  if (!viaHall) await ev(`document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view: 'myalbums' } }))`);
  return gate(`document.body.dataset.view === 'myalbums' && document.querySelectorAll('#view-myalbums .ma-item').length > 0`, 120, 200);
};
/** 把架子滚到舞台顶部 y=top，让整张封面落在视口里（封面比页头高，截整架时页头滚出视口） */
const scrollShelf = async (top = 78) => {
  const v = await ev(`(() => {
    const v = document.getElementById('view-myalbums');
    const st = v.querySelector('.ma-stage').getBoundingClientRect();
    v.scrollTop = Math.max(0, v.scrollTop + Math.round(st.top - ${top}));
    return Math.round(v.scrollTop);
  })()`);
  await sleep(300);
  return v;
};

/* 一屏几何 + 图 + 背景（一次拿全） */
const geo = () => j(`(() => {
  const v = document.getElementById('view-myalbums');
  const st = v.querySelector('.ma-stage');
  const cs = getComputedStyle(v);
  const sr = st.getBoundingClientRect();
  const px = (s) => Number(String(s).replace('px', '')) || 0;
  const items = [...v.querySelectorAll('.ma-item')];
  const one = (it, i) => {
    const art = it.querySelector('.ma-item__art img');
    const sp = it.querySelector('.ma-item__spine');
    const bd = it.querySelector('.ma-item__sbadge');
    const bimg = bd && bd.querySelector('img');
    return {
      i, key: it.dataset.key, sel: it.classList.contains('is-sel'),
      card: it.offsetWidth,
      art: art ? {
        dispW: art.clientWidth, naturalW: art.naturalWidth, naturalH: art.naturalHeight,
        complete: art.complete, ratio: art.clientWidth ? Math.round((art.naturalWidth / art.clientWidth) * 100) / 100 : 0,
        src: (art.getAttribute('src') || '').slice(0, 90),
        rendering: getComputedStyle(art).imageRendering,
      } : null,
      spineW: sp ? Math.round(sp.getBoundingClientRect().width) : 0,
      badge: bd ? {
        w: bd.offsetWidth, h: bd.offsetHeight,
        rectW: Math.round(bd.getBoundingClientRect().width),
        img: !!bimg, naturalW: bimg ? bimg.naturalWidth : 0,
        ph: !!bd.querySelector('.ma-item__sbadge-ph'),
        src: bimg ? (bimg.getAttribute('src') || '').slice(0, 80) : '',
        ratio: bimg && bd.offsetWidth ? Math.round((bimg.naturalWidth / bd.offsetWidth) * 100) / 100 : 0,
      } : null,
    };
  };
  return JSON.stringify({
    iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio,
    sizeVar: cs.getPropertyValue('--ma-size').trim(), sizePx: px(cs.getPropertyValue('--ma-size')),
    apiSize: window.__LIZI_MYALBUMS.size(),
    imgReq: window.__LIZI_MYALBUMS.imgReq(), imgReqUsed: window.__LIZI_MYALBUMS.imgReqUsed(),
    stage: [Math.round(sr.width), Math.round(sr.height), st.scrollWidth, st.clientWidth],
    view: [v.scrollWidth, v.clientWidth, v.scrollHeight, v.clientHeight, Math.round(v.scrollTop)],
    doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    ambient: cs.getPropertyValue('--ambient-color').trim(),
    ambientSoft: cs.getPropertyValue('--ambient-soft').trim(),
    ambHue: window.__LIZI_MYALBUMS.ambHue(),
    bgImage: getComputedStyle(v).backgroundImage,
    bg: v.dataset.bg || '',
    count: (v.querySelector('[data-count]') || {}).textContent,
    form: (v.querySelector('[data-ma]') || { dataset: {} }).dataset.form,
    items: items.map(one),
  });
})()`);

/** 解析 oklch(... / a)，返回 { l, c, h, a }（l 统一成 0-1） */
const parseOklch = (s) => {
  const m = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/i.exec(String(s || ''));
  if (!m) return null;
  return {
    l: m[2] === '%' ? Number(m[1]) / 100 : Number(m[1]),
    c: Number(m[3]), h: Number(m[4]), a: m[5] === undefined ? 1 : Number(m[5]),
  };
};
const dh = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/* 极简 PNG 解码（Chrome 截图 = 8bit RGBA 非隔行）+ 区域平均：
   用来证明"背景色晕真的画到了留白里"，而不是只在 CSS 里写了变量。 */
function decodePng(buf) {
  let pos = 8; let w = 0, h = 0, bit = 0, color = 0, inter = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bit = data[8]; color = data[9]; inter = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bit !== 8 || inter !== 0 || (color !== 6 && color !== 2)) throw new Error(`unsupported png ${bit}/${color}/${inter}`);
  const bpp = color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return { w, h, bpp, data: out };
}
function regionMean(img, x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x++) {
      const o = (y * img.w + x) * img.bpp;
      r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), n };
}

await send('Page.enable');
await send('Runtime.enable');
await viewport(1440, 900);
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });

console.log(`\nLIZI 我的专辑 第三轮验收（视口尺寸 / 高清图 / 立脊小标 / 背景）  ·  http://127.0.0.1:${APP}/  ·  无头 Chrome`);

/* ================================================================
 * 0. 准备：6 张真专辑，spine + ambient，刷新
 * ================================================================ */
console.log('\n[0] 准备');
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 100, 400))) {
  console.log('!! 大厅没起来，先看服务'); process.exit(2);
}
/* 测试用 6 张：从周杰伦专辑里挑封面源图 ≥1500px 的（800/1000 的老封面
   无论怎么取图都不可能满足 naturalWidth ≥ 显示宽×1.6，那是源图限制，不是取图逻辑） */
const PICK = ['netease:403900711', 'netease:274336916', 'netease:259316984',
  'netease:181638865', 'netease:90743831', 'netease:84129171'];
const ALBUMS = JSON.parse(await ev(`fetch('/api/artist/albums/6452?limit=12&offset=0')
  .then(r => r.json())
  .then(d => JSON.stringify((d.albums || []).map((a, i) => ({
    id: 'netease:' + a.id, name: a.name, artists: '周杰伦', cover: a.cover,
    publishTime: a.publishTime, trackCount: a.size, source: 'netease', addedAt: Date.now() - i * 1000,
  })).filter((a) => ${JSON.stringify(PICK)}.includes(a.id)).slice(0, 6)))`));
if (!Array.isArray(ALBUMS) || ALBUMS.length < 6) { console.log('!! 拿不到专辑列表', ALBUMS); process.exit(2); }
await ev(`localStorage.setItem('lizi.myAlbums.v1', ${JSON.stringify(JSON.stringify(ALBUMS))});
  localStorage.setItem('lizi.myAlbums.form', 'spine'); localStorage.removeItem('lizi.myAlbums.bg'); 'seeded'`);
await send('Page.reload');
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0 && !!window.__LIZI_MYALBUMS`, 120, 400))) {
  console.log('!! 刷新后没回来'); process.exit(2);
}
await openShelf();
await gate(`document.querySelectorAll('#view-myalbums .ma-item').length === 6`, 80, 200);
await waitCovers();
await sleep(1200);                      /* 等封面取色 + 惯性收敛 */
const g0 = await geo();
console.log(`    6 张：${g0.items.map((x) => x.key).join(' | ')}`);
console.log(`    ${g0.iw}×${g0.ih}  --ma-size=${g0.sizeVar}  取图请求=${g0.imgReq}px`);

/* ================================================================
 * 1. 三档视口：封面边长 / 窗口短边、无横向溢出、截图
 * ================================================================ */
console.log('\n[1] 视口自适应（三档）');
const SHOTS = [[1440, 900, 'mabig-1-1440.png'], [1920, 1080, 'mabig-2-1920.png'], [1280, 800, 'mabig-3-1280.png']];
const gView = [];
let bgPng = null;
for (const [w, h, name] of SHOTS) {
  await viewport(w, h);
  await sleep(400);
  await waitCovers();
  await sleep(450);
  const g = await geo();
  gView.push({ ...g, w, h });
  const short = Math.min(g.iw, g.ih);
  const ratio = Math.round((g.sizePx / short) * 1000) / 1000;
  const overX = g.view[0] - g.view[1];
  const docOver = g.doc[0] - g.doc[1];
  console.log(`\n    ${w}×${h}：--ma-size=${g.sizePx}px（API ${g.apiSize}）  短边 ${short}px → 占比 ${ratio}`
    + `  舞台 ${g.stage[0]}×${g.stage[1]}px  卡 ${g.items[0].card}px  立脊 ${g.items[0].spineW}px`);
  console.log(`      视图 scrollWidth/clientWidth = ${g.view[0]}/${g.view[1]}（溢出 ${overX}px）；文档 ${g.doc[0]}/${g.doc[1]}（溢出 ${docOver}px）`);
  console.log(`      取图：请求 ${g.imgReq}px，已下发 ${g.imgReqUsed}px；各卡 naturalWidth=`
    + `${g.items.map((x) => (x.art ? x.art.naturalW : 0)).join('/')}px；显示宽 ${g.items[0].art ? g.items[0].art.dispW : 0}px`);
  ok(`1-${w}`, `${w}×${h}：封面边长 / 短边 ∈ [0.72, 0.92]`,
    `--ma-size=${g.sizePx}px / 短边 ${short}px = ${ratio}；卡 ${g.items[0].card}px；舞台高 ${g.stage[1]}px`,
    g.sizePx === g.apiSize && ratio >= 0.72 && ratio <= 0.92);
  ok(`1b-${w}`, `${w}×${h}：无横向溢出（scrollWidth == clientWidth）`,
    `视图 ${g.view[0]} == ${g.view[1]}（差 ${overX}）；文档 ${g.doc[0]} == ${g.doc[1]}（差 ${docOver}）；舞台 overflow=clip`,
    overX <= 0 && docOver <= 0);
  /* 截图：把舞台顶滚到 78px，整张封面进画面 */
  await scrollShelf(78);
  await ev(`document.activeElement && document.activeElement.blur()`);
  await moveTo(4, 4);
  await sleep(700);
  await waitCovers();
  await shot(name);
  if (w === 1440) bgPng = fs.readFileSync(path.join(OUT, name));
  console.log(`      截图 ${name}：视口 ${w}×${h}，舞台顶 y≈78，封面 ${g.sizePx}px`);
  await ev(`window.__LIZI_MYALBUMS.closeUp && window.__LIZI_MYALBUMS.closeUp(); 'x'`);
}

/* ================================================================
 * 2. resize 响应 + 宽/高都参与 + 无溢出
 * ================================================================ */
console.log('\n[2] resize 响应');
await viewport(1440, 900); await sleep(500);
const before = await geo();
/* 在页面里记录 resize 事件时刻 + --ma-size 变化的时刻（都不含 CDP 往返） */
await ev(`(() => {
  const v = document.getElementById('view-myalbums');
  window.__rz = { t0: 0, t1: 0, before: getComputedStyle(v).getPropertyValue('--ma-size').trim(), after: '' };
  window.addEventListener('resize', () => { if (!window.__rz.t0) window.__rz.t0 = performance.now(); });
  const loop = () => {
    const s = getComputedStyle(v).getPropertyValue('--ma-size').trim();
    if (s !== window.__rz.before) { window.__rz.t1 = performance.now(); window.__rz.after = s; return; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return 'armed';
})()`);
await viewport(1600, 1000);
await sleep(420);
const rz = await j(`JSON.stringify(window.__rz)`);
const after = await geo();
const rt = Math.round(rz.t1 - rz.t0);
console.log(`    1440×900 → 1600×1000：--ma-size ${before.sizeVar} → ${after.sizeVar}；resize 事件 → 尺寸更新 ${rt}ms`);
ok('2a', 'resize 后 120ms 内 --ma-size 更新',
  `resize 事件到尺寸变化 ${rt}ms（防抖 80ms）；${before.sizeVar} → ${after.sizeVar}`,
  rz.before === before.sizeVar && rz.after === after.sizeVar && rt > 0 && rt <= 120);

/* 高参与：同一宽度、窗口变高 */
await viewport(1440, 900); await sleep(450);
const h900 = (await geo()).sizePx;
await viewport(1440, 1200); await sleep(450);
const h1200 = (await geo()).sizePx;
/* 宽参与：同一高度、窗口变窄 */
await viewport(900, 900); await sleep(450);
const w900 = (await geo()).sizePx;
await viewport(1440, 900); await sleep(500);
console.log(`    1440×900 → ${h900}px；1440×1200 → ${h1200}px（变高变大）；900×900 → ${w900}px（变窄变小）`);
ok('2b', '视口宽 + 高都参与计算（不是只按宽的三档断点）',
  `1440×900 ${h900}px；1440×1200 ${h1200}px；900×900 ${w900}px；公式 clamp(360, min(vw*0.62, vh*0.78), 1400)`,
  h1200 > h900 && w900 < h900 && h1200 === Math.round(Math.min(1440 * 0.62, 1200 * 0.78))
  && w900 === Math.round(Math.min(900 * 0.62, 900 * 0.78)));

/* ================================================================
 * 3. 高清：naturalWidth ≥ 显示宽 × 1.6（1440 + 1920 各量一次）
 * ================================================================ */
console.log('\n[3] 封面清晰度');
const hi = [];
for (const [w, h] of [[1440, 900], [1920, 1080]]) {
  await viewport(w, h); await sleep(500);
  await waitCovers();
  await sleep(500);
  const g = await geo();
  for (const it of g.items) {
    if (!it.art) continue;
    hi.push({ w, key: it.key, dispW: it.art.dispW, naturalW: it.art.naturalW, ratio: it.art.ratio,
      src: it.art.src, rendering: it.art.rendering, req: g.imgReq });
  }
  const mid = g.items[Math.floor(g.items.length / 2)];
  console.log(`    ${w}×${h}：请求 ${g.imgReq}px；中卡「${mid.key}」显示 ${mid.art.dispW}px / 原图 ${mid.art.naturalW}×${mid.art.naturalH}px = ${mid.art.ratio}×`
    + `  image-rendering=${mid.art.rendering}`);
}
const minRatio = Math.min(...hi.map((x) => x.ratio));
const poor = hi.filter((x) => x.ratio < 1.6);
const srcSample = hi[0] ? hi[0].src : '';
ok('3a', '封面 naturalWidth ≥ 显示宽 × 1.6（1440 / 1920 每张）',
  `${hi.length} 条读数中最小 ${minRatio}×；不足 1.6 的 ${poor.length} 张`
  + `${poor.length ? '：' + poor.map((x) => `${x.key}@${x.w} ${x.ratio}×`).join('，') : ''}`,
  hi.length >= 12 && poor.length === 0);
const at1920 = hi.filter((x) => x.w === 1920);
const n1920 = at1920.length ? Math.min(...at1920.map((x) => x.naturalW)) : 0;
ok('3b', '1920×1080 下同一张图也够（请求升级到 1700，naturalWidth ≥ 1347）',
  `1920 档最小 naturalWidth=${n1920}px ≥ 显示 ${at1920[0] ? at1920[0].dispW : 0}×1.6=${at1920[0] ? Math.round(at1920[0].dispW * 1.6) : 0}px；`
  + `src 形如 ${srcSample}`,
  n1920 > 0 && at1920.every((x) => x.naturalW >= x.dispW * 1.6) && n1920 >= 1347);
const sizings = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const d = v.querySelector('.ma-row__pic img');
  const b = [...v.querySelectorAll('.ma-item__sbadge img')][0];
  return JSON.stringify({
    drawer: d ? { nat: d.naturalWidth, src: (d.getAttribute('src') || '') } : null,
    badge: b ? { nat: b.naturalWidth, src: (b.getAttribute('src') || '') } : null,
  });
})()`);
const paramOf = (s) => {
  const m = /param=(\d+)y\d+/.exec(decodeURIComponent(String(s || '')));
  return m ? Number(m[1]) : 0;
};
const drawerParam = sizings.drawer ? paramOf(sizings.drawer.src) : 0;
const badgeParam = sizings.badge ? paramOf(sizings.badge.src) : 0;
console.log(`    小图：抽屉请求 ${drawerParam}px（natural ${sizings.drawer ? sizings.drawer.nat : 0}px）；`
  + `立脊小标请求 ${badgeParam}px（natural ${sizings.badge ? sizings.badge.nat : 0}px）—— 没有都拉大图`);
ok('3c', '立脊小标 / 抽屉缩略图用小尺寸（96 / 120），不是 1500 大图',
  `小标 ?param=${badgeParam}y${badgeParam}（natural ${sizings.badge ? sizings.badge.nat : 0}px）；`
  + `抽屉 ?param=${drawerParam}y${drawerParam}（natural ${sizings.drawer ? sizings.drawer.nat : 0}px）`,
  badgeParam === 96 && badgeParam < 200 && drawerParam === 120
  && !!sizings.badge && sizings.badge.nat > 40);

/* ================================================================
 * 4. 立脊小标：每张卡都有、20~28px、naturalWidth > 40；特写截图
 * ================================================================ */
console.log('\n[4] 立脊小标');
await viewport(1440, 900); await sleep(500); await waitCovers(); await sleep(400);
const g4 = await geo();
console.log('    序号  专辑                     小标(px)  原图  src');
const bad4 = [];
for (const it of g4.items) {
  const b = it.badge;
  const okk = !!b && b.img && b.w >= 20 && b.w <= 28 && b.h >= 20 && b.h <= 28 && b.naturalW > 40;
  if (!okk) bad4.push(it.key);
  console.log(`    ${String(it.i).padEnd(4)}  ${String(it.key).slice(0, 22).padEnd(22)}  ${b ? `${b.w}×${b.h}` : '—'}`
    + `     ${b ? b.naturalW : 0}px   ${b ? b.src : ''}`);
}
ok('4a', '每张卡的 .ma-item__spine 里都有小封面：20~28px、naturalWidth > 40',
  `${g4.items.length} 张；小标 ${g4.items.map((x) => (x.badge ? `${x.badge.w}×${x.badge.h}` : '—')).join(' / ')}；`
  + `naturalWidth ${g4.items.map((x) => (x.badge ? x.badge.naturalW : 0)).join('/')}px；不合格 ${bad4.length}`,
  g4.items.length === 6 && bad4.length === 0);

/* 立脊小标特写：中卡的脊顶 260px（clip 用页面坐标，加 2× 缩放看清） */
await scrollShelf(78);
await sleep(300);
const midIdx = g4.items.findIndex((x) => x.sel);
const badgeRect = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const it = v.querySelectorAll('.ma-item')[${midIdx}];
  const sp = it.querySelector('.ma-item__spine').getBoundingClientRect();
  return JSON.stringify({ left: sp.left, top: sp.top, w: sp.width, h: sp.height });
})()`);
await ev(`window.__LIZI_MYALBUMS.closeUp(); 'closed'`);
await sleep(900);
const badgeClip = {
  x: Math.max(0, Math.round(badgeRect.left - 90)),
  y: Math.max(0, Math.round(badgeRect.top - 24)),
  width: Math.round(badgeRect.w + 180),
  height: Math.min(320, Math.round(badgeRect.h)),
};
await shot('mabig-4-spine-badge.png', badgeClip, 2);
console.log(`    特写：中卡立脊 rect=(${Math.round(badgeRect.left)},${Math.round(badgeRect.top)}) ${Math.round(badgeRect.w)}×${Math.round(badgeRect.h)}px`
  + `，clip ${badgeClip.width}×${badgeClip.height} @2×`);

/* 无封面 → 首字占位 */
await ev(`window.__LIZI_MYALBUMS.collection.add({ id: 'netease:998877', name: '无封面占位测试',
  artists: '—', cover: '', source: 'netease', addedAt: Date.now() }); 'added'`);
await sleep(900);
const ph = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const it = [...v.querySelectorAll('.ma-item')].find((x) => x.dataset.key === 'netease:998877');
  if (!it) return JSON.stringify({ found: false });
  const bd = it.querySelector('.ma-item__sbadge');
  const sp = it.querySelector('.ma-item__sbadge-ph');
  return JSON.stringify({ found: true, badge: !!bd, ph: !!sp, text: sp ? sp.textContent : '',
    w: bd ? bd.offsetWidth : 0, h: bd ? bd.offsetHeight : 0 });
})()`);
console.log(`    无封面：小标占位=${ph.ph}「${ph.text}」 ${ph.w}×${ph.h}px`);
ok('4b', '无封面时立脊小标用首字占位（不留空槽）',
  `占位=${ph.ph}「${ph.text}」${ph.w}×${ph.h}px`,
  ph.found === true && ph.ph === true && ph.text.length === 1 && ph.w >= 20 && ph.w <= 28);
await ev(`window.__LIZI_MYALBUMS.collection.remove('netease:998877'); 'removed'`);
await sleep(600);

/* ================================================================
 * 5. 背景：alpha ≥ 0.30 + 落地光 + 暗角 + 换专辑色相变化 / 补间
 * ================================================================ */
console.log('\n[5] 背景渲染');
await viewport(1440, 900); await sleep(500); await waitCovers(); await sleep(600);
const bg0 = await geo();
const amb0 = parseOklch(bg0.ambient);
const soft0 = parseOklch(bg0.ambientSoft);
const layers = (String(bg0.bgImage).match(/radial-gradient\(/g) || []).length;
console.log(`    --ambient-color = ${bg0.ambient}  →  alpha ${amb0 ? amb0.a : 'NaN'}，色相 ${amb0 ? amb0.h : 'NaN'}°`);
console.log(`    --ambient-soft  = ${bg0.ambientSoft}  →  alpha ${soft0 ? soft0.a : 'NaN'}`);
console.log(`    背景层数 ≈ ${layers}（暗角 / 落地光 / 主色晕）；data-bg=${bg0.bg}`);
ok('5a', '--ambient-color alpha ≥ 0.30（落在 0.34~0.42），落地光 alpha 更低',
  `--ambient-color ${bg0.ambient}（alpha ${amb0 ? amb0.a : 0}）；--ambient-soft ${bg0.ambientSoft}（alpha ${soft0 ? soft0.a : 0}）；`
  + `背景 ${layers} 层 = 暗角 + 落地光 + 主色晕`,
  !!amb0 && amb0.a >= 0.30 && amb0.a <= 0.42 && !!soft0 && soft0.a > 0 && soft0.a < amb0.a && layers === 3);

/* 截图像素采样：左侧留白（x 8~150 / y 180~700）平均色 —— 证明色晕真的画进了留白 */
const png1440 = decodePng(bgPng);
const tint = regionMean(png1440, 8, 180, 150, 700);
const tintDelta = Math.max(255 - tint.r, 255 - tint.g, 255 - tint.b);
const tintSpread = Math.max(tint.r, tint.g, tint.b) - Math.min(tint.r, tint.g, tint.b);
console.log(`    截图留白平均色 rgb(${tint.r}, ${tint.g}, ${tint.b})：相对纯白最大偏色 Δ=${tintDelta}，通道差 ${tintSpread}（有偏色但不是灰）`);
ok('5d', '截图上留白色晕可见（左侧留白不是纯白）',
  `mabig-1-1440.png 左侧留白 ${tint.n} 个像素平均 rgb(${tint.r}, ${tint.g}, ${tint.b})，Δ=${tintDelta}，通道差=${tintSpread}`,
  tintDelta >= 2 && tintSpread >= 2);

/* 找两张色相差最大的专辑，切过去看色相变化 + 补间 */
const themes = await j(`JSON.stringify([...document.querySelectorAll('#view-myalbums .ma-item')].map((x) => ({
  key: x.dataset.key, hue: Number(x.dataset.spHue || 0), src: x.dataset.spSrc || '' })))`);
let pair = null;
for (let a = 0; a < themes.length; a++) for (let b = a + 1; b < themes.length; b++) {
  const d = dh(themes[a].hue, themes[b].hue);
  if (!pair || d > pair.d) pair = { a, b, d };
}
const pickA = pair ? pair.a : 0, pickB = pair ? pair.b : Math.min(1, g4.items.length - 1);
await ev(`window.__LIZI_MYALBUMS.openUp(${pickA}); 'a'`);
await sleep(700);
const bgA = await geo();
const ambA = parseOklch(bgA.ambient);
/* 切到 B：180ms 时采样（补间中），600ms 后采样（落定） */
await ev(`window.__LIZI_MYALBUMS.openUp(${pickB}); 'b'`);
await sleep(180);
const bgMid = await geo();
const ambMid = parseOklch(bgMid.ambient);
await sleep(600);
const bgB = await geo();
const ambB = parseOklch(bgB.ambient);
await ev(`window.__LIZI_MYALBUMS.closeUp(); 'closed'`);
await sleep(500);
const hueAB = dh(ambA.h, ambB.h);
const midA = dh(ambMid.h, ambA.h);
const midB = dh(ambMid.h, ambB.h);
const onArc = Math.abs(midA + midB - hueAB) < 2;
const progress = Math.round((midA / Math.max(0.001, hueAB)) * 1000) / 10;
console.log(`    ${themes[pickA].key}（${ambA.h}°）→ ${themes[pickB].key}（${ambB.h}°）：色相差 ${hueAB.toFixed(1)}°`);
console.log(`    切换 180ms 时 --ambient-color = ${bgMid.ambient}（${ambMid.h}°，沿最短弧走了 ${progress}%，在弧上=${onArc}）→ 600ms 后 ${bgB.ambient}`);
ok('5b', '换专辑 → 环境色色相变化（≥ 10°）',
  `${themes[pickA].key} ${ambA.h.toFixed(1)}° → ${themes[pickB].key} ${ambB.h.toFixed(1)}°，差 ${hueAB.toFixed(1)}°`,
  hueAB >= 10);
ok('5c', '色晕平滑过渡（180ms 采样在两端之间的弧上，300~500ms 落定）',
  `180ms 采样 ${ambMid.h.toFixed(1)}°：离 A ${midA.toFixed(1)}° / 离 B ${midB.toFixed(1)}°，沿弧 ${progress}%；600ms 落定 ${ambB.h.toFixed(1)}°；补间 420ms`,
  onArc && midA > 0.5 && midB > 0.5);

/* ================================================================
 * 6. 回归：特写 + 黑胶 / 拖拽 / ←→ / 抽屉 / 计数 / 形态切换 / 空状态
 * ================================================================ */
console.log('\n[6] 回归');
/* 6a 特写 + 黑胶 */
const idx6 = await ev(`window.__LIZI_MYALBUMS.index()`);
await ev(`window.__LIZI_MYALBUMS.openUp(${idx6}); 'open'`);
await gate(`window.__LIZI_MYALBUMS.openP()[${idx6}] > 0.999`, 80, 100);
await sleep(500);
const vin = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const it = v.querySelectorAll('.ma-item')[${idx6}];
  const vin = it.querySelector('.ma-item__vinyl');
  const cs = getComputedStyle(vin);
  const m = new DOMMatrixReadOnly(cs.transform);
  return JSON.stringify({ open: window.__LIZI_MYALBUMS.openIndex(), p: window.__LIZI_MYALBUMS.openP()[${idx6}],
    cls: it.classList.contains('is-open'), opacity: cs.opacity, anim: cs.animationName,
    slidePct: Math.round((m.m41 / vin.offsetWidth) * 1000) / 10,
    cta: (() => { const c = v.querySelector('[data-cta]'); return c ? { hidden: c.hidden, w: c.offsetWidth, h: c.offsetHeight } : null; })(),
    tx: it.style.transform });
})()`);
console.log(`    特写：openIndex=${vin.open} openP=${Number(vin.p).toFixed(3)} is-open=${vin.cls}；`
  + `黑胶 opacity=${vin.opacity} animation=${vin.anim} 滑出 ${vin.slidePct}%；CTA ${vin.cta ? `${vin.cta.w}×${vin.cta.h} hidden=${vin.cta.hidden}` : '缺'}`);
ok('6a', '特写开合 + 黑胶滑出（openProgress→1、vinyl 可见并转动、CTA 出现）',
  `openIndex=${vin.open}，openP=${Number(vin.p).toFixed(3)}，黑胶 opacity=${vin.opacity} / ${vin.anim} / 滑出 ${vin.slidePct}%；CTA hidden=${vin.cta && vin.cta.hidden}`,
  vin.open === idx6 && Number(vin.p) > 0.99 && vin.cls === true && Number(vin.opacity) === 1
  && /spinVinyl/.test(String(vin.anim)) && vin.slidePct >= 50 && !!vin.cta && vin.cta.hidden === false);
await key('Escape', 'Escape', 27);
const closedOk = await gate(`window.__LIZI_MYALBUMS.openIndex() === -1 && window.__LIZI_MYALBUMS.openP().every((x) => x === 0)`, 100, 50);
const closed = await ev(`JSON.stringify({ open: window.__LIZI_MYALBUMS.openIndex(), openP: window.__LIZI_MYALBUMS.openP().map((v) => Math.round(v * 1e5) / 1e5) })`);
console.log(`    Esc 收回：${closed}（2s 内收敛=${closedOk}）`);
ok('6a2', 'Esc 收回架子（openIndex=-1，openP 全 0）', closed,
  closedOk === true && JSON.parse(closed).open === -1);

/* 6b 拖拽 + ←→：先把选中移到中间，别在首/尾触发橡皮筋 */
for (let i = 0; i < 3; i++) { await key('ArrowLeft', 'ArrowLeft', 37); await sleep(120); }
await sleep(500);
await scrollShelf(90);
const stg = await rectOf('#view-myalbums .ma-stage');
const pos0 = await ev(`window.__LIZI_MYALBUMS.pos()`);
await moveTo(stg.x, stg.y);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: stg.x, y: stg.y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 6; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: stg.x - i * 22, y: stg.y, button: 'left', buttons: 1 });
  await sleep(16);
}
const posDrag = await ev(`window.__LIZI_MYALBUMS.pos()`);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: stg.x - 132, y: stg.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(900);
const posEnd = await ev(`window.__LIZI_MYALBUMS.pos()`);
const idxA = await ev(`window.__LIZI_MYALBUMS.index()`);
await ev(`document.activeElement && document.activeElement.blur()`);
await key('ArrowLeft', 'ArrowLeft', 37);
await sleep(450);
const idxB = await ev(`window.__LIZI_MYALBUMS.index()`);
const selDom = await ev(`[...document.querySelectorAll('#view-myalbums .ma-item')].findIndex((e) => e.classList.contains('is-sel'))`);
console.log(`    拖拽：pos ${pos0.toFixed(2)} → 按住 ${posDrag.toFixed(2)} → 松手 ${posEnd.toFixed(2)}；← 键 index ${idxA} → ${idxB}（DOM is-sel=${selDom}）`);
ok('6b', '拖拽 / 惯性 / ←→ 选中不回退',
  `pos ${pos0.toFixed(2)} → ${posDrag.toFixed(2)} → ${posEnd.toFixed(2)}；index ${idxA} → ${idxB}；is-sel=${selDom}`,
  posDrag > pos0 + 0.3 && idxB === Math.max(0, idxA - 1) && selDom === idxB);

/* 6c 抽屉 + 计数 */
await clickSel('#view-myalbums [data-drawerbtn]');
await sleep(400);
const drawer1 = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  return JSON.stringify({ open: v.querySelector('.ma-drawer').classList.contains('is-open'),
    aria: v.querySelector('[data-drawerbtn]').getAttribute('aria-expanded'),
    rows: v.querySelectorAll('.ma-row').length, bar: v.querySelector('[data-drawer-count]').textContent });
})()`);
await clickSel('#view-myalbums [data-drawerbtn]');
await sleep(400);
const drawer2 = await ev(`document.querySelector('#view-myalbums .ma-drawer').classList.contains('is-open')`);
const countNow = await ev(`document.querySelector('#view-myalbums [data-count]').textContent`);
console.log(`    抽屉：开 rows=${drawer1.rows} aria=${drawer1.aria} ${drawer1.bar} → 再点 ${drawer2}；计数 ${countNow} 张`);
ok('6c', '抽屉开关 / 列表行 / 计数不回退',
  `rows=${drawer1.rows} aria=${drawer1.aria} ${drawer1.bar}；再次点击 is-open=${drawer2}；计数 ${countNow}`,
  drawer1.open === true && drawer2 === false && drawer1.aria === 'true' && drawer1.rows === 6 && countNow === '6');

/* 6d 形态切换 */
await ev(`document.dispatchEvent(new CustomEvent('lizi:ma-form', { detail: { form: 'flow' } })); 'ok'`);
await sleep(700);
const flow = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const cs = getComputedStyle(v);
  const st = v.querySelector('.ma-stage').getBoundingClientRect();
  return JSON.stringify({ form: v.querySelector('[data-ma]').dataset.form, size: cs.getPropertyValue('--ma-size').trim(),
    stage: [Math.round(st.width), Math.round(st.height)], open: window.__LIZI_MYALBUMS.openIndex(),
    ls: localStorage.getItem('lizi.myAlbums.form'), items: v.querySelectorAll('.ma-item').length });
})()`);
await ev(`window.__LIZI_MYALBUMS.setForm('spine'); 'ok'`);
await sleep(700);
const spineBack = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  return JSON.stringify({ form: v.querySelector('[data-ma]').dataset.form,
    size: getComputedStyle(v).getPropertyValue('--ma-size').trim(),
    ls: localStorage.getItem('lizi.myAlbums.form') });
})()`);
console.log(`    flow：data-form=${flow.form} --ma-size=${flow.size} 舞台 ${flow.stage[0]}×${flow.stage[1]} 项 ${flow.items}；`
  + `切回 spine：${spineBack.form} / ${spineBack.size} / localStorage=${spineBack.ls}`);
ok('6d', '形态切换：flow 仍是 300px（不受侧立自适应影响），切回 spine 恢复',
  `flow ${flow.size}px 舞台 ${flow.stage[1]}px；spine ${spineBack.size}px；localStorage=${spineBack.ls}`,
  flow.form === 'flow' && flow.size === '300px' && flow.items === 6 && flow.open === -1
  && spineBack.form === 'spine' && spineBack.size === '702px' && spineBack.ls === 'spine');

/* 6e 空状态（清空后恢复） */
await ev(`window.__LIZI_MYALBUMS.collection.clear(); 'cleared'`);
await sleep(800);
const empty = await j(`(() => {
  const v = document.getElementById('view-myalbums');
  const e = v.querySelector('.ma-empty');
  return JSON.stringify({ items: v.querySelectorAll('.ma-item').length,
    count: (v.querySelector('[data-count]') || {}).textContent,
    visible: !!(e && !e.hidden && e.offsetHeight > 0),
    stage: getComputedStyle(v.querySelector('.ma-stage')).display,
    drawerHidden: v.querySelector('[data-drawerbtn]').hidden });
})()`);
console.log(`    空状态：items=${empty.items} 计数=${empty.count} 可见=${empty.visible} 舞台=${empty.stage} 抽屉按钮 hidden=${empty.drawerHidden}`);
ok('6e', '空状态不回退（没有空架子 / 计数归零 / 提示可见）',
  `.ma-item=${empty.items}，计数=${empty.count}，空状态可见=${empty.visible}，舞台 ${empty.stage}`,
  empty.items === 0 && empty.count === '0' && empty.visible === true && empty.stage === 'none' && empty.drawerHidden === true);

/* 恢复 6 张 */
await ev(`localStorage.setItem('lizi.myAlbums.v1', ${JSON.stringify(JSON.stringify(ALBUMS))});
  localStorage.setItem('lizi.myAlbums.form', 'spine'); localStorage.removeItem('lizi.myAlbums.bg'); 'restored'`);
await send('Page.reload');
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0 && !!window.__LIZI_MYALBUMS`, 120, 400);
await viewport(1440, 900);
await openShelf();
await gate(`document.querySelectorAll('#view-myalbums .ma-item').length === 6`, 80, 200);
await waitCovers();
await sleep(900);

/* ================================================================
 * 7. 控制台 + 落盘
 * ================================================================ */
console.log('\n[7] 控制台 / 截图');
console.log('    console.error:', consoleErrs.length, consoleErrs.slice(0, 6));
console.log('    uncaught    :', exceptions.length, exceptions.slice(0, 6));
ok('7a', '0 console error / 0 未捕获异常',
  `console.error=${consoleErrs.length}，exceptionThrown=${exceptions.length}`,
  consoleErrs.length === 0 && exceptions.length === 0);
const files = ['mabig-1-1440.png', 'mabig-2-1920.png', 'mabig-3-1280.png', 'mabig-4-spine-badge.png'];
const fsRows = files.map((f) => ({ f, size: fs.existsSync(path.join(OUT, f)) ? fs.statSync(path.join(OUT, f)).size : 0 }));
console.log('    ' + fsRows.map((x) => `${x.f} ${Math.round(x.size / 1024)}KB`).join(' · '));
ok('7b', '四张截图都在（三档视口 + 立脊小标特写）',
  fsRows.map((x) => `${x.f} ${Math.round(x.size / 1024)}KB`).join(' · '),
  fsRows.every((x) => x.size > 30000));

console.log(`\n===== ${R.pass} PASS / ${R.fail} FAIL =====`);
for (const r of R.rows) if (!r.pass) console.log(`  ✗ [${r.n}] ${r.name}`);
const dump = { at: new Date().toISOString(), pass: R.pass, fail: R.fail, rows: R.rows };
fs.writeFileSync(path.join(HERE, '_mabig.log'), JSON.stringify(dump, null, 2) + '\n');
ws.close();
ch.kill();
await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exit(R.fail ? 1 : 0);
