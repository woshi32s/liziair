/**
 * LIZI · 汽水音乐边车
 *
 * `qishui-music-api`（0.2.2，MIT，零依赖）**不是 HTTP 服务，是纯协议库**：
 * 它导出 createQishuiApi/QISHUI_OPERATIONS/createQishuiDeviceId/isAccountId，
 * 报文要求 ByteDance 的 guard 签名（deviceId / ticket / guardKey / guardCert / guardTsSign / accessCode），
 * 而且 `engines: node >= 24`（要 BigInt、要 crypto 的 P-256 / PKCS#8）。
 *
 * 所以这个文件就是个**很薄的 HTTP 壳**：把库的 request() 摊成 /search /audio /login/qr/* 这些路由，
 * 形状照 services/qq-api 那套（{ code, ... }），只绑 127.0.0.1，端口写 .port。
 * 端口/EPIPE/父进程/日志的做法和 services/kugou-api/start.mjs 一致。
 *
 * 启动：node services/qishui-api/start.mjs     （server.mjs 按需 spawn，优先用系统 node ≥24）
 * 停止：关掉进程即可。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { wrapQrFetch } from './qr.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_FILE = path.join(__dirname, '.port');
const LOG_FILE = path.join(__dirname, '.log');
const SESSION_FILE = path.join(__dirname, '.auth-session.json');
const DEVICE_FILE = path.join(__dirname, '.auth-device.json');

/* ---------------- Node 版本闸门 ----------------
   这个包 engines 写的是 >=24（BigInt + P-256 + PKCS#8）。低于 24 不静默降级：
   明确告诉调用方「本机 node 版本不足」，让界面把这个音源置灰。 */
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (!(NODE_MAJOR >= 24)) {
  const line = `[qishui-api] FATAL node ${process.versions.node} 不满足 engines（>=24）`;
  try { console.error(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
  console.log(`QISHUI_API_UNSUPPORTED_NODE ${process.versions.node}`);
  process.exit(2);
}

try {
  if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
} catch { /* 第一次跑没有日志 */ }

for (const stream of [process.stdout, process.stderr]) {
  try { stream.on('error', () => { /* EPIPE 忽略 */ }); } catch { /* ignore */ }
}
function log(...parts) {
  const line = `[qishui-api ${new Date().toISOString()}] ${parts.join(' ')}`;
  try { console.log(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}
function fail(...parts) {
  const line = `[qishui-api ${new Date().toISOString()}] FATAL ${parts.join(' ')}`;
  try { console.error(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

/* ---------------- 端口 ---------------- */
function preferredPort() {
  if (process.env.QISHUI_API_PORT) return Number(process.env.QISHUI_API_PORT) || 0;
  try {
    const prev = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    fs.unlinkSync(PORT_FILE);
    if (Number.isInteger(prev) && prev > 1024 && prev < 65536) return prev;
  } catch { /* 第一次跑 */ }
  return 3212;
}

/* ---------------- 设备身份 + 会话落盘 ----------------
   包本身不碰磁盘（README 明确说宿主负责存储/加密），所以这里代劳：
   deviceId 固定（换设备 ID 等于换一台车机），会话（ticket/guardKey…）落 .auth-session.json。 */
const require = createRequire(import.meta.url);
let lib;
try {
  lib = require('qishui-music-api');
} catch (e) {
  fail('加载 qishui-music-api 失败:', (e && e.stack) || e);
  fail('依赖装了吗？在 services/qishui-api 里跑 npm install');
  process.exit(1);
}
const { createQishuiApi, createQishuiDeviceId, isQishuiDeviceId } = lib;

function loadDeviceId() {
  try {
    const raw = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
    if (isQishuiDeviceId(raw && raw.deviceId)) return raw.deviceId;
  } catch { /* 没有就生成 */ }
  const deviceId = createQishuiDeviceId();
  try {
    fs.writeFileSync(DEVICE_FILE, JSON.stringify({ deviceId, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    log('生成了新的设备 ID .auth-device.json（删了 = 汽水当新设备）');
  } catch (e) { log('设备 ID 写不进去：', e && e.message); }
  return deviceId;
}

const deviceId = loadDeviceId();

function loadSession() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (raw && raw.ticket && raw.guardKey && raw.guardCert && raw.guardTsSign && raw.accessCode) return raw;
  } catch { /* 没登录过 */ }
  return null;
}

let current = loadSession();
let revision = 0;
const sessions = {
  deviceId,
  get revision() { return revision; },
  get() { return current; },
  set(value) {
    current = value;
    revision++;
    try {
      fs.writeFileSync(SESSION_FILE, JSON.stringify(value, null, 2), { mode: 0o600 });
      log('登录态已落盘 .auth-session.json（userid=' + (value.userId || '?') + '）');
    } catch (e) { log('登录态写盘失败：', e && e.message); }
  },
  clear() {
    current = null;
    revision++;
    try { fs.unlinkSync(SESSION_FILE); } catch { /* 本来就没有 */ }
    log('登录态已清除');
  },
};

const api = createQishuiApi({
  deviceId,
  sessions,
  // 只拦 open.douyin.com/oauth/get_qrcode/：把上游 77×77/ECC M 的 PNG
  // 按同一条深链重画成 57×57/ECC L、8px 模块的清晰 PNG；失败原样放行。
  // 二维码万一出问题，设 QISHUI_QR_SIMPLIFY=0 即可退回上游原图，不用改代码。
  fetch: process.env.QISHUI_QR_SIMPLIFY === '0'
    ? globalThis.fetch
    : wrapQrFetch(globalThis.fetch, { log: (m) => log('qr:', m) }),
  log: (m) => log('lib:', m),
  warn: (m) => log('lib warn:', m),
});

/* ---------------- 业务调用 ---------------- */
const call = (op, params = {}) => api.request(op, params);

/** 库的错误 → 我们这套的 code。前端只看 code/error 两个字段。 */
function failBody(error) {
  const code = (error && error.code) || 'unavailable';
  const map = { 'auth-required': 401, 'not-playable': 403, unavailable: 502, network: 502, 'invalid-response': 400, unsupported: 400 };
  return {
    code: map[code] || 502,
    ok: false,
    error: (error && error.message) || '汽水接口失败',
    // 上游数字码（28001008 之类）原样带出去，排查时不用猜
    upstreamCode: (error && error.upstreamCode) || null,
    stage: (error && error.stage) || null,
  };
}

/**
 * 头像归一化。汽水 /me/info 给的不是字符串，而是图片对象：
 *   { need_complete_url: true, urls: ['https://p26-sign.douyinpic.com/...jpeg?...'], uri, template_prefix }
 * 只有 need_complete_url === true 的 urls 才是带签名的完整地址；歌手简介那种
 * `urls:['https://p3-luna.douyinpic.com/img/']` + `need_complete_url:false` 的基址
 * 缺签名，拼出来实测 400（fail to get template），不能拿来冒充头像。
 */
function avatarUrl(value) {
  const pick = (raw) => {
    if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw)) return '';
    try {
      const u = new URL(raw);
      // 只要路径里有实际对象；`…/img/` 这类前缀不是完整图片地址
      return u.pathname && u.pathname !== '/' && !/\/img\/$/i.test(u.pathname) ? raw : '';
    } catch { return ''; }
  };
  if (typeof value === 'string') return pick(value);
  if (value && typeof value === 'object') {
    if (value.need_complete_url === false) return '';
    const list = Array.isArray(value.urls) ? value.urls : [];
    for (const raw of list) {
      const url = pick(raw);
      if (url) return url;
    }
  }
  return '';
}

const readJson = async (req) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
};

const json = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

/* ---------------- 路由 ---------------- */
async function handle(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === '/health' || p === '/') {
    return json(res, 200, {
      code: 200, ok: true,
      node: process.versions.node,
      deviceId,
      loggedIn: !!current,
      userId: (current && current.userId) || null,
      nickname: (current && current.user && current.user.nickname) || '',
    });
  }

  if (p === '/status' || p === '/login/status') {
    if (!current) return json(res, 200, { code: 200, loggedIn: false });
    const r = await call('login_status');
    if (!r.ok) {
      // 会话被判失效时库会自己 clear()，所以这里再读一次 current
      if (!current) return json(res, 200, { code: 200, loggedIn: false, error: r.error.message });
      return json(res, 200, {
        code: 200, loggedIn: true,
        nickname: (current.user && current.user.nickname) || '',
        avatar: avatarUrl(current.user && current.user.avatar),
        vip: !!(current.user && current.user.isVip),
        stale: r.error.message,
      });
    }
    const u = r.data || {};
    return json(res, 200, {
      code: 200, loggedIn: true,
      nickname: u.nickname || '',
      avatar: avatarUrl(u.avatar) || avatarUrl(current && current.user && current.user.avatar),
      vip: !!u.isVip, userId: u.id || (current && current.userId) || '',
    });
  }

  if (p === '/login/qr/key') {
    const r = await call('login_qr_key');
    if (!r.ok) return json(res, 502, failBody(r.error));
    return json(res, 200, { code: 200, key: r.data.key });
  }

  if (p === '/login/qr/create') {
    const key = q.get('key') || '';
    if (!key) return json(res, 400, { code: 400, error: 'key required' });
    const r = await call('login_qr_create', { key });
    if (!r.ok) return json(res, 502, failBody(r.error));
    // 库给的就是 data:image/png;base64,... 的整串，前端直接塞 <img src>
    return json(res, 200, { code: 200, qrimg: r.data.imageUrl || '' });
  }

  if (p === '/login/qr/check') {
    const key = q.get('key') || '';
    if (!key) return json(res, 400, { code: 400, error: 'key required' });
    const r = await call('login_qr_check', { key });
    if (!r.ok) return json(res, 200, { code: 500, error: failBody(r.error).error });
    const state = (r.data && r.data.state) || 'waiting';
    /* 状态映射照 QQ/网易云那套：801 等待 / 802 待确认 / 803 成功 / 800 过期。
       汽水自己的词是 waiting/scanned/confirmed/expired/error。 */
    const MAP = { waiting: 801, scanned: 802, confirmed: 803, expired: 800, error: 800 };
    const out = { code: MAP[state] || 801, state };
    if (state === 'confirmed') {
      out.loggedIn = true;
      out.nickname = (current && current.user && current.user.nickname) || '';
      out.avatar = avatarUrl(current && current.user && current.user.avatar);
      out.vip = !!(current && current.user && current.user.isVip);
    }
    if (state === 'error') out.error = '扫码被拒绝，或授权码已失效';
    return json(res, 200, out);
  }

  if (p === '/logout') {
    await call('logout');
    return json(res, 200, { code: 200, loggedIn: false });
  }

  if (p === '/search') {
    const query = (q.get('q') || q.get('keywords') || '').trim();
    const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 20));
    const offset = Math.max(0, Number(q.get('offset')) || 0);
    if (!query) return json(res, 200, { code: 200, items: [], hasMore: false, nextOffset: 0 });
    const r = await call('search', { query, limit, offset });
    if (!r.ok) return json(res, 502, failBody(r.error));
    return json(res, 200, { code: 200, items: r.data.items || [], hasMore: !!r.data.hasMore, nextOffset: r.data.nextOffset || 0 });
  }

  if (p === '/song/detail') {
    const id = q.get('id') || '';
    if (!id) return json(res, 400, { code: 400, error: 'id required' });
    const r = await call('song_detail', { id });
    if (!r.ok) return json(res, 502, failBody(r.error));
    return json(res, 200, { code: 200, track: r.data });
  }

  if (p === '/audio') {
    const id = q.get('id') || '';
    if (!id) return json(res, 400, { code: 400, error: 'id required' });
    const quality = ['standard', 'high', 'lossless', 'hires'].includes(q.get('quality')) ? q.get('quality') : 'standard';
    const r = await call('audio', { id, quality });
    if (!r.ok) return json(res, 200, { code: 200, url: '', reason: r.error.code, error: r.error.message });
    return json(res, 200, {
      code: 200,
      url: r.data.url,
      quality: r.data.quality,
      preview: !!r.data.preview,
      clipStartMs: r.data.clipStartMs || 0,
      expiresAt: r.data.expiresAt || 0,
    });
  }

  if (p === '/lyrics') {
    const id = q.get('id') || '';
    if (!id) return json(res, 400, { code: 400, error: 'id required' });
    const r = await call('lyrics', { id });
    if (!r.ok) return json(res, 200, { code: 200, lyric: '', error: r.error.message });
    return json(res, 200, { code: 200, lyrics: r.data });
  }

  if (p === '/feed/modes') {
    const r = await call('feed_modes');
    if (!r.ok) return json(res, 502, failBody(r.error));
    return json(res, 200, { code: 200, modes: r.data });
  }

  if (p === '/feed') {
    const r = await call('feed', {
      scene: q.get('scene') || undefined,
      preference: q.get('preference') || undefined,
      first: q.get('first') === '1',
      limit: Math.min(100, Math.max(1, Number(q.get('limit')) || 20)),
    });
    if (!r.ok) return json(res, 502, failBody(r.error));
    return json(res, 200, { code: 200, items: r.data.items || r.data || [], more: !!r.data.hasMore });
  }

  /* ---------- 账号曲库（2026-11-07 补的薄路由） ----------
     库本身暴露了 user_playlists / liked_songs / playlist_detail /
     search_playlists / recent_played / artist_songs，这里只是把 request(op)
     摊成 HTTP。账号类操作需要已登录会话，未登录时库会回 auth-required（401）。 */
  if (p === '/user/playlists') {
    const r = await call('user_playlists', {
      limit: Math.min(500, Math.max(1, Number(q.get('limit')) || 100)),
      offset: Math.max(0, Number(q.get('offset')) || 0),
    });
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, {
      code: 200,
      items: r.data.items || [],
      total: r.data.total || 0,
      hasMore: !!r.data.hasMore,
      nextOffset: r.data.nextOffset || 0,
    });
  }

  if (p === '/liked_songs' || p === '/liked-songs') {
    const r = await call('liked_songs');
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, {
      code: 200,
      ids: r.data.ids || [],
      total: r.data.total || 0,
      whole: !!r.data.whole,
    });
  }

  if (p === '/playlist/detail') {
    const id = q.get('id') || '';
    if (!id) return json(res, 400, { code: 400, error: 'id required' });
    const r = await call('playlist_detail', { id });
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, { code: 200, playlist: r.data });
  }

  if (p === '/search/playlists') {
    const query = (q.get('q') || q.get('keywords') || '').trim();
    if (!query) return json(res, 200, { code: 200, items: [], hasMore: false, nextOffset: 0 });
    const r = await call('search_playlists', {
      query,
      limit: Math.min(100, Math.max(1, Number(q.get('limit')) || 20)),
      offset: Math.max(0, Number(q.get('offset')) || 0),
    });
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, { code: 200, items: r.data.items || [], hasMore: !!r.data.hasMore, nextOffset: r.data.nextOffset || 0 });
  }

  if (p === '/recent_played') {
    const r = await call('recent_played', {
      limit: Math.min(100, Math.max(1, Number(q.get('limit')) || 50)),
      offset: Math.max(0, Number(q.get('offset')) || 0),
    });
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, { code: 200, items: r.data.items || [], hasMore: !!r.data.hasMore });
  }

  if (p === '/artist/songs') {
    const id = q.get('id') || '';
    if (!id) return json(res, 400, { code: 400, error: 'id required' });
    const r = await call('artist_songs', {
      id,
      limit: Math.min(100, Math.max(1, Number(q.get('limit')) || 50)),
      offset: Math.max(0, Number(q.get('offset')) || 0),
    });
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, { code: 200, items: r.data.items || [], hasMore: !!r.data.hasMore });
  }

  if (p === '/playlist/tracks') {
    const id = q.get('id') || '';
    if (!id) return json(res, 400, { code: 400, error: 'id required' });
    const r = await call('playlist_tracks', {
      id,
      limit: Math.min(100, Math.max(1, Number(q.get('limit')) || 50)),
      offset: Math.max(0, Number(q.get('offset')) || 0),
    });
    if (!r.ok) return json(res, 502, failBody(r.error));
    return json(res, 200, { code: 200, items: r.data.items || [], hasMore: !!r.data.hasMore });
  }

  return json(res, 404, { code: 404, error: 'unknown qishui api: ' + p });
}

/* ---------------- 服务 ---------------- */
const wantPort = preferredPort();
let retried = false;

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return json(res, 400, { code: 400, error: 'bad url' }); }
  handle(req, res, url).catch((e) => {
    log('请求处理失败:', (e && e.stack) || e);
    try { json(res, 502, { code: 502, error: String(e && e.message) }); } catch { /* 已经发过响应了 */ }
  });
});

function ready() {
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : wantPort;
  fs.writeFileSync(PORT_FILE, String(port));
  log(`就绪 http://127.0.0.1:${port}  （只绑回环；node ${process.versions.node}；${current ? '已登录' : '未登录'}）`);
  console.log(`QISHUI_API_READY ${port}`);
}

server.on('error', (e) => {
  const code = e && e.code;
  if ((code === 'EADDRINUSE' || code === 'EACCES') && !retried) {
    retried = true;
    log(`端口 ${wantPort} 不可用（${code}），改用系统分配…`);
    setTimeout(() => { try { server.listen(0, '127.0.0.1', ready); } catch (err) { fail('重试监听失败:', err && err.message); process.exit(1); } }, 80);
    return;
  }
  fail(`监听失败（${code || 'unknown'}）: ${e && e.message}`);
  process.exit(1);
});
server.on('listening', ready);
server.listen(wantPort, '127.0.0.1');

process.on('uncaughtException', (e) => {
  if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) return;
  fail('未捕获异常:', (e && e.stack) || e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) return;
  fail('未处理的 Promise 拒绝:', (e && e.stack) || e);
  process.exit(1);
});

const parentPid = Number(process.env.QISHUI_PARENT_PID || 0);
if (Number.isInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try { process.kill(parentPid, 0); }
    catch { log('父进程已退出，边车跟着收工'); process.exit(0); }
  }, 5000).unref();
}
