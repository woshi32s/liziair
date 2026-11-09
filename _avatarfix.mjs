/* 两个小修：① 大厅头像不再被 banner 白雾洗掉 ② 顶栏只显示小人图标
   跑法：node _avatarfix.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const port = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const CDP = 9463;
const profile = path.join(os.tmpdir(), 'lizi-av-' + Date.now());
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

async function tabOf() {
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl); if (t) return t; } catch {}
    await sleep(250);
  }
  throw new Error('CDP 起不来');
}
const t = await tabOf();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __exc: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text }; return r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
await sleep(1600);
for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('#hall-me .me-wrap .me__ava')`)) break; await sleep(250); }
await sleep(1200);

const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

const a = await ev(`(() => {
  const ava = document.querySelector('#hall-me .me__ava');
  const cs = ava ? getComputedStyle(ava) : null;
  const banner = document.querySelector('#hall-me .me__banner');
  return {
    z: cs ? cs.zIndex : null,
    pos: cs ? cs.position : null,
    bg: cs ? cs.backgroundImage.slice(0, 60) : null,
    w: ava ? Math.round(ava.getBoundingClientRect().width) : 0,
    bannerAfterZ: banner ? getComputedStyle(banner, '::after').zIndex : null,
  };
})()`);
ok(Number(a.z) >= 3, `大厅头像 z-index=${a.z}（要 ≥3，banner::after 是 ${a.bannerAfterZ}）`);
ok(a.pos === 'relative', `头像 position=${a.pos}`);
ok(a.w >= 80, `头像尺寸=${a.w}px`);

const b = await ev(`(() => {
  const img = document.getElementById('user-avatar');
  const ico = document.getElementById('user-ico');
  return { imgHidden: img ? img.hidden : null, icoHidden: ico ? ico.hidden : null,
           icoVisible: ico ? getComputedStyle(ico).display !== 'none' : null,
           btn: (document.getElementById('btn-user') || {}).getAttribute ? document.getElementById('btn-user').getAttribute('aria-label') : null };
})()`);
ok(b.imgHidden === true && b.icoHidden === false && b.icoVisible === true, `顶栏：img hidden=${b.imgHidden} / ico hidden=${b.icoHidden} 可见=${b.icoVisible}（aria=${b.btn}）`);

/* 设置页账号块仍要有头像 */
await ev(`document.getElementById('btn-settings')?.click()`);
await sleep(900);
const c = await ev(`(() => {
  const el = document.getElementById('set-account-avatar');
  if (!el) return null;
  return { src: (el.getAttribute('src') || '').slice(0, 70), hidden: el.hidden, w: Math.round(el.getBoundingClientRect().width) };
})()`);
ok(c && /api\/img/.test(c.src) && c.hidden === false, `设置页账号头像是 <img src>：${c ? c.src.slice(0, 50) + '… hidden=' + c.hidden + ' w=' + c.w : 'null'}`);

const shot1 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(ROOT, 'shots/review/avfix-1-settings.png'), Buffer.from(shot1.data, 'base64'));

await ev(`show ? show('hall') : (document.querySelector('#btn-back')||{}).click?.()`);
await sleep(1000);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(ROOT, 'shots/review/avfix-2-hall.png'), Buffer.from(shot2.data, 'base64'));

ws.close(); proc.kill(); await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
