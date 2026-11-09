/**
 * _mebg.mjs —— 大厅「我的」卡 · 主页背景验收
 *   ⓪ 「从我的视频里挑」已整块拆除：设置里没有那个入口 / 视频网格，全程不发
 *      bgvideos / bgvideo-url 请求；以前写进 localStorage 的 netease-video 残留自动清掉
 *   ① 网易云那张**公用星空图**不许再当背景（默认 hash → 不画）
 *   ② 默认渐变：头像取色的色团 + 30~60s 漂移动画；reduced-motion 下停成静态
 *   ③ 自定义图片（data:image/svg+xml）
 *   ④ 自定义视频（data:video/mp4）→ <video> 有画面；404 地址 → 3s 退回渐变、不黑屏
 *   ⑤ 设置页「主页背景」那一行：值随来源变化、面板能开、清除回默认
 *   ⑥ 回归：大厅其它块 + #view-settings / #view-myalbums / #view-lab，0 console error
 *
 * 无头 Chrome + CDP（不碰 Electron 窗口），端口读 .port，真实登录态（不 mock 账号）。
 * 截图写到 shots/review/mebg-*.png；渐变「是不是纯白/纯黑」直接解 Chrome 的 PNG 数像素。
 *
 *   node _mebg.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '.port'), 'utf8').trim();
const BASE = `http://127.0.0.1:${APP}/`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440, VH = 1000;
const OUT = path.join(HERE, 'shots', 'review');
fs.mkdirSync(OUT, { recursive: true });

/* 自定义图片：两张色卡的 SVG（data URL）—— 只要 banner 的 background-image 命中它就算过 */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">'
  + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
  + '<stop offset="0" stop-color="#1d4ed8"/><stop offset="1" stop-color="#be185d"/>'
  + '</linearGradient></defs><rect width="80" height="40" fill="url(#g)"/></svg>';
const IMG_URL = 'data:image/svg+xml;base64,' + Buffer.from(SVG).toString('base64');

/* 自定义视频：64×64 / 0.8s / 2.7KB 的 mp4（ffmpeg 生成后内联，验收不依赖外部文件） */
const MP4_B64 = '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';
const VID_URL = 'data:video/mp4;base64,' + MP4_B64;
const BAD_VID = `http://127.0.0.1:${APP}/__no_such_bg__.mp4`;

const STAR_HASH = '2zSNIqTcpHL2jIvU6hG0EA==';
const STAR_ENC = '2zSNIqTcpHL2jIvU6hG0EA%3D%3D';
const STAR_ID = '109951162868128395';

const R = { pass: 0, fail: 0, rows: [] };
const ok = (n, name, detail, pass) => {
  R.rows.push({ n, name, detail, pass });
  if (pass) R.pass++; else R.fail++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  [${n}] ${name} —— ${detail}`);
};

/* ---------- 无头 Chrome ---------- */
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-mebg-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pend = new Map();
let consoleErrs = []; const exceptions = [];
/* 网络账本：拆掉的那个功能如果还活着，这里一定会出现 bgvideos / bgvideo-url */
const netAll = []; let netReqs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Network.requestWillBeSent') {
    const u = String((m.params.request && m.params.request.url) || '');
    netAll.push(u); netReqs.push(u);
  }
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
const gate = async (cond, tries = 80, ms = 400) => {
  for (let i = 0; i < tries; i++) { if (await ev(cond)) return true; await sleep(ms); }
  return false;
};
const viewport = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const reduced = (on) => send('Emulation.setEmulatedMedia', on
  ? { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }
  : { features: [] });
const shot = async (name, clip) => {
  const p = { format: 'png' };
  if (clip) { p.clip = clip; }
  const png = await send('Page.captureScreenshot', p);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(png.data, 'base64'));
  const st = fs.statSync(path.join(OUT, name));
  console.log('    →', `shots/review/${name}`, `(${Math.round(st.size / 1024)} KB)`);
  return png.data;
};

/* ---------- 极简 PNG 解码 + 取样统计（Chrome 截图 = 8bit；ct 2=RGB / 6=RGBA / 0=灰度，无隔行） ---------- */
function pngRGBA(b64) {
  const buf = Buffer.from(b64, 'base64');
  let p = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 0;
  if (bd !== 8 || !ch || !w || !h) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  if (ch === 4) return { w, h, data: out };
  /* 统一成 RGBA 再统计（灰度 / RGB 截图都能算） */
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += ch) {
    rgba[i * 4] = out[j];
    rgba[i * 4 + 1] = ch === 1 ? out[j] : out[j + 1];
    rgba[i * 4 + 2] = ch === 1 ? out[j] : out[j + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { w, h, data: rgba };
}
/** 取样：亮度均值/标准差 + 量化后不同颜色数（判「不是纯白/纯黑、真有色团」） */
function pixStats(b64) {
  const img = pngRGBA(b64);
  if (!img) return null;
  const { w, h, data } = img;
  const hist = new Map();
  let n = 0, sum = 0, sum2 = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum; sum2 += lum * lum; n++;
      const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    w, h, n, mean: +mean.toFixed(1), sd: +sd.toFixed(1), colors: hist.size,
    dominantShare: +(top[1] / n).toFixed(3),
  };
}

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Network.enable');

/* ---------- 每次导航前种 localStorage（不改产品代码） ---------- */
let preId = null;
async function setPre(spec) {
  if (preId) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: preId }); preId = null; }
  const bg = spec.bg;
  const line = bg === undefined
    ? ''
    : (bg === null ? "localStorage.removeItem('lizi.hall.me.bg');"
      : `localStorage.setItem('lizi.hall.me.bg', ${JSON.stringify(JSON.stringify(bg))});`);
  const src = `(() => { try {
    ${line}
    localStorage.removeItem('lizi.hall.me.cache.v1');
    localStorage.removeItem('lizi.hall.me.platform');
  } catch (e) {} })();`;
  preId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: src })).identifier;
}
async function reload(spec) {
  consoleErrs = []; exceptions.length = 0; netReqs = [];
  await setPre(spec || {});
  await send('Page.navigate', { url: BASE + '?t=' + Date.now() });
}
/** 等真实登录态那张卡（King-8I4 / 网易云）画出来 */
const waitMe = () => gate(`(() => {
  const on = document.querySelector('#hall-me .me__slide.is-on');
  if (!on) return false;
  const n = (on.querySelector('.me__name') || {}).textContent || '';
  const b = on.querySelector('.me__banner');
  return !!b && n.indexOf('King-8I4') >= 0;
})()`, 100, 400);

const bgInfo = () => ev(`(() => {
  const on = document.querySelector('#hall-me .me__slide.is-on');
  const b = on && on.querySelector('.me__banner');
  if (!b) return JSON.stringify({ found: false });
  const cs = getComputedStyle(b);
  const glow = b.querySelector('.me__glow');
  const blob = b.querySelector('.me__glow i');
  const v = b.querySelector('video');
  const r = b.getBoundingClientRect();
  const vr = v ? v.getBoundingClientRect() : null;
  const ava = on.querySelector('.me__ava');
  return JSON.stringify({
    found: true,
    kind: b.getAttribute('data-bgkind'),
    bgImage: cs.backgroundImage,
    bgColor: cs.backgroundColor,
    hue: b.style.getPropertyValue('--me-hue').trim(),
    hueComputed: cs.getPropertyValue('--me-hue').trim(),
    glowAnim: glow ? getComputedStyle(glow).animationName : '',
    glowDisplay: glow ? getComputedStyle(glow).display : '',
    blobAnim: blob ? getComputedStyle(blob).animationName : '',
    blobAnimDur: blob ? getComputedStyle(blob).animationDuration : '',
    blobCount: b.querySelectorAll('.me__glow i').length,
    video: v ? {
      src: String(v.currentSrc || v.src).slice(0, 60), w: v.videoWidth, h: v.videoHeight,
      paused: v.paused, loop: v.loop, muted: v.muted, auto: v.autoplay,
      inline: v.hasAttribute('playsinline'), preload: v.preload,
      fit: getComputedStyle(v).objectFit, z: getComputedStyle(v).zIndex,
      covers: !!(vr && Math.abs(vr.width - r.width) < 1.5 && Math.abs(vr.height - r.height) < 1.5),
    } : null,
    rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    ava: ava ? String(getComputedStyle(ava).backgroundImage).slice(0, 70) : '',
    name: (on.querySelector('.me__name') || {}).textContent || '',
    platform: (document.querySelector('#hall-me .me') || {}).dataset
      ? document.querySelector('#hall-me .me').dataset.platform : '',
    setVal: (document.getElementById('set-mebg') || {}).textContent || '',
    stored: localStorage.getItem('lizi.hall.me.bg'),
    hash: ${JSON.stringify(STAR_HASH)},
  });
})()`);

/* 把「我的」卡滚到视口中间（hall 是内层滚动容器），再截图 */
async function showMeCard() {
  await ev(`(() => { const c = document.querySelector('#hall-me .me-card');
    if (c) c.scrollIntoView({ block: 'center' }); return true; })()`);
  await sleep(600);
}
const clipRect = (sel, pad = 12) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return '';
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.max(0, r.left - ${pad}), y: Math.max(0, r.top - ${pad}),
    width: Math.min(innerWidth - Math.max(0, r.left - ${pad}), r.width + ${pad} * 2),
    height: r.height + ${pad} * 2, scale: 1 });
})()`);

const BASE_CHECKS = `
const hall = document.getElementById('view-hall');
hall.classList.contains('is-active');
`;
await viewport(W, VH);
console.log(`\nLIZI 大厅「我的」卡 · 主页背景验收  ·  ${BASE}  ·  ${W}×${VH} 无头 Chrome`);

/* ================================================================
 * 0. 「从我的视频里挑」已拆除：没有入口 / 没有网格 / 不发视频请求，
 *    并且以前写进去的 netease-video 残留在启动时自动清掉
 * ================================================================ */
console.log('\n[0] 功能已拆除 + 旧残留自动清理');
await reload({ bg: { kind: 'video', source: 'netease-video', vid: 'x' } });   /* 模拟用户身上那条残留 */
if (!(await waitMe())) {
  console.log('!! 「我的」卡没等到真实账号，先看 console：', consoleErrs.slice(0, 3), exceptions.slice(0, 3));
  process.exit(2);
}
await sleep(900);
const gone = JSON.parse(await ev(`(() => JSON.stringify({
  pick: !!document.getElementById('mebg-pick'),
  grid: !!document.getElementById('mebg-videos') || !!document.getElementById('mebg-vgrid'),
  pageText: document.documentElement.innerHTML.indexOf('从我的视频里挑') >= 0,
  stored: localStorage.getItem('lizi.hall.me.bg'),
  kind: (document.querySelector('#hall-me .me__slide.is-on .me__banner') || {}).getAttribute
    ? document.querySelector('#hall-me .me__slide.is-on .me__banner').getAttribute('data-bgkind') : '',
  videos: document.querySelectorAll('#hall-me video').length,
}))()`));
/* 设置页也打开一遍：面板里同样不该有入口 */
await ev(`document.getElementById('btn-settings').click()`);
await gate(`document.getElementById('view-settings').classList.contains('is-active')`, 40, 300);
await ev(`document.getElementById('row-mebg').click()`);
await sleep(600);
const panel = JSON.parse(await ev(`(() => {
  const p = document.getElementById('mebg-panel');
  return JSON.stringify({
    open: !!p && p.hidden === false,
    pick: !!document.getElementById('mebg-pick'),
    grid: !!document.getElementById('mebg-vgrid') || !!document.getElementById('mebg-videos'),
    htmlHasVideoGrid: !!p && /mebg-v|mebg__pick/.test(p.innerHTML),
    imgs: document.querySelectorAll('#mebg-vgrid img').length,
    rows: !!document.getElementById('row-account') && !!document.getElementById('row-cookie')
      && !!document.getElementById('row-mebg') && !!document.getElementById('row-audio'),
  });
})()`));
const vidReqs = netReqs.filter((u) => /bgvideos|bgvideo-url/.test(u));
console.log(`    DOM：入口=${gone.pick} 网格=${gone.grid} 页面文案含「从我的视频里挑」=${gone.pageText}`);
console.log(`    面板：打开=${panel.open} 入口=${panel.pick} 网格=${panel.grid} 缩略图=${panel.imgs} 其它行=${panel.rows}`);
console.log(`    旧残留：localStorage=${gone.stored}，banner data-bgkind=${gone.kind}，<video>=${gone.videos}`);
console.log(`    视频请求：${vidReqs.length} 条${vidReqs.length ? ' :: ' + vidReqs.slice(0, 2).join(' | ') : ''}`);
ok(0, '设置面板里没有「从我的视频里挑」/ 视频网格',
  `入口=${gone.pick} 网格=${gone.grid} 文案=${gone.pageText} | 面板 入口=${panel.pick} 网格=${panel.grid} 缩略图=${panel.imgs}`,
  !gone.pick && !gone.grid && !gone.pageText && panel.open && !panel.pick && !panel.grid
  && !panel.htmlHasVideoGrid && panel.imgs === 0 && panel.rows);
ok('0b', '旧 netease-video 残留自动清掉：键没了、大厅回默认渐变、没有 <video>',
  `stored=${gone.stored} / data-bgkind=${gone.kind} / <video>=${gone.videos}`,
  gone.stored === null && gone.kind === 'gradient' && gone.videos === 0);
ok('0c', '本次加载 + 打开设置没有 bgvideos / bgvideo-url 请求',
  `请求 ${vidReqs.length} 条 / 本次共 ${netReqs.length} 条`, vidReqs.length === 0);

/* ================================================================
 * 1. 默认：网易云公用星空图不许出现 → 头像取色的动态渐变
 * ================================================================ */
console.log('\n[1] 默认（当前登录态，没有自定义背景）');
await reload({ bg: null });
if (!(await waitMe())) {
  console.log('!! 「我的」卡没等到真实账号，先看 console：', consoleErrs.slice(0, 3), exceptions.slice(0, 3));
  process.exit(2);
}
await sleep(700);
await showMeCard();
let a = JSON.parse(await bgInfo());
console.log(`    账号「${a.name}」平台=${a.platform}，banner data-bgkind=${a.kind}`);
console.log(`    background-image=${a.bgImage}`);
console.log(`    色团 ${a.blobCount} 个，animation=${a.blobAnim} ${a.blobAnimDur}，--me-hue=${a.hue || a.hueComputed}`);
const noStar = !(a.bgImage || '').includes(STAR_HASH) && !(a.bgImage || '').includes(STAR_ENC)
  && !(a.bgImage || '').includes(STAR_ID) && a.kind !== 'netease';
ok(1, '公用星空图不再当背景',
  `data-bgkind=${a.kind} / background-image=${a.bgImage} / 不含 ${STAR_HASH}：${noStar}`,
  a.found && noStar && a.kind === 'gradient' && (a.bgImage === 'none' || !a.bgImage));

/* 渐变层 + 动画 + 真的有色团（截 banner 上半截数像素，避开底部 72px 白虚化） */
const bannerClip = JSON.parse(await clipRect('#hall-me .me__slide.is-on .me__banner', 0));
const gClip = { x: bannerClip.x, y: bannerClip.y, width: bannerClip.width, height: Math.max(40, bannerClip.height - 82), scale: 1 };
const gPng = await send('Page.captureScreenshot', { format: 'png', clip: gClip });
const gStat = pixStats(gPng.data);
await shot('mebg-1-default.png', JSON.parse(await clipRect('#hall-me .me-card', 12)));
console.log(`    渐变层像素：${gStat ? `${gStat.w}×${gStat.h} 均值亮度 ${gStat.mean} / 标准差 ${gStat.sd} / 量化色数 ${gStat.colors} / 主色占比 ${gStat.dominantShare}` : '解码失败'}`);
ok(2, '默认渐变生效：有三个色团、有漂移动画、不是纯白/纯黑',
  `色团 ${a.blobCount} 个 / animationName=${a.blobAnim} / 时长 ${a.blobAnimDur} / 色相 ${a.hue || a.hueComputed}`
  + (gStat ? ` / 像素 均值 ${gStat.mean}、σ ${gStat.sd}、${gStat.colors} 种色、主色 ${(gStat.dominantShare * 100).toFixed(1)}%` : ''),
  a.blobCount === 3 && a.blobAnim && a.blobAnim !== 'none'
  && +a.blobAnimDur.replace('s', '') >= 30 && +a.blobAnimDur.replace('s', '') <= 60
  && !!gStat && gStat.sd >= 4 && gStat.colors >= 8 && gStat.mean > 40 && gStat.mean < 246);

/* reduced-motion：动画停掉（CSS animation: none），只有静态渐变 */
await reduced(true);
await sleep(500);
const rm = JSON.parse(await bgInfo());
await reduced(false);
await sleep(300);
console.log(`    reduced-motion：glow animation=${rm.glowAnim}，色团 animation=${rm.blobAnim}`);
ok('2b', 'prefers-reduced-motion: reduce → 漂移动画停掉（只剩静态渐变）',
  `glow=${rm.glowAnim || 'none'} / 色团=${rm.blobAnim || 'none'} / 色团数 ${rm.blobCount}`,
  (rm.blobAnim === 'none' || rm.blobAnim === '') && (rm.glowAnim === 'none' || rm.glowAnim === '')
  && rm.blobCount === 3);

/* ================================================================
 * 2. 自定义图片
 * ================================================================ */
console.log('\n[2] 自定义图片（data:image/svg+xml）');
await reload({ bg: { kind: 'image', url: IMG_URL } });
if (!(await waitMe())) console.log('!! 卡片没出来');
await sleep(700);
await showMeCard();
const bi = JSON.parse(await bgInfo());
console.log(`    data-bgkind=${bi.kind}，background-image=${String(bi.bgImage).slice(0, 90)}…，色团 display=${bi.glowDisplay}`);
await shot('mebg-2-image.png', JSON.parse(await clipRect('#hall-me .me-card', 12)));
ok(3, '自定义图片：banner 用这张图（background-image 命中 data URL）',
  `data-bgkind=${bi.kind} / background-image 含 data:image/svg+xml=${String(bi.bgImage).includes('data:image/svg+xml')} / 色团 display=${bi.glowDisplay}`,
  bi.kind === 'custom-image' && String(bi.bgImage).includes('data:image/svg+xml')
  && bi.glowDisplay === 'none' && !bi.video);

/* ================================================================
 * 3. 自定义视频（data:video/mp4）
 * ================================================================ */
console.log('\n[3] 自定义视频（内联 2.7KB mp4）');
await reload({ bg: { kind: 'video', url: VID_URL } });
if (!(await waitMe())) console.log('!! 卡片没出来');
const vidOk = await gate(`(() => { const v = document.querySelector('#hall-me .me__slide.is-on .me__banner video');
  return !!v && v.videoWidth > 0; })()`, 40, 300);
await sleep(700);
await showMeCard();
const bv = JSON.parse(await bgInfo());
const v = bv.video || {};
console.log(`    <video> = ${!!bv.video}，${v.w}×${v.h}，paused=${v.paused}，loop=${v.loop} muted=${v.muted} autoplay=${v.auto} playsinline=${v.inline}`
  + ` / preload=${v.preload} / object-fit=${v.fit} / z=${v.z} / 铺满=${v.covers}`);
await shot('mebg-3-video.png', JSON.parse(await clipRect('#hall-me .me-card', 12)));
ok(4, '自定义视频：banner 里的 <video> 有画面（videoWidth>0）且铺满',
  `<video> ${!!bv.video} / ${v.w}×${v.h} / paused=${v.paused} / loop=${v.loop} muted=${v.muted} autoplay=${v.auto}`
  + ` / playsinline=${v.inline} / preload=${v.preload} / object-fit=${v.fit} / 与 banner 同尺寸=${v.covers}`,
  vidOk && !!bv.video && v.w > 0 && v.h > 0 && v.loop && v.muted && v.auto && v.inline
  && v.fit === 'cover' && v.covers && bv.kind === 'custom-video');

/* reduced-motion：视频暂停在首帧 */
await reduced(true);
await sleep(600);
const rmv = JSON.parse(await bgInfo());
await reduced(false);
await sleep(400);
console.log(`    reduced-motion：video paused=${rmv.video && rmv.video.paused}（首帧仍在，不黑）`);
ok('4b', 'prefers-reduced-motion: reduce → 视频暂停在首帧',
  `paused=${rmv.video && rmv.video.paused} / 仍在 DOM=${!!rmv.video} / 画面 ${rmv.video && rmv.video.w}×${rmv.video && rmv.video.h}`,
  !!(rmv.video && rmv.video.paused) && rmv.kind === 'custom-video');

/* ================================================================
 * 4. 坏地址（404）→ 3s 退回渐变，不黑屏、不抛异常
 * ================================================================ */
console.log('\n[4] 坏视频地址（404）');
await reload({ bg: { kind: 'video', url: BAD_VID } });
if (!(await waitMe())) console.log('!! 卡片没出来');
const err0 = exceptions.length + consoleErrs.length;
await sleep(3400);
const bf = JSON.parse(await bgInfo());
const bClip = JSON.parse(await clipRect('#hall-me .me__slide.is-on .me__banner', 0));
const bPng = await send('Page.captureScreenshot', { format: 'png', clip: { ...bClip, height: Math.max(40, bClip.height - 82) } });
const bStat = pixStats(bPng.data);
const errNew = exceptions.length + consoleErrs.length - err0;
console.log(`    3.4s 后：data-bgkind=${bf.kind}，<video> 还在=${!!bf.video}，色团 animation=${bf.blobAnim}`
  + (bStat ? `，像素 均值 ${bStat.mean} / σ ${bStat.sd} / ${bStat.colors} 色` : '')
  + `，新增报错 ${errNew}`);
ok(5, '视频 404：3s 后退回渐变、没有黑块、不抛异常',
  `data-bgkind=${bf.kind} / <video>=${!!bf.video} / 色团动画=${bf.blobAnim}`
  + (bStat ? ` / 像素 均值 ${bStat.mean} σ ${bStat.sd} 色数 ${bStat.colors}` : '') + ` / 新增报错 ${errNew}`,
  bf.kind === 'gradient' && !bf.video && bf.blobAnim !== 'none' && errNew === 0
  && !!bStat && bStat.mean > 40 && bStat.mean < 246 && bStat.sd >= 3);

/* ================================================================
 * 5. 设置页那一行 + 面板
 * ================================================================ */
console.log('\n[5] 设置页「主页背景」');
await reload({ bg: { kind: 'image', url: IMG_URL } });     /* 带自定义进来，值该是「自定义」 */
if (!(await waitMe())) console.log('!! 卡片没出来');
await sleep(500);
await ev(`document.getElementById('btn-settings').click()`);
const setOpen = await gate(`document.getElementById('view-settings').classList.contains('is-active')`, 40, 300);
await sleep(400);
const rowInfo = JSON.parse(await ev(`(() => {
  const row = document.getElementById('row-mebg');
  const val = document.getElementById('set-mebg');
  const panel = document.getElementById('mebg-panel');
  const note = panel && panel.querySelector('.mebg__note');
  const cs = note ? getComputedStyle(note) : null;
  const file = document.getElementById('mebg-file');
  return JSON.stringify({
    row: !!row, expanded: row && row.getAttribute('aria-expanded'),
    val: val ? val.textContent : '', panelHidden: panel ? panel.hidden : null,
    noteText: note ? note.textContent.replace(/\\s+/g, ' ').trim() : '',
    noteSize: cs ? cs.fontSize : '', noteColor: cs ? cs.color : '',
    fileAccept: file ? file.getAttribute('accept') : '',
    fileType: file ? file.type : '',
  });
})()`));
console.log(`    行存在=${rowInfo.row}，值「${rowInfo.val}」，面板 hidden=${rowInfo.panelHidden}，note ${rowInfo.noteSize} / ${rowInfo.noteColor}`);
console.log(`    说明文字：「${rowInfo.noteText}」`);
await ev(`document.getElementById('row-mebg').click()`);
await sleep(400);
const opened = JSON.parse(await ev(`(() => {
  const p = document.getElementById('mebg-panel');
  return JSON.stringify({ hidden: p.hidden, expanded: document.getElementById('row-mebg').getAttribute('aria-expanded'),
    height: +p.getBoundingClientRect().height.toFixed(1) });
})()`));
const setClip = JSON.parse(await clipRect('#view-settings .setpage__sec', 10));
await shot('mebg-4-setting.png', setClip);
const vtxt = rowInfo.noteText;
ok(6, '设置页有「主页背景」那一行：值随来源、面板能开、说明文字 10.5px 灰',
  `行=${rowInfo.row} / 值「${rowInfo.val}」/ 面板打开后 hidden=${opened.hidden} 高 ${opened.height}px`
  + ` / 说明 ${rowInfo.noteSize} ${rowInfo.noteColor} / 含 F12=${vtxt.includes('F12')} 含 mp4=${vtxt.includes('mp4')}`
  + ` / 文件框 accept=${rowInfo.fileAccept}`,
  setOpen && rowInfo.row && rowInfo.val === '自定义' && opened.hidden === false
  && opened.expanded === 'true' && opened.height > 40
  && rowInfo.noteSize === '10.5px' && vtxt.includes('F12') && vtxt.includes('mp4') && vtxt.includes('Network')
  && rowInfo.fileAccept === 'image/*,video/*');

/* 改 URL → 值变；清除 → 回默认 + 大厅横幅退回渐变 */
const applyRes = JSON.parse(await ev(`(() => {
  const i = document.getElementById('mebg-url');
  i.value = ${JSON.stringify(IMG_URL)};
  document.getElementById('mebg-apply').click();
  return JSON.stringify({ stored: localStorage.getItem('lizi.hall.me.bg'), val: document.getElementById('set-mebg').textContent,
    state: (document.getElementById('mebg-state') || {}).textContent || '' });
})()`));
await sleep(500);
const afterApply = JSON.parse(await bgInfo());
const clearRes = JSON.parse(await ev(`(() => {
  document.getElementById('mebg-clear').click();
  return JSON.stringify({ stored: localStorage.getItem('lizi.hall.me.bg'),
    val: document.getElementById('set-mebg').textContent });
})()`));
await sleep(700);
const afterClear = JSON.parse(await bgInfo());
console.log(`    应用地址 → 存 ${applyRes.stored ? '有' : '无'}，值「${applyRes.val}」，大厅 bgkind=${afterApply.kind}`);
console.log(`    清除 → 存=${clearRes.stored}，值「${clearRes.val}」，大厅 bgkind=${afterClear.kind}、image=${afterClear.bgImage}`);
ok('6b', 'URL 写入 / 清除都即时生效：自定义 → 默认渐变',
  `写入后 值「${applyRes.val}」大厅=${afterApply.kind}；清除后 值「${clearRes.val}」大厅=${afterClear.kind}`
  + `（image=${String(afterClear.bgImage).slice(0, 12)}）`,
  !!applyRes.stored && applyRes.val === '自定义' && afterApply.kind === 'custom-image'
  && !clearRes.stored && clearRes.val === '默认渐变' && afterClear.kind === 'gradient'
  && (afterClear.bgImage === 'none' || !afterClear.bgImage));

/* 附加：本地文件（DOM.setFileInputFiles 塞一张 1×1 png，走 URL.createObjectURL） */
let fileExtra = { ok: false, msg: '未测' };
try {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const p = path.join(os.tmpdir(), 'lizi-mebg-probe.png');
  fs.writeFileSync(p, png);
  const doc = await send('DOM.getDocument', {});
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#mebg-file' });
  await send('DOM.setFileInputFiles', { files: [p], nodeId: q.nodeId });
  await sleep(900);
  const fr = JSON.parse(await ev(`JSON.stringify({ stored: localStorage.getItem('lizi.hall.me.bg'),
    state: (document.getElementById('mebg-state') || {}).textContent || '',
    kind: (document.querySelector('#hall-me .me__slide.is-on .me__banner') || {}).getAttribute
      ? document.querySelector('#hall-me .me__slide.is-on .me__banner').getAttribute('data-bgkind') : '' })`));
  fileExtra = { ok: !!fr.stored && /blob:/.test(fr.stored) && fr.kind === 'custom-image', msg: fr };
  console.log(`    本地文件：存=${String(fr.stored).slice(0, 60)}，大厅=${fr.kind}，提示「${fr.state}」`);
  await ev(`document.getElementById('mebg-clear').click()`);
} catch (e) {
  fileExtra = { ok: false, msg: String(e && e.message || e) };
  console.log('    本地文件：测不了（' + fileExtra.msg + '）');
}

/* ================================================================
 * 6. 回归：大厅其它块 / 三个视图 / 0 console error
 * ================================================================ */
console.log('\n[6] 回归');
await ev(`document.getElementById('brand').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 300);
await sleep(600);
const hall = JSON.parse(await ev(`(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const hero = document.getElementById('hall-hero');
  const hr = hero ? hero.getBoundingClientRect() : { width: 0, height: 0 };
  return JSON.stringify({
    active: document.getElementById('view-hall').classList.contains('is-active'),
    hero: [Math.round(hr.width), Math.round(hr.height)],
    tools: q('#hall-tools .hall-tools__i'), daily: q('#hall-daily .hrow'),
    picks: document.querySelectorAll('#hall-picks > *').length,
    feed: q('#hall-feed .hall-pl'),
    meCard: q('#hall-me .me-card'), banner: q('#hall-me .me__banner'),
    kind: (document.querySelector('#hall-me .me__slide.is-on .me__banner') || {}).getAttribute
      ? document.querySelector('#hall-me .me__slide.is-on .me__banner').getAttribute('data-bgkind') : '',
  });
})()`));
console.log(`    大厅：hero ${hall.hero[0]}×${hall.hero[1]}，工具 ${hall.tools} 行，本日推荐 ${hall.daily} 行，`
  + `精选 ${hall.picks} 块，推荐歌单 ${hall.feed} 张，我的卡 ${hall.meCard} 张（bgkind=${hall.kind}）`);

/* 我的专辑 */
const maOk = await ev(`(() => {
  const b = document.querySelector('#hall-tools [data-tool="myalbums"]');
  if (!b) return 'no-btn';
  b.click(); return 'clicked';
})()`);
const maOpen = maOk === 'clicked' ? await gate(`document.getElementById('view-myalbums').classList.contains('is-active')
  && !!document.querySelector('#view-myalbums .ma-world')
  && !!document.querySelector('#view-myalbums .ma-title')`, 100, 400) : false;
await sleep(600);
const maCount = await ev(`document.querySelectorAll('#view-myalbums .ma-item').length`);
await ev(`document.getElementById('brand').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 300);
await sleep(400);

/* 实验室 */
const labClick = await ev(`(() => {
  const b = document.querySelector('#hall-tools [data-tool="lab"]');
  if (!b) return 'no-btn';
  b.click(); return 'clicked';
})()`);
const labOpen = labClick === 'clicked' ? await gate(`document.getElementById('view-lab').classList.contains('is-active')
  && document.getElementById('lab-pane-dj').classList.contains('is-on')`, 100, 400) : false;
await ev(`document.getElementById('brand').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 300);
await sleep(300);

/* 设置页再进一次（值应该是「默认渐变」） */
await ev(`document.getElementById('btn-settings').click()`);
const setAgain = await gate(`document.getElementById('view-settings').classList.contains('is-active')`, 40, 300);
await sleep(400);
const setVal2 = await ev(`document.getElementById('set-mebg').textContent`);
await ev(`document.getElementById('brand').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 300);
await sleep(300);

const errAll = [...exceptions, ...consoleErrs];
console.log(`    我的专辑=${maOpen}（卡片 ${maCount} 张）；实验室=${labOpen}；设置页=${setAgain}，值「${setVal2}」`);
console.log(`    console error=${consoleErrs.length}，未捕获异常=${exceptions.length}${errAll.length ? ' :: ' + errAll.slice(0, 3).join(' | ') : ''}`);
ok(7, '回归：大厅其它块 + 我的专辑 / 实验室 / 设置页都正常，0 报错',
  `hero ${hall.hero.join('×')} / 工具 ${hall.tools} / 本日推荐 ${hall.daily} / 精选 ${hall.picks} / 歌单 ${hall.feed}`
  + ` / 我的卡 ${hall.meCard} / 我的专辑=${maOpen}(${maCount}) / 实验室=${labOpen} / 设置=${setAgain}（值「${setVal2}」）`
  + ` / error=${consoleErrs.length} 异常=${exceptions.length}`,
  hall.active && hall.hero[0] > 200 && hall.hero[1] > 150 && hall.tools === 4 && hall.daily > 0
  && hall.picks > 0 && hall.feed > 0 && hall.meCard >= 1 && maOpen && labOpen && setAgain
  && setVal2 === '默认渐变' && errAll.length === 0);

/* ================================================================
 * 7. 默认背景判定表（直接问注册表的 detail()，不画 UI）
 * ================================================================ */
console.log('\n[7] 默认背景判定表（GET /api/user/detail → accounts.js 的 netease.detail）');
const table = JSON.parse(await ev(`(async () => {
  const a = (window.LIZI_ACCOUNTS || []).find((x) => x.id === 'netease');
  if (!a) return '[]';
  const uids = ['8498237749', '470487020', '1658987224', '3271481561',
                '1', '32953014', '48353', '99324533'];
  const out = [];
  for (const u of uids) {
    try {
      const m = await a.detail(u);
      out.push({ uid: u, nick: m ? m.nickname : '', kind: m ? m.bannerKind : 'null',
        hash: (m && m.bannerHash) || '', banner: m && m.banner ? '有' : '无' });
    } catch (e) {
      out.push({ uid: u, nick: '', kind: 'ERR', hash: String((e && e.message) || e).slice(0, 40), banner: '' });
    }
  }
  return JSON.stringify(out);
})()`));
for (const r of table) {
  console.log(`    uid ${String(r.uid).padEnd(11)} ${String(r.kind).padEnd(8)} banner=${r.banner}  hash=${r.hash || '—'}  「${r.nick}」`);
}
const DEF = table.slice(0, 4), OWN = table.slice(4);
ok(8, '默认判定表：4 个公用默认图账号 → default（不画）；4 个自带背景的 → netease（照画）',
  DEF.map((r) => `${r.uid}:${r.kind}/${r.banner}`).join(' ')
  + ' || ' + OWN.map((r) => `${r.uid}:${r.kind}/${r.banner}`).join(' '),
  DEF.every((r) => r.kind === 'default' && r.banner === '无')
  && OWN.every((r) => r.kind === 'netease' && r.banner === '有'));

/* 全程（默认 / 图片 / 视频 / 404 / 设置 / 回归 / 刷新过多次）一条都不该有 */
const allVidReqs = netAll.filter((u) => /bgvideos|bgvideo-url/.test(u));
ok(9, '全程 0 次 bgvideos / bgvideo-url 请求（所有 navigate + 交互合计）',
  `全程请求 ${netAll.length} 条；命中视频接口 ${allVidReqs.length} 条`
  + (allVidReqs.length ? ' :: ' + allVidReqs.slice(0, 3).join(' | ') : ''),
  allVidReqs.length === 0);

/* ================================================================
 * 汇总
 * ================================================================ */
console.log('\n============ 汇总 ============');
for (const r of R.rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${String(r.n).padStart(3)}] ${r.name}`);
const main = R.rows.filter((r) => typeof r.n === 'number');
const extra = R.rows.filter((r) => typeof r.n !== 'number');
console.log(`\n主项：通过 ${main.filter((r) => r.pass).length} / ${main.length}；附加：通过 ${extra.filter((r) => r.pass).length} / ${extra.length}`);
console.log(`本地文件（附加）：${fileExtra.ok ? 'PASS' : 'SKIP/FAIL'} —— ${JSON.stringify(fileExtra.msg).slice(0, 160)}`);
console.log('视频接口请求（bgvideos / bgvideo-url）：', allVidReqs.length ? allVidReqs.slice(0, 5) : '无');
if (R.fail) console.log('失败项：', R.rows.filter((r) => !r.pass).map((r) => r.n).join(','));
console.log('console error:', consoleErrs.length ? consoleErrs.slice(0, 5) : '无');
console.log('未捕获异常:', exceptions.length ? exceptions.slice(0, 5) : '无');

ws.close(); ch.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(R.fail ? 1 : 0);
