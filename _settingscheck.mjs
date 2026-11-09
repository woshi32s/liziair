/** _settingscheck.mjs —— 顶栏/设置/返回 一轮验证。用法: node _settingscheck.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1192, H = 910;

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-sc-' + Date.now());
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
const shot = async (n) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`shots/review/${n}.png`, Buffer.from(png.data, 'base64'));
  console.log('  → shots/review/' + n + '.png');
};
const ok = (b) => (b ? '✓' : '✗');

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });
await sleep(3500);

console.log('=== 1. 初始（大厅）===');
console.log('  视图:', await ev(`document.querySelector('.view.is-active')?.id`));
console.log('  topbar is-stuck:', await ev(`document.getElementById('topbar').classList.contains('is-stuck')`), '(应为 false)');
console.log('  左键模式 is-back:', await ev(`document.querySelector('.topbar__left').classList.contains('is-back')`), '(应为 false)');
console.log('  玻璃下沿暗部 opacity:', await ev(`getComputedStyle(document.getElementById('topbar'),'::after').opacity`), '(应为 0)');

console.log('\n=== 2. 大厅下滑 → logo 收缩 + 玻璃下沿暗部 ===');
await ev(`document.getElementById('view-hall').scrollTop = 260; 1`);
await sleep(600);
console.log('  is-stuck:', await ev(`document.getElementById('topbar').classList.contains('is-stuck')`), '(应为 true)');
console.log('  暗部 opacity:', await ev(`getComputedStyle(document.getElementById('topbar'),'::after').opacity`), '(应为 1)');
console.log('  brand__word 宽度:', await ev(`getComputedStyle(document.querySelector('.brand__word')).maxWidth`), '(应收缩到 0px)');
console.log('  brand__air opacity:', await ev(`getComputedStyle(document.querySelector('.brand__air')).opacity`));
await shot('set-1-hall-stuck');

console.log('\n=== 3. 滚回顶部 → 复原 ===');
await ev(`document.getElementById('view-hall').scrollTop = 0; 1`);
await sleep(500);
console.log('  is-stuck:', await ev(`document.getElementById('topbar').classList.contains('is-stuck')`), '(应为 false)');

console.log('\n=== 4. 设置面板内容 ===');
console.log('  面板里还有 #btn-lite 吗:', await ev(`!!document.getElementById('btn-lite')`), '(应 false)');
console.log('  面板里还有 #btn-stage-menu 吗:', await ev(`!!document.getElementById('btn-stage-menu')`), '(应 false)');
console.log('  面板里还有 #stage-quality 吗:', await ev(`!!document.getElementById('stage-quality')`), '(应 false)');
console.log('  占位项数:', await ev(`document.querySelectorAll('#settings-panel .settings__row').length`));
console.log('  占位项名称:', await ev(`[...document.querySelectorAll('#settings-panel .settings__label')].map(e=>e.textContent).join(' / ')`));
console.log('  抽屉形态列表条数:', await ev(`document.querySelectorAll('#drawer-stage-list .stage-item').length`), '(应 >0，不能因为删了设置里的列表而空掉)');
console.log('  画质 --stage-scale:', await ev(`getComputedStyle(document.documentElement).getPropertyValue('--stage-scale').trim()`), '(应为 1)');

console.log('\n=== 5. 大厅里点左键 → 开设置 ===');
await ev(`document.getElementById('btn-settings').click(); 1`);
await sleep(500);
console.log('  面板打开:', await ev(`!document.getElementById('settings-panel').hidden`), '(应 true)');
await shot('set-2-panel');

console.log('\n=== 6. 搜索 → 左键液化成返回 ===');
await ev(`document.getElementById('settings-panel').hidden = true; 1`);
await ev(`(() => { const s = document.getElementById('search'); s.value = '草东'; s.dispatchEvent(new Event('input', {bubbles:true})); return 1; })()`);
await sleep(3000);
console.log('  视图:', await ev(`document.querySelector('.view.is-active')?.id`), '(应 view-browse)');
console.log('  左键 is-back:', await ev(`document.querySelector('.topbar__left').classList.contains('is-back')`), '(应 true)');
console.log('  返回箭头 opacity:', await ev(`getComputedStyle(document.querySelector('#btn-settings .ico-back')).opacity`), '(应 1)');
console.log('  齿轮 opacity:', await ev(`getComputedStyle(document.querySelector('#btn-settings .ico-set')).opacity`), '(应 0)');
console.log('  曲目数:', await ev(`document.querySelectorAll('#tracks .track').length`));
await shot('set-3-search-back');

console.log('\n=== 7. 点返回 → 回大厅、搜索清空 ===');
await ev(`document.getElementById('btn-settings').click(); 1`);
await sleep(900);
console.log('  视图:', await ev(`document.querySelector('.view.is-active')?.id`), '(应 view-hall)');
console.log('  搜索框:', JSON.stringify(await ev(`document.getElementById('search').value`)), '(应空)');
console.log('  左键 is-back:', await ev(`document.querySelector('.topbar__left').classList.contains('is-back')`), '(应 false)');
await shot('set-4-back-to-hall');

console.log('\n=== 8. 非大厅点左键不应开设置 ===');
await ev(`document.getElementById('search').value='伍佰'; document.getElementById('search').dispatchEvent(new Event('input',{bubbles:true})); 1`);
await sleep(2500);
await ev(`document.getElementById('btn-settings').click(); 1`);   // 这会触发「返回」而不是设置
await sleep(700);
console.log('  点完后的视图:', await ev(`document.querySelector('.view.is-active')?.id`), '(应回 view-hall，说明没开设置)');
console.log('  面板是否打开:', await ev(`!document.getElementById('settings-panel').hidden`), '(应 false)');

console.log('\n异常:', errs.length ? errs.slice(0, 6).join(' ; ') : '无');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
