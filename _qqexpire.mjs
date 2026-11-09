/**
 * _qqexpire.mjs —— 验证「二维码过期（800）能自动换一张」
 *
 * 真实二维码 TTL 是 3 分钟（包里的 QR_TTL_MS），所以这个脚本要等 ~3 分钟。
 * 不伪造状态：只观察页面自己的轮询请求（CDP Network）和状态文案。
 *
 *   node _qqexpire.mjs
 *
 * 断言并打印：
 *   - 第一张码的 key、出现的秒数
 *   - 状态文案从「扫码」变成「过期」的秒数
 *   - 有没有出现**第二张不同的 key**（= 真的换了码）
 *   - 第二张码的 naturalWidth
 */
import { spawn } from 'node:child_process';
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
fs.mkdirSync(OUT, { recursive: true });

const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port;
await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-qqexpire-' + Date.now());
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
const keys = [];              // 页面轮询用过的 key，按出现顺序
const statusLog = [];         // { t, text }
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Network.requestWillBeSent') {
    const u = (m.params && m.params.request && m.params.request.url) || '';
    const i = u.indexOf('/api/qq/login/qr/check?key=');
    if (i >= 0) {
      const k = decodeURIComponent(u.slice(i + '/api/qq/login/qr/check?key='.length).split('&')[0]);
      if (!keys.includes(k)) keys.push(k);
    }
  }
};
const send = (m, p = {}) => new Promise((res) => {
  const i = ++id;
  pend.set(i, { resolve: res });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, timeout: 120000 });
  return r.result ? r.result.value : undefined;
};
const shot = async (name, clip) => {
  const p = { format: 'png', captureBeyondViewport: false };
  if (clip) p.clip = { ...clip, scale: clip.scale || 1 };
  const png = await send('Page.captureScreenshot', p);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(png.data, 'base64'));
  console.log('    → shots/review/' + name);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '/' });

for (let i = 0; i < 60; i++) {
  if (await ev(`typeof API === 'object' && !!document.querySelector('#btn-settings')`)) break;
  await sleep(300);
}
await ev(`document.querySelector('#btn-settings').click()`);
await sleep(400);
await ev(`document.querySelector('#qq-login').click()`);

const t0 = Date.now();
let firstKeyAt = 0;
for (let i = 0; i < 100; i++) {
  if (keys.length) { firstKeyAt = Date.now() - t0; break; }
  await sleep(300);
}
console.log(`\n  第一张码出现：${(firstKeyAt / 1000).toFixed(1)}s  key=${String(keys[0]).slice(0, 12)}…`);

/* 盯状态文案 + 第二张 key，最多 4 分钟 */
let expiredAt = 0, secondKeyAt = 0, lastText = '';
for (let i = 0; i < 240; i++) {
  await sleep(1000);
  const st = JSON.parse(await ev(`JSON.stringify({
    text: (document.querySelector('#qq-qr-status')||{}).textContent || '',
    img: (() => { const i = document.querySelector('#qq-qr-box img'); return i ? i.naturalWidth : 0; })()
  })`));
  if (st.text !== lastText) {
    lastText = st.text;
    statusLog.push({ t: ((Date.now() - t0) / 1000).toFixed(0), text: st.text });
    console.log(`  ${statusLog[statusLog.length - 1].t}s  状态："${st.text}"`);
  }
  if (!expiredAt && /过期/.test(st.text)) expiredAt = Date.now() - t0;
  if (keys.length > 1 && !secondKeyAt) {
    secondKeyAt = Date.now() - t0;
    console.log(`  ${(secondKeyAt / 1000).toFixed(0)}s  出现第二张码：key=${String(keys[1]).slice(0, 12)}…  imgWidth=${st.img}`);
    const r = await ev(`(() => { const e = document.querySelector('#settings-panel').getBoundingClientRect();
      return JSON.stringify({ x: Math.max(0,e.x-10), y: Math.max(0,e.y-10), width: e.width+20, height: e.height+20 }); })()`);
    try { await shot('qq-4-qr-refreshed.png', { ...JSON.parse(r), scale: 2 }); } catch { /* ignore */ }
    break;
  }
}

const pass = keys.length > 1 && expiredAt > 0;
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}  过期自动换码：过期提示=${expiredAt ? (expiredAt / 1000).toFixed(0) + 's' : '没等到'}，` +
  `key 数=${keys.length}（${keys.length > 1 ? '换了新码' : '没有新码'}）`);
console.log(`  TTL 预期 180s；实际过期提示在 ${expiredAt ? (expiredAt / 1000).toFixed(0) + 's' : '—'}\n`);

try { ws.close(); } catch { /* ignore */ }
try { chrome.kill(); } catch { /* ignore */ }
await sleep(400);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch { /* ignore */ }
process.exit(pass ? 0 : 1);
