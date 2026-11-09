/** _djcheck.mjs —— DJ 面板验收：双 deck 载入 / 搓碟 / 横推 / EQ / 波形。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1192, H = 910;

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-dj-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
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
    errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 200));
  }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return r.result.value;
};
const shot = async (n) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`shots/review/${n}.png`, Buffer.from(png.data, 'base64'));
  console.log('  → shots/review/' + n + '.png');
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });
for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(`document.querySelectorAll('#hall-tools .hrow').length>0`)) break; }

console.log('=== 装两首能播的歌 ===');
console.log(' ', await ev(`(async () => {
  const d = await API.search('纯音乐', 12);
  const ok = [];
  for (const tr of d.tracks) {
    const u = await API.songUrl(tr.id); const it = (u.data || [])[0];
    if (it && it.url) { ok.push(tr); if (ok.length >= 2) break; }
  }
  if (ok.length < 2) return 'only ' + ok.length;
  Player.playQueue(ok, 0, false);
  return ok.map(x => x.name).join('  +  ');
})()`));

console.log('\n=== 进实验室 ===');
console.log(' ', await ev(`(() => { const b = document.querySelectorAll('#hall-tools .hrow')[0]; b.click(); return document.querySelector('.view.is-active')?.id; })()`));
await sleep(600);
console.log('  deck 数:', await ev(`document.querySelectorAll('.dj-deck').length`));
console.log('  platter 数:', await ev(`document.querySelectorAll('.platter--sm').length`));
console.log('  knob 数:', await ev(`document.querySelectorAll('.knob').length`));
console.log('  波形 canvas:', await ev(`document.querySelectorAll('.dj-wave').length`));

console.log('\n=== 自动载入 A/B 并解码（等）===');
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  const sa = await ev(`document.getElementById('djA-state')?.textContent`);
  const sb = await ev(`document.getElementById('djB-state')?.textContent`);
  if (i % 4 === 0) console.log(`  A=${sa} | B=${sb}`);
  if (/就绪|失败/.test(String(sa)) && /就绪|失败/.test(String(sb))) break;
}
console.log('  A:', await ev(`document.getElementById('djA-track')?.textContent`), '|', await ev(`document.getElementById('djA-state')?.textContent`));
console.log('  B:', await ev(`document.getElementById('djB-track')?.textContent`), '|', await ev(`document.getElementById('djB-state')?.textContent`));
await shot('dj-1-panel');

console.log('\n=== 播放 A ===');
await ev(`document.getElementById('djA-play').click(); 1`);
await sleep(1200);
console.log('  状态:', await ev(`document.getElementById('djA-state')?.textContent`));
console.log('  播放头:', await ev(`document.getElementById('djA-pos')?.textContent`));

console.log('\n=== 搓碟 A（拖转盘）===');
const box = JSON.parse(await ev(`(() => { const r = document.getElementById('platterA').getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2, r: r.width/2 }); })()`));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y - box.r * 0.7, button: 'none', clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y - box.r * 0.7, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 16; i++) {
  const ang = (-90 + i * 13) * Math.PI / 180;
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: box.x + Math.cos(ang) * box.r * 0.7, y: box.y + Math.sin(ang) * box.r * 0.7,
    button: 'left', buttons: 1,
  });
  await sleep(35);
}
console.log('  搓碟中状态:', await ev(`document.getElementById('djA-state')?.textContent`));
console.log('  转盘旋转:', await ev(`getComputedStyle(document.getElementById('platterA')).getPropertyValue('--rot')`).then(v => String(v).trim()));
await shot('dj-2-scratch');
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(700);
console.log('  落针后:', await ev(`document.getElementById('djA-state')?.textContent`));

console.log('\n=== 横推（等功率）===');
for (const v of [-100, 0, 100]) {
  await ev(`(() => { const el = document.getElementById('dj-cross'); el.value = ${v}; el.dispatchEvent(new Event('input')); return 1; })()`);
  await sleep(250);
  console.log(`  x=${v} →`, await ev(`document.getElementById('dj-cross-val')?.textContent`));
}
await ev(`(() => { const el = document.getElementById('dj-cross'); el.value = 0; el.dispatchEvent(new Event('input')); return 1; })()`);

console.log('\n=== EQ 旋钮拖动 ===');
const kb = JSON.parse(await ev(`(() => { const r = document.querySelector('.knob[data-deck="A"][data-eq="low"]').getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: kb.x, y: kb.y, button: 'none', clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: kb.x, y: kb.y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 8; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: kb.x, y: kb.y - i * 8, button: 'left', buttons: 1 });
  await sleep(25);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: kb.x, y: kb.y - 64, button: 'left', buttons: 0, clickCount: 1 });
await sleep(300);
console.log('  LOW 旋钮值:', await ev(`document.querySelector('.knob[data-deck="A"][data-eq="low"]')?.dataset.value`), '(初始 50，上拖应变大)');
console.log('  旋转角:', await ev(`getComputedStyle(document.querySelector('.knob[data-deck="A"][data-eq="low"]')).getPropertyValue('--rot')`).then(v => String(v).trim()));
await shot('dj-3-final');

console.log('\n=== 波形画布有内容 ===');
console.log(' ', await ev(`(() => { const c = document.getElementById('djA-wave'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i+3] > 10) n++; return n; })()`), '非透明像素');

console.log('\n异常:', errs.length ? errs.slice(0, 6).join(' ; ') : '无');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
