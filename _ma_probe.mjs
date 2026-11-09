/** 临时探针：查 [7] 顶栏返回为什么没回架子 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-probe-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-gpu',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result || {}); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, timeout: 60000 });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || '').split('\n')[0];
  return r.result ? r.result.value : undefined;
};
const gate = async (c, n = 60, ms = 200) => { for (let i = 0; i < n; i++) { if (await ev(c)) return true; await sleep(ms); } return false; };
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const state = async (tag) => console.log(tag.padEnd(26), JSON.stringify(JSON.parse(await ev(`(() => JSON.stringify({
  view: document.body.dataset.view,
  stack: window.__LIZI_PAGES ? window.__LIZI_PAGES.stack() : null,
  src: window.__LIZI_PAGES ? window.__LIZI_PAGES.source() : null,
  album: (document.querySelector('#view-album .pg-album-name') || {}).textContent,
  sel: window.__LIZI_MYALBUMS ? window.__LIZI_MYALBUMS.index() : null,
  topLeft: (document.querySelector('.topbar__left') || {}).className,
  backLabel: (document.getElementById('btn-settings') || {}).ariaLabel,
}))()`))));

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });
await gate(`document.querySelectorAll('#hall-tools .hrow').length > 0`, 80, 300);

const ALB = JSON.parse(await ev(`fetch('/api/artist/albums/6452?limit=5&offset=0').then(r=>r.json())
  .then(d=>JSON.stringify((d.albums||[]).slice(0,5).map(a=>({id:a.id,name:a.name}))))`));
console.log('albums', ALB.map(a=>a.name).join(' / '));

/* 种 5 条收藏（模拟专辑页收过的） */
await ev(`localStorage.setItem('lizi.myAlbums.v1', JSON.stringify(${JSON.stringify(ALB)}.map((a,i)=>({
  id:'netease:'+a.id, name:a.name, artists:'周杰伦', cover:'', publishTime:0, trackCount:3, source:'netease', addedAt: Date.now()+i
}))))`);
console.log('seeded len =', await ev(`JSON.parse(localStorage.getItem('lizi.myAlbums.v1')).length`));

/* 从大厅入口开 */
await ev(`(() => { const b=[...document.querySelectorAll('#hall-tools .hrow')].find(x=>/我的专辑/.test(x.textContent)); b.click(); return 1; })()`);
await gate(`document.body.dataset.view==='myalbums'`, 40, 200);
await sleep(400);
await state('after hall entry');
console.log('items =', await ev(`document.querySelectorAll('#view-myalbums .ma-item').length`));

/* 点第 2 张 */
const r = JSON.parse(await ev(`(() => { const e=document.querySelectorAll('#view-myalbums .ma-item')[1];
  const b=e.getBoundingClientRect(); return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2}); })()`));
await clickAt(r.x, r.y);
await gate(`document.body.dataset.view==='album'`, 60, 200);
await sleep(300);
await state('after click item[1]');

/* 顶栏返回：先 JS .click() */
await ev(`document.getElementById('btn-settings').click()`);
await sleep(500);
await state('after JS back click');

/* 再用真鼠标点一次 */
const rb = JSON.parse(await ev(`(() => { const b=document.getElementById('btn-settings').getBoundingClientRect();
  return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2,w:b.width,h:b.height,vis:getComputedStyle(document.getElementById('btn-settings')).visibility}); })()`));
console.log('btn-settings rect', rb);
await clickAt(rb.x, rb.y);
await sleep(500);
await state('after mouse back click');

/* JS 再点一次（架子 → 大厅?） */
await ev(`document.getElementById('btn-settings').click()`);
await sleep(500);
await state('after 2nd JS back');

console.log('errors', errs);
ws.close(); ch.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
process.exit(0);
