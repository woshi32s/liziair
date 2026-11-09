/**
 * LIZI · 酷狗音乐边车启动器
 *
 * 包 `kugoumusicapi`（GitHub MakcRe/KuGouMusicApi v1.6.0，MIT）是一个完整的 express 服务：
 * 它在 `startService()` 里自己 app.listen()。所以这里做的是「进它之前把环境摆好，出来之后接管句柄」，
 * 和 services/qq-api/start.mjs 同一套做法（端口优先级 / 只绑回环 / EPIPE / 盯父进程 / 失败要说原因）。
 *
 * 这个文件做五件事：
 *   1. 端口：KUGOU_API_PORT > 上次的 .port > 3211（避开 3200/3210 那两个和 Windows 保留段）
 *   2. 只绑 127.0.0.1：先给 net.Server.prototype.listen 打一次性补丁（host 缺省时补回环），
 *      再显式设 HOST=127.0.0.1（这个包读 HOST 环境变量，两条保险）
 *   3. 设备身份固定：KUGOU_API_GUID 存在 .auth-state/device.json 里。**删了就等于换一台设备**，
 *      酷狗对设备有注册次数限制，别每次启动都生成新的
 *   4. 登录态落盘：包只认 Cookie（token/userid/dfid…），这里不管存储 —— 由 server.mjs 的
 *      /api/kugou/* 代理把 Set-Cookie 写进 services/kugou-api/.auth-cookies.json 再回放
 *   5. 起不来时把原因打到控制台和 .log，不静默死
 *
 * 启动：node services/kugou-api/start.mjs     （平时由 server.mjs 按需 spawn）
 * 停止：关掉进程即可（Ctrl+C / 按端口找 PID），没有别的状态
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
const STATE_DIR = path.join(__dirname, '.auth-state');
const DEVICE_FILE = path.join(STATE_DIR, 'device.json');

try {
  if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
} catch { /* 第一次跑没有日志 */ }

/* ---------------- 日志：控制台 + 文件（server.mjs 把子进程输出也指到这里） ---------------- */
/* Node 20 的 console 在 stdout 被关掉时会直接抛 EPIPE（QQ 那边踩过），先挂上错误处理。 */
for (const stream of [process.stdout, process.stderr]) {
  try { stream.on('error', () => { /* 输出管道断了不影响服务 */ }); } catch { /* ignore */ }
}
function log(...parts) {
  const line = `[kugou-api ${new Date().toISOString()}] ${parts.join(' ')}`;
  try { console.log(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}
function fail(...parts) {
  const line = `[kugou-api ${new Date().toISOString()}] FATAL ${parts.join(' ')}`;
  try { console.error(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

/* ---------------- 端口：和主服务同一套规矩 ---------------- */
function preferredPort() {
  if (process.env.KUGOU_API_PORT) return Number(process.env.KUGOU_API_PORT) || 0;
  try {
    const prev = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    // 读完删掉：server.mjs 靠「文件出现」判断子进程是否就绪
    fs.unlinkSync(PORT_FILE);
    if (Number.isInteger(prev) && prev > 1024 && prev < 65536) return prev;
  } catch { /* 第一次跑 */ }
  return 3211;
}

/* ---------------- 设备身份：GUID 要稳定 ---------------- */
function deviceGuid() {
  if (process.env.KUGOU_API_GUID) return process.env.KUGOU_API_GUID;
  try {
    const saved = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
    if (saved && typeof saved.guid === 'string' && /^[0-9a-f]{32}$/i.test(saved.guid)) return saved.guid;
  } catch { /* 没有就生成 */ }
  const guid = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(DEVICE_FILE, JSON.stringify({ guid, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    log('生成了新的设备身份 .auth-state/device.json（删了 = 酷狗当新设备）');
  } catch (e) { log('设备身份写不进去：', e && e.message); }
  return guid;
}

/* ---------------- 强制回环绑定 ----------------
   包的 server.js 是 app.listen(port, host, cb)，host 来自 HOST 环境变量。
   我们显式设 HOST=127.0.0.1；这个补丁是第二道保险（host 缺省时会绑 0.0.0.0）。 */
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

/* ---------------- 环境：包在 require / listen 期就会读这些 ---------------- */
const wantPort = preferredPort();
process.env.PORT = String(wantPort);
process.env.HOST = '127.0.0.1';
process.env.KUGOU_API_GUID = deviceGuid();
// 设备名：登录检查（/v2/get_userinfo_qrcode）要带 dev，酷狗「登录设备」列表里才显示这个名字。
// 不固定的话包里每次启动随机生成一个，同一个 GUID 会冒出一堆怪名字。
if (!process.env.KUGOU_API_DEV) {
  process.env.KUGOU_API_DEV = ('LIZI' + process.env.KUGOU_API_GUID.slice(0, 8)).toUpperCase();
}
// .env 里 platform 留空时包里会写 `KUGOU_API_PLATFORM=undefined`，明确给个空串更干净
if (process.env.platform === undefined) process.env.platform = '';

const require = createRequire(import.meta.url);

/* ---------------- cookie 解析补丁（必须在 require('kugoumusicapi') 之前） ----------------
   主服务 server.mjs 的 kgCookie() 用 `'; '`（分号 + 空格）拼 Cookie，而包里
   util/util.js 的 cookieToJson 既不 trim、也不限制 split：
       'token=…; userid=123'  →  { token: '…', ' userid': '123' }
   userid 因此没被识别 → /user/detail 用 userid=0 请求 → 上游 error_code=20018
   → 主服务 /status 判定未登录 → 前端刚画上的「登录成功」立刻被刷回未登录
   （用户看到的「闪一下又变回未登录」就是这个）。
   server.js 在 require 时就把 cookieToJson 解构走了，所以只能抢在加载包之前替换。 */
try {
  const util = require(require.resolve('kugoumusicapi/util/util.js'));
  if (util && typeof util.cookieToJson === 'function') {
    util.cookieToJson = (cookie) => {
      if (!cookie) return {};
      if (typeof cookie !== 'string') return cookie; // 已经是对象就原样返回
      const out = {};
      for (const part of cookie.split(';')) {
        const s = part.trim();
        if (!s) continue;
        const i = s.indexOf('=');
        if (i <= 0) continue;
        out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
      }
      return out;
    };
  }
} catch (e) {
  log('cookie 解析补丁加载失败（登录态可能读不到 userid）：', e && e.message);
}

let startService;
try {
  ({ startService } = require('kugoumusicapi'));
} catch (e) {
  fail('加载 kugoumusicapi 失败:', (e && e.stack) || e);
  fail('依赖装了吗？在 services/kugou-api 里跑 npm install');
  process.exit(1);
}
if (typeof startService !== 'function') {
  fail('包里没有导出 startService（版本不匹配？本启动器按 1.6.0 写的）');
  process.exit(1);
}

/* ---------------- 扫码登录修正（在包注册路由之前替换它的三个 module） ----------------
   包 v1.6.0 有两个和我们实测/上游现象对不上的地方：
     1) /login/qr/key 明明已经返回了酷狗官方二维码图（内容带 `appid=…&qrcode=KEY`），
        /login/qr/create 却丢下它，自己拼了个 `…?qrcode=KEY`（**少了 appid**）再画一张。
        官方图才是 App 扫码认得的完整地址，这里直接用官方图。
     2) /login/qr/check 是 2 秒一次的轮询，可包里全局挂了 apicache('2 minutes')，
        同一个 key 的响应会被缓存住 —— 手机确认后桌面永远只读到上一次的 status=1。
        见 MoeKoeMusic#330 / #343（同一套酷狗接口，同样的坑）。
        缓存键是完整 URL，模块里改不了；所以在 HTTP server 的最前面给 /login/qr/*
        打上包自己认的 `x-apicache-bypass` 头（见下面的 prependListener）。
   替换方式：先 require 进 cache，再改 cache[...].exports；startService() 里的动态路由
   扫描 require 同一路径时会拿到替换后的函数。 */
function installLoginQrOverrides() {
  const pkgRoot = path.dirname(require.resolve('kugoumusicapi'));
  const cfg = require(path.join(pkgRoot, 'util', 'config.json'));
  const targetAppid = process.env.platform === 'lite' ? cfg.liteAppid : cfg.appid;
  const qrImages = new Map(); // key -> 酷狗官方二维码 dataURL（内存，最多 64 张）

  const remember = (key, img) => {
    if (!key || !img) return;
    qrImages.set(key, img);
    if (qrImages.size > 64) qrImages.delete(qrImages.keys().next().value);
  };
  const canonicalUrl = (key) =>
    `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${targetAppid}&qrcode=${encodeURIComponent(key)}`;

  const keyPath = require.resolve(path.join(pkgRoot, 'module', 'login_qr_key.js'));
  const createPath = require.resolve(path.join(pkgRoot, 'module', 'login_qr_create.js'));
  const checkPath = require.resolve(path.join(pkgRoot, 'module', 'login_qr_check.js'));

  /* key：保留原实现，只是顺手把官方二维码图记下来 */
  const originalKey = require(keyPath);
  require.cache[keyPath].exports = (params, useAxios) => {
    const p = originalKey(params, useAxios);
    if (!p || typeof p.then !== 'function') return p;
    return p.then((resp) => {
      const d = resp && resp.body && resp.body.data;
      remember(d && d.qrcode, d && d.qrcode_img);
      return resp;
    });
  };

  /* create：优先回酷狗给的那张图；没有（比如换了进程/过期）才按带 appid 的完整地址重画 */
  require(createPath);
  require.cache[createPath].exports = async (params) => {
    const key = String((params && params.key) || '').trim();
    let base64 = key ? qrImages.get(key) : '';
    if (!base64 && key) {
      try { base64 = await require('qrcode').toDataURL(canonicalUrl(key)); } catch { base64 = ''; }
    }
    return { code: 200, status: 200, body: { code: 200, data: { url: key ? canonicalUrl(key) : '', base64 } } };
  };

  /* check：和上游 master 对齐，带上 dev；成功时把 token/userid/vip 一起写进 Set-Cookie */
  require(checkPath);
  require.cache[checkPath].exports = (params, useAxios) => new Promise((resolve, reject) => {
    const cookie = (params && params.cookie) || {};
    useAxios({
      baseURL: 'https://login-user.kugou.com',
      url: '/v2/get_userinfo_qrcode',
      method: 'GET',
      params: {
        plat: 4,
        appid: targetAppid,
        srcappid: cfg.srcappid,
        qrcode: params && params.key,
        dev: cookie.KUGOU_API_DEV || process.env.KUGOU_API_DEV,
      },
      encryptType: 'web',
      cookie,
    }).then((resp) => {
      const d = resp && resp.body && resp.body.data;
      if (d && d.status == 4) {
        if (d.token) resp.cookie.push(`token=${d.token}`);
        if (d.userid) resp.cookie.push(`userid=${d.userid}`);
        if (d.vip_type != null) resp.cookie.push(`vip_type=${d.vip_type}`);
        if (d.vip_token) resp.cookie.push(`vip_token=${d.vip_token}`);
      }
      resolve(resp);
    }).catch(reject);
  });
}
installLoginQrOverrides();

/* ---------------- 就绪 / 失败 ---------------- */
let retried = false;

let readyDone = false;
function ready(server) {
  if (readyDone) return;
  readyDone = true;
  const addr = server && server.address ? server.address() : null;
  const port = addr && typeof addr === 'object' ? addr.port : wantPort;
  const host = addr && typeof addr === 'object' ? addr.address : '127.0.0.1';
  fs.writeFileSync(PORT_FILE, String(port));
  log(`就绪 http://${host}:${port}  （只绑回环；设备 ${process.env.KUGOU_API_GUID.slice(0, 8)}…）`);
  // 给父进程（server.mjs）一个明确的、可抓的信号
  console.log(`KUGOU_API_READY ${port}`);
}

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

/* 父进程（server.mjs）掉了就把自己也收掉，别留孤儿进程占端口。 */
const parentPid = Number(process.env.KUGOU_PARENT_PID || 0);
if (Number.isInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try { process.kill(parentPid, 0); }
    catch { log('父进程已退出，边车跟着收工'); process.exit(0); }
  }, 5000).unref();
}

/* ---------------- 起服务 ---------------- */
try {
  const app = await startService();
  const server = app && app.service;
  if (!server) {
    fail('startService() 没返回底层 http server（版本不匹配？）');
    process.exit(1);
  }
  /* 抢在 express 的 request 监听器之前：/login/qr/* 一律绕过包里 2 分钟的 apicache。
     check 是 2 秒一轮的短轮询，被缓存就会「手机已确认、桌面还停在等待」。 */
  try {
    if (typeof server.prependListener === 'function') {
      server.prependListener('request', (req) => {
        const u = req && req.url;
        if (u && (u === '/login/qr' || u.startsWith('/login/qr?') || u.startsWith('/login/qr/'))) {
          req.headers['x-apicache-bypass'] = '1';
        }
      });
    }
  } catch (e) { log('扫码防缓存补丁挂载失败（其它接口不受影响）：', e && e.message); }
  /* 这个包没有 /health，主服务要一个「本地、不碰酷狗」的活跃探针。
     express 的路由表是动态的，listen 之后挂也没问题。 */
  try {
    app.get('/lizi/health', (req, res) => res.json({ code: 200, ok: true, node: process.versions.node }));
  } catch (e) { log('挂 /lizi/health 失败（不影响接口）：', e && e.message); }
  server.on('error', (e) => {
    const code = e && e.code;
    if ((code === 'EADDRINUSE' || code === 'EACCES') && !retried) {
      retried = true;
      log(`端口 ${wantPort} 不可用（${code}，Windows 保留段/被占用），改用系统分配…`);
      try { server.close(); } catch { /* 可能根本没开 */ }
      setTimeout(() => {
        try { server.listen(0, '127.0.0.1', () => ready(server)); }
        catch (err) { fail('重试监听失败:', err && err.message); process.exit(1); }
      }, 80);
      return;
    }
    fail(`监听失败（${code || 'unknown'}）: ${e && e.message}`);
    fail('排查：netsh int ipv4 show excludedportrange protocol=tcp  看端口是否在保留段；或换 KUGOU_API_PORT');
    process.exit(1);
  });
  if (server.listening) ready(server);
  else server.once('listening', () => ready(server));
} catch (e) {
  fail('启动失败:', (e && e.stack) || e);
  process.exit(1);
}
