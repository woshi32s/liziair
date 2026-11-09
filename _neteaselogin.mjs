/**
 * _neteaselogin.mjs —— 网易云「换边车通道登录」验收（Node + 无头 Chrome/CDP）
 *
 * 跑法（服务可以正在跑，脚本会自己按 .port 重启）：
 *     cd E:\DSHdesktop\work\music-player
 *     node _neteaselogin.mjs
 *
 * 它验 8 件事：
 *   1) 边车能起来：/api/netease/health 200，端口 = services/netease-api/.port，netstat 只绑 127.0.0.1
 *   2) 扫码前置状态：经代理拿 key → 立即 check 必须是 801，连测 3 次（不是 8821、不是 400）
 *   3) harvest 管线：注入假边车响应模拟「803 + cookie」→ MUSIC_U 写进 .session.json、
 *      /api/session 判定登录；再模拟「803 但没有 MUSIC_U」→ 400 且 .session.json 回滚
 *   4) /api/session/import：四种写法都能取到 MUSIC_U；没有 MUSIC_U → 400；无效值 → 回滚；
 *      响应体里不含那个值
 *   5) 页面：账号面板里有 #cookie-input 和「导入」；mock 400 → 文案出现
 *   6) 回归：/api/session、/api/top/playlist、/api/user/detail、/api/qq/health、/api/kugou/health
 *   7) 0 console error / 0 未捕获异常
 *   8) 截图 shots/review/login3-1-panel.png、login3-2-qr.png
 *
 * 安全：任何 cookie 值都不会被打印/写进截图/写进报告，断言里只出现键名和长度。
 * 3) 需要「803 之后上游其实回了登录态」，所以那一段用 _stub-net.mjs 预加载拦 fetch
 *    （测试期临时起一个带 stub 的 server，跑完立刻换回不带 stub 的正常服务；.session.json 原样还原）。
 */
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PORT = Number(fs.readFileSync(path.join(ROOT, '.port'), 'utf8').trim());
const BASE = `http://127.0.0.1:${PORT}`;
const SESSION_FILE = path.join(ROOT, '.session.json');
const SIDECAR_DIR = path.join(ROOT, 'services', 'netease-api');
const SIDECAR_PORT_FILE = path.join(SIDECAR_DIR, '.port');
const SHOTS = path.join(ROOT, 'shots', 'review');
const STUB_MODE_FILE = path.join(ROOT, '_stub-mode.txt');
const SERVER_LOG = path.join(ROOT, '_neteaselogin-server.log');
const SERVER_ERR = path.join(ROOT, '_neteaselogin-server.err.log');
const SIDECAR_LOG = path.join(SIDECAR_DIR, '.log');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

fs.mkdirSync(SHOTS, { recursive: true });

/* 只看本轮新写进边车日志的那一段（老日志可能是上一轮的） */
const LOG_OFFSET = fs.existsSync(SIDECAR_LOG) ? fs.statSync(SIDECAR_LOG).size : 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(id, name, ok, detail = '') {
  results.push({ id, name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? '\n        ' + String(detail).replace(/\n/g, ' ') : ''}`);
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

/* ============================ HTTP ============================ */
async function jget(pathname, timeout = 90000) {
  const r = await fetch(BASE + pathname, { signal: AbortSignal.timeout(timeout) });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  return { status: r.status, body, text };
}
async function jpost(pathname, payload, timeout = 90000) {
  const r = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  return { status: r.status, body, text };
}

/* ============================ 服务进程控制（按 .port 找 PID） ============================ */
function listenerPid(port) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
    ], { encoding: 'utf8', timeout: 30000 }).trim();
    return Number(out) || 0;
  } catch { return 0; }
}
function killPid(pid) {
  if (!pid) return;
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
    ], { timeout: 30000 });
  } catch { /* 已经不在了 */ }
}
async function waitPortFree(port, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!listenerPid(port)) return true;
    await sleep(250);
  }
  return !listenerPid(port);
}
/** 停掉主服务，并顺手清掉它留下的边车（边车盯父进程，最多 5s 自己走；这里不等它） */
async function stopServer() {
  const pid = listenerPid(PORT);
  if (pid) {
    console.log(`  · 停掉现在的服务 pid=${pid}`);
    killPid(pid);
  }
  await waitPortFree(PORT);
  const side = listenerPid(3215);
  if (side) {
    console.log(`  · 清掉上一轮留下的边车 pid=${side}`);
    killPid(side);
    await waitPortFree(3215, 6000);
  }
}
function startServer({ stub = false } = {}) {
  /* 用 Start-Process 起：它不在本脚本的进程树里，脚本退出后服务还在
     （普通 spawn 会被上层把整棵树收掉，最后用户就没有服务可用了）。 */
  const args = stub
    ? `'--import','${pathToFileURL(path.join(ROOT, '_stub-net.mjs')).href}','server.mjs'`
    : `'server.mjs'`;
  const ps = [
    `$env:PORT='${PORT}'; $env:LIZI_STUB_ROOT='${ROOT}';`,
    `Start-Process -FilePath '${process.execPath}' -ArgumentList ${args} -WorkingDirectory '${ROOT}'`,
    `-WindowStyle Hidden -RedirectStandardOutput '${SERVER_LOG}' -RedirectStandardError '${SERVER_ERR}'`,
  ].join(' ');
  /* stdio:'ignore' 很重要：Start-Process 起的子进程会继承 powershell 的输出句柄，
     用管道捕获的话 execFileSync 会一直等管道关闭（实测卡满 30s 超时）。 */
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30000, stdio: 'ignore' });
}
async function waitUp(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE + '/api/session', { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) return true;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  return false;
}
async function restartServer(opts) {
  await stopServer();
  startServer(opts);
  if (!await waitUp()) throw new Error('服务 30 秒没起来（看 _neteaselogin-server.err.log）');
}

/* ============================ 无头 Chrome ============================ */
let chrome = null;
let cdp = null;
let ws = null;
let seq = 0;
const pend = new Map();
const consoleErrs = [];
const exceptions = [];
const logErrs = [];

async function launchChrome() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));

  const profile = path.join(os.tmpdir(), 'lizi-netease-' + Date.now());
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + port, '--hide-scrollbars',
    '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

  for (let i = 0; i < 60; i++) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(300); }
  }
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

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

  cdp = (method, params = {}) => new Promise((res) => {
    const id = ++seq;
    pend.set(id, { resolve: res });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
}

async function ev(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC:' + (((r.exceptionDetails.exception || {}).description) || r.exceptionDetails.text || '').slice(0, 200);
  return r.result.value;
}

async function gotoApp() {
  await cdp('Page.navigate', { url: `${BASE}/?t=${Date.now()}` });
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    if ((await ev('document.readyState')) === 'complete' && (await ev('typeof API')) === 'object') break;
  }
  await sleep(500);
}

async function shotElement(selector, file, pad = 14) {
  const rect = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null; const r = e.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }; })()`);
  if (!rect || typeof rect !== 'object') return false;
  const png = await cdp('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, rect.x - pad),
      y: Math.max(0, rect.y - pad),
      width: Math.ceil(rect.w + pad * 2),
      height: Math.ceil(rect.h + pad * 2),
      scale: 1,
    },
  });
  fs.writeFileSync(path.join(SHOTS, file), Buffer.from(png.data, 'base64'));
  console.log('        → shots/review/' + file);
  return true;
}

/* ============================ 记录原始会话（最后原样还原） ============================ */
const ORIGINAL_SESSION = fs.readFileSync(SESSION_FILE);
const ORIGINAL_SESSION_HASH = sha(ORIGINAL_SESSION);

let phaseBFailed = false;

try {
  /* 开始前确保服务在跑（上一次脚本退出后，服务可能已经不在了） */
  if (!listenerPid(PORT)) {
    console.log('  · 服务没在跑，先起一个');
    startServer({ stub: false });
    if (!await waitUp()) throw new Error('服务起不来');
  }

  /* ==================== 1) 边车活着、端口对、只绑回环 ==================== */
  {
    const h = await jget('/api/netease/health', 60000);
    const portFile = fs.readFileSync(SIDECAR_PORT_FILE, 'utf8').trim();
    check('1a', '边车经代理可用：/api/netease/health 200，端口 = services/netease-api/.port',
      h.status === 200 && h.body.ok === true && String(h.body.port) === portFile,
      `HTTP ${h.status} proxyPort=${h.body.port} file=${portFile} node=${h.body.health && h.body.health.node}`);

    /* IP 补丁：边车自报「每个请求都走随机 CN IP」，不接受 req.ip 那条路 */
    const ipMode = (h.body.health && h.body.health.ipMode) || '(未上报)';
    const cnSeeded = !!(h.body.health && h.body.health.cnIpSeeded);
    check('1c', 'IP 补丁生效：边车自报 ipMode=randomCNIP 且 global.cnIp 已种入',
      ipMode === 'randomCNIP' && cnSeeded, `ipMode=${ipMode} cnIpSeeded=${cnSeeded}`);

    /* netstat：本地地址必须全是 127.0.0.1，不能有 0.0.0.0 / [::] */
    let lines = [];
    try {
      lines = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 20000 })
        .split(/\r?\n/)
        .filter((l) => /LISTENING/.test(l) && new RegExp(`:${portFile}\\s`).test(l));
    } catch { /* 拿不到就当失败 */ }
    const addrs = lines.map((l) => l.trim().split(/\s+/)[1]).filter(Boolean);
    const loopOnly = addrs.length > 0 && addrs.every((a) => /^127\.0\.0\.1:/.test(a));
    check('1b', `netstat：边车 ${portFile} 只绑 127.0.0.1`,
      loopOnly,
      `监听项 ${addrs.length} 个：${addrs.join(' | ') || '(空)'}`);
  }

  /* ==================== 2) 扫码前置状态：key → 立即 check 必须 801 ×3 ==================== */
  {
    const codes = [];
    let qrimgOk = false;
    let channelOk = true;
    for (let i = 0; i < 3; i++) {
      const k = await jget('/api/netease/login/qr/key', 60000);
      if (!k.body || !k.body.key) { codes.push('no-key'); continue; }
      if (i === 0) qrimgOk = typeof k.body.qrimg === 'string' && k.body.qrimg.startsWith('data:image/png;base64,');
      if (k.body.channel !== 'netease-api') channelOk = false;
      const c = await jget(`/api/netease/login/qr/check?key=${encodeURIComponent(k.body.key)}`, 60000);
      codes.push(Number(c.body && c.body.code));
      if (c.body && c.body.channel !== 'netease-api') channelOk = false;
    }
    check('2', '扫码前置状态：经代理拿 key → 立即 check 连测 3 次都是 801（不是 8821/400）',
      codes.length === 3 && codes.every((c) => c === 801),
      `codes=${codes.join(',')} channel=${channelOk ? 'netease-api' : '?'} qrimg(base64 PNG)=${qrimgOk}`);
    check('2b', '边车顺带给了二维码图（data:image/png;base64）', qrimgOk);
  }

  /* ==================== 4) 粘贴 cookie 登录：解析 / 拒绝 / 回滚 / 不泄露 ==================== */
  const beforeImport = fs.readFileSync(SESSION_FILE);
  const SECRETS = ['TOK_ALPHA_93f1', 'TOK_BETA_47c2', 'TOK_GAMMA_15d8', 'TOK_DELTA_62a9'];
  const importCases = [
    ['MUSIC_U=abc', `MUSIC_U=${SECRETS[0]}`],
    ['a=1; MUSIC_U=abc; b=2', `a=1; MUSIC_U=${SECRETS[1]}; b=2`],
    ['Cookie: MUSIC_U=abc', `Cookie: MUSIC_U=${SECRETS[2]}`],
    ['裸值 abc', SECRETS[3]],
  ];
  {
    const seen = [];
    let leaked = false;
    for (const [label, cookie] of importCases) {
      const r = await jpost('/api/session/import', { cookie });
      // 解析成功 = 走到了「校验失败」这一步（reason=invalid），而不是「没有 MUSIC_U」
      seen.push(`${label}→HTTP ${r.status}/${r.body.reason || '?'}`);
      if (r.text.includes(cookie) || SECRETS.some((s) => r.text.includes(s))) leaked = true;
    }
    check('4a', '四种写法都能取到 MUSIC_U（都走到校验那一步：400 reason=invalid，而不是 no-music-u）',
      seen.every((s) => /invalid/.test(s)), seen.join(' | '));

    const r = await jpost('/api/session/import', { cookie: 'a=1; b=2' });
    check('4b', '没有 MUSIC_U 的输入 → 400（reason=no-music-u）',
      r.status === 400 && r.body.reason === 'no-music-u', `HTTP ${r.status} reason=${r.body.reason} keys=${(r.body.keys || []).join(',')}`);

    const afterImport = fs.readFileSync(SESSION_FILE);
    const sessLeak = SECRETS.some((s) => afterImport.toString('utf8').includes(s));
    check('4c', '无效值导入后 .session.json 原样回滚，且响应体/文件里都没有那个值',
      sha(beforeImport) === sha(afterImport) && !leaked && !sessLeak,
      `hash ${sha(beforeImport)} → ${sha(afterImport)}，响应泄露=${leaked}，文件泄露=${sessLeak}`);
  }

  /* ==================== 6) 回归：现有接口一个都不能坏 ==================== */
  {
    const rows = [];
    const s = await jget('/api/session', 30000);
    rows.push(['/api/session', s.status]);
    const tp = await jget('/api/top/playlist?limit=4', 60000);
    rows.push(['/api/top/playlist', tp.status]);
    const ud = await jget('/api/user/detail?uid=1', 60000);
    rows.push(['/api/user/detail?uid=1', ud.status]);
    const qq = await jget('/api/qq/health', 90000);
    rows.push(['/api/qq/health', qq.status]);
    const kg = await jget('/api/kugou/health', 90000);
    rows.push(['/api/kugou/health', kg.status]);
    check('6', '回归接口全部 200', rows.every(([, st]) => st === 200),
      rows.map(([n, st]) => `${n}=${st}`).join(' | '));
  }

  /* ==================== 5/7/8) 页面：面板元素、导入 400 文案、截图、0 console error ==================== */
  await launchChrome();
  await gotoApp();
  {
    const opened = await ev(`(() => { const b = document.getElementById('btn-user'); if (!b) return 'no-btn'; b.click(); return 'ok'; })()`);

    // 等二维码真的画出来（边车给的 base64 PNG）
    let qrOk = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      qrOk = await ev(`(() => { const im = document.querySelector('#qr-box img');
        return !!(im && im.complete && im.naturalWidth > 0 && /^data:image\\/png;base64,/.test(im.src)); })()`);
      if (qrOk === true) break;
    }

    const hasBits = await ev(`(() => {
      const i = document.getElementById('cookie-input');
      const b = document.getElementById('cookie-import');
      return { input: !!i, tag: i && i.tagName, button: !!b, label: (b && b.textContent || '').trim(),
               visible: !!(i && i.offsetParent !== null) };
    })()`);

    // 空输入 → 提示
    await ev(`document.getElementById('cookie-import').click()`);
    await sleep(200);
    const emptyMsg = await ev(`document.getElementById('cookie-msg').textContent`);

    // mock 服务端 400 → 界面要显示服务端那句 message
    const SECRET_UI = 'PLACEHOLDER_TOKEN_UI_ONLY';
    await ev(`(() => {
      API.importCookie = async () => ({ ok: false, code: 400, reason: 'invalid', message: 'cookie 无效或已过期' });
      const i = document.getElementById('cookie-input');
      i.value = '${SECRET_UI}';
      document.getElementById('cookie-import').click();
      return 1;
    })()`);
    await sleep(500);
    const badMsg = await ev(`document.getElementById('cookie-msg').textContent`);
    const domLeak = await ev(`document.body.innerHTML.includes('${SECRET_UI}')`);

    check('5', '账号面板里有 #cookie-input + 「导入」按钮；空输入与 mock 400 都有文案',
      opened === 'ok' && hasBits.input && hasBits.tag === 'TEXTAREA' && hasBits.button && /导入/.test(hasBits.label)
      && hasBits.visible && /粘进来/.test(emptyMsg || '') && badMsg === 'cookie 无效或已过期' && domLeak === false,
      `input=${hasBits.input}/${hasBits.tag} visible=${hasBits.visible} btn="${hasBits.label}" 空输入="${emptyMsg}" mock400="${badMsg}" DOM泄露=${domLeak}`);

    const shot1 = await shotElement('.modal__card', 'login3-1-panel.png', 16);
    const shot2 = qrOk ? await shotElement('#qr-box', 'login3-2-qr.png', 14) : false;
    const sz1 = shot1 && fs.existsSync(path.join(SHOTS, 'login3-1-panel.png')) ? fs.statSync(path.join(SHOTS, 'login3-1-panel.png')).size : 0;
    const sz2 = shot2 && fs.existsSync(path.join(SHOTS, 'login3-2-qr.png')) ? fs.statSync(path.join(SHOTS, 'login3-2-qr.png')).size : 0;
    check('8', '两张截图都写出来了', sz1 > 2000 && sz2 > 1000,
      `login3-1-panel.png=${sz1}B login3-2-qr.png=${sz2}B qr从边车(base64)=${qrOk}`);
  }
  await sleep(400);
  {
    check('7', '0 个 console error / 0 个未捕获异常',
      consoleErrs.length === 0 && exceptions.length === 0,
      `consoleErrors=${consoleErrs.length} exceptions=${exceptions.length} logErrors=${logErrs.length}` +
      (consoleErrs.length ? ' | ' + consoleErrs.slice(0, 3).join(' / ') : '') +
      (exceptions.length ? ' | ' + exceptions.slice(0, 2).join(' / ') : '') +
      (logErrs.length ? ' | log: ' + logErrs.slice(0, 2).join(' / ') : ''));
  }
  try { ws.close(); } catch { /* ignore */ }
  try { chrome.kill(); } catch { /* ignore */ }
  chrome = null;

  /* ==================== 3) harvest 管线（带假上游的临时进程） ==================== */
  {
    fs.writeFileSync(STUB_MODE_FILE, 'ok');
    await restartServer({ stub: true });
    console.log(`  · 已换成带 stub 的临时服务（pid=${listenerPid(PORT)}），只拦 fetch，不改产品代码`);

    /* 3a) 803 + cookie 串 → 登录成功，MUSIC_U 落进 .session.json */
    fs.writeFileSync(STUB_MODE_FILE, 'ok');
    const h = await jpost('/api/login/harvest', { key: 'STUB-KEY-1' }, 90000);
    let parsed = {};
    try { parsed = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { parsed = {}; }
    const wroteMusicU = typeof parsed.MUSIC_U === 'string' && parsed.MUSIC_U.length > 0;
    const isFake = parsed.MUSIC_U === 'FAKE_MUSIC_U_FOR_TEST_ONLY';
    const sess = await jget('/api/session', 30000);
    check('3a', '803 + cookie 串 → MUSIC_U 写进 .session.json，随后 /api/session 判定已登录',
      h.status === 200 && h.body.ok === true && !!h.body.profile && wroteMusicU && isFake && sess.body.loggedIn === true,
      `harvest HTTP ${h.status} ok=${h.body.ok} profile.userId=${h.body.profile && h.body.profile.userId} ` +
      `session键=${Object.keys(parsed).join(',')} /api/session.loggedIn=${sess.body.loggedIn}`);

    /* 3b) 803 但没有 MUSIC_U → 400 + 回滚 */
    const before = fs.readFileSync(SESSION_FILE);
    fs.writeFileSync(STUB_MODE_FILE, 'nomusic');
    const bad = await jpost('/api/login/harvest', { key: 'STUB-KEY-2' }, 90000);
    const after = fs.readFileSync(SESSION_FILE);
    check('3b', '803 但 cookie 里没有 MUSIC_U → 400 且 .session.json 回滚',
      bad.status === 400 && bad.body.reason === 'no-music-u' && sha(before) === sha(after),
      `HTTP ${bad.status} reason=${bad.body.reason} keys=${(bad.body.keys || []).join(',')} hash ${sha(before)} → ${sha(after)}`);

    /* 9) 边车日志里不许出现凭证：这一轮所有请求都走 body，URL 里不该有 cookie= */
    const all = fs.existsSync(SIDECAR_LOG) ? fs.readFileSync(SIDECAR_LOG) : Buffer.alloc(0);
    const fresh = all.subarray(Math.min(LOG_OFFSET, all.length)).toString('utf8');
    const hit = ['cookie=', 'MUSIC_U=', '__csrf='].filter((s) => fresh.includes(s));
    check('9', '边车 .log 的本轮增量里没有任何 cookie 键值（凭证不落盘）',
      hit.length === 0, `本轮新增 ${fresh.length} 字节，命中=${hit.join(',') || '无'}`);
  }
} catch (e) {
  phaseBFailed = true;
  console.error('EXCEPTION:', (e && e.stack) || e);
  check('X', '验收脚本自身没崩', false, String((e && e.message) || e));
} finally {
  /* 收尾：关浏览器 → 杀掉临时 stub 服务 → 还原 .session.json → 起回正常服务 */
  try { if (ws) ws.close(); } catch { /* ignore */ }
  try { if (chrome) chrome.kill(); } catch { /* ignore */ }
  try { if (fs.existsSync(STUB_MODE_FILE)) fs.unlinkSync(STUB_MODE_FILE); } catch { /* ignore */ }
  await stopServer();
  try {
    const now = fs.readFileSync(SESSION_FILE);
    if (sha(now) !== ORIGINAL_SESSION_HASH) fs.writeFileSync(SESSION_FILE, ORIGINAL_SESSION);
  } catch { fs.writeFileSync(SESSION_FILE, ORIGINAL_SESSION); }
  const restored = sha(fs.readFileSync(SESSION_FILE)) === ORIGINAL_SESSION_HASH;
  console.log(`  · .session.json 还原：${restored ? 'ok' : '失败！'}`);

  try {
    startServer({ stub: false });
    if (await waitUp()) {
      const s = await jget('/api/session', 30000);
      console.log(`  · 正常服务已起回：pid=${listenerPid(PORT)} /api/session=${s.status}`);
    } else {
      console.log('  · 警告：正常服务没起回来，需要手动 `node server.mjs`');
    }
  } catch (e) {
    console.log('  · 起回正常服务失败：', (e && e.message) || e);
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n===== ${pass} passed / ${fail} failed =====`);
  for (const r of results) if (!r.ok) console.log(`  FAIL [${r.id}] ${r.name}`);
  if (fail || phaseBFailed) process.exitCode = 1;
}
