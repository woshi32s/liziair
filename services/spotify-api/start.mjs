/**
 * LIZI · Spotify 边车（**可行性骨架，本期不接音频**）
 *
 * 为什么只做骨架：Spotify 的 Web API 够用（搜索/歌单/歌手元数据），
 * 但**音频必须 node-librespot 原生二进制（59.4MB）+ Premium 账号**，而且那是解密 DRM 的灰区。
 * 所以这里只做：PKCE 登录（官方 OAuth，回调 127.0.0.1:5588）+ 元数据读取，
 * `/audio` 永远回 `{ url:'', reason:'drm' }`，界面据此如实标「本期不接音频」。
 *
 * 没有内置 client_id：Spotify 不给第三方预置凭证。用户/开发者自己注册一个免费 App，
 * 把 Client ID 填进 `SPOTIFY_CLIENT_ID` 环境变量或本目录 `.client.json`：
 *   { "clientId": "xxxx", "clientSecret": "yyyy" }
 * 有 secret 时**不需要用户登录**也能搜（client_credentials）；只有 clientId 时走 PKCE 用户授权。
 * 没配就明确回「缺 Client ID」，不假装能用。
 *
 * Redirect URI 必须在 Spotify 后台登记成：http://127.0.0.1:5588/callback
 *
 * 启动：node services/spotify-api/start.mjs（零依赖，Node ≥18 即可）
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_FILE = path.join(__dirname, '.port');
const LOG_FILE = path.join(__dirname, '.log');
const TOKEN_FILE = path.join(__dirname, '.auth-token.json');
const CLIENT_FILE = path.join(__dirname, '.client.json');
const CALLBACK_PORT = Number(process.env.SPOTIFY_CALLBACK_PORT || 5588);
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const SCOPES = ['user-read-private', 'user-read-email', 'playlist-read-private'];

try {
  if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
} catch { /* 第一次跑没有日志 */ }

for (const stream of [process.stdout, process.stderr]) {
  try { stream.on('error', () => { /* EPIPE 忽略 */ }); } catch { /* ignore */ }
}
function log(...parts) {
  const line = `[spotify-api ${new Date().toISOString()}] ${parts.join(' ')}`;
  try { console.log(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}
function fail(...parts) {
  const line = `[spotify-api ${new Date().toISOString()}] FATAL ${parts.join(' ')}`;
  try { console.error(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

function preferredPort() {
  if (process.env.SPOTIFY_API_PORT) return Number(process.env.SPOTIFY_API_PORT) || 0;
  try {
    const prev = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    fs.unlinkSync(PORT_FILE);
    if (Number.isInteger(prev) && prev > 1024 && prev < 65536) return prev;
  } catch { /* 第一次跑 */ }
  return 3214;
}

/* ---------------- 凭证 ---------------- */
function readClient() {
  let clientId = process.env.SPOTIFY_CLIENT_ID || '';
  let clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';
  if (!clientId) {
    try {
      const raw = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'));
      clientId = raw.clientId || '';
      clientSecret = raw.clientSecret || '';
    } catch { /* 没配 */ }
  }
  return { clientId, clientSecret };
}
let client = readClient();

/* ---------------- token 落盘 ---------------- */
function loadToken() {
  try {
    const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (raw && raw.accessToken) return raw;
  } catch { /* 没登录过 */ }
  return null;
}
let token = loadToken();
function saveToken(t) {
  token = t;
  try {
    if (!t) { fs.unlinkSync(TOKEN_FILE); return; }
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
  } catch (e) { log('token 写盘失败：', e && e.message); }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let pendingPkce = null;   // { verifier, state, at }

/* ---------------- HTTP 小工具 ---------------- */
const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

async function postForm(url, body, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  return { status: r.status, data };
}

/** 拿一个可用的 access token：先用存下来的，过期就刷新；都没有时试 client_credentials */
async function accessToken() {
  if (!client.clientId) throw new Error('缺少 SPOTIFY_CLIENT_ID：Spotify 不预置第三方凭证，需要自己注册一个免费 App');
  if (token && token.accessToken && token.expiresAt > Date.now() + 30000) return token.accessToken;
  if (token && token.refreshToken) {
    const r = await postForm('https://accounts.spotify.com/api/token', {
      grant_type: 'refresh_token', refresh_token: token.refreshToken, client_id: client.clientId,
    });
    if (r.status === 200 && r.data.access_token) {
      saveToken({ ...token, accessToken: r.data.access_token, expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000 });
      return token.accessToken;
    }
  }
  if (client.clientSecret) {
    // client_credentials：不需要用户登录，但只能读公开元数据（搜索/专辑/歌手）
    const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');
    const r = await postForm('https://accounts.spotify.com/api/token',
      { grant_type: 'client_credentials' }, { Authorization: 'Basic ' + basic });
    if (r.status === 200 && r.data.access_token) {
      return r.data.access_token;    // 不落盘：客户端凭证 token 不代表用户，重启再取即可
    }
    throw new Error('client_credentials 取 token 失败（' + (r.data.error_description || r.data.error || r.status) + '）');
  }
  throw new Error('未登录 Spotify：点「登录」走 PKCE 授权（需要 Client ID；有 Client Secret 时可直接匿名搜）');
}

/* ==========================================================================
   OAuth PKCE
   ========================================================================== */
function authorizeUrl() {
  if (!client.clientId) throw new Error('缺少 SPOTIFY_CLIENT_ID');
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(12));
  pendingPkce = { verifier, state, at: Date.now() };
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const u = new URL('https://accounts.spotify.com/authorize');
  u.searchParams.set('client_id', client.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', SCOPES.join(' '));
  return u.toString();
}

/* 回调服务：单独一个 127.0.0.1:5588，只干一件事 —— 接 code 换 token */
const callbackServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${CALLBACK_PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }
  const err = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const page = (title, detail) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:15px/1.6 system-ui;padding:48px;color:#17171a">
<h1 style="font-size:20px">${title}</h1><p style="color:#666">${detail}</p>
<p style="color:#999;font-size:13px">这个窗口可以关掉了，回到 LIZI 设置面板看状态。</p></body>`);
  };
  if (err) { log('授权被拒：' + err); return page('Spotify 授权被拒绝', err); }
  if (!code || !pendingPkce || state !== pendingPkce.state) {
    log('回调参数不匹配（code/state）');
    return page('回调不匹配', 'state 对不上或没有 code，请重新点登录。');
  }
  const r = await postForm('https://accounts.spotify.com/api/token', {
    grant_type: 'authorization_code', code,
    redirect_uri: REDIRECT_URI,
    client_id: client.clientId,
    code_verifier: pendingPkce.verifier,
  });
  if (r.status !== 200 || !r.data.access_token) {
    log('换 token 失败：' + JSON.stringify(r.data).slice(0, 200));
    return page('换 token 失败', (r.data && (r.data.error_description || r.data.error)) || String(r.status));
  }
  saveToken({
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token || '',
    expiresAt: Date.now() + (r.data.expires_in || 3600) * 1000,
    scope: r.data.scope || '',
  });
  pendingPkce = null;
  log('PKCE 授权成功，token 已落盘');
  return page('Spotify 已登录', '可以回 LIZI 了（本期不接音频，只有元数据）。');
});
callbackServer.on('error', (e) => log(`回调端口 ${CALLBACK_PORT} 起不来（${e.code}）—— PKCE 登录会不可用`));
callbackServer.listen(CALLBACK_PORT, '127.0.0.1', () => log(`OAuth 回调就绪 http://127.0.0.1:${CALLBACK_PORT}/callback`));

/* ==========================================================================
   API 路由
   ========================================================================== */
async function sp(pathname, params) {
  const t = await accessToken();
  const u = new URL('https://api.spotify.com/v1' + pathname);
  for (const [k, v] of Object.entries(params || {})) if (v != null) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + t }, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  return { status: r.status, data };
}

async function handle(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === '/health' || p === '/') {
    return json(res, 200, {
      code: 200,
      ok: !!client.clientId,
      clientId: client.clientId ? client.clientId.slice(0, 6) + '…' : '',
      hasSecret: !!client.clientSecret,
      loggedIn: !!(token && token.accessToken),
      expiresAt: (token && token.expiresAt) || 0,
      callback: REDIRECT_URI,
      // 本期硬限制，前端直接拿来显示，别在前端再写一份
      audio: false,
      reason: '音频需要 node-librespot 原生二进制（59.4MB）+ Premium 账号，且属解密 DRM 的灰区；本期不接',
    });
  }

  if (p === '/login/url') {
    try {
      return json(res, 200, { code: 200, url: authorizeUrl(), callback: REDIRECT_URI });
    } catch (e) {
      return json(res, 200, { code: 400, error: String(e.message) });
    }
  }

  if (p === '/status' || p === '/login/status') {
    if (!client.clientId) return json(res, 200, { code: 200, loggedIn: false, error: '缺少 SPOTIFY_CLIENT_ID' });
    if (!token) {
      // 有 secret 时不需要用户登录，直接用 client_credentials 探一下
      if (client.clientSecret) {
        try { await accessToken(); return json(res, 200, { code: 200, loggedIn: false, mode: 'client-credentials', nickname: 'Spotify（客户端凭证）' }); }
        catch (e) { return json(res, 200, { code: 200, loggedIn: false, error: String(e.message) }); }
      }
      return json(res, 200, { code: 200, loggedIn: false });
    }
    try {
      const me = await sp('/me');
      if (me.status === 200 && me.data && me.data.id) {
        return json(res, 200, {
          code: 200, loggedIn: true, mode: 'pkce',
          nickname: me.data.display_name || me.data.id,
          avatar: (me.data.images && me.data.images[0] && me.data.images[0].url) || '',
          product: me.data.product || '',
        });
      }
      if (me.status === 401 && client.clientSecret) {
        return json(res, 200, { code: 200, loggedIn: false, mode: 'client-credentials', nickname: 'Spotify（客户端凭证）' });
      }
      return json(res, 200, { code: 200, loggedIn: true, mode: 'pkce', nickname: 'Spotify', error: '读取 /me 失败' });
    } catch (e) {
      return json(res, 200, { code: 200, loggedIn: !!token, error: String(e.message) });
    }
  }

  if (p === '/logout') {
    saveToken(null);
    return json(res, 200, { code: 200, loggedIn: false });
  }

  if (p === '/search') {
    const s = (q.get('q') || '').trim();
    if (!s) return json(res, 200, { code: 200, items: [], total: 0 });
    try {
      const r = await sp('/search', { q: s, type: 'track', limit: Math.min(50, Number(q.get('limit')) || 20) });
      if (r.status !== 200) {
        return json(res, 200, { code: r.status, error: (r.data && r.data.error && r.data.error.message) || ('Spotify 搜索失败 ' + r.status), items: [] });
      }
      return json(res, 200, {
        code: 200,
        items: ((r.data.tracks && r.data.tracks.items) || []).filter(Boolean),
        total: (r.data.tracks && r.data.tracks.total) || 0,
      });
    } catch (e) {
      return json(res, 200, { code: 400, error: String(e.message), items: [] });
    }
  }

  if (p === '/audio') {
    // 明确不做：不是没实现，是不做（见 health 里的 reason）
    return json(res, 200, { code: 200, url: '', reason: 'drm', error: '本期不接 Spotify 音频（需 Premium + node-librespot，且属 DRM 灰区）' });
  }

  if (p === '/lyrics') {
    // Spotify 官方 Web API 不提供歌词；Musixmatch 之类没有授权，不做假的
    return json(res, 200, { code: 200, lyric: '', reason: 'no-lyrics-api' });
  }

  return json(res, 404, { code: 404, error: 'unknown spotify api: ' + p });
}

const wantPort = preferredPort();
let retried = false;
const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return json(res, 400, { code: 400, error: 'bad url' }); }
  handle(req, res, url).catch((e) => {
    log('请求处理失败:', (e && e.stack) || e);
    try { json(res, 502, { code: 502, error: String(e && e.message) }); } catch { /* 已响应 */ }
  });
});

function ready() {
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : wantPort;
  fs.writeFileSync(PORT_FILE, String(port));
  log(`就绪 http://127.0.0.1:${port}  （只绑回环；Client ID ${client.clientId ? '已配' : '没配'}；${token ? '已授权' : '未授权'}）`);
  console.log(`SPOTIFY_API_READY ${port}`);
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

const parentPid = Number(process.env.SPOTIFY_PARENT_PID || 0);
if (Number.isInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try { process.kill(parentPid, 0); }
    catch { log('父进程已退出，边车跟着收工'); process.exit(0); }
  }, 5000).unref();
}
