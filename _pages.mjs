/**
 * _pages.mjs —— 歌手页 / 专辑页验收（9 条）
 *
 * 只用无头 Chrome + CDP；自己起临时 profile，跑完删掉。端口从 .port 读，不写死。
 * 真实数字全部从页面上量：DOM 文本、img.naturalWidth、getBoundingClientRect、
 * 以及播放器那条 Web Audio 链上的 analyser（时间域 RMS）。
 *
 *   node _pages.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440;
const OUT = path.join(HERE, 'shots', 'review');
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
const PROFILE = path.join(os.tmpdir(), 'lg-pages-' + Date.now());
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
const viewport = (h) => send('Emulation.setDeviceMetricsOverride', { width: W, height: h, deviceScaleFactor: 1, mobile: false });
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, Buffer.from(png.data, 'base64'));
  const st = fs.statSync(p);
  console.log('    →', `shots/review/${name}`, `(${Math.round(st.size / 1024)} KB)`);
};
const scrollView = (sel, top) => ev(`(() => {
  const v = document.querySelector(${JSON.stringify(sel)});
  if (!v) return -1;
  v.scrollTop = ${top};
  return Math.round(v.scrollTop);
})()`);
const scrollToSel = (viewSel, sel, pad = 76) => ev(`(() => {
  const v = document.querySelector(${JSON.stringify(viewSel)});
  const t = document.querySelector(${JSON.stringify(sel)});
  if (!v || !t) return -1;
  v.scrollTop = t.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop - ${pad};
  return Math.round(v.scrollTop);
})()`);

await send('Page.enable');
await send('Runtime.enable');
/* 挂钩 createAnalyser：播放器的节拍器只建一个 2048 的 analyser，
   量 RMS 就用它（不碰应用代码，也不重开 Web Audio 图）。 */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const orig = AC.prototype.createAnalyser;
    window.__ANS = [];
    AC.prototype.createAnalyser = function () {
      const n = orig.apply(this, arguments);
      window.__ANS.push(n);
      return n;
    };
  })();`,
});
await viewport(1000);
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });

console.log(`\nLIZI 歌手页 / 专辑页验收  ·  http://127.0.0.1:${APP}/  ·  ${W}px 宽无头 Chrome`);

/* ================================================================
 * 0. 入口：搜索「周杰伦」→ 点结果里的艺人名
 * ================================================================ */
console.log('\n[0] 入口（搜索结果里的艺人名 → 歌手页）');
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 80, 500))) {
  console.log('!! 大厅没起来，先看服务'); process.exit(2);
}
await ev(`(() => {
  const s = document.getElementById('search');
  s.value = '周杰伦';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
await gate(`document.getElementById('view-browse').classList.contains('is-active')
  && document.querySelectorAll('#tracks .track').length > 0`, 80, 400);
const entry = JSON.parse(await ev(`(() => {
  const links = [...document.querySelectorAll('#tracks .track__sub [data-aid]')];
  const hit = links.find((a) => a.dataset.aid === '6452') || links[0];
  if (!hit) return JSON.stringify({ found: false });
  return JSON.stringify({ found: true, aid: hit.dataset.aid, text: hit.textContent,
    rows: document.querySelectorAll('#tracks .track').length,
    links: links.length });
})()`));
console.log(`    搜索结果 ${entry.rows} 行，艺人入口 ${entry.links} 个，命中「${entry.text}」id=${entry.aid}`);
await ev(`(() => {
  const links = [...document.querySelectorAll('#tracks .track__sub [data-aid]')];
  const hit = links.find((a) => a.dataset.aid === '6452') || links[0];
  if (hit) hit.click();
  return !!hit;
})()`);
const opened = await gate(`document.getElementById('view-artist').classList.contains('is-active')
  && document.querySelectorAll('#view-artist .pg-album').length > 0`, 80, 400);
ok(0, '搜索结果里的艺人名可点 → 歌手页', `点了「${entry.text}」→ 歌手页 ${opened ? '已打开' : '没打开'}`
  + `（栈 ${JSON.stringify(await ev('window.__LIZI_PAGES ? window.__LIZI_PAGES.stack() : []'))}）`, opened);

/* ================================================================
 * 1. 歌手页头部：名字 / 统计行 / 头像
 * ================================================================ */
console.log('\n[1] 歌手页头部');
/* 头像走 /api/img 代理，等它真的解码完再量 naturalWidth */
await gate(`(() => {
  const i = document.querySelector('#view-artist .pg-ava img');
  return i && i.complete && i.naturalWidth > 0;
})()`, 60, 300);
const head = JSON.parse(await ev(`(() => {
  const q = (s) => document.querySelector('#view-artist ' + s);
  const img = q('.pg-ava img');
  const box = q('.pg-ava');
  const r = box ? box.getBoundingClientRect() : { width: 0 };
  return JSON.stringify({
    name: q('.pg-name') && q('.pg-name').textContent.trim(),
    counts: q('.pg-counts') && q('.pg-counts').textContent.trim(),
    avaW: img ? img.naturalWidth : 0,
    avaH: img ? img.naturalHeight : 0,
    box: Math.round(r.width),
    brief: !!q('.pg-brief'),
    briefLen: q('.pg-brief') ? q('.pg-brief').textContent.length : 0,
    briefClamp: q('.pg-brief') ? getComputedStyle(q('.pg-brief')).webkitLineClamp : '',
  });
})()`));
console.log(`    名字「${head.name}」· 统计「${head.counts}」· 头像 ${head.avaW}×${head.avaH}（框 ${head.box}px）· 简介 ${head.briefLen} 字（-webkit-line-clamp:${head.briefClamp}）`);
ok(1, '歌手页：名字 / 45 张专辑 · 582 首歌 / 头像 naturalWidth > 80',
  `name=${head.name} counts="${head.counts}" avatar.naturalWidth=${head.avaW} 框=${head.box}px 简介 clamp=${head.briefClamp}`,
  head.name === '周杰伦' && /45 张专辑 · 582 首歌/.test(head.counts) && head.avaW > 80);

/* ================================================================
 * 2. 热门 10 行；点第一行真的出声（analyser maxRMS）
 * ================================================================ */
console.log('\n[2] 热门 Top 10 + 起播');
const hot = JSON.parse(await ev(`(() => {
  const rows = [...document.querySelectorAll('#view-artist [data-hots] .pg-row')];
  return JSON.stringify({ n: rows.length, firstId: rows[0] && rows[0].dataset.id,
    first: rows[0] && rows[0].querySelector('.pg-row__n').textContent.trim(),
    dur: rows[0] && rows[0].querySelector('.pg-row__d').textContent.trim(),
    allHaveDur: rows.every((r) => /^\\d+:\\d{2}$/.test(r.querySelector('.pg-row__d').textContent.trim())) });
})()`));
await ev(`(() => { const r = document.querySelector('#view-artist [data-hots] .pg-row'); if (r) r.click(); return !!r; })()`);
await gate(`typeof Player !== 'undefined' && Player.audio && Player.audio.currentTime > 0.25`, 80, 300);
const rms = JSON.parse(await ev(`(async () => {
  const buf = new Float32Array(2048);
  let max = 0, n = 0, ctxState = '', demo = false, cur = null;
  const t0 = performance.now();
  while (performance.now() - t0 < 3200) {
    await new Promise((r) => setTimeout(r, 80));
    const ans = (window.__ANS || []).filter((a) => a.fftSize === 2048 && a.context.state === 'running');
    if (!ans.length) continue;
    const an = ans[0];
    ctxState = an.context.state;
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const v = Math.sqrt(s / buf.length);
    if (v > max) max = v;
    n++;
  }
  const st = Player.state;
  const tr = st.queue[st.index] || null;
  const badge = document.getElementById('badge');
  return JSON.stringify({ max: +max.toFixed(4), frames: n, ctxState,
    analysers: (window.__ANS || []).length,
    playing: !Player.audio.paused, cur: +Player.audio.currentTime.toFixed(2),
    src: String(Player.audio.currentSrc || '').slice(0, 12),
    badge: badge && !badge.hidden ? badge.textContent.trim() : '',
    title: tr && tr.name, id: tr && tr.id });
})()`));
console.log(`    热门 ${hot.n} 行，首行「${hot.first}」${hot.dur} id=${hot.firstId}`);
console.log(`    起播：${rms.title}（id=${rms.id}）playing=${rms.playing} t=${rms.cur}s 源=${rms.src} 徽标「${rms.badge}」ctx=${rms.ctxState} analyser=${rms.analysers} 帧数=${rms.frames} maxRMS=${rms.max}`);
ok(2, '热门 = 10 行；点第一行能起播（analyser maxRMS > 0.02）',
  `rows=${hot.n} 首行「${hot.first}」${hot.dur} → 起播「${rms.title}」maxRMS=${rms.max}（${rms.frames} 帧 / ctx ${rms.ctxState} / 源 ${rms.src}${rms.badge ? ' / ' + rms.badge : ''}）`,
  hot.n === 10 && hot.allHaveDur && rms.max > 0.02 && rms.playing);

/* ================================================================
 * 3. 专辑墙：首批 12 张 → 加载更多 24 张，每张封面都真加载
 * ================================================================ */
console.log('\n[3] 专辑墙 12 → 24');
await scrollToSel('#view-artist', '#view-artist .pg-albums', 90);
await gate(`[...document.querySelectorAll('#view-artist .pg-album img')].every((i) => i.naturalWidth > 0)`, 60, 300);
const alb12 = JSON.parse(await ev(`(() => {
  const cards = [...document.querySelectorAll('#view-artist .pg-album')];
  const imgs = cards.map((c) => c.querySelector('img')).filter(Boolean);
  return JSON.stringify({ n: cards.length, imgs: imgs.length,
    loaded: imgs.filter((i) => i.naturalWidth > 0).length,
    first: cards[0] && cards[0].querySelector('.pg-album__name').textContent.trim(),
    firstId: cards[0] && cards[0].dataset.alb,
    meta: cards[0] && cards[0].querySelector('.pg-album__meta').textContent.trim(),
    size: imgs[0] ? imgs[0].naturalWidth + 'x' + imgs[0].naturalHeight : '',
    more: !!document.querySelector('#view-artist [data-more-albums]:not([hidden])') });
})()`));
await ev(`document.querySelector('#view-artist [data-more-albums]').click()`);
await gate(`document.querySelectorAll('#view-artist .pg-album').length >= 24`, 60, 300);
await gate(`[...document.querySelectorAll('#view-artist .pg-album img')].every((i) => i.naturalWidth > 0)`, 80, 300);
const alb24 = JSON.parse(await ev(`(() => {
  const cards = [...document.querySelectorAll('#view-artist .pg-album')];
  const imgs = cards.map((c) => c.querySelector('img')).filter(Boolean);
  const sizes = imgs.map((i) => i.naturalWidth);
  return JSON.stringify({ n: cards.length, imgs: imgs.length,
    loaded: imgs.filter((i) => i.naturalWidth > 0).length,
    minW: Math.min(...sizes), maxW: Math.max(...sizes),
    countText: (document.querySelector('#view-artist [data-album-count]') || {}).textContent });
})()`));
console.log(`    首批 ${alb12.n} 张（封面已加载 ${alb12.loaded}/${alb12.imgs}，首张 ${alb12.first} ${alb12.meta}，${alb12.size}）→ 加载更多后 ${alb24.n} 张（已加载 ${alb24.loaded}/${alb24.imgs}，naturalWidth ${alb24.minW}~${alb24.maxW}，计数「${alb24.countText}」）`);
ok(3, '专辑墙首批 12 张 → 点「加载更多」24 张；每张 img.naturalWidth > 0',
  `12→${alb12.n} / 24→${alb24.n}；封面加载 ${alb12.loaded}/${alb12.imgs} → ${alb24.loaded}/${alb24.imgs}（naturalWidth ${alb24.minW}~${alb24.maxW}）`,
  alb12.n === 12 && alb24.n === 24 && alb12.loaded === 12 && alb24.loaded === 24 && alb24.minW > 0);

/* ================================================================
 * 4. 点第一张专辑 → 专辑页：380 大封面 / 曲目行 0 张图
 * ================================================================ */
console.log('\n[4] 点第一张专辑 → 专辑页');
await ev(`document.querySelector('#view-artist .pg-album').click()`);
const albumReady = await gate(`document.getElementById('view-album').classList.contains('is-active')
  && document.querySelectorAll('#view-album [data-tracks] .pg-row').length > 0`, 80, 400);
await gate(`(() => { const i = document.querySelector('#view-album .pg-album-art img'); return i && i.naturalWidth > 0; })()`, 60, 300);
const av = JSON.parse(await ev(`(() => {
  const img = document.querySelector('#view-album .pg-album-art img');
  const r = img ? img.getBoundingClientRect() : { width: 0 };
  const art = document.querySelector('#view-album .pg-album-art');
  const ar = art ? art.getBoundingClientRect() : { width: 0, height: 0 };
  const rowImgs = document.querySelectorAll('#view-album [data-tracks] img, #view-album .pg-tbl img');
  return JSON.stringify({
    w: Math.round(r.width), artW: Math.round(ar.width), artH: Math.round(ar.height),
    nw: img ? img.naturalWidth : 0,
    rowImgs: rowImgs.length,
    pageImgs: document.querySelectorAll('#view-album img').length,
    name: (document.querySelector('#view-album .pg-album-name') || {}).textContent,
    artist: (document.querySelector('#view-album .pg-album-artist') || {}).textContent,
    rows: document.querySelectorAll('#view-album [data-tracks] .pg-row').length,
  });
})()`));
console.log(`    「${av.name}」/ ${av.artist}：大封面 ${av.w}px（框 ${av.artW}×${av.artH}，naturalWidth ${av.nw}）· 曲目 ${av.rows} 行 · 曲目行 img=${av.rowImgs} · 整页 img=${av.pageImgs}`);
ok(4, '专辑页：大封面 380±10 / naturalWidth > 200 / 曲目行 img = 0',
  `封面 ${av.w}px（380±10）naturalWidth=${av.nw} 页内 img=${av.pageImgs} 曲目行 img=${av.rowImgs}`,
  Math.abs(av.w - 380) <= 10 && av.nw > 200 && av.rowImgs === 0 && av.pageImgs === 1 && albumReady);

/* ================================================================
 * 5. 专辑页信息：发行日期 / 公司 / 曲目数 / 总时长
 * ================================================================ */
console.log('\n[5] 专辑信息块');
const meta = JSON.parse(await ev(`(() => {
  const q = (k) => { const e = document.querySelector('#view-album [data-meta="' + k + '"]'); return e ? e.textContent.trim() : ''; };
  const dt = [...document.querySelectorAll('#view-album .pg-meta dt')].map((e) => e.textContent.trim());
  const dd = [...document.querySelectorAll('#view-album .pg-meta dd')].map((e) => e.textContent.trim());
  return JSON.stringify({ date: q('date'), company: q('company'), count: q('count'),
    labels: dt, values: dd,
    trackCount: (document.querySelector('#view-album [data-track-count]') || {}).textContent,
    desc: !!document.querySelector('#view-album [data-desc]'),
    descClamp: document.querySelector('#view-album [data-desc]') ? getComputedStyle(document.querySelector('#view-album [data-desc]')).webkitLineClamp : '',
    hasPlayAll: !!document.querySelector('#view-album [data-playall]') });
})()`));
/* 太阳之子 在网易云那边 company 是空的（不是我们没渲染），
   所以再开一张**有公司**的（天台 电影原声带 2489195）确认这个字段能出真值 */
await ev(`(() => { const b = document.querySelector('#view-album [data-meta="company"]'); return !!b; })()`);
const companyReal = await (async () => {
  await ev(`(async () => { await window.__LIZI_PAGES.openAlbum(2489195); return 1; })()`).catch(() => null);
  await gate(`(() => { const e = document.querySelector('#view-album .pg-album-name'); return e && e.textContent.includes('天台'); })()`, 60, 300);
  const c = JSON.parse(await ev(`(() => {
    const q = (k) => { const e = document.querySelector('#view-album [data-meta="' + k + '"]'); return e ? e.textContent.trim() : ''; };
    return JSON.stringify({ name: (document.querySelector('#view-album .pg-album-name') || {}).textContent,
      date: q('date'), company: q('company'), count: q('count') });
  })()`));
  return c;
})();
console.log(`    第一张「太阳之子」：发行 ${meta.date} · 公司 ${meta.company}（网易云这条本来就没给）· ${meta.count}`);
console.log(`    标签 ${JSON.stringify(meta.labels)}；值 ${JSON.stringify(meta.values)}；简介 3 行 clamp=${meta.descClamp}；播放全部=${meta.hasPlayAll}`);
console.log(`    换一张「${companyReal.name}」：发行 ${companyReal.date} · 公司 ${companyReal.company} · ${companyReal.count}`);
const metaPass = meta.labels.join('/') === '发行日期/公司/曲目' && meta.values.length === 3
  && /^\d{4}-\d{2}-\d{2}$/.test(meta.date) && /\d+ 首 · \d+ 分/.test(meta.count)
  && meta.company.length > 0 && companyReal.company && companyReal.company !== '—';
ok(5, '专辑页显示 发行日期 / 公司 / 曲目数 + 总时长',
  `太阳之子：${meta.date} / ${meta.company}（上游缺）/ ${meta.count}；天台 电影原声带：${companyReal.date} / ${companyReal.company} / ${companyReal.count}`,
  metaPass);

/* ================================================================
 * 6. 专辑页点艺人名 → 歌手页；返回键沿访问栈逐级回退
 * ================================================================ */
console.log('\n[6] 艺人名入口 + 访问栈');
const stackNow = () => ev('JSON.stringify(window.__LIZI_PAGES.stack())');
/* 从「天台」那张点艺人名回歌手页（栈里已有 6452 → 截断回退，不重复入栈） */
await ev(`document.querySelector('#view-album .pg-album-artist [data-aid]').click()`);
const backToArtist = await gate(`document.getElementById('view-artist').classList.contains('is-active')`, 40, 300);
const afterArtist = JSON.parse(await ev(`(() => JSON.stringify({
  name: (document.querySelector('#view-artist .pg-name') || {}).textContent,
  stack: window.__LIZI_PAGES.stack(),
  albums: document.querySelectorAll('#view-artist .pg-album').length,
}))()`));
console.log(`    点艺人名 → 歌手页「${afterArtist.name}」栈=${JSON.stringify(afterArtist.stack)}（专辑墙 ${afterArtist.albums} 张，没重拉成 12）`);
/* 再点第一张专辑进专辑页，然后一路返回：专辑 → 歌手 → 来源页 → 大厅 */
await ev(`document.querySelector('#view-artist .pg-album').click()`);
await gate(`document.getElementById('view-album').classList.contains('is-active')`, 40, 300);
const s2 = JSON.parse(await stackNow());
await ev(`document.getElementById('btn-settings').click()`);
const b1 = await gate(`document.getElementById('view-artist').classList.contains('is-active')`, 40, 300);
const s3 = JSON.parse(await stackNow());
await ev(`document.getElementById('btn-settings').click()`);
const b2 = await gate(`document.getElementById('view-browse').classList.contains('is-active')`, 40, 300);
const s4 = JSON.parse(await stackNow());
const srcView = await ev(`document.body.dataset.view`);
await ev(`document.getElementById('btn-settings').click()`);
const b3 = await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 300);
const topLeft = await ev(`(document.querySelector('.topbar__left') || {}).classList.contains('is-back')`);
const s5 = JSON.parse(await stackNow());
console.log(`    栈变化：进专辑 ${JSON.stringify(s2)} → 返回上一步 ${b1 ? '歌手页' : '失败'} ${JSON.stringify(s3)}`
  + ` → ${b2 ? '来源页(' + srcView + ')' : '失败'} ${JSON.stringify(s4)} → ${b3 ? '大厅' : '失败'}（顶栏左键回到齿轮=${!topLeft}）`);
ok(6, '专辑页点艺人名回歌手页；返回键 专辑 → 歌手 → 来源页 → 大厅（栈正确）',
  `艺人名→歌手「${afterArtist.name}」栈=${JSON.stringify(afterArtist.stack)}；返回链 ${b1}/${b2}/${b3}，来源页=${srcView}，末栈=${JSON.stringify(s5)}`,
  backToArtist && afterArtist.name === '周杰伦' && afterArtist.stack.length === 1
  && afterArtist.albums >= 12
  && s2.length === 2 && b1 && s3.length === 1 && b2 && s4.length === 0 && srcView === 'browse'
  && b3 && topLeft === false);

/* ================================================================
 * 7. 全部歌曲：搜索框只过滤已加载；排序切「时间」首行变
 * ================================================================ */
console.log('\n[7] 全部歌曲：搜索过滤 + 排序切换');
await ev(`(async () => { await window.__LIZI_PAGES.openArtist(6452); return 1; })()`);
await gate(`document.querySelectorAll('#view-artist [data-songs] .pg-row').length >= 100`, 60, 400);
const songsHot = JSON.parse(await ev(`(() => {
  const rows = [...document.querySelectorAll('#view-artist [data-songs] .pg-row')];
  return JSON.stringify({ n: rows.length, firstId: rows[0].dataset.id,
    first: rows[0].querySelector('.pg-row__n').textContent.trim(),
    count: (document.querySelector('#view-artist [data-song-count]') || {}).textContent,
    more: !!document.querySelector('#view-artist [data-more-songs]:not([hidden])') });
})()`));
/* 搜索「屋顶」：只在已加载的集合里过滤，不发请求 */
await ev(`(() => {
  const inp = document.querySelector('#view-artist [data-filter]');
  inp.value = '屋顶';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
await sleep(250);
const filtered = JSON.parse(await ev(`(() => {
  const rows = [...document.querySelectorAll('#view-artist [data-songs] .pg-row')];
  const names = rows.map((r) => r.querySelector('.pg-row__n').textContent.trim());
  return JSON.stringify({ n: rows.length, names: names.slice(0, 5),
    matched: names.every((x) => x.includes('屋顶')),
    count: (document.querySelector('#view-artist [data-song-count]') || {}).textContent });
})()`));
/* 清空搜索词，再切排序：首行 id 必须跟「热度」不一样 */
await ev(`(() => {
  const inp = document.querySelector('#view-artist [data-filter]');
  inp.value = '';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#view-artist [data-sort] [data-order="time"]').click();
  return 1;
})()`);
await gate(`(() => {
  const r = document.querySelector('#view-artist [data-songs] .pg-row');
  return r && r.dataset.id !== ${JSON.stringify(songsHot.firstId)};
})()`, 80, 400);
const songsTime = JSON.parse(await ev(`(() => {
  const rows = [...document.querySelectorAll('#view-artist [data-songs] .pg-row')];
  const on = document.querySelector('#view-artist [data-sort] .is-on');
  return JSON.stringify({ n: rows.length, firstId: rows[0] && rows[0].dataset.id,
    first: rows[0] && rows[0].querySelector('.pg-row__n').textContent.trim(),
    sortOn: on && on.dataset.order });
})()`));
console.log(`    全部歌曲 ${songsHot.n} 首（${songsHot.count}，加载更多 ${songsHot.more ? '在' : '无'}）；热度首行「${songsHot.first}」id=${songsHot.firstId}`);
console.log(`    输入「屋顶」→ ${filtered.n} 首：${JSON.stringify(filtered.names)}；全匹配=${filtered.matched}（${filtered.count}）`);
console.log(`    切「时间」→ 首行「${songsTime.first}」id=${songsTime.firstId}（排序按钮=${songsTime.sortOn}）`);
ok(7, '搜索「屋顶」只剩匹配项；排序切「时间」首行 id 与「热度」不同',
  `热度 ${songsHot.n} 首首行 id=${songsHot.firstId}；过滤后 ${filtered.n} 首 ${JSON.stringify(filtered.names)}；时间首行 id=${songsTime.firstId}`,
  songsHot.n >= 100 && filtered.n > 0 && filtered.matched
  && songsTime.sortOn === 'time' && songsTime.firstId && songsTime.firstId !== songsHot.firstId);

/* ================================================================
 * 8. 回归：大厅 / 搜索 / 播放页 / DJ 台，0 console error
 * ================================================================ */
console.log('\n[8] 回归');
await ev(`document.getElementById('btn-settings').click()`);           // 歌手页 → 来源页（[7] 的 source 是大厅）
if (!(await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 30, 400))) {
  await ev(`document.getElementById('btn-settings').click()`);         // 万一是 browse，再退一层
  await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 30, 400);
}
const hallOk = JSON.parse(await ev(`(() => JSON.stringify({
  active: document.getElementById('view-hall').classList.contains('is-active'),
  hero: !!document.getElementById('hall-hero'),
  heroAid: document.querySelectorAll('#hall-hero-sub [data-aid]').length,
  heroAlb: document.querySelectorAll('#hall-hero-sub [data-alb]').length,
  heroArt: !!document.querySelector('#hall-hero-art[data-alb]'),
  heroSub: (document.getElementById('hall-hero-sub') || {}).textContent,
  tools: document.querySelectorAll('#hall-tools .hrow').length,
  feed: document.querySelectorAll('#hall-feed .hall-pl').length,
  panelClosed: !!document.getElementById('settings-panel').hidden,
}))()`));
await ev(`(() => {
  const s = document.getElementById('search');
  s.value = '屋顶';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
const searchOk = await gate(`document.getElementById('view-browse').classList.contains('is-active')
  && document.querySelectorAll('#tracks .track').length > 0`, 80, 400);
const searchInfo = JSON.parse(await ev(`(() => JSON.stringify({
  rows: document.querySelectorAll('#tracks .track').length,
  aid: document.querySelectorAll('#tracks .track__sub [data-aid]').length,
  album: document.querySelectorAll('#tracks .track__sub [data-alb]').length,
}))()`));
await ev(`document.getElementById('btn-open-now').click()`);
const nowOk = await gate(`document.getElementById('view-now').classList.contains('is-active')`, 40, 300);
const nowInfo = await ev(`(document.getElementById('now-title') || {}).textContent`);
/* 队列面板：这一版播放页没有 tab（另一条会话改的），直接把 #queue 露出来再切一首，
   走 renderQueue() 那条真实路径，量队列行里的艺人入口 */
await ev(`(() => {
  const q = document.getElementById('queue');
  if (q) q.hidden = false;
  if (typeof Player !== 'undefined') Player.next();
  return !!q;
})()`);
await gate(`document.querySelectorAll('#queue .qrow').length > 0`, 60, 300);
const entryCnt = JSON.parse(await ev(`(() => JSON.stringify({
  nowSub: document.querySelectorAll('#now-sub [data-aid]').length,
  nowAlbum: document.querySelectorAll('#now-sub [data-alb]').length,
  queueAid: document.querySelectorAll('#queue .qrow__a [data-aid]').length,
  queueRows: document.querySelectorAll('#queue .qrow').length,
}))()`));
await ev(`document.getElementById('btn-open-now').click()`);
await gate(`document.getElementById('view-browse').classList.contains('is-active')`, 40, 300);
await ev(`document.getElementById('btn-settings').click()`);
await gate(`document.getElementById('view-hall').classList.contains('is-active')`, 40, 400);
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 40, 300);
await ev(`document.querySelectorAll('#hall-tools .hrow')[0].click()`);
const labOk = await gate(`document.getElementById('view-lab').classList.contains('is-active')
  && document.getElementById('lab-pane-dj') && document.getElementById('lab-pane-dj').classList.contains('is-on')`, 80, 400);
await sleep(1200);

/* DJ 台曲库（public/lab/**，只借它的 DOM）：艺人格是可点入口 */
await ev(`(() => {
  const b = document.querySelector('#djx-lib-wrap [data-act="lib-queue"]');
  if (b) b.click();
  return !!b;
})()`);
await gate(`document.querySelectorAll('#djx-lib tbody tr').length > 0`, 60, 300);
const libArt = JSON.parse(await ev(`(() => {
  const rows = [...document.querySelectorAll('#djx-lib tbody tr')];
  const nc = rows.find((r) => (r.dataset.key || '').startsWith('nc:'));
  const td = nc && nc.querySelector('td.c-a');
  return JSON.stringify({ rows: rows.length, name: td && td.textContent.trim(), key: nc && nc.dataset.key });
})()`));
await ev(`(() => {
  const rows = [...document.querySelectorAll('#djx-lib tbody tr')];
  const nc = rows.find((r) => (r.dataset.key || '').startsWith('nc:'));
  const td = nc && nc.querySelector('td.c-a');
  if (td) td.click();
  return !!td;
})()`);
const djOpen = await gate(`document.getElementById('view-artist').classList.contains('is-active')
  && !!document.querySelector('#view-artist .pg-name')
  && document.querySelector('#view-artist .pg-name').textContent.trim().length > 0`, 80, 400);
const djName = await ev(`(document.querySelector('#view-artist .pg-name') || {}).textContent`);
console.log(`    DJ 曲库 ${libArt.rows} 行，艺人格「${libArt.name}」(${libArt.key}) → 歌手页=${djOpen}「${djName}」`);

const errAll = [...exceptions, ...consoleErrs];
console.log(`    大厅 active=${hallOk.active} 推荐歌单=${hallOk.feed} 块=${hallOk.tools}；hero 副题「${hallOk.heroSub}」艺人入口 ${hallOk.heroAid} / 专辑入口 ${hallOk.heroAlb} / 封面入口 ${hallOk.heroArt}`);
console.log(`    搜索 ${searchInfo.rows} 行（艺人入口 ${searchInfo.aid} / 专辑入口 ${searchInfo.album}）=${searchOk}`);
console.log(`    播放页=${nowOk}（「${nowInfo}」，副题艺人入口 ${entryCnt.nowSub} / 专辑入口 ${entryCnt.nowAlbum}）；队列 ${entryCnt.queueRows} 行（艺人入口 ${entryCnt.queueAid}）；DJ 台=${labOk}；console error=${errAll.length}${errAll.length ? ' :: ' + errAll.slice(0, 3).join(' | ') : ''}`);
ok(8, '大厅 / 搜索 / 播放页 / DJ 台都能打开，0 console error',
  `hall=${hallOk.active}(feed ${hallOk.feed}, hero 入口 ${hallOk.heroAid}/${hallOk.heroAlb}/${hallOk.heroArt}) search=${searchOk}(${searchInfo.rows} 行, 艺人 ${searchInfo.aid}/专辑 ${searchInfo.album} 入口) `
  + `now=${nowOk}(副题 ${entryCnt.nowSub} 入口) queue=${entryCnt.queueAid} 入口 lab=${labOk} errors=${errAll.length}`,
  hallOk.active && hallOk.feed > 0 && searchOk && searchInfo.rows > 0 && nowOk && labOk
  && hallOk.heroAid > 0 && hallOk.heroAlb > 0 && hallOk.heroArt
  && entryCnt.nowSub > 0 && entryCnt.queueAid > 0 && errAll.length === 0);
ok('8b', 'DJ 台曲库里的艺人名 → 歌手页',
  `曲库 ${libArt.rows} 行（${libArt.key}「${libArt.name}」）→ ${djOpen ? '歌手页「' + djName + '」' : '没打开'}`,
  libArt.rows > 0 && djOpen && !!djName && djName !== '未知歌手');

/* ================================================================
 * 9. 截图（1440 宽长图）
 * ================================================================ */
console.log('\n[9] 截图');
await ev(`(async () => { await window.__LIZI_PAGES.openArtist(6452); return 1; })()`);
await gate(`document.querySelectorAll('#view-artist .pg-album').length > 0`, 80, 400);
/* [8b] 把歌手页换成了别人，这里回到周杰伦是重新拉的一批 12 张 —— 再补一次「加载更多」，
   截图里要有整面专辑墙 */
if ((await ev(`document.querySelectorAll('#view-artist .pg-album').length`)) < 24) {
  await ev(`(() => {
    const b = document.querySelector('#view-artist [data-more-albums]');
    if (b && !b.hidden) b.click();
    return !!b;
  })()`);
  await gate(`document.querySelectorAll('#view-artist .pg-album').length >= 24`, 60, 300);
}
await gate(`[...document.querySelectorAll('#view-artist .pg-album img')].every((i) => i.naturalWidth > 0)`, 80, 400);
await gate(`(() => { const i = document.querySelector('#view-artist .pg-ava img'); return i && i.complete && i.naturalWidth > 0; })()`, 60, 300);
await viewport(1750);
await scrollView('#view-artist', 0);
await sleep(1600);
await shot('pages-1-artist.png');
const yAlbums = await scrollToSel('#view-artist', '#view-artist .pg-albums', 130);
await sleep(1600);
const stuck = await ev(`document.getElementById('topbar').classList.contains('is-stuck')`);
await shot('pages-2-albums.png');
console.log(`    专辑墙滚动位置 scrollTop=${yAlbums}（顶栏收缩态=${stuck}）`);
await viewport(1560);
await ev(`document.querySelector('#view-artist .pg-album').click()`);
await gate(`document.getElementById('view-album').classList.contains('is-active')
  && document.querySelectorAll('#view-album [data-tracks] .pg-row').length > 0`, 60, 400);
await gate(`(() => { const i = document.querySelector('#view-album .pg-album-art img'); return i && i.naturalWidth > 0; })()`, 60, 300);
await scrollView('#view-album', 0);
await sleep(1400);
await shot('pages-3-album.png');
const dims = JSON.parse(await ev(`(() => {
  const v = document.querySelector('#view-album');
  return JSON.stringify({ vh: v.clientHeight, vw: v.clientWidth, sh: v.scrollHeight });
})()`));
console.log(`    专辑页视口 ${dims.vw}×${dims.vh}，内容高 ${dims.sh}`);
await viewport(1000);

/* ================================================================
 * 收尾
 * ================================================================ */
console.log('\n============ 汇总 ============');
for (const r of R.rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${String(r.n).padStart(2)}] ${r.name}`);
const main = R.rows.filter((r) => typeof r.n === 'number');
const extra = R.rows.filter((r) => typeof r.n !== 'number');
console.log(`\n九条：通过 ${main.filter((r) => r.pass).length} / ${main.length}；附加：通过 ${extra.filter((r) => r.pass).length} / ${extra.length}`);
if (R.pass !== R.rows.length) console.log('失败项：', R.rows.filter((r) => !r.pass).map((r) => r.n).join(','));
console.log('console error:', errAll.length ? errAll.slice(0, 5) : '无');

ws.close(); ch.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(R.fail ? 1 : 0);
