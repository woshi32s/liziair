/**
 * LIZI · QQ 音乐边车启动器
 *
 * 为什么需要这一层：`@yakult-green-tea/qq-music-api` 不是一个库，`require()` 的那一刻
 * 它就在 app.listen() 里开服务器了。所以想「换端口 / 只绑回环 / 抓住失败原因」，
 * 只能在 require 之前动手，在 require 之后接管 server 句柄。
 *
 * 这个文件做四件事：
 *   1. 端口：QQ_API_PORT > 上次的 .port > 3210（默认避开 Windows 保留段里的 3200）
 *   2. 只绑 127.0.0.1（包的 app.listen 只传了端口，没传 host，默认是 0.0.0.0）
 *   3. 登录态加密落盘（QQ_AUTH_SESSION_PATH + QQ_SESSION_SECRET），重启边车不用重新扫码
 *   4. 起不来时把原因打到控制台和 .log 里，不静默死
 *
 * 启动：node services/qq-api/start.mjs        （通常由 server.mjs 按需 spawn）
 * 停止：关掉这个进程即可（Ctrl+C / taskkill），没有别的状态
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_FILE = path.join(__dirname, '.port');
const LOG_FILE = path.join(__dirname, '.log');
const SECRET_FILE = path.join(__dirname, '.auth-secret');
const SESSION_FILE = path.join(__dirname, '.auth-session.json');

/* 日志超过 2MB 就换一个（边车会跟着主服务长期跑，不能无限长） */
try {
  if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) {
    fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  }
} catch { /* 第一次跑没有日志 */ }

/* ---------------- 日志：控制台 + 文件（server.mjs 把子进程输出也指到这里） ---------------- */
/* Node 20 的 console 在 stdout 管被关掉时会**直接抛 EPIPE**（Node 24 才吞掉）。
   实测：用管道起边车、父进程一收工，一条日志就把整个服务打死。
   所以先给 stdout/stderr 挂上错误处理，写日志本身也包在 try 里。 */
for (const stream of [process.stdout, process.stderr]) {
  try { stream.on('error', () => { /* EPIPE 之类的输出错误忽略 */ }); } catch { /* ignore */ }
}

function log(...parts) {
  const line = `[qq-api ${new Date().toISOString()}] ${parts.join(' ')}`;
  try { console.log(line); } catch { /* 输出没了不影响服务 */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* 日志写不进去不能拖垮服务 */ }
}
function fail(...parts) {
  const line = `[qq-api ${new Date().toISOString()}] FATAL ${parts.join(' ')}`;
  try { console.error(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

/* ---------------- 端口：和主服务的 preferredPort() 同一套规矩 ---------------- */
function preferredPort() {
  if (process.env.QQ_API_PORT) return Number(process.env.QQ_API_PORT) || 0;
  try {
    const prev = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    // 读完删掉：server.mjs 靠「文件出现」判断子进程是否就绪，
    // 留着上一轮的旧端口会让它以为服务已经起来了。
    fs.unlinkSync(PORT_FILE);
    if (Number.isInteger(prev) && prev > 1024 && prev < 65536) return prev;
  } catch { /* 第一次跑，没有 .port */ }
  return 3210;
}

/* ---------------- 登录态落盘：密钥只生成一次，否则旧文件永远解不开 ---------------- */
function sessionSecret() {
  if (process.env.QQ_SESSION_SECRET) return process.env.QQ_SESSION_SECRET;
  try {
    const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch { /* 没有就生成 */ }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  log('生成了新的会话密钥 .auth-secret（登录态加密用，删了就要重新扫码）');
  return secret;
}

/* ---------------- 强制回环绑定 ----------------
   包里是 `app.listen(port, cb)`，host 缺省 = 0.0.0.0（局域网可访问）。
   我们只允许本机访问，所以在 require 之前把「第一次 listen」补上 127.0.0.1。
   只改第一次：后面我们自己的重试会显式传 host。 */
const originalListen = net.Server.prototype.listen;
let patched = false;
net.Server.prototype.listen = function liziListen(...args) {
  if (!patched) {
    patched = true;
    const portOnly =
      (typeof args[0] === 'number') ||
      (typeof args[0] === 'string' && /^\d+$/.test(args[0]));
    if (portOnly && (args.length === 1 || typeof args[1] === 'function')) {
      args = [Number(args[0]), '127.0.0.1', ...args.slice(1)];
    }
  }
  return originalListen.apply(this, args);
};

/* ---------------- 环境：包在 require 期就会读这些 ---------------- */
const wantPort = preferredPort();
process.env.PORT = String(wantPort);
process.env.QQ_DISABLE_UPDATE_CHECK = 'true';   // 不在 require 期 spawn npm info
delete process.env.AUTO_OPEN_EXPLORER;          // 不要弹浏览器
process.env.QQ_AUTH_SESSION_PATH = SESSION_FILE;
process.env.QQ_SESSION_SECRET = sessionSecret();

let pkg;
try {
  const require = createRequire(import.meta.url);
  pkg = require('@yakult-green-tea/qq-music-api');
} catch (e) {
  fail('加载 @yakult-green-tea/qq-music-api 失败:', e && e.stack || e);
  fail('依赖装了吗？在 services/qq-api 里跑 npm install');
  process.exit(1);
}

const server = pkg && pkg.server;
if (!server) {
  fail('包里没有导出 server 句柄（版本不匹配？本启动器按 3.3.5 写的）');
  process.exit(1);
}

/* ---------------- 失效会话的「只读头像」----------------
   `/login/status` 在上游 401 时会故意回「未登录」，但那枚 qqmusic_session 里
   仍然封着上次登录时保存的 credential（nick/logo/musicid）。这里只把其中的
   公开身份字段解出来，绝不返回 musickey / token，也不把 loggedIn 改成 true。
   包没有导出登录服务，所以按主入口所在目录直连它自己的会话模块。 */
const pkgRequire = createRequire(import.meta.url);
let sessionStoreMod = null;
let storedResolverMod = null;
try {
  const entry = pkgRequire.resolve('@yakult-green-tea/qq-music-api');
  const pkgSrc = path.dirname(entry);
  sessionStoreMod = pkgRequire(path.join(pkgSrc, 'services/auth/fileAuthSessionRepository.js'));
  storedResolverMod = pkgRequire(path.join(pkgSrc, 'services/auth/sessionState.js'));
} catch (e) {
  log('读取会话模块失败（失效会话头像将不可用）：', (e && e.message) || e);
}

function sessionToken(req) {
  const cookie = String((req && req.headers && req.headers.cookie) || '');
  for (const entry of cookie.split(';')) {
    const i = entry.indexOf('=');
    if (i > 0 && entry.slice(0, i).trim() === 'qqmusic_session') return entry.slice(i + 1).trim();
  }
  const header = String((req && req.headers && req.headers['x-qq-session']) || '').trim();
  return header;
}

async function cachedProfile(req) {
  if (!sessionStoreMod || !storedResolverMod || !process.env.QQ_SESSION_SECRET) return null;
  const token = sessionToken(req);
  if (!token) return null;
  // 每次现建：登录可能发生在启动之后，文件里才是最新一份会话。
  const repository = sessionStoreMod.createFileAuthSessionRepository(SESSION_FILE, process.env.QQ_SESSION_SECRET);
  const resolver = storedResolverMod.createStoredSessionResolver({
    repository,
    now: () => 0,
    randomBytes: crypto.randomBytes,
    // 不传 refreshCredential：这里只读本地凭据，不改写、不碰上游。
  });
  /* now 固定成 0 是刻意的：库的 store.restore()/cleanup() 会把 expiresAt 已过的会话
     删掉并回写文件。我们只读地取一次头像，如果跟真实时钟走，第一次为「失效会话」取头像
     就会把这份旧凭据清掉。没有 refreshCredential，resolve() 不会改写任何东西。 */
  const session = await resolver.resolve(token);
  const c = session && session.credential;
  if (!c) return null;
  const uid = String(c.str_musicid || c.musicid || '');
  const logo = String(c.logo || c.avatarUrl || '');
  return {
    uid,
    nickname: String(c.nick || c.nickname || ''),
    // 上游默认头像 / 非绝对地址都不算「账号头像」：宁可没有，也不拿默认图充数。
    avatar: /^https?:\/\//.test(logo) && !/t_user_default/i.test(logo) ? logo : '',
  };
}

/* 公开主页兜底：uin → 公开歌单 → 歌单详情里的作者 headurl。
   两步都不需要登录（2026-11 实测，QQ 号与 19 位 musicid 都可用）。 */
async function publicAvatarByUin(uid) {
  if (!/^[1-9]\d{0,19}$/.test(uid)) return '';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    Referer: 'https://y.qq.com/',
  };
  const getJson = async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch(url, { headers, signal: ctrl.signal });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
    finally { clearTimeout(timer); }
  };
  try {
    const list = await getJson('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=' + encodeURIComponent(uid)
      + '&sin=0&size=5&format=json&inCharset=utf8&outCharset=utf-8&g_tk=5381&loginUin=0&hostUin=0&platform=yqq.json&needNewCode=0');
    const tids = ((list && list.data && list.data.disslist) || [])
      .map((x) => Number(x && x.tid)).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 2);
    for (const tid of tids) {
      const cd = await getJson('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid='
        + tid + '&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0');
      const creator = cd && cd.cdlist && cd.cdlist[0];
      const avatar = String((creator && (creator.headurl || creator.avatar)) || '');
      // 没有自定义头像的账号会拿到上游默认图；这不是「账号头像」，宁可空着。
      if (/^https?:\/\//.test(avatar) && !/t_user_default/i.test(avatar)) return avatar;
    }
  } catch { /* 拿不到就不给头像，不编 */ }
  return '';
}

/* 包在 require 期就 app.listen() 了，Koa 的 compose 拿到的是 middleware 数组的
   同一个引用；这里 unshift 到栈首，保证不依赖包内路由是否对未知路径调 next()。 */
const qqApp = pkg && pkg.default;
if (qqApp && Array.isArray(qqApp.middleware)) {
  qqApp.middleware.unshift(async (ctx, next) => {
    if (ctx.path !== '/lizi/cached-profile') return next();
    let out = null;
    try { out = await cachedProfile(ctx.req); } catch (e) { log('读取失效会话失败：', (e && e.message) || e); }
    ctx.type = 'application/json';
    if (!out) { ctx.body = { code: 200, empty: true }; return; }
    if (!out.avatar) {
      try { out.avatar = await publicAvatarByUin(out.uid); } catch { /* 允许为空 */ }
    }
    ctx.body = { code: 200, ...out };
  });
} else {
  log('没能挂上 /lizi/cached-profile（app.middleware 不可用，版本不匹配？）');
}

/* ---------------- 有效登录态的账号头像 ----------------
   上游 `music.UserInfo.userInfoServer/GetLoginUserInfo` 把头像放在 `profile.info.logo`
   （实测本机微信登录账号是 https://thirdwx.qlogo.cn/…/132，200 image/jpeg），
   而主服务 /api/qq/status 读的是 profile 顶层的 headpic/avatarUrl/avatar。
   这里在边车把嵌套字段摊平：主服务不重启也能立刻拿到真头像；主服务重启后
   自己也会读 info.logo（见 server.mjs 的 qqProfileAvatar）。
   注意：uin 头像模板（q1.qlogo.cn/g?b=qq&nk=…）实测和音乐头像不是同一张图，
   不用它兜底。 */
if (qqApp && Array.isArray(qqApp.middleware)) {
  qqApp.middleware.unshift(async (ctx, next) => {
    await next();
    if (ctx.path !== '/login/status' && ctx.path !== '/user/detail') return;
    const body = ctx.body;
    if (!body || typeof body !== 'object') return;
    const profile = (body.data && body.data.profile) || body.profile;
    if (!profile || typeof profile !== 'object') return;
    const info = profile.info && typeof profile.info === 'object' ? profile.info : null;
    if (!info) return;
    const logo = typeof info.logo === 'string' ? info.logo.trim() : '';
    if (/^https?:\/\//i.test(logo) && !/t_user_default/i.test(logo)) {
      if (!profile.avatarUrl) profile.avatarUrl = logo;
      if (!profile.headpic) profile.headpic = logo;
    }
    if (!profile.nick && !profile.nickname && typeof info.nick === 'string' && info.nick) {
      profile.nick = info.nick;
    }
  });
} else {
  log('没能挂上有效登录头像摊平（app.middleware 不可用，版本不匹配？）');
}

/* ---------------- 就绪 / 失败 ---------------- */
let retried = false;

function ready() {
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : wantPort;
  const host = addr && typeof addr === 'object' ? addr.address : '127.0.0.1';
  fs.writeFileSync(PORT_FILE, String(port));
  log(`就绪 http://${host}:${port}  （只绑回环；登录态文件 ${path.basename(SESSION_FILE)}）`);
  // 给父进程（server.mjs）一个明确的、可抓的信号
  console.log(`QQ_API_READY ${port}`);
}

server.on('listening', ready);

server.on('error', (e) => {
  const code = e && e.code;
  if ((code === 'EADDRINUSE' || code === 'EACCES') && !retried) {
    retried = true;
    log(`端口 ${wantPort} 不可用（${code}，Windows 保留段/被占用），改用系统分配…`);
    try { server.close(); } catch { /* 可能根本没开 */ }
    setTimeout(() => {
      try { server.listen(0, '127.0.0.1'); } catch (err) { fail('重试监听失败:', err && err.message); process.exit(1); }
    }, 80);
    return;
  }
  fail(`监听失败（${code || 'unknown'}）: ${e && e.message}`);
  fail('排查：netsh int ipv4 show excludedportrange protocol=tcp  看端口是否在保留段；或换 QQ_API_PORT');
  process.exit(1);
});

process.on('uncaughtException', (e) => {
  // 输出管道断了不是服务出错（Node 20 会把 console.log 的 EPIPE 抛上来）
  if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) return;
  fail('未捕获异常:', e && e.stack || e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) return;
  fail('未处理的 Promise 拒绝:', e && e.stack || e);
  process.exit(1);
});

/* 父进程（server.mjs）掉了就把自己也收掉，别留孤儿进程占端口。
   不看 stdin（被 spawn 时它可能是 ignore / 已关闭，会误判成父进程没了），
   改成盯父进程 pid：server.mjs 会带 QQ_PARENT_PID 过来。手动起的时候不设，也就不盯。 */
const parentPid = Number(process.env.QQ_PARENT_PID || 0);
if (Number.isInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      log('父进程已退出，边车跟着收工');
      process.exit(0);
    }
  }, 5000).unref();
}
