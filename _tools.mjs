/* 大厅入口行验收（形态长廊 / 我的专辑 / 音乐实验室 / 工具箱）
   —— 从「一个 cell 包 4 行」改成「四个平级按钮 + 工具箱浮层」。
   跑法：node _tools.mjs

   全程无头 Chrome + CDP，不碰 Electron 窗口。
   第二条命用 Document.prototype.getElementById 兜一个 #view-myalbums 出来，
   验「视图存在时这一项正常可点」；第一条命验「视图不存在时置灰、点了不报错」。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT_CDP = 9427;
const profile = path.join(os.tmpdir(), 'lizi-tools-' + Date.now());
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const portFile = fs.readFileSync('.port', 'utf8').trim();
const URL_ = `http://127.0.0.1:${portFile}/`;
const SHOTS = 'shots/review';

/* 第二条命：运行中把 #view-myalbums 的查找掐掉（模拟「点的时候视图不在」）。
   不做整页隐藏 —— 视图已是静态空壳，别处按它存在写的，藏起来会先在 boot 里炸，与本改动无关。 */


const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT_CDP}`,
  '--window-size=1440,1000', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tab() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP 没起来');
}

const t = await tab();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const waiters = new Map();
const consoleErrs = [];       // console.error / 未捕获异常
const netErrs = [];           // 资源/网络层（单独报，不算 JS 异常）
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = (m.params && m.params.exceptionDetails) || {};
    consoleErrs.push('exception: ' + ((d.exception && d.exception.description) || d.text || '?').slice(0, 200));
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrs.push('console.error: ' + (m.params.args || []).map((a) => String(a.value !== undefined ? a.value : a.description || '')).join(' ').slice(0, 200));
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry || {};
    if (e.level === 'error') netErrs.push((e.source || '') + ': ' + String(e.text || '').slice(0, 120) + ' @ ' + String(e.url || '').slice(0, 120));
  }
};
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res) => waiters.set(mid, res));
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result && r.result.result ? r.result.result.value : null;
}
const key = async (k, code, vk, text) => {
  const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base, text ? { text } : {}));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  await sleep(220);
};
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(260);
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(SHOTS, name);
  fs.writeFileSync(p, Buffer.from(s.result.data, 'base64'));
  return p + ' (' + Math.round(fs.statSync(p).size / 1024) + ' KB)';
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
/* 宽屏基准：CSS 视口就设成 1440（窗口自带边框，innerWidth 会少 16px，量出来不干净） */
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_ });
await sleep(1700);

/* ---------------- 等入口行挂上 ---------------- */
let n0 = 0;
for (let i = 0; i < 60; i++) {
  n0 = (await evalJs(`document.querySelectorAll('#hall-tools > .hall-tools__i').length`)) || 0;
  if (n0 === 4) break;
  await sleep(250);
}
await sleep(400);

/* 把入口行滚到视口里（点真鼠标 / 截图都要它可见） */
const scrollToTools = async (top = 300) => {
  await evalJs(`(() => {
    const sv = document.querySelector('#view-hall');
    const c = document.querySelector('.hall-cell--tools');
    sv.scrollTop = Math.max(0, sv.scrollTop + c.getBoundingClientRect().top - ${top});
    return sv.scrollTop;
  })()`);
  await sleep(260);
};

/* ---------------- 量具 ---------------- */
const ROW = `(() => {
  const cell = document.querySelector('.hall-cell--tools');
  const items = [...document.querySelectorAll('#hall-tools > .hall-tools__i')];
  const r = items.map((b) => b.getBoundingClientRect());
  const c0 = items[0] ? getComputedStyle(items[0]) : {};
  const txt = document.querySelector('#hall-tools').textContent;
  return {
    n: items.length,
    ids: items.map((b) => b.dataset.tool),
    names: items.map((b) => (b.querySelector('.n') || {}).textContent.trim()),
    descs: items.map((b) => (b.querySelector('.c') || {}).textContent.trim()),
    tops: r.map((x) => +x.top.toFixed(1)),
    lefts: r.map((x) => +x.left.toFixed(1)),
    rights: r.map((x) => +x.right.toFixed(1)),
    widths: r.map((x) => +x.width.toFixed(1)),
    h: r[0] ? +r[0].height.toFixed(1) : 0,
    spread: r.length ? +(Math.max(...r.map((x) => x.top)) - Math.min(...r.map((x) => x.top))).toFixed(1) : -1,
    rowTop: r.length ? +Math.min(...r.map((x) => x.top)).toFixed(1) : 0,
    rowBottom: r.length ? +Math.max(...r.map((x) => x.bottom)).toFixed(1) : 0,
    hasLyric: txt.includes('歌词样式'),
    heading: !!cell.querySelector('.hall-cell__h'),
    disabled: items.map((b) => b.getAttribute('aria-disabled')),
    offCls: items.map((b) => b.classList.contains('is-off')),
    border0: c0.borderTopWidth + ' ' + c0.borderTopStyle,
    radius0: c0.borderTopLeftRadius,
    shadow0: c0.boxShadow,
    innerW: innerWidth,
    vw: document.documentElement.clientWidth,
  };
})()`;

const POP = `(() => {
  const p = document.getElementById('hall-tools-pop');
  const btn = document.querySelector('#hall-tools [data-tool="box"]');
  if (!p) return { exists: false };
  const r = p.getBoundingClientRect();
  const cs = getComputedStyle(p);
  const tb = btn.getBoundingClientRect();
  return {
    exists: true,
    hidden: p.hidden,
    open: !p.hidden && r.height > 0,
    n: p.querySelectorAll('[data-box]').length,
    names: [...p.querySelectorAll('[data-box] .n')].map((e) => e.textContent.trim()),
    descs: [...p.querySelectorAll('[data-box] .c')].map((e) => e.textContent.trim()),
    rect: { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    belowRow: +(r.top - tb.bottom).toFixed(1),
    rightGap: +(tb.right - r.right).toFixed(1),
    bg: cs.backgroundColor,
    border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
    radius: cs.borderTopLeftRadius,
    shadow: cs.boxShadow,
    expanded: btn.getAttribute('aria-expanded'),
    haspopup: btn.getAttribute('aria-haspopup'),
    focusIn: p.contains(document.activeElement),
    focusCls: (document.activeElement && document.activeElement.getAttribute('data-box')) || (document.activeElement && document.activeElement.dataset.tool) || '',
  };
})()`;

const LAB = `(() => ({
  hall: document.getElementById('view-hall').classList.contains('is-active'),
  lab: document.getElementById('view-lab').classList.contains('is-active'),
  paneDj: document.getElementById('lab-pane-dj').classList.contains('is-on'),
  paneXfade: document.getElementById('lab-pane-xfade').classList.contains('is-on'),
  paneVst: document.getElementById('lab-pane-vst').classList.contains('is-on'),
  tabOn: [...document.querySelectorAll('#lab-tabs [data-tab]')].filter((b) => b.classList.contains('is-on')).map((b) => b.dataset.tab),
  dataView: document.body.dataset.view,
}))()`;

await scrollToTools(300);

/* ---------------- 1. 四项：顺序 / 文本 / 歌词样式没了 ---------------- */
const row = await evalJs(ROW);
const shotRow = await shot('tools-1-row.png');

/* ---------------- 2. 工具箱浮层：开 ---------------- */
await evalJs(`document.querySelector('#hall-tools [data-tool="box"]').click()`);
await sleep(320);
const popOpen = await evalJs(POP);
const shotPop = await shot('tools-2-popover.png');

/* 3a. Esc 关闭 */
await key('Escape', 'Escape', 27);
const afterEsc = await evalJs(POP);

/* 3b. 再点「工具箱」关闭 */
await evalJs(`document.querySelector('#hall-tools [data-tool="box"]').click()`);
await sleep(260);
const reopened = await evalJs(POP);
await evalJs(`document.querySelector('#hall-tools [data-tool="box"]').click()`);
await sleep(300);
const afterReclick = await evalJs(POP);

/* 3c. 点页面空白处关闭（真鼠标事件，落在浮层左边那条空白带里） */
await evalJs(`document.querySelector('#hall-tools [data-tool="box"]').click()`);
await sleep(280);
const blankPt = await evalJs(`(() => {
  const p = document.getElementById('hall-tools-pop').getBoundingClientRect();
  const c = document.querySelector('.hall-cell--tools').getBoundingClientRect();
  const x = Math.round(c.left + 40);
  const y = Math.round(p.top + Math.min(12, p.height / 2));
  const el = document.elementFromPoint(x, y);
  return { x, y, hit: el ? (el.id ? '#' + el.id : el.className || el.tagName) : 'none',
    inPop: !!(el && el.closest && el.closest('#hall-tools-pop')) };
})()`);
await clickAt(blankPt.x, blankPt.y);
const afterBlank = await evalJs(POP);

/* ---------------- 4. 浮层里「自动过渡」→ 实验室 xfade 分页 ---------------- */
await evalJs(`document.querySelector('#hall-tools [data-tool="box"]').click()`);
await sleep(260);
await evalJs(`document.querySelector('#hall-tools-pop [data-box="xfade"]').click()`);
await sleep(900);
const afterXfade = await evalJs(LAB);
const popAfterXfade = await evalJs(`(() => { const p = document.getElementById('hall-tools-pop'); return p ? { hidden: p.hidden, expanded: document.querySelector('#hall-tools [data-tool="box"]').getAttribute('aria-expanded') } : { gone: true }; })()`);
await evalJs(`document.getElementById('btn-back').click()`);
await sleep(700);

/* ---------------- 4b. 键盘：Tab 能到「工具箱」，Enter 开、Enter 触发 ---------------- */
await scrollToTools(300);
await evalJs(`document.querySelector('#hall-tools [data-tool="lab"]').focus()`);
await key('Tab', 'Tab', 9);
const tabLands = await evalJs(`(() => ({ tool: (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.tool) || '', cls: (document.activeElement && document.activeElement.className) || '' }))()`);
await key('Enter', 'Enter', 13, '\r');
const kbOpen = await evalJs(POP);
await key('Enter', 'Enter', 13, '\r');
await sleep(900);
const kbXfade = await evalJs(LAB);
await evalJs(`document.getElementById('btn-back').click()`);
await sleep(700);

/* ---------------- 5. 形态长廊 ---------------- */
await scrollToTools(300);
await evalJs(`document.querySelector('#hall-tools [data-tool="stage"]').click()`);
await sleep(600);
const stages = await evalJs(`(() => {
  const d = document.getElementById('drawer');
  const l = document.getElementById('drawer-stage-list');
  const b = document.getElementById('btn-stage');
  return {
    drawerOpen: d.classList.contains('is-open'),
    listHidden: l.hidden,
    n: l.querySelectorAll('.stage-item').length,
    expanded: b.getAttribute('aria-expanded'),
    hallStill: document.getElementById('view-hall').classList.contains('is-active'),
    first: (l.querySelector('.stage-item .stage-item__name') || l.querySelector('.stage-item')).textContent.trim().slice(0, 12),
  };
})()`);
await evalJs(`document.getElementById('drawer-scrim').click()`);
await sleep(500);
const drawerClosed = await evalJs(`document.getElementById('drawer').classList.contains('is-open')`);

/* ---------------- 6. 音乐实验室 → DJ 台 ---------------- */
await scrollToTools(300);
await evalJs(`document.querySelector('#hall-tools [data-tool="lab"]').click()`);
await sleep(1000);
const labDj = await evalJs(LAB);
await evalJs(`document.getElementById('btn-back').click()`);
await sleep(700);

/* ---------------- 7. 窄屏 1024：折成 2×2，无横向溢出 ---------------- */
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await scrollToTools(240);
const narrow = await evalJs(`(() => {
  const items = [...document.querySelectorAll('#hall-tools > .hall-tools__i')];
  const r = items.map((b) => b.getBoundingClientRect());
  const sv = document.getElementById('view-hall');
  const cols = [...new Set(r.map((x) => Math.round(x.left)))].sort((a, b) => a - b);
  const rows = [...new Set(r.map((x) => Math.round(x.top)))].sort((a, b) => a - b);
  return {
    innerW: innerWidth,
    cols: cols.length, rows: rows.length,
    lefts: cols, tops: rows,
    widths: r.map((x) => +x.width.toFixed(1)),
    hallOverflow: sv.scrollWidth - sv.clientWidth,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    sameRowSpread: +(Math.max(...r.map((x) => x.top)) - Math.min(...r.map((x) => x.top))).toFixed(1),
  };
})()`);
const shotNarrow = await shot('tools-3-narrow.png');
await send('Emulation.clearDeviceMetricsOverride');
await sleep(400);
await scrollToTools(300);

/* ---------------- 8a. 我的专辑（当前页面真实状态）----------------
   视图在 → 可点、点开进 #view-myalbums；视图不在 → 置灰、点了没反应。两条都认。 */
const myNow = await evalJs(`(() => {
  const b = document.querySelector('#hall-tools [data-tool="myalbums"]');
  const cs = getComputedStyle(b);
  const has = !!document.getElementById('view-myalbums');
  const out = { has, ariaDisabled: b.getAttribute('aria-disabled'), offClass: b.classList.contains('is-off'),
    cursor: cs.cursor, color: cs.color };
  if (has) {
    b.click();
    const v = document.getElementById('view-myalbums');
    out.after = { view: document.body.dataset.view, active: v.classList.contains('is-active'),
      hall: document.getElementById('view-hall').classList.contains('is-active') };
  } else {
    const before = document.body.dataset.view;
    b.click();
    out.after = { view: document.body.dataset.view, same: document.body.dataset.view === before,
      hall: document.getElementById('view-hall').classList.contains('is-active') };
  }
  return out;
})()`);
if (myNow.has) { await evalJs(`document.getElementById('btn-back').click()`); await sleep(700); }

/* ---------------- 8b. 运行中把视图藏起来 → 点了什么都不发生、不抛错 ---------------- */
const guard = await evalJs(`(() => {
  const hall = () => document.getElementById('view-hall').classList.contains('is-active');
  const before = { view: document.body.dataset.view, hall: hall() };
  const gid = Document.prototype.getElementById;
  let threw = '';
  Document.prototype.getElementById = function (id) {
    if (id === 'view-myalbums') return null;
    return gid.call(this, id);
  };
  try {
    const b = document.querySelector('#hall-tools [data-tool="myalbums"]');
    b.click();
    b.click();
  } catch (e) { threw = String(e && e.message || e); }
  Document.prototype.getElementById = gid;          // 立刻还原
  return { before, after: { view: document.body.dataset.view, hall: hall() }, threw };
})()`);

/* ---------------- 打印 ---------------- */
console.log('\n=== 1. 四项（' + row.innerW + 'px 宽屏）===');
console.log(JSON.stringify(row, null, 1));
console.log('\n=== 2/3. 工具箱浮层 ===');
console.log('开  ', JSON.stringify(popOpen));
console.log('Esc ', JSON.stringify(afterEsc));
console.log('再开', JSON.stringify({ hidden: reopened.hidden, open: reopened.open }));
console.log('再点工具箱', JSON.stringify(afterReclick));
console.log('点空白', JSON.stringify(blankPt), '→', JSON.stringify(afterBlank));
console.log('\n=== 4. 浮层「自动过渡」→ 实验室 ===');
console.log(JSON.stringify(afterXfade), '\n浮层随后', JSON.stringify(popAfterXfade));
console.log('\n=== 4b. 键盘路径 ===');
console.log('Tab 落点', JSON.stringify(tabLands), '→ Enter 开', JSON.stringify({ open: kbOpen.open, focusCls: kbOpen.focusCls }), '→ Enter', JSON.stringify(kbXfade));
console.log('\n=== 5. 形态长廊 ===');
console.log(JSON.stringify(stages), '关掉后 drawer.is-open =', drawerClosed);
console.log('\n=== 6. 音乐实验室 ===');
console.log(JSON.stringify(labDj));
console.log('\n=== 7. 窄屏 ===');
console.log(JSON.stringify(narrow));
console.log('\n=== 8a. 我的专辑（当前页面真实状态，视图在不在都认）===');
console.log(JSON.stringify(myNow));
console.log('=== 8b. 运行中把视图掐掉再点 ===');
console.log(JSON.stringify(guard));
console.log('\n=== console ===');
console.log('JS 错误/异常', consoleErrs.length, consoleErrs.slice(0, 6));
console.log('资源/网络层', netErrs.length, netErrs.slice(0, 4));
console.log('\n=== 9. 截图 ===');
console.log(shotRow + '\n' + shotPop + '\n' + shotNarrow);

/* ---------------- 断言 ---------------- */
let fail = 0;
const ok = (cond, msg) => { if (!cond) fail++; console.log((cond ? 'PASS ' : 'FAIL ') + msg); };

console.log('\n---- 断言 ----');
ok(row.n === 4, `1 入口行 4 项（实 ${row.n}）`);
ok(JSON.stringify(row.names) === JSON.stringify(['形态长廊', '我的专辑', '音乐实验室', '工具箱']),
  `1 顺序/文本：${JSON.stringify(row.names)}`);
ok(row.ids.join(',') === 'stage,myalbums,lab,box', `1 data-tool：${row.ids.join(' / ')}`);
ok(!row.hasLyric, `1 「歌词样式」不在这一行（textContent 含"歌词样式" = ${row.hasLyric}）`);
ok(!row.heading, `1 cell 没有标题行（hall-cell__h 存在 = ${row.heading}）`);
ok(row.height !== 0 && row.widths.every((w) => w > 100), `1 每列宽 ${row.widths.join(' / ')}px，行高 ${row.h}px`);
ok(row.spread <= 2, `2 四项同一行：top 差 ${row.spread}px（top = ${row.tops.join(' / ')}）`);
ok(row.innerW === 1440, `2 宽屏 innerWidth ${row.innerW}`);
ok(row.border0 === '1px solid', `2 行分隔线实绘（${row.border0}，圆角 ${row.radius0}，阴影 ${row.shadow0 || 'none'}）`);

ok(popOpen.exists && popOpen.open && popOpen.n === 1, `3 浮层打开，${popOpen.n} 项：${JSON.stringify(popOpen.names)}`);
ok(popOpen.expanded === 'true' && popOpen.haspopup === 'true', `3 宿主按钮 aria-expanded=${popOpen.expanded} / aria-haspopup=${popOpen.haspopup}`);
ok(popOpen.bg === 'rgb(255, 255, 255)' && popOpen.border === '1px solid' && popOpen.radius === '0px' && popOpen.shadow === 'none',
  `3 浮层视觉：背景 ${popOpen.bg} / 描边 ${popOpen.border} / 圆角 ${popOpen.radius} / 阴影 ${popOpen.shadow}`);
ok(popOpen.rect.w > 150 && popOpen.belowRow >= -1 && popOpen.belowRow <= 2 && Math.abs(popOpen.rightGap) <= 1,
  `3 浮层贴在第 4 项正下方：${popOpen.rect.w}×${popOpen.rect.h}，gap ${popOpen.belowRow}px，右缘差 ${popOpen.rightGap}px`);
ok(popOpen.focusIn === true, `3 打开就把焦点放进浮层（focus = ${JSON.stringify(popOpen.focusCls)}）`);
ok(afterEsc.hidden === true && afterEsc.expanded === 'false', `3a Esc 关闭：hidden=${afterEsc.hidden}，aria-expanded=${afterEsc.expanded}`);
ok(reopened.open === true, `3b 再点「工具箱」能再开（open=${reopened.open}）`);
ok(afterReclick.hidden === true, `3b 再点一次关闭（hidden=${afterReclick.hidden}）`);
ok(blankPt.inPop === false, `3c 空白落点 (${blankPt.x},${blankPt.y}) 命中 ${blankPt.hit}（不在浮层里）`);
ok(afterBlank.hidden === true, `3c 点页面空白处关闭（hidden=${afterBlank.hidden}）`);

ok(afterXfade.lab === true && afterXfade.hall === false, `4 点浮层「自动过渡」→ #view-lab 激活（lab=${afterXfade.lab}，hall=${afterXfade.hall}）`);
ok(afterXfade.paneXfade === true && afterXfade.paneDj === false && afterXfade.tabOn.join(',') === 'xfade',
  `4 停在 xfade 分页：#lab-pane-xfade.is-on=${afterXfade.paneXfade}，DJ=${afterXfade.paneDj}，tab=${afterXfade.tabOn.join(',')}`);
ok(popAfterXfade.hidden === true && popAfterXfade.expanded === 'false', `4 点完浮层自己关上（hidden=${popAfterXfade.hidden}）`);

ok(tabLands.tool === 'box', `4b Tab 从「音乐实验室」落到「工具箱」（落点 data-tool=${JSON.stringify(tabLands.tool)}）`);
ok(kbOpen.open === true && kbOpen.focusIn === true,
  `4b Enter 打开浮层，焦点已在第一项（open=${kbOpen.open}，focus=${JSON.stringify(kbOpen.focusCls)}）`);
ok(kbXfade.lab === true && kbXfade.dataView === 'lab' && kbXfade.paneXfade === true && kbXfade.tabOn.join(',') === 'xfade',
  `4b 再 Enter 触发「自动过渡」→ 实验室 xfade（lab=${kbXfade.lab}，data-view=${kbXfade.dataView}，pane-xfade=${kbXfade.paneXfade}，tab=${kbXfade.tabOn.join(',')}）`);
ok(stages.drawerOpen === true && stages.listHidden === false && stages.n > 10,
  `5 形态长廊 → 抽屉打开（${stages.drawerOpen}）+ 形态列表展开（${stages.n} 个，首个「${stages.first}」），大厅没被切走（${stages.hallStill}）`);
ok(drawerClosed === false, `5 收尾把抽屉关回去了（is-open=${drawerClosed}）`);
ok(labDj.lab === true && labDj.paneDj === true && labDj.paneXfade === false && labDj.tabOn.join(',') === 'dj',
  `6 音乐实验室 → #view-lab + DJ 台（pane-dj=${labDj.paneDj}，tab=${labDj.tabOn.join(',')}）`);

ok(narrow.innerW === 1024 && narrow.cols === 2 && narrow.rows === 2,
  `7 1024px：${narrow.cols} 列 × ${narrow.rows} 行（lefts=${JSON.stringify(narrow.lefts)} tops=${JSON.stringify(narrow.tops)}），列宽 ${narrow.widths.join(' / ')}`);
ok(narrow.hallOverflow <= 0 && narrow.docOverflow <= 0,
  `7 没有横向溢出：hall scrollWidth-clientWidth = ${narrow.hallOverflow}，document = ${narrow.docOverflow}`);

if (myNow.has) {
  ok(myNow.ariaDisabled === null && myNow.offClass === false,
    `8a 视图已落地 → 这一项可点（aria-disabled=${myNow.ariaDisabled}，is-off=${myNow.offClass}，cursor=${myNow.cursor}）`);
  ok(myNow.after.active === true && myNow.after.view === 'myalbums' && myNow.after.hall === false,
    `8a 点开 → #view-myalbums.is-active=${myNow.after.active}，data-view=${myNow.after.view}，大厅让位=${myNow.after.hall === false}`);
} else {
  ok(myNow.ariaDisabled === 'true' && myNow.offClass === true,
    `8a 视图没上 → 这一项置灰（aria-disabled=${myNow.ariaDisabled}，is-off=${myNow.offClass}，cursor=${myNow.cursor}）`);
  ok(myNow.after.same === true && myNow.after.hall === true,
    `8a 点了没反应也没报错（data-view 仍是 ${myNow.after.view}，大厅没走）`);
}

ok(guard.threw === '' && guard.before.view === guard.after.view && guard.before.hall === guard.after.hall,
  `8b 视图查不到时连点两下也没反应没报错：threw=${JSON.stringify(guard.threw)}，data-view ${guard.before.view} → ${guard.after.view}，大厅 ${guard.before.hall} → ${guard.after.hall}`);

ok(consoleErrs.length === 0, `9 0 console error / 0 未捕获异常（实 ${consoleErrs.length}）`);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAIL'}（${fail === 0 ? '看上面数字' : '看上面 FAIL 行'}）`);

ws.close();
proc.kill();
await sleep(400);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
if (fail) process.exitCode = 1;
