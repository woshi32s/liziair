/**
 * 登录专项截图（临时脚本，跑完可删）
 *   node _login4-shot.mjs panel          → shots/review/login4-1-panel.png
 *   node _login4-shot.mjs panel jump     → 同上，但先点「扫不上？粘贴 Cookie」把输入框点亮
 *   node _login4-shot.mjs error          → shots/review/login4-2-error.png（CDP 伪造 803 + harvest 失败）
 * 只驱动无头 Chrome，不碰 Electron 窗口。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const MODE = process.argv[2] || 'panel';
const JUMP = process.argv.includes('jump');
const PORT = fs.readFileSync('.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port;
await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-login4-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

for (let i = 0; i < 60; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(250); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const consoleErrors = [];
let harvestHits = 0;
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout ' + method))), 60000);
});
const fulfill = (requestId, code, obj) => send('Fetch.fulfillRequest', {
  requestId,
  responseCode: code,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
  body: Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'),
});

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push('console.error: ' + (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    consoleErrors.push('uncaught: ' + (d.exception?.description || d.text || 'unknown'));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    consoleErrors.push('log: ' + m.params.entry.text + ' @ ' + (m.params.entry.url || '-'));
  }
  if (m.method === 'Network.responseReceived' && m.params.response && m.params.response.status >= 400) {
    consoleErrors.push('http ' + m.params.response.status + ' ' + m.params.response.url);
  }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    if (request.url.includes('/api/login/harvest')) {
      harvestHits++;
      fulfill(requestId, 400, {
        ok: false,
        reason: 'no-music-u',
        message: '扫码已确认，但上游这次没下发 MUSIC_U',
        harvest: { tried: ['check', 'status'], gotCookie: false, field: null },
        cookieKeys: [],
      }).catch(() => {});
    } else if (request.url.includes('login/qr/check')) {
      if (MODE === 'success') {
        fulfill(requestId, 200, {
          code: 803, message: '授权登陆成功', hasMusicU: true, cookieKeys: ['MUSIC_U'],
          channel: 'netease-api', loggedIn: true,
          profile: { userId: 1000001, nickname: '已登录的样子', avatar: '', vipType: 0 },
          harvest: { tried: ['cache'], gotCookie: true, field: 'body.cookie' },
        }).catch(() => {});
      } else {
        fulfill(requestId, 200, {
          code: 803, message: '授权登陆成功', hasMusicU: false, cookieKeys: [],
          channel: 'netease-api', loggedIn: false, harvest: null,
        }).catch(() => {});
      }
    } else if (request.url.includes('/api/user/playlist')) {
      fulfill(requestId, 200, { code: 200, more: false, playlist: [] }).catch(() => {});
    } else {
      send('Fetch.continueRequest', { requestId }).catch(() => {});
    }
  }
};

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.text };
  return r.result.value;
};
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('  wrote ' + file + '  (' + fs.statSync(file).size + ' bytes)');
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
if (MODE !== 'panel') {
  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*login/qr/check*', requestStage: 'Request' },
      { urlPattern: '*api/login/harvest*', requestStage: 'Request' },
      { urlPattern: '*api/user/playlist*', requestStage: 'Request' },
    ],
  });
}

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
for (let i = 0; i < 80; i++) {
  await sleep(200);
  if ((await ev('document.readyState')) === 'complete') break;
}
await sleep(1200);

console.log(`mode=${MODE}${JUMP ? '+jump' : ''}`);
console.log('  click #btn-user →', await ev(`!!document.getElementById('btn-user')`));
await ev(`document.getElementById('btn-user').click()`);
await sleep(900);

if (MODE === 'error') {
  /* 轮询 2s 一拍，等到错误文案上屏 */
  let txt = '';
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    txt = await ev(`(document.getElementById('qr-status')||{}).textContent || ''`);
    const hasErr = await ev(`!!document.querySelector('#qr-status.is-error')`);
    if (hasErr && txt) break;
  }
  console.log('  status: ' + txt);
  console.log('  cookie-hot: ' + await ev(`!!document.querySelector('.cookie-hot')`));
  await sleep(900);          // 等高亮脉冲走完一轮、平滑滚动停稳
  await shot('shots/review/login4-2-error.png');
} else if (MODE === 'success') {
  for (let i = 0; i < 25; i++) {
    await sleep(300);
    if (await ev(`document.getElementById('modal').classList.contains('is-closed')`)) break;
  }
  const closed = await ev(`document.getElementById('modal').classList.contains('is-closed')`);
  const who = await ev(`document.getElementById('user-name').textContent`);
  console.log('  harvest 调用次数(应为 0): ' + harvestHits);
  console.log('  弹窗已关闭: ' + closed + '  · 用户名: ' + who);
} else {
  if (JUMP) {
    await ev(`document.getElementById('cookie-jump') && document.getElementById('cookie-jump').click()`);
    await sleep(900);
    console.log('  cookie-hot: ' + await ev(`!!document.querySelector('.cookie-hot')`));
  }
  await shot('shots/review/login4-1-panel.png');
}

console.log('  status now: ' + (await ev(`(document.getElementById('qr-status')||{}).textContent || ''`)));
console.log('  console errors: ' + consoleErrors.length);
for (const e of consoleErrors.slice(0, 8)) console.log('   - ' + e);

ws.close();
try { ch.kill(); } catch { /* ignore */ }
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* chrome 还在写，留给系统清 */ }
process.exit(0);
