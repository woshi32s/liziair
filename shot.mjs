/**
 * 给指定形态截图，用来判断"全黑"到底是真没画出来，还是内容在 DOM 里。
 * 用法: node shot.mjs 026 029 036
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const DIR = 'E:/DSHdesktop/work/music-player/public/stages';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wants = process.argv.slice(2);
const files = fs.readdirSync(DIR).filter((f) => /^\d{3}-.+\.html$/.test(f)).sort()
  .filter((f) => !wants.length || wants.some((w) => f.startsWith(w)));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-shot-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout'))), 60000); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC'; return r.result.value; };

await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__BEAT_SILENT = true' });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });

const FEED = `(() => {
  const texts = ['当自我磨平了轮廓','才看清里面的光','风吹过所有的名字','而我在原地等了很久'];
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const text = texts[i % texts.length];
    const chars = [];
    for (let k = 0; k < text.length; k++) chars.push({ t: i*2.4 + k*0.22, d: 0.22, c: text[k] });
    lines.push({ t: i*2.4, dur: 2.4, text, chars });
  }
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180,170,255] } }, '*');
  let t = 0;
  window.postMessage({ __c100: 1, type: 'tick', payload: { time: 0, playing: true } }, '*');
  if (window.__tk) clearInterval(window.__tk);
  window.__tk = setInterval(() => { t += 0.066; window.postMessage({ __c100: 1, type: 'tick', payload: { time: t, playing: true } }, '*'); }, 66);
  return 1;
})()`;

fs.mkdirSync('E:/DSHdesktop/work/music-player/shots/review', { recursive: true });
for (const f of files) {
  await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${f}` });
  await sleep(1200);
  await ev(FEED);
  await sleep(4200);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const out = 'E:/DSHdesktop/work/music-player/shots/review/' + f.replace('.html', '.png');
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  // 顺带量一下 DOM 里有没有可见文字
  const domText = await ev(`(() => {
    const t = (document.body.innerText || '').replace(/\\s+/g, ' ').trim();
    return t.slice(0, 60) + ' [len=' + t.length + ']';
  })()`);
  console.log(f.padEnd(38) + ' DOM文本: ' + domText);
}

ws.close(); chrome.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
console.log('\n截图目录: shots/review/');