/* 临时探针：看 248 的倒影层到底在哪、什么透明度 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const PORT = 9899 + Math.floor(Math.random() * 90);
const read = (p) => readFileSync(p, 'utf8').trim();
const URL0 = 'http://127.0.0.1:' + read('.port') + '/stages/248-mercury-meniscus.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.env.TEMP + '\\cdp-q' + PORT,
  '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
let ws, mid = 0; const pend = new Map();
for (let i = 0; i < 80; i++) {
  try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const j = await r.json();
    const pg = j.find((x) => x.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch (_) {}
  await sleep(250);
}
await new Promise((res) => { ws.onopen = res; });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++mid; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : r; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL0 });
await sleep(1500);
const L = JSON.stringify([{ t: 0, text: '雨落在没有人的站台' }, { t: 4, text: '灯把影子拉得很长' }, { t: 8, text: '我等一班不会来的车' }]);
await ev(`window.postMessage({__c100:1,type:'init',payload:{lines:${L},song:{title:'p',artist:'a',cover:''}}},'*')`);
await sleep(300);
await ev(`window.postMessage({__c100:1,type:'tick',payload:{time:${Number(process.argv[2] || 2.0)},playing:true}},'*')`);
await sleep(1900);
console.log(await ev(`(() => {
  const out = [];
  document.querySelectorAll('.slot').forEach((sl, i) => {
    const b = sl.getBoundingClientRect(); const cs = getComputedStyle(sl);
    const sp = sl.querySelector('span');
    out.push({ i, cls: sl.className, op: cs.opacity, z: cs.zIndex, filt: cs.filter,
      rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      n: sl.querySelectorAll('span').length, txt: sl.textContent.slice(0, 12),
      spOp: sp ? sp.style.opacity : null, spCol: sp ? sp.style.color : null, spTr: sp ? sp.style.transform : null });
  });
  const r = document.getElementById('refl');
  const b = r.getBoundingClientRect();
  const cs = getComputedStyle(r);
  return JSON.stringify({ txt: r.textContent, slots: out, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    op: cs.opacity, top: cs.top, tr: cs.transform, fs: cs.fontSize, color: cs.color,
    mask: (cs.maskImage || '').slice(0, 40), z: cs.zIndex, vis: cs.visibility, st: window.__stage() });
})()`));
ws.close(); chrome.kill();
