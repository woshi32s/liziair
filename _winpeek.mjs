/** _winpeek.mjs —— 看一眼卡住的 _wincheck 里页面现在是什么状态（只读，不发指令）。 */
const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = list.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url));
console.log('targets:', list.map((t) => `${t.type} ${t.url}`).join(' | '));
console.log('ws:', page && page.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }),
    new Promise((res) => setTimeout(() => res({ timeout: true }), 5000)),
  ]);
  if (r.timeout) return '<<TIMEOUT 5s no reply>>';
  const res = r.result || {};
  if (res.exceptionDetails) return 'EXC:' + String((res.exceptionDetails.exception || {}).description).split('\n')[0];
  return res.result ? res.result.value : JSON.stringify(r).slice(0, 200);
};
await send('Runtime.enable');
console.log('href       ', await ev('location.href'));
console.log('readyState ', await ev('document.readyState'));
console.log('visibility ', await ev('document.visibilityState'));
console.log('__wa exists', await ev('typeof window.__wa'));
console.log('__wa.n     ', await ev('window.__wa ? window.__wa.n : -1'));
console.log('last evt   ', await ev('JSON.stringify(window.__wa && window.__wa.events[window.__wa.events.length-1] || null)'));
console.log('isMax      ', await ev('window.__desktop.winControls.isMaximized()'));
console.log('getState   ', await ev('window.__desktop.winControls.getState()'));
console.log('win-max    ', await ev('(()=>{const b=document.getElementById("win-max");return b?b.getAttribute("aria-label")+" / is-max="+b.classList.contains("is-max"):"NO"})()'));
console.log('bp         ', await ev('document.body && document.body.className'));
ws.close();
process.exit(0);
