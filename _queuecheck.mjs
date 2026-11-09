/* 播放队列入口验收：抽屉里那一行 → 面板内歌词/队列互斥切换 → 排 / 计数 / 键盘 / 行内艺人链
   跑法：node _queuecheck.mjs（先起好 server，端口读 .port）
   注意：队列一律走公开 API Player.playQueue(...) 构造，不直接写 Player.state 内部字段。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CDP = 9413;
const profile = path.join(os.tmpdir(), 'lizi-queue-' + Date.now());
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = fs.readFileSync('.port', 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
  '--window-size=1440,1000', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function tabOf() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP 起不来');
}

try {
  const t = await tabOf();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } };
  const send = (method, params = {}) => { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise((r) => waiters.set(mid, r)); };
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) throw new Error((ex.exception && (ex.exception.description || ex.exception.value)) || ex.text || 'evaluate failed');
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const waitFor = async (expr, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await js(expr)) return true; await sleep(100); }
    return false;
  };
  const key = async (k, code, vk, modifiers = 0, text) => {
    const p = { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
    if (text !== undefined) { p.text = text; p.unmodifiedText = text; }
    await send('Input.dispatchKeyEvent', p);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
    await sleep(90);
  };
  /* 每次开/关队列都走真实入口：开抽屉 → 点那一行（点完抽屉自己收回） */
  const toggleQueueFromDrawer = async () => {
    const open = await js(`document.getElementById('drawer').classList.contains('is-open')`);
    if (!open) { await js(`document.getElementById('btn-drawer').click()`); await sleep(260); }
    await js(`document.getElementById('btn-queue').click()`);
    await sleep(320);
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  const errs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args.map((a) => a.value ?? a.description).join(' ')));
  });

  await send('Page.navigate', { url: `http://127.0.0.1:${port}/#now` });
  if (!await waitFor(`!!document.getElementById('btn-queue') && document.body.classList.contains('is-now')`, 10000)) {
    throw new Error('播放页 / 抽屉没起来');
  }
  await sleep(700);

  /* 1. 抽屉里那一行存在 */
  const rowInfo = await js(`(() => {
    const b = document.getElementById('btn-queue');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { tag: b.tagName, text: b.textContent.replace(/\\s+/g, ' ').trim(),
             w: Math.round(r.width), h: Math.round(r.height),
             controls: b.getAttribute('aria-controls'), pressed: b.getAttribute('aria-pressed'),
             count: (document.getElementById('queue-count') || {}).textContent };
  })()`);
  ok(!!rowInfo && rowInfo.tag === 'BUTTON' && rowInfo.text.includes('播放队列') && rowInfo.controls === 'queue',
    `抽屉里有「播放队列」行（${JSON.stringify(rowInfo)}）`);
  ok(rowInfo && rowInfo.count === '—', `空队列时计数是「—」（实 ${rowInfo && rowInfo.count}）`);

  /* 2. 用公开 API 造 5 首（不碰 Player.state 内部字段） */
  const built = await js(`(() => {
    const q = Array.from({ length: 5 }, (_, i) => ({
      id: 910000 + i,
      name: '队列测试 ' + (i + 1),
      // 第一首给可解析的歌手 id：renderQueue 会用它生成行内 <a>，后面要验"点艺人不播行"
      artists: i === 0 ? '测试艺人 / 二号' : '测试艺人',
      artistIds: i === 0 ? [911000] : null,
      duration: 180000 + i * 1000,
      album: '测试专辑',
      cover: '',
    }));
    window.__tc = 0;
    Player.on('trackchange', () => { window.__tc++; });
    Player.playQueue(q, 0, false);
    return { n: Player.state.queue.length, index: Player.state.index, tc: window.__tc };
  })()`);
  ok(built && built.n === 5 && built.index === 0, `playQueue 装入 5 首并从第 1 首开始（${JSON.stringify(built)}）`);
  ok(await waitFor(`document.getElementById('now-title').textContent === '队列测试 1'`, 3000),
    'trackchange 已把当前曲目画到播放页');

  /* 3. 键盘：抽屉打开时 Tab 能到这一行，回车能开 */
  await js(`document.getElementById('btn-drawer').click()`);
  await waitFor(`document.getElementById('drawer').classList.contains('is-open')`, 2000);
  const drawerState = await js(`(() => {
    const d = document.getElementById('drawer');
    return { open: d.classList.contains('is-open'), inert: !!d.inert, hidden: d.getAttribute('aria-hidden') };
  })()`);
  ok(drawerState.open && drawerState.inert === false && drawerState.hidden === 'false',
    `抽屉打开、可聚焦（inert=${drawerState.inert}）`);
  await js(`document.getElementById('btn-drawer').focus()`);
  let reached = false; let tabs = 0; let active = '';
  for (; tabs < 14; tabs++) {
    await key('Tab', 'Tab', 9);
    active = await js(`(document.activeElement && document.activeElement.id) || document.activeElement.tagName || ''`);
    if (active === 'btn-queue') { reached = true; break; }
  }
  ok(reached, `抽屉打开时 Tab ${tabs + 1} 次到达「播放队列」（activeElement=${active}）`);
  let activatedByEnter = false;
  if (reached) {
    await key('Enter', 'Enter', 13, 0, '\r');
    await sleep(400);
    activatedByEnter = await js(`document.getElementById('queue').hidden === false`);
  }
  if (!activatedByEnter) {
    await js(`document.getElementById('btn-queue').click()`);
    await sleep(400);
  }
  const openedByKey = await js(`document.getElementById('queue').hidden === false`);
  ok(openedByKey, `队列面板打开了（回车激活=${activatedByEnter}）`);

  /* 4. 打开后的面板 / 计数 / 行排版 */
  const s1 = await js(`(() => {
    const q = document.getElementById('queue');
    const rows = [...q.querySelectorAll('.qrow')];
    const first = rows[0];
    const box = first && first.getBoundingClientRect();
    const a = first && first.querySelector('.qrow__a a[data-aid]');
    return {
      queueHidden: q.hidden,
      lyricsHidden: document.getElementById('lyrics').hidden,
      pressed: document.getElementById('btn-queue').getAttribute('aria-pressed'),
      drawerExpanded: document.getElementById('btn-drawer').getAttribute('aria-expanded'),
      rows: rows.length,
      count: document.getElementById('queue-count').textContent,
      firstBox: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
      rowTag: first && first.tagName,
      rowRole: first && first.getAttribute('role'),
      rowTab: first && first.getAttribute('tabindex'),
      nestedButton: !!(first && first.closest('button')),
      artistLink: !!a,
      artistParentRow: !!(a && a.closest('.qrow') === first),
      current: q.querySelector('.qrow.is-on') && q.querySelector('.qrow.is-on').dataset.i,
      currentAria: first && first.getAttribute('aria-current'),
    };
  })()`);
  ok(s1.queueHidden === false && s1.lyricsHidden === true,
    `点开后队列可见、歌词让位（queue hidden=${s1.queueHidden} / lyrics hidden=${s1.lyricsHidden}）`);
  ok(s1.pressed === 'true', `按钮 aria-pressed=${s1.pressed}`);
  ok(s1.drawerExpanded === 'false', `打开后面板后抽屉自动收回（aria-expanded=${s1.drawerExpanded}）`);
  ok(s1.rows === 5, `队列渲染 5 行（实 ${s1.rows}）`);
  ok(s1.count === '5 首', `计数显示「${s1.count}」`);
  ok(s1.rowTag === 'DIV' && s1.rowRole === 'button' && s1.rowTab === '0',
    `行是 div[role=button][tabindex=0]（实 ${s1.rowTag} role=${s1.rowRole} tab=${s1.rowTab}）`);
  ok(!s1.nestedButton, `行内没有嵌套在原生 <button> 里（nestedButton=${s1.nestedButton}）`);
  ok(s1.artistLink && s1.artistParentRow, `行内有可点艺人链且留在行内（link=${s1.artistLink} inRow=${s1.artistParentRow}）`);
  ok(!!s1.firstBox && s1.firstBox.w > 200 && s1.firstBox.h >= 30, `行有排版（${JSON.stringify(s1.firstBox)}）`);
  ok(s1.current === '0' && s1.currentAria === 'true',
    `当前曲目行高亮 + aria-current（data-i=${s1.current} aria-current=${s1.currentAria}）`);

  /* 5. 点行内艺人名不该触发行播放（也不该播当前这首） */
  const artistClick = await js(`(() => {
    const a = document.querySelector('#queue .qrow .qrow__a a[data-aid]');
    const row = a && a.closest('.qrow');
    const before = { tc: window.__tc, index: Player.state.index, playing: Player.state.playing };
    if (!row) return { found: false, before, after: before, queueHidden: document.getElementById('queue').hidden };
    const aid = a.getAttribute('data-aid');
    a.removeAttribute('data-aid');   // 临时摘掉：别真的去请求歌手页，这条只验"行不该被播"
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    a.setAttribute('data-aid', aid);
    return { found: true, row: row.dataset.i, before,
             after: { tc: window.__tc, index: Player.state.index, playing: Player.state.playing },
             queueHidden: document.getElementById('queue').hidden };
  })()`);
  ok(artistClick.found, '找到行内艺人链（用于隔离测试）');
  ok(artistClick.before.tc === artistClick.after.tc && artistClick.before.index === artistClick.after.index,
    `点艺人名不触发行播放（trackchange ${artistClick.before.tc}→${artistClick.after.tc} / index ${artistClick.before.index}→${artistClick.after.index}）`);
  ok(artistClick.queueHidden === false, '点艺人名后面板还开着（没被行点击顺带切走）');

  /* 6. 再点一次切回歌词 */
  await toggleQueueFromDrawer();
  const s2 = await js(`(() => ({
    queueHidden: document.getElementById('queue').hidden,
    lyricsHidden: document.getElementById('lyrics').hidden,
    pressed: document.getElementById('btn-queue').getAttribute('aria-pressed'),
  }))()`);
  ok(s2.queueHidden === true && s2.lyricsHidden === false,
    `再点一次切回歌词（queue hidden=${s2.queueHidden} / lyrics hidden=${s2.lyricsHidden}）`);
  ok(s2.pressed === 'false', `按钮 aria-pressed 复位=${s2.pressed}`);

  /* 7. 关着面板换队列：切歌刷新计数；再打开必须重排 */
  const q6 = await js(`(() => {
    const q = Array.from({ length: 6 }, (_, i) => ({
      id: 920000 + i, name: '六首测试 ' + (i + 1), artists: '测试艺人',
      duration: 200000, album: '测试专辑', cover: '',
    }));
    Player.playQueue(q, 1, false);
    return { n: Player.state.queue.length, index: Player.state.index,
             rowsClosed: document.querySelectorAll('#queue .qrow').length,
             countClosed: document.getElementById('queue-count').textContent };
  })()`);
  ok(q6.n === 6 && q6.index === 1, `换队列到 6 首（${JSON.stringify(q6)}）`);
  ok(q6.rowsClosed === 5, `面板关着时不会白重排（行数仍 ${q6.rowsClosed}）`);
  ok(q6.countClosed === '6 首', `切歌时计数已刷新为「${q6.countClosed}」`);
  await toggleQueueFromDrawer();
  const s3 = await js(`(() => {
    const cur = document.querySelector('#queue .qrow.is-on');
    return {
      rows: document.querySelectorAll('#queue .qrow').length,
      count: document.getElementById('queue-count').textContent,
      cur: cur ? cur.dataset.i : null,
    };
  })()`);
  ok(s3.rows === 6, `重新打开时按最新队列重排（行数 ${s3.rows} / 队列长度 6）`);
  ok(s3.count === '6 首', `计数「${s3.count}」`);
  ok(s3.cur === '1', `当前行跟着 index 走（data-i=${s3.cur}）`);

  /* 8. 点队列行 → 播那首（复用 renderQueue 里已有的 playQueue 路径） */
  const tcBefore = await js(`window.__tc`);
  await js(`document.querySelector('#queue .qrow[data-i="3"]').click()`);
  await sleep(450);
  const s4 = await js(`(() => {
    const cur = document.querySelector('#queue .qrow.is-on');
    return { index: Player.state.index, tc: window.__tc, rows: document.querySelectorAll('#queue .qrow').length,
             cur: cur && cur.dataset.i, queueHidden: document.getElementById('queue').hidden };
  })()`);
  ok(s4.index === 3 && s4.tc > tcBefore, `点第 4 行播放那一首（index=${s4.index}, trackchange ${tcBefore}→${s4.tc}）`);
  ok(s4.cur === '3' && s4.rows === 6 && s4.queueHidden === false,
    `播放后当前行重排到第 4 行且面板还开着（cur=${s4.cur}, rows=${s4.rows}）`);
  await js(`Player.audio.pause()`);

  /* 8b. 行自己也要能用键盘播（role=button 不能只有鼠标能用） */
  await js(`document.querySelector('#queue .qrow[data-i="5"]').focus()`);
  await key('Enter', 'Enter', 13, 0, '\r');
  await sleep(450);
  const kb = await js(`Player.state.index`);
  ok(kb === 5, `键盘回车播焦点行（index=${kb}）`);
  await js(`document.querySelector('#queue .qrow[data-i="3"]').click()`);
  await sleep(450);
  await js(`Player.audio.pause()`);

  /* 9. Esc 收回歌词（不能把整页切走） */
  await js(`document.querySelector('#queue .qrow[data-i="3"]').focus()`);
  await key('Escape', 'Escape', 27);
  const s5 = await js(`(() => ({
    queueHidden: document.getElementById('queue').hidden,
    lyricsHidden: document.getElementById('lyrics').hidden,
    pressed: document.getElementById('btn-queue').getAttribute('aria-pressed'),
    stillNow: document.body.classList.contains('is-now') && document.getElementById('view-now').classList.contains('is-active'),
    active: document.activeElement && document.activeElement.id,
    activeInQueue: !!(document.activeElement && document.activeElement.closest('#queue')),
  }))()`);
  ok(s5.queueHidden === true && s5.lyricsHidden === false && s5.pressed === 'false',
    `Esc 关掉队列回到歌词（queue=${s5.queueHidden} / lyrics=${s5.lyricsHidden} / pressed=${s5.pressed}）`);
  ok(s5.stillNow, `Esc 只收面板，没有把播放页切走（stillNow=${s5.stillNow}）`);
  ok(!s5.activeInQueue, `Esc 后焦点没留在隐藏的行里（active=${s5.active}）`);

  /* 10. 离开播放页自动收回歌词态 */
  await toggleQueueFromDrawer();
  const beforeLeave = await js(`document.getElementById('queue').hidden`);
  await js(`document.getElementById('btn-back').click()`);
  await sleep(500);
  const s6 = await js(`(() => ({
    queueHidden: document.getElementById('queue').hidden,
    lyricsHidden: document.getElementById('lyrics').hidden,
    pressed: document.getElementById('btn-queue').getAttribute('aria-pressed'),
    isNow: document.body.classList.contains('is-now'),
  }))()`);
  ok(beforeLeave === false, '离开前队列是开着的（保证这条测的是"自动收回"）');
  ok(s6.queueHidden === true && s6.lyricsHidden === false && s6.pressed === 'false' && !s6.isNow,
    `离开播放页自动收回（queue=${s6.queueHidden} / lyrics=${s6.lyricsHidden} / isNow=${s6.isNow}）`);

  /* 11. 回播放页：默认还是歌词；再开队列截图 */
  await js(`document.getElementById('btn-open-now').click()`);
  await waitFor(`document.body.classList.contains('is-now')`, 3000);
  await sleep(500);
  const backState = await js(`(() => ({
    queueHidden: document.getElementById('queue').hidden,
    lyricsHidden: document.getElementById('lyrics').hidden,
  }))()`);
  ok(backState.queueHidden === true && backState.lyricsHidden === false,
    `回到播放页默认是歌词（queue=${backState.queueHidden}）`);

  await toggleQueueFromDrawer();
  await sleep(500);
  /* 关抽屉时若焦点留在里面，#view-now 会被滚走 184px（右边只剩白）。回归守卫： */
  const shifted = await js(`document.getElementById('view-now').scrollLeft`);
  ok(shifted === 0, `播放页没有被横推（view-now.scrollLeft=${shifted}）`);
  fs.mkdirSync('shots/review', { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('shots/review/queue-1-open.png', Buffer.from(shot.result.data, 'base64'));
  console.log('SHOT shots/review/queue-1-open.png');

  const finalRows = await js(`document.querySelectorAll('#queue .qrow').length`);
  ok(finalRows === 6, `截图时队列仍是最新 6 行（实 ${finalRows}）`);

  /* 12. console error / 未捕获异常 */
  ok(errs.length === 0, `console error / 异常 ${errs.length} 条`);
  if (errs.length) console.log(errs.slice(0, 8).join('\n'));

  console.log(`\n${fails ? 'FAIL' : 'OK'} — ${fails} 条失败`);
  process.exitCode = fails ? 1 : 0;
} finally {
  try { ws && ws.close(); } catch {}
  try { proc.kill(); } catch {}
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
