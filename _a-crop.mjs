/* _a-crop.mjs —— 把截图的一块放大裁出来（只读图，不碰形态）
   用法：node _a-crop.mjs shots/review/p300-A-247-r2.png 700 150 480 420 2 [out.png]
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [file, xs, ys, bw, bh, ss, outArg] = process.argv.slice(2);
if (!file) { console.error('用 node _a-crop.mjs <png> <x> <y> <w> <h> [scale] [out]'); process.exit(1); }
const src = path.isAbsolute(file) ? file : path.join(ROOT, file);
const b64 = fs.readFileSync(src).toString('base64');
const out = outArg ? path.join(ROOT, outArg) : path.join(ROOT, 'shots/review', '_crop-' + path.basename(src));
const sc = Number(ss || 2);

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-crop-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP,
  '--window-size=600,600', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
const tab = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x) => x.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable');
const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
  const i = new Image(); i.src = 'data:image/png;base64,${b64}'; await i.decode();
  const c = document.createElement('canvas'); c.width = ${Number(bw) * sc}; c.height = ${Number(bh) * sc};
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(i, ${Number(xs)}, ${Number(ys)}, ${Number(bw)}, ${Number(bh)}, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
})()` });
const url = r.result.value;
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('→ ' + out);
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
