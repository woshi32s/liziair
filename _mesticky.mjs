/* 吸底卡实测（新方向：信息行钉视口底，封面在它上面往上长）
   —— 大厅「我的」卡：滚到卡片 → 信息行吸底 → 继续滚 = 封面长出来 → 长满才滚走。
   跑法：node _mesticky.mjs

   6 家平台用 window.LIZI_ACCOUNTS 造真（accounts.js 那条注释里给的验收路子），
   不碰产品代码；第二次加载切成「全未登录」验示例卡（uid 1）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT_CDP = 9412;
const profile = path.join(os.tmpdir(), 'lizi-mesticky-' + Date.now());
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const portFile = fs.readFileSync('.port', 'utf8').trim();
const URL_ = `http://127.0.0.1:${portFile}/`;
const SHOTS = 'shots/review';

/* 6 家平台的假登录态：check 全 true、detail 给同一形状的模型（高度一致才量得准） */
const MOCK = `
(() => {
  /* mode 存 sessionStorage：第二次加载（验示例卡）要在新文档里也关掉登录态 */
  window.__MEF = { mode: sessionStorage.getItem('mef.mode') || 'on', demoUid: null };
  const PLAT = [['netease','网易云','#c20c0c'],['qq','QQ 音乐','#31c27c'],['kugou','酷狗','#2ca2f9'],
    ['qishui','汽水','#111111'],['bodian','波点','#7b61ff'],['spotify','Spotify','#1db954']];
  const model = (name, i) => ({
    nickname: name + ' · 阿丽塔', avatar: '', banner: '',
    level: 7 + i, vip: i % 2 === 0,
    stats: [{ n: 128 + i, label: '歌单' }, { n: 3400 + i * 10, label: '关注' }, { n: 12000 + i, label: '粉丝' }],
    sign: '这里是个性签名，用来把信息行撑到正常高度。', meta: ['2019 年加入', '认证音乐人'],
  });
  const list = PLAT.map(([id, name, accent], i) => ({
    id, name, accent,
    async check() {
      if (window.__MEF.mode !== 'on') return { loggedIn: false };
      return { loggedIn: true, key: 'k' + i, nickname: name + ' 用户', avatar: '', vip: i % 2 === 0 };
    },
    async detail(key) {
      if (window.__MEF.mode !== 'on') {
        if (id !== 'netease') return null;
        window.__MEF.demoUid = String(key);          // 示例卡应该拿 uid 1
        return model('网易云', 0);
      }
      return model(name, i);
    },
  }));
  Object.defineProperty(window, 'LIZI_ACCOUNTS', { configurable: true, get: () => list, set: () => {} });
})();
`;

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
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result && r.result.result ? r.result.result.value : null;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
await send('Page.navigate', { url: URL_ });
await sleep(1400);

/* 等 6 张平台卡挂上（账号是假的，不用等边车） */
let slides = 0;
for (let i = 0; i < 80; i++) {
  slides = (await evalJs(`document.querySelectorAll('#hall-me .me__slide').length`)) || 0;
  if (slides >= 6) break;
  await sleep(250);
}
await sleep(900);

/* ---------------- 量具 ---------------- */
const PROBE = `(() => {
  const sv = document.querySelector('#view-hall');
  const wrap = document.querySelector('#hall-me .me-wrap');
  const me = document.querySelector('#hall-me .me');
  const cells = [...document.querySelectorAll('.hall-rail .hall-cell')];
  const at = cells.findIndex((c) => c.classList.contains('hall-cell--me'));
  const meCell = cells[at], prevCell = cells[at - 1], dailyCell = cells[at + 1];
  const daily = document.querySelector('#hall-daily');
  const hero = document.querySelector('#hall-hero');
  const vr = sv.getBoundingClientRect();
  const mr = me.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(me).bottom) || 0;
  const pin = vr.bottom - gap;
  return {
    st: Math.round(sv.scrollTop),
    cover: +(parseFloat(wrap.style.getPropertyValue('--me-cover-h')) || 150).toFixed(1),
    p: +(parseFloat(wrap.style.getPropertyValue('--me-p')) || 0).toFixed(3),
    pin: +pin.toFixed(1),
    top: +mr.top.toFixed(1), bottom: +mr.bottom.toFixed(1), h: +mr.height.toFixed(1),
    err: +(mr.bottom - pin).toFixed(1),
    heroBottom: +hero.getBoundingClientRect().bottom.toFixed(1),
    blank: +(mr.top - prevCell.getBoundingClientRect().bottom).toFixed(1),
    cellGap: +(mr.top - meCell.getBoundingClientRect().top).toFixed(1),
    dailyGap: +(dailyCell.getBoundingClientRect().top - mr.bottom).toFixed(1),
    dailyTop: +daily.getBoundingClientRect().top.toFixed(1),
    viewBottom: +vr.bottom.toFixed(1),
    playerH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--player-h')) || 0,
    innerH: innerHeight,
  };
})()`;

const scrollTo = async (y) => {
  await evalJs(`(() => { const v = document.querySelector('#view-hall'); v.scrollTop = ${y}; v.dispatchEvent(new Event('scroll')); return v.scrollTop; })()`);
  await sleep(280);
};
const probe = () => evalJs(PROBE);
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(SHOTS, name);
  fs.writeFileSync(p, Buffer.from(s.result.data, 'base64'));
  return p + ' (' + Math.round(fs.statSync(p).size / 1024) + ' KB)';
};

/* ---------------- 1. 静止 ---------------- */
await scrollTo(0);
const rest = await probe();
/* 找「底边刚贴上吸底线」的滚动位置（封面还没开始长） */
const pinFind = await evalJs(`(() => {
  const sv = document.querySelector('#view-hall');
  const me = document.querySelector('#hall-me .me');
  const wrap = document.querySelector('#hall-me .me-wrap');
  const pin = () => { const vr = sv.getBoundingClientRect(); return vr.bottom - (parseFloat(getComputedStyle(me).bottom) || 0); };
  const cov = () => parseFloat(wrap.style.getPropertyValue('--me-cover-h')) || 150;
  for (let y = 0; y <= 3000; y += 2) {
    sv.scrollTop = y;
    if (Math.abs(me.getBoundingClientRect().bottom - pin()) <= 1.2) {
      const r = { y, cover: +cov().toFixed(1), bottom: +me.getBoundingClientRect().bottom.toFixed(1), pin: +pin().toFixed(1) };
      sv.scrollTop = 0;
      return r;
    }
  }
  sv.scrollTop = 0;
  return null;
})()`);

/* ---------------- 2. 吸底开始 ---------------- */
const pinY = pinFind ? pinFind.y : 0;
await scrollTo(pinY);
const pinState = await probe();

/* ---------------- 3. 吸底中（+90px） ---------------- */
await scrollTo(pinY + 90);
const mid = await probe();

/* ---------------- 4. 封面到底，再滚 100px ---------------- */
await scrollTo(pinY + 184);
const full = await probe();
await scrollTo(pinY + 284);
const after = await probe();

/* 中途每 30px 采样一次：证明没有「吸住但封面不动」的死区 */
const sweep = [];
for (let d = 0; d <= 180; d += 30) {
  await scrollTo(pinY + d);
  const s = await probe();
  sweep.push({ d, cover: s.cover, err: s.err });
}

/* ---------------- 5. 反向滚回 ---------------- */
await scrollTo(pinY);
const backPin = await probe();
await scrollTo(0);
const back = await probe();

/* ---------------- 8. 截图 ---------------- */
await scrollTo(0);
const shotRest = await shot('me-9-rest.png');
await scrollTo(pinY + 90);
const shotPin = await shot('me-10-pin.png');
await scrollTo(pinY + 184);
const shotFull = await shot('me-11-full.png');

/* ---------------- 6. 轮播回归（6 家全登录） ---------------- */
await scrollTo(pinY);
const carBefore = await evalJs(`(() => {
  const tr = document.querySelector('#hall-me .me__track');
  const on = document.querySelector('#hall-me .me__slide.is-on');
  return {
    x: +new DOMMatrixReadOnly(getComputedStyle(tr).transform).m41.toFixed(1),
    n: document.querySelectorAll('#hall-me .me__slide').length,
    navHidden: [...document.querySelectorAll('#hall-me [data-me-nav]')].map((b) => b.hidden),
    badge: ((on && on.querySelector('.me__pl')) || {}).textContent || '',
    platform: document.querySelector('#hall-me .me').dataset.platform || '',
    stored: localStorage.getItem('lizi.hall.me.platform') || '',
  };
})()`);
await evalJs(`document.querySelector('#hall-me [data-me-nav="1"]').click()`);
await sleep(520);
const carAfter = await evalJs(`(() => {
  const tr = document.querySelector('#hall-me .me__track');
  const on = document.querySelector('#hall-me .me__slide.is-on');
  return {
    x: +new DOMMatrixReadOnly(getComputedStyle(tr).transform).m41.toFixed(1),
    badge: ((on && on.querySelector('.me__pl')) || {}).textContent || '',
    platform: document.querySelector('#hall-me .me').dataset.platform || '',
    stored: localStorage.getItem('lizi.hall.me.platform') || '',
  };
})()`);

/* ---------------- 7. 其它回归 ---------------- */
/* 大厅下滑推荐歌单 */
const feedMax = await evalJs(`(() => { const v = document.querySelector('#view-hall'); v.scrollTop = v.scrollHeight; return v.scrollTop; })()`);
await sleep(1200);
const feed = await evalJs(`(() => {
  const v = document.querySelector('#view-hall');
  return { st: Math.round(v.scrollTop), max: Math.round(v.scrollHeight - v.clientHeight),
    n: document.querySelectorAll('#hall-feed .hall-pl').length };
})()`);
/* 海报悬停（只验 class，细节归另一个代理） */
const heroHover = await evalJs(`(() => {
  const h = document.querySelector('#hall-hero');
  h.dispatchEvent(new PointerEvent('pointerenter'));
  const on = h.classList.contains('is-hover');
  h.dispatchEvent(new PointerEvent('pointerleave'));
  return { on, off: !h.classList.contains('is-hover') };
})()`);
/* 实验室 */
await scrollTo(0);
await evalJs(`document.querySelector('#hall-tools [data-tool="lab"]').click()`);
await sleep(500);
const lab = await evalJs(`(() => ({
  lab: document.getElementById('view-lab').classList.contains('is-active'),
  hallOff: !document.getElementById('view-hall').classList.contains('is-active'),
}))()`);
await evalJs(`document.getElementById('btn-back').click()`);
await sleep(600);
const backHall = await evalJs(`document.getElementById('view-hall').classList.contains('is-active')`);
/* 歌手页：有真入口就点真入口，没有就走 lizi:show（两条都是产品自己的路） */
const artistPath = await evalJs(`(() => {
  const a = document.querySelector('#hall-daily [data-aid], #hall-feed [data-aid]');
  if (a) { a.click(); return 'link:' + a.textContent; }
  document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view: 'artist' } }));
  return 'event:lizi:show';
})()`);
let artistOn = false;
for (let i = 0; i < 20; i++) {
  artistOn = await evalJs(`document.getElementById('view-artist').classList.contains('is-active')`);
  if (artistOn) break;
  await sleep(250);
}
if (!(await evalJs(`document.getElementById('view-hall').classList.contains('is-active')`))) {
  await evalJs(`document.getElementById('btn-back').click()`);
  await sleep(600);
}
const hallBackAgain = await evalJs(`document.getElementById('view-hall').classList.contains('is-active')`);
/* 回到大厅后吸底卡还得是静止态 */
await scrollTo(0);
const backHome = await probe();

/* ---------------- 第二条命：全未登录 → 示例卡（uid 1） ---------------- */
await evalJs(`sessionStorage.setItem('mef.mode', 'off'); try { localStorage.removeItem('lizi.hall.me.cache.v1'); } catch (e) {}`);
await send('Page.navigate', { url: URL_ });
await sleep(1500);
let demo = null;
for (let i = 0; i < 60; i++) {
  demo = await evalJs(`(() => {
    const tag = document.querySelector('#hall-me .me__demo-tag');
    const n = document.querySelectorAll('#hall-me .me__slide').length;
    const tr = document.querySelector('#hall-me .me__track');
    return { demo: tag ? tag.textContent.trim() : '', n,
      name: ((document.querySelector('#hall-me .me__name') || {}).textContent || ''),
      x: tr ? +new DOMMatrixReadOnly(getComputedStyle(tr).transform).m41.toFixed(1) : null,
      uid: window.__MEF.demoUid };
  })()`);
  if (demo && demo.demo) break;
  await sleep(300);
}

/* ---------------- 打印 ---------------- */
console.log('\n=== 1. 静止（scrollTop 0）===');
console.log(JSON.stringify(rest, null, 1));
console.log(`   视口 ${rest.innerH} / 播放条 ${rest.playerH} / 滚动区底 ${rest.viewBottom} → 吸底线 ${rest.pin}`);
console.log('\n=== 2. 吸底开始（y=' + pinY + '）===');
console.log(JSON.stringify(pinState, null, 1));
console.log('\n=== 3. 吸底中（y=' + (pinY + 90) + '）===');
console.log(JSON.stringify(mid, null, 1));
console.log('\n=== 4. 封面到底（y=' + (pinY + 184) + ' / +100 → y=' + (pinY + 284) + '）===');
console.log('full ', JSON.stringify(full));
console.log('after', JSON.stringify(after));
console.log('\n=== 每 30px 采样（有没有「吸住但封面不动」的死区）===');
console.log(sweep.map((s) => `+${s.d}:${s.cover}/err${s.err}`).join('  '));
console.log('\n=== 5. 反向滚回 ===');
console.log('backPin', JSON.stringify(backPin));
console.log('back   ', JSON.stringify(back));
console.log('\n=== 6. 轮播 ===');
console.log('before', JSON.stringify(carBefore));
console.log('after ', JSON.stringify(carAfter));
console.log('\n=== 7. 其它回归 ===');
console.log('feed', JSON.stringify(feed), 'scrollTo(max)', feedMax);
console.log('heroHover', JSON.stringify(heroHover));
console.log('lab', JSON.stringify(lab), 'back→hall', backHall);
console.log('artist', artistPath, 'is-active', artistOn, 'back→hall', hallBackAgain);
console.log('backHome', JSON.stringify(backHome));
console.log('\n=== 示例卡（全未登录，第二次加载）===');
console.log(JSON.stringify(demo));
console.log('\n=== console ===');
console.log('JS 错误/异常', consoleErrs.length, consoleErrs.slice(0, 6));
console.log('资源/网络层', netErrs.length, netErrs.slice(0, 4));
console.log('\n=== 8. 截图 ===');
console.log(shotRest, '\n' + shotPin, '\n' + shotFull);

/* ---------------- 断言 ---------------- */
let fail = 0;
const ok = (cond, msg) => { if (!cond) fail++; console.log((cond ? 'PASS ' : 'FAIL ') + msg); };

console.log('\n---- 断言 ----');
ok(slides >= 6, `6 家平台卡都在（实 ${slides} 张）`);
/* 1 */
ok(Math.abs(rest.cover - 150) <= 1, `1 静止封面 ${rest.cover}px（应 150）`);
ok(rest.blank <= 40, `1 卡片上方空白带 ${rest.blank}px（上一节内容底 → 卡片顶，应 ≤40；本节内距 ${rest.cellGap}px）`);
ok(rest.dailyGap >= 0 && rest.dailyGap <= 120, `1 静止时卡片底边到「本日推荐」${rest.dailyGap}px（应正常节距 0~120）`);
ok(rest.err > 20 && rest.top > rest.heroBottom, `1 静止时没吸底（底边在吸底线下 ${rest.err}px，卡片顶 ${rest.top} 在海报底 ${rest.heroBottom} 之下）`);
/* 2 */
ok(!!pinFind, `2 找到了「底边贴上吸底线」的位置 y=${pinY}`);
ok(Math.abs(pinState.err) <= 2, `2 吸底开始：卡片底边 ${pinState.bottom} / 吸底线 ${pinState.pin}，差 ${pinState.err}px（应 ≤2）`);
ok(Math.abs(pinState.err) <= 2 && Math.abs(pinState.pin - (pinState.innerH - pinState.playerH - 16)) <= 2,
  `2 吸底线 = 视口底 ${pinState.innerH} − 播放条 ${pinState.playerH} − 16 = ${(pinState.innerH - pinState.playerH - 16).toFixed(1)}（实测 ${pinState.pin}；滚动区底 ${pinState.viewBottom} 已经让掉播放条）`);
ok(Math.abs(pinState.cover - 150) <= 3, `2 吸底开始时封面还是 ${pinState.cover}px（应 150）`);
/* 3 */
ok(mid.cover > 150 && mid.cover < 330, `3 再滚 90px 封面 ${mid.cover}px（应 150~330 之间）`);
ok(Math.abs(mid.err) <= 2, `3 吸底中卡片底边仍钉住（${mid.bottom} vs ${mid.pin}，差 ${mid.err}px）`);
ok(mid.top < pinState.top - 60, `3 卡片顶边上移：${pinState.top} → ${mid.top}px（应更小）`);
/* 4 */
ok(Math.abs(full.cover - 330) <= 1, `4 封面到底 ${full.cover}px（应 = 330）`);
ok(after.err < -50, `4 再滚 100px 卡片底边离开视口底：${full.bottom} → ${after.bottom}（差 ${after.err}px，应变负）`);
ok(after.cover <= 331, `4 松手后封面回落到封顶值 ${after.cover}px`);
/* 没有死区：每 30px 至少长 24px */
{
  let worst = 999;
  for (let i = 1; i < sweep.length; i++) worst = Math.min(worst, sweep[i].cover - sweep[i - 1].cover);
  ok(worst >= 24, `4 吸底段没有空转死区：每滚 30px 封面最少长 ${worst.toFixed(1)}px（1:1 应 ≈30）`);
}
/* 5 */
ok(Math.abs(back.cover - rest.cover) <= 2 && Math.abs(back.top - rest.top) <= 2
  && Math.abs(back.err - rest.err) <= 2 && Math.abs(back.dailyTop - rest.dailyTop) <= 2,
  `5 滚回静止可逆：封面 ${rest.cover}→${back.cover} / 顶边 ${rest.top}→${back.top} / 底边差 ${rest.err}→${back.err} / 推荐位 ${rest.dailyTop}→${back.dailyTop}`);
ok(Math.abs(backPin.top - pinState.top) <= 2 && Math.abs(backPin.err) <= 2,
  `5 反向经过吸底点也一致：顶边 ${backPin.top}（去程 ${pinState.top}）、底边差 ${backPin.err}px`);
/* 6 */
ok(carBefore.n === 6, `6 六家全登录时 6 张卡（实 ${carBefore.n}）`);
ok(carBefore.navHidden.every((h) => h === false), `6 左右箭头都出现（hidden = ${JSON.stringify(carBefore.navHidden)}）`);
ok(Math.abs(carAfter.x - carBefore.x) > 100, `6 切换后 translateX ${carBefore.x} → ${carAfter.x}（Δ ${(carAfter.x - carBefore.x).toFixed(1)}px，应 >100）`);
ok(carAfter.badge !== carBefore.badge && carAfter.platform !== carBefore.platform,
  `6 平台标记跟着换：「${carBefore.badge}」→「${carAfter.badge}」，data-platform ${carBefore.platform} → ${carAfter.platform}`);
ok(carAfter.stored !== '' && carAfter.stored === carAfter.platform,
  `6 记住的平台 id 写进 localStorage：${carAfter.stored}`);
/* 7 */
ok(feed.n > 0 && feed.st > 500, `7 大厅下滑推荐歌单还能滚：scrollTop ${feed.st}/${feed.max}，${feed.n} 张`);
ok(heroHover.on && heroHover.off, `7 #hall-hero 能起 hover class 且能收回（${heroHover.on}/${heroHover.off}）`);
ok(lab.lab && lab.hallOff, `7 点工具箱「音乐实验室」→ #view-lab 打开（${lab.lab}），大厅让位（${lab.hallOff}）`);
ok(backHall, '7 顶栏返回键能回大厅');
ok(artistOn, `7 #view-artist 能开（入口 ${artistPath}）`);
ok(hallBackAgain, '7 从歌手页返回大厅');
ok(Math.abs(backHome.cover - 150) <= 1 && backHome.err > 20,
  `7 离开再回大厅，吸底卡回到静止（封面 ${backHome.cover}px，底边在吸底线下 ${backHome.err}px）`);
ok(consoleErrs.length === 0, `7 0 console error / 0 未捕获异常（实 ${consoleErrs.length}）`);
/* 示例卡 */
ok(demo && demo.demo === '示例' && demo.n === 1, `示例卡：未登录时 1 张卡并标「示例」（${JSON.stringify(demo)}）`);
ok(demo && demo.uid === '1', `示例卡拿的是官方号 uid 1（实际 detail(${demo && demo.uid})）`);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAIL'}（${fail === 0 ? '' : '看上面 FAIL 行'})`);

ws.close();
proc.kill();
await sleep(400);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
if (fail) process.exitCode = 1;
