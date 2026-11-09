/**
 * LIZI · 波点音乐边车
 *
 * `bodian-music-api`（0.1.2，**AGPL-3.0**，Node ≥24，依赖 qrcode）同样是**纯协议库**
 * （createBodianApi / BODIAN_OPERATIONS），不提供 HTTP 服务，所以这里是个薄 HTTP 壳，
 * 结构和 services/qishui-api/start.mjs 一模一样：只绑 127.0.0.1、端口写 .port、登录态落盘、
 * EPIPE 吞掉、盯父进程、失败要说原因。
 *
 * 许可证注意：这个包是 AGPL-3.0（汽水和酷狗是 MIT）。我们只在本机边车里调用它、不修改它，
 * 也不把它打进安装包（根 package.json 的 build.files 没带 services/）。要随包分发得先过许可这一关。
 *
 * 启动：node services/bodian-api/start.mjs      （server.mjs 按需 spawn，优先用系统 node ≥24）
 * 停止：关掉进程即可。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_FILE = path.join(__dirname, '.port');
const LOG_FILE = path.join(__dirname, '.log');
const SESSION_FILE = path.join(__dirname, '.auth-session.json');
const DEVICE_FILE = path.join(__dirname, '.auth-device.json');

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (!(NODE_MAJOR >= 24)) {
  const line = `[bodian-api] FATAL node ${process.versions.node} 不满足 engines（>=24）`;
  try { console.error(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
  console.log(`BODIAN_API_UNSUPPORTED_NODE ${process.versions.node}`);
  process.exit(2);
}

try {
  if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
} catch { /* 第一次跑没有日志 */ }

for (const stream of [process.stdout, process.stderr]) {
  try { stream.on('error', () => { /* EPIPE 忽略 */ }); } catch { /* ignore */ }
}
function log(...parts) {
  const line = `[bodian-api ${new Date().toISOString()}] ${parts.join(' ')}`;
  try { console.log(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}
function fail(...parts) {
  const line = `[bodian-api ${new Date().toISOString()}] FATAL ${parts.join(' ')}`;
  try { console.error(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

function preferredPort() {
  if (process.env.BODIAN_API_PORT) return Number(process.env.BODIAN_API_PORT) || 0;
  try {
    const prev = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    fs.unlinkSync(PORT_FILE);
    if (Number.isInteger(prev) && prev > 1024 && prev < 65536) return prev;
  } catch { /* 第一次跑 */ }
  return 3213;
}

const require = createRequire(import.meta.url);
let createBodianApi;
try {
  ({ createBodianApi } = require('bodian-music-api'));
} catch (e) {
  fail('加载 bodian-music-api 失败:', (e && e.stack) || e);
  fail('依赖装了吗？在 services/bodian-api 里跑 npm install');
  process.exit(1);
}

/* ---------------- 设备 ID（固定） ---------------- */
function loadDeviceId() {
  try {
    const raw = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
    if (raw && typeof raw.deviceId === 'string' && /^[0-9a-f]{32}$/i.test(raw.deviceId)) return raw.deviceId;
  } catch { /* 没有就生成 */ }
  const deviceId = crypto.randomBytes(16).toString('hex');
  try {
    fs.writeFileSync(DEVICE_FILE, JSON.stringify({ deviceId, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    log('生成了新的设备 ID .auth-device.json（删了 = 波点当新设备）');
  } catch (e) { log('设备 ID 写不进去：', e && e.message); }
  return deviceId;
}

/* ---------------- 会话落盘（库本身只在内存里存） ---------------- */
let current = null;
try {
  const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  if (raw && raw.token && raw.uid) current = raw;
} catch { /* 没登录过 */ }
let revision = 0;
const sessions = {
  get() { return current; },
  set(value) {
    current = value;
    revision++;
    try {
      fs.writeFileSync(SESSION_FILE, JSON.stringify(value, null, 2), { mode: 0o600 });
      log('登录态已落盘 .auth-session.json（uid=' + (value.uid || '?') + '）');
    } catch (e) { log('登录态写盘失败：', e && e.message); }
  },
  clear() {
    current = null;
    revision++;
    try { fs.unlinkSync(SESSION_FILE); } catch { /* 本来就没有 */ }
    log('登录态已清除');
  },
  get revision() { return revision; },
};

const api = createBodianApi({ deviceId: loadDeviceId(), sessions });

const call = (op, params = {}) => api.request(op, params);

function failBody(error) {
  const code = (error && error.code) || 'unavailable';
  const map = { 'auth-required': 401, 'region-restricted': 451, 'not-playable': 403, unavailable: 502, network: 502, 'invalid-response': 400, unsupported: 400 };
  return {
    code: map[code] || 502,
    ok: false,
    error: (error && error.message) || '波点接口失败',
    upstreamCode: (error && error.upstreamCode) || null,
    // 407 = 地区限制（波点播放只放行中国大陆网络）
    region: code === 'region-restricted',
  };
}

const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

async function handle(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === '/health' || p === '/') {
    return json(res, 200, {
      code: 200, ok: true,
      node: process.versions.node,
      loggedIn: !!current,
      uid: (current && current.uid) || null,
      nickname: (current && current.user && current.user.nickname) || '',
    });
  }

  if (p === '/status' || p === '/login/status') {
    const r = await call('login_status');
    if (!r.ok) return json(res, 200, { code: 200, loggedIn: !!current, error: r.error.message });
    const u = r.data || {};
    return json(res, 200, {
      code: 200, loggedIn: !!current,
      nickname: u.nickname || (current && current.user && current.user.nickname) || '',
      avatar: u.avatarUrl || '', uid: u.id || (current && current.uid) || '',
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
    return json(res, 200, { code: 200, qrimg: r.data.imageUrl || '' });
  }

  if (p === '/login/qr/check') {
    const key = q.get('key') || '';
    if (!key) return json(res, 400, { code: 400, error: 'key required' });
    const r = await call('login_qr_check', { key });
    if (!r.ok) return json(res, 200, { code: 500, error: failBody(r.error).error });
    const state = (r.data && r.data.state) || 'waiting';
    // 和 QQ/网易云同一套码：801 等待 / 802 待确认 / 803 成功 / 800 过期
    const MAP = { waiting: 801, scanned: 802, confirmed: 803, expired: 800 };
    const out = { code: MAP[state] || 801, state };
    if (state === 'confirmed') {
      out.loggedIn = true;
      out.nickname = (current && current.user && current.user.nickname) || '';
    }
    return json(res, 200, out);
  }

  if (p === '/login/qr/cancel') {
    await call('login_qr_cancel', { key: q.get('key') || '' });
    return json(res, 200, { code: 200 });
  }

  if (p === '/logout') {
    await call('logout');
    return json(res, 200, { code: 200, loggedIn: false });
  }

  if (p === '/search') {
    const query = (q.get('q') || q.get('keywords') || '').trim();
    if (!query) return json(res, 200, { code: 200, items: [], total: 0 });
    const r = await call('search', {
      query,
      limit: Math.min(100, Math.max(1, Number(q.get('limit')) || 20)),
      offset: Math.max(0, Number(q.get('offset')) || 0),
    });
    if (!r.ok) return json(res, 502, failBody(r.error));
    return json(res, 200, {
      code: 200,
      items: r.data.resultList || [],
      total: r.data.total || 0,
      hasMore: !!(r.data.bodianPagination && r.data.bodianPagination.hasMore),
      nextOffset: (r.data.bodianPagination && r.data.bodianPagination.nextOffset) || 0,
    });
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
    const r = await call('audio', { id, quality, freeSign: q.get('freeSign') === '1' });
    if (!r.ok) {
      const b = failBody(r.error);
      return json(res, 200, { code: 200, url: '', reason: r.error.code, region: b.region, error: b.error });
    }
    return json(res, 200, {
      code: 200,
      url: r.data.url,
      quality: r.data.quality,
      preview: !!r.data.preview,
      // 波点的试听是一段秒数区间 { startTime, endTime }，不是起点毫秒
      previewRange: r.data.preview || null,
    });
  }

  if (p === '/lyrics') {
    const id = q.get('id') || '';
    if (!id) return json(res, 400, { code: 400, error: 'id required' });
    const r = await call('lyrics', { id });
    if (!r.ok) return json(res, 200, { code: 200, lyric: '', error: r.error.message });
    return json(res, 200, { code: 200, lyric: r.data.mainText || '', wbw: r.data.wordByWordText || '' });
  }

  if (p === '/playlist/tracks') {
    const id = q.get('id') || '';
    if (!id) return json(res, 400, { code: 400, error: 'id required' });
    const params = {
      id,
      limit: Math.min(100, Math.max(1, Number(q.get('limit')) || 50)),
      offset: Math.max(0, Number(q.get('offset')) || 0),
    };
    // 歌单的 sourceType：自建/收藏一般是 4，红心歌单是 5；不传时库默认 4。
    const source = Number(q.get('source'));
    if ([1, 2, 3, 4, 5, 6].includes(source)) params.source = source;
    const r = await call('playlist_tracks', params);
    if (!r.ok) return json(res, 502, failBody(r.error));
    // 空歌单时上游只回分页对象（没有 songs/list 数组），这里统一成 []，
    // 否则主服务 (d.items || []).map 会拿到对象直接抛异常。
    const raw = r.data || {};
    const items = Array.isArray(raw.songs) ? raw.songs
      : Array.isArray(raw.list) ? raw.list
        : Array.isArray(raw) ? raw : [];
    return json(res, 200, { code: 200, items, more: !!(raw.bodianPagination && raw.bodianPagination.hasMore) });
  }

  /* ---------- 推荐 / 发现 / 账号曲库（2026-11-07 补的薄路由） ----------
     库暴露了 recommendations / home_module / ai_playlist_detail / personal_fm /
     user_playlists / liked_songs / playlist_detail / user_albums / artist_songs。
     推荐与私人 FM 匿名可用；user_* 和 liked_songs 需要扫码登录（库回 auth-required）。 */
  if (p === '/recommendations') {
    const r = await call('recommendations');
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    const lists = Array.isArray(r.data.lists) ? r.data.lists : [];
    const playlists = lists.flatMap((g) => (
      Array.isArray(g && g.playLists) ? g.playLists : (Array.isArray(g && g.list) ? g.list : [])
    ));
    return json(res, 200, { code: 200, lists, playlists });
  }

  if (p === '/home/module') {
    const r = await call('home_module', { moduleId: Number(q.get('moduleId')) || 1 });
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, { code: 200, module: r.data });
  }

  if (p === '/ai/playlist') {
    const r = await call('ai_playlist_detail', { index: Number(q.get('index')) || 0 });
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, {
      code: 200,
      title: r.data.title || '潮趣日推',
      subTitle: r.data.subTitle || '',
      tracks: r.data.musicList || [],
    });
  }

  if (p === '/personal/fm') {
    const r = await call('personal_fm');
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, { code: 200, tracks: r.data.musicList || [] });
  }

  if (p === '/user/playlists') {
    const r = await call('user_playlists');
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, { code: 200, owned: r.data.owned || null, liked: r.data.liked || null, collected: r.data.collected || null });
  }

  if (p === '/liked_songs' || p === '/liked-songs') {
    const r = await call('liked_songs');
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    const items = r.data.list || r.data.resultList || r.data.items || [];
    return json(res, 200, {
      code: 200,
      items,
      total: r.data.total || items.length,
      more: !!(r.data.bodianPagination && r.data.bodianPagination.hasMore),
    });
  }

  if (p === '/playlist/detail') {
    const id = q.get('id') || '';
    if (!id) return json(res, 400, { code: 400, error: 'id required' });
    const r = await call('playlist_detail', { id });
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, { code: 200, playlist: r.data });
  }

  if (p === '/user/albums') {
    const r = await call('user_albums');
    if (!r.ok) return json(res, failBody(r.error).code, failBody(r.error));
    return json(res, 200, { code: 200, data: r.data });
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
    return json(res, 200, { code: 200, items: r.data.resultList || r.data.list || [], total: r.data.total || 0 });
  }

  return json(res, 404, { code: 404, error: 'unknown bodian api: ' + p });
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
  console.log(`BODIAN_API_READY ${port}`);
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

const parentPid = Number(process.env.BODIAN_PARENT_PID || 0);
if (Number.isInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try { process.kill(parentPid, 0); }
    catch { log('父进程已退出，边车跟着收工'); process.exit(0); }
  }, 5000).unref();
}
