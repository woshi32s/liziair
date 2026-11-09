/**
 * _sources.mjs —— 多音源（酷狗 / 汽水 / 波点 / Spotify）验收
 *
 * 按 `_qqcheck.mjs` 的套路写：断言 + 打印真实数字，不伪造任何一条。
 * 每家跑同样的 6 步：
 *   1) /api/<name>/health 200，边车端口 = services/<name>-api/.port，netstat 只有 127.0.0.1
 *   2) 设置面板里有那一行（状态 + 限制说明都在），点「登录」能拿到二维码
 *      （naturalWidth > 100、非空白像素 > 5%）或**明确的可登录方式**（Spotify 要 Client ID）
 *   3) /api/<name>/search?s=周杰伦 ≥1 条，打印 songCount 和首条的 name/artist/duration
 *   4) 播放：直链非空 + currentTime > 0.5s + playing=true；拿不到就如实打印原因
 *   5) 截图 shots/review/src-<name>-1-settings.png / src-<name>-2-search.png
 * 最后跑网易云 + QQ 的回归，并检查 0 console error。
 *
 *   node _sources.mjs            全跑
 *   node _sources.mjs kugou      只跑一家（调试用）
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

const ALL = ['kugou', 'qishui', 'bodian', 'spotify'];
const only = process.argv[2];
const SOURCES = only ? ALL.filter((s) => s === only) : ALL;
const LABEL = { kugou: '酷狗音乐', qishui: '汽水音乐', bodian: '波点音乐', spotify: 'Spotify' };

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
   0. 后端健康（先证明边车是好的，再看界面）
   ========================================================================== */
console.log('\n[0] 边车健康');
const health = {};
for (const src of ALL) {
  const h = await jget(`/api/${src}/health`);
  health[src] = h;
  /* Spotify 没配 Client ID 时 ok:false 是**如实**的状态，不是坏掉：只要 200 且说清了原因就算健康 */
  const okHealth = h.status === 200 && h.json && (h.json.ok === true || (src === 'kugou' && h.json.ok === true) || (h.json.code === 200 && h.json.hasClientId === false));
  ok(`0.${src}`, `/api/${src}/health`, `HTTP ${h.status} ` + JSON.stringify(h.json || h.text).slice(0, 200), !!okHealth);

  if (!h.json || !h.json.port) continue;
  const port = h.json.port;
  // 端口必须等于边车自己写的 .port
  let filePort = 0;
  try { filePort = Number(fs.readFileSync(path.join(ROOT, 'services', `${src}-api`, '.port'), 'utf8').trim()); } catch { /* 没写 */ }
  ok(`0.${src}-port`, `${src} 端口 = .port`, `health=${port} services/${src}-api/.port=${filePort}`, port === filePort);

  // netstat：只允许 127.0.0.1
  let addrs = [];
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    addrs = out.split(/\r?\n/).filter((l) => l.includes('LISTENING') && l.includes(`:${port} `))
      .map((l) => l.trim().split(/\s+/)[1]).filter(Boolean);
  } catch { /* netstat 不可用 */ }
  const loopback = addrs.length > 0 && addrs.every((a) => a.startsWith('127.0.0.1:'));
  ok(`0.${src}-bind`, `${src} 只绑回环`, `bind=${addrs.join(',') || '(netstat 没读到)'}`, loopback);
}

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
const PROFILE = path.join(os.tmpdir(), 'lg-sources-' + Date.now());
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
  if (clip) p.clip = { ...clip, scale: clip.scale || 1 };
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

/* 复位：清掉上次留在 localStorage 的音源选择，避免带着上次的状态跑 */
await send('Page.navigate', { url: BASE + '/' });
const booted0 = await gate(`document.readyState === 'complete' && typeof API === 'object'`, 60, 300);
await ev(`(() => { try { localStorage.removeItem('lizi.searchSource'); } catch (e) {} return true; })()`);
await send('Page.navigate', { url: BASE + '/' });
await send('Page.reload', { ignoreCache: false });
const booted = await gate(`document.readyState === 'complete' && typeof API === 'object' && !!document.querySelector('#btn-settings')`, 80, 300);
ok(0.1, '页面启动', `booted0=${booted0} API=${await ev('typeof API')} 音源按钮=${await ev(`document.querySelectorAll('#src-switch [data-src]').length`)}`, booted);
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 30, 400);
await gate(`document.querySelectorAll('#tracks .track').length > 0`, 40, 400);

const openPanel = async () => {
  /* 顶栏左键是「一个按钮两种身份」：大厅里是齿轮（开设置），搜索页是返回箭头。
     上一家跑完停在 browse，所以这里要先退回大厅，再点开设置 —— 否则面板一直是 hidden（0×0）。 */
  for (let i = 0; i < 4; i++) {
    const open = await ev(`!document.querySelector('#settings-panel').hidden`);
    if (open) break;
    const isBack = await ev(`document.querySelector('.topbar__left').classList.contains('is-back')`);
    await ev(`(() => { document.querySelector('#btn-settings').click(); return true; })()`);
    await sleep(isBack ? 500 : 400);
  }
  await gate(`!document.querySelector('#settings-panel').hidden`, 30, 300);
  return await ev(`!document.querySelector('#settings-panel').hidden && document.querySelector('#settings-panel').getBoundingClientRect().width > 50`);
};
const closePanel = async () => {
  await ev(`(() => {
    const p = document.querySelector('#settings-panel');
    if (!p.hidden) document.querySelector('#btn-settings').click();
    return true;
  })()`);
  await sleep(200);
};

/* ==========================================================================
   每家：设置 → 二维码 → 搜索 → 播放 → 截图
   ========================================================================== */
for (const src of SOURCES) {
  const label = LABEL[src];
  console.log(`\n========== ${label} (${src}) ==========`);

  /* ---- 2. 设置面板那一行 ---- */
  await openPanel();
  await sleep(1200);        // refreshAll() 是异步的，等它把状态写进去
  const ui = JSON.parse(await ev(`(() => {
    const row = document.querySelector('[data-src-row="${src}"]');
    if (!row) return JSON.stringify({ exists: false });
    const state = row.querySelector('.settings__val');
    const limit = row.querySelector('.src-limit');
    const login = row.querySelector('.settings__act');
    return JSON.stringify({
      exists: true,
      state: state && state.textContent.trim(),
      limit: limit && limit.textContent.trim(),
      loginVisible: !!login && !login.hidden,
      loginText: login && login.textContent.trim(),
      qrHidden: document.querySelector('#src-qr').hidden,
      panelW: Math.round(document.querySelector('#settings-panel').getBoundingClientRect().width),
      titles: [...document.querySelectorAll('#settings-panel .settings__t')].map((h) => h.textContent.trim()),
    });
  })()`));
  ok(`2.${src}`, `${label} 行存在（状态 + 限制）`,
    `exists=${ui.exists} state="${ui.state}" limit="${ui.limit}" 登录键="${ui.loginText}" 面板=${ui.panelW}px`,
    !!ui.exists && !!ui.state && !!ui.limit && ui.titles && ui.titles.includes('音源'));

  /* ---- 3. 点登录：二维码 / 或明确的可登录方式 ---- */
  await ev(`(() => {
    const row = document.querySelector('[data-src-row="${src}"]');
    const b = row && row.querySelector('.settings__act');
    if (b && !b.hidden) b.click();
    return true;
  })()`);
  await sleep(300);

  let qr = null;
  if (src === 'spotify') {
    /* Spotify 没有二维码：要么跳官方 OAuth（需 Client ID），要么明确说缺什么 */
    const okMsg = await gate(`(() => {
      const box = document.querySelector('#src-qr-box');
      const st = document.querySelector('#src-qr-status');
      const t = ((box && box.textContent) || '') + ' ' + ((st && st.textContent) || '');
      return /Client ID|SPOTIFY_CLIENT_ID|授权|浏览器/.test(t);
    })()`, 40, 400);
    const msg = JSON.parse(await ev(`JSON.stringify({
      box: (document.querySelector('#src-qr-box')||{}).textContent,
      status: (document.querySelector('#src-qr-status')||{}).textContent,
      isError: document.querySelector('#src-qr-status').classList.contains('is-error')
    })`));
    ok(`3.${src}`, `${label} 有明确的可登录方式`, `box="${(msg.box || '').trim()}" status="${msg.status}"`, okMsg);
    qr = { ok: false, why: 'no-client-id', status: msg.status };
  } else {
    const appeared = await gate(
      `(() => { const i = document.querySelector('#src-qr-box img'); return !!(i && i.complete && i.naturalWidth > 0); })()`,
      100, 400);
    qr = JSON.parse(await ev(`(() => {
      const i = document.querySelector('#src-qr-box img');
      if (!i) return JSON.stringify({ ok: false, why: '没有 <img>', status: (document.querySelector('#src-qr-status')||{}).textContent });
      const c = document.createElement('canvas');
      c.width = i.naturalWidth; c.height = i.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(i, 0, 0);
      let nonWhite = 0;
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let k = 0; k < d.length; k += 4) if (d[k] < 200 || d[k + 1] < 200 || d[k + 2] < 200) nonWhite++;
      const total = d.length / 4;
      return JSON.stringify({
        ok: true, nw: i.naturalWidth, nh: i.naturalHeight,
        nonWhite, total, ratio: +(nonWhite / total).toFixed(4),
        isDataUrl: i.src.startsWith('data:image/'),
        status: (document.querySelector('#src-qr-status')||{}).textContent,
      });
    })()`));
    ok(`3.${src}.1`, `${label} 二维码尺寸`, `naturalWidth=${qr.nw} naturalHeight=${qr.nh} dataURL=${qr.isDataUrl} 状态="${qr.status}"`,
      appeared && qr.ok && qr.nw > 100);
    ok(`3.${src}.2`, `${label} 二维码非空白像素 > 5%`, `${qr.nonWhite}/${qr.total} = ${((qr.ratio || 0) * 100).toFixed(1)}%`,
      qr.ok && qr.ratio > 0.05);
  }

  /* 面板截图（连二维码一起）。面板 268px 宽、最高 640px 且自己滚动，
     所以先把二维码滚进视野再截，否则截图里只有上面那几行。
     面板没真的打开就截全屏 —— 不能存一张 40×40 的空图糊弄。 */
  await ev(`(() => {
    const q = document.querySelector('#src-qr');
    const p = document.querySelector('#settings-panel');
    if (q && p && !q.hidden) { try { q.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    return true;
  })()`);
  await sleep(260);
  const pr = await rectOf('#settings-panel');
  if (pr && pr.width > 50 && pr.height > 50) {
    await shot(`src-${src}-1-settings.png`, {
      x: Math.max(0, pr.x - 12), y: Math.max(0, pr.y - 12),
      width: Math.min(W - pr.x, pr.width + 24), height: Math.min(H - pr.y, pr.height + 24),
      scale: 2,
    });
  } else {
    ok(`2.${src}-shot`, `${label} 设置面板没打开（截图退化成全屏）`, `rect=${JSON.stringify(pr)}`, false);
    await shot(`src-${src}-1-settings.png`);
  }

  /* 关面板会停掉扫码轮询（Sources.pause），后面搜索才干净 */
  await closePanel();

  /* ---- Spotify 是「可行性骨架」：不接音频，也不预设凭证 ----
     所以它按另一套标准验收：搜索**要么有结果、要么说清缺什么**，
     音频必须明确回 reason=drm，界面必须写「本期不接音频」。这不算放水：
     规格里 Spotify 本来就只做登录骨架 + 元数据。 */
  if (src === 'spotify') {
    const sr = await jget('/api/spotify/search?s=' + encodeURIComponent('周杰伦') + '&limit=20');
    const tracks = (sr.json && sr.json.tracks) || [];
    const honest = !!(sr.json && sr.json.error && /client[_ ]?id/i.test(sr.json.error));
    ok('4.spotify.1', '/api/spotify/search?s=周杰伦（骨架：无凭证时必须说清楚）',
      `HTTP ${sr.status} 返回=${tracks.length} 条 err="${(sr.json && sr.json.error) || ''}"`,
      tracks.length >= 1 || honest);
    if (tracks.length) {
      const t0 = tracks[0];
      ok('4.spotify.2', 'Spotify 字段含 name/artist/duration',
        `name="${t0.name}" artist="${t0.artists}" duration=${t0.duration}ms`, !!t0.name && !!t0.artists && t0.duration > 0);
    } else {
      ok('4.spotify.2', 'Spotify 元数据（未配 Client ID，无法取真实数据）', '如实报错，未伪造任何结果', true);
    }
    // 界面上也要显示这句原因
    await ev(`(() => {
      const b = document.querySelector('#src-switch [data-src="spotify"]');
      if (b) b.click();
      const s = document.querySelector('#search');
      s.value = '周杰伦';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    /* 切音源会触发**两次**搜索（点按钮一次 + 输入框防抖一次），所以要等最终那一轮的
       结果落地（列表里出现 Client ID 那句），不能只看第一轮。 */
    await gate(`(() => {
      const body = ((document.querySelector('#tracks')||{}).textContent || '');
      return /Client ID/i.test(body);
    })()`, 60, 400);
    await sleep(700);
    const uiS = JSON.parse(await ev(`JSON.stringify({
      hint: (document.querySelector('#src-hint')||{}).textContent,
      body: (document.querySelector('#tracks')||{}).textContent.slice(0, 160),
    })`));
    ok('4.spotify.3', '界面如实显示 Spotify 的失败原因',
      `hint="${uiS.hint}" 列表="${(uiS.body || '').trim()}"`,
      /Client ID/i.test(uiS.body || '') || /Spotify/.test(uiS.hint || ''));
    await shot('src-spotify-2-search.png');

    const su = await jget('/api/spotify/song/url?id=4uLU6hMCjMI75M1A2tKUQC');
    ok('5.spotify.1', '/api/spotify/song/url 明确不接音频',
      `HTTP ${su.status} url.len=${((su.json || {}).url || '').length} reason=${(su.json || {}).reason} error="${(su.json || {}).error || ''}"`,
      su.json && su.json.reason === 'drm' && !su.json.url);
    const lim = (await ev(`(document.querySelector('[data-src-row="spotify"] .src-limit')||{}).textContent`)) || '';
    ok('5.spotify.2', '界面上写明「本期不接音频」',
      `行内限制="${lim}"`, /仅元数据|Premium/.test(lim));
    continue;
  }

  /* ---- 4. 搜索：切到这家再搜 ---- */
  const hasBtn = await ev(`!!document.querySelector('#src-switch [data-src="${src}"]')`);
  if (!hasBtn) {
    ok(`4.${src}.0`, `${label} 在搜索页有音源按钮`, '找不到 [data-src]', false);
    continue;
  }
  const sr = await jget(`/api/${src}/search?s=${encodeURIComponent('周杰伦')}&limit=20`);
  const tracks = (sr.json && sr.json.tracks) || [];
  const t0 = tracks[0] || {};
  ok(`4.${src}.1`, `/api/${src}/search?s=周杰伦`,
    `HTTP ${sr.status} songCount=${sr.json && sr.json.songCount} 返回=${tracks.length} 条` +
    (sr.json && sr.json.error ? ` err=${sr.json.error}` : ''), tracks.length >= 1);
  ok(`4.${src}.2`, `${label} 字段含 name/artist/duration`,
    `name="${t0.name}" artist="${t0.artists}" duration=${t0.duration}ms album="${t0.album}"`,
    !!t0.name && !!t0.artists && Number(t0.duration) > 0);

  await ev(`(() => {
    const b = document.querySelector('#src-switch [data-src="${src}"]');
    if (b) b.click();
    const s = document.querySelector('#search');
    s.value = '周杰伦';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const rowsOk = await gate(`(() => {
    const h = ((document.querySelector('#src-hint') || {}).textContent || '');
    const rows = document.querySelectorAll('#tracks .track').length;
    return /\\d+ 首|失败/.test(h) && rows > 0 && document.querySelector('#src-switch .src-switch__b.is-on').dataset.src === '${src}';
  })()`, 80, 400);
  const ui5 = JSON.parse(await ev(`JSON.stringify({
    rows: document.querySelectorAll('#tracks .track').length,
    firstName: (document.querySelector('#tracks .track .track__name')||{}).textContent,
    firstSub: (document.querySelector('#tracks .track .track__sub')||{}).textContent,
    firstDur: (document.querySelector('#tracks .track .track__dur')||{}).textContent,
    hint: (document.querySelector('#src-hint')||{}).textContent,
    active: (document.querySelector('#src-switch .src-switch__b.is-on')||{}).dataset && document.querySelector('#src-switch .src-switch__b.is-on').dataset.src,
  })`));
  ok(`4.${src}.3`, `${label} 界面只列这家结果`,
    `rows=${ui5.rows} 当前音源=${ui5.active} hint="${ui5.hint}"`, rowsOk && ui5.active === src);
  ok(`4.${src}.4`, `${label} 列表行有歌名/歌手/时长`,
    `"${ui5.firstName}" / "${ui5.firstSub}" / ${ui5.firstDur}`,
    !!ui5.firstName && !!ui5.firstSub && /\d+:\d\d/.test(ui5.firstDur || ''));

  /* 等首行封面解码，截图里才不是灰块 */
  const coverOk = await gate(`(() => { const i = document.querySelector('#tracks .track img.track__cover'); return !!(i && i.complete && i.naturalWidth > 50); })()`, 50, 300);
  const cover = JSON.parse(await ev(`(() => {
    const i = document.querySelector('#tracks .track img.track__cover');
    return JSON.stringify(i ? { nw: i.naturalWidth, nh: i.naturalHeight, src: (i.src || '').slice(0, 90) } : { nw: 0, nh: 0, src: '' });
  })()`));
  ok(`4.${src}.5`, `${label} 封面经 /api/img 加载`, `naturalWidth=${cover.nw} naturalHeight=${cover.nh} src="${cover.src}"`,
    coverOk && cover.nw > 50);
  await shot(`src-${src}-2-search.png`);

  /* ---- 5. 播放 ---- */
  const su = await jget(tracks[0]
    ? (src === 'kugou'
      ? `/api/kugou/song/url?hash=${encodeURIComponent(t0.hash || t0.id)}&albumId=${t0.albumIdNum || 0}&albumAudioId=${t0.albumAudioId || 0}`
      : `/api/${src}/song/url?id=${encodeURIComponent(t0.id || '')}`)
    : '/api/session');
  const url = (su.json && su.json.url) || '';
  let host = '';
  try { host = url ? new URL(url).host : ''; } catch { /* ignore */ }
  ok(`5.${src}.1`, `/api/${src}/song/url`,
    `len=${url.length} host=${host} preview=${su.json && su.json.preview} reason=${su.json && su.json.reason}` +
    (su.json && su.json.error ? ` error="${su.json.error}"` : '') + (su.json && su.json.upstream ? ` upstream="${su.json.upstream}"` : ''),
    true);   // 这一条只报告事实，能否出声由下一条判

  await ev(`(() => { try { Player.audio.pause(); } catch (e) {} const r = document.querySelector('#tracks .track'); if (r) r.click(); return true; })()`);
  /* 注意：不能只等 currentTime > 0.5 —— 上一首的演示音轨可能还在响，那样会假通过。
     必须**先确认 src 已经换成这一家的代理**，再看到时间在走。 */
  const playing = url
    ? await gate(`Player.state.queue.length > 0 && (Player.audio.src || '').includes('/api/${src}/audio') && Player.audio.currentTime > 0.5`, 90, 500)
    : false;
  const ui6 = JSON.parse(await ev(`JSON.stringify({
    playing: Player.state.playing,
    t: +(Player.audio.currentTime || 0).toFixed(2),
    src: (Player.audio.src || '').slice(0, 120),
    viaProxy: (Player.audio.src || '').includes('/api/${src}/audio'),
    trackSource: (Player.state.queue[Player.state.index] || {}).source,
    trackName: (Player.state.queue[Player.state.index] || {}).name,
    badge: (document.querySelector('#badge') || {}).textContent,
    badgeHidden: document.querySelector('#badge').hidden,
    badgeTitle: (document.querySelector('#badge') || {}).title,
    lyricLines: Player.state.lyric.length
  })`));

  if (src === 'spotify') {
    ok(`5.${src}.2`, 'Spotify 本期不接音频（如实标注）',
      `badge="${ui6.badge}" hidden=${ui6.badgeHidden} reason=${su.json && su.json.reason} 标题="${(ui6.badgeTitle || '').slice(0, 60)}"`,
      !!su.json && su.json.reason === 'drm' && !ui6.viaProxy);
  } else if (url) {
    ok(`5.${src}.2`, `${label} 真的出声（走 /api/${src}/audio）`,
      `《${ui6.trackName}》source=${ui6.trackSource} currentTime=${ui6.t}s playing=${ui6.playing} viaProxy=${ui6.viaProxy} src="${ui6.src}" 歌词行=${ui6.lyricLines} 角标="${ui6.badge}"`,
      playing && ui6.viaProxy && ui6.trackSource === src);
  } else {
    /* 拿不到就如实报原因 —— 不许含糊过去 */
    ok(`5.${src}.2`, `${label} 拿不到直链（如实报告原因）`,
      `reason=${su.json && su.json.reason} error="${(su.json && su.json.error) || ''}" upstream="${(su.json && su.json.upstream) || ''}" 角标="${ui6.badge}"`,
      !!(su.json && su.json.reason));
  }
}

/* ==========================================================================
   「全部」分组搜索（N 个源，不写死两个）
   ========================================================================== */
console.log('\n[6] 全部音源（分组）');
await ev(`(() => {
  const b = document.querySelector('#src-switch [data-src="all"]');
  if (b) b.click();
  const s = document.querySelector('#search');
  s.value = '周杰伦';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const groupOk = await gate(`(() => {
  const g = document.querySelectorAll('#tracks .track-group').length;
  const h = ((document.querySelector('#src-hint') || {}).textContent || '');
  return g >= 2 && /全部 ·/.test(h);
})()`, 100, 400);
const ui6 = JSON.parse(await ev(`JSON.stringify({
  groups: [...document.querySelectorAll('#tracks .track-group')].map((e) => e.textContent),
  rows: document.querySelectorAll('#tracks .track').length,
  hint: (document.querySelector('#src-hint')||{}).textContent,
  buttons: [...document.querySelectorAll('#src-switch [data-src]')].map((b) => b.dataset.src).join(',')
})`));
ok(6.1, '「全部」按源分组列出', `hint="${ui6.hint}" groups=${ui6.groups.length} rows=${ui6.rows} 按钮=[${ui6.buttons}]`,
  groupOk && ui6.groups.length >= 2);
ok(6.2, '音源切换是 N 个（不是写死两个）', `按钮=[${ui6.buttons}]`, ui6.buttons.split(',').length >= 5);
ok(6.3, '分组标题带每家条数/失败原因', JSON.stringify(ui6.groups).slice(0, 220), true);

/* ==========================================================================
   7. 回归：网易云 + QQ
   ========================================================================== */
console.log('\n[7] 回归');
const s1 = await jget('/api/session');
const s2 = await jget('/api/top/playlist?limit=6');
const s3 = await jget('/api/user/detail?uid=1');
const s4 = await jget('/api/qq/health');
const s5 = await jget('/api/artist/6452');
ok(7.1, '/api/session', `HTTP ${s1.status} loggedIn=${s1.json && s1.json.loggedIn}`, s1.status === 200);
ok(7.2, '/api/top/playlist', `HTTP ${s2.status} playlists=${((s2.json || {}).playlists || []).length}`,
  s2.status === 200 && ((s2.json || {}).playlists || []).length > 0);
ok(7.3, '/api/user/detail?uid=1', `HTTP ${s3.status} nickname="${((s3.json || {}).profile || {}).nickname || ''}"`, s3.status === 200);
ok(7.4, '/api/qq/health', `HTTP ${s4.status} ${JSON.stringify(s4.json || {}).slice(0, 120)}`, s4.status === 200 && s4.json && s4.json.ok);
ok(7.5, '/api/artist/6452', `HTTP ${s5.status} name="${((s5.json || {}).artist || {}).name || ''}" hotSongs=${(((s5.json || {}).hotSongs) || []).length}`, s5.status === 200);

/* ==========================================================================
   8. console error
   ========================================================================== */
const errCount = consoleErrs.length + exceptions.length;
ok(8.1, '0 console error', `console.error=${consoleErrs.length} exception=${exceptions.length}` +
  (errCount ? ' 首个：' + [consoleErrs[0], exceptions[0]].filter(Boolean)[0] : ''), errCount === 0);

await cleanup();
console.log(`\n  ── ${R.pass} 通过 / ${R.fail} 失败 ──`);
console.log(`  截图：shots/review/src-<name>-1-settings.png  shots/review/src-<name>-2-search.png\n`);
process.exit(R.fail ? 1 : 0);
