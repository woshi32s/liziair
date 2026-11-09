/**
 * _logincheck.mjs —— 网易云「扫码登录」状态机验收（无头 Chrome + CDP）
 *
 * 真实扫码要用户本人，所以这里不动上游，只替换页面里的 window API.qrKey / qrCheck / session
 * 造出各种上游返回，逐条断言 UI。跑之前服务必须已经在 .port 上跑着。
 *
 * 用法: node _logincheck.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const APP = fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim();
const BASE = `http://127.0.0.1:${APP}`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOTS = path.join(ROOT, 'shots', 'review');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(id, name, ok, detail = '') {
  results.push({ id, name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? '\n        ' + String(detail).replace(/\n/g, ' ') : ''}`);
}

/* ---------------- 无头 Chrome + CDP ---------------- */
const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDP = srv.address().port;
await new Promise((r) => srv.close(r));
const PROFILE = path.join(os.tmpdir(), 'lizi-login-' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + CDP, '--hide-scrollbars',
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); }
}
const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pend = new Map();
const consoleErrs = [];
const exceptions = [];
const logErrs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    exceptions.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 160));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrs.push((m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 160));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const en = m.params.entry;
    logErrs.push((en.source || '') + ': ' + (en.text || '').slice(0, 120) + (en.url ? ' @ ' + en.url : ''));
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq; pend.set(id, { resolve: res });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + (((r.exceptionDetails.exception || {}).description) || r.exceptionDetails.text || '').slice(0, 200);
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* 每次场景都重新加载，保证模块内的 qrSeq / 定时器是干净的 */
async function fresh() {
  await send('Page.navigate', { url: `${BASE}/?t=${Date.now()}` });
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    if ((await ev('document.readyState')) === 'complete' && (await ev('typeof API')) === 'object') break;
  }
  await sleep(600);
}

const status = () => ev(`(() => { const s = document.getElementById('qr-status');
  return { text: (s && s.textContent) || '', cls: (s && s.className) || '' }; })()`);

/** 注入假上游 → 打开登录弹窗（等价于用户点右上角「登录」） */
async function openLogin(setup) {
  await fresh();
  return ev(`(async () => {
    window.__t = { keyCalls: 0, checkCalls: 0, checkThrows: 0, inflight: 0, maxInflight: 0 };
    ${setup}
    const b = document.getElementById('btn-user');
    if (!b) return 'no-btn-user';
    b.click();
    return 'ok';
  })()`);
}

const shot = async (file) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, file), Buffer.from(png.data, 'base64'));
  console.log('        → shots/review/' + file);
};

/* ==================== 附加) 800 过期 → 自动换码 ==================== */
await openLogin(`
  API.qrKey = async () => { window.__t.keyCalls++; return { code: 200, key: 'K0-' + window.__t.keyCalls }; };
  API.qrCheck = async () => {
    window.__t.checkCalls++;
    return window.__t.checkCalls === 1 ? { code: 800, message: '二维码过期' } : { code: 801, message: '等待扫码' };
  };
`);
await sleep(3200);
{
  const t = await ev('window.__t');
  const s = await status();
  check('0', '800 过期 → 自动换一张新码（key 请求 +1），状态回到等待扫码',
    t.keyCalls === 2 && /请用网易云音乐 App 扫描二维码/.test(s.text),
    `keyCalls=${t.keyCalls} checks=${t.checkCalls} text="${s.text}"`);
}

/* ============================ 1) 801 ============================ */
await openLogin(`
  API.qrKey = async () => { window.__t.keyCalls++; return { code: 200, key: 'K1' }; };
  API.qrCheck = async () => { window.__t.checkCalls++; return { code: 801, message: '等待扫码' }; };
`);
await sleep(2400);
{
  const s = await status();
  const t = await ev('window.__t');
  const retryVis = await ev(`(() => { const b = document.getElementById('qr-retry'); return !!b && b.offsetParent !== null; })()`);
  check(1, '801 → 「请用网易云音乐 App 扫描二维码」且不报错、不出现重试按钮',
    s.text === '请用网易云音乐 App 扫描二维码' && !/is-error/.test(s.cls) && t.checkCalls >= 1 && retryVis === false,
    `text="${s.text}" class="${s.cls}" checks=${t.checkCalls} retry可见=${retryVis}`);
}

/* ============================ 2) 802 ============================ */
await openLogin(`
  API.qrKey = async () => ({ code: 200, key: 'K2' });
  API.qrCheck = async () => { window.__t.checkCalls++; return { code: 802, message: '待确认' }; };
`);
await sleep(2400);
{
  const s = await status();
  const t = await ev('window.__t');
  check(2, '802 → 文案含「已扫码」',
    /已扫码/.test(s.text) && !/is-error/.test(s.cls) && t.checkCalls >= 1,
    `text="${s.text}" checks=${t.checkCalls}`);
}

/* ==================== 3) 500 / 未知 code 999 ==================== */
await openLogin(`
  API.qrKey = async () => ({ code: 200, key: 'K3' });
  API.qrCheck = async () => { window.__t.checkCalls++; return { code: 500, message: 'boom' }; };
`);
await sleep(2400);
{
  const s = await status();
  const calls = await ev('window.__t.checkCalls');
  const retryVis = await ev(`(() => { const b = document.getElementById('qr-retry'); return !!b && b.offsetParent !== null; })()`);
  check(3.1, 'code 500 → 文案带 500 + boom，不再显示「请确认」；第 1 次失败还不给按钮',
    /500/.test(s.text) && /boom/.test(s.text) && !/请确认/.test(s.text) && /is-error/.test(s.cls) && calls >= 1 && retryVis === false,
    `text="${s.text}" retry可见=${retryVis}`);
  await shot('login-1-error.png');
}

await openLogin(`
  API.qrKey = async () => ({ code: 200, key: 'K3b' });
  API.qrCheck = async () => { window.__t.checkCalls++; return { code: 999, message: 'boom' }; };
`);
await sleep(2400);
{
  const s = await status();
  const calls = await ev('window.__t.checkCalls');
  check(3.2, '未知 code 999 → 文案带 999 + boom，不再显示「请确认」',
    /999/.test(s.text) && /boom/.test(s.text) && !/请确认/.test(s.text) && /is-error/.test(s.cls) && calls >= 1,
    `text="${s.text}"`);
}

/* ============== 4) 连续 3 次抛错 → 失败 + 重新生成 ============== */
await openLogin(`
  API.qrKey = async () => { window.__t.keyCalls++; return { code: 200, key: 'K4' }; };
  API.qrCheck = async () => { window.__t.checkCalls++; window.__t.checkThrows++; throw new Error('net-down'); };
`);
await sleep(7400);
{
  const s = await status();
  const b = await ev(`(() => { const x = document.getElementById('qr-retry');
    return { exists: !!x, hidden: x ? x.hidden : null, visible: !!x && x.offsetParent !== null,
      text: x ? x.textContent : '', keyCalls: window.__t.keyCalls, throws: window.__t.checkThrows }; })()`);
  check(4.1, '连续 3 次抛错 → 「登录失败，请重试」+ 重新生成按钮（第 1/3 次时不出现）',
    /登录失败/.test(s.text) && b.exists && b.hidden === false && b.visible && /重新生成二维码/.test(b.text) && b.throws >= 3,
    `text="${s.text}" throws=${b.throws} btn="${b.text}" 可见=${b.visible}`);

  await ev(`document.getElementById('qr-retry').click()`);
  await sleep(700);
  const after = await ev(`(() => { const x = document.getElementById('qr-retry');
    return { keyCalls: window.__t.keyCalls, hidden: x ? x.hidden : null, visible: !!x && x.offsetParent !== null }; })()`);
  check(4.2, '点「重新生成二维码」→ 重新请求 key（+1），按钮随即收起',
    after.keyCalls === b.keyCalls + 1 && after.visible === false,
    `keyCalls ${b.keyCalls} → ${after.keyCalls}；按钮收起=${!after.visible}`);
}

/* ============ 5) 803 + session.loggedIn=false（字符串 code）============ */
await openLogin(`
  API.qrKey = async () => ({ code: 200, key: 'K5' });
  API.qrCheck = async () => ({ code: '803', message: '授权成功' });
  API.session = async () => ({ loggedIn: false });
`);
await sleep(2600);
{
  const s = await status();
  const d = await ev(`(() => { const x = document.getElementById('qr-diag');
    const b = document.getElementById('qr-retry');
    return { hidden: x ? x.hidden : null, visible: !!x && x.offsetParent !== null,
      text: x ? x.textContent : '', retry: !!b && b.offsetParent !== null }; })()`);
  check(5.1, '803（字符串 code）+ 没 cookie → 文案含「没拿到登录态」，不许显示「登录成功」',
    /没拿到登录态/.test(s.text) && !/登录成功/.test(s.text) && /is-error/.test(s.cls),
    `text="${s.text}"`);
  check(5.2, '同一状态自动展开诊断面板（含 server 的 code/message/cookieKeys）',
    d.hidden === false && d.visible && /cookieKeys/.test(d.text) && /"code"/.test(d.text) && d.retry,
    `hidden=${d.hidden} 可见=${d.visible} len=${d.text.length} retry=${d.retry}`);

  /* 「查看诊断」链接：收起 → 再展开 */
  await ev(`document.getElementById('qr-diag-link').click()`);
  await sleep(250);
  const collapsed = await ev(`document.getElementById('qr-diag').hidden`);
  await ev(`document.getElementById('qr-diag-link').click()`);
  await sleep(500);
  const reopened = await ev(`(() => { const x = document.getElementById('qr-diag');
    return { hidden: x.hidden, len: x.textContent.length, vis: x.offsetParent !== null, link: document.getElementById('qr-diag-link').textContent }; })()`);
  check(5.3, '「查看诊断」链接可收起/可展开，展开后是 JSON（等宽小字）',
    collapsed === true && reopened.hidden === false && reopened.vis && reopened.len > 80,
    `收起=${collapsed} 再展开=${!reopened.hidden} len=${reopened.len} 链接="${reopened.link}"`);
  await shot('login-2-diag.png');
}

/* ============ 6) 803 + session.loggedIn=true → 成功并关窗 ============ */
await openLogin(`
  API.qrKey = async () => ({ code: 200, key: 'K6' });
  API.qrCheck = async () => ({ code: 803, message: '授权成功' });
  API.session = async () => ({ loggedIn: true, profile: { userId: 1, nickname: '测试用户', avatar: '' } });
  API.userPlaylists = async () => ({ playlists: [] });
`);
await sleep(2500);
{
  const s = await status();
  const closedEarly = await ev(`document.getElementById('modal').classList.contains('is-closed')`);
  await sleep(1000);
  const closed = await ev(`document.getElementById('modal').classList.contains('is-closed')`);
  check(6, '803 + loggedIn=true → 「登录成功」，700ms 后弹窗关闭',
    s.text === '登录成功' && !closedEarly && closed,
    `text="${s.text}" 2.5s时已关=${closedEarly} 3.5s时已关=${closed}`);
}

/* ==================== 7) /api/login/qr/last 结构 ==================== */
{
  const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const k = await post('/api/login/qr/key', {});
  const c = await post('/api/login/qr/check', { key: k.key });
  const res = await fetch(BASE + '/api/login/qr/last');
  const text = await res.text();
  const last = JSON.parse(text);
  const session = JSON.parse(fs.readFileSync(path.join(ROOT, '.session.json'), 'utf8'));
  const values = Object.values(session).filter((v) => typeof v === 'string' && v.length >= 6);
  const leaked = values.filter((v) => text.includes(v));
  check(7.1, '/api/login/qr/last 返回 { code, message, hasMusicU, cookieKeys[] }',
    typeof last.code === 'number' && last.code === c.code && typeof last.message === 'string'
      && typeof last.hasMusicU === 'boolean' && Array.isArray(last.cookieKeys) && last.cookieKeys.length > 0,
    `HTTP ${res.status} ${text.slice(0, 220)}`);
  check(7.2, '响应体不含任何 cookie 值（只列键名）',
    leaked.length === 0 && !/MUSIC_U=/.test(text),
    `对照 .session.json 里 ${values.length} 个值，命中 ${leaked.length} 个`);
}

/* ==================== 8) 轮询防重入（5s 慢响应）==================== */
await openLogin(`
  API.qrKey = async () => ({ code: 200, key: 'K8' });
  API.qrCheck = () => {
    const t = window.__t; t.checkCalls++; t.inflight++;
    t.maxInflight = Math.max(t.maxInflight, t.inflight);
    return new Promise((res) => setTimeout(() => { t.inflight--; res({ code: 801, message: '等待扫码' }); }, 5000));
  };
`);
await sleep(7300);
{
  const t = await ev('window.__t');
  check(8, '单次 check 5s 才回 → 并发请求数始终 = 1',
    t.maxInflight === 1 && t.checkCalls >= 1,
    `maxInflight=${t.maxInflight} checkCalls=${t.checkCalls}`);
}

/* ==================== 9) console error / 未捕获异常 ==================== */
check(9, '0 console error / 0 未捕获异常',
  consoleErrs.length === 0 && exceptions.length === 0,
  `console=${consoleErrs.length}${consoleErrs.length ? ' [' + consoleErrs.slice(0, 3).join(' | ') + ']' : ''}`
  + ` exception=${exceptions.length}${exceptions.length ? ' [' + exceptions.slice(0, 3).join(' | ') + ']' : ''}`
  + (logErrs.length ? `  (另有 ${logErrs.length} 条网络类 Log，不计入 console error：${logErrs.slice(0, 2).join(' | ')})` : ''));

/* ---------------- 收尾 ---------------- */
const pass = results.filter((r) => r.ok).length;
console.log(`\n合计 ${pass}/${results.length} 通过` + (pass === results.length ? ' ✅' : ' ❌'));
for (const r of results) if (!r.ok) console.log('  未过: [' + r.id + '] ' + r.name);
ws.close();
ch.kill();
await sleep(200);
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(pass === results.length ? 0 : 1);

