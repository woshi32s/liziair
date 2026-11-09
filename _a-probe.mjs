/* probe: what does the audit/verify headless Chrome support? (throw-away) */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'E:/DSHdesktop/work/music-player';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port; await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'a-probe-' + Date.now());
const args = ['--headless=new', '--no-first-run', '--hide-scrollbars', '--enable-unsafe-webgpu', '--enable-features=Vulkan',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'];
const ch = spawn(CHROME, args, { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'about:blank' });
await sleep(300);
console.log(await ev(`(() => {
  const c = document.createElement('canvas'); c.width=64;c.height=64;
  const out = {};
  const g2 = c.getContext('webgl2');
  out.webgl2 = !!g2;
  if (g2) {
    const dbg = g2.getExtension('WEBGL_debug_renderer_info');
    out.renderer = dbg ? g2.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g2.getParameter(g2.RENDERER);
    out.maxTex = g2.getParameter(g2.MAX_TEXTURE_SIZE);
    out.cbf = !!g2.getExtension('EXT_color_buffer_float');
    out.tf = !!g2.getExtension('EXT_transform_feedback');
    out.vao = !!g2.createVertexArray;
  }
  const c1 = document.createElement('canvas');
  const g1 = c1.getContext('webgl');
  out.webgl1 = !!g1;
  if (g1) { const d = g1.getExtension('WEBGL_debug_renderer_info'); out.r1 = d ? g1.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; out.inst1 = !!g1.getExtension('ANGLE_instanced_arrays'); }
  out.webgpu = !!(navigator.gpu);
  return out;
})()`));
ws.close(); ch.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
