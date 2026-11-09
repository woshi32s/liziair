/* _a-roundsheet.mjs —— 把某个形态的 r1/r2/r3 三张拼成一张（人眼验收用，只读不写形态）
   用法：node _a-roundsheet.mjs 237            # → shots/review/p300-A-237-rounds.png
        node _a-roundsheet.mjs 237,238,239
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nums = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!nums.length) { console.error('用 node _a-roundsheet.mjs 237'); process.exit(1); }

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-rs-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP,
  '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? null : r.result.value; };
await send('Page.enable'); await send('Runtime.enable');

for (const n of nums) {
  const files = ['r1', 'r2', 'r3'].map((r) => path.join(ROOT, 'shots/review', `p300-A-${n}-${r}.png`));
  const miss = files.filter((f) => !fs.existsSync(f));
  if (miss.length) { console.log(`${n} 缺图: ${miss.map((f) => path.basename(f)).join(', ')}`); continue; }
  const b64 = files.map((f) => fs.readFileSync(f).toString('base64'));
  const url = await ev(`(async () => {
    const imgs = await Promise.all(${JSON.stringify(b64)}.map(async (s) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); return i; }));
    const w = 640, h = 400, gap = 8;
    const c = document.createElement('canvas'); c.width = w * 3 + gap * 2; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#101010'; g.fillRect(0, 0, c.width, c.height);
    imgs.forEach((im, k) => g.drawImage(im, k * (w + gap), 0, w, h));
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '600 18px monospace';
    ['R1', 'R2', 'R3'].forEach((t, k) => g.fillText(t, k * (w + gap) + 14, 28));
    return c.toDataURL('image/png');
  })()`);
  if (url && url.startsWith('data:image/png;base64,')) {
    fs.writeFileSync(path.join(ROOT, 'shots/review', `p300-A-${n}-rounds.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${n} → shots/review/p300-A-${n}-rounds.png`);
  } else console.log(`${n} 拼接失败`);
}
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
