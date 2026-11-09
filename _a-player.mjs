/* _a-player.mjs —— 验证车道 A 的 236–248 进了播放器（真实设置面板 + 真实 iris 转场）
   用法：
     node _a-player.mjs                 # 菜单截图 + 切到 246 截图
     node _a-player.mjs 246,241,248     # 指定几个形态各切一次
   产出：shots/review/p300-A-player-menu.png / p300-A-player-<NNN>.png
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const PORT = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(ROOT, 'shots/review');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const arg = (process.argv[2] || '').trim();
const IDS = /^\d{3}(,\d{3})*$/.test(arg) ? arg.split(',').map((s) => s.trim()) : ['246'];
const WANT_MENU = true;

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-ap-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP,
  '--window-size=1600,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

async function tabOf() {
  for (let i = 0; i < 100; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t;
    } catch {}
    await sleep(200);
  }
  throw new Error('no tab');
}
const tab = await tabOf();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    errs.push('console: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 140));
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push('exc: ' + (((d.exception && d.exception.description) || d.text || '').split('\n')[0]).slice(0, 140));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 160) : r.result.value; };
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log('  →', 'shots/review/' + name);
};
const audio = () => ev(`(() => { const a = document.querySelector('audio'); return a ? JSON.stringify({t:+a.currentTime.toFixed(2),d:+(a.duration||0).toFixed(1),paused:a.paused}) : 'none'; })()`);

await send('Page.enable'); await send('Runtime.enable');
/* 新 profile 每次都会弹引导 —— 先把「已看过」写进 localStorage，再兜底按 Esc */
await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('lizi.tour.v1','1')}catch(e){}" });
const pressEsc = async () => {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
};
const dismissOverlays = async () => {
  for (let i = 0; i < 8; i++) {
    const o = JSON.parse(String(await ev(`(() => {
      const t = document.getElementById('tour');
      const tourOn = !!(t && !t.hidden && getComputedStyle(t).display !== 'none');
      const w = [...document.querySelectorAll('button,a,[role=button]')]
        .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 4 && b.height > 4; })
        .find((e) => /开始看看|开始用|跳过/.test(e.innerText || ''));
      return JSON.stringify({ tourOn, btn: w ? (w.innerText || '').trim().slice(0, 6) : '' });
    })()`)));
    if (!o.tourOn && !o.btn) return 'clean';
    if (o.tourOn) { await pressEsc(); } else { await ev(`(() => { const w=[...document.querySelectorAll('button,a,[role=button]')].find((e)=>/开始看看|开始用|跳过/.test(e.innerText||'')); if(w) w.click(); return 1; })()`); }
    await sleep(900);
  }
  return 'still-busy';
};
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
for (let i = 0; i < 90; i++) { await sleep(250); if (await ev("document.querySelectorAll('.hall-pl').length") > 0) break; }
await sleep(800);

/* 关掉欢迎层 / 引导层（新 profile 每次都会弹） */
console.log('遮罩:', await dismissOverlays());

/* 开一首歌：进一张真有曲目的歌单，再挑一首**有词**的（挑不到词就换下一首） */
const waitFor = async (expr, ms = 14000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(400); }
  return false;
};
let gotList = false;
for (let k = 0; k < 4 && !gotList; k++) {
  await ev(`(() => { const c = document.querySelectorAll('.hall-pl')[${k}]; if (c) c.click(); return 1; })()`);
  gotList = await waitFor("document.querySelectorAll('.track').length > 2", 13000);
  console.log(`  歌单[${k}] 曲目数:`, await ev("document.querySelectorAll('.track').length"));
  if (!gotList) { await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }); await sleep(3500); }
}
let lyr = '';
for (let k = 0; k < 6 && !lyr.trim(); k++) {
  await ev(`(() => { const r = document.querySelectorAll('.track')[${k}]; if (r) r.click(); return 1; })()`);
  await sleep(5200);
  lyr = String(await ev("(document.querySelector('.lyrics')||{}).innerText||''")).replace(/\s+/g, ' ');
  console.log(`  第 ${k + 1} 首 歌词:`, lyr.slice(0, 44) || '(空)');
}

/* 播放页抽屉 = 真实的形态选择器 */
const openDrawer = () => ev("(() => { const b = document.getElementById('btn-drawer'); if (!b) return 'no btn'; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 'ok'; })()");
const closeDrawer = () => ev("(() => { const b = document.getElementById('btn-drawer'); if (b && b.getAttribute('aria-expanded') === 'true') b.click(); return 'ok'; })()");
console.log('抽屉:', await openDrawer());
await sleep(1000);
/* 抽屉里点「进入形态」才展开形态列表 */
console.log('展开形态:', await ev(`(() => {
  const row = [...document.querySelectorAll('#drawer .drawer__row, #drawer [role=button], #drawer button')]
    .find((e) => /进入形态/.test(e.innerText || ''));
  if (!row) return 'no row';
  row.click();
  return 'ok';
})()`));
await sleep(1200);
console.log('抽屉形态数:', await ev("document.querySelectorAll('#drawer-stage-list .stage-item[data-id]').length"));
console.log('236-248 在册:', await ev(`(() => {
  const ids = [...document.querySelectorAll('#drawer-stage-list .stage-item[data-id]')].map((e) => e.dataset.id);
  return ${JSON.stringify(Array.from({ length: 13 }, (_, i) => String(236 + i)))}.filter((w) => ids.includes(w)).length + '/13';
})()`));
await ev("(() => { const it = document.querySelector('#drawer-stage-list .stage-item[data-id=\"248\"]'); if (it) it.scrollIntoView({ block: 'center' }); return 1; })()");
await sleep(900);
await shot('p300-A-player-picker.png');
console.log('抽屉底部可见:', await ev(`(() => {
  const r = [...document.querySelectorAll('#drawer-stage-list .stage-item[data-id]')]
    .filter((e) => /^(23[6-9]|24[0-8])$/.test(e.dataset.id))
    .filter((e) => { const b = e.getBoundingClientRect(); return b.top > -10 && b.bottom < innerHeight + 10; });
  return r.length + ' 条在视口内 :: ' + r.map((e) => e.dataset.id + e.querySelector('.stage-item__name').innerText).join(' ');
})()`));
await closeDrawer();
await sleep(600);

/* 切到目标形态（真实 iris 转场），等歌词真的到了再截图 */
const stageState = () => ev(`(() => {
  const f = document.getElementById('stage-frame');
  if (!f || !f.contentWindow || !f.contentWindow.__stage) return 'no iframe/__stage';
  try {
    const s = f.contentWindow.__stage();
    return 'idx=' + s.idx + ' t=' + (+(s.t || 0)).toFixed(2) + ' frames=' + s.frames
      + ' gl=' + s.gl + ' rm=' + s.rm + ' js=' + s.js + ' err="' + s.err + '" text="' + (s.text || '') + '"';
  } catch (e) { return 'threw: ' + e.message; }
})()`);
const ready = `(() => { const f = document.getElementById('stage-frame'); try { const s = f.contentWindow.__stage(); return s.idx >= 0 || (s.text || '').length > 0; } catch (e) { return false; } })()`;

for (const sid of IDS) {
  await openDrawer(); await sleep(800);
  const r = await ev(`(() => {
    const it = document.querySelector('#drawer-stage-list .stage-item[data-id="${sid}"]');
    if (!it) return 'no item ${sid}';
    it.scrollIntoView({ block: 'center' });
    it.click();
    return 'clicked ${sid}';
  })()`);
  console.log('切形态:', r);
  await sleep(1200);
  const okLyr = await waitFor(ready, 22000);
  console.log('  歌词就绪:', okLyr);
  await sleep(3200);
  console.log(`  ${sid} __stage():`, await stageState());
  await shot(`p300-A-player-${sid}.png`);
}

console.log('console errors:', errs.length ? errs.slice(0, 6) : 'none');
try { ws.close(); } catch {}
ch.kill();
