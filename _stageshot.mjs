/** _stageshot.mjs —— 形态页浮层（返回 / 选形态 / 当前歌曲）的截图验证。
 *  用法: node _stageshot.mjs 005 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const STAGE = process.argv[2] || '005';
const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-stage-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 160));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 120) : r.result.value; };
const shot = async (n) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`E:/DSHdesktop/work/music-player/shots/review/stage-${n}.png`, Buffer.from(r.data, 'base64'));
  console.log('  →', `shots/review/stage-${n}.png`);
};
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });

for (let i = 0; i < 60; i++) { await sleep(300); const n = await ev("document.querySelectorAll('.track').length"); if (n > 0) break; }
await sleep(600);

/* 播一首 → 进播放页 → 用设置里的形态菜单切到目标形态（走真实的 iris 转场） */
await ev("(() => { const t = document.querySelector('.track'); if (t) t.click(); return 1; })()");
await sleep(2200);
console.log('切形态:', await ev(`(() => {
  document.getElementById('btn-settings').click();
  const it = document.querySelector('.stage-item[data-id="${STAGE}"]');
  if (!it) return 'no item';
  it.click();
  return 'clicked';
})()`));
await sleep(3200);
await move(700, 500);            // 指针落在作品中间（浮层应可见但不展开歌名）
await sleep(400);
await shot('hud');
console.log('浮层状态:', await ev("(() => { const h = document.getElementById('stage-hud'); return h.className + ' | idle=' + h.classList.contains('is-idle') + ' near=' + h.classList.contains('is-near'); })()"));

/* 靠近左上一簇 → 歌名胶囊展开 */
await move(1250, 50);
await sleep(900);
await shot('near');
console.log('靠近后:', await ev("(() => { const s = document.getElementById('stage-song'); const r = s.getBoundingClientRect(); return 'near=' + document.getElementById('stage-hud').classList.contains('is-near') + ' w=' + Math.round(r.width) + ' name=' + document.getElementById('stage-name').textContent + ' sub=' + document.getElementById('stage-sub').textContent; })()"));


/* 量一下几何 */
console.log('几何:', await ev("(() => { const q=(s)=>{const e=document.querySelector(s); if(!e) return s+' -'; const r=e.getBoundingClientRect(); return s+' '+Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height);}; return [q('#stage-hud'),q('#stage-back'),q('#stage-pick-btn'),q('#stage-song'),q('.snow__pill'),q('.snow__art'),q('#stage-right'),q('#stage-name')].join(' | '); })()"));


/* 形态下拉 */
await move(1300, 40); await sleep(300);
await ev("document.getElementById('stage-pick-btn').click()");
await sleep(500);
await shot('menu');
console.log('下拉:', await ev("(() => { const p=document.getElementById('stage-menu-pop'); return 'open='+p.classList.contains('is-open')+' items='+p.querySelectorAll('.smenu__i').length+' on='+(p.querySelector('.smenu__i.is-on')||{}).textContent; })()"));
/* 点第 15 项换形态 */
console.log('换形态:', await ev("(() => { const it=document.querySelectorAll('.smenu__i')[14]; it.click(); return it.dataset.id; })()"));
await sleep(3000);
await shot('switched');
console.log('换后:', await ev("document.getElementById('stage-frame').getAttribute('src')"));

/* 迷你播放器：拖时间轴 */
await move(1150, 45); await sleep(700);
await shot('mini');

/* 停住 2.6s+ → 整簇淡出 */
await move(700, 500);
await sleep(3400);
await shot('idle');
console.log('静止后:', await ev("document.getElementById('stage-hud').className"));

/* 返回主播放器按钮 */
await move(800, 450); await sleep(200);
await ev("document.getElementById('stage-hud').classList.remove('is-idle')");
await ev("document.getElementById('stage-back').click()");
await sleep(1200);
await shot('back');
console.log('返回后 view:', await ev("document.getElementById('view-now').classList.contains('is-active') + ' stage=' + document.getElementById('view-stage').classList.contains('is-active') + ' src=' + (document.getElementById('stage-frame').getAttribute('src') || 'null')"));

console.log('异常: ' + (errs.length ? errs.slice(0, 4).join(' ; ') : '无'));
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}

