/* _a-shots.mjs —— 车道 A 迭代截图（只截图，不生产形态）
   用法：
     node _a-shots.mjs 236 r1              # 单张：默认 8.4s 处（第三句）
     node _a-shots.mjs 236,237,238 r2
   产出：
     shots/review/p300-A-<NNN>-r<k>.png        （报文要求的轮次图，1440×900）
     shots/review/p300-A-<NNN>-sheet.png       （1.5/6.0/10.0 三帧并排，自查用）
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const PORT = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const nums = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);
const round = process.argv[3] || 'r1';
const MOMENT = Number(process.argv[4] || 8.4);
if (!nums.length) { console.error('用 node _a-shots.mjs 236 r1'); process.exit(1); }
const OUT = path.join(ROOT, 'shots/review');
fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(path.join(ROOT, 'public/stages')).filter((f) => /^\d{3}-.*\.html$/.test(f));
const targets = nums.map((n) => ({ n, file: files.find((f) => f.startsWith(n.padStart(3, '0') + '-')) })).filter((t) => t.file);
if (!targets.length) { console.error('找不到形态文件'); process.exit(1); }

const LINES = ['雨落在没有人的站台', '灯把影子拉得很长', '我等一班不会来的车', '风从隧道那头吹过来',
  '把话咽回去的时候', '整座城市都在回声'].map((text, i) => ({ t: i * 4, text }));

const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-a-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP,
  '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

async function tabOf() {
  for (let i = 0; i < 100; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP 起不来');
}
const tab = await tabOf();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 200));
};
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __exc: ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 200) }; return r.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

const INIT = `(() => { window.postMessage({__c100:1,type:'init',payload:{lines:${JSON.stringify(LINES)},song:{title:'审计',artist:'LIZI',cover:''}}},'*'); return 1; })()`;
const tick = (t) => `(() => { window.postMessage({__c100:1,type:'tick',payload:{time:${t},playing:true}},'*'); return 1; })()`;
const live = `(() => { window.postMessage({__c100:1,type:'live',payload:{bpm:96,level:.62,bass:.72,mid:.42,treble:.34,playing:true}},'*'); return 1; })()`;
const beat = (i) => `(() => { window.postMessage({__c100:1,type:'beat',payload:{index:${i},level:.8}},'*'); return 1; })()`;

const shoot = async () => (await send('Page.captureScreenshot', { format: 'png' })).data;
const save = (name, b64) => fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64'));

const sheetOf = (arr) => ev(`(async () => {
  const imgs = await Promise.all(${JSON.stringify(arr)}.map(async (s) => { const i = new Image(); i.src='data:image/png;base64,'+s; await i.decode(); return i; }));
  const w = 480, h = 300, gap = 6;
  const c = document.createElement('canvas'); c.width = w*imgs.length + gap*(imgs.length-1); c.height = h;
  const g = c.getContext('2d'); g.fillStyle='#111'; g.fillRect(0,0,c.width,c.height);
  imgs.forEach((im,k)=>g.drawImage(im, k*(w+gap), 0, w, h));
  return c.toDataURL('image/png');
})()`);

for (const t of targets) {
  errs.length = 0;
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/stages/${t.file}?v=${Date.now()}` });
  for (let i = 0; i < 60; i++) { if (await ev(`typeof window.__stage === 'function' && window.__stage().frames > 2`)) break; await sleep(120); }
  await ev(INIT); await sleep(160);
  /* —— 轮次图：停在第三句，给一拍 —— */
  await ev(live); await ev(tick(MOMENT)); await sleep(760);
  await ev(beat(7)); await sleep(230);
  const one = await shoot();
  save(`p300-A-${t.n}-${round}.png`, one);
  console.log(`${t.n} ${round}  ${JSON.stringify(await ev('window.__stage ? window.__stage() : null'))}`);

  /* —— 三帧 sheet（1.5 / 6.0 / 10.0，与 audit 同步）—— */
  const shots = [];
  for (const at of [1.5, 6.0, 10.0]) {
    await ev(live); await ev(tick(at)); await sleep(1050);
    shots.push(await shoot());
  }
  const url = await sheetOf(shots);
  if (typeof url === 'string' && url.startsWith('data:image/png;base64,')) save(`p300-A-${t.n}-sheet.png`, url.split(',')[1]);
  if (errs.length) console.log('  EXC:', errs.slice(0, 3).join(' | '));
}

ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
