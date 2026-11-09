/**
 * _mecard.mjs —— 大厅「我的」卡验收
 *   ① Sticky Scroll 吸底 + 封面 150→420 展开
 *   ② 6 家音源账号注册表 + 横向轮播（0/1/2/5/6 项都验）
 *
 * 无头 Chrome + CDP，自己起临时 profile，跑完删掉。端口读 .port，不写死。
 * 所有数字都从页面上真实量：getBoundingClientRect / getComputedStyle / transform 矩阵。
 *
 * 登录态用「注入」造（不改产品代码）：在 accounts.js 执行前给 window.LIZI_ACCOUNTS
 * 装一个 setter，等它赋值时把 6 条的 check/detail 换成假数据；没点名的音源一律
 * 假未登录（这样不会去拉起真的边车进程）。网易云/QQ 真实都是未登录。
 *
 *   node _mecard.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440, VH = 1000;
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
const PROFILE = path.join(os.tmpdir(), 'lg-mecard-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pend = new Map();
let consoleErrs = []; const exceptions = [];
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
const gate = async (cond, tries = 80, ms = 400) => {
  for (let i = 0; i < tries; i++) { if (await ev(cond)) return true; await sleep(ms); }
  return false;
};
const viewport = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const shot = async (name, clip, beyond) => {
  const p = { format: 'png' };
  if (clip) { p.clip = clip; p.captureBeyondViewport = !!beyond; }
  const png = await send('Page.captureScreenshot', p);
  const f = path.join(OUT, name);
  fs.writeFileSync(f, Buffer.from(png.data, 'base64'));
  const st = fs.statSync(f);
  console.log('    →', `shots/review/${name}`, `(${Math.round(st.size / 1024)} KB)`);
};

await send('Page.enable');
await send('Runtime.enable');

/* ================================================================
 * 登录态注入（只在验收脚本里，产品代码不动）
 * ================================================================ */
const MOCK = {
  netease: `{
    check: async () => ({ loggedIn: true, key: '90001', nickname: '夜航西飞', avatar: '', vip: true }),
    detail: async () => {
      const real = await API.userDetail(1);              /* 借官方号的真背景图/头像，不编图片 */
      return {
        nickname: '夜航西飞', avatar: real.profile.avatar, banner: real.profile.background,
        level: 9, vip: true,
        stats: [{ n: 8120, label: '歌单' }, { n: 132, label: '关注' }, { n: 2048, label: '粉丝' }, { n: 35600, label: '听歌' }],
        sign: '在凌晨四点听一张完整的专辑。',
        meta: ['2017 年加入'],
      };
    },
  }`,
  qq: `{
    check: async () => ({ loggedIn: true, key: '10001', nickname: 'LIZI 的 QQ 音乐', avatar: '', vip: false }),
    detail: async () => {
      const real = await API.userDetail(1);
      return { nickname: 'LIZI 的 QQ 音乐', avatar: real.profile.avatar, banner: real.profile.background,
        level: 0, vip: false, stats: [], sign: '', meta: ['UIN 10001'] };
    },
  }`,
  kugou: `{
    check: async () => ({ loggedIn: true, key: '30003', nickname: '酷狗 · 老周', avatar: '', vip: true }),
    detail: async () => {
      const real = await API.userDetail(1);
      return { nickname: '酷狗 · 老周', avatar: real.profile.avatar, banner: real.profile.background,
        level: 0, vip: true, stats: [], sign: '', meta: ['UID 30003'] };
    },
  }`,
  qishui: `{
    check: async () => ({ loggedIn: true, key: '40004', nickname: '汽水 · 小汽', avatar: '', vip: false }),
    detail: async () => {
      const real = await API.userDetail(1);
      return { nickname: '汽水 · 小汽', avatar: real.profile.avatar, banner: real.profile.background,
        level: 0, vip: false, stats: [], sign: '', meta: ['用户 ID 40004'] };
    },
  }`,
  bodian: `{
    check: async () => ({ loggedIn: true, key: '50005', nickname: '波点 · 阿波', avatar: '', vip: false }),
    detail: async () => {
      const real = await API.userDetail(1);
      return { nickname: '波点 · 阿波', avatar: real.profile.avatar, banner: real.profile.background,
        level: 0, vip: false, stats: [], sign: '', meta: ['UID 50005'] };
    },
  }`,
  spotify: `{
    check: async () => ({ loggedIn: true, key: '60006', nickname: 'Spotify · 听友', avatar: '', vip: false }),
    detail: async () => {
      const real = await API.userDetail(1);
      return { nickname: 'Spotify · 听友', avatar: real.profile.avatar, banner: real.profile.background,
        level: 0, vip: false, stats: [], sign: '', meta: ['Spotify premium'] };
    },
  }`,
};
const ALL6 = ['netease', 'qq', 'kugou', 'qishui', 'bodian', 'spotify'];

let mockId = null;
async function setMock(cfg) {
  if (mockId) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: mockId }); mockId = null; }
  const spec = { logins: [], hang: [], seed: null, real: false, keepCache: false, ...(cfg || {}) };
  const patches = spec.logins.map((k) =>
    `if (a.id === '${k}') { const m = ${MOCK[k]}; a.check = m.check; a.detail = m.detail; continue; }`).join('\n');
  const src = `(() => {
    try {
      localStorage.removeItem('lizi.hall.me.platform');
      ${spec.keepCache ? '' : "localStorage.removeItem('lizi.hall.me.cache.v1');"}
    } catch (e) {}
    ${spec.seed ? `try { localStorage.setItem('lizi.hall.me.platform', ${JSON.stringify(spec.seed)}); } catch (e) {}` : ''}
    /* 记录 #view-hall 上 scroll 监听的增删：验「离开大厅要摘掉」 */
    window.__SCROLL = { add: 0, remove: 0 };
    const __add = EventTarget.prototype.addEventListener;
    const __rem = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (t, fn, o) {
      if (t === 'scroll' && this && this.id === 'view-hall') window.__SCROLL.add++;
      return __add.call(this, t, fn, o);
    };
    EventTarget.prototype.removeEventListener = function (t, fn, o) {
      if (t === 'scroll' && this && this.id === 'view-hall') window.__SCROLL.remove++;
      return __rem.call(this, t, fn, o);
    };
    ${spec.real ? '' : `let v = null;
    Object.defineProperty(window, 'LIZI_ACCOUNTS', {
      configurable: true,
      get() { return v; },
      set(arr) {
        const hang = ${JSON.stringify(spec.hang)};
        for (const a of arr) {
          if (hang.indexOf(a.id) >= 0) { a.check = () => new Promise(() => {}); a.detail = async () => null; continue; }
          ${patches}
          a.check = async () => ({ loggedIn: false });
          a.detail = async () => null;
        }
        v = arr;
      },
    });`}
  })();`;
  mockId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: src })).identifier;
}
async function reload(cfg) {
  consoleErrs = []; exceptions.length = 0;
  await setMock(cfg);
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/?t=${Date.now()}` });
}

/* ---------- 读「我的」卡 ---------- */
const meInfo = () => ev(`(() => {
  const q = (s) => document.querySelector('#hall-me ' + s);
  const wrap = q('.me-wrap'), me = q('.me'), track = q('[data-me-track]');
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1) }; };
  const navs = [...document.querySelectorAll('#hall-me [data-me-nav]')];
  const tf = track ? getComputedStyle(track).transform : 'none';
  const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0;
  const sp4 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-4')) || 0;
  return JSON.stringify({
    vh: innerHeight,
    wrap: box(wrap), me: box(me), card: box(q('.me-card')), banner: box(q('.me__banner')),
    ava: box(q('.me__ava')), info: box(q('.me__info')), runway: box(q('.me__runway')),
    coverVar: wrap ? getComputedStyle(wrap).getPropertyValue('--me-cover-h').trim() : '',
    stickyTop: me ? getComputedStyle(me).top : '',
    position: me ? getComputedStyle(me).position : '',
    nav: navs.map((n) => getComputedStyle(n).display),
    tf, tfx: tf === 'none' ? 0 : +(tf.split(',')[4] || 0),
    idx: track ? +(track.dataset.i || 0) : -1,
    platform: me ? (me.dataset.platform || '') : '',
    plTexts: [...document.querySelectorAll('#hall-me .me__pl')].map((e) => e.textContent),
    activePl: (document.querySelector('#hall-me .me__slide.is-on .me__pl') || {}).textContent || '',
    activeName: (document.querySelector('#hall-me .me__slide.is-on .me__name') || {}).textContent || '',
    activePlColor: (() => { const e = document.querySelector('#hall-me .me__slide.is-on .me__pl');
      return e ? getComputedStyle(e).color : ''; })(),
    slides: track ? track.children.length : 0,
    demo: !!q('.me--demo'),
    loginBtn: !!q('.me__act'),
    topbar, sp4, expectTop: topbar + sp4,
    expectCover: +((150 + Math.min(180, Math.max(0, (topbar + sp4) - (wrap ? wrap.getBoundingClientRect().top : 0)))).toFixed(1)),
    hallTop: document.getElementById('view-hall').scrollTop,
    cards: document.querySelectorAll('#hall-me .me-card').length,
  });
})()`);

/* 滚到「我的」卡顶 = pad（rest：不吸底） */
const scrollMeRest = (pad) => ev(`(() => {
  const v = document.getElementById('view-hall');
  const w = document.querySelector('#hall-me .me-wrap');
  if (!v || !w) return -1;
  v.scrollTop = w.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop - ${pad};
  return Math.round(v.scrollTop);
})()`);
/* 再往下滚 extra：extra=0 → 刚好吸住；extra=270 → 封面到顶；extra=370 → 已滚走 100px */
const scrollMePin = (extra) => ev(`(() => {
  const v = document.getElementById('view-hall');
  const w = document.querySelector('#hall-me .me-wrap');
  if (!v || !w) return -1;
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'))
            + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-4'));
  v.scrollTop = w.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop - top + ${extra};
  return Math.round(v.scrollTop);
})()`);
const clipMe = (pad) => ev(`(() => {
  const r = document.querySelector('#hall-me .me-card').getBoundingClientRect();
  return JSON.stringify({ x: Math.max(0, r.left - ${pad}), y: Math.max(0, r.top - ${pad}),
    width: Math.min(innerWidth - Math.max(0, r.left - ${pad}), r.width + ${pad} * 2), height: r.height + ${pad} * 2, scale: 1 });
})()`);
/** 等当前卡的封面/头像背景图真的解码完（截图别拍到一个白圆） */
const waitArt = () => gate(`(() => {
  const els = [...document.querySelectorAll('#hall-me .me__slide.is-on .me__ava, #hall-me .me__slide.is-on .me__banner')];
  if (!els.length) return false;
  window.__ART = window.__ART || new Map();
  let ok = false;
  for (const el of els) {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    const u = bg.replace(/^url\\(/, '').replace(/\\)$/, '').replace(/^["']|["']$/g, '');
    let img = window.__ART.get(u);
    if (!img) { img = new Image(); img.src = u; window.__ART.set(u, img); }
    if (!img.complete || !img.naturalWidth) return false;
    ok = true;
  }
  return ok;
})()`, 80, 300);
const clickNext = async (n, wait = 380) => {
  for (let i = 0; i < n; i++) { await ev(`document.querySelector('#hall-me .me__nav--next').click()`); await sleep(wait); }
};

await viewport(W, VH);
console.log(`\nLIZI 大厅「我的」卡验收  ·  http://127.0.0.1:${APP}/  ·  ${W}×${VH} 无头 Chrome`);

/* ================================================================
 * A. 两个平台 —— 吸底 / 展开 / 轮播基础行为
 * ================================================================ */
console.log('\n[A] 两个平台（netease + qq）');
await reload({ logins: ['netease', 'qq'] });
if (!(await gate(`document.querySelectorAll('#hall-me .me-card').length === 2
  && document.querySelectorAll('#hall-me .me__pl').length === 2`, 90, 400))) {
  console.log('!! 「我的」卡没长出来，先看服务 / console：', consoleErrs.slice(0, 3));
  process.exit(2);
}
await waitArt();
await sleep(400);

/* ---- 1. 初始态（不吸底） ---- */
await scrollMeRest(200);
await sleep(500);
let m = JSON.parse(await meInfo());
console.log(`\n[1] 初始态：卡片高 ${m.me.h}px，封面高 ${m.banner.h}px（变量 ${m.coverVar}），`
  + `头像 top=${m.ava.top} bottom=${m.ava.bottom}，信息行 top=${m.info.top} bottom=${m.info.bottom}，跑道 ${m.runway.h}px`);
const restTop = m.me.top;
ok(1, '初始态：封面 150、头像/信息行可见',
  `卡片 ${m.me.h}px / 封面 ${m.banner.h}px / 头像 ${m.ava.h}px (${m.ava.top}~${m.ava.bottom}, vh ${m.vh})`
  + ` / 信息行 ${m.info.h}px (${m.info.top}~${m.info.bottom}) / 跑道 ${m.runway.h}px`,
  Math.abs(m.banner.h - 150) <= 2 && m.ava.top >= 0 && m.ava.bottom <= m.vh
  && m.info.top >= 0 && m.info.bottom <= m.vh && m.me.h > 250);

await shot('me-1-rest.png', JSON.parse(await clipMe(12)));

/* ---- 2. 滚到中途（吸底中） ---- */
await scrollMePin(100);
await sleep(500);
const mid = JSON.parse(await meInfo());
console.log(`\n[2] 吸底中：卡片 top ${mid.me.top}px（期望 ${mid.expectTop} = 顶栏 ${mid.topbar} + sp4 ${mid.sp4}），`
  + `封面 ${mid.banner.h}px，头像 ${mid.ava.top}~${mid.ava.bottom}（vh ${mid.vh}）`);
ok(2, '中途：贴住顶栏下沿、封面在 150~330、头像仍在视口',
  `top=${mid.me.top}（差 ${Math.abs(mid.me.top - mid.expectTop)}px；顶栏下沿 ${mid.topbar}，留 ${mid.sp4}）`
  + ` / 封面 ${mid.banner.h}px / 头像可见 ${mid.ava.top >= 0 && mid.ava.bottom <= mid.vh}`,
  Math.abs(mid.me.top - mid.expectTop) <= 2 && mid.banner.h > 150 && mid.banner.h < 330
  && mid.ava.top >= 0 && mid.ava.bottom <= mid.vh);
await shot('me-2-sticky-mid.png');

/* ---- 3. 滚到封面尽头 + 再滚 100px 松手 ---- */
await scrollMePin(180);
await sleep(500);
const full = JSON.parse(await meInfo());
await shot('me-3-cover-full.png', null, true);
await scrollMePin(370);
await sleep(500);
const past = JSON.parse(await meInfo());
console.log(`\n[3] 封面尽头：封面 ${full.banner.h}px（卡片 ${full.me.h}px，top ${full.me.top}）；`
  + `再滚 100px → 卡片 top ${past.me.top}px，封面 ${past.banner.h}px`);
ok(3, '封面封顶 330，再滚 100px 解除吸底（top 变负）',
  `封面 ${full.banner.h}px / 松手前 top ${full.me.top}px → 松手后 top ${past.me.top}px / 封面仍 ${past.banner.h}px`,
  Math.abs(full.banner.h - 330) <= 2 && past.me.top < 0 && Math.abs(past.banner.h - 330) <= 2);

/* ---- 4. 反向滚回 ---- */
await scrollMeRest(200);
await sleep(600);
const back = JSON.parse(await meInfo());
console.log(`\n[4] 滚回：封面 ${back.banner.h}px、卡片 ${back.me.h}px、top ${back.me.top}px、跑道 ${back.runway.h}px、变量 ${back.coverVar}`);
ok(4, '反向滚回：状态可逆，封面回到 150',
  `封面 ${back.banner.h}px（初始 150） / 卡片 ${back.me.h}px（初始 ${m.me.h}） / top ${back.me.top}px（初始 ${restTop}）`,
  Math.abs(back.banner.h - 150) <= 2 && Math.abs(back.me.h - m.me.h) <= 2 && Math.abs(back.me.top - restTop) <= 2);

/* ---- 4b. 窗口缩放 ---- */
await scrollMePin(120);
await sleep(400);
await viewport(1280, 900);
await sleep(600);
const rz = JSON.parse(await meInfo());
console.log(`\n[4b] 窗口缩到 1280×900：封面 ${rz.banner.h}px，期望 ${rz.expectCover}px，卡片 top ${rz.me.top}px`);
ok('4b', '窗口缩放后封面高度/吸底不跑偏',
  `封面 ${rz.banner.h}px（按新几何应 ${rz.expectCover}px）/ top ${rz.me.top}px / vh ${rz.vh}`,
  Math.abs(rz.banner.h - rz.expectCover) <= 2);
await viewport(W, VH);
await sleep(500);
await scrollMeRest(200);
await sleep(400);

/* ---- 4c. 快速滚动 ---- */
const fast = JSON.parse(await ev(`(() => {
  const v = document.getElementById('view-hall');
  const w = document.querySelector('#hall-me .me-wrap');
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'))
            + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-4'));
  const base = w.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop - top;
  for (const e of [0, 80, 40, 240, 140]) v.scrollTop = base + e;
  return JSON.stringify({ st: Math.round(v.scrollTop), base: Math.round(base) });
})()`));
await sleep(500);
const fastM = JSON.parse(await meInfo());
console.log(`\n[4c] 快速滚动（一帧内 5 跳）：scrollTop=${fast.st}，封面 ${fastM.banner.h}px，期望 ${fastM.expectCover}px，top ${fastM.me.top}px`);
ok('4c', '快速滚动后状态与最终位置一致（无跳变/无残留）',
  `封面 ${fastM.banner.h}px（应 ${fastM.expectCover}px）/ top ${fastM.me.top}px / 变量 ${fastM.coverVar}`,
  Math.abs(fastM.banner.h - fastM.expectCover) <= 2);
await scrollMeRest(200);
await sleep(400);

/* ---- 5. 底部虚化 ---- */
const blur = JSON.parse(await ev(`(() => {
  const b = document.querySelector('#hall-me .me__banner');
  const a = getComputedStyle(b, '::after');
  return JSON.stringify({
    filter: a.filter, backdrop: a.backdropFilter, height: a.height,
    bg: a.backgroundImage.slice(0, 110),
    radius: (a.backdropFilter.match(/blur\\(([\\d.]+)px\\)/) || [])[1] || '0',
  });
})()`));
const BLUR_BEFORE = 14;                       /* 落地第一版（对齐用户说的「太重」），随后收到 5px */
const BLUR_H0 = 87;                           /* 产品原状：::after height:58% of 150 = 87px，纯白渐变 */
console.log(`\n[5] 虚化：原始 = filter/backdrop 都 none + ${BLUR_H0}px(58%) 白渐变；第一版 blur(${BLUR_BEFORE}px)/88px → 现在 blur(${blur.radius}px)/${blur.height}`);
ok(5, '虚化减弱：blur 半径和覆盖高度都比改之前小',
  `改前 blur(${BLUR_BEFORE}px)/88px（产品原始态没有真 filter，只有 ${BLUR_H0}px 白渐变）→ 现在 computed backdrop-filter=${blur.backdrop}`
  + ` / filter=${blur.filter} / 层高 ${blur.height}（原 ${BLUR_H0}px） / 渐变 ${blur.bg}`,
  +blur.radius > 0 && +blur.radius < BLUR_BEFORE && parseFloat(blur.height) < BLUR_H0);

/* ---- 6. rail 顺序 ---- */
const order = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.hall-rail .hall-cell')].map((s) => {
  const e = s.querySelector('[id]'); return e ? e.id : '';
}))`));
console.log(`\n[6] rail 顺序：${JSON.stringify(order)}`);
ok(6, '.hall-rail 顺序 = 工具箱 → 我的 → 本日推荐 → 精选',
  JSON.stringify(order), JSON.stringify(order) === JSON.stringify(['hall-tools', 'hall-me', 'hall-daily', 'hall-picks']));

/* ---- 7. 两平台轮播 ---- */
const beforeX = m.tfx;
await clickNext(1, 450);
const sw = JSON.parse(await meInfo());
const saved = await ev(`localStorage.getItem('lizi.hall.me.platform')`);
console.log(`\n[7] 轮播：箭头 display=${JSON.stringify(sw.nav)}，平台标 "${m.activePl}" → "${sw.activePl}"（色 ${m.activePlColor} → ${sw.activePlColor}），`
  + `昵称 "${m.activeName}" → "${sw.activeName}"，translateX ${beforeX} → ${sw.tfx}（差 ${Math.abs(sw.tfx - beforeX)}px），记忆=${saved}`);
ok(7, '两个平台：箭头出现、点右箭头切到第二个平台并横向滑动',
  `箭头 ${JSON.stringify(sw.nav)} / 平台标 "${sw.activePl}" / 昵称 "${sw.activeName}" / 矩阵 X ${beforeX} → ${sw.tfx}（Δ${Math.abs(sw.tfx - beforeX)}px）/ localStorage=${saved}`,
  sw.nav.every((d) => d !== 'none') && sw.slides === 2 && sw.activePl === 'QQ 音乐'
  && m.activePl === '网易云' && sw.activeName !== m.activeName
  && Math.abs(sw.tfx - beforeX) > 100 && saved === 'qq');

/* ---- 9. 回归 ---- */
console.log('\n[9] 回归');
const heroInfo = JSON.parse(await ev(`(() => {
  const h = document.getElementById('hall-hero');
  if (!h) return JSON.stringify({ found: false });
  const r = h.getBoundingClientRect();
  return JSON.stringify({ found: true, w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    tab: h.getAttribute('tabindex') });
})()`));
await ev(`document.getElementById('brand').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 30, 200);
const err0 = exceptions.length + consoleErrs.length;
await ev(`document.getElementById('hall-hero').click()`);
await sleep(900);
const afterHero = JSON.parse(await ev(`JSON.stringify({
  hall: document.getElementById('view-hall').classList.contains('is-active'),
  now: document.getElementById('view-now').classList.contains('is-active') })`));
const heroErrs = exceptions.length + consoleErrs.length - err0;
console.log(`    hero：${heroInfo.w}×${heroInfo.h}px tabindex=${heroInfo.tab}，点了之后 hall=${afterHero.hall} now=${afterHero.now}，新增报错 ${heroErrs}`);

await ev(`document.getElementById('brand').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 30, 200);
await gate(`document.querySelectorAll('#hall-tools .hrow').length === 4`, 30, 300);
const sAdd0 = JSON.parse(await ev(`JSON.stringify(window.__SCROLL || {})`));
await ev(`document.querySelectorAll('#hall-tools .hrow')[0].click()`);
const labOk = await gate(`document.getElementById('view-lab').classList.contains('is-active')
  && document.getElementById('lab-pane-dj').classList.contains('is-on')`, 80, 400);
await sleep(300);
const sAdd1 = JSON.parse(await ev(`JSON.stringify(window.__SCROLL || {})`));
await ev(`document.getElementById('brand').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 30, 200);
await sleep(300);
const sAdd2 = JSON.parse(await ev(`JSON.stringify(window.__SCROLL || {})`));
const active = (s) => (s.add || 0) - (s.remove || 0);
console.log(`\n[9b] scroll 监听：#view-hall 上 大厅中 ${active(sAdd0)} 个 → 进实验室 ${active(sAdd1)} 个 → 回大厅 ${active(sAdd2)} 个`
  + `（add/remove：${JSON.stringify(sAdd0)} → ${JSON.stringify(sAdd1)} → ${JSON.stringify(sAdd2)}）`);
ok('9b', '离开大厅时吸底 scroll 监听被摘掉，回来再接上',
  `大厅 ${active(sAdd0)} → 离开 ${active(sAdd1)} → 回来 ${active(sAdd2)}`
  + `（离开少 1 个、回来多 1 个；另 ${Math.max(0, (sAdd0.add || 0) - 1)} 个是别的模块挂的，不动）`,
  active(sAdd1) === active(sAdd0) - 1 && active(sAdd2) === active(sAdd0)
  && (sAdd1.remove - sAdd0.remove) === 1 && (sAdd2.add - sAdd1.add) === 1);

await gate(`document.querySelectorAll('#hall-daily .hrow').length > 0`, 40, 300);
const artistOk = await ev(`(() => {
  const a = document.querySelector('#hall-daily .hrow [data-aid]');
  if (!a) return 'no-link';
  a.click();
  return 'clicked';
})()`);
const artistOpen = artistOk === 'clicked'
  ? await gate(`document.getElementById('view-artist').classList.contains('is-active')
      && !!document.querySelector('#view-artist .pg-name')`, 100, 400) : false;

await ev(`document.getElementById('brand').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 30, 200);
const feed0 = JSON.parse(await ev(`(() => { const v = document.getElementById('view-hall');
  return JSON.stringify({ rows: document.querySelectorAll('#hall-feed .hall-pl').length, top: Math.round(v.scrollTop), sh: v.scrollHeight }); })()`));
await ev(`(() => { const v = document.getElementById('view-hall'); v.scrollTop = v.scrollHeight; return v.scrollTop; })()`);
await sleep(900);
const feed1 = JSON.parse(await ev(`(() => { const v = document.getElementById('view-hall');
  return JSON.stringify({ top: Math.round(v.scrollTop), end: !!document.querySelector('.hall-feed__end'),
    stuck: document.getElementById('topbar').classList.contains('is-stuck') }); })()`));
const errAll = [...exceptions, ...consoleErrs];
console.log(`    实验室=${labOk}；歌手页=${artistOpen}（${artistOk}）；歌单 ${feed0.rows} 张，滚动 ${feed0.top} → ${feed1.top}（内容高 ${feed0.sh}，到底标记=${feed1.end}，顶栏收缩=${feed1.stuck}）；console error=${errAll.length}${errAll.length ? ' :: ' + errAll.slice(0, 3).join(' | ') : ''}`);
ok(9, '回归：hero 能点、实验室/歌手页能开、歌单仍能滚、0 console error',
  `hero ${heroInfo.w}×${heroInfo.h}（点击后 now=${afterHero.now} hall=${afterHero.hall}，新增报错 ${heroErrs}）/ lab=${labOk}`
  + ` / artist=${artistOpen} / feed ${feed0.rows} 张且滚到 ${feed1.top} / stuck=${feed1.stuck} / errors=${errAll.length}`,
  heroInfo.found && heroInfo.h > 200 && heroErrs === 0 && labOk && artistOpen
  && feed0.rows > 0 && feed1.top > feed0.top && errAll.length === 0);

/* ================================================================
 * D. 6 家全部登录 —— 轮播 6 项 / 箭头 / 连点 6 次回第 1 项
 * ================================================================ */
console.log('\n[D] 6 家全部 mock 成已登录');
await reload({ logins: ALL6 });
if (!(await gate(`document.querySelectorAll('#hall-me .me-card').length === 6
  && document.querySelectorAll('#hall-me .me__pl').length === 6`, 100, 400))) {
  console.log('!! 6 平台轮播没长出来：', consoleErrs.slice(0, 3));
}
await waitArt();
await sleep(400);
const six = JSON.parse(await meInfo());
console.log(`    slides=${six.slides}，平台标记=${JSON.stringify(six.plTexts)}，箭头=${JSON.stringify(six.nav)}，起始第 ${six.idx + 1} 项「${six.activePl}」`);
const dErr0 = exceptions.length + consoleErrs.length;
await clickNext(2, 420);                     // 切到第 3 项（酷狗）
const third = JSON.parse(await meInfo());
await waitArt();
await shot('me-4-carousel.png');
await clickNext(4, 420);                     // 再点 4 次 = 共 6 次 → 回到第 1 项
const wrap6 = JSON.parse(await meInfo());
const dErr = exceptions.length + consoleErrs.length - dErr0;
console.log(`    点 2 次 → 第 ${third.idx + 1} 项「${third.activePl}」，translateX ${third.tfx}；`
  + `再点 4 次（共 6）→ 第 ${wrap6.idx + 1} 项「${wrap6.activePl}」，translateX ${wrap6.tfx}，新增报错 ${dErr}`);
ok('10a', '6 家全登录：轮播 6 项、箭头可用、连点 6 次不崩且回到第 1 项',
  `slides=${six.slides} / 平台标 ${JSON.stringify(six.plTexts)} / 箭头 ${JSON.stringify(six.nav)}`
  + ` / 2 次后第 ${third.idx + 1} 项「${third.activePl}」(X=${third.tfx})`
  + ` / 6 次后第 ${wrap6.idx + 1} 项「${wrap6.activePl}」(X=${wrap6.tfx}) / 新增报错 ${dErr}`,
  six.slides === 6 && six.nav.every((d) => d !== 'none')
  && third.idx === 2 && third.activePl === '酷狗'
  && wrap6.idx === 0 && wrap6.tfx === 0 && wrap6.activePl === '网易云' && dErr === 0);

/* ---- 10b. 记住的是 id：种 bobian，重进直接到「波点」（第 5 项） ---- */
await reload({ logins: ALL6, seed: 'bodian' });
if (!(await gate(`document.querySelectorAll('#hall-me .me-card').length === 6`, 100, 400))) {
  console.log('!! 10b 6 平台没长出来：', consoleErrs.slice(0, 3));
}
await sleep(500);
const seeded = JSON.parse(await meInfo());
const seededLS = await ev(`localStorage.getItem('lizi.hall.me.platform')`);
console.log(`\n[10b] localStorage['lizi.hall.me.platform']=${seededLS} → 第 ${seeded.idx + 1} 项「${seeded.activePl}」，translateX ${seeded.tfx}`);
ok('10b', '记住上次平台用 id（不是索引）：种 bobian → 直接落在第 5 项「波点」',
  `localStorage=${seededLS} / idx=${seeded.idx} / active=${seeded.activePl} / X=${seeded.tfx}`,
  seededLS === 'bodian' && seeded.idx === 4 && seeded.activePl === '波点' && seeded.tfx === -4 * seeded.card.w);

/* ---- 10c. 缓存：6 张卡已缓存 + 6 家状态全挂起 → 首帧仍然 6 张 ---- */
await reload({ logins: ALL6, hang: ALL6, keepCache: true });
await sleep(700);
const cached = JSON.parse(await meInfo());
console.log(`\n[10c] 状态全挂起 + 有缓存：700ms 时 slides=${cached.slides}，箭头=${JSON.stringify(cached.nav)}（状态检查一个都没回来）`);
ok('10c', '首屏不被状态检查拖住：有缓存时 700ms 内就画出 6 张',
  `slides=${cached.slides} / 箭头 ${JSON.stringify(cached.nav)} / 卡片来源=localStorage 缓存`,
  cached.slides === 6 && cached.nav.every((d) => d !== 'none'));

/* ---- 10d. 第 3 项（酷狗）登录态失效 → 从轮播消失、索引纠正、箭头仍正常 ---- */
await reload({ logins: ['netease', 'qq', 'qishui', 'bodian', 'spotify'], seed: 'kugou' });
if (!(await gate(`document.querySelectorAll('#hall-me .me__pl').length === 5`, 100, 400))) {
  console.log('!! 10d 5 平台没长出来：', consoleErrs.slice(0, 3));
}
await sleep(500);
const removed = JSON.parse(await meInfo());
console.log(`\n[10d] 第 3 项 kugou 失效（种过 kugou）→ slides=${removed.slides}，平台标=${JSON.stringify(removed.plTexts)}，`
  + `落在第 ${removed.idx + 1} 项「${removed.activePl}」，箭头=${JSON.stringify(removed.nav)}`);
ok('10d', '当前平台登录态失效：该项消失、索引自动纠正、箭头仍正常',
  `slides=${removed.slides} / 标 ${JSON.stringify(removed.plTexts)} / idx=${removed.idx} / active=${removed.activePl}`
  + ` / 箭头 ${JSON.stringify(removed.nav)}`,
  removed.slides === 5 && !removed.plTexts.includes('酷狗')
  && removed.idx === 0 && removed.activePl === '网易云'
  && removed.nav.every((d) => d !== 'none'));

/* ---- 10e. 一家卡死 → 8s 超时只摘它自己；期间卡片不是空的 ---- */
const t0 = Date.now();
await reload({ logins: ['netease', 'qq', 'kugou', 'bodian', 'spotify'], hang: ['qishui'] });
await sleep(1500);
const early = JSON.parse(await ev(`JSON.stringify({
  cards: document.querySelectorAll('#hall-me .me-card').length,
  name: (document.querySelector('#hall-me .me__name') || {}).textContent || '',
  skeleton: !!document.querySelector('#hall-me .me--loading') })`));
const has5 = await gate(`document.querySelectorAll('#hall-me .me__pl').length === 5`, 60, 300);
const tLoad = Date.now() - t0;
const timeouted = JSON.parse(await meInfo());
console.log(`\n[10e] 汽水 check 永不返回：1.5s 时已有卡（${early.cards} 张，名字「${early.name}」，骨架=${early.skeleton}）；`
  + `${(tLoad / 1000).toFixed(1)}s 后落在 ${timeouted.slides} 项，汽水在轮播里=${timeouted.plTexts.includes('汽水')}`);
ok('10e', '单家卡死只摘它自己（8s 超时），期间首屏已有卡',
  `1.5s：${early.cards} 张卡「${early.name}」 / ${(tLoad / 1000).toFixed(1)}s：${timeouted.slides} 项`
  + ` / 汽水在=${timeouted.plTexts.includes('汽水')} / 箭头 ${JSON.stringify(timeouted.nav)}`,
  early.cards >= 1 && !!early.name && has5 && timeouted.slides === 5
  && !timeouted.plTexts.includes('汽水') && tLoad >= 7800 && tLoad <= 13000
  && exceptions.length === 0 && consoleErrs.length === 0);

/* ================================================================
 * B. 只有一个平台 —— 箭头必须 display:none
 * ================================================================ */
console.log('\n[B] 只有一个平台');
await reload({ logins: ['netease'] });
if (!(await gate(`document.querySelectorAll('#hall-me .me-card').length === 1
  && !!document.querySelector('#hall-me .me__pl')`, 90, 400))) {
  console.log('!! 单平台卡没长出来：', consoleErrs.slice(0, 3));
}
await sleep(400);
const one = JSON.parse(await meInfo());
await scrollMeRest(200);
await sleep(400);
console.log(`    slides=${one.slides} 箭头=${JSON.stringify(one.nav)} 平台标=${JSON.stringify(one.plTexts)}`);
ok('8a', '只有一个平台：箭头 display:none',
  `slides=${one.slides} / 箭头 ${JSON.stringify(one.nav)} / 平台标 ${JSON.stringify(one.plTexts)}`,
  one.slides === 1 && one.nav.length === 2 && one.nav.every((d) => d === 'none'));

/* ================================================================
 * C. 零平台（真实未登录）—— 示例卡 + 箭头 none + 注册表字段归一化
 * ================================================================ */
console.log('\n[C] 零平台（真实未登录）');
await reload({ real: true });
if (!(await gate(`!!document.querySelector('#hall-me .me--demo')`, 100, 400))) {
  console.log('!! 示例卡没出来：', consoleErrs.slice(0, 3));
}
await sleep(500);
await scrollMeRest(200);
await sleep(500);
const zero = JSON.parse(await meInfo());
await waitArt();
await shot('me-5-blur-after.png', JSON.parse(await clipMe(12)));
console.log(`    示例卡=${zero.demo} 登录按钮=${zero.loginBtn} 箭头=${JSON.stringify(zero.nav)} 平台标=${zero.plTexts.length} 封面 ${zero.banner.h}px`);
ok('8b', '零平台：保持示例卡，箭头 display:none',
  `demo=${zero.demo} / 登录按钮=${zero.loginBtn} / 箭头 ${JSON.stringify(zero.nav)} / 平台标 ${zero.plTexts.length} 个 / 封面 ${zero.banner.h}px`,
  zero.demo && zero.loginBtn && zero.nav.length === 2 && zero.nav.every((d) => d === 'none')
  && zero.plTexts.length === 0);

/* ---- 10f. 注册表把边车字段归一化对了（spotify error 排除、userId/uid 兼容） ---- */
const unit = JSON.parse(await ev(`(async () => {
  const orig = window.fetch;
  const out = {};
  const stub = (key, body) => {
    window.fetch = (u, o) => (String(u).includes(key)
      ? Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
      : orig(u, o));
  };
  try {
    stub('/api/spotify/status', { code: 200, loggedIn: true, nickname: 'S', error: '缺少 SPOTIFY_CLIENT_ID' });
    out.spotify = (await window.LIZI_ACCOUNTS.find((a) => a.id === 'spotify').check()).loggedIn;
    stub('/api/qishui/status', { code: 200, loggedIn: true, nickname: '汽水用户', userId: '42', vip: true });
    const qs = window.LIZI_ACCOUNTS.find((a) => a.id === 'qishui');
    const st = await qs.check();
    const d = await qs.detail(st.key);
    out.qishui = { key: st.key, vip: st.vip, nick: d && d.nickname, meta: d && d.meta, stats: d ? d.stats.length : -1 };
    stub('/api/bodian/status', { code: 200, loggedIn: true, nickname: '', avatar: '', uid: '77' });
    const bd = window.LIZI_ACCOUNTS.find((a) => a.id === 'bodian');
    out.bodian = { key: (await bd.check()).key };
  } finally { window.fetch = orig; }
  return JSON.stringify(out);
})()`));
console.log(`\n[10f] 注册表归一化：spotify(error)=${unit.spotify} / qishui key=${unit.qishui.key} vip=${unit.qishui.vip} meta=${JSON.stringify(unit.qishui.meta)} stats=${unit.qishui.stats} / bodian key=${unit.bodian.key}`);
ok('10f', '注册表：spotify 带 error 不进轮播；qishui 的 userId、bodian 的 uid 都能归一化成 key',
  `spotify.loggedIn=${unit.spotify} / qishui.key=${unit.qishui.key} (vip=${unit.qishui.vip}, meta=${JSON.stringify(unit.qishui.meta)}, stats=${unit.qishui.stats})`
  + ` / bodian.key=${unit.bodian.key}`,
  unit.spotify === false && unit.qishui.key === '42' && unit.qishui.vip === true
  && unit.qishui.stats === 0 && JSON.stringify(unit.qishui.meta) === '["用户 ID 42"]'
  && unit.bodian.key === '77');

/* ================================================================
 * 汇总
 * ================================================================ */
console.log('\n============ 汇总 ============');
for (const r of R.rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${String(r.n).padStart(3)}] ${r.name}`);
const main = R.rows.filter((r) => typeof r.n === 'number');
const extra = R.rows.filter((r) => typeof r.n !== 'number');
console.log(`\n主项：通过 ${main.filter((r) => r.pass).length} / ${main.length}；附加：通过 ${extra.filter((r) => r.pass).length} / ${extra.length}`);
if (R.fail) console.log('失败项：', R.rows.filter((r) => !r.pass).map((r) => r.n).join(','));
console.log('console error:', consoleErrs.length ? consoleErrs.slice(0, 5) : '无');

ws.close(); ch.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(R.fail ? 1 : 0);
