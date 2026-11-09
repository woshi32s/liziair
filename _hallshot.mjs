/** _hallshot.mjs —— 大厅验收截图（主项目 index.html）。用法: node _hallshot.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1192, H = 910;

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-hall-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`shots/review/${name}.png`, Buffer.from(png.data, 'base64'));
  console.log('  → shots/review/' + name + '.png');
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });
await sleep(3500);

/* 预置一个「上一首播放」，验证封面恢复 */
await ev(`localStorage.setItem('lizi.hall.lastTrack', JSON.stringify({
  id: 1901371647, name: '宝船', artists: '二手玫瑰 / 乐队的夏天', cover: '',
  duration: 252000, at: Date.now() - 1000 * 60 * 47
})); location.reload(); 1`);
await sleep(3500);

console.log('\n=== 视图 ===');
console.log('  当前视图:', await ev(`document.querySelector('.view.is-active')?.id`));
console.log('  hero 标题:', await ev(`document.getElementById('hall-hero-title')?.textContent`));
console.log('  hero 副题:', await ev(`document.getElementById('hall-hero-sub')?.textContent`));
console.log('  hero 时间:', await ev(`document.getElementById('hall-hero-when')?.textContent`));
console.log('  四列行数:', await ev(`['hall-daily','hall-picks','hall-tools','hall-me'].map(i=>document.getElementById(i)?.children.length).join('/')`));
console.log('  歌单卡片:', await ev(`document.querySelectorAll('#hall-feed .hall-pl').length`));
console.log('  歌单副标题:', await ev(`document.getElementById('hall-feed-sub')?.textContent`));
console.log('  歌单封面图:', await ev(`document.querySelectorAll('#hall-feed img').length`));
await shot('hall-1-top');

/* 滚到歌单区 */
await ev(`document.getElementById('view-hall').scrollTop = 640; 1`);
await sleep(700);
await shot('hall-2-feed');

/* 滚到底 */
await ev(`const v=document.getElementById('view-hall'); v.scrollTop = v.scrollHeight; 1`);
await sleep(900);
await shot('hall-3-bottom');
console.log('  滚到底后出现「已经到底了」:', await ev(`!!document.querySelector('.hall-feed__end')`));

/* 点第一张歌单，看是否切到 browse 并载入曲目 */
await ev(`document.getElementById('view-hall').scrollTop = 700; 1`);
await sleep(300);
const clicked = await ev(`(() => { const c = document.querySelector('#hall-feed .hall-pl'); if (!c) return 'no card';
  c.click(); return 'clicked ' + c.dataset.name; })()`);
console.log('\n=== 点歌单 ===');
console.log(' ', clicked);
await sleep(2600);
console.log('  当前视图:', await ev(`document.querySelector('.view.is-active')?.id`));
console.log('  歌单名:', await ev(`document.getElementById('pl-name')?.textContent`));
console.log('  曲目数:', await ev(`document.querySelectorAll('#tracks .track').length`));
await shot('hall-4-playlist');

console.log('\n异常:', errs.length ? errs.slice(0, 5).join(' ; ') : '无');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
