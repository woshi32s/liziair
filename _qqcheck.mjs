/**
 * _qqcheck.mjs —— QQ 音乐（第一期）验收
 *
 * 断言并打印真实数字，不伪造：
 *   1) /api/qq/health 通、边车端口对、只绑 127.0.0.1、0 console error
 *   2) 设置面板有「音源」区，QQ 行显示「未连接」
 *   3) 点登录 → 二维码 <img> naturalWidth > 100，非空白像素 > 5%
 *   4) 轮询接口返回 801（等待扫码）
 *   5) /api/qq/search?s=周杰伦 ≥1 条，字段含 name/artist/duration
 *   6) 第一条能拿到非空直链（拿不到就如实报原因）
 *   7) 截图 shots/review/qq-1-settings.png / qq-2-qr.png / qq-3-search.png
 *   8) 网易云回归：/api/session、/api/top/playlist、/api/user/detail?uid=1 仍然 200
 *
 * 额外一条（不在验收清单里，但「能播出声」必须自己确认）：点第一首 QQ 曲目，
 * 音频走 /api/qq/audio 代理并且 currentTime 真的在走。
 *
 * 只用无头 Chrome + CDP，自己起临时 profile，跑完删掉。端口从 .port 读，不写死。
 *
 *   node _qqcheck.mjs
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const BASE = `http://127.0.0.1:${APP}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(ROOT, 'shots', 'review');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440, H = 1080;
fs.mkdirSync(OUT, { recursive: true });

const R = { pass: 0, fail: 0 };
const ok = (n, name, detail, pass) => {
  if (pass) R.pass++; else R.fail++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  [${n}] ${name} —— ${detail}`);
};

const jget = async (p) => {
  try {
    const r = await fetch(BASE + p, { signal: AbortSignal.timeout(60000) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: r.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: String(e.message) };
  }
};

/* ==========================================================================
   1. 边车健康检查（先证明后端是好的，再看界面）
   ========================================================================== */
console.log('\n[1] 边车健康检查');
const health = await jget('/api/qq/health');
const hOk = health.status === 200 && health.json && health.json.ok && Number.isInteger(health.json.port);
ok(1.1, '/api/qq/health', `HTTP ${health.status} ${health.text.slice(0, 160)}`, !!hOk);

let qqPort = hOk ? health.json.port : 0;
if (!hOk) {
  console.log('\n  边车没起来，后面的界面断言没法做，直接退出。');
  process.exit(1);
}

/* 端口是不是真的只绑回环：读 netstat，按端口找 LISTENING 行 */
let bindLines = [];
try {
  const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  bindLines = out.split(/\r?\n/).filter((l) => l.includes('LISTENING') && l.includes(`:${qqPort} `)).map((l) => l.trim());
} catch { /* netstat 不可用就算了 */ }
const bindAddrs = bindLines.map((l) => l.split(/\s+/)[1]).filter(Boolean);
const loopbackOnly = bindAddrs.length > 0 && bindAddrs.every((a) => a.startsWith('127.0.0.1:'));
ok(1.2, '边车只绑回环', `port=${qqPort} bind=${bindAddrs.join(',') || '(netstat 没读到)'}`, loopbackOnly);

/* 用同一份 .port 复核：health 报的端口 = 边车自己写的端口 */
const sidecarPortFile = Number(fs.readFileSync(path.join(ROOT, 'services', 'qq-api', '.port'), 'utf8').trim());
ok(1.3, '端口与 .port 一致', `health=${qqPort} services/qq-api/.port=${sidecarPortFile}`, qqPort === sidecarPortFile);

/* ==========================================================================
   起无头 Chrome
   ========================================================================== */
if (!fs.existsSync(CHROME)) {
  console.error(`\n  找不到 Chrome：${CHROME}`);
  process.exit(1);
}
const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port;
await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-qqcheck-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pend = new Map();
const consoleErrs = [];
const exceptions = [];
const pollKeys = [];          // 页面自己轮询用过的 key（从 Network 事件里截，这才是「真在轮询」）
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Network.requestWillBeSent') {
    const u = (m.params && m.params.request && m.params.request.url) || '';
    const i = u.indexOf('/api/qq/login/qr/check?key=');
    if (i >= 0) {
      const k = decodeURIComponent(u.slice(i + '/api/qq/login/qr/check?key='.length).split('&')[0]);
      if (!pollKeys.includes(k)) pollKeys.push(k);
    }
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    exceptions.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 300));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrs.push(m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300));
  }
};
const send = (m, p = {}) => new Promise((res) => {
  const i = ++id;
  pend.set(i, { resolve: res });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});
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
const shot = async (name, clip) => {
  const p = { format: 'png', captureBeyondViewport: false };
  if (clip) p.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale || 1 };
  const png = await send('Page.captureScreenshot', p);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(png.data, 'base64'));
  console.log('    → shots/review/' + name);
};
const rectOf = async (sel) => {
  const raw = await ev(`(() => {
    const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return 'null';
    const r = e.getBoundingClientRect();
    return JSON.stringify({ x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height });
  })()`);
  return raw === 'null' ? null : JSON.parse(raw);
};
const cleanup = async () => {
  try { ws.close(); } catch { /* ignore */ }
  try { chrome.kill(); } catch { /* ignore */ }
  await sleep(400);
  try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch { /* ignore */ }
};
process.on('exit', () => { try { chrome.kill(); } catch { /* ignore */ } });

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '/' });

const booted = await gate(`document.readyState === 'complete' && typeof API === 'object' && !!document.querySelector('#btn-settings')`, 60, 300);
ok(0, '页面启动', `API=${await ev('typeof API')} booted=${booted}`, booted);
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 30, 400);   // 大厅挂载（只为截图好看）
await gate(`document.querySelectorAll('#tracks .track').length > 0`, 40, 400);      // 启动时的默认列表（免得和搜索抢）

/* ==========================================================================
   2. 设置面板的「音源」区
   ========================================================================== */
console.log('\n[2] 设置面板 · 音源');
await ev(`document.querySelector('#btn-settings').click()`);
const panelOpen = await gate(`!document.querySelector('#settings-panel').hidden`, 30, 300);
const ui2 = JSON.parse(await ev(`JSON.stringify({
  panelW: Math.round(document.querySelector('#settings-panel').getBoundingClientRect().width),
  srcTitles: [...document.querySelectorAll('#settings-panel .settings__t')].map(h => h.textContent.trim()),
  state: (document.querySelector('#qq-state') || {}).textContent,
  loginVisible: !!document.querySelector('#qq-login') && !document.querySelector('#qq-login').hidden,
  qrHidden: document.querySelector('#qq-qr').hidden
})`));
ok(2.1, '设置面板打开', `width=${ui2.panelW}px open=${panelOpen}`, panelOpen);
ok(2.2, '有「音源」区', `标题=${JSON.stringify(ui2.srcTitles)}`, ui2.srcTitles.includes('音源'));
ok(2.3, 'QQ 行显示「未连接」', `state="${ui2.state}" loginBtn=${ui2.loginVisible}`, ui2.state === '未连接' && ui2.loginVisible);
await shot('qq-1-settings.png');

/* ==========================================================================
   3. 点登录 → 二维码
   ========================================================================== */
console.log('\n[3] 二维码');
await ev(`document.querySelector('#qq-login').click()`);
const qrAppeared = await gate(
  `(() => { const i = document.querySelector('#qq-qr-box img'); return !!(i && i.complete && i.naturalWidth > 0); })()`,
  100, 400
);
const qr = JSON.parse(await ev(`(() => {
  const i = document.querySelector('#qq-qr-box img');
  if (!i) return JSON.stringify({ ok: false, why: '没有 <img>' });
  const c = document.createElement('canvas');
  c.width = i.naturalWidth; c.height = i.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(i, 0, 0);
  let nonWhite = 0;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  for (let k = 0; k < d.length; k += 4) {
    if (d[k] < 200 || d[k + 1] < 200 || d[k + 2] < 200) nonWhite++;
  }
  const total = d.length / 4;
  const r = i.getBoundingClientRect();
  return JSON.stringify({
    ok: true, nw: i.naturalWidth, nh: i.naturalHeight,
    boxW: Math.round(r.width), boxH: Math.round(r.height),
    nonWhite, total, ratio: +(nonWhite / total).toFixed(4),
    isDataUrl: i.src.startsWith('data:image/')
  });
})()`));
ok(3.1, '二维码 <img> 出现且尺寸够', `naturalWidth=${qr.nw} naturalHeight=${qr.nh} 显示=${qr.boxW}x${qr.boxH} dataURL=${qr.isDataUrl}`,
  qrAppeared && qr.ok && qr.nw > 100 && qr.boxW >= 160);
ok(3.2, '二维码非空白像素 > 5%', `${qr.nonWhite}/${qr.total} = ${(qr.ratio * 100).toFixed(1)}%`, qr.ok && qr.ratio > 0.05);

/* 二维码截图：裁面板 + 放 2 倍，扫起来才看得清 */
const panelRect = await rectOf('#settings-panel');
if (panelRect) {
  await shot('qq-2-qr.png', {
    x: Math.max(0, panelRect.x - 10),
    y: Math.max(0, panelRect.y - 10),
    width: panelRect.width + 20,
    height: panelRect.height + 20,
    scale: 2,
  });
} else {
  await shot('qq-2-qr.png');
}

/* ==========================================================================
   4. 轮询返回 801
   ========================================================================== */
console.log('\n[4] 轮询状态');
/* 用**页面自己那个 key** 去查 —— 自己再开一张码会被 15s 冷却挡掉（上游对同设备限流），
   那样验的就不是「页面正在轮询的这张码」了。 */
for (let i = 0; i < 30 && !pollKeys.length; i++) await sleep(300);
const key = pollKeys[pollKeys.length - 1];
const chk = key ? await jget('/api/qq/login/qr/check?key=' + encodeURIComponent(key)) : { status: 0, json: null };
const pollCode = chk.json && chk.json.code;
ok(4.1, 'GET /api/qq/login/qr/check（页面正在用的 key）',
  `页面已轮询 ${pollKeys.length} 次 key=${String(key).slice(0, 12)}… code=${pollCode} message="${(chk.json || {}).message || ''}"`,
  pollCode === 801);

/* 页面自己的轮询在跑：等两轮，状态文案还停在等待，且没变成错误 */
await sleep(4500);
const ui4 = JSON.parse(await ev(`JSON.stringify({
  state: (document.querySelector('#qq-state')||{}).textContent,
  status: (document.querySelector('#qq-qr-status')||{}).textContent,
  isError: document.querySelector('#qq-qr-status').classList.contains('is-error')
})`));
ok(4.2, '页面在轮询（未报错）', `state="${ui4.state}" status="${ui4.status}" isError=${ui4.isError}`,
  ui4.state === '等待扫码' && !ui4.isError);

/* ==========================================================================
   5. 搜索：QQ 结果单独列
   ========================================================================== */
console.log('\n[5] 搜索');
/* 用和界面完全一样的参数（limit=20）：服务端有一分钟的同词缓存，
   这样后面的界面搜索不会再打一次上游（QQ 对匿名搜索限流，省一次是一次）。
   限流时上游回 2001 —— 用户会「等一会儿再搜」，脚本也一样，最多试 4 次并如实打印次数。 */
let apiSearch = null;
let attempts = 0;
for (let i = 0; i < 4; i++) {
  attempts++;
  apiSearch = await jget('/api/qq/search?s=' + encodeURIComponent('周杰伦') + '&limit=20');
  const got = (apiSearch.json && apiSearch.json.tracks) || [];
  if (apiSearch.status === 200 && got.length) break;
  await sleep(5000);
}
const tracks = (apiSearch.json && apiSearch.json.tracks) || [];
const t0 = tracks[0] || {};
ok(5.1, '/api/qq/search?s=周杰伦',
  `HTTP ${apiSearch.status} 第 ${attempts} 次尝试 songCount=${apiSearch.json && apiSearch.json.songCount} 返回=${tracks.length} 条` +
  (apiSearch.json && apiSearch.json.error ? ` err=${apiSearch.json.error}` : ''),
  tracks.length >= 1);
ok(5.2, '字段含 name/artist/duration',
  `name="${t0.name}" artist="${t0.artists}" duration=${t0.duration}ms album="${t0.album}" mid=${t0.mid}`,
  !!t0.name && !!t0.artists && Number(t0.duration) > 0);

/* 界面：切到 QQ 音源再搜，结果只列 QQ 的 */
await ev(`(() => {
  const b = document.querySelector('#src-switch [data-src="qq"]');
  if (b) b.click();
  const s = document.querySelector('#search');
  s.value = '周杰伦';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
/* 等的是「QQ 的结果已经渲染好」：hint 变成 "QQ 音乐 · N 首"，不能只看行数
   （启动时那份默认列表本来就有行，会假通过） */
const rowsOk = await gate(
  `(() => {
     const h = ((document.querySelector('#src-hint') || {}).textContent || '');
     const rows = document.querySelectorAll('#tracks .track').length;
     const img = document.querySelector('#tracks .track img.track__cover');
     return /QQ 音乐 · \\d+ 首/.test(h) && rows > 0 && !!img && img.src.includes('gtimg');
   })()`,
  60, 400
);
const ui5 = JSON.parse(await ev(`JSON.stringify({
  rows: document.querySelectorAll('#tracks .track').length,
  firstName: (document.querySelector('#tracks .track .track__name')||{}).textContent,
  firstSub: (document.querySelector('#tracks .track .track__sub')||{}).textContent,
  firstDur: (document.querySelector('#tracks .track .track__dur')||{}).textContent,
  firstCover: (document.querySelector('#tracks .track img.track__cover')||{}).src,
  hint: (document.querySelector('#src-hint')||{}).textContent,
  activeSrc: [...document.querySelectorAll('#src-switch .src-switch__b')].filter(b=>b.classList.contains('is-on')).map(b=>b.dataset.src).join(','),
  panelClosed: document.querySelector('#settings-panel').hidden
})`));
ok(5.3, '搜索页只列 QQ 结果', `rows=${ui5.rows} 当前音源=${ui5.activeSrc} hint="${ui5.hint}" 面板已收起=${ui5.panelClosed}`,
  rowsOk && ui5.activeSrc === 'qq' && (ui5.hint || '').includes('QQ'));
ok(5.4, '列表行有歌名/歌手/时长', `"${ui5.firstName}" / "${ui5.firstSub}" / ${ui5.firstDur}`,
  !!ui5.firstName && !!ui5.firstSub && /\d+:\d\d/.test(ui5.firstDur || ''));

/* 封面走 /api/img（y.gtimg.cn 在代理白名单里）：等它真的解码出来再截图，
   否则截到的是一排灰底占位，看不出这是 QQ 的歌 */
const coverOk = await gate(
  `(() => { const i = document.querySelector('#tracks .track img.track__cover'); return !!(i && i.complete && i.naturalWidth > 50); })()`,
  40, 300
);
const cover = JSON.parse(await ev(`(() => {
  const i = document.querySelector('#tracks .track img.track__cover');
  return JSON.stringify(i ? { nw: i.naturalWidth, nh: i.naturalHeight } : { nw: 0, nh: 0 });
})()`));
ok(5.5, '封面经 /api/img 加载', `naturalWidth=${cover.nw} naturalHeight=${cover.nh}`, coverOk && cover.nw > 50);
await shot('qq-3-search.png');

/* ==========================================================================
   6. 直链 + 真的能播
   ========================================================================== */
console.log('\n[6] 播放');
const su = await jget('/api/qq/song/url?mid=' + encodeURIComponent(t0.mid || ''));
const url = (su.json && su.json.url) || '';
const host = url ? (() => { try { return new URL(url).host; } catch { return '?'; } })() : '';
ok(6.1, '/api/qq/song/url 返回非空 URL',
  `len=${url.length} host=${host} preview=${su.json && su.json.preview} reason=${su.json && su.json.reason}`,
  url.length > 0);

/* 点第一首：走现有 Player 的加载路径，音频必须来自 /api/qq/audio 代理 */
await ev(`document.querySelector('#tracks .track').click()`);
const playing = await gate(`Player.state.queue.length > 0 && Player.audio.currentTime > 0.3`, 60, 500);
const ui6 = JSON.parse(await ev(`JSON.stringify({
  playing: Player.state.playing,
  t: +Player.audio.currentTime.toFixed(2),
  src: (Player.audio.src || '').slice(0, 140),
  viaProxy: (Player.audio.src || '').includes('/api/qq/audio'),
  trackSource: (Player.state.queue[Player.state.index] || {}).source,
  trackName: (Player.state.queue[Player.state.index] || {}).name,
  badge: (document.querySelector('#badge') || {}).textContent,
  badgeHidden: document.querySelector('#badge').hidden,
  lyricLines: Player.state.lyric.length
})`));
ok(6.2, '点一下能播（走 /api/qq/audio）',
  `《${ui6.trackName}》source=${ui6.trackSource} currentTime=${ui6.t}s playing=${ui6.playing} viaProxy=${ui6.viaProxy} 歌词行=${ui6.lyricLines}`,
  playing && ui6.viaProxy && ui6.trackSource === 'qq');
ok(6.3, '试听/完整 如实标注', `badge="${ui6.badge}" hidden=${ui6.badgeHidden}`,
  su.json && su.json.preview ? (!ui6.badgeHidden && ui6.badge.includes('试听')) : true);

/* ==========================================================================
   7. 网易云回归
   ========================================================================== */
console.log('\n[7] 网易云回归');
const s1 = await jget('/api/session');
const s2 = await jget('/api/top/playlist?limit=6');
const s3 = await jget('/api/user/detail?uid=1');
ok(7.1, '/api/session', `HTTP ${s1.status} loggedIn=${s1.json && s1.json.loggedIn}`, s1.status === 200);
ok(7.2, '/api/top/playlist', `HTTP ${s2.status} playlists=${((s2.json || {}).playlists || []).length}`,
  s2.status === 200 && ((s2.json || {}).playlists || []).length > 0);
ok(7.3, '/api/user/detail?uid=1', `HTTP ${s3.status} nickname="${((s3.json || {}).profile || {}).nickname || ''}"`, s3.status === 200);

/* ==========================================================================
   8. console error
   ========================================================================== */
const errCount = consoleErrs.length + exceptions.length;
ok(8.1, '0 console error', `console.error=${consoleErrs.length} exception=${exceptions.length}` +
  (errCount ? ' 首个：' + [consoleErrs[0], exceptions[0]].filter(Boolean)[0] : ''), errCount === 0);

/* ==========================================================================
   汇总
   ========================================================================== */
await cleanup();
console.log(`\n  ── ${R.pass} 通过 / ${R.fail} 失败 ──`);
console.log(`  截图：shots/review/qq-1-settings.png  shots/review/qq-2-qr.png  shots/review/qq-3-search.png\n`);
process.exit(R.fail ? 1 : 0);
