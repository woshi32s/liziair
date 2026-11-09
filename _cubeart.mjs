/** _cubeart.mjs —— 全角度扫描「画面伪影」：在每个姿态下直接读画布像素，
 *  统计「很暗的像素」（正常配色里最暗也只到 ~(18,18,20)，只有 a≈1 的点才这么暗；
 *  若棱上叠出深色锯齿条，就会出现成片的暗像素）。
 *  用法: node _cubeart.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const APP = fs.readFileSync('E:/DSHdesktop/work/music-player/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1192, H = 910;

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lg-ca-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-first-run',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/cube-menu.html` });
await sleep(2000);

/* 读画布：暗像素计数 + 最暗像素 + 暗像素的最长连续段（锯齿条会是又长又细的段） */
const probe = `(() => {
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let dark = 0, minL = 999, minAt = null;
  const rows = new Uint32Array(c.height);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const L = (d[i] * 299 + d[i+1] * 587 + d[i+2] * 114) / 1000;
      if (L < minL) { minL = L; minAt = [x, y]; }
      if (L < 90) { dark++; rows[y]++; }
    }
  }
  let worstRow = 0, worstY = -1;
  for (let y = 0; y < rows.length; y++) if (rows[y] > worstRow) { worstRow = rows[y]; worstY = y; }
  return { dark, minL: +minL.toFixed(1), minAt, worstRow, worstY };
})()`;

let worst = null;
const rows = [];
for (let yawDeg = 0; yawDeg < 360; yawDeg += 15) {
  for (const pitchDeg of [-165, -120, -60, -30, 0, 30, 60, 120, 165]) {
    await ev(`yaw = ${yawDeg * Math.PI / 180}; pitch = ${pitchDeg * Math.PI / 180}; vyaw = 0; vpitch = 0; 1`);
    await sleep(90);
    const r = await ev(probe);
    rows.push({ yawDeg, pitchDeg, ...r });
    if (!worst || r.dark > worst.dark) worst = { yawDeg, pitchDeg, ...r };
  }
}
rows.sort((a, b) => b.dark - a.dark);
console.log('暗像素最多的 8 个姿态：');
for (const r of rows.slice(0, 8)) {
  console.log(`  yaw ${String(r.yawDeg).padStart(3)}° pitch ${String(r.pitchDeg).padStart(4)}°  暗像素 ${String(r.dark).padStart(6)}  最暗 ${r.minL} @${r.minAt}  最长行 ${r.worstRow}px @y=${r.worstY}`);
}
const med = rows[Math.floor(rows.length / 2)];
console.log('\n中位数姿态暗像素:', med.dark, ' 最暗:', med.minL);
console.log('扫描姿态数:', rows.length);

/* 把最坏那个姿态截一张，人工确认 */
await ev(`yaw = ${worst.yawDeg * Math.PI / 180}; pitch = ${worst.pitchDeg * Math.PI / 180}; vyaw = 0; vpitch = 0; 1`);
await sleep(300);
const png = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('shots/review/art-worst.png', Buffer.from(png.data, 'base64'));
console.log('最坏姿态截图 → shots/review/art-worst.png');

ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
