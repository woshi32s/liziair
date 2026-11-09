/** _glprobe.mjs —— 针对 WebGL 形态的探针：着色器编译/链接状态、帘幕条数、像素回读、控制台日志
 *  用法: node _glprobe.mjs 016-aurora-lyrics.html
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = fs.readFileSync(ROOT + '/.port', 'utf8').trim();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = process.argv[2];
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-gl-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars', '--window-size=1440,810', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errs = []; const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; errs.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 200)); }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(m.params.type + ': ' + (m.params.args || []).map((a) => a.value != null ? String(a.value) : (a.description || '')).join(' ').slice(0, 400));
  }
  if (m.method === 'Log.entryAdded') { const t = m.params.entry; if (t.level === 'error') errs.push('log:' + (t.url || '') + ' ' + t.text); }
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, { resolve: res }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC:' + ((r.exceptionDetails.exception || {}).description || '').slice(0, 300) : r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${APP}/stages/${file}` });
await sleep(1200);
const FEED = `(() => {
  window.__tk && clearInterval(window.__tk);
  const texts = ['当自我磨平了轮廓','才看清里面的光','直到夜色把一切收走把所有的路都还给沉默的远方',"I don't know how to say goodbye"];
  const lines = texts.map((text, i) => ({ t: i * 3, dur: 3, text, chars: null }));
  window.postMessage({ __c100: 1, type: 'init', payload: { lines, accent: [180,170,255] } }, '*');
  window.__T = 0;
  window.__tk = setInterval(() => { window.__T += 0.066;
    window.postMessage({ __c100: 1, type: 'tick', payload: { time: window.__T, playing: true } }, '*'); }, 66);
  return 1; })()`;
await ev(FEED);
await sleep(2600);
console.log('__stage:', JSON.stringify(await ev('window.__stage ? window.__stage() : "no __stage"')));
console.log('gl:', JSON.stringify(await ev(`(() => {
  const c = document.getElementById('c');
  const g = c.getContext('webgl') || c.getContext('experimental-webgl');
  if (!g) return { gl: null };
  const out = { w: c.width, h: c.height, lost: g.isContextLost(), err: g.getError() };
  return out;
})()`)));
console.log('programs:', JSON.stringify(await ev(`(() => {
  if (typeof progAur === 'undefined') return 'no globals';
  const g = gl;
  const chk = (p) => { if (!p) return 'null'; return { linked: g.getProgramParameter(p, g.LINK_STATUS), log: (g.getProgramInfoLog(p) || '').slice(0, 300) }; };
  const sh = (s) => { if (!s) return 'null'; return { ok: g.getShaderParameter(s, g.COMPILE_STATUS), log: (g.getShaderInfoLog(s) || '').slice(0, 400) }; };
  return { aur: chk(progAur), stars: chk(progStars), blur: chk(progBlur), comp: chk(progComp), aurN: aurN, lines: lines.length, curIdx: curIdx };
})()`)));
/* 在 rAF 里读 fboA（默认帧缓冲合成后会被清空，必须读离屏目标） */
const READFBO = (keep) => `new Promise((res) => {
  let done = false;
  const bail = setTimeout(() => { if (!done) { done = true; res({ err: 'no-fbo' }); } }, 4000);
  requestAnimationFrame(() => {
    try {
      if (typeof aurN !== 'undefined' && aurN) window.__aurKeep = aurN;
      if (!${keep} && typeof aurN !== 'undefined') aurN = 0;
      if (typeof fboA === 'undefined' || !fboA) { clearTimeout(bail); done = true; return res({ err: 'no-fbo' }); }
    } catch (e) { clearTimeout(bail); done = true; return res({ err: String(e) }); }
    requestAnimationFrame(() => {
      const g = gl, W = cv.width, H = cv.height;
      g.bindFramebuffer(g.FRAMEBUFFER, fboA.f);
      const b = new Uint8Array(4 * W * H);
      g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, b);
      let mx = 0, sum = 0, n = 0, br = 0;
      for (let i = 0; i < b.length; i += 4 * 97) {
        const s = b[i] + b[i + 1] + b[i + 2];
        sum += s; n++; if (s > mx) mx = s; if (s > 200) br++;
      }
      if (window.__aurKeep) { aurN = window.__aurKeep; window.__aurKeep = 0; }
      clearTimeout(bail); done = true; res({ max: mx, avg: +(sum / n / 3).toFixed(1), sat: br, n: n });
    });
  });
})`;
await sleep(400);
console.log('fboA(仅星空):', JSON.stringify(await ev(READFBO(false))));
await sleep(400);
console.log('fboA(全画面):', JSON.stringify(await ev(READFBO(true))));
console.log('diag:', JSON.stringify(await ev(`(() => {
  const g = gl;
  const out = {};
  out.fboStatus = g.checkFramebufferStatus(g.FRAMEBUFFER);
  g.bindFramebuffer(g.FRAMEBUFFER, fboA.f);
  out.fboAStatus = g.checkFramebufferStatus(g.FRAMEBUFFER);
  out.WH = [cv.width, cv.height];
  g.useProgram(progSky);
  out.sAmp = g.getUniform(progSky, U.sAmp);
  out.sRot = g.getUniform(progSky, U.sRot);
  out.sTail = g.getUniform(progSky, U.sTail);
  out.sRay = g.getUniform(progSky, U.sRay);
  out.sLight = g.getUniform(progSky, U.sLight);
  out.amp = amp;
  if (typeof starAngle !== 'undefined') out.star = [+starAngle.toFixed(3), +starTarget.toFixed(3)];
  if (typeof litData !== 'undefined' && litData) {
    let on = 0, last = 0;
    for (let i = 0; i < litData.length; i++) { if (litData[i] > 8) { on++; last = i; } }
    out.lit = { w: litW, on: on, lastPx: last, head: litData[0], tail: litData[litData.length - 1] };
  }
  g.bindFramebuffer(g.FRAMEBUFFER, null);
  return out;
})()`)));
console.log('logs:', logs.length ? logs.slice(-12).join('\n  ') : '无');
console.log('errs:', errs.length ? errs.slice(0, 6).join('\n  ') : '无');
const png = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(ROOT + '/shots/lizi/_glprobe.png', Buffer.from(png.data, 'base64'));
console.log('→ shots/lizi/_glprobe.png');
ws.close(); ch.kill(); await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
