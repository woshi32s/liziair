/** _lizilive.mjs —— 端到端验证：真的从播放器页面进形态，看能不能跑起来 + 截图
 *  用法: node _lizilive.mjs lizi01 [lizi08 ...] */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = process.argv.slice(2);
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-live-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 140)); }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') { const t = m.params.entry.text || ''; if (!/favicon/i.test(t)) errs.push('log:' + t.slice(0, 120)); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 200) : r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

fs.mkdirSync(ROOT + '/shots/lizi', { recursive: true });
for (const sid of ids) {
  errs.length = 0;
  /* 通过播放器的深链进去，而不是直接开形态文件 —— 这才是用户看到的路径 */
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/?stage=${sid}` });
  await sleep(3600);
  const info = await ev(`(() => {
    const f = document.getElementById('stage-frame');
    if (!f) return 'no iframe';
    let vis = false;
    try { vis = getComputedStyle(f).display !== 'none'; } catch (e) {}
    const w = f.contentWindow;
    return {
      显示: vis,
      iframe尺寸: f.getBoundingClientRect().width + 'x' + f.getBoundingClientRect().height,
      视口: w.innerWidth + 'x' + w.innerHeight,
      形态已初始化: !!(w.__stage),
      当前条: (document.getElementById('stage-current') || {}).textContent || '',
    };
  })()`);
  const png = await send('Page.captureScreenshot', { format: 'png' });
  const out = `${ROOT}/shots/lizi/_live-${sid}.png`;
  fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
  console.log(sid.padEnd(9) + JSON.stringify(info));
  console.log('         截图 → ' + out.replace(ROOT + '/', ''));
  if (errs.length) console.log('         ★报错 ' + [...new Set(errs)].slice(0, 2).join(' ; '));
  else console.log('         报错 无');
}
ws.close(); ch.kill(); await sleep(250);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
