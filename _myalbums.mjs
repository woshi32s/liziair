/**
 * _myalbums.mjs —— 「我的专辑」（收藏系统 + 3D 陈列架）验收
 *
 * 只用无头 Chrome + CDP，不驱动 Electron 窗口。端口从 .port 读，不写死。
 * 所有数字都从页面上量：DOM 文本、localStorage、getComputedStyle/transform、元素命中。
 *
 *   node _myalbums.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440, H = 900;
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
const PROFILE = path.join(os.tmpdir(), 'lg-myalbums-' + Date.now());
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
const gate = async (cond, tries = 60, ms = 300) => {
  for (let i = 0; i < tries; i++) { if (await ev(cond)) return true; await sleep(ms); }
  return false;
};
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, Buffer.from(png.data, 'base64'));
  console.log('    →', `shots/review/${name}`, `(${Math.round(fs.statSync(p).size / 1024)} KB)`);
};

/* 真实鼠标点击（走 pointerdown/up，验证的是用户那条路，不是 el.click()） */
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const rectOf = async (sel) => JSON.parse(await ev(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return JSON.stringify({ ok: false });
  const b = e.getBoundingClientRect();
  return JSON.stringify({ ok: true, x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height });
})()`));
const clickSel = async (sel, center = true) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center', inline: 'center' }); return 1; })()`);
  await sleep(120);
  const r = await rectOf(sel);
  if (!r.ok) return false;
  await clickAt(r.x, r.y);
  return true;
};
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};

const store = async () => JSON.parse(await ev(`localStorage.getItem('lizi.myAlbums.v1') || '[]'`));
const storeLen = async () => (await store()).length;
const btnText = async () => String(await ev(`(document.querySelector('#btn-collect [data-collect-text]') || {}).textContent || ''`)).trim();
const view = async () => String(await ev(`document.body.dataset.view || ''`));
/** 调试用：任何一步之后都能看清 视图/栈/专辑页标题/选中索引/收藏顺序 */
const st = async (tag) => console.log('    ·', tag.padEnd(22),
  JSON.stringify(JSON.parse(await ev(`(() => JSON.stringify({
    view: document.body.dataset.view,
    stack: window.__LIZI_PAGES ? window.__LIZI_PAGES.stack() : 'no-nav',
    src: window.__LIZI_PAGES ? window.__LIZI_PAGES.source() : null,
    title: (document.querySelector('#view-album .pg-album-name') || {}).textContent,
    sel: window.__LIZI_MYALBUMS ? window.__LIZI_MYALBUMS.index() : null,
    keys: window.__LIZI_MYALBUMS ? window.__LIZI_MYALBUMS.keys().map(k => k.split(':')[1]).join(',') : null,
  }))()`))));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });

console.log(`\nLIZI 我的专辑（收藏 + 3D 陈列架）验收  ·  http://127.0.0.1:${APP}/  ·  ${W}×${H} 无头 Chrome`);

/* ================================================================
 * 0. 准备：大厅起来、拿 6 张真实专辑
 * ================================================================ */
console.log('\n[0] 准备');
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 100, 400))) {
  console.log('!! 大厅没起来，先看服务'); process.exit(2);
}
const ALBUMS = JSON.parse(await ev(`fetch('/api/artist/albums/6452?limit=6&offset=0')
  .then(r => r.json())
  .then(d => JSON.stringify((d.albums || []).slice(0, 6).map(a => ({ id: a.id, name: a.name, size: a.size }))))`));
if (!Array.isArray(ALBUMS) || ALBUMS.length < 6) { console.log('!! 拿不到专辑列表', ALBUMS); process.exit(2); }
console.log(`    用周杰伦的 ${ALBUMS.length} 张真专辑：` + ALBUMS.map((a) => `${a.id}/${a.name}`).join('、'));
await ev(`import('/pages/nav.js').then(() => !!window.__LIZI_PAGES)`);

const openAlbum = async (a) => {
  await ev(`window.__LIZI_PAGES.openAlbum(${a.id})`);
  return gate(`document.body.dataset.view === 'album'
    && (document.querySelector('#view-album .pg-album-name') || {}).textContent === ${JSON.stringify(a.name)}
    && !!document.getElementById('btn-collect')`, 100, 250);
};

/* ================================================================
 * 1. 专辑页有 #btn-collect，点一次 → 收藏 +1
 * ================================================================ */
console.log('\n[1] 专辑页的「收纳到我的专辑」');
await openAlbum(ALBUMS[0]);
await ev(`localStorage.removeItem('lizi.myAlbums.v1')`);
await ev(`document.getElementById('view-album').scrollTop = 0`);
const t0 = await btnText();
const rect0 = await rectOf('#btn-collect');
await clickSel('#btn-collect');
await sleep(220);
const t1 = await btnText();
const l1 = await store();
const first = l1[0] || {};
ok('1', '按钮文案 / 收藏落库',
  `初始「${t0}」→ 点击后「${t1}」；localStorage['lizi.myAlbums.v1'].length=${l1.length}；`
  + `项 = {id:${first.id}, name:${first.name}, cover:${String(first.cover).slice(-24)}…, source:${first.source}, `
  + `trackCount:${first.trackCount}, publishTime:${first.publishTime}, artists:${first.artists}, addedAt:${first.addedAt}}`,
  t0 === '收纳到我的专辑' && t1 === '已在我的专辑' && l1.length === 1
  && !!first.id && !!first.name && !!first.cover && rect0.ok);

/* ================================================================
 * 2. 再点一次 → 取消，文案还原
 * ================================================================ */
console.log('\n[2] 再点一次 = 取消收藏');
await clickSel('#btn-collect');
await sleep(220);
const t2 = await btnText();
const l2 = await storeLen();
ok('2', '双向切换（重复点 = 取消）',
  `文案「${t2}」，localStorage 长度 ${l2}`,
  t2 === '收纳到我的专辑' && l2 === 0);

/* ================================================================
 * 3. 连收 5 张不同专辑 → 5 条、无重复；同一张再点不长长
 * ================================================================ */
console.log('\n[3] 5 张不同专辑 / 去重');
let added = 0, expectLen = 0, allOk = true;
for (const a of ALBUMS.slice(0, 5)) {
  const ready = await openAlbum(a);
  if (!ready) { console.log('    !! 专辑页没就绪', a.name); allOk = false; break; }
  await clickSel('#btn-collect');
  expectLen++;
  added++;
  await sleep(180);
  const n = await storeLen();
  if (n !== expectLen) { console.log(`    !! 收「${a.name}」后长度 ${n}，期望 ${expectLen}`); allOk = false; break; }
}
const l5 = await store();
const ids5 = l5.map((x) => x.id);
/* 重复收同一张：点一次应该"取消"（5→4），再点"收回"（4→5），全程绝不出现 6 或重复 id */
await openAlbum(ALBUMS[1]);
await clickSel('#btn-collect');
await sleep(180);
const dupA = await storeLen();
await clickSel('#btn-collect');
await sleep(180);
const dupB = await storeLen();
const dupIds = (await store()).map((x) => x.id);
ok('3', '连收 5 张 · 无重复',
  `收 5 张后 length=${l5.length}，去重后 ${new Set(ids5).size}；对同一张再点：${l5.length}→${dupA}（取消）→${dupB}（收回），`
  + `去重后 ${new Set(dupIds).size}`,
  allOk && l5.length === 5 && new Set(ids5).size === 5
  && dupA === 4 && dupB === 5 && new Set(dupIds).size === 5);

/* 这时候专辑页正停在 ALBUMS[1]（已收藏）—— 顺手截「专辑页那颗按钮」 */
await sleep(200);
await shot('myalbums-3-album-btn.png');
console.log(`    专辑页按钮此刻文案：「${await btnText()}」`);

/* 上面为了收 5 张开了 5 个专辑页，访问栈里留了 5 层。
   刷新一次 = 一次干净的新会话（localStorage 里的收藏留着），后面的返回键才走"架子"这条链。 */
await send('Page.reload');
if (!(await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0 && !!window.__LIZI_MYALBUMS`, 120, 400))) {
  console.log('!! 刷新后没回来'); process.exit(2);
}
await ev(`import('/pages/nav.js').then(() => !!window.__LIZI_PAGES)`);
await st('刷新后（新会话）');

/* ================================================================
 * 4. #view-myalbums 静态空壳 + 从大厅入口打开
 * ================================================================ */
console.log('\n[4] #view-myalbums 静态空壳 / 大厅入口');
const inHtml = await ev(`fetch('/').then(r => r.text()).then(t => t.includes('id="view-myalbums"') ? 'yes' : 'no')`);
const shellTag = String(await ev(`(() => { const e = document.getElementById('view-myalbums');
  return e ? e.tagName + '.' + e.className : 'MISSING'; })()`));

/* 大厅入口：工具箱那一行（另一个代理在做，按 #view-myalbums 是否存在决定可点/置灰） */
const entry = JSON.parse(await ev(`(() => {
  const b = [...document.querySelectorAll('#hall-tools .hrow, #hall-tools button')]
    .find(x => /我的专辑/.test(x.textContent || ''));
  if (!b) return JSON.stringify({ found: false });
  return JSON.stringify({ found: true, tag: b.tagName, cls: b.className, disabled: !!b.disabled,
    aria: b.getAttribute('aria-disabled'), text: (b.textContent || '').trim().slice(0, 40) });
})()`));

let howOpened = '大厅入口';
if (entry.found) {
  await ev(`document.getElementById('view-hall').scrollTop = 0`);
  const hit = await ev(`(() => {
    const b = [...document.querySelectorAll('#hall-tools .hrow, #hall-tools button')]
      .find(x => /我的专辑/.test(x.textContent || ''));
    if (!b) return 0; b.click(); return 1;
  })()`);
  howOpened = `大厅「我的专辑」入口（${hit ? '已点' : '没点到'}，disabled=${entry.disabled}）`;
} else {
  await ev(`document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view: 'myalbums' } }))`);
  howOpened = '另一代理的大厅入口还没落地 → 走 lizi:show（同一条路径）';
}
const opened = await gate(`document.body.dataset.view === 'myalbums'
  && document.getElementById('view-myalbums').classList.contains('is-active')`, 80, 250);
ok('4', '静态空壳 + 从大厅打开',
  `index.html 里 ${inHtml === 'yes' ? '有' : '没有'} id="view-myalbums"；运行时元素 = ${shellTag}；`
  + `入口 ${entry.found ? `存在（text="${entry.text}", disabled=${entry.disabled}, aria-disabled=${entry.aria}）` : '不存在'}；`
  + `打开方式：${howOpened} → view=${await view()}，is-active=${opened}`,
  inHtml === 'yes' && shellTag !== 'MISSING' && opened);

/* ================================================================
 * 5. 架子渲染：张数 + 真的 3D（中间 z≠0 / 两侧 rotateY≠0）
 * ================================================================ */
console.log('\n[5] 3D 陈列架');
await gate(`document.querySelectorAll('#view-myalbums .ma-item').length === 5`, 60, 250);
await sleep(520);                       /* 等惯性收敛，transform 落定 */
const n5 = await ev(`document.querySelectorAll('#view-myalbums .ma-item').length`);
const geom = JSON.parse(await ev(`(() => {
  const items = [...document.querySelectorAll('#view-myalbums .ma-item')];
  const mid = Math.round(window.__LIZI_MYALBUMS.pos());
  const read = (i) => {
    const el = items[i];
    if (!el) return null;
    const t = getComputedStyle(el).transform;
    const m3 = /matrix3d\\(([^)]+)\\)/.exec(t);
    return { i, transform: el.style.transform, z: el.style.transform.match(/translate3d\\([^,]+,[^,]+,\\s*(-?[\\d.]+)px\\)/) ?
      Number(el.style.transform.match(/translate3d\\([^,]+,[^,]+,\\s*(-?[\\d.]+)px\\)/)[1]) : null,
      ry: el.style.transform.match(/rotateY\\((-?[\\d.]+)deg\\)/) ? Number(el.style.transform.match(/rotateY\\((-?[\\d.]+)deg\\)/)[1]) : null,
      m3: !!m3, w: Math.round(el.getBoundingClientRect().width), cls: el.className };
  };
  return JSON.stringify({ mid, count: items.length, c: read(mid), l: read(mid - 1), r: read(mid + 1),
    sel: window.__LIZI_MYALBUMS.index(),
    persp: getComputedStyle(document.querySelector('#view-myalbums .ma-stage')).perspective,
    size: getComputedStyle(document.querySelector('#view-myalbums .ma-stage')).getPropertyValue('--ma-size') });
})()`));

console.log('    中间那张 transform：', geom.c && geom.c.transform);
console.log('    左一 transform：    ', geom.l && geom.l.transform);
console.log('    右一 transform：    ', geom.r && geom.r.transform);
console.log(`    舞台 perspective=${geom.persp}，--ma-size=${geom.size}`);
ok('5', '.ma-item = 5 · 真有 3D',
  `DOM .ma-item=${n5}，中间索引 ${geom.mid}：z=${geom.c && geom.c.z}px（≠0）、rotateY=${geom.c && geom.c.ry}°；`
  + `左一 rotateY=${geom.l && geom.l.ry}°、右一 rotateY=${geom.r && geom.r.ry}°（都不为 0）；`
  + `中间那张渲染宽 ${geom.c && geom.c.w}px，matrix3d=${geom.c && geom.c.m3}`,
  n5 === 5 && geom.c && geom.c.z !== 0 && geom.l && geom.l.ry !== 0 && geom.r && geom.r.ry !== 0
  && geom.c.m3);

/* 截图前等封面落定：要么解码完，要么被 error 兜底换成首字占位。
   不 wait 的话会截到"图还在加载"的空白卡（看着像坏图，其实是中间态）。 */
await (async () => {
  for (let i = 0; i < 40; i++) {
    const settled = await ev(`(() => {
      const arts = [...document.querySelectorAll('.ma-item__art')];
      return arts.every((a) => !a.querySelector('img') || a.querySelector('img').complete);
    })()`);
    if (settled) return;
    await sleep(250);
  }
})();
await sleep(400);
await shot('myalbums-1-shelf.png');

/* ================================================================
 * 6. 点第 2 张 → 打开对应专辑页（标题匹配）
 * ================================================================ */
console.log('\n[6] 点第 2 张 → 专辑页');
const want1 = JSON.parse(await ev(`JSON.stringify(window.__LIZI_MYALBUMS.list()[1] || {})`));
const itemRect = JSON.parse(await ev(`(() => {
  const el = document.querySelectorAll('#view-myalbums .ma-item')[1];
  const b = el.getBoundingClientRect();
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  const hitEl = document.elementFromPoint(cx, cy);
  return JSON.stringify({ x: cx, y: cy, ok: !!(hitEl && hitEl.closest('.ma-item') === el), hit: hitEl ? hitEl.className : '' });
})()`));
if (itemRect.ok) await clickAt(itemRect.x, itemRect.y);
else await ev(`document.querySelectorAll('#view-myalbums .ma-item')[1].click()`);
const opened1 = await gate(`document.body.dataset.view === 'album'
  && (document.querySelector('#view-album .pg-album-name') || {}).textContent === ${JSON.stringify(want1.name)}`, 100, 250);
const title1 = String(await ev(`(document.querySelector('#view-album .pg-album-name') || {}).textContent || ''`));
ok('6', '点击第 2 张打开对应专辑页',
  `第 2 张 = 「${want1.name}」(${want1.id})，命中测试 ${itemRect.ok ? '直接命中卡片' : '被邻居挡住 → 退化为 el.click()'}；`
  + `专辑页标题 =「${title1}」`,
  opened1 && title1 === want1.name);

/* ================================================================
 * 7. 键盘：→ 选中 +1，Enter 打开；顶栏返回先回架子、再回大厅
 * ================================================================ */
console.log('\n[7] 键盘 / 顶栏返回');
const backSel = '#btn-settings';
await st('进 [7] 前');
await clickSel(backSel);                                     /* 专辑页 → 架子（访问栈） */
const backToShelf = await gate(`document.body.dataset.view === 'myalbums'`, 80, 250);
await st('点了一次返回');
const idxBefore = await ev(`window.__LIZI_MYALBUMS.index()`);
await sleep(200);
await key('ArrowRight', 'ArrowRight', 39);
await sleep(240);
const idxAfter = await ev(`window.__LIZI_MYALBUMS.index()`);
const selDom = await ev(`[...document.querySelectorAll('#view-myalbums .ma-item')].findIndex(e => e.classList.contains('is-sel'))`);
const want2 = JSON.parse(await ev(`JSON.stringify(window.__LIZI_MYALBUMS.list()[window.__LIZI_MYALBUMS.index()] || {})`));
await key('Enter', 'Enter', 13);
const opened2 = await gate(`document.body.dataset.view === 'album'
  && (document.querySelector('#view-album .pg-album-name') || {}).textContent === ${JSON.stringify(want2.name)}`, 100, 250);
await st('Enter 之后');
const title2 = String(await ev(`(document.querySelector('#view-album .pg-album-name') || {}).textContent || ''`));
await clickSel(backSel);                                     /* 专辑页 → 架子 */
const backAgain = await gate(`document.body.dataset.view === 'myalbums'`, 80, 250);
await st('第二次返回');
await clickSel(backSel);                                     /* 架子 → 大厅 */
const backHall = await gate(`document.body.dataset.view === 'hall'`, 80, 250);
await st('第三次返回');
ok('7', '键盘 → 选中 +1 · Enter 打开 · 返回逐级回退',
  `顶栏返回到架子=${backToShelf}；选中索引 ${idxBefore}→${idxAfter}（DOM is-sel=${selDom}）；`
  + `Enter 打开「${title2}」（期望「${want2.name}」=${opened2}）；专辑→架子=${backAgain}，架子→大厅=${backHall}`,
  backToShelf && Number(idxAfter) === Number(idxBefore) + 1 && selDom === idxAfter
  && opened2 && title2 === want2.name && backAgain && backHall);

/* ================================================================
 * 8. 空状态：清空 localStorage → 进视图
 * ================================================================ */
console.log('\n[8] 空状态');
const beforeClear = (await store()).length;
await ev(`localStorage.removeItem('lizi.myAlbums.v1')`);
const afterClear = await ev(`localStorage.getItem('lizi.myAlbums.v1') === null ? 'null' : 'still-there'`);
const emptyEntry = JSON.parse(await ev(`(() => {
  const b = [...document.querySelectorAll('#hall-tools .hrow, #hall-tools button')]
    .find(x => /我的专辑/.test(x.textContent || ''));
  if (b) { b.click(); return JSON.stringify({ via: 'hall-tools' }); }
  return JSON.stringify({ via: 'none' });
})()`));
if (emptyEntry.via === 'none') await ev(`document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view: 'myalbums' } }))`);
await gate(`document.body.dataset.view === 'myalbums'`, 80, 250);
await sleep(420);
await st('清空后进架子');
const empty = JSON.parse(await ev(`(() => {
  const v = document.getElementById('view-myalbums');
  const stage = v.querySelector('.ma-stage');
  const hint = v.querySelector('.ma-empty');
  const sr = stage ? stage.getBoundingClientRect() : null;
  return JSON.stringify({
    items: v.querySelectorAll('.ma-item').length,
    hintText: hint ? (hint.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) : '',
    hintShown: !!(hint && !hint.hidden && hint.offsetHeight > 0),
    stageH: sr ? Math.round(sr.height) : -1,
    stageDisplay: stage ? getComputedStyle(stage).display : 'none',
    count: (v.querySelector('[data-count]') || {}).textContent,
    pick: !!(v.querySelector('[data-pick]') && v.querySelector('[data-pick]').offsetHeight > 0),
  });
})()`));
ok('8', '空状态：有提示、没有空架子',
  `清空前 ${beforeClear} 条 → removeItem 后 key=${afterClear}；进入方式=${emptyEntry.via}；.ma-item=${empty.items}；`
  + `提示「${empty.hintText}」可见=${empty.hintShown}；`
  + `舞台 display=${empty.stageDisplay}（高 ${empty.stageH}px）；计数=${empty.count}；「去挑一张专辑」可见=${empty.pick}`,
  empty.items === 0 && empty.hintShown && empty.stageDisplay === 'none' && empty.count === '0' && empty.pick);
await shot('myalbums-2-empty.png');

/* ================================================================
 * 9. console error / 未捕获异常
 * ================================================================ */
console.log('\n[9] 控制台');
console.log('    console.error:', consoleErrs.length, consoleErrs.slice(0, 6));
console.log('    uncaught    :', exceptions.length, exceptions.slice(0, 6));
ok('9', '0 console error / 0 未捕获异常',
  `console.error=${consoleErrs.length}，exceptionThrown=${exceptions.length}`,
  consoleErrs.length === 0 && exceptions.length === 0);

/* ================================================================
 * 10. 截图
 * ================================================================ */
console.log('\n[10] 截图');
for (const f of ['myalbums-1-shelf.png', 'myalbums-2-empty.png', 'myalbums-3-album-btn.png']) {
  const p = path.join(OUT, f);
  console.log(`    ${fs.existsSync(p) ? '✓' : '✗'} shots/review/${f}`
    + (fs.existsSync(p) ? ` (${Math.round(fs.statSync(p).size / 1024)} KB)` : ''));
}
ok('10', '三张截图都在',
  'myalbums-1-shelf.png / myalbums-2-empty.png / myalbums-3-album-btn.png',
  ['myalbums-1-shelf.png', 'myalbums-2-empty.png', 'myalbums-3-album-btn.png']
    .every((f) => fs.existsSync(path.join(OUT, f)) && fs.statSync(path.join(OUT, f)).size > 8000));

/* ---------- 收尾 ---------- */
console.log(`\n===== ${R.pass} PASS / ${R.fail} FAIL =====`);
for (const r of R.rows) if (!r.pass) console.log(`  ✗ [${r.n}] ${r.name}`);
ws.close();
ch.kill();
await sleep(400);
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exit(R.fail ? 1 : 0);
