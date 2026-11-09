/**
 * e2e-stages.mjs —— 在**真实播放器界面**里逐个点开指定形态，验证：
 *   ① 设置面板里的形态菜单能不能点
 *   ② iframe 里加载的是不是那个文件
 *   ③ 父页面的 init/tick 有没有真的喂进去（读 iframe 的 window.__stage）
 *   ④ 有没有运行时异常 / console.warn('[stage] ...')
 * 用法: node e2e-stages.mjs 046 048 049 050
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wants = process.argv.slice(2);
const ids = wants.length ? wants : ['046', '048', '049', '050'];

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-e2e-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pending = new Map(); let errs = [], warns = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    errs.push((d.exception && d.exception.description || d.text || '').split('\n')[0].slice(0, 140));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') {
    const txt = (m.params.args || []).map((a) => a.value || a.description || '').join(' ');
    if (txt) warns.push(txt.slice(0, 160));
  }
};
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout'))), 60000);
});
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description).slice(0, 120);
  return r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });

fs.mkdirSync('E:/DSHdesktop/work/music-player/shots/review', { recursive: true });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/` });

/* 等歌单出现（要联网拉网易云歌单） */
let rows = 0;
for (let i = 0; i < 50; i++) {
  rows = await ev(`document.querySelectorAll('.track').length`);
  if (typeof rows === 'number' && rows > 0) break;
  await sleep(400);
}
console.log('歌单行数: ' + rows + (rows ? '' : '  ← 拉不到歌单，只测"无歌词"路径'));

/* 进播放页：点第一首（没有歌就跳过） */
if (rows > 0) {
  await ev(`(() => { const t = document.querySelector('.track'); if (t) t.click(); return 1; })()`);
  await sleep(2600);
}

async function pickStage(sid) {
  /* 打开设置 → 形态菜单 → 点目标。
     2026-10-22 播放页改版后菜单变成了 `#pickgrid > .pickcard[data-id]`，
     旧选择器 `#stage-menu button[data-id]` 已经点不到了 —— 这里跟着改。 */
  await ev(`document.getElementById('btn-settings').click()`);
  await sleep(260);
  await ev(`document.getElementById('btn-stage-menu').click()`);
  await sleep(420);
  const ok = await ev(`(() => {
    const b = document.querySelector('.pickcard[data-id="${sid}"]');
    if (!b) return 0;
    b.scrollIntoView({ block: 'center' });
    b.click();
    return 1;
  })()`);
  await sleep(3600);
  return ok;
}

console.log('\n形态  │ 菜单 │ iframe src                       │ __stage 回读');
console.log('-'.repeat(96));
let bad = 0;
for (const sid of ids) {
  errs = []; warns = [];
  const picked = await pickStage(sid);
  const src = await ev(`(document.getElementById('stage-frame').getAttribute('src') || '')`);
  const st = await ev(`(() => {
    const w = document.getElementById('stage-frame').contentWindow;
    if (!w || !w.__stage) return '(无 __stage)';
    const s = w.__stage();
    if (!s) return '(null)';
    const keys = Object.keys(s).slice(0, 5);
    return keys.map((k) => k + '=' + JSON.stringify(s[k])).join(' ');
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`E:/DSHdesktop/work/music-player/shots/review/e2e-${sid}.png`, Buffer.from(shot.data, 'base64'));

  const flag = (!picked || !String(src).includes(sid) || String(st).startsWith('(无') || errs.length) ? '  <<<' : '';
  if (flag) bad++;
  console.log(`${sid}  │  ${picked ? 'ok' : '★没点到'}  │ ${String(src).padEnd(32)} │ ${String(st).slice(0, 60)}${flag}`);
  if (errs.length) console.log('     ★异常: ' + errs.slice(0, 2).join(' ; '));
  if (warns.length) console.log('     warn: ' + warns.slice(0, 2).join(' ; '));
}

console.log('\n共 ' + ids.length + ' 个，失败 ' + bad + ' 个。截图: shots/review/e2e-<id>.png');

ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
