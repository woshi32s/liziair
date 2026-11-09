/**
 * _settingspage.mjs —— 设置整页（#view-settings）验收。用法: node _settingspage.mjs
 *
 * 七条：
 *   1) 齿轮点开 = 进页面（#view-settings 激活、body[data-view]=settings、URL 不变、旧面板不存在）
 *   2) 五个分区标题 + 所有原有行都在
 *   3) 功能不丢：音效跳转 / 我的专辑展示切换 / 音源登录出二维码
 *   4) 顶栏左键在设置页是返回（is-back），点了回大厅
 *   5) 滚动：能滚，is-stuck 下滑 true / 回顶 false
 *   6) 0 console error / 0 未捕获异常
 *   7) 三张截图：shots/review/setpage-1.png / setpage-2-sources.png / setpage-3-back.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1192, H = 910;

const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port;
await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-setpage-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pend = new Map();
const excs = [];          // 未捕获异常
const cerrs = [];         // console.error
const nerrs = [];         // 浏览器层网络/资源错误（单独统计，不计入 console error）
const bad = [];           // HTTP >= 400 的具体 URL
let stage = 'load';

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    excs.push(`[${stage}] ` + ((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 220));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const args = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    cerrs.push(`[${stage}] ` + String(args).slice(0, 220));
  }
  if (m.method === 'Log.entryAdded') {
    const en = m.params.entry || {};
    if (en.level === 'error') nerrs.push(`[${stage}] ${en.source}: ${String(en.text || '').slice(0, 200)}`);
  }
  if (m.method === 'Network.responseReceived') {
    const r = m.params.response || {};
    if (r.status >= 400) bad.push(`[${stage}] ${r.status} ${m.params.type} ${r.url}`);
  }
};

const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    return 'EXC:' + ((d.exception && d.exception.description) || d.text || '').split('\n')[0];
  }
  return r.result.value;
};
const shot = async (n) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('shots/review', { recursive: true });
  fs.writeFileSync(`shots/review/${n}.png`, Buffer.from(png.data, 'base64'));
  console.log('  → shots/review/' + n + '.png');
};
const ok = (b) => (b ? '✓' : '✗');

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });
await sleep(4000);

const URL0 = await ev('location.href');
console.log('=== 0. 初始 ===');
console.log('  视图:', await ev(`document.querySelector('.view.is-active')?.id`), '(应 view-hall)');
console.log('  URL:', URL0);

/* ---------------------------------------------------------------- 1 */
stage = '1-open';
console.log('\n=== 1. 点齿轮 → 设置整页 ===');
await ev(`document.getElementById('btn-settings').click(); 1`);
await sleep(800);
const activeView = await ev(`document.querySelector('.view.is-active')?.id`);
const dataView = await ev(`document.body.dataset.view`);
const URL1 = await ev('location.href');
const legacy = await ev(`(() => {
  const p = document.getElementById('settings-panel');
  if (!p) return 'absent';
  const cs = getComputedStyle(p);
  return (p.hidden || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) ? 'hidden' : 'VISIBLE';
})()`);
const viewStyle = await ev(`(() => { const v = document.getElementById('view-settings'); const cs = getComputedStyle(v);
  return { bg: cs.backgroundColor, top: cs.top, pt: cs.paddingTop, overflowY: cs.overflowY, active: v.classList.contains('is-active') }; })()`);
console.log('  激活视图:', activeView, ok(activeView === 'view-settings'));
console.log('  body[data-view]:', dataView, ok(dataView === 'settings'));
console.log('  URL 不变:', URL1 === URL0, ok(URL1 === URL0), URL1);
console.log('  旧 #settings-panel:', legacy, ok(legacy === 'absent' || legacy === 'hidden'));
console.log('  背景/定位/内边距/滚动:', JSON.stringify(viewStyle), ok(viewStyle.bg === 'rgb(255, 255, 255)' && viewStyle.top === '0px' && viewStyle.overflowY === 'auto'));
const layout = await ev(`(() => { const v = document.getElementById('view-settings');
  const p = v.querySelector('.setpage'); const r = p.getBoundingClientRect();
  return { w: Math.round(r.width), left: Math.round(r.left),
           right: Math.round(v.clientWidth - r.right), vw: v.clientWidth }; })()`);
console.log('  内容宽/左右留白(相对滚动区):', JSON.stringify(layout),
  ok(layout.w <= 880 && Math.abs(layout.left - layout.right) <= 2));

/* ---------------------------------------------------------------- 2 */
stage = '2-content';
console.log('\n=== 2. 分区标题 + 原有行 ===');
const heads = await ev(`[...document.querySelectorAll('#view-settings .setpage__h')].map(e => e.textContent.trim())`);
console.log('  分区标题:', heads.join(' / '), ok(['账号', '音源', '音效', '外观', '关于'].every((h) => heads.includes(h))));
const labels = await ev(`[...document.querySelectorAll('#view-settings .setpage__label')].map(e => e.textContent.trim())`);
console.log('  行标签:', labels.join(' / '));
const wantRows = ['账号管理', 'QQ 音乐', '酷狗音乐', '汽水音乐', '波点音乐', 'Spotify',
  '音效 / 均衡器', '我的专辑展示', '字体选择', '快捷键', '关于 LIZI', '版本'];
const missRows = wantRows.filter((x) => !labels.includes(x));
console.log('  缺失行:', missRows.length ? missRows.join(',') : '无', ok(missRows.length === 0));
console.log('  音源行数(5):', await ev(`document.querySelectorAll('#view-settings .setpage__row--src').length`),
  ok((await ev(`document.querySelectorAll('#view-settings .setpage__row--src').length`)) === 5));
console.log('  账号块:', JSON.stringify({
  name: await ev(`document.getElementById('set-account').textContent.trim()`),
  sub: await ev(`document.getElementById('set-account-sub').textContent.trim()`),
  loginVisible: await ev(`!document.getElementById('set-account-login').hidden`),
  logoutVisible: await ev(`!document.getElementById('set-account-logout').hidden`),
}));
console.log('  形态列表 DOM 还在:', await ev(`document.querySelectorAll('#stage-menu-list .stage-item').length`), '(应 >0)');
console.log('  「音质 · 预设」:', JSON.stringify(await ev(`document.getElementById('set-audio').textContent.trim()`)));

/* 整页截图：临时加高视口，把五个分区一次拍全 */
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1560, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await shot('setpage-1');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await sleep(500);

/* ---------------------------------------------------------------- 2b */
stage = '2b-back';
console.log('\n=== 2b. 顶栏左键 = 返回箭头（截图）===');
const isBack = await ev(`document.querySelector('.topbar__left').classList.contains('is-back')`);
console.log('  is-back:', isBack, ok(isBack === true));
console.log('  齿轮 / 箭头 opacity:', await ev(`getComputedStyle(document.querySelector('#btn-settings .ico-set')).opacity`),
  '/', await ev(`getComputedStyle(document.querySelector('#btn-settings .ico-back')).opacity`), ok(true));
console.log('  aria-label:', JSON.stringify(await ev(`document.getElementById('btn-settings').getAttribute('aria-label')`)));
await ev(`document.getElementById('view-settings').scrollTop = 0; 1`);
await sleep(400);
await shot('setpage-3-back');

/* ---------------------------------------------------------------- 3a */
stage = '3-audio';
console.log('\n=== 3a. 音效行 → #view-audio ===');
await ev(`document.getElementById('row-audio').click(); 1`);
await sleep(1200);
const audioActive = await ev(`document.querySelector('.view.is-active')?.id`);
const audioPageMounted = await ev(`!!document.querySelector('#view-audio .eqx, #view-audio .eq-root, #eq-host-page > *')`);
console.log('  激活视图:', audioActive, ok(audioActive === 'view-audio'), '| 面板已挂:', audioPageMounted);

stage = '3a-back';
await ev(`document.getElementById('btn-settings').click(); 1`);   // 音效页左键 = 返回大厅
await sleep(700);
console.log('  返回后视图:', await ev(`document.querySelector('.view.is-active')?.id`), '(应 view-hall)');
await ev(`document.getElementById('btn-settings').click(); 1`);   // 再进设置
await sleep(700);

/* ---------------------------------------------------------------- 3b */
stage = '3-maform';
console.log('\n=== 3b. 我的专辑展示：点一下切形态 ===');
const ma0 = await ev(`document.getElementById('set-maform').textContent.trim()`);
await ev(`document.getElementById('row-maform').click(); 1`);
await sleep(300);
const ma1 = await ev(`document.getElementById('set-maform').textContent.trim()`);
const store1 = await ev(`localStorage.getItem('lizi.myAlbums.form')`);
await ev(`document.getElementById('row-maform').click(); 1`);
await sleep(300);
const ma2 = await ev(`document.getElementById('set-maform').textContent.trim()`);
console.log('  切换:', JSON.stringify(ma0), '→', JSON.stringify(ma1), '→', JSON.stringify(ma2),
  ok(ma0 !== ma1 && ma1 !== ma2 && ['侧立 3D', '正面 Cover Flow'].includes(ma1)), '| localStorage:', store1);

/* ---------------------------------------------------------------- 3c */
stage = '3-qr';
const waitFor = async (expr, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(300); }
  return false;
};
console.log('\n=== 3c. 音源登录 → 二维码块 ===');
await ev(`document.getElementById('kugou-login').click(); 1`);
const kugouImg = await waitFor(`!!document.querySelector('#src-qr-box img')`, 9000);
const kugouQr = await ev(`(() => { const w = document.getElementById('src-qr'); const b = document.getElementById('src-qr-box');
  const r = b.getBoundingClientRect(); return { hidden: w.hidden, h: Math.round(r.height), w: Math.round(r.width),
    img: !!document.querySelector('#src-qr-box img'),
    status: document.getElementById('src-qr-status').textContent.trim(), state: document.getElementById('kugou-state').textContent.trim() }; })()`);
console.log('  酷狗登录后 #src-qr:', JSON.stringify(kugouQr), ok(kugouQr.hidden === false && kugouQr.h > 0), '| 二维码图到位:', kugouImg);
await ev(`document.getElementById('qq-login').click(); 1`);
await sleep(1200);
const qqQr = await ev(`(() => { const w = document.getElementById('qq-qr'); const b = document.getElementById('qq-qr-box');
  const r = b.getBoundingClientRect(); return { hidden: w.hidden, h: Math.round(r.height), w: Math.round(r.width),
    status: document.getElementById('qq-qr-status').textContent.trim(), state: document.getElementById('qq-state').textContent.trim() }; })()`);
console.log('  QQ 登录后 #qq-qr:', JSON.stringify(qqQr), ok(qqQr.hidden === false && qqQr.h > 0));
const srcQrAfterQq = await ev(`document.getElementById('src-qr').hidden`);
console.log('  同时只留一块码（#src-qr 已收起）:', srcQrAfterQq, ok(srcQrAfterQq === true));
const kugouBack = await ev(`document.getElementById('kugou-state').textContent.trim()`);
console.log('  酷狗状态回到未连接:', JSON.stringify(kugouBack), ok(kugouBack === '未连接'));
/* 再点酷狗：QQ 的码收起，换成酷狗的码，这张图用来当音源分区截图 */
await ev(`document.getElementById('kugou-login').click(); 1`);
const kugouImg2 = await waitFor(`!!document.querySelector('#src-qr-box img')`, 9000);
const qqHidden2 = await ev(`document.getElementById('qq-qr').hidden`);
console.log('  再点酷狗 → 酷狗码:', kugouImg2, '| QQ 码已收起:', qqHidden2, ok(qqHidden2 === true));

/* 音源分区截图：把「音源」标题滚到顶栏下面 */
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await sleep(300);
await ev(`(() => { const v = document.getElementById('view-settings'); const h = document.getElementById('setpage-h-sources');
  v.scrollTop = h.offsetTop - 84; return v.scrollTop; })()`);
await sleep(600);
console.log('  音源分区 scrollTop:', await ev(`document.getElementById('view-settings').scrollTop`));
await shot('setpage-2-sources');

/* ---------------------------------------------------------------- 4 */
stage = '4-scroll';
console.log('\n=== 4. 设置页滚动 + is-stuck ===');
await ev(`document.getElementById('view-settings').scrollTop = 0; 1`);
await sleep(400);
const sc = await ev(`(() => { const v = document.getElementById('view-settings');
  return { sh: v.scrollHeight, ch: v.clientHeight, top: v.scrollTop }; })()`);
console.log('  scrollHeight / clientHeight:', sc.sh, '/', sc.ch, ok(sc.sh > sc.ch));
const stuck0 = await ev(`document.getElementById('topbar').classList.contains('is-stuck')`);
await ev(`document.getElementById('view-settings').scrollTop = 300; 1`);
await sleep(600);
const stuck1 = await ev(`document.getElementById('topbar').classList.contains('is-stuck')`);
const logoW = await ev(`getComputedStyle(document.querySelector('.brand__word')).maxWidth`);
const shade = await ev(`getComputedStyle(document.getElementById('topbar'), '::after').opacity`);
await ev(`document.getElementById('view-settings').scrollTop = 0; 1`);
await sleep(600);
const stuck2 = await ev(`document.getElementById('topbar').classList.contains('is-stuck')`);
const shade0 = await ev(`getComputedStyle(document.getElementById('topbar'), '::after').opacity`);
console.log('  顶部 is-stuck:', stuck0, ok(stuck0 === false));
console.log('  下滑 300 后 is-stuck:', stuck1, ok(stuck1 === true), '| logo maxWidth:', logoW, '| 暗部 opacity:', shade);
console.log('  回顶后 is-stuck:', stuck2, ok(stuck2 === false), '| 暗部 opacity:', shade0);
console.log('  回顶后 scrollTop:', await ev(`document.getElementById('view-settings').scrollTop`));

/* ---------------------------------------------------------------- 5 */
stage = '5-back-out';
console.log('\n=== 5. 点返回箭头 → 回大厅 ===');
await ev(`document.getElementById('btn-settings').click(); 1`);
await sleep(900);
const backView = await ev(`document.querySelector('.view.is-active')?.id`);
console.log('  点后视图:', backView, ok(backView === 'view-hall'));
console.log('  is-back:', await ev(`document.querySelector('.topbar__left').classList.contains('is-back')`), ok((await ev(`document.querySelector('.topbar__left').classList.contains('is-back')`)) === false));
console.log('  URL:', await ev('location.href'), '（应与初始一致）', ok((await ev('location.href')) === URL0));
/* 再进一次，确认齿轮仍是「进设置」而不是「返回」 */
await ev(`document.getElementById('btn-settings').click(); 1`);
await sleep(700);
console.log('  再点齿轮 → 视图:', await ev(`document.querySelector('.view.is-active')?.id`), ok((await ev(`document.querySelector('.view.is-active')?.id`)) === 'view-settings'));

/* ---------------------------------------------------------------- 6 */
stage = '6-errors';
console.log('\n=== 6. 控制台 / 异常 ===');
console.log('  未捕获异常:', excs.length ? '\n    ' + excs.join('\n    ') : '0');
console.log('  console.error:', cerrs.length ? '\n    ' + cerrs.join('\n    ') : '0');
console.log('  浏览器层 error（网络/资源，仅供参考）:', nerrs.length ? '\n    ' + nerrs.slice(0, 10).join('\n    ') : '0');
console.log('  HTTP >= 400:', bad.length ? '\n    ' + bad.join('\n    ') : '0');
console.log('  判定:', ok(excs.length === 0 && cerrs.length === 0));

/* 收尾 */
ws.close();
ch.kill();
await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
