/**
 * 网易云音乐 · 液态玻璃播放器 —— 零依赖服务端
 *
 * 只做三件事：
 *   1) 转发网易云 weapi（把明文参数加密成 CSRFToken + params，再带 cookie 发出去）
 *   2) 管住登录态：二维码登录 / 手机号登录 / 刷新 / 登出，cookie 落盘到 .session.json
 *   3) 把 public/ 当静态目录发出去
 *
 * 为什么必须有服务端：浏览器的 CORS 不允许直接打 music.163.com，
 * 而且 weapi 需要 RSA + AES 加密和 cookie 会话，浏览器里做不了。
 *
 * 启动： node server.mjs    （或双击 start.cmd）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
/* 扫码收尾的纯逻辑放在边车目录里（那边是登录专项的地盘），这里只注入真实 I/O */
import { parseCookieInput, extractCookie, harvest } from './services/netease-api/harvest-core.mjs';
/* Wallpaper Engine 壁纸接口（658 形态 iframe 同源调用，见 wallpaper-api.mjs） */
import { handleWallpaper } from './wallpaper-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_FILE = path.join(__dirname, '.session.json');
/* 创意网站目录（200 个自包含视觉实验）。
   不拷贝、不修改原文件 —— 直接按原路径只读提供，
   这样你在原目录里继续改，播放器永远放的是最新的。 */
const CREATIVE_DIR = process.env.CREATIVE_DIR || 'E:\\proiects\\OPode\\creative-100';
/* 端口：优先沿用上次的，让 URL 在重启后保持不变。
   每次重启都换端口的话，浏览器里开着的那个标签页就指向了一个死端口 ——
   表现就是"突然播不了音乐了"，其实是服务换地方了。
   端口被占用（或落在 Windows 保留段里）才退回系统分配。 */
function preferredPort() {
  if (process.env.PORT) return Number(process.env.PORT);
  const f = path.join(__dirname, '.port');
  try {
    const prev = Number(fs.readFileSync(f, 'utf8').trim());
    // 读完立刻删掉：start.cmd 靠"文件出现"判断服务起没起来，
    // 留着旧的它会以为服务已经就绪，直接打开一个还没起来的地址。
    fs.unlinkSync(f);
    if (Number.isInteger(prev) && prev > 1024 && prev < 65536) return prev;
  } catch { /* 没有 .port，第一次跑 */ }
  return 0;
}
let PORT = preferredPort();

/* ==========================================================================
   weapi 加密（复刻 NeteaseCloudMusicApi 的两段式：AES-CBC → RSA）
   ========================================================================== */
const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';
const PUB_KEY = '010001';
const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const aesEncrypt = (text, key) => {
  const c = crypto.createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
};

/** 随机 16 位密钥：AES 加密后要再做一次「倒序」才是服务端认的 secretKey */
const randomKey = () =>
  Array.from({ length: 16 }, () => BASE62[Math.floor(Math.random() * 62)]).join('');

/** 模幂：BigInt 没有内置 pow(mod)，手写平方-乘。指数 65537 只有 2 个置位，很快。 */
function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

const rsaEncrypt = (text) => {
  const reversed = Buffer.from(text.split('').reverse().join(''), 'utf8').toString('hex');
  return modPow(BigInt('0x' + reversed), BigInt('0x' + PUB_KEY), BigInt('0x' + MODULUS))
    .toString(16)
    .padStart(256, '0');
};

function weapi(object) {
  const text = JSON.stringify(object);
  const key = randomKey();
  return {
    params: aesEncrypt(aesEncrypt(text, PRESET_KEY), key),
    encSecKey: rsaEncrypt(key),
  };
}

/* ==========================================================================
   eapi 加密（只给登录扫码两条路用，见 ROUTES 里的 channel）
   --------------------------------------------------------------------------
   为什么要它：weapi 那条扫码路被上游回 8821「请切换其他登录方式或升级新版本
   再试」—— 这是上游按客户端版本/形态做的拒绝，不是我们的状态机问题。
   eapi 是 App/PC 客户端在用的那条：对称加密（AES-128-ECB，固定 key），
   请求里带 `header`（os/appver/deviceId…），上游据此把我们当 PC 客户端 8.9.70。
   ========================================================================== */
const EAPI_KEY = Buffer.from('e82ckenh8dichen8');   // eapi 固定对称密钥（不是 weapi 那套 RSA）
const EAPI_SEP = '-36cd479b6b5-';                   // 明文分隔符，两段都用同一个
const EAPI_DEVICE_ID = crypto.randomBytes(16).toString('hex').toUpperCase();

/** 上游判断「你是什么客户端」主要看这个 header。8821 就是它嫌客户端旧，
 *  所以 os=pc + appver=8.9.70 是这条通道的关键，不是装饰。 */
function eapiHeader() {
  return {
    osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
    deviceId: EAPI_DEVICE_ID,
    appver: '8.9.70',
    versioncode: '140',
    mobilename: '',
    buildver: String(Date.now()).slice(0, 10),
    resolution: '1920x1080',
    __csrf: cookies.__csrf || '',
    os: 'pc',
    channel: 'netease',
    requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
  };
}

/** params = HEX_大写( AES-128-ECB( `<apiPath>-36cd479b6b5-<json>-36cd479b6b5-<md5>` ) )
 *  md5 的原文是 `nobody<apiPath>use<json>md5forencrypt`；
 *  注意 apiPath 用 /api/... 形式（请求却打到 /eapi/...），这是这套加密的约定。 */
function eapi(apiPath, object) {
  const text = JSON.stringify({ ...object, header: eapiHeader() });
  const digest = crypto.createHash('md5').update(`nobody${apiPath}use${text}md5forencrypt`, 'utf8').digest('hex');
  const cipher = crypto.createCipheriv('aes-128-ecb', EAPI_KEY, null);
  const hex = Buffer.concat([
    cipher.update(Buffer.from(`${apiPath}${EAPI_SEP}${text}${EAPI_SEP}${digest}`, 'utf8')),
    cipher.final(),
  ])
    .toString('hex')
    .toUpperCase();
  return { params: hex };
}

async function eapiRequest(apiPath, payload = {}) {
  /* 加密/签名里的路径必须是 /api/... 形式，实际请求打到 /eapi/...（这就是 eapi 的约定）。
     apiPath 传进来是 ROUTES 里的 weapi 写法（/login/qrcode/...），这里补齐前缀。 */
  const signedPath = apiPath.startsWith('/api') ? apiPath : '/api' + apiPath;
  const body = new URLSearchParams(eapi(signedPath, payload)).toString();

  const res = await fetchUpstream('https://music.163.com/eapi' + apiPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://music.163.com',
      Origin: 'https://music.163.com',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Cookie: cookieHeader(),
      /* 故意不带 weapi 那两条 X-Real-IP / X-Forwarded-For：
         扫码 key 是在这台机器上建的，确认却发生在用户手机上。
         伪造一个外地 IP（118.88.88.88）会让「建 key 的 IP」和「确认的 IP」
         对不上 —— 这正是风控在扫完之后才翻脸（8821）的典型触发点。
         实测去掉它 unikey / check 仍然稳定 801。 */
    },
    body,
  });

  saveCookies(res.headers.getSetCookie?.() || []);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { code: 500, raw: text.slice(0, 500) }; }
}

/* ==========================================================================
   会话：cookie 落盘，重启后仍然是登录态
   ========================================================================== */
let cookies = {};
try {
  if (fs.existsSync(SESSION_FILE)) cookies = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
} catch { cookies = {}; }

/* --------------------------------------------------------------------------
   设备指纹（eapi 必需）
   eapi 请求体里的 header 是这么拼的（包内 util/request.js）：
     { osver, deviceId, os, appver, versioncode, mobilename, buildver, resolution, __csrf, channel, requestId }
   —— 全部取自 cookie。我们的 cookie 里一条设备信息都没有，结果发出去的 header 里
   **没有 deviceId**，而 os 却是 "pc"。一个 PC 客户端不带设备 ID 是不可能的，
   网易云直接判「检测到当前设备环境异常，本次操作已经拦截」（扫码确认那一步）。
   这里持久化一份固定设备（每个安装一个 UUID），随 cookie 一起发出去。
   -------------------------------------------------------------------------- */
const DEVICE_FILE = path.join(__dirname, '.netease-device.json');
let deviceCache = null;
function deviceCookie() {
  if (deviceCache) return deviceCache;
  const base = {
    os: 'pc',
    osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
    appver: '3.1.17.204416',
    versioncode: '140',
    mobilename: '',
    resolution: '1920x1080',
    channel: 'netease',
    deviceId: '',
  };
  try { Object.assign(base, JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'))); } catch { /* 第一次跑，没有文件 */ }
  if (!base.deviceId) {
    base.deviceId = (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')).toUpperCase();
  }
  try { fs.writeFileSync(DEVICE_FILE, JSON.stringify(base, null, 2)); } catch { /* 只读目录也不致命 */ }
  deviceCache = base;
  return deviceCache;
}

/** PC 版客户端 UA —— 必须和 cookie 里的 os=pc / appver 对得上，
 *  否则「设备说自己是 Windows、UA 说自己是 iPhone」，一样被判异常。 */
const NETEASE_UA = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.1.17.204416';

const cookieHeader = () => {
  const jar = Object.entries(cookies).map(([k, v]) => `${k}=${v}`);
  const d = deviceCookie();
  for (const [k, v] of Object.entries(d)) if (cookies[k] === undefined) jar.push(`${k}=${v}`);
  return jar.join('; ');
};

function saveCookies(setCookie) {
  if (!setCookie) return;
  for (const line of setCookie) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (v === '' || v === '""') delete cookies[k];
    else cookies[k] = v;
  }
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
}

/* ==========================================================================
   转发到网易云
   ========================================================================== */
/** 服务端时区必须按东八区算，否则登录接口会因为时间偏差拒绝 */
function gmt8Timestamp() {
  const d = new Date();
  return new Date(d.getTime() + (480 + d.getTimezoneOffset()) * 60000)
    .toISOString().replace('T', ' ').slice(0, 19);
}

/* 把上游响应体安全地转给客户端。
   ------------------------------------------------------------------
   为什么不能用裸的 `Readable.fromWeb(upstream.body).pipe(res)`：

   音频流是从网易云/QQ 边下边转的，用户听到一半关掉播放器、切歌、
   或者上游网络抖动，都会让上游 socket 半路断开。此时 undici 的
   Readable 会 emit 一个 'error'，而这个错误发生在 try/catch 已经
   返回之后（pipe 是异步的），没人接 —— Node 直接把它当未捕获
   异常，**整个进程退出**。

   实测崩溃堆栈：
     TypeError: terminated
       [cause]: SocketError: other side closed  (bytesRead: 8831829)

   这里把三个方向的失败都吃掉：
     - 上游读失败  → 结束响应，记一行日志
     - 客户端断开  → 取消上游读取，不当作错误
     - 都正常      → 正常 end
   ------------------------------------------------------------------ */
function pipeUpstream(upstream, res, label = 'stream') {
  const src = Readable.fromWeb(upstream.body);
  let done = false;
  const bail = (why) => {
    if (done) return;
    done = true;
    if (why) console.warn(`[${label}] 流中断：${why}`);
    try { src.destroy(); } catch { /* 忽略 */ }
    try { if (!res.writableEnded) res.end(); } catch { /* 忽略 */ }
  };

  src.on('error', (e) => bail(e && (e.message || String(e))));
  res.on('error', (e) => bail(e && (e.message || String(e))));
  // 客户端主动断开（切歌/关窗口）：常态，不要喊
  res.on('close', () => { if (!done) { done = true; try { src.destroy(); } catch { /* 忽略 */ } } });

  src.pipe(res);
}

/* 到网易云的连接偶尔会连不上（实测过 UND_ERR_CONNECT_TIMEOUT，冷连接要 3~5 秒），
   一次失败就整个接口 502，表现就是"突然播不了音乐"。
   所以带超时 + 重试：连不上就再试两次，每次给足 15 秒。 */
async function fetchUpstream(url, init = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

async function weapiRequest(apiPath, payload = {}) {
  const data = weapi({ ...payload, csrf_token: cookies.__csrf || '' });
  const body = new URLSearchParams({ ...data, csrf_token: cookies.__csrf || '' }).toString();

  const res = await fetchUpstream('https://music.163.com/weapi' + apiPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://music.163.com',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Cookie: cookieHeader(),
      'X-Real-IP': '118.88.88.88',
      'X-Forwarded-For': '118.88.88.88',
    },
    body,
  });

  saveCookies(res.headers.getSetCookie?.() || []);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { code: 500, raw: text.slice(0, 500) }; }
}

/* ==========================================================================
   HTTP 服务
   ========================================================================== */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  /* 字体：形态里的 @font-face 过去一直被当成 application/octet-stream 发出。
     浏览器对字体 MIME 的检查比脚本宽松，但 Chromium 在部分版本会拒收
     "Failed to decode downloaded font"；显式给出 font/* 最稳。 */
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const json = (res, code, data) => {
  const buf = Buffer.from(JSON.stringify(data));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
};

/* --------------------------------------------------------------------------
   注入到每个创意站点的桥接脚本
   播放器 → 作品：节拍、BPM、能量、频谱、主色、播放状态
   作品 → 播放器：运行报错（这样一个作品崩了不会静默失败）
   作品不监听也完全照常工作，是纯可选增强。
   -------------------------------------------------------------------------- */
const BRIDGE_TAG = `<script>/* c100-live bridge */
(function(){
  var live = { bpm:0, beat:0, level:0, bass:0, mid:0, treble:0, accent:null, playing:false, spectrum:null };
  window.C100LIVE = live;
  window.addEventListener('message', function(e){
    var d = e.data;
    if (!d || d.__c100 !== 1) return;
    if (d.type === 'live') {
      var b = d.payload || {};
      live.bpm=b.bpm||0; live.level=b.level||0; live.bass=b.bass||0;
      live.mid=b.mid||0; live.treble=b.treble||0; live.playing=!!b.playing;
      if (b.accent) live.accent = b.accent;
      if (b.spectrum) live.spectrum = b.spectrum;
      window.dispatchEvent(new CustomEvent('c100live', { detail: live }));
    } else if (d.type === 'beat') {
      live.beat++;
      window.dispatchEvent(new CustomEvent('c100beat', { detail: d.payload || {} }));
    }
  });
  // 静音：作品里的 AudioContext 一律走 gain=0，避免和播放器的音乐打架
  if (window.__C100_SILENT && window.AudioContext) {
    var Orig = window.AudioContext;
    window.AudioContext = function(){
      var c = new Orig();
      var g = c.createGain(); g.gain.value = 0;
      var cd = c.createGain(); cd.gain.value = 0;
      c.__silentGain = g;
      var origDest = c.destination;
      try { Object.defineProperty(c, 'destination', { get: function(){ return g; } }); } catch(_) {}
      g.connect(origDest);
      return c;
    };
    window.AudioContext.prototype = Orig.prototype;
    window.webkitAudioContext = window.AudioContext;
  }
  window.addEventListener('error', function(e){
    try { parent.postMessage({ __c100:1, type:'error', payload:{ message:String(e.message), file:String(e.filename||''), line:e.lineno } }, '*'); } catch(_) {}
  });
})();
</script>`;

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });

/** 图片走这里代理：网易云的封面有防盗链，且 <img referrerpolicy> 不好控 */
const IMAGE_HOSTS = new Set(['p1.music.126.net', 'p2.music.126.net', 'p3.music.126.net', 'p4.music.126.net', 'p5.music.126.net', 'p6.music.126.net', 'y.gtimg.cn', 'music-file.y.qq.com', 'qpic.y.qq.com', 'i.scdn.co']);
/* 后面接的几个音源封面域名很多（酷狗 imge.kugou.com、汽水 p3-luna.douyinpic.com、
   波点 ali/kuwo CDN），一个个列不现实，按后缀放行 */
const IMAGE_HOST_SUFFIX = ['.kugou.com', '.douyinpic.com', '.douyincdn.com', '.huoshanimg.com', '.kuwo.cn', '.scdn.co', '.spotifycdn.com',
  // QQ 音乐头像：pic6.y.qq.com/qqmusic/avatar/…、y.gtimg.cn/…、微信/QQ 的 thirdwx.qlogo.cn
  '.y.qq.com', '.qlogo.cn', '.qpic.cn'];
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

async function proxyImage(res, rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return json(res, 400, { error: 'bad url' }); }
  const hostOk = (x) => IMAGE_HOSTS.has(x.hostname) || IMAGE_HOST_SUFFIX.some((s) => x.hostname.endsWith(s));
  if (!hostOk(u)) return json(res, 403, { error: 'host not allowed' });
  try {
    const upstream = await fetch(u, {
      headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20000),
    });
    /* 跟随重定向后再校验一次：白名单 URL 不能 302 到任意主机 */
    let finalUrl = u;
    try { finalUrl = new URL(upstream.url || u.href); } catch { /* 保持原地址 */ }
    if (!hostOk(finalUrl)) return json(res, 403, { error: 'redirect host not allowed' });
    const type = String(upstream.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/')) return json(res, 415, { error: 'not an image' });
    const declared = Number(upstream.headers.get('content-length') || 0);
    if (declared > IMAGE_MAX_BYTES) return json(res, 413, { error: 'image too large' });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > IMAGE_MAX_BYTES) return json(res, 413, { error: 'image too large' });
    res.writeHead(upstream.status, {
      'Content-Type': type || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(buf);
  } catch (e) {
    json(res, 502, { error: String(e.message) });
  }
}

/* ==========================================================================
   QQ 音乐边车（services/qq-api/）
   --------------------------------------------------------------------------
   为什么是「边车」而不是依赖：根 package.json 是零运行时依赖，QQ 那套要实现协议、
   要 MQTT，体积和风险都该隔离。它在自己的目录里带 package.json + node_modules，
   只跟自己人说话。

   这一层的全部职责：
     1) 按需拉起（第一次 /api/qq/* 才 spawn，之后复用；进程死了下次请求自动重起）
     2) 端口从 services/qq-api/.port 读 —— 边车自己写完才写文件，主服务不猜
     3) 把边车的形状整理成前端只认的那一种：{ code, ... }（和网易云那套一致）
     4) 转发 cookie（边车用 qqmusic_session 这个 httpOnly cookie 记登录态）

   注意：QQ 的接口和网易云完全两套，字段名、分页、播放地址形状都不一样，
   所以这里是**翻译层**，不是透明转发。
   ========================================================================== */
const QQ_DIR = path.join(__dirname, 'services', 'qq-api');
const QQ_ENTRY = path.join(QQ_DIR, 'start.mjs');
const QQ_PORT_FILE = path.join(QQ_DIR, '.port');
const QQ_LOG_FILE = path.join(QQ_DIR, '.log');

let qqChild = null;
let qqStarting = null;          // 并发请求共用同一次拉起

/* 搜索短缓存：QQ 对匿名搜索限流（连续请求会一直回 2001），一分钟内同样的词直接复用 */
const qqSearchCache = new Map();
const QQ_SEARCH_TTL = 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 边车自己写的实际端口。读不到/不合法就是 0 */
function qqPortFromFile() {
  try {
    const n = Number(fs.readFileSync(QQ_PORT_FILE, 'utf8').trim());
    return Number.isInteger(n) && n > 1024 && n < 65536 ? n : 0;
  } catch { return 0; }
}

/** 失败时把最后几行边车日志带出来 —— 不然「502」等于什么都没说 */
function qqLogTail(n = 14) {
  try {
    const lines = fs.readFileSync(QQ_LOG_FILE, 'utf8').trim().split('\n');
    return lines.slice(-n).join('\n');
  } catch { return '(还没有日志)'; }
}

/** 健康检查：只打一个纯本地的路由，不碰腾讯 */
async function qqPing(port) {
  if (!port) return false;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/login/channels`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch { return false; }
}

function qqSpawn() {
  if (qqChild && qqChild.exitCode === null) return qqChild;
  // 子进程的输出直接落到边车自己的 .log（追写），主服务的控制台保持干净
  const fd = fs.openSync(QQ_LOG_FILE, 'a');
  const child = spawn(process.execPath, [QQ_ENTRY], {
    cwd: QQ_DIR,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: {
      ...process.env,
      // server.mjs 可能是被 Electron 用 ELECTRON_RUN_AS_NODE 拉起来的：
      // 这时 process.execPath 是 electron.exe，必须带上这个变量才是「当 node 用」
      ELECTRON_RUN_AS_NODE: '1',
      // 边车盯着父进程，主服务退出后自己不赖着占端口
      QQ_PARENT_PID: String(process.pid),
    },
  });
  qqChild = child;
  fs.closeSync(fd);              // 句柄已经传给子进程，父进程这份可以关了
  child.on('error', (e) => console.warn('  QQ 边车启动失败:', e.message));
  child.on('exit', (code, signal) => {
    console.warn(`  QQ 边车退出（code=${code}${signal ? ' signal=' + signal : ''}），下次请求会重起`);
    // 只有「当前这个」才是 null：退出事件可能晚于下一次 spawn，别把新句柄抹了
    if (qqChild === child) qqChild = null;
  });
  return child;
}

/** 拿到一个可用端口：已有的能 ping 通就复用，否则拉起一个并等它就绪 */
async function ensureQQ() {
  const alive = qqPortFromFile();
  if (alive && await qqPing(alive)) return alive;
  if (qqStarting) return qqStarting;

  qqStarting = (async () => {
    /* 安装包还没把 services/ 打进去时（build.files 里没有它），给一句人话，
       而不是一个 ERR_MODULE_NOT_FOUND 堆栈。 */
    if (!fs.existsSync(QQ_ENTRY)) {
      throw new Error('QQ 边车没安装：缺少 services/qq-api/start.mjs（先在 services/qq-api 里 npm install）');
    }
    try { fs.unlinkSync(QQ_PORT_FILE); } catch { /* 上一轮的死端口，没有也无所谓 */ }
    const child = qqSpawn();
    const started = Date.now();
    while (Date.now() - started < 25000) {
      if (child.exitCode !== null) {
        throw new Error(`QQ 边车直接退出了（code=${child.exitCode}）\n${qqLogTail()}`);
      }
      const port = qqPortFromFile();
      if (port && await qqPing(port)) return port;
      await sleep(150);
    }
    throw new Error('QQ 边车 25 秒内没有就绪\n' + qqLogTail());
  })().finally(() => { qqStarting = null; });

  return qqStarting;
}

/** 跟边车说话。cookie 手动转发（边车不认 query 里的凭证，认 Cookie 头） */
async function qqRequest(pathname, { cookie = '', method = 'GET', payload, timeout = 20000 } = {}) {
  const port = await ensureQQ();
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let body;
  if (payload) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }
  const r = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method, headers, body, signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  return {
    status: r.status,
    data,
    // Node 20 的 undici 认 getSetCookie；老版本退回单条
    setCookies: r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean),
  };
}

/** 把边车下发的 Set-Cookie 合进下一次请求的 Cookie 头（803 那一轮要立刻查昵称） */
function cookieWith(setCookies, base = '') {
  const jar = new Map();
  for (const pair of String(base).split(';')) {
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  for (const line of setCookies) {
    const pair = line.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** QQ 封面：拿专辑 mid 拼（y.gtimg.cn 已在 /api/img 的白名单里）
 *
 * 尺寸由路径里的 `R<w>x<h>` 决定，`?param=` 对 gtimg 无效（实测：R300 再拼
 * ?param=800y800，回的还是 300×300）。实测可用档：150/300/500/800/1200，
 * 其中 R1200 实际出 1000×1000，是 CDN 的上限；R1000/R1600 都是 404。
 * 这里给大图（形态会把封面铺满画面），播放器缩略图由 public/api.js 的
 * API.img 按调用尺寸重写回小档，不漏流量到列表里。 */
const QQ_COVER_SIZE = 1200;
const qqCover = (albumMid) =>
  albumMid ? `https://y.gtimg.cn/music/photo_new/T002R${QQ_COVER_SIZE}x${QQ_COVER_SIZE}M000${albumMid}.jpg` : '';

/**
 * QQ 账号头像。有效登录态下，上游 `GetLoginUserInfo` 把真头像放在 `profile.info.logo`
 * （实测 thirdwx.qlogo.cn，200 image/jpeg）；顶层 headpic/avatarUrl/avatar 是历史字段。
 * 不拿 `q1.qlogo.cn/g?b=qq&nk=<uin>` 兜底：实测它和音乐头像不是同一张图（大小、hash 都不同）。
 */
function qqProfileAvatar(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const info = profile.info && typeof profile.info === 'object' ? profile.info : {};
  for (const value of [profile.headpic, profile.avatarUrl, profile.avatar, info.logo]) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value) && !/t_user_default/i.test(value)) return value;
  }
  return '';
}

/**
 * 搜索条目 → 前端只认的那一种形状（和网易云 toTrack() 对齐，加 source 标记）。
 * QQ 的原始条目有 20 多个字段、还塞着整段歌词（content），全转出去前端会背很多没用的字节。
 */
function qqTrack(it) {
  const singers = Array.isArray(it.singer) ? it.singer : [];
  const album = it.album || {};
  return {
    id: it.mid,                                  // 播放接口认的是 songmid，不是数字 id
    source: 'qq',
    name: it.name || it.title || '',
    artists: singers.map((s) => s.name).filter(Boolean).join(' / ') || '未知歌手',
    artistIds: singers.map((s) => s.mid).filter(Boolean),
    album: album.name || album.title || '',
    cover: qqCover(album.mid),
    duration: (it.interval || 0) * 1000,          // QQ 给秒，前端统一按毫秒
    // pay.pay_play=1 基本等于「要会员/付费」，只用来打 VIP 小签提示，不代表一定放不了
    fee: it.pay && it.pay.pay_play ? 1 : 0,
    mid: it.mid,
    /* 写歌单（/user/playlist/tracks）只认数字 songid，mid 不行。搜索条目原样带着数字 id，
       这里补一个 songId；取不到时主服务的写路由会用 /song/batch 按 mid 再解析。 */
    songId: Number(it.id) > 0 ? Number(it.id) : 0,
  };
}

/** getMusicPlay 的两种形状：登录后是字符串，匿名是一张 { songmid: { url, error, restriction } } 表 */
function qqPlayUrlOf(data, mid) {
  const p = data && data.data && data.data.playUrl;
  if (!p) return { url: '', preview: false, reason: 'unavailable' };
  if (typeof p === 'string') return { url: p, preview: false, reason: null };
  const one = p[mid] || Object.values(p)[0] || {};
  return {
    url: one.url || '',
    preview: !!one.preview,
    reason: one.url ? null : (one.error || 'unavailable'),
  };
}

/** 边车认的三个扫码通道；不认识的参数一律回默认（QQ 音乐 App） */
const QQ_CHANNELS = new Set(['qq', 'wechat', 'qqmusic']);
const qqChannel = (v) => (QQ_CHANNELS.has(v) ? v : 'qqmusic');

/* --------------------------------------------------------------------------
   QQ 登录态的本地兜底（手机版专项）
   --------------------------------------------------------------------------
   边车把登录态封在一枚 HttpOnly cookie：`qqmusic_session=<64 位 hex>`。
   桌面 Chromium 会一直带着它；Android WebView 有两个额外的失效窗口：
     1) 803 那一拍主服务还要顺手查一次 /login/status（原来最多等 20s），
        手机网络慢时前端 20s 的 fetch 先超时，803 的 Set-Cookie 根本没落地；
     2) Activity 被系统回收 / WebView 后台挂起后，CookieManager 不保证把这枚
        刚写入的 cookie 立刻刷盘，重新进来时请求可能已经不带了。
   边车的 `.auth-session.json` 里此时仍有完整凭据，所以主服务在内存里记一份
   「最近确认成功的 token」：不落盘、不返回给前端，只在 /status 兜底和补发
   Set-Cookie 时用。`/lizi/session-info` 由边车从文件现读，能证明 token 仍存在。
   -------------------------------------------------------------------------- */
const QQ_SESSION_TTL = 24 * 60 * 60 * 1000;   // 与边车 cookie 的 Max-Age 一致
let qqLastSession = null;                     // { token, nickname, avatar, uin, at }

function qqTokenFromCookieLine(raw) {
  for (const pair of String(raw || '').split(';')) {
    const i = pair.indexOf('=');
    if (i > 0 && pair.slice(0, i).trim() === 'qqmusic_session') {
      const value = pair.slice(i + 1).trim().replace(/^"|"$/g, '');
      return /^[A-Za-z0-9._~-]{8,512}$/.test(value) ? value : '';
    }
  }
  return '';
}
function qqTokenFromSetCookies(lines) {
  for (const line of lines || []) {
    const token = qqTokenFromCookieLine(line);
    if (token) return token;
  }
  return '';
}
/** 803 的 body 也带 `cookie: qqmusic_session=…`；Set-Cookie 头缺失时靠它兜底 */
function qqTokenFromBody(d) {
  return qqTokenFromCookieLine(d && (d.cookie || (d.data && d.data.cookie)));
}
function qqSessionCookieLine(token) {
  return `qqmusic_session=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 86400 : 0}`;
}
function qqSessionCached(token) {
  if (!qqLastSession || !token || qqLastSession.token !== token) return null;
  if (Date.now() - qqLastSession.at > QQ_SESSION_TTL) return null;
  return qqLastSession;
}
/**
 * 用户态请求实际要带的 cookie。
 * 手机 WebView 有两个时刻会「请求里没有 qqmusic_session」：803 的响应因前端
 * 20s 超时被丢掉（Set-Cookie 没落地），或 Activity/WebView 后台挂起后
 * CookieManager 还没刷盘。此时主服务内存里明明有刚确认成功的 token，
 * 却会让 /user/* 按匿名处理：每日推荐回 401 → 前端退回雷达「公共内容」并
 * 缓存下来，只有重启后才正常。这里用内存 token 兜底并补发 Set-Cookie，
 * 让登录成功后的第一阶段请求就拿得到账号数据。
 */
function qqAuthCookie(cookie, res) {
  if (qqTokenFromCookieLine(cookie)) return cookie;
  const cached = qqSessionCached(qqLastSession && qqLastSession.token);
  if (!cached) return cookie;
  try { if (res) res.setHeader('Set-Cookie', qqSessionCookieLine(cached.token)); } catch { /* 已发头就跳过 */ }
  return `qqmusic_session=${cached.token}`;
}
function qqRememberSession(token, profile) {
  if (!token) return;
  const prev = qqSessionCached(token);
  const info = profile && profile.info && typeof profile.info === 'object' ? profile.info : {};
  qqLastSession = {
    token,
    at: Date.now(),
    nickname: (profile && (profile.nick || profile.nickname || profile.name || info.nick)) || (prev && prev.nickname) || '',
    avatar: qqProfileAvatar(profile) || (prev && prev.avatar) || '',
    uin: (profile && (profile.uin || profile.uin === 0 ? String(profile.uin) : '')) || (prev && prev.uin) || '',
  };
}
function qqIdentityOf(p) {
  const info = p && p.info && typeof p.info === 'object' ? p.info : {};
  return {
    nickname: (p && (p.nick || p.nickname || p.name || info.nick)) || 'QQ 音乐用户',
    avatar: qqProfileAvatar(p),
    uin: p && (p.uin || p.uin === 0) ? String(p.uin) : '',
  };
}
/**
 * 上游超时 / 边车 5xx 时不能直接判「未登录」：本地文件里还有这把凭据。
 * 用边车的只读路由确认 token 仍在（读文件，不碰上游），在就按登录态返回并补发
 * cookie。上游明确回 200 + 空 profile（凭据被拒）不会走到这里。
 */
async function qqStatusDegraded(res, token, browserToken) {
  /* 直接打已知端口，不走 ensureQQ：边车真挂了也不能为了兜底再等一次 25s 冷启动。 */
  const port = qqPortFromFile();
  if (!port) return null;
  let local = null;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/lizi/session-info`, {
      headers: { Cookie: `qqmusic_session=${token}` },
      signal: AbortSignal.timeout(1000),
    });
    const d = r.ok ? await r.json() : null;
    if (d && d.hasSession) local = d;
  } catch { /* 老边车没有这个路由：照旧按未登录处理 */ }
  if (!local) return null;
  const cached = qqSessionCached(token);
  if (browserToken !== token) res.setHeader('Set-Cookie', qqSessionCookieLine(token));
  return {
    code: 200,
    loggedIn: true,
    degraded: true,               // 前端可据此提示「登录态暂未复核」；不改变已登录判定
    nickname: local.nickname || (cached && cached.nickname) || 'QQ 音乐用户',
    avatar: (cached && cached.avatar) || '',
    uin: local.uid || (cached && cached.uin) || '',
  };
}

/* --------------------------------------------------------------------------
   /api/qq/* 分发。前端只看到这一种形状：{ code, ... }
   -------------------------------------------------------------------------- */
async function handleQQ(req, res, url) {
  const part = url.pathname.slice('/api/qq/'.length);
  const q = url.searchParams;
  const cookie = req.headers.cookie || '';

  /* 健康检查：顺带把「边车端口 / 通不通」用真实数字回给前端和验收脚本 */
  if (part === 'health') {
    try {
      const port = await ensureQQ();
      const r = await qqRequest('/login/channels', { timeout: 4000 });
      return json(res, 200, {
        code: 200,
        ok: true,
        port,
        channels: (r.data && r.data.data && r.data.data.channels) || [],
        sessionMode: (r.data && r.data.data && r.data.data.sessionMode) || null,
      });
    } catch (e) {
      return json(res, 502, { code: 502, ok: false, error: String(e.message) });
    }
  }

  try {
    /* ---- 登录态 ---- */
    if (part === 'status') {
      const browserToken = qqTokenFromCookieLine(cookie);
      const cachedToken = qqSessionCached(qqLastSession && qqLastSession.token)
        ? qqLastSession.token : '';
      const tokens = [...new Set([browserToken, cachedToken].filter(Boolean))];
      if (!tokens.length) return json(res, 200, { code: 200, loggedIn: false });

      let uncertain = false;             // 上游超时 / 边车 5xx：不知道，不是「明确失效」
      /* 大厅 accounts.js 对 /status 只等 8 秒：所有上游尝试总共 5 秒封顶，
         后面还要留给边车本地凭据确认（每个 token 1 秒）。 */
      const statusDeadline = Date.now() + 5000;
      for (const token of tokens) {
        let r = null;
        try {
          const left = statusDeadline - Date.now();
          if (left <= 0) { uncertain = true; break; }
          /* 上游慢时用本地凭据兜底，别让前端把「超时」画成「未登录」。 */
          r = await qqRequest('/login/status', {
            cookie: `qqmusic_session=${token}`, timeout: Math.min(5000, left),
          });
        } catch { uncertain = true; continue; }
        if (r.status >= 500) { uncertain = true; continue; }
        const p = (r.data && r.data.data && r.data.data.profile) || null;
        if (!p) continue;                // 200 + 空 profile = 上游明确说这把凭据失效
        qqRememberSession(token, p);
        if (browserToken !== token) res.setHeader('Set-Cookie', qqSessionCookieLine(token));
        return json(res, 200, { code: 200, loggedIn: true, ...qqIdentityOf(p) });
      }

      if (uncertain) {
        for (const token of tokens) {
          const degraded = await qqStatusDegraded(res, token, browserToken);
          if (degraded) return json(res, 200, degraded);
        }
      }

      /* 上游 401/200 空 profile 时登录态就是失效的（loggedIn 必须 false），
         但本地封存的旧凭据里还有昵称/头像。只把这两样带出去，别把「已失效」
         画成「已登录」。 */
      const staleCookie = browserToken || (qqLastSession && qqLastSession.token) || '';
      let stale = null;
      try {
        const c = await qqRequest('/lizi/cached-profile', {
          cookie: staleCookie ? `qqmusic_session=${staleCookie}` : '', timeout: 3000,
        });
        if (c.data && !c.data.empty && c.data.avatar) stale = c.data;
      } catch { /* 没有本地凭据就算了 */ }
      return json(res, 200, {
        code: 200, loggedIn: false,
        ...(stale ? { stale: true, nickname: stale.nickname || '', avatar: stale.avatar, uin: stale.uid || '' } : {}),
      });
    }

    /* 失效会话的只读身份（不返回 token：边车只解出 uid/nickname/avatar） */
    if (part === 'cached-profile') {
      if (!cookie) return json(res, 200, { code: 200, empty: true });
      const c = await qqRequest('/lizi/cached-profile', { cookie, timeout: 6000 });
      return json(res, 200, c.data || { code: 200, empty: true });
    }

    /* ---- 扫码：拿 key + 二维码图。两个接口合成一个，前端不用自己串 ---- */
    if (part === 'login/qr/key') {
      const channel = qqChannel(q.get('channel'));
      const k = await qqRequest(`/login/qr/key?channel=${channel}`, { timeout: 15000 });
      const key = k.data && k.data.data && k.data.data.unikey;
      if (!key) {
        return json(res, 200, {
          code: k.data.code || k.status || 502,
          key: null,
          channel,
          /* 二维码刚过期时包会先退避 15s（QR_COOLDOWN_MS），这里必须把 retryAfterMs
             带回去 —— 界面据此「等 N 秒自动重试」，而不是扔一句英文错误就完了。 */
          retryAfterMs: k.data.retryAfterMs || null,
          error: k.data.message || '拿不到二维码 key',
        });
      }
      // create 会等 MQTT 监听器就绪（App 扫码那条路），给足 35s
      const c = await qqRequest(`/login/qr/create?key=${encodeURIComponent(key)}`, { timeout: 35000 });
      const qrimg = (c.data && c.data.data && c.data.data.qrimg) || '';
      /* 二维码不是随时能刷：上游对同一设备有 15s 冷却（包里的 QR_COOLDOWN_MS）。
         冷却期里 key 拿到了、图却是空的 —— 这时候必须把原因说出来，
         不然用户只看到「二维码加载失败」。 */
      if (!qrimg) {
        return json(res, 200, {
          code: c.data.code || 502,
          key,
          qrimg: '',
          channel,
          // 上游失败时会给 retryAfterMs（二维码生成有 15s 冷却），界面据此说「N 秒后再试」
          retryAfterMs: c.data.retryAfterMs || null,
          error: c.data.message || '二维码生成失败（上游没给图片）',
        });
      }
      return json(res, 200, {
        code: 200,
        key,
        qrimg,
        channel,
      });
    }

    /* ---- 扫码状态：801 等待 / 802 待确认 / 803 成功 / 800 过期 ---- */
    if (part === 'login/qr/check') {
      const key = q.get('key') || '';
      if (!key) return json(res, 400, { code: 400, error: 'key required' });
      const r = await qqRequest(`/login/qr/check?key=${encodeURIComponent(key)}`, { cookie, timeout: 25000 });
      const d = r.data || {};
      const out = { code: d.code ?? r.status, message: d.message || '' };
      /* 800 不只有「过期」一种：手机确认之后还要拿票据去上游换身份，那一步可能被直接拒
         （实测最常见 20279 / auth.device-limit = 账号登录设备数已满）。边车把这些诊断字段
         放在 800 的响应里，以前这里只留 code/message，全丢了 —— 前端就只能报「二维码过期」，
         换成新码照样被同一张名单拒，用户看到的是二维码自己闪，以为是我们坏了。
         原样透传，提示文案交给前端按 failureHint.key 翻中文（见 app.js 的 qrLoginHint）。 */
      if (out.code !== 803) {
        if (d.failureStage) out.failureStage = d.failureStage;
        if (d.failureReason) out.failureReason = d.failureReason;
        if (d.upstreamCode !== undefined) out.upstreamCode = d.upstreamCode;
        if (d.upstreamErrorKey) out.upstreamErrorKey = d.upstreamErrorKey;
        if (d.primaryFailure) out.primaryFailure = d.primaryFailure;
        if (d.failureHint) out.failureHint = d.failureHint;
        if (d.retryAfterMs) out.retryAfterMs = d.retryAfterMs;
      }
      if (out.code === 803) {
        out.loggedIn = true;
        /* 803 的 token 既可能在 Set-Cookie 头里，也可能只在 body.cookie 里。
           两处都取，并且保证响应一定带 Set-Cookie —— 手机 WebView 一旦因为
           前端 20s 超时丢掉这次响应，登录态就没有第二次下发的机会了。 */
        const token = qqTokenFromSetCookies(r.setCookies) || qqTokenFromBody(d);
        const setCookies = [...(r.setCookies || [])];
        if (token) {
          qqRememberSession(token, null);
          if (!setCookies.some((line) => qqTokenFromCookieLine(line) === token)) {
            setCookies.push(qqSessionCookieLine(token));
          }
        }
        if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
        /* 顺手查昵称只是锦上添花：原实现给 20s，手机网络慢时前端先超时、
           803 与 Set-Cookie 一起丢掉。现在 5s 内查不到就直接返回登录成功。 */
        if (token) {
          try {
            const s = await qqRequest('/login/status', {
              cookie: cookieWith(setCookies, cookie), timeout: 5000,
            });
            const p = (s.data && s.data.data && s.data.data.profile) || null;
            if (p) {
              const identity = qqIdentityOf(p);
              out.nickname = identity.nickname === 'QQ 音乐用户' ? '' : identity.nickname;
              out.avatar = identity.avatar;
              qqRememberSession(token, p);
            }
          } catch { /* 昵称查不到不影响登录本身 */ }
        }
      } else if (r.setCookies.length) {
        res.setHeader('Set-Cookie', r.setCookies);
      }
      return json(res, 200, out);
    }

    if (part === 'logout') {
      const r = await qqRequest('/logout', { cookie });
      qqLastSession = null;
      /* 除了边车自己的失效 cookie，还显式清一次：手机上退出后不能让旧的
         qqmusic_session 留在 WebView 里又被后续请求带回来。 */
      res.setHeader('Set-Cookie', [...(r.setCookies || []), qqSessionCookieLine('')]);
      return json(res, 200, { code: 200, loggedIn: false });
    }

    /* 从这里开始是内容接口：手机 WebView 丢掉 803 那枚 cookie 时，用主服务
       内存里刚确认成功的 token 兜底并补发（见 qqAuthCookie 的注释）。 */
    const authCookie = qqAuthCookie(cookie, res);

    /* ---- 搜索 ---- */
    if (part === 'search') {
      const s = (q.get('s') || q.get('keyword') || '').trim();
      if (!s) return json(res, 200, { code: 200, source: 'qq', tracks: [], songCount: 0 });
      // 包实测一个请求最多 20 条（MAX_LIMIT=20），超过会被压回 20
      const limit = Math.min(20, Math.max(1, Number(q.get('limit')) || 20));
      const page = Math.max(1, Number(q.get('page')) || 1);

      /* 60 秒内同一个词（同一页、同一登录态）直接给上次的结果。
         不只是省流量：QQ 对匿名搜索有限流，短时间连打同一批词会连续回 2001
         （实测连续 10 次全部 2001，等半分钟才恢复）。用户改一个字又改回来、
         或者前端防抖没按住时，缓存能挡住绝大多数重复请求。 */
      const cacheKey = `${authCookie ? 'auth' : 'anon'}|${s}|${limit}|${page}`;
      const cached = qqSearchCache.get(cacheKey);
      if (cached && Date.now() - cached.at < QQ_SEARCH_TTL) {
        return json(res, 200, { ...cached.data, cached: true });
      }

      const api = `/search?keyword=${encodeURIComponent(s)}&limit=${limit}&page=${page}`;
      let r = await qqRequest(api, { cookie: authCookie });
      /* 撞上限流就退避重试（1.2s / 2.5s，最多三次）。
         实测 2001 的冷却在 15 秒上下，重试覆盖不了长时间冷却，
         但轻度限流（最常见）这样就过去了；真不行就把上游码如实告诉用户。 */
      for (const wait of [1200, 2500]) {
        if (r.data.code === 200) break;
        await sleep(wait);
        r = await qqRequest(api, { cookie: authCookie });
      }
      if (r.data.code !== 200) {
        const upCode = r.data.upstreamCode;
        return json(res, 200, {
          code: r.data.code || r.status,
          source: 'qq',
          tracks: [],
          // 把上游数字码也说出来：2001 = 被限流，用户知道「等一会儿」而不是「这功能坏了」
          error: (r.data.message || r.data.errorKey || 'QQ 搜索失败') + (upCode ? `（上游 ${upCode}，稍后再试）` : ''),
          upstream: r.data,
        });
      }
      const payload = {
        code: 200,
        source: 'qq',
        tracks: (r.data.items || []).map(qqTrack).filter((t) => t.id),
        songCount: r.data.total ?? (r.data.items || []).length,
        more: !!r.data.more,
      };
      qqSearchCache.set(cacheKey, { at: Date.now(), data: payload });
      if (qqSearchCache.size > 24) qqSearchCache.delete(qqSearchCache.keys().next().value);
      return json(res, 200, payload);
    }

    /* ---- 歌词（QQ 的 LRC；有就显示，没有就空着） ---- */
    if (part === 'lyric') {
      const mid = q.get('mid') || q.get('id') || '';
      if (!mid) return json(res, 400, { code: 400, error: 'mid required' });
      const r = await qqRequest(`/getLyric?songmid=${encodeURIComponent(mid)}`, { cookie: authCookie });
      const body = (r.data && r.data.response) || {};
      const lyric = body.lyric || '';
      return json(res, 200, {
        code: 200,
        lyric,
        tlyric: body.trans || '',
        yrc: '',
        format: lyric ? 'lrc' : 'none',
      });
    }

    /* ---- 播放直链 ---- */
    if (part === 'song/url') {
      const mid = q.get('mid') || q.get('id') || '';
      if (!mid) return json(res, 400, { code: 400, error: 'mid required' });
      const quality = q.get('quality') || '128';
      const first = await qqRequest(
        `/getMusicPlay/${encodeURIComponent(mid)}?quality=${quality}`, { cookie: authCookie }
      );
      let got = qqPlayUrlOf(first.data, mid);
      let loginRequired = first.status === 401;

      /* 没有会员 / 没登录：正片拿不到，退回试听片段（30~60s）。
         这是 QQ 那边的硬限制，不是我们的 bug —— 如实标 preview 让界面去说。 */
      if (!got.url) {
        const pv = await qqRequest(
          `/getMusicPlay/${encodeURIComponent(mid)}?quality=${quality}&preview=1`, { cookie: authCookie }
        );
        const p = qqPlayUrlOf(pv.data, mid);
        if (p.url) got = p;
        else loginRequired = loginRequired || pv.status === 401;
      }

      return json(res, 200, {
        code: 200,
        mid,
        url: got.url || '',
        preview: !!got.preview,
        quality: got.preview ? 'preview' : quality,
        reason: got.url ? null : (loginRequired ? 'login' : 'unavailable'),
        // 上游给的原因里带 hint/restriction，原样带上方便排查（前端不显示）
        restriction: got.url ? null : (first.data && first.data.data && first.data.data.playUrl) || null,
      });
    }

    /* ---------------- 铺色态用的推荐 / 歌单 / 我的（2026-11-06） ----------------
       和网易云那边同一套形状：歌单 { id,name,cover,trackCount,creator }，
       曲目 { id,source,name,artists,album,cover,duration,... }。
       推荐歌单 / 新歌 / 榜单匿名可用；user/* 需要登录（照实回 401 的说明）。 */
    if (part === 'recommend/playlists') {
      const limit = Math.min(20, Math.max(3, Number(q.get('limit')) || 9));
      const r = await qqRequest(`/recommend/playlists?limit=${limit}`, { cookie: authCookie });
      const d = r.data || {};
      if (Number(d.code) !== 200) {
        return json(res, 200, {
          code: d.code || 502, source: 'qq', playlists: [],
          error: d.message || d.errorKey || 'QQ 推荐歌单失败',
        });
      }
      return json(res, 200, {
        code: 200, source: 'qq',
        playlists: (d.playlists || []).map(qqPlaylist).filter((p) => p.id),
      });
    }

    if (part === 'recommend/new-songs') {
      const limit = Math.min(60, Math.max(1, Number(q.get('limit')) || 30));
      const r = await qqRequest(`/recommend/new-songs?limit=${limit}`, { cookie: authCookie });
      const d = r.data || {};
      if (Number(d.code) !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'qq', tracks: [], error: d.message || 'QQ 新歌失败' });
      }
      return json(res, 200, {
        code: 200, source: 'qq',
        tracks: (d.songs || []).map(qqTrack).filter((t) => t.id),
      });
    }

    if (part === 'playlist/detail') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const dirId = q.get('dirId') || q.get('dirid') || '';
      /* 用户自己的歌单（含设为「不公开」的）：/user/playlist 给的是目录 id（dirId），
         而匿名 /getSongListDetail 只认 disstid，读自建歌单会拿到空壳或 -1。
         已登录时先带凭证走 /user/playlist-detail（tid 或 dirid）；失败/空再退回公开接口，
         推荐歌单、收藏来的公开歌单和旧路径都不受影响。
         搬运工具按 offset/limit 翻页：limit/offset 透传给边车，回包带 more/total 供它判断终点。 */
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 100));
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      if (authCookie.includes('qqmusic_session') && /^\d+$/.test(String(id))) {
        const params = new URLSearchParams({ tid: String(id), limit: String(limit), offset: String(offset) });
        const dir = String(dirId || '');
        if (/^\d+$/.test(dir) && dir !== String(id)) params.set('dirid', dir);
        try {
          const owned = await qqRequest('/user/playlist-detail?' + params.toString(), { cookie: authCookie });
          const d = (owned && owned.data) || {};
          const songs = (Array.isArray(d.songs) ? d.songs : []).map(qqTrack).filter((t) => t.id);
          /* code=200 就返回（空页也返回），否则翻到最后一页会掉进下面的匿名兜底，
             把整张公开歌单又返回一遍。空页 more=false，搬运工具据此收尾。 */
          if (Number(d.code) === 200) {
            const total = Number(d.total) || songs.length;
            return json(res, 200, {
              code: 200, source: 'qq',
              id: String(id),
              name: '',
              cover: '',
              tracks: songs,
              trackCount: total,
              total,
              more: songs.length ? !!d.more : false,
            });
          }
        } catch { /* 边车超时/异常：照旧走下面的公开接口，不让新路径挡住旧路径 */ }
      }
      const r = await qqRequest(`/getSongListDetail/${encodeURIComponent(id)}`, { cookie: authCookie });
      const resp = (r.data && r.data.response) || {};
      const cd = (resp.cdlist && resp.cdlist[0]) || null;
      if (!cd) {
        return json(res, 200, {
          code: resp.code || 502, source: 'qq', name: '', cover: '', tracks: [], trackCount: 0,
          error: resp.code ? '歌单取不到（' + resp.code + '）' : '歌单不存在',
        });
      }
      const songs = (cd.songlist || []).map(qqTrack).filter((t) => t.id);
      /* 匿名兜底拿的是完整 songlist，不分页，more 固定 false */
      return json(res, 200, {
        code: 200, source: 'qq',
        id: String(cd.disstid || id),
        name: cd.dissname || 'QQ 歌单',
        cover: cd.logo || '',
        creator: { nickname: cd.nickname || cd.nick || '' },
        tracks: songs,
        trackCount: songs.length,
        more: false,
      });
    }

    if (part === 'user/liked-songs') {
      /* 搬运工具按 offset/limit 翻页：offset 透传给边车，回包带 more 供它判断终点 */
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 100));
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      const r = await qqRequest(`/user/liked-songs?limit=${limit}&offset=${offset}`, { cookie: authCookie });
      const d = r.data || {};
      if (Number(d.code) !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'qq', tracks: [],
          error: d.code === 401 ? '先在卡片上扫码登录 QQ 音乐' : (d.message || '取「我喜欢」失败'),
        });
      }
      return json(res, 200, {
        code: 200, source: 'qq',
        tracks: (d.songs || []).map(qqTrack).filter((t) => t.id),
        total: d.total || (d.songs || []).length,
        more: !!d.more,
      });
    }

    if (part === 'user/playlists') {
      /* 上游 /user/playlist 第一轮把收藏读到 1000 张就停（more=true + nextFavoriteOffset），
         不续读会截掉第 1000 张之后的收藏。边车 getUserPlaylist 已经接收 favoriteOffset，
         这里带 offset 逐轮续读并去重。more=true 但拿不到续读位置（上游空页/重复页）时
         立即停，避免原地打转。 */
      const MAX_ROUNDS = 20;
      const playlists = [];
      const seen = new Set();
      let favoriteOffset = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const path = favoriteOffset > 0
          ? `/user/playlist?favoriteOffset=${favoriteOffset}`
          : '/user/playlist';
        const r = await qqRequest(path, { cookie: authCookie });
        const d = r.data || {};
        if (Number(d.code) !== 200) {
          if (round === 0) {
            return json(res, 200, {
              code: d.code || 401, source: 'qq', playlists: [],
              error: d.code === 401 ? '先在卡片上扫码登录 QQ 音乐' : (d.message || '取我的歌单失败'),
            });
          }
          break;
        }
        for (const it of (Array.isArray(d.playlist) ? d.playlist : [])) {
          const p = qqPlaylist(it);
          if (!p.id || seen.has(p.id)) continue;
          seen.add(p.id);
          playlists.push(p);
        }
        /* 停法：more=false、没有可用的续读位置、续读位置不前进、翻到轮数上限 */
        if (!d.more) break;
        const next = Number(d.nextFavoriteOffset);
        if (!Number.isSafeInteger(next) || next <= favoriteOffset) break;
        favoriteOffset = next;
      }
      return json(res, 200, { code: 200, source: 'qq', playlists });
    }

    /* 「我的收藏专辑」：边车返回 { albums,total,more }，这里统一成网易云
       album/sublist 那套 { data,hasMore }，前端只写一套渲染。
       未登录 / 上游失败一律把 error 原样带出去，别回一个空列表假装成功。 */
    if (part === 'user/albums') {
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 100));
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      const r = await qqRequest(`/user/albums?offset=${offset}&limit=${limit}`, { cookie: authCookie });
      const d = r.data || {};
      if (Number(d.code) !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'qq', data: [], hasMore: false,
          error: d.code === 401 ? '先在卡片上扫码登录 QQ 音乐' : (d.message || d.errorKey || '取收藏专辑失败'),
        });
      }
      return json(res, 200, {
        code: 200, source: 'qq',
        data: (Array.isArray(d.albums) ? d.albums : []).map(qqUserAlbum).filter((a) => a.id),
        hasMore: !!d.more,
        total: Number(d.total) || 0,
      });
    }

    if (part === 'user/daily-songs') {
      const r = await qqRequest('/user/daily-songs', { cookie: authCookie });
      const d = r.data || {};
      if (Number(d.code) !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'qq', tracks: [],
          error: d.code === 401 ? '登录 QQ 音乐后才有每日推荐' : (d.message || '取每日推荐失败'),
        });
      }
      return json(res, 200, {
        code: 200, source: 'qq',
        tracks: (d.songs || []).map(qqTrack).filter((t) => t.id),
      });
    }

    /* ---- 雷达推荐：匿名可用，作为「每日推荐」未登录时的兜底 ---- */
    if (part === 'recommend/radar') {
      const page = Math.max(1, Number(q.get('page')) || 1);
      const r = await qqRequest(`/recommend/radar?page=${page}`, { cookie: authCookie });
      const d = r.data || {};
      if (Number(d.code) !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'qq', tracks: [], error: d.message || 'QQ 雷达推荐失败' });
      }
      return json(res, 200, {
        code: 200, source: 'qq',
        tracks: (d.songs || []).map(qqTrack).filter((t) => t.id),
      });
    }

    /* ---- 电台：频道目录匿名可读；收听（/radio/tracks）要登录 ---- */
    if (part === 'radio/categories') {
      const r = await qqRequest('/radio/categories', { cookie: authCookie });
      const d = r.data || {};
      if (Number(d.code) !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'qq', stations: [], error: d.message || 'QQ 电台目录失败' });
      }
      const stations = [];
      for (const g of (d.groups || [])) {
        for (const it of (g.radios || [])) {
          stations.push({
            id: String(it.id || ''),
            source: 'qq',
            name: it.title || it.name || '未命名电台',
            cover: it.picurl || it.picUrl || it.pic || '',
            trackCount: 0,
            playCount: Number(it.listenNum || it.listenCount) || 0,
            creator: { nickname: g.title || '' },
          });
        }
      }
      return json(res, 200, { code: 200, source: 'qq', stations: stations.filter((s) => s.id) });
    }

    if (part === 'radio/tracks') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const r = await qqRequest(`/radio/tracks?id=${encodeURIComponent(id)}`, { cookie: authCookie });
      const d = r.data || {};
      if (Number(d.code) !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'qq', tracks: [],
          error: d.code === 401 ? 'QQ 电台收听需要登录（并可能需要会员）' : (d.message || 'QQ 电台取歌失败'),
        });
      }
      return json(res, 200, {
        code: 200, source: 'qq',
        tracks: (d.songs || d.tracks || []).map(qqTrack).filter((t) => t.id),
      });
    }

    /* ---------------- 写入：建歌单 / 加歌（只开显式路由，不做任意路径透明代理） ----------------
       上游 @yakult-green-tea/qq-music-api 3.3.5 的两个写接口都是 POST，且都要登录会话：
         /user/playlist/create  body { name }（上游硬限制：≤20 个字符）
         /user/playlist/tracks  body { tid, op:'add', songs:[{ id:数字 songid, type:0 }] }
       它们不认 songmid，所以加歌前必须把 mid 换成数字 id；搜索条目已带 songId，
       缺失时用匿名只读的 /song/batch 按 mid 补（一次最多 20 首）。 */
    if (part === 'playlist/create') {
      const body = req.method === 'POST' ? await readBody(req) : {};
      let name = String(body.name || q.get('name') || '').trim();
      if (!name) return json(res, 400, { code: 400, error: 'name required' });
      if (!authCookie.includes('qqmusic_session')) {
        return json(res, 200, { code: 401, error: '先在卡片上扫码登录 QQ 音乐' });
      }
      /* 上游只收 20 个字（按 Unicode 码点）以内的名字，超长/带控制字符会 400。
         搬运默认名「原名（来自搬运）」往往超过 20 字，所以这里先清洗再截断，保证能建出来。 */
      name = Array.from(name.replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 20).join('').trim();
      if (!name) return json(res, 400, { code: 400, error: '歌单名不能为空' });
      const r = await qqRequest('/user/playlist/create', {
        cookie: authCookie, method: 'POST', payload: { name }, timeout: 25000,
      });
      const d = r.data || {};
      if (Number(d.code) !== 200) {
        return json(res, 200, {
          code: d.code || 502,
          error: Number(d.code) === 401
            ? '登录态已失效，重新扫码登录 QQ 音乐'
            : (d.message || d.errorKey || 'QQ 建歌单失败'),
          upstream: { code: d.code || r.status, errorKey: d.errorKey || null },
        });
      }
      return json(res, 200, {
        code: 200,
        tid: String(d.tid || ''),
        dirId: String(d.dirId || ''),
        // playlist.id 用 tid：加歌接口认的就是 tid
        playlist: { id: String(d.tid || ''), dirId: String(d.dirId || ''), name: d.name || name },
      });
    }

    if (part === 'playlist/tracks' || part === 'playlist/tracks/add') {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const tid = Number(body.tid ?? body.pid ?? q.get('tid') ?? q.get('pid'));
      const rawSongs = Array.isArray(body.songs) ? body.songs
        : (Array.isArray(body.picks) ? body.picks : []);
      if (!Number.isSafeInteger(tid) || tid <= 0) {
        return json(res, 400, { code: 400, error: 'tid required' });
      }
      if (!authCookie.includes('qqmusic_session')) {
        return json(res, 200, { code: 401, error: '先在卡片上扫码登录 QQ 音乐' });
      }
      if (!rawSongs.length) return json(res, 400, { code: 400, error: 'songs required' });
      /* 后端接受 {id} / {songId} / {mid} 三种形状（前端传 songId + mid）。
         数字 id 直接用；只有 mid 的收集起来批量解析。 */
      const songs = rawSongs.map((s) => {
        if (typeof s === 'number' || typeof s === 'string') return { id: s, mid: '' };
        return { ...s };
      });
      const needMids = [];
      for (const s of songs) {
        /* songId=0 表示「搜索映射里没有数字 id」，不能因为 "0" 也是合法数字串就
           跳过 mid 解析 —— 否则后面的 /song/batch 兜底永远走不到。 */
        const cand = Number(s.songId) > 0 ? s.songId : (s.id ?? '');
        const n = Number(cand);
        if (Number.isSafeInteger(n) && n > 0 && String(cand).length <= 15) {
          s.id = n;
          continue;
        }
        s.id = 0;
        s.mid = String(s.mid || s.id || '');
        if (s.mid) needMids.push(s);
      }
      for (let i = 0; i < needMids.length; i += 20) {
        const chunk = needMids.slice(i, i + 20);
        const br = await qqRequest('/song/batch', {
          cookie: authCookie, method: 'POST', payload: { songs: chunk.map((s) => ({ mid: s.mid })) }, timeout: 25000,
        });
        const results = (br.data && br.data.results) || [];
        for (const it of results) {
          const target = chunk[it && it.index];
          if (target && it.code === 200 && it.song && Number(it.song.id) > 0) target.id = Number(it.song.id);
        }
      }
      if (songs.some((s) => !Number.isSafeInteger(s.id) || s.id <= 0)) {
        return json(res, 400, { code: 400, error: '有些曲目没有数字 songid，无法写入 QQ 歌单' });
      }
      /* 上游单次最多 100 首：按 100 一批写，若某一批失败就说清楚写到哪儿了，不伪装成功。 */
      let added = 0;
      for (let i = 0; i < songs.length; i += 100) {
        const chunk = songs.slice(i, i + 100);
        const r = await qqRequest('/user/playlist/tracks', {
          cookie: authCookie, method: 'POST',
          payload: { tid, op: 'add', songs: chunk.map((s) => ({ id: s.id, type: 0 })) },
          timeout: 30000,
        });
        const d = r.data || {};
        if (Number(d.code) !== 200) {
          return json(res, 200, {
            code: d.code || 502,
            added,
            error: Number(d.code) === 401
              ? '登录态已失效，重新扫码登录 QQ 音乐'
              : (d.message || d.errorKey || 'QQ 加歌失败') + (added ? `（前 ${added} 首已写入）` : ''),
          });
        }
        added += chunk.length;
      }
      return json(res, 200, { code: 200, tid, added });
    }

    return json(res, 404, { code: 404, error: 'unknown qq api: ' + part });
  } catch (e) {
    // 拉起失败 / 边车 502 / 超时：把真实原因带出去，不要只说「失败」
    return json(res, 502, { code: 502, error: String(e.message), log: qqLogTail() });
  }
}

/** QQ 歌单条目 → 前端那一种形状（推荐歌单用 tid/title/picurl，我的歌单用 tid/dirId/dirName）
 *
 *  id 必须是详情接口认的那个：官方选择顺序是 tid → dissid → id，dirId 只兜底。
 *  dirId 是「用户库里的目录 id」（201 是内置的「我喜欢」），不是 disstid；
 *  以前把它排在第一位，点进自建歌单就会拿目录 id 去查详情，上游回 -1。
 *  dirId 仍然单独带出去：详情接口需要它来解析自己的文件夹。 */
function qqPlaylist(it) {
  const creator = it.creator || {};
  return {
    id: String(it.tid ?? it.dissid ?? it.disstid ?? it.id ?? it.dirId ?? it.dirid ?? ''),
    dirId: String(it.dirId ?? it.dirid ?? ''),
    name: it.dirName || it.dissname || it.title || '未命名歌单',
    cover: it.picUrl || it.picurl || it.cover || it.logo || it.pic || '',
    trackCount: Number(it.songNum ?? it.songnum ?? it.song_cnt ?? 0) || 0,
    playCount: Number(it.listenCount ?? it.play_cnt ?? it.playCount ?? 0) || 0,
    creator: { nickname: it.nickname || it.nick || creator.nickname || creator.nick || '' },
    source: 'qq',
  };
}

/**
 * QQ「我收藏的专辑」原始条目 → 和网易云 album/sublist 对齐的字段。
 * QQ 这条路由走的是旧版 profile-asset CGI，字段名是历史写法（albummid/albumname/
 * singername/pubtime/songnum），新版偶尔回 camelCase，所以两套都兜住。
 * id 优先用 albummid：QQ 的专辑接口认 mid；没有 mid 才退回数字 albumid。
 * 旧接口常常不给封面、只给 albummid —— 按 QQ 封面 CDN 的固定规则拼一张。
 */
function qqUserAlbum(it) {
  const mid = String(it.albummid || it.albumMid || it.album_mid || it.mid || '');
  const num = it.albumid ?? it.albumId ?? it.album_id ?? it.id;
  const singers = Array.isArray(it.singer)
    ? it.singer.map((s) => (s && s.name) || s || '').filter(Boolean).join(' / ')
    : '';
  const singer = it.singername || it.singerName || it.singer_name || singers || it.artist || '未知歌手';
  return {
    id: mid || String(num ?? ''),
    name: it.albumname || it.albumName || it.album_name || it.name || '未知专辑',
    /* 保持网易云 album/sublist 的 artists 类型（对象数组），前端那套映射不用分叉 */
    artists: [{ name: String(singer) }],
    cover: it.albumcover || it.albumCover || it.albumPic || it.albumpic || it.pic || it.cover || it.picUrl
      || qqCover(mid),
    publishTime: Number(it.pubtime ?? it.pubTime ?? it.publishTime ?? it.publish_time ?? 0) || 0,
    trackCount: Number(it.songnum ?? it.songNum ?? it.trackCount ?? it.track_count ?? it.total ?? 0) || 0,
  };
}

/**
 * QQ 音频代理（/api/qq/audio?url=）
 * 直链是 http://aqqmusic.tc.qq.com/RS....mp3?vkey=... 这种，
 * 走本机代理的理由和封面一样：vkey 会过期、CDN 有 referer 策略，而且不该把凭证塞进 DOM。
 * 必须转发 Range，否则 <audio> 拖进度条会整段重下。
 */
async function proxyQQAudio(req, res, url) {
  let u;
  try { u = new URL(url.searchParams.get('url') || ''); } catch { return json(res, 400, { error: 'bad url' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return json(res, 400, { error: 'bad protocol' });
  // 只允许腾讯的域名：这个口子是给 QQ 音频用的，不能变成任意 SSRF
  if (!/(^|\.)qq\.com$/i.test(u.hostname)) return json(res, 403, { error: 'host not allowed' });

  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://y.qq.com/' };
  if (req.headers.range) headers.Range = req.headers.range;
  try {
    const upstream = await fetch(u, { headers, redirect: 'follow' });
    const out = {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    };
    for (const k of ['content-length', 'content-range']) {
      const v = upstream.headers.get(k);
      if (v) out[k] = v;
    }
    res.writeHead(upstream.status, out);
    if (!upstream.body) return res.end();
    pipeUpstream(upstream, res);
  } catch (e) {
    json(res, 502, { code: 502, error: String(e.message) });
  }
}

/* ==========================================================================
   其它音源边车（酷狗 / 汽水 / 波点 / Spotify）
   --------------------------------------------------------------------------
   和 QQ 那套一模一样的做法，只是抽成了一份通用代码 —— 四个平台各写一遍
   「按需 spawn / 死了重起 / 读 .port / 转发 cookie / 翻译成 { code, ... }」没有意义。

   端口固定（不抢 3210 那个 QQ 的，也避开 Windows 保留段）：
     酷狗 3211 / 汽水 3212 / 波点 3213 / Spotify 3214
   每个平台仍可用环境变量覆盖：KUGOU_API_PORT / QISHUI_API_PORT / BODIAN_API_PORT / SPOTIFY_API_PORT

   Node 版本的硬约束：汽水（qishui-music-api）和波点（bodian-music-api）的 engines 都是 >= 24。
   server.mjs 自己可能跑在 Electron 的 Node 20.18.3 下（ELECTRON_RUN_AS_NODE），所以这两个边车
   要**另找系统 node**：先 node -v 探版本，不足 24 就明确报错（reason: 'node-version'），
   让前端把这个音源置灰 —— 不静默失败、不假装能播。
   ========================================================================== */
const SIDECARS = {
  // ping：活跃探针的路径。酷狗那个包没有 /health，start.mjs 自己挂了一个 /lizi/health
  kugou: { dir: 'kugou-api', env: 'KUGOU', port: 3211, node24: false, ping: '/lizi/health' },
  /* 酷狗概念版：同一个包、同一个目录，但 KUGOU_PROFILE=lite 会让 start.mjs 换
     .port-lite / .log-lite / 3217，并在 require 包之前把 process.env.platform 固定成 lite。
     两个 profile 共用 .auth-state/device.json（同一台设备），cookie jar 分开。 */
  kugouLite: {
    dir: 'kugou-api', env: 'KUGOU_LITE', port: 3217, node24: false, ping: '/lizi/health',
    profile: 'lite', portFile: '.port-lite', logFile: '.log-lite',
  },
  /* 网易云（services/netease-api/）：扫码登录交给 @neteasecloudmusicapienhanced/api 那一整套服务，
     不再自己跟 weapi/eapi 的加密和风控较劲（我们手写的那条路稳定回 8821）。
     端口 3215，避开上面四个；NETEASE_API_PORT 可覆盖。 */
  netease: { dir: 'netease-api', env: 'NETEASE', port: 3215, node24: false, ping: '/lizi/health' },
  qishui: { dir: 'qishui-api', env: 'QISHUI', port: 3212, node24: true, ping: '/health' },
  bodian: { dir: 'bodian-api', env: 'BODIAN', port: 3213, node24: true, ping: '/health' },
  spotify: { dir: 'spotify-api', env: 'SPOTIFY', port: 3214, node24: false, ping: '/health' },
  /* 酷我（services/kuwo-api/）：自写的零依赖边车，端口 3216，避开上面五个。
     网页端没有扫码登录，只能粘 Cookie；用户歌单/我喜欢没有公开接口，前端如实空态。 */
  kuwo: { dir: 'kuwo-api', env: 'KUWO', port: 3216, node24: false, ping: '/health' },
  /* VST3 离线宿主（services/vst-host/，2026-11-17 加）：和上面几个不同 —— start.mjs 只是
     启动器，真正干活的是它拉起的 Python（pedalboard）。端口由 Python 绑 127.0.0.1:0 后
     自己写 .port，所以这里的 port 没有意义（填 0），主服务永远不猜。 */
  vst: { dir: 'vst-host', env: 'VST', port: 0, node24: false, ping: '/health' },
};

const scState = {};             // name → { child, starting, jar }
for (const name of Object.keys(SIDECARS)) scState[name] = { child: null, starting: null, jar: null };

function scPaths(name) {
  const meta = SIDECARS[name];
  const dir = path.join(__dirname, 'services', meta.dir);
  return {
    dir,
    entry: path.join(dir, 'start.mjs'),
    portFile: path.join(dir, meta.portFile || '.port'),
    logFile: path.join(dir, meta.logFile || '.log'),
  };
}
function scPort(name) {
  try {
    const n = Number(fs.readFileSync(scPaths(name).portFile, 'utf8').trim());
    return Number.isInteger(n) && n > 1024 && n < 65536 ? n : 0;
  } catch { return 0; }
}
function scLogTail(name, n = 14) {
  try {
    const lines = fs.readFileSync(scPaths(name).logFile, 'utf8').trim().split('\n');
    return lines.slice(-n).join('\n');
  } catch { return '(还没有日志)'; }
}
async function scPing(name, port) {
  if (!port) return false;
  try {
    const r = await fetch(`http://127.0.0.1:${port}${SIDECARS[name].ping}`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

/* ---- Node ≥24 探测（汽水/波点要） ---- */
let node24Cache = null;         // { bin, version } 或 { error }
function resolveNode24() {
  if (node24Cache) return node24Cache;
  const isElectron = !!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === '1';
  const major = Number(process.versions.node.split('.')[0]);
  // 自己就是系统 node 且够新：直接用（不必再找一个）
  if (!isElectron && major >= 24) {
    node24Cache = { bin: process.execPath, version: process.versions.node };
    return node24Cache;
  }
  /* 依次尝试：随包分发的 node → 开发目录 runtime/node → LIZI_NODE_BIN → 系统 node。
     每一级都真的跑一次 --version，<24 或起不来就继续下一级，最后才报错。 */
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  const candidates = [];
  // a. 打包后：<安装目录>/resources/node/node.exe（package.json extraResources 打进去的）
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'node', exe));
  // b. 开发环境：项目内 runtime/node/node.exe
  candidates.push(path.join(__dirname, 'runtime', 'node', exe));
  // c. 老兜底：LIZI_NODE_BIN / 系统 node
  candidates.push(process.env.LIZI_NODE_BIN || 'node');

  const tried = [];
  let lastBin = '';
  let lastVersion = '';
  let lastError = null;
  for (const bin of [...new Set(candidates)]) {
    try {
      const version = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
      const vMajor = Number(String(version).replace(/^v/, '').split('.')[0]);
      if (vMajor >= 24) {
        node24Cache = { bin, version };
        return node24Cache;
      }
      tried.push(`${bin}（${version}）`);
      lastBin = bin;
      lastVersion = version;
    } catch (e) {
      tried.push(`${bin}（${e.code === 'ENOENT' ? '不存在' : '跑不起来'}）`);
      lastError = e;
    }
  }
  node24Cache = lastVersion
    ? { error: `本机 node 版本不足：这个音源要求 ≥ 24，当前是 ${lastVersion}（${lastBin}）` }
    : { error: `本机找不到可用的 node（试过 ${tried.join('、')}）：${lastError ? lastError.message : '没有候选'}` };
  return node24Cache;
}

function scSpawn(name) {
  const st = scState[name];
  if (st.child && st.child.exitCode === null) return st.child;
  const { dir, entry, logFile } = scPaths(name);
  const meta = SIDECARS[name];
  if (!fs.existsSync(entry)) {
    throw new Error(`${name} 边车没安装：缺少 services/${meta.dir}/start.mjs（先在那个目录里 npm install）`);
  }

  /* 用哪个 node 起：汽水/波点必须 ≥24；酷狗/Spotify 用当前进程的 node 就够
     （Electron 里是 electron.exe，所以带上 ELECTRON_RUN_AS_NODE） */
  let bin = process.execPath;
  let extraEnv = {};
  if (meta.node24) {
    const r = resolveNode24();
    if (r.error) {
      const err = new Error(r.error);
      err.reason = 'node-version';
      throw err;
    }
    bin = r.bin;
    extraEnv = { LIZI_NODE_BIN: r.bin };
  } else if (process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === '1') {
    extraEnv = { ELECTRON_RUN_AS_NODE: '1' };
  }

  const env = {
    ...process.env,
    ...extraEnv,
    // 边车盯着父进程，主服务退出后自己不赖着占端口
    [`${meta.env}_PARENT_PID`]: String(process.pid),
  };
  /* node24 边车跑的是真正的 node.exe（随包/系统），不是 Electron：
     把这个从父进程继承来的标记摘掉，免得以后谁把它换成 electron.exe 时行为走样。 */
  if (meta.node24) delete env.ELECTRON_RUN_AS_NODE;
  /* 酷狗两版靠这个环境变量在 start.mjs 里分叉；普通版显式摘掉，别被开发机的全局变量带成 lite。 */
  if (meta.profile) env.KUGOU_PROFILE = meta.profile;
  else delete env.KUGOU_PROFILE;

  const fd = fs.openSync(logFile, 'a');
  const child = spawn(bin, [entry], {
    cwd: dir,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env,
  });
  st.child = child;
  fs.closeSync(fd);
  child.on('error', (e) => console.warn(`  ${name} 边车启动失败:`, e.message));
  child.on('exit', (code, signal) => {
    console.warn(`  ${name} 边车退出（code=${code}${signal ? ' signal=' + signal : ''}），下次请求会重起`);
    if (st.child === child) st.child = null;
    /* VST 宿主可能被一个坏插件带崩：记死亡次数，ensureVst() 据此限流（最多自动重启 3 次，
       免得一个必崩的插件让每个请求都重新拉起 Python）。2026-11-17 */
    if (name === 'vst') st.deaths = (st.deaths || 0) + 1;
  });
  return child;
}

/** 拿到一个可用端口：已有的能 ping 通就复用，否则拉起一个并等它就绪 */
async function ensureSidecar(name) {
  const st = scState[name];
  const alive = scPort(name);
  if (alive && await scPing(name, alive)) return alive;
  if (st.starting) return st.starting;

  st.starting = (async () => {
    // Node 版本不够时不要 spawn，直接抛（前端据此置灰 + 说原因）
    if (SIDECARS[name].node24) {
      const r = resolveNode24();
      if (r.error) { const e = new Error(r.error); e.reason = 'node-version'; throw e; }
    }
    try { fs.unlinkSync(scPaths(name).portFile); } catch { /* 上一轮的死端口 */ }
    const child = scSpawn(name);
    const started = Date.now();
    while (Date.now() - started < 25000) {
      if (child.exitCode !== null) {
        throw new Error(`${name} 边车直接退出了（code=${child.exitCode}）\n${scLogTail(name)}`);
      }
      const port = scPort(name);
      if (port && await scPing(name, port)) return port;
      await sleep(150);
    }
    throw new Error(`${name} 边车 25 秒内没有就绪\n` + scLogTail(name));
  })().finally(() => { st.starting = null; });

  return st.starting;
}

/** 跟边车说话（cookie 用 query 传的 `cookie=k=v; k=v` 形式，酷狗那套只认这个） */
async function scRequest(name, pathname, { cookie = '', timeout = 20000, method = 'GET', payload, cookieHeaderOnly = false } = {}) {
  const port = await ensureSidecar(name);
  const sep = pathname.includes('?') ? '&' : '?';
  /* cookieHeaderOnly：把 cookie 只放 Cookie 头，不进 URL。边车会自己解析 req.cookies，
     新加的 VIP 检测用这个，token 就不会出现在边车的 [OK] URL 日志里。
     注意缓存键只看 URL：调用方要自己带时间戳，别让不同账号/前后两次请求互相命中。 */
  const full = cookie && !cookieHeaderOnly ? `${pathname}${sep}cookie=${encodeURIComponent(cookie)}` : pathname;
  /* payload 是可选的 JSON body：酷狗边车的路由会把 body 和 query 合并成 params，
     写歌单（tracks/add 的 data 可能很长）走 body 就不用担心 GET URL 长度。原有 GET 不受影响。 */
  const headers = {};
  if (cookie && (method !== 'GET' || cookieHeaderOnly)) headers.Cookie = cookie;
  let body;
  if (payload) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }
  const r = await fetch(`http://127.0.0.1:${port}${full}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  return {
    status: r.status,
    data,
    setCookies: r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean),
  };
}

/* ==========================================================================
   VST3 离线处理（services/vst-host/，2026-11-17 加）
   --------------------------------------------------------------------------
   链路：
     浏览器 POST /api/vst/render { source, url, pluginPath, params?, preset? }
       → 这里用 AUDIO_HOSTS[source] 校验 url（照抄 proxySourceAudio 的判断，防 SSRF）
       → 主服务抓音频，落 runtime/vst/in/<sha1>.<ext>（同一个 url 不重抓）
       → POST 127.0.0.1:<python 端口>/render（传的全是本机绝对路径）
       → Python 用 pedalboard 处理，写 runtime/vst/out/<id>.wav
       → 返回 { url: '/api/vst/out/<id>.wav' }

   为什么音频必须由 Node 抓：Python 那边不认白名单，把任意 URL 交给它等于绕过
   AUDIO_HOSTS，开一个 SSRF 口子。宿主的职责只有「读本地文件 → 插件 → 写本地文件」。
   ========================================================================== */
const VST_IN_DIR = path.join(__dirname, 'runtime', 'vst', 'in');
const VST_OUT_DIR = path.join(__dirname, 'runtime', 'vst', 'out');
const VST_MAX_RESTARTS = 3;
fs.mkdirSync(VST_IN_DIR, { recursive: true });
fs.mkdirSync(VST_OUT_DIR, { recursive: true });

const vstSha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

/** 按需拉起 Python 宿主。连续崩 3 次就停手 —— 坏插件不该让每个请求都重开一次进程 */
async function ensureVst() {
  const st = scState.vst;
  if ((st.deaths || 0) >= VST_MAX_RESTARTS) {
    const e = new Error(`VST 宿主已退出 ${st.deaths} 次（上限 ${VST_MAX_RESTARTS}），不再自动重启；详见 services/vst-host/.log`);
    e.reason = 'vst-restarts';
    throw e;
  }
  return ensureSidecar('vst');
}

/** 跟 Python 宿主说话（只走回环；端口每次都从 .port 现读） */
async function vstRequest(pathname, { method = 'GET', payload, timeout = 120000 } = {}) {
  const port = await ensureVst();
  const r = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { ok: false, error: text.slice(0, 300) }; }
  return { status: r.status, data };
}

/** 同一个 url 的输入文件：sha1 前缀 + 任意扩展名（扩展名可能是抓完才知道的） */
function vstCachedInput(hash) {
  try {
    /* 排除 .part-*：抓一半崩掉留下的半截文件不能当输入复用（2026-11-17） */
    const hit = fs.readdirSync(VST_IN_DIR).find((n) => n.startsWith(hash + '.') && !n.includes('.part-'));
    return hit ? path.join(VST_IN_DIR, hit) : '';
  } catch { return ''; }
}

/** 音频扩展名：先看 URL 路径，再看 Content-Type。pedalboard 靠扩展名选解码器 */
function vstAudioExt(u, contentType) {
  const known = new Set(['mp3', 'flac', 'm4a', 'mp4', 'aac', 'wav', 'ogg', 'opus', 'wma']);
  const m = /\.([a-z0-9]{2,5})$/i.exec(u.pathname);
  if (m && known.has(m[1].toLowerCase())) return '.' + m[1].toLowerCase();
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('mpeg')) return '.mp3';
  if (ct.includes('flac')) return '.flac';
  if (ct.includes('mp4') || ct.includes('m4a')) return '.m4a';
  if (ct.includes('aac')) return '.aac';
  if (ct.includes('wav')) return '.wav';
  if (ct.includes('ogg') || ct.includes('opus')) return '.ogg';
  return '.bin';
}

/** 读 Python 写出来的 44 字节 WAV 头，缓存命中时也能报时长/声道（读失败就算了） */
function vstWavInfo(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const h = Buffer.alloc(44);
      fs.readSync(fd, h, 0, 44, 0);
      if (h.toString('ascii', 0, 4) !== 'RIFF' || h.toString('ascii', 8, 12) !== 'WAVE') return null;
      const channels = h.readUInt16LE(22);
      const sampleRate = h.readUInt32LE(24);
      const byteRate = h.readUInt32LE(28);
      const dataSize = h.readUInt32LE(40);
      if (!byteRate) return null;
      return { channels, sampleRate, durationMs: Math.round((dataSize / byteRate) * 1000) };
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

/** 输出 WAV：必须支持 Range，播放器拖进度条会发 Range 请求 */
function serveVstOut(req, res, id) {
  /* id 已经过 ^[0-9a-f-]{8,64}$：没有点、没有斜杠，拼不进 ../ */
  const file = path.join(VST_OUT_DIR, id + '.wav');
  let stat;
  try { stat = fs.statSync(file); } catch { return json(res, 404, { error: 'not found' }); }
  const total = stat.size;
  const base = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };

  const send = (code, headers, start, end) => {
    res.writeHead(code, headers);
    if (req.method === 'HEAD' || start === undefined) return res.end();
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
    stream.pipe(res);
  };

  const range = req.headers.range;
  if (!range) {
    return send(200, { ...base, 'Content-Length': total });
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return json(res, 416, { error: 'bad range', total });
  }
  let start;
  let end;
  if (m[1] === '') {
    // bytes=-N：最后 N 字节
    const n = Number(m[2]);
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    res.writeHead(416, { ...base, 'Content-Range': `bytes */${total}` });
    return res.end();
  }
  send(206, {
    ...base,
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Content-Length': end - start + 1,
  }, start, end);
}

async function handleVst(req, res, url) {
  const part = url.pathname.slice('/api/vst'.length).replace(/^\//, '');

  /* GET /api/vst/status —— 顺带把宿主拉起来（第一次 /api/vst/* 才启动，不影响开机速度） */
  if ((part === '' || part === 'status') && (req.method === 'GET' || req.method === 'HEAD')) {
    try {
      const r = await vstRequest('/health', { timeout: 30000 });
      const ok = r.status === 200 && r.data && r.data.ok === true;
      return json(res, 200, {
        ready: ok,
        pedalboard: r.data && r.data.pedalboard,
        pid: r.data && r.data.pid,
        error: ok ? null : (r.data && r.data.error) || `HTTP ${r.status}`,
      });
    } catch (e) {
      return json(res, 200, { ready: false, error: String(e.message || e) });
    }
  }

  /* GET /api/vst/plugins[?probe=1|路径] —— 透传；probe=1 全量逐个 load（很慢），
     probe=<路径> 只 load 一个。2026-11-17 之前这里只认 probe=1，路径会被丢掉 */
  if (part === 'plugins' && req.method === 'GET') {
    const probe = (url.searchParams.get('probe') || '').trim();
    const probeLow = probe.toLowerCase();
    const fullProbe = probeLow === '1' || probeLow === 'true' || probeLow === 'yes';
    const probeOff = !probe || probeLow === '0' || probeLow === 'false' || probeLow === 'no';
    const probeQuery = probeOff ? '' : '?probe=' + encodeURIComponent(probe);
    try {
      const r = await vstRequest('/plugins' + probeQuery, { timeout: fullProbe ? 20 * 60 * 1000 : probeQuery ? 5 * 60 * 1000 : 60000 });
      return json(res, r.status === 200 ? 200 : 502, r.data);
    } catch (e) {
      return json(res, 502, { ok: false, plugins: [], error: String(e.message || e), log: scLogTail('vst') });
    }
  }

  /* GET /api/vst/out/<id>.wav —— 处理结果，支持 Range */
  const outHit = /^out\/([0-9a-f-]{8,64})\.wav$/.exec(part);
  if (outHit && (req.method === 'GET' || req.method === 'HEAD')) {
    return serveVstOut(req, res, outHit[1]);
  }

  /* POST /api/vst/render —— 抓音频 → 交给 Python → 返回可播放的 URL */
  if (part === 'render' && req.method === 'POST') {
    const body = await readBody(req);
    const source = String(body.source || '');
    const pluginPath = String(body.pluginPath || '');
    if (!source || !body.url || !pluginPath) {
      return json(res, 400, { ok: false, error: '需要 source / url / pluginPath' });
    }

    /* ---- 1) 白名单校验：和 proxySourceAudio 完全同一套判断 ---- */
    let u;
    try { u = new URL(String(body.url)); } catch { return json(res, 400, { ok: false, error: 'bad url' }); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return json(res, 400, { ok: false, error: 'bad protocol' });
    const allow = AUDIO_HOSTS[source] || [];
    if (!allow.length) return json(res, 403, { ok: false, error: `no audio for source ${source}` });
    if (!allow.some((re) => re.test(u.hostname))) {
      return json(res, 403, { ok: false, error: 'host not allowed: ' + u.hostname });
    }

    try {
      /* ---- 2) 抓音频（同一 url 复用；sha1 用 url 算） ---- */
      const urlHash = vstSha1(u.href);
      let inputPath = vstCachedInput(urlHash);
      let downloaded = false;
      if (!inputPath) {
        const headers = { 'User-Agent': 'Mozilla/5.0' };
        if (AUDIO_REFERER[source]) headers.Referer = AUDIO_REFERER[source];
        const upstream = await fetch(u, { headers, redirect: 'follow', signal: AbortSignal.timeout(120000) });
        if (!upstream.ok) {
          return json(res, 502, { ok: false, error: `上游音频 HTTP ${upstream.status}` });
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        if (!buf.length) return json(res, 502, { ok: false, error: '上游音频是空的' });
        inputPath = path.join(VST_IN_DIR, urlHash + vstAudioExt(u, upstream.headers.get('content-type')));
        /* 先写 .part 再改名：半截文件绝不能留在缓存里被下一次复用 */
        const tmp = inputPath + '.part-' + process.pid;
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, inputPath);
        downloaded = true;
      }

      /* ---- 3) 缓存 id：<url sha1 前 16>-<pluginPath sha1 前 8>-<params sha1 前 8> ---- */
      const params = (body.params && typeof body.params === 'object' && !Array.isArray(body.params)) ? body.params : {};
      const id = [
        urlHash.slice(0, 16),
        vstSha1(pluginPath).slice(0, 8),
        vstSha1(JSON.stringify(params)).slice(0, 8),
      ].join('-');
      const outPath = path.join(VST_OUT_DIR, id + '.wav');

      if (fs.existsSync(outPath)) {
        const info = vstWavInfo(outPath);
        return json(res, 200, {
          ok: true,
          url: `/api/vst/out/${id}.wav`,
          cached: true,
          durationMs: info ? info.durationMs : null,
          elapsedMs: 0,
          sampleRate: info ? info.sampleRate : null,
          channels: info ? info.channels : null,
        });
      }

      /* ---- 4) 交给 Python（只传本机路径，不传 URL） ---- */
      const r = await vstRequest('/render', {
        method: 'POST',
        timeout: 15 * 60 * 1000,       // 插件加载 5–23s + 整曲处理；大文件留足余量
        payload: {
          inputPath,
          pluginPath,
          outPath,
          params,
          preset: body.preset ? String(body.preset) : '',
        },
      });
      if (r.status !== 200 || !r.data || r.data.ok !== true) {
        return json(res, 502, {
          ok: false,
          error: (r.data && r.data.error) || `VST 宿主 HTTP ${r.status}`,
          log: scLogTail('vst'),
        });
      }
      return json(res, 200, {
        ok: true,
        url: `/api/vst/out/${id}.wav`,
        cached: false,
        durationMs: r.data.durationMs,
        elapsedMs: r.data.elapsedMs,
        sampleRate: r.data.sampleRate,
        channels: r.data.channels,
        downloaded,
        plugin: r.data.plugin,
        appliedParams: r.data.appliedParams,
        skippedParams: r.data.skippedParams,
      });
    } catch (e) {
      return json(res, 502, { ok: false, error: String(e.message || e), log: scLogTail('vst') });
    }
  }

  return json(res, 404, { error: 'unknown vst api: ' + part });
}

/* ==========================================================================
   网易云登录（走 services/netease-api/ 这个边车）
   --------------------------------------------------------------------------
   为什么要换：我们手写的 weapi/eapi 扫码，手机确认后上游稳定回
   8821「请切换其他登录方式或升级新版本再试」，.session.json 里永远只有 NMTID。
   现在和 Folia 一样，直接跑社区那套完整的 API 服务（@neteasecloudmusicapienhanced/api），
   登录交给它，我们只负责：
     1) 把它的返回整理成前端认识的形状 /api/netease/*
     2) 803 之后从它的响应里收 cookie，只取 MUSIC_U / __csrf 写进我们自己的 .session.json
     3) 提供「粘贴 cookie」这条最稳的备用登录
   cookie 一律只进不出：响应、日志、诊断面板里都只有键名，没有值。
   ========================================================================== */

/** 调边车。两件事必须记住：
 *  1) 统一带 x-apicache-bypass：这个包里挂了 2 分钟的 apicache，
 *     扫码 check 这种「每 2 秒问一次」的接口被缓存住就永远停在 801 了。
 *  2) **cookie 走 JSON body，绝不走 query**：包里的 logger 会把 req.originalUrl 打进
 *     自己的 .log，`?cookie=` 等于把凭证明文落盘。body 不进日志。 */
async function ncRequest(pathname, { method = 'POST', params = {}, cookie = '', timeout = 20000 } = {}) {
  const port = await ensureSidecar('netease');
  const u = new URL(`http://127.0.0.1:${port}${pathname}`);
  const headers = { 'x-apicache-bypass': '1' };
  let body;

  if (method === 'GET') {
    // 只有 /lizi/health 走这条：本地探针，没有任何参数
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(k, String(v));
    }
  } else {
    headers['Content-Type'] = 'application/json';
    const payload = { ...params };
    if (cookie) payload.cookie = cookie;
    body = JSON.stringify(payload);
  }

  const r = await fetch(u, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  /* Set-Cookie 也要带出去：803 那次上游往往把 MUSIC_U 只放在响应头里，
     只读 body.cookie 会漏掉（这是 harvest 拿不到登录态的第二个坑）。 */
  const setCookies = r.headers.getSetCookie
    ? r.headers.getSetCookie()
    : [r.headers.get('set-cookie')].filter(Boolean);
  return { status: r.status, data, setCookies };
}

/* parseCookieInput / extractCookie / harvest 都在
   services/netease-api/harvest-core.mjs（可单测的纯逻辑），这里直接复用。 */

/** 当前会话的快照 / 回滚 —— 新 cookie 校验不过时必须原样还回去 */
function sessionSnapshot() {
  let raw = null;
  try { raw = fs.readFileSync(SESSION_FILE, 'utf8'); } catch { raw = null; }
  return { jar: { ...cookies }, raw };
}
function sessionRestore(snap) {
  cookies = { ...snap.jar };
  try {
    if (snap.raw === null) { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); }
    else fs.writeFileSync(SESSION_FILE, snap.raw);
  } catch (e) { console.warn('  会话回滚写盘失败:', e.message); }
}
function sessionApply(pairs) {
  cookies = { ...pairs };                            // 整份替换：粘贴/收下来的那一串才是权威
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
}
/** 把上游 profile 整成前端认的短名字；没有 userId 就当没登录 */
function profileOf(p) {
  if (!p || !p.userId) return null;
  return { userId: p.userId, nickname: p.nickname, avatar: p.avatarUrl || p.avatar || '', vipType: p.vipType };
}

/** 验一次登录态。两条通道都试，任意一条说「已登录」就算数：
 *   1) 边车 /login/status —— 下发 cookie 的就是它，最不容易被风控挑中
 *   2) 我们自己的 weapi /w/nuser/account/get —— 边车挂了也得能验
 * 只回 { loggedIn, profile }，绝不回 cookie。 */
async function sessionVerify() {
  /* 边车优先：这条不碰我们自己的 jar（weapi 那条会 saveCookies，理论上可能把
     MUSIC_U 覆盖掉）。但边车没活着时**不去拉起它** —— /api/session 开屏就问，
     不能为了验一次登录态把启动卡住 25 秒。 */
  const port = scPort('netease');
  if (port && await scPing('netease', port)) {
    try {
      const r = await ncRequest('/login/status', { params: {}, cookie: cookieHeader(), timeout: 12000 });
      const d = (r.data && r.data.data) || {};
      const p = profileOf(d.profile);
      if (d.code === 200 && p) return { loggedIn: true, profile: p };
    } catch { /* 掉下去走自己的通道 */ }
  }

  try {
    const d = await weapiRequest(ROUTES['login/status'].path, {});
    const n = await normalize('login/status', d);
    if (n && n.loggedIn === true) return n;
  } catch { /* 两条都不通就当没登录 */ }
  return null;
}

/* --------------------------------------------------------------------------
   扫码 803 当场抓 cookie
   二维码 key 是一次性的：803 那一拍之后同一个 key 再 check 必回 800
   「二维码不存在或已过期」。所以 803 的响应一到就必须把 cookie 抠出来存住，
   不能等前端再发一次 /api/login/harvest 去重查 —— 那一次一定迟到。
   -------------------------------------------------------------------------- */
const QR_COOKIE_TTL = 10 * 60 * 1000;       // 10 分钟，扫一次够用
const qrCookies = new Map();                // key → { pairs, field, at }
let lastHarvest = null;                     // 最近一次收 cookie 的结果（只有键名/来源）

function qrCacheSet(key, pairs, field) {
  const now = Date.now();
  for (const [k, v] of qrCookies) if (now - v.at > QR_COOKIE_TTL) qrCookies.delete(k);
  qrCookies.set(key, { pairs: { ...pairs }, field: field || null, at: now });
}
function qrCacheGet(key) {
  const v = qrCookies.get(key);
  if (!v) return null;
  if (Date.now() - v.at > QR_COOKIE_TTL) { qrCookies.delete(key); return null; }
  return v;
}

/** 803 之后把边车的 cookie 收进我们自己的会话（803 那一拍和 harvest 共用） */
async function runHarvest(key) {
  const out = await harvest({
    key,
    cache: { get: qrCacheGet, set: qrCacheSet },
    recheck: async () => {
      const r = await ncRequest('/login/qr/check', { params: { key, type: 1, checkToken: 'v3', ua: NETEASE_UA }, cookie: cookieHeader(), timeout: 20000 });
      return { body: r.data, setCookies: r.setCookies };
    },
    status: async () => {
      const r = await ncRequest('/login/status', { params: {}, timeout: 12000 });
      return { body: r.data, setCookies: r.setCookies };
    },
    /* harvest-core 的 verify 契约是「返回裸 profile 或 null」；直接把
       sessionVerify 传进去会把 { loggedIn, profile } 整包当成 profile，
       803 登录后前端拿到嵌套对象，左侧 !!profile 已登录、右侧
       profile.nickname 却为空 —— 就是第一次扫码登录左右不一致的根因。 */
    verify: async () => {
      const v = await sessionVerify();
      return v && v.loggedIn ? v.profile : null;
    },
    session: { snapshot: sessionSnapshot, apply: sessionApply, restore: sessionRestore },
    record: (info) => {
      lastHarvest = {
        at: new Date().toISOString(),
        ok: !!info.ok,
        reason: info.reason || null,
        code: info.code ?? null,
        tried: info.tried || [],
        gotCookie: !!info.gotCookie,
        field: info.field || null,
        cookieKeys: info.keys || [],
      };
    },
  });
  if (out.ok) {
    console.log(`  登录成功（扫码收 cookie · 来源 ${out.field}）· 用户 ${out.profile && out.profile.userId}`);
  } else {
    console.log(`  扫码收 cookie 失败：${out.reason}（来源 ${out.field || '无'}；试过 ${(out.tried || []).join('/') || '无'}）`);
  }
  return out;
}

/** POST /api/session/import { cookie } —— 粘贴 cookie 登录（最稳的备用路） */
async function handleSessionImport(req, res) {
  const body = await readBody(req);
  const pairs = parseCookieInput(body.cookie ?? body.value ?? '');
  const keys = Object.keys(pairs);                   // 只回键名，不回值
  if (!pairs.MUSIC_U) {
    return json(res, 400, {
      ok: false, reason: 'no-music-u', keys, cookieKeys: keys,
      message: '这段内容里没有 MUSIC_U（F12 → Application → Cookies → music.163.com 里那一项）',
    });
  }
  const snap = sessionSnapshot();
  sessionApply(pairs);
  let v = null, err = null;
  try { v = await sessionVerify(); } catch (e) { err = e; }
  if (!v) {
    sessionRestore(snap);
    return json(res, 400, {
      ok: false, reason: err ? 'error' : 'invalid', keys, cookieKeys: keys,
      message: err
        ? '校验登录态失败：' + err.message
        : '这段 cookie 无效或已过期（MUSIC_U 不是当前账号的，或已经登出过）',
    });
  }
  console.log(`  登录成功（cookie 导入）· 用户 ${v.profile && v.profile.userId}`);
  return json(res, 200, { ok: true, profile: v.profile, cookieKeys: keys });
}

/** POST /api/login/harvest { key } —— 扫码 803 之后，把边车手里的 cookie 收进我们自己的会话
 *  803 那一拍已经抓过就命中缓存，不会再拿一次性 key 去重查（重查必 800）。 */
async function handleLoginHarvest(req, res) {
  const body = await readBody(req);
  const key = String(body.key || '').trim();
  if (!key) return json(res, 400, { ok: false, reason: 'no-key', message: '缺少扫码 key' });

  let out;
  try {
    out = await runHarvest(key);
  } catch (e) {
    return json(res, 400, { ok: false, reason: 'sidecar', message: '边车没给出登录结果：' + e.message });
  }

  /* 诊断用：试过哪几处、拿没拿到、从哪个字段拿的 —— 不含值 */
  const summary = {
    tried: out.tried || [],
    gotCookie: !!out.gotCookie,
    field: out.field || null,
  };

  if (out.ok === true) {
    return json(res, 200, { ok: true, profile: out.profile, harvest: summary, cookieKeys: out.keys });
  }
  return json(res, 400, {
    ok: false,
    reason: out.reason,
    code: out.code ?? null,
    message: out.message,
    harvest: summary,
    cookieKeys: out.keys || [],
  });
}

/** /api/netease/* —— 只做「形状对齐 + 不泄露 cookie」，业务全在边车里 */
async function handleNetease(req, res, url) {
  const part = url.pathname.slice('/api/netease/'.length);
  const q = url.searchParams;

  if (part === 'health') {
    try {
      const port = await ensureSidecar('netease');
      const h = await ncRequest('/lizi/health', { method: 'GET', timeout: 4000 });
      return json(res, 200, { code: 200, ok: true, port, health: h.data });
    } catch (e) {
      return json(res, 502, { code: 502, ok: false, error: String(e.message) });
    }
  }

  try {
    /* 扫码取 key：边车回 { data: { unikey }, code }，前端只认 { code, key, qrimg } */
    if (part === 'login/qr/key') {
      const k = await ncRequest('/login/qr/key', { params: { type: 1, checkToken: 'v3', ua: NETEASE_UA }, cookie: cookieHeader(), timeout: 20000 });
      const d = k.data || {};
      const unikey = (d.data && d.data.unikey) || d.unikey || null;
      if (!unikey) {
        return json(res, 200, {
          code: d.code || k.status || 502, key: null, channel: 'netease-api',
          message: d.message || '拿不到二维码 key',
        });
      }
      /* 二维码图：边车的 /login/qr/create?qrimg=true 直接给 data:image/png;base64。
         拿不到就让前端退回 https://music.163.com/login?codekey=<unikey>。 */
      let qrimg = '';
      try {
        const c = await ncRequest('/login/qr/create', { params: { key: unikey, qrimg: 'true', checkToken: 'v3', ua: NETEASE_UA }, cookie: cookieHeader(), timeout: 12000 });
        qrimg = (c.data && c.data.data && c.data.data.qrimg) || '';
      } catch { /* 图不是必须的 */ }
      return json(res, 200, { code: 200, key: unikey, qrimg, channel: 'netease-api' });
    }

    /* 扫码状态：801 等待 / 802 待确认 / 803 成功 / 800 过期。
       上游的 cookie 字符串**留在这个进程里**，只回 code / message / 键名。 */
    if (part === 'login/qr/check') {
      const key = String(q.get('key') || '');
      if (!key) return json(res, 400, { code: 400, message: 'key required' });
      const r = await ncRequest('/login/qr/check', { params: { key, type: 1, checkToken: 'v3', ua: NETEASE_UA }, cookie: cookieHeader(), timeout: 20000 });
      const d = r.data || {};
      const code = Number(d.code ?? r.status) || 0;

      /* 803 那一拍必须当场抓 cookie（key 一次性，晚一拍就 800）。
         body.cookie / body.data.cookie / Set-Cookie 头三处都看；
         抓到就立刻写会话并验一次 —— 前端就算漏发 harvest，用户也已经是登录态。 */
      if (code === 803) {
        const ex = extractCookie(d, r.setCookies);
        if (ex.pairs.MUSIC_U) {
          qrCacheSet(key, ex.pairs, ex.field);
          const h = await runHarvest(key);
          const out = {
            code,
            message: d.message || d.msg || '授权登陆成功',
            hasMusicU: true,
            cookieKeys: h.keys || [],
            channel: 'netease-api',
            loggedIn: h.ok === true,
            profile: h.ok ? h.profile : null,
            harvest: { tried: h.tried || [], gotCookie: true, field: h.field || null },
          };
          recordQrCheck({ code, message: out.message }, 'netease-api');
          return json(res, 200, out);
        }
      }

      const keys = Object.keys(extractCookie(d, r.setCookies).pairs);
      const out = {
        code,
        message: d.message || d.msg || '',
        hasMusicU: keys.includes('MUSIC_U'),
        cookieKeys: keys,
        channel: 'netease-api',
      };
      recordQrCheck({ code, message: out.message }, 'netease-api');
      return json(res, 200, out);
    }

    /* 兜底透明转发：/api/netease/<其余> → 边车 /<其余>。
       客户端传来的 cookie / randomCNIP / realIP 一律丢掉：cookie 用我们自己的，
       IP 参数不许客户端指定（边车那边已经强制走随机 CN IP，见 start.mjs 的补丁）。
       一律 POST + JSON body：cookie 不进 URL，边车的日志里就不会出现凭证。 */
    const body = req.method === 'POST' ? await readBody(req) : {};
    const params = { ...Object.fromEntries(q.entries()), ...body };
    delete params.cookie;
    delete params.randomCNIP;
    delete params.realIP;
    /* 登录类接口必须带易盾反作弊 token。
       这个包（@neteasecloudmusicapienhanced）专门加了 X-antiCheatToken 支持，但取码模块
       自己不传 checkToken，得由调用方指定。不带的话：unikey 照拿（code 200），
       可手机扫码确认时网易云判定异常 —— 就是我们看到的「本次操作异常已经拦截」。 */
    if (/^login\//.test(part)) params.checkToken = 'v3';
    params.ua = NETEASE_UA;   // 设备说自己是 PC，UA 也必须是 PC

    const target = '/' + part.replace(/^\/+/, '');
    if (target === '/') return json(res, 404, { error: 'unknown netease api' });
    const r = await ncRequest(target, {
      params,
      cookie: cookieHeader(),
      timeout: 25000,
    });
    return json(res, r.status === 200 ? 200 : r.status, r.data && typeof r.data === 'object' ? r.data : { raw: r.data });
  } catch (e) {
    return json(res, 502, { code: 502, error: String(e.message) });
  }
}

/* ---------------- 酷狗登录态 / 版本选择 ----------------
   普通版和概念版是两个边车进程（包在 require 时就把 process.env.platform 固定了），
   各自一份 cookie jar：
     normal → .auth-cookies.json       → kugou（3211）
     lite   → .auth-cookies-lite.json  → kugouLite（3217）
   同一台设备：.auth-state/device.json 两边共用。

   版本规则（2026-11-23 用户要求，**不再按 VIP 自动选路**）：
     · 用户最后成功登录哪一版，就一直用哪一版；
     · active 没 token 时才退到另一个有 token 的版本；都没有就用 normal 匿名；
     · VIP 只用于界面显示 / 试听提示，不参与选路。
   同一酷狗账号在两版的歌单 /「我喜欢」本来同步，所以换版本不会丢内容。

   登录态落盘（server.mjs 是普通 Node 进程，不依赖 Electron app）：
     · 优先用户可写目录：%APPDATA%\LIZI\kugou（非 Windows：~/.lizi/kugou）；
     · 开发环境且用户目录不可写时回退到 services/kugou-api；
     · packaged 模式**绝不写安装目录**；
     · 旧路径的 jar / active-profile.json 只读兼容，读到后迁移到新目录。
   线上结果缓存 10 分钟；登录 / 退出立即失效。 */
const KG_JAR_FILES = { normal: '.auth-cookies.json', lite: '.auth-cookies-lite.json' };
const KG_ACTIVE_FILE = 'active-profile.json';

function kgProfileName(p) { return p === 'lite' ? 'lite' : 'normal'; }
function kgOtherProfile(p) { return kgProfileName(p) === 'lite' ? 'normal' : 'lite'; }
function kgSidecarName(p = 'normal') { return kgProfileName(p) === 'lite' ? 'kugouLite' : 'kugou'; }

/* packaged：__dirname 是 resources/app（extraResources 把 services 放到 app/services），
   开发目录则是仓库根。两种都认一下，避免以后换打包布局时写回安装目录。 */
let kgPackagedCache = null;
function kgIsPackaged() {
  if (kgPackagedCache != null) return kgPackagedCache;
  try {
    if (process.resourcesPath
      && path.resolve(__dirname).toLowerCase().startsWith(path.resolve(process.resourcesPath).toLowerCase())) {
      kgPackagedCache = true;
      return kgPackagedCache;
    }
  } catch { /* ignore */ }
  kgPackagedCache = path.basename(path.dirname(__dirname)).toLowerCase() === 'resources';
  return kgPackagedCache;
}
function kgUserDir() {
  const override = process.env.LIZI_KUGOU_DATA_DIR;
  if (override) return path.resolve(override);
  let home = '';
  try { home = os.homedir(); } catch { /* ignore */ }
  const appData = process.env.APPDATA
    || (process.platform === 'win32' && home ? path.join(home, 'AppData', 'Roaming') : '');
  return appData ? path.join(appData, 'LIZI', 'kugou') : path.join(home || process.cwd(), '.lizi', 'kugou');
}
/* LIZI_KUGOU_DATA_DIR 是显式的数据目录覆盖（测试 / 多开）。这时把旧路径
   整个关掉：既保证测试不会读写真实凭据，也不会在退出时误删项目里的 jar。 */
const KG_LEGACY_ENABLED = !process.env.LIZI_KUGOU_DATA_DIR;
function kgLegacyDir() { return KG_LEGACY_ENABLED ? path.join(__dirname, 'services', 'kugou-api') : ''; }
function kgDataDir(which = 'user') { return which === 'legacy' ? kgLegacyDir() : kgUserDir(); }
function kgJarFile(profile = 'normal', which = 'user') {
  const dir = kgDataDir(which);
  return dir ? path.join(dir, KG_JAR_FILES[kgProfileName(profile)]) : '';
}
function kgActiveFile(which = 'user') {
  const dir = kgDataDir(which);
  return dir ? path.join(dir, KG_ACTIVE_FILE) : '';
}

/** 读 JSON：exists 用来区分「文件不存在」和「文件存在但内容坏了」。
    坏文件不能退到旧路径（可能是刚退出登录后的空文件），只当空处理。 */
function kgReadJson(file) {
  /* LIZI_KUGOU_DATA_DIR 模式下旧路径为空串：直接当成「不存在」 */
  if (!file) return { exists: false, value: null };
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { exists: !!e && e.code !== 'ENOENT', value: null };
  }
}
function kgDirWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch { return false; }
}
/** 原子写：先写临时文件再 rename，登录瞬间断电也不会留下半截 JSON */
function kgWriteJsonAtomic(file, obj) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  try { fs.renameSync(tmp, file); }
  catch (e) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw e; }
}

/** 读 cookie jar：新目录优先；新目录没有才读旧路径并迁移。
    primary 存在但解析失败时按空 jar 处理，绝不把旧登录态「复活」。 */
function kgJarRead(profile = 'normal') {
  const p = kgProfileName(profile);
  const primary = kgJarFile(p, 'user');
  const old = kgJarFile(p, 'legacy');
  const pf = kgReadJson(primary);
  if (pf.exists) {
    return { jar: pf.value && typeof pf.value === 'object' ? pf.value : {}, path: primary, source: 'user' };
  }
  const lf = kgReadJson(old);
  if (lf.exists && lf.value && typeof lf.value === 'object') {
    let migrated = false;
    try {
      kgWriteJsonAtomic(primary, lf.value);
      migrated = true;
      /* 迁完把旧文件改名，避免以后退出登录后又被「迁移」回来 */
      try { fs.renameSync(old, old + '.migrated'); } catch { /* 只读安装目录：留着也无害 */ }
    } catch (e) {
      console.warn(`  酷狗 ${p} 登录态迁移失败（继续用旧路径）:`, e.message);
    }
    return { jar: lf.value, path: migrated ? primary : old, source: migrated ? 'migrated' : 'legacy' };
  }
  return { jar: {}, path: primary, source: 'none' };
}
function kgJarGet(profile = 'normal') { return kgJarRead(profile).jar; }
/** 写 jar（空对象 = 退出登录，删除新旧两个路径）。
    返回 { ok, path, error }：登录流程必须据此判断是否真的写成功了。 */
function kgJarWrite(obj, profile = 'normal') {
  const p = kgProfileName(profile);
  const primary = kgJarFile(p, 'user');
  const old = kgJarFile(p, 'legacy');
  if (!obj || !Object.keys(obj).length) {
    let error = null;
    for (const f of [primary, old]) {
      if (!f) continue;
      try { fs.unlinkSync(f); } catch (e) { if (e && e.code !== 'ENOENT' && !error) error = e.message; }
    }
    return { ok: !error, path: primary, error };
  }
  try {
    kgWriteJsonAtomic(primary, obj);
    /* 已经落到用户目录，旧路径的副本必须清掉，否则下次启动会互相打架 */
    if (old) { try { fs.unlinkSync(old); } catch { /* 安装目录只读：读的时候新目录优先 */ } }
    return { ok: true, path: primary, error: null };
  } catch (e1) {
    if (!kgIsPackaged() && old) {
      try {
        kgWriteJsonAtomic(old, obj);
        console.warn('  酷狗登录态写不进用户目录，已回退到项目 services/kugou-api:', e1.message);
        return { ok: true, path: old, error: null, fallback: true };
      } catch (e2) {
        return { ok: false, path: primary, error: `${e1.message}；回退也失败：${e2.message}` };
      }
    }
    return { ok: false, path: primary, error: String((e1 && e1.message) || e1) };
  }
}
function kgJarSet(obj, profile = 'normal') { return kgJarWrite(obj, profile).ok; }
function kgCookie(profile = 'normal') {
  const j = kgJarGet(profile);
  return Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
}
function kgJarMtime(profile = 'normal') {
  for (const which of ['user', 'legacy']) {
    const file = kgJarFile(profile, which);
    if (!file) continue;
    try { return fs.statSync(file).mtimeMs; } catch { /* 没有这个文件 */ }
  }
  return 0;
}

/* ---- active profile：只认「最后成功登录」，不看 VIP ---- */
let kgActiveMemo = null;
function kgValidProfile(p) { return p === 'normal' || p === 'lite'; }
function kgReadActiveFile() {
  const primary = kgActiveFile('user');
  const saved = kgReadJson(primary);
  if (saved.exists) {
    /* 文件在就只认它：内容坏了/为空也不能回头读旧路径（那会把已退出/已换版的
       旧选择复活）。坏文件按「没有保存过」处理，交给 token / mtime 规则。 */
    if (!saved.value || !kgValidProfile(saved.value.profile)) return null;
    return { profile: kgProfileName(saved.value.profile), source: 'saved', path: primary };
  }
  const old = kgActiveFile('legacy');
  const legacy = kgReadJson(old);
  if (legacy.exists && legacy.value && kgValidProfile(legacy.value.profile)) {
    const profile = kgProfileName(legacy.value.profile);
    let migrated = false;
    try {
      kgWriteJsonAtomic(primary, { ...legacy.value, profile, migratedAt: new Date().toISOString() });
      migrated = true;
      try { fs.renameSync(old, old + '.migrated'); } catch { /* ignore */ }
    } catch (e) {
      console.warn('  酷狗 active-profile 迁移失败（继续用旧路径）:', e.message);
    }
    return { profile, source: migrated ? 'migrated' : 'legacy', path: migrated ? primary : old };
  }
  return null;
}
function kgSaveActive(profile, source = 'login') {
  const p = kgProfileName(profile);
  const obj = { profile: p, source, at: new Date().toISOString() };
  const primary = kgActiveFile('user');
  const remember = (pathUsed, fallback) => {
    kgActiveMemo = { profile: p, source };
    return { ok: true, profile: p, path: pathUsed, error: null, ...(fallback ? { fallback: true } : {}) };
  };
  try {
    kgWriteJsonAtomic(primary, obj);
    /* 新目录写成功后清掉旧目录的同名文件，避免以后被误读 */
    const legacyActive = kgActiveFile('legacy');
    if (legacyActive) { try { fs.unlinkSync(legacyActive); } catch { /* 不存在 / 只读 */ } }
    return remember(primary, false);
  } catch (e1) {
    const old = kgActiveFile('legacy');
    if (!kgIsPackaged() && old) {
      try {
        kgWriteJsonAtomic(old, obj);
        console.warn('  酷狗 active-profile 写不进用户目录，已回退到项目 services/kugou-api:', e1.message);
        return remember(old, true);
      } catch (e2) {
        kgActiveMemo = { profile: p, source };
        return { ok: false, profile: p, path: primary, error: `${e1.message}；回退也失败：${e2.message}` };
      }
    }
    /* 写盘失败也先把本次会话的 active 记住，重启后再按 jar 里最后的登录推断 */
    kgActiveMemo = { profile: p, source };
    console.warn('  酷狗 active-profile 写盘失败:', e1.message);
    return { ok: false, profile: p, path: primary, error: String((e1 && e1.message) || e1) };
  }
}

/** 当前应该用哪一版。规则（不涉及 VIP）：
    1) active-profile.json 里那一版有 token → 用它；
    2) 它没 token、另一版有 token → 用另一版；
    3) 都没有 → normal 匿名。
    首次升级（没有 active-profile.json）时按 jar 的修改时间当作「最后登录」，
    并立刻落盘，后续不再随 VIP 检测结果漂移。 */
function kgResolveActive(force = false) {
  if (!force && kgActiveMemo) return kgActiveMemo;
  const hasToken = (p) => !!kgJarGet(p).token;
  const saved = kgReadActiveFile();
  let profile = 'normal';
  let source = 'default';
  let detail = '';
  if (saved) {
    if (hasToken(saved.profile)) {
      profile = saved.profile;
      source = saved.source;
    } else {
      const other = kgOtherProfile(saved.profile);
      if (hasToken(other)) {
        profile = other;
        source = 'fallback-token';
        detail = `${saved.profile} 没有 token，退回 ${other}`;
      } else {
        profile = 'normal';
        source = 'anonymous';
        detail = `${saved.profile} 没有 token，两版都未登录`;
      }
    }
  } else {
    const n = hasToken('normal');
    const l = hasToken('lite');
    if (n && l) {
      profile = kgJarMtime('lite') > kgJarMtime('normal') ? 'lite' : 'normal';
      source = 'migrated-mtime';
    } else if (l) {
      profile = 'lite';
      source = 'migrated-token';
    } else if (n) {
      profile = 'normal';
      source = 'migrated-token';
    }
    if (n || l) kgSaveActive(profile, source);
  }
  kgActiveMemo = { profile, source, detail };
  return kgActiveMemo;
}
function kgActiveContext() {
  const a = kgResolveActive();
  return {
    profile: a.profile,
    source: a.source,
    sidecar: kgSidecarName(a.profile),
    cookie: kgCookie(a.profile),
    jar: kgJarGet(a.profile),
  };
}
/** 账号类接口（我喜欢 / 我的歌单）还要求 userid。active 缺 token 或 userid 时
    用另一版已登录的 jar —— 同一账号两版同步，不能因为 VIP 判定失败回 401。 */
function kgUserContext() {
  const a = kgActiveContext();
  if (a.jar.token && a.jar.userid) return a;
  const other = kgOtherProfile(a.profile);
  const jar = kgJarGet(other);
  if (jar.token && jar.userid) {
    return {
      profile: other,
      source: 'user-fallback',
      sidecar: kgSidecarName(other),
      cookie: kgCookie(other),
      jar,
    };
  }
  return a;
}

/** 从 /user/detail、/user/vip/detail 的响应判断某个版本的 VIP。
 *  envelope / data 嵌套都看；普通版只认非 concept 条目，概念版只认 busi_type==='concept'
 *  （字段见 kugoumusicapi 的 user_vip_detail.js：busi_vip[].is_vip / busi_type）。 */
function kgVipInfo(data, profile = 'normal') {
  if (!data || typeof data !== 'object') return false;
  const layers = [data];
  if (data.data && typeof data.data === 'object') layers.push(data.data);
  for (const d of layers) {
    if (Number(d.vip_type) > 0) return true;
    if (d.is_vip === true || d.is_vip === 1 || Number(d.is_vip) > 0) return true;
  }
  const busi = [];
  for (const d of layers) {
    if (Array.isArray(d.busi_vip)) busi.push(...d.busi_vip);
  }
  for (const it of busi) {
    if (!it || typeof it !== 'object') continue;
    if (!(it.is_vip === true || it.is_vip === 1 || Number(it.is_vip) > 0)) continue;
    const type = String(it.busi_type || it.busiType || '').toLowerCase();
    if (kgProfileName(profile) === 'lite') {
      if (type === 'concept') return true;
    } else if (type && type !== 'concept') {
      return true;
    }
  }
  return false;
}

/* 状态结果缓存：只缓存「两版各自的登录 / VIP 显示」，不参与 active 选路。
   登录 / 登出 / platform/evaluate 立即失效。 */
const KG_EVAL_TTL = 10 * 60 * 1000;
const kgPlatform = {
  active: 'normal',
  activeProfile: 'normal',
  profileSource: 'default',
  normal: { loggedIn: false, vip: false },
  lite: { loggedIn: false, vip: false },
  checkedAt: 0,
  promise: null,
};
let kgEvalGen = 0;
function kgPlatformSnapshot() {
  /* 还没算过时用磁盘上的 active，避免启动后第一眼把 lite 误报成 normal */
  const quick = kgResolveActive();
  const evaluated = kgPlatform.checkedAt > 0;
  const active = evaluated ? kgPlatform.active : quick.profile;
  return {
    code: 200,
    active,
    activeProfile: evaluated ? (kgPlatform.activeProfile || active) : quick.profile,
    profileSource: evaluated ? (kgPlatform.profileSource || quick.source) : quick.source,
    normal: { ...kgPlatform.normal },
    lite: { ...kgPlatform.lite },
    checkedAt: evaluated ? new Date(kgPlatform.checkedAt).toISOString() : null,
  };
}
function kgActiveSidecar() { return kgActiveContext().sidecar; }
function kgActiveCookie() { return kgActiveContext().cookie; }
function kgActiveJar() { return kgActiveContext().jar; }
function kgInvalidateEval() {
  kgPlatform.checkedAt = 0;
  kgEvalGen++;
  kgActiveMemo = null;       // 登录 / 退出后 active 规则要重新读 jar
}

/* 2026-11-22：这里原本会「帮用户领」酷狗概念版每日 1 天 VIP
   （/youth/day/vip + /youth/day/vip/upgrade，同一天一次，记录落
   .auth-state/vip-claim.json）。用户明确要求不提供这种代领服务，整段移除；
   这里只读账号当前 VIP。 */
async function kgLiteVipDetail(cookie, timeout = 20000) {
  try {
    /* 加时间戳：边车给所有响应挂了 2 分钟 apicache，登录 / 退出前后同一个 URL 会读到旧结果 */
    const r = await scRequest('kugouLite', `/user/vip/detail?_=${Date.now()}`,
      { cookie, timeout, cookieHeaderOnly: true });
    return r.data;
  } catch (e) {
    console.warn('  酷狗概念版 VIP 详情请求失败:', (e && e.code) || 'network');
    return null;
  }
}
/** 只计算显示用的登录 / VIP，不改 active。active 由 kgResolveActive 按登录记录决定。 */
async function kgEvaluatePlatform() {
  const act = kgResolveActive(true);
  const normal = { loggedIn: !!kgJarGet('normal').token, vip: false };
  const lite = { loggedIn: !!kgJarGet('lite').token, vip: false };

  /* 两版并行探测，单次 12s 上限；VIP 只用于显示，探测超时按「没探到」处理，
     不能让它拖垮设置页的 20s 前端超时。 */
  const normalProbe = (async () => {
    if (!normal.loggedIn) return;
    try {
      const r = await scRequest(kgSidecarName('normal'), `/user/detail?_=${Date.now()}`,
        { cookie: kgCookie('normal'), timeout: 12000, cookieHeaderOnly: true });
      normal.vip = kgVipInfo(r.data, 'normal');
      /* user/detail 明确回 status!=1 才算失效；网络/边车错误时保留 jar 里的登录态 */
      if (Number(r.data && r.data.status) !== 1) normal.loggedIn = false;
    } catch (e) {
      console.warn('  酷狗普通版 VIP 检测失败:', (e && e.code) || 'network');
    }
  })();
  const liteProbe = (async () => {
    if (!lite.loggedIn) return;
    const cookie = kgCookie('lite');
    /* user/detail 和概念版 VIP 详情互不依赖，并行查；串行最坏 24s 太久了。
       只读状态，不代领 —— 没有 VIP 就按没有处理。 */
    const detailP = (async () => {
      try {
        const r = await scRequest('kugouLite', `/user/detail?_=${Date.now()}`,
          { cookie, timeout: 12000, cookieHeaderOnly: true });
        lite.vip = kgVipInfo(r.data, 'lite');
        if (Number(r.data && r.data.status) !== 1) lite.loggedIn = false;
      } catch (e) {
        console.warn('  酷狗概念版 VIP 检测失败:', (e && e.code) || 'network');
      }
    })();
    const vipP = (async () => {
      const v = kgVipInfo(await kgLiteVipDetail(cookie, 12000), 'lite');
      if (v) lite.vip = true;
    })();
    await Promise.all([detailP, vipP]);
  })();
  await Promise.all([normalProbe, liteProbe]);

  /* VIP 只影响显示，绝不参与 active */
  const active = act.profile;
  console.log(`  酷狗版本：active=${active}(${act.source}) normal logged=${normal.loggedIn} vip=${normal.vip}；lite logged=${lite.loggedIn} vip=${lite.vip}`);
  return { normal, lite, active, activeProfile: active, profileSource: act.source };
}
async function kgEnsureEvaluated(force = false) {
  const fresh = () => kgPlatform.checkedAt > 0 && Date.now() - kgPlatform.checkedAt < KG_EVAL_TTL;
  if (!force && fresh()) return kgPlatformSnapshot();
  if (kgPlatform.promise) {
    try { await kgPlatform.promise; } catch { /* 内部已吞 */ }
    if (!force && fresh()) return kgPlatformSnapshot();
  }
  const gen = ++kgEvalGen;
  kgPlatform.promise = kgEvaluatePlatform()
    .then((out) => {
      if (gen !== kgEvalGen) return;   // 期间登录 / 登出过：这份结果作废
      kgPlatform.normal = out.normal;
      kgPlatform.lite = out.lite;
      kgPlatform.active = out.active;
      kgPlatform.activeProfile = out.activeProfile || out.active;
      kgPlatform.profileSource = out.profileSource || kgResolveActive().source;
      kgPlatform.checkedAt = Date.now();
    })
    .catch((e) => console.warn('  酷狗状态检测失败:', (e && e.code) || (e && e.message) || 'unknown'))
    .finally(() => { if (gen === kgEvalGen) kgPlatform.promise = null; });
  await kgPlatform.promise;
  return kgPlatformSnapshot();
}

/** 扫码成功那一轮：token / userid / vip_type / vip_token 可能在 Set-Cookie，
    也可能只在上游 body（data 里）。两处都抓；空值不覆盖已有字段。 */
function kgLoginFields(r) {
  const out = {};
  const keys = ['token', 'userid', 'vip_type', 'vip_token'];
  const put = (k, v) => {
    if (!keys.includes(k) || v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s || s === 'undefined' || s === 'null') return;
    if (k === 'userid' && s === '0') return;
    out[k] = s;
  };
  /* body：酷狗是 { status, data: { status:4, token, userid, … } }，多包几层都认 */
  let d = r && r.data;
  for (let depth = 0; depth < 4; depth++) {
    if (!d || typeof d !== 'object') break;
    for (const k of keys) put(k, d[k]);
    d = d.data;
  }
  for (const line of (r && r.setCookies) || []) {
    const pair = String(line).split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) put(pair.slice(0, i).trim(), pair.slice(i + 1));
  }
  return out;
}

/** 诊断字段：只给「有没有 token / userid」和目录是否可写，绝不返回 token 本身。 */
function kgDiagnostics() {
  const profiles = {};
  for (const p of ['normal', 'lite']) {
    const jar = kgJarGet(p);
    profiles[p] = {
      hasToken: !!jar.token,
      hasUserid: !!jar.userid,
      vipType: jar.vip_type != null && String(jar.vip_type) !== '' ? String(jar.vip_type) : '',
    };
  }
  return {
    jarDir: kgUserDir(),
    jarWritable: kgDirWritable(kgUserDir()),
    packaged: kgIsPackaged(),
    profiles,
  };
}

/* ---------------- 各平台「原始条目 → 前端只认的那一种形状」 ---------------- */
/* 酷狗封面模板里的 {size} 是路径段（/stdmusic/{size}/…、/soft/collection/{size}/…），
   实测 240/400/480/500/800/1200 都能出图。曲目默认给 800（形态大图用）；
   缩略图由 API.img 按调用尺寸重写回小档。 */
const KUGOU_TRACK_COVER_SIZE = '800';
/** 酷狗：字段是 PascalCase，hash 才是播放键（不是数字 id） */
function kugouTrack(it) {
  const singers = Array.isArray(it.Singers) ? it.Singers : [];
  const artist = singers.map((s) => s.name).filter(Boolean).join(' / ')
    || String(it.SingerName || '').split(/[、,&]/).map((s) => s.trim()).filter(Boolean).join(' / ');
  let name = it.SongName || '';
  if (!name) {
    const fn = String(it.FileName || '');
    const cut = fn.indexOf(' - ');
    name = cut > 0 ? fn.slice(cut + 3) : fn;
  }
  const tpl = it.trans_param && it.trans_param.union_cover;
  return {
    id: it.FileHash,
    source: 'kugou',
    name,
    artists: artist || '未知歌手',
    artistIds: singers.map((s) => s.id).filter(Boolean).map(String),
    album: it.AlbumName || '',
    albumId: it.AlbumID ? String(it.AlbumID) : '',
    cover: tpl ? String(tpl).replace('{size}', KUGOU_TRACK_COVER_SIZE) : '',
    duration: (it.Duration || 0) * 1000,
    // PayType: 0 免费 / 2 试听或付费 / 3 付费。只用来打小签，实际能不能放看 /song/url
    fee: Number(it.PayType) > 0 ? 1 : 0,
    hash: it.FileHash,
    /* 播放取流只认 FileHash + MixSongID。Audioid / Scid 不是 album_audio_id：
       实测把它当 album_audio_id 传给 /v5/url，上游会按它返回**另一首**的音频
       （2026-11-13：请求 5A94CCD… 热爱105°C的你，拿到 8044B902… You Are My Joy）。
       搜索条目没有 album_audio_id，MixSongID 才是这一条的曲目键。 */
    albumAudioId: Number(it.MixSongID || it.EMixSongID || it.AlbumAudioID || it.album_audio_id) || 0,
    albumIdNum: Number(it.AlbumID) || 0,
  };
}

/** 汽水：ByteDance 的字段全在 base_info / related_info / display_info 里 */
function pickCover(c) {
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (c.url) return c.url;
  const base = Array.isArray(c.urls) ? c.urls[0] : (typeof c.urls === 'string' ? c.urls.split(' ')[0] : '');
  const uri = c.uri || '';
  if (!base || !uri) return '';
  /* 汽水的封面是「前缀 + uri + 图片处理模板」。**不带模板会 400**（实测：
     https://p3-luna.douyinpic.com/img/<uri>           → 400 application/json
     https://p3-luna.douyinpic.com/img/<uri>~tplv-…    → 200 image/jpeg）
     template 为空时用 `~<template_prefix>-image.image`，这是实测能出图的那个。 */
  /* 汽水的 resize 模板接受任意尺寸（实测 120~2000 都出图），480 只够列表小图，
     形态把封面放大时会糊。服务端统一给 800（约 86KB/张），列表缩略图由
     API.img 按调用尺寸改回小档；模板里已经写死 resize 尺寸的也一并改成 800。 */
  const QISHUI_COVER_SIZE = '800';
  const suffix = c.template_prefix
    ? (c.template
        ? `~${c.template_prefix}-${String(c.template).replace(/resize:\d+:\d+/, `resize:${QISHUI_COVER_SIZE}:${QISHUI_COVER_SIZE}`)}`
        : `~${c.template_prefix}-resize:${QISHUI_COVER_SIZE}:${QISHUI_COVER_SIZE}.image`)
    : '';
  return base + uri + suffix;
}
function qishuiTrack(it) {
  const b = it.base_info || {};
  const rel = it.related_info || {};
  const d = it.display_info || {};
  const artists = (rel.artist_links || []).map((a) => a.name).filter(Boolean);
  return {
    id: String(b.id || it.id || ''),
    source: 'qishui',
    name: b.name || '',
    artists: artists.join(' / ') || '未知歌手',
    artistIds: (rel.artist_links || []).map((a) => String(a.id)).filter(Boolean),
    album: (rel.album_link && rel.album_link.name) || '',
    albumId: (rel.album_link && String(rel.album_link.id)) || '',
    cover: pickCover(d.cover_url),
    duration: Number(b.duration_ms) || 0,
    fee: 0,
  };
}

/** 汽水歌单：base_info.title + display_info.url_cover（和曲目不是同一套字段） */
function qishuiPlaylist(it) {
  const b = it.base_info || it;
  const d = it.display_info || {};
  const rel = it.relation_info || {};
  const owner = rel.owner || {};
  const stats = it.stats || {};
  return {
    id: String(b.id || it.id || ''),
    source: 'qishui',
    name: b.title || b.name || '未命名歌单',
    cover: pickCover(d.url_cover || d.cover_url || d.cover),
    trackCount: Number(b.resource_cnt ?? b.resource_count ?? stats.count ?? it.resource_cnt) || 0,
    playCount: Number(stats.play_count ?? stats.playCount ?? b.play_count) || 0,
    creator: { nickname: owner.nickname || owner.name || b.owner_nickname || '' },
    // type=1 是账号的「我喜欢的音乐」歌单，前端据此挑红心
    type: Number(b.type) || 0,
  };
}

/** 汽水场景电台（/feed/modes）：点一张就按 scene 取推荐流 */
function qishuiScene(m) {
  return {
    id: String(m.id || ''),
    source: 'qishui',
    name: m.name || m.title || '场景电台',
    cover: pickCover(m.coverUrl || m.cover_url || m.cover),
    trackCount: 0,
    playCount: 0,
    creator: { nickname: m.group || '' },
  };
}

/** 波点：PascalCase + 小写混着来，artist 直接给了字符串 */
function bodianTrack(it) {
  const artists = Array.isArray(it.artists) ? it.artists.map((a) => a.name).filter(Boolean) : [];
  return {
    id: String(it.id || it.musicRid || ''),
    source: 'bodian',
    name: it.name || it.songName || it.FSONGNAME || '',
    artists: it.artist || artists.join(' / ') || '未知歌手',
    artistIds: [it.artistId].filter(Boolean).map(String),
    album: it.album || '',
    albumId: it.albumId ? String(it.albumId) : '',
    cover: it.albumPic || it.albumPic120 || '',
    duration: (Number(it.duration) || 0) * 1000,
    fee: it.payInfo && Number(it.payInfo.payType) > 0 ? 1 : 0,
  };
}

/** 波点歌单：推荐流给 pic/musicCount/creatorName，收藏页给别的名字，这里一起兜住
 *  sourceType 决定取曲目时传给上游的 source，传错会回 200 + 空列表（不是报错）：
 *    - 公开集合/推荐/收藏歌单：4（默认）
 *    - 系统红心歌单、自建歌单：5。自建歌单在 userCreate 里可能整条没有 sourceType，
 *      协议要求宿主归一化为 5（bodian-music-api docs/protocol.md）。
 *  所以这里默认 4，调用方按来源（owned/liked）传 fallbackSource=5。 */
function bodianPlaylist(it, fallbackSource = 4) {
  return {
    id: String(it.id || it.playlistId || it.fid || ''),
    source: 'bodian',
    name: it.name || it.title || it.playlistName || '未命名歌单',
    cover: it.pic || it.cover || it.img || it.coverUrl || '',
    trackCount: Number(it.musicCount ?? it.songCount ?? it.total ?? it.count ?? it.songNum) || 0,
    playCount: Number(it.playNum ?? it.play_count ?? it.playCount) || 0,
    creator: { nickname: it.creatorName || it.nickname || it.userName || '' },
    sourceType: Number(it.sourceType) || fallbackSource,
  };
}

/** 波点 user_playlists 的 owned/liked/collected 三块形状不统一，按已知字段找数组 */
function bodianPlaylistRows(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  for (const c of [x.playLists, x.list, x.info, x.data, x.result, x.rows]) {
    if (Array.isArray(c)) return c;
  }
  if (x.data && typeof x.data === 'object') {
    for (const c of [x.data.playLists, x.data.list, x.data.info, x.data.result, x.data.rows]) {
      if (Array.isArray(c)) return c;
    }
  }
  return [];
}

/**
 * 波点「我收藏的专辑」原始条目 → 和网易云 album/sublist 对齐的字段。
 * 收藏歌单和收藏专辑在波点共用 /service/collect/4/list（靠 sourceType=6 分流），
 * 所以字段名和 bodianPlaylist 是同一套；再补上专辑可能用的 albumName / singer 写法。
 */
function bodianUserAlbum(it) {
  const artist = it.artist || it.artistName || it.singer || it.singerName || it.creatorName || it.nickname || '未知歌手';
  const cover = it.pic || it.cover || it.img || it.coverUrl || it.albumPic || it.albumPic120 || '';
  const size = Number(it.musicCount ?? it.songCount ?? it.total ?? it.count ?? it.songNum ?? 0) || 0;
  return {
    id: String(it.id || it.albumId || it.albumIdStr || it.rid || it.musicRid || ''),
    name: it.name || it.title || it.albumName || it.album_name || '未知专辑',
    /* 和网易云一样给对象数组，前端 impAlbum 不用为波点再写一套 */
    artists: [{ name: String(artist) }],
    /* 契约字段（和 /api/kugou/user/albums 一致） */
    picUrl: cover,
    size,
    source: 'bodian',
    /* 兼容旧字段：之前的波点映射只给 cover / trackCount */
    cover,
    trackCount: size,
    publishTime: Number(it.publishTime ?? it.pubTime ?? it.pubtime ?? it.releaseTime ?? 0) || 0,
  };
}

/** Spotify：只做元数据。preview_url 大部分是空的，别指望靠它出声 */
function spotifyTrack(it) {
  const imgs = (it.album && it.album.images) || [];
  return {
    id: String(it.id || ''),
    source: 'spotify',
    name: it.name || '',
    artists: (it.artists || []).map((a) => a.name).filter(Boolean).join(' / ') || '未知歌手',
    artistIds: (it.artists || []).map((a) => String(a.id)).filter(Boolean),
    album: (it.album && it.album.name) || '',
    albumId: (it.album && String(it.album.id)) || '',
    cover: (imgs[0] && imgs[0].url) || '',
    duration: Number(it.duration_ms) || 0,
    fee: 1,                       // 打「仅元数据」小签用
    externalUrl: (it.external_urls && it.external_urls.spotify) || '',
  };
}

/** 酷我：搜索是 PascalCase（NAME/ARTIST/DURATION 秒），歌单/榜单是 camelCase（name/rid/album） */
function kuwoTrack(it) {
  const rid = String(
    it.rid || it.DC_TARGETID || String(it.MUSICRID || it.musicrid || '').replace(/^MUSIC_/i, '') || it.id || ''
  );
  const name = it.name || it.NAME || it.SONGNAME || '';
  const artist = it.artist || it.ARTIST || it.FARTIST || '';
  /* 搜索接口只给相对路径（120/s3s94/93/211513640.jpg），歌单给完整 URL。
     相对路径的 120 是缩略档，实测 CDN 的 /star/albumcover/ 支持 120/300/500/800，
     统一换 800（约 90~245KB，形态大图够用）；歌单/榜单原本就是 500 的顺手升到 800。 */
  let cover = it.pic || it.albumpic || it.albumpic_short || it.web_albumpic_short || '';
  if (cover && !/^https?:\/\//i.test(cover)) {
    cover = 'https://img1.kuwo.cn/star/albumcover/' + String(cover).replace(/^\/+/, '');
  }
  cover = String(cover).replace(/\/star\/albumcover\/(?:120|300|500|750|800)\//, '/star/albumcover/800/');
  const albumId = it.albumid || it.ALBUMID || '';
  return {
    id: rid,
    source: 'kuwo',
    name,
    artists: artist || '未知歌手',
    artistIds: it.artistid || it.ARTISTID ? [String(it.artistid || it.ARTISTID)] : [],
    album: it.album || it.ALBUM || '',
    albumId: albumId ? String(albumId) : '',
    cover,
    duration: (Number(it.duration || it.DURATION) || 0) * 1000,
    // 酷我直链匿名就能拿到完整时长（mobi convert_url2），不拿 pay 字段吓人
    fee: 0,
  };
}

/** 酷我歌单 / 榜单条目：榜单的播放入参是 menu 项里的 sourceid（热歌榜=16），不是 489927 */
function kuwoPlaylist(it) {
  return {
    id: String(it.sourceid || it.id || ''),
    source: 'kuwo',
    name: it.name || '未命名歌单',
    cover: it.img || it.img500 || it.img300 || it.pic || '',
    trackCount: Number(it.total) || 0,
    playCount: Number(it.listencnt) || 0,
    creator: { nickname: it.uname || it.userName || '' },
    rank: !!it.sourceid,
  };
}

/* ---------------- /api/kugou/* ---------------- */
async function handleKugou(req, res, url) {
  const part = url.pathname.slice('/api/kugou/'.length);
  const q = url.searchParams;

  /* 当前用哪一版只看登录记录（最后登录 / token），VIP 不参与选路。
     业务请求直接读这个上下文，不再等待 VIP 检测 —— 检测失败也不会退回无 token 的 normal。 */
  const ctx = kgActiveContext();
  const active = ctx.profile;
  const sidecar = ctx.sidecar;
  const cookie = ctx.cookie;
  const jar = ctx.jar;
  let logSidecar = sidecar;   // 出错时读对应边车的 .log（登录接口可能用的是另一版）

  /* 平台信息：evaluate 强制重算，platform 读 10 分钟缓存（没有缓存就先算一次） */
  if (part === 'platform' || part === 'platform/evaluate') {
    const ev = await kgEnsureEvaluated(part === 'platform/evaluate');
    return json(res, 200, ev);
  }

  /* status 才需要探测两版 VIP；其它接口（含 health）不碰它。
     health 是存活/启动探测，没必要为了显示 VIP 先等两轮 /user/detail。 */
  let ev = null;
  const needEval = async (force = false) => {
    if (!ev || force) ev = await kgEnsureEvaluated(force);
    return ev;
  };

  if (part === 'health') {
    /* active / 登录态只看 jar 有没有 token；VIP 显示由 /status 负责 */
    const act = kgResolveActive(true);
    const normalState = { loggedIn: !!kgJarGet('normal').token, vip: false };
    const liteState = { loggedIn: !!kgJarGet('lite').token, vip: false };
    try {
      /* 设置页两行各有各的 profile：普通版探 kugou，概念版探 kugouLite；
         带了 profile 就起那一版，没带才跟当前 active。 */
      const probe = q.get('profile') === 'lite' ? 'lite' : (q.get('profile') === 'normal' ? 'normal' : active);
      const probeSidecar = kgSidecarName(probe);
      logSidecar = probeSidecar;
      const port = await ensureSidecar(probeSidecar);
      return json(res, 200, {
        code: 200, ok: true, port, node: process.versions.node,
        platform: act.profile, activeProfile: act.profile, profileSource: act.source,
        probe,
        loggedIn: normalState.loggedIn || liteState.loggedIn,
        normal: normalState, lite: liteState,
      });
    } catch (err) {
      return json(res, 502, {
        code: 502, ok: false, error: String(err.message), reason: err.reason || null,
        platform: act.profile, activeProfile: act.profile, profileSource: act.source,
        normal: normalState, lite: liteState, log: scLogTail(logSidecar),
      });
    }
  }

  try {
    if (part === 'status') {
      const diag = kgDiagnostics();
      /* active / 两版有没有 token 都只看磁盘，不依赖 VIP 探测 */
      const act = kgResolveActive(true);
      const activeNow = act.profile;
      /* 两版 VIP 显示评估 + 当前版身份探测并行：以前先 await 评估再探测，
         两次等待叠加会顶穿前端 20s 超时。 */
      const evalP = needEval();
      /* 候选只看 jar 里有没有 token；VIP 判定失败不参与「是否登录」 */
      const candidates = [];
      if (kgJarGet(activeNow).token) candidates.push(activeNow);
      for (const p of ['normal', 'lite']) {
        if (p !== activeNow && kgJarGet(p).token) candidates.push(p);
      }
      /* 候选并行问；结果按 candidates 的顺序取第一个成功的（active 优先）。 */
      const probeP = candidates.length
        ? Promise.all(candidates.map(async (who) => {
            try {
              const r = await scRequest(kgSidecarName(who), `/user/detail?_=${Date.now()}`,
                { cookie: kgCookie(who), timeout: 12000, cookieHeaderOnly: true });
              if (Number(r.data && r.data.status) !== 1) return null;
              const d = (r.data && r.data.data) || {};
              return { who, r, d };
            } catch { return null; }
          })).then((list) => list.find(Boolean) || null)
        : Promise.resolve(null);
      const e = await evalP;
      const hit = await probeP;
      const base = {
        code: 200,
        platform: e.activeProfile || e.active || activeNow,
        activeProfile: e.activeProfile || e.active || activeNow,
        profileSource: e.profileSource || act.source,
        normal: e.normal,
        lite: e.lite,
        /* 诊断用：路径 / 是否可写 / 两版 jar 里有没有 token（不含 token 值） */
        jarDir: diag.jarDir,
        jarWritable: diag.jarWritable,
        packaged: diag.packaged,
        profiles: diag.profiles,
      };
      if (!candidates.length) {
        return json(res, 200, { ...base, loggedIn: false, vip: false, error: null });
      }
      if (hit) {
        /* VIP 只属于「真正回答 /user/detail 的这一版」，不能拿另一版的 VIP 冒充 */
        return json(res, 200, {
          ...base,
          loggedIn: true,
          profile: hit.who,
          vipProfile: hit.who,
          nickname: hit.d.nickname || hit.d.user_name || '酷狗用户',
          avatar: hit.d.pic || hit.d.avatar || '',
          uid: String(hit.d.userid || kgJarGet(hit.who).userid || ''),
          vip: kgVipInfo(hit.r.data, hit.who),
          error: null,
        });
      }
      return json(res, 200, {
        ...base, loggedIn: false, vip: false,
        error: '登录态可能已过期（重新扫码）',
      });
    }

    /* ---- 登录 / 登出：?profile=lite 走概念版边车和概念版 jar（默认 normal） ---- */
    const loginProfile = q.get('profile') === 'lite' ? 'lite' : 'normal';
    const loginSidecar = kgSidecarName(loginProfile);

    if (part === 'login/qr/key') {
      logSidecar = loginSidecar;
      const r = await scRequest(loginSidecar, '/login/qr/key', { timeout: 20000 });
      const key = r.data && r.data.data && (r.data.data.qrcode || r.data.data.key);
      if (!key) return json(res, 200, { code: 502, key: null, error: (r.data && (r.data.error || r.data.message)) || '拿不到二维码 key' });
      return json(res, 200, { code: 200, key, profile: loginProfile });
    }

    if (part === 'login/qr/create') {
      logSidecar = loginSidecar;
      const key = q.get('key') || '';
      if (!key) return json(res, 400, { code: 400, error: 'key required' });
      const r = await scRequest(loginSidecar, `/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true`);
      const img = r.data && r.data.data && r.data.data.base64;
      if (!img) return json(res, 200, { code: 502, qrimg: '', key, error: (r.data && r.data.message) || '二维码生成失败（上游没给图片）' });
      return json(res, 200, { code: 200, key, qrimg: img, profile: loginProfile });
    }

    if (part === 'login/qr/check') {
      logSidecar = loginSidecar;
      const key = q.get('key') || '';
      if (!key) return json(res, 400, { code: 400, error: 'key required' });
      /* 12s 上限：前端每次轮询只等 20s，成功那一轮后面还要查昵称/VIP，
         这里等太久会把 803 整条顶穿（登录其实已成功，界面却报超时）。 */
      const r = await scRequest(loginSidecar, `/login/qr/check?key=${encodeURIComponent(key)}`, { timeout: 12000 });
      // 酷狗：0 过期 / 1 等待 / 2 待确认 / 4 成功（成功那一轮带 token+userid）
      const st = Number(r.data && r.data.data && r.data.data.status);
      const MAP = { 0: 800, 1: 801, 2: 802, 4: 803 };
      const out = { code: MAP[st] || 801, state: st, profile: loginProfile };
      if (st === 4) {
        /* 两处都抓：Set-Cookie + body/data。以前只看 Set-Cookie，
           概念版有一轮只在 body 里给 token，结果「扫完还是未登录」。 */
        const fields = kgLoginFields(r);
        const missing = ['token', 'userid'].filter((k) => !fields[k]);
        if (missing.length) {
          return json(res, 200, {
            code: 502, state: 4, profile: loginProfile, loggedIn: false,
            error: `酷狗已确认扫码，但上游没有返回 ${missing.join(' / ')}，登录未保存；请重新扫码`,
          });
        }
        const next = { ...kgJarGet(loginProfile), ...fields };
        const wrote = kgJarWrite(next, loginProfile);
        if (!wrote.ok) {
          return json(res, 200, {
            code: 502, state: 4, profile: loginProfile, loggedIn: false,
            error: `酷狗登录凭据写盘失败（${wrote.error || '未知原因'}），登录未保存；请检查用户数据目录权限后重试`,
          });
        }
        /* 回读校验：token + userid 必须都在，且就是刚写进去的那两个值。
           不通过就不能对前端说「已登录」。 */
        const saved = kgJarGet(loginProfile);
        const verified = saved.token && saved.userid
          && String(saved.token) === String(fields.token)
          && String(saved.userid) === String(fields.userid);
        if (!verified) {
          return json(res, 200, {
            code: 502, state: 4, profile: loginProfile, loggedIn: false,
            error: '酷狗登录凭据回读校验失败（token / userid 缺失或与本次扫码不一致），请重新扫码',
          });
        }
        /* 最后成功登录的版本 = 以后一直使用的版本；VIP 不参与 */
        const act = kgSaveActive(loginProfile, 'login');
        kgInvalidateEval();
        out.loggedIn = true;
        /* active-profile 没写成功时按磁盘现状重新解析，不能只是嘴上说已经切换 */
        const resolved = act.ok ? act : kgResolveActive(true);
        out.activeProfile = resolved.profile;
        out.platform = resolved.profile;
        out.profileSource = act.ok ? 'login' : resolved.source;
        out.jarPath = wrote.path;
        out.jarFallback = !!wrote.fallback;
        if (!act.ok) out.activePersistError = act.error || 'active-profile 写入失败';
        /* 昵称 / VIP 并行取，各自 6s 上限。**不再在 803 里做两版全量评估**：
           前端这次请求只等 20s，两版 /user/detail（各 12s）会把成功响应顶穿，
           用户看到的是超时，登录其实已经保存了。另一个版本的 VIP/登录态
           由设置页 1.2s 后自己调 /status 校正。
           VIP 只用于显示，绝不参与版本选择。 */
        const detailProbe = (async () => {
          try {
            const who = await scRequest(loginSidecar, `/user/detail?_=${Date.now()}`,
              { cookie: kgCookie(loginProfile), timeout: 6000, cookieHeaderOnly: true });
            const d = (who.data && who.data.data) || {};
            out.nickname = d.nickname || d.user_name || '';
            out.avatar = d.pic || '';
            if (loginProfile === 'normal' && Number(who.data && who.data.status) === 1) {
              out.vip = kgVipInfo(who.data, 'normal');
            }
          } catch { /* 昵称查不到不影响登录 */ }
        })();
        const vipProbe = loginProfile === 'lite'
          ? kgLiteVipDetail(kgCookie('lite'), 6000).then((v) => { out.vip = kgVipInfo(v, 'lite'); })
          : Promise.resolve();
        await Promise.all([detailProbe, vipProbe]);
        out.vip = !!out.vip;
        out.normal = { loggedIn: !!kgJarGet('normal').token, vip: loginProfile === 'normal' ? out.vip : false };
        out.lite = { loggedIn: !!kgJarGet('lite').token, vip: loginProfile === 'lite' ? out.vip : false };
      }
      return json(res, 200, out);
    }

    if (part === 'logout') {
      const before = kgResolveActive(true);
      kgJarWrite({}, loginProfile);
      kgInvalidateEval();
      /* 退出的是当前使用的那一版：切到另一个已登录版本；两边都没有就 normal 匿名。
         退出另一版不动 active。 */
      if (before.profile === loginProfile) {
        const other = kgOtherProfile(loginProfile);
        const next = kgJarGet(other).token ? other : 'normal';
        kgSaveActive(next, 'logout-switch');
      }
      /* 退出请求里不再等两版探测（最坏十几秒，会把前端 20s 超时顶穿）。
         前端退出后会立刻重读 /status，这里只回落盘现状：先让界面马上收回来，
         VIP 由紧接着的 /status 再算。 */
      const act = kgResolveActive(true);
      const stateOf = (p) => ({ loggedIn: !!kgJarGet(p).token, vip: false });
      return json(res, 200, {
        code: 200, loggedIn: false, profile: loginProfile,
        platform: act.profile, active: act.profile,
        activeProfile: act.profile,
        profileSource: act.source,
        normal: stateOf('normal'), lite: stateOf('lite'),
      });
    }

    if (part === 'search') {
      const s = (q.get('s') || q.get('keywords') || '').trim();
      if (!s) return json(res, 200, { code: 200, source: 'kugou', tracks: [], songCount: 0 });
      const limit = Math.min(30, Math.max(1, Number(q.get('limit')) || 20));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const r = await scRequest(sidecar,
        `/search?keywords=${encodeURIComponent(s)}&page=${page}&pagesize=${limit}`, { cookie });
      const d = (r.data && r.data.data) || {};
      const lists = Array.isArray(d.lists) ? d.lists : [];
      if (!lists.length) {
        return json(res, 200, {
          code: 200, source: 'kugou', tracks: [], songCount: 0,
          error: (r.data && (r.data.error || r.data.message)) || (Number(r.data && r.data.status) === 1 ? '没有结果' : '酷狗搜索失败'),
        });
      }
      return json(res, 200, {
        code: 200,
        source: 'kugou',
        tracks: lists.map(kugouTrack).filter((t) => t.id && t.name),
        songCount: Number(d.total) || lists.length,
      });
    }

    if (part === 'song/url') {
      const hash = (q.get('hash') || q.get('id') || '').toLowerCase();
      if (!hash) return json(res, 400, { code: 400, error: 'hash required' });
      const albumId = Number(q.get('albumId')) || 0;
      const audioId = Number(q.get('albumAudioId')) || 0;
      const quality = ['128', '320', 'flac'].includes(q.get('quality')) ? q.get('quality') : '128';
      const base = `/song/url?hash=${hash}&album_id=${albumId}&album_audio_id=${audioId}&quality=${quality}`;
      /* 上游 /v5/url 以 album_audio_id 为准：它指向哪首就返回哪首，URL 里写的是那首的
         hash，我们传进去的 hash 被忽略。历史映射把 Audioid / audio_id 当成
         album_audio_id 传，所以出现「点 A 放 B」（2026-11-13 实测：
         热爱105°C的你 → You Are My Joy）。现在每个 URL 都核对 URL 里的文件 hash，
         不一致就丢弃，再用 hash-only（album_id=0、album_audio_id=0）重取；
         仍不一致就如实返回空地址，绝不把别人的音频交给播放器。 */
      const hashOnly = `/song/url?hash=${hash}&album_id=0&album_audio_id=0&quality=${quality}`;
      let upstream = '';
      const tryOne = async (path) => {
        try {
          const r = await scRequest(sidecar, path, { cookie });
          const p = kugouUrlOf(r.data);
          if (p.upstream && !upstream) upstream = p.upstream;
          if (!p.url) return null;
          const got = kugouUrlHash(p.url);
          if (got && got !== hash) {
            if (!upstream) upstream = `hash mismatch (requested ${hash}, got ${got})`;
            return null;
          }
          return p;
        } catch (e) {
          if (!upstream) upstream = String((e && e.message) || e);
          return null;
        }
      };
      let pick = null;
      /* 先按条目给的 album_audio_id 取（有会员时这是唯一能定位到具体录音的键），
         失败/串号再试 hash-only；试听片段最后（free_part=1）。
         酷狗对匿名播放会回 20028「本次请求需要验证」（天御风控），四条都失败才算要登录。 */
      for (const path of [base, hashOnly, base + '&free_part=1', hashOnly + '&free_part=1']) {
        pick = await tryOne(path);
        if (pick) break;
      }
      pick = pick || { url: '', preview: false };
      const needLogin = /20028|需要验证|check r failed/.test(String(upstream || ''));
      return json(res, 200, {
        code: 200,
        hash,
        profile: active,          // 本次取流实际用的版本（排查用，不含 token）
        url: pick.url || '',
        preview: !!pick.preview,
        quality: pick.preview ? 'preview' : quality,
        reason: pick.url ? null : (needLogin ? 'login' : 'unavailable'),
        // 上游原话带出去，排查时不用猜（前端不显示）
        upstream: upstream || null,
      });
    }

    if (part === 'lyric') {
      const hash = (q.get('hash') || q.get('id') || '').toLowerCase();
      const keyword = (q.get('s') || '').trim();
      const singer = (q.get('singer') || q.get('artists') || q.get('artist') || '').trim();
      const durationMs = Number(q.get('duration')) || 0;
      if (!hash && !keyword) return json(res, 400, { code: 400, error: 'hash or s required' });
      /* 歌词要两步：先 search/lyric 拿 id+accesskey，再 /lyric?decode=1&fmt=krc。
         边车里 /lyric 默认就是 krc；拿不到 id/accesskey（匿名限流等）时回空歌词，
         歌词接口本身不报错（海报、播放页都按「没有歌词」处理）。
         候选必须和当前曲目对得上（见 kugouLyricPick 上方实测记录），
         对不上就回空词 —— 绝不退回「随便挑第一个候选」。 */
      try {
        const sr = await scRequest(sidecar,
          `/search/lyric?keywords=${encodeURIComponent(keyword || hash)}&hash=${hash}&man=no&client=android`, { cookie });
        const sd = sr.data || {};
        /* 边车的 /search/lyric 是平铺返回；别的路由会包一层 data，两种都认 */
        const cand = Array.isArray(sd.candidates) ? sd.candidates
          : Array.isArray(sd.data && sd.data.candidates) ? sd.data.candidates : [];
        const hit = kugouLyricPick(cand, { title: keyword, artists: singer, duration: durationMs });
        if (!hit || !hit.id || !hit.accesskey) {
          return json(res, 200, { code: 200, lyric: '', yrc: '', tlyric: '', format: 'none' });
        }
        const lr = await scRequest(sidecar,
          `/lyric?id=${encodeURIComponent(hit.id)}&accesskey=${encodeURIComponent(hit.accesskey)}&decode=1&fmt=krc&charset=utf8`, { cookie });
        const ld = lr.data || {};
        const content = String(ld.decodeContent || (ld.data && ld.data.decodeContent) || '');
        if (!content) return json(res, 200, { code: 200, lyric: '', yrc: '', tlyric: '', format: 'none' });
        /* 有 `[毫秒,毫秒]` 行头才是 KRC；上游没有逐字歌词的歌会直接回整行 LRC */
        const isKrc = /^\[\d+,\d+\]/m.test(content);
        const lyric = isKrc ? krcToLrc(content) : content;
        const yrc = isKrc ? krcToYrc(content) : '';
        return json(res, 200, {
          code: 200, lyric, yrc, tlyric: '',
          format: yrc ? 'yrc' : (lyric ? 'lrc' : 'none'),
        });
      } catch (e) {
        return json(res, 200, {
          code: 200, lyric: '', yrc: '', tlyric: '', format: 'none',
          error: String((e && e.message) || e),
        });
      }
    }

    /* ---------------- 铺色态用的推荐 / 歌单 / 我的（2026-11-06） ----------------
       新歌速递 / 每日推荐 / 榜单都匿名可用；user/playlist 需要登录。
       条目字段和搜索结果的 PascalCase 不一样（这里是小写：songname / timelength / time_length），
       所以另用 kugouListTrack()。 */
    if (part === 'top/songs') {
      /* 上游这个接口的 type 不是「1=新歌」：带 type=1/2 都回 rankid不存在，
         不带参数才是新歌速递。所以只有明确给了别的 type 才透传。 */
      const type = Number(q.get('type')) || 0;
      const r = await scRequest(sidecar, type > 1 ? `/top/song?type=${type}` : '/top/song', { cookie });
      const d = r.data || {};
      const list = Array.isArray(d.data) ? d.data : [];
      if (!list.length) {
        return json(res, 200, {
          code: 200, source: 'kugou', tracks: [],
          error: d.errmsg || (r.data && r.data.error) || '新歌速递没有返回内容',
        });
      }
      return json(res, 200, {
        code: 200, source: 'kugou',
        tracks: list.map(kugouListTrack).filter((t) => t.id),
      });
    }

    if (part === 'everyday/recommend') {
      const r = await scRequest(sidecar, '/everyday/recommend', { cookie });
      const d = (r.data && r.data.data) || {};
      const list = Array.isArray(d.song_list) ? d.song_list : [];
      return json(res, 200, {
        code: 200, source: 'kugou',
        tracks: list.map(kugouListTrack).filter((t) => t.id),
        cover: d.cover_img_url || '',
        date: d.creation_date || '',
      });
    }

    if (part === 'playlist/tracks') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const page = Math.max(1, Number(q.get('page')) || 1);
      const pagesize = Math.min(100, Math.max(1, Number(q.get('limit')) || 30));
      /* all=1（2026-11-22）：大厅跑马带 / 歌单详情要整张歌单，而酷狗上游
         单页最多 100 首，前端传 limit=100 就只能看到前 100 首。这里替前端
         按 100/页翻完并按 id 去重；单页接口原样保留给 migrate.js 等需要
         逐页取的调用方。 */
      if (q.get('all') === '1' || q.get('all') === 'true') {
        const PAGE = 100;
        const MAX_PAGES = 20;
        const seen = new Set();
        const tracks = [];
        let total = 0;
        let limited = false;
        for (let p = 1; p <= MAX_PAGES; p += 1) {
          let r;
          try {
            r = await scRequest(sidecar,
              `/playlist/track/all?id=${encodeURIComponent(id)}&page=${p}&pagesize=${PAGE}`, { cookie });
          } catch (e) {
            if (p === 1) throw e; /* 第一页就失败：让前端看到真实错误 */
            limited = true;       /* 后面某页失败：先给已经拿到的 */
            break;
          }
          const d = (r.data && r.data.data) || {};
          const list = d.songs || d.info || d.list || [];
          const n = Number(d.count || d.total || 0);
          if (n > total) total = n;
          if (!Array.isArray(list) || !list.length) break;
          for (const it of list) {
            const t = kugouPlaylistTrack(it);
            if (!t.id || !t.name || seen.has(t.id)) continue;
            seen.add(t.id);
            tracks.push(t);
          }
          if (list.length < PAGE) break;
          if (total > 0 && tracks.length >= total) break;
          if (p === MAX_PAGES) limited = true;
        }
        if (total > 0 && tracks.length < total) limited = true;
        return json(res, 200, {
          code: 200, source: 'kugou',
          tracks,
          trackCount: total || tracks.length,
          limited,
        });
      }
      const r = await scRequest(sidecar,
        `/playlist/track/all?id=${encodeURIComponent(id)}&page=${page}&pagesize=${pagesize}`, { cookie });
      const d = (r.data && r.data.data) || {};
      const list = d.songs || d.info || d.list || [];
      return json(res, 200, {
        code: 200, source: 'kugou',
        tracks: (Array.isArray(list) ? list : []).map(kugouPlaylistTrack).filter((t) => t.id && t.name),
        trackCount: Number(d.count || d.total || 0) || (Array.isArray(list) ? list.length : 0),
      });
    }

    if (part === 'liked/songs') {
      /* 酷狗的「我喜欢」不是独立接口：它是 user/playlist 返回的系统歌单
         （name=「我喜欢」、id=collection_…_2_0），曲目走和普通歌单相同的
         /playlist/track/all。这里替前端把「找歌单 + 翻曲目」两步合成一个
         { tracks } 响应，和其他平台的「我的喜欢」形状对齐。
         账号类接口用 kgUserContext：active 缺 token / userid 时改用在另一版
         已登录的 jar（同一账号两边同步），不因为 VIP 检测失败回 401。 */
      const u = kgUserContext();
      logSidecar = u.sidecar;
      if (!u.jar.token || !u.jar.userid) {
        return json(res, 200, {
          code: 401, source: 'kugou', profile: u.profile, tracks: [],
          error: '先在设置里扫码登录酷狗，才能看「我的喜欢」',
        });
      }
      const l = await kugouUserPlaylistList(u.cookie, u.sidecar);
      if (l.failed) {
        return json(res, 200, {
          code: 401, source: 'kugou', profile: u.profile, tracks: [],
          error: l.error || '酷狗登录态可能已过期，重新扫码后再试',
        });
      }
      const like = l.items.find((p) => p.name === '我喜欢' || p.name === '我喜欢的音乐'
        || /collection_[^_]+_[^_]+_2_0$/.test(p.id));
      if (!like) {
        return json(res, 200, {
          code: 200, source: 'kugou', profile: u.profile, tracks: [],
          error: l.error || '没找到酷狗的「我喜欢」歌单（在酷狗 App 里点几首红心再回来）',
        });
      }
      const PAGE_SIZE = 100;
      const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || PAGE_SIZE));
      const tracks = [];
      let trackCount = like.trackCount || 0;
      for (let page = 1; page <= Math.ceil(limit / PAGE_SIZE); page++) {
        const r = await scRequest(u.sidecar,
          `/playlist/track/all?id=${encodeURIComponent(like.id)}&page=${page}&pagesize=${PAGE_SIZE}&_=${Date.now()}`,
          { cookie: u.cookie });
        const d = (r.data && r.data.data) || {};
        const rows = Array.isArray(d.songs) ? d.songs
          : Array.isArray(d.info) ? d.info
            : (Array.isArray(d.list) ? d.list : []);
        trackCount = Number(d.count || d.total || 0) || trackCount;
        for (const it of rows) {
          const t = kugouPlaylistTrack(it);
          if (!t.id || !t.name) continue;
          tracks.push(t);
          if (tracks.length >= limit) break;
        }
        if (!rows.length || rows.length < PAGE_SIZE || tracks.length >= limit) break;
      }
      return json(res, 200, { code: 200, source: 'kugou', profile: u.profile, tracks, trackCount });
    }

    if (part === 'user/playlists') {
      /* 上游 kugoumusicapi 的 /user/playlist 默认 page=1、pagesize=30，只取一次会把
         30 张以后的歌单截掉。这里逐页翻到底再按 id 去重（见 kugouUserPlaylistList）。 */
      const u = kgUserContext();
      logSidecar = u.sidecar;
      if (!u.jar.token || !u.jar.userid) {
        return json(res, 200, {
          code: 401, source: 'kugou', profile: u.profile, playlists: [],
          error: '先在卡片上扫码登录酷狗（这个接口要登录）',
        });
      }
      const l = await kugouUserPlaylistList(u.cookie, u.sidecar);
      if (l.failed) {
        return json(res, 200, {
          code: 401, source: 'kugou', profile: u.profile, playlists: [],
          error: l.error || '先在卡片上扫码登录酷狗（这个接口要登录）',
        });
      }
      return json(res, 200, {
        code: 200, source: 'kugou', profile: u.profile,
        playlists: l.items,
      });
    }

    /* 「我收藏的专辑」：酷狗没有独立接口，专辑和歌单混在 /user/playlist 的 info 里
       （raw source=2 或带 musiclib_id）。这里先把混合列表翻到底，再筛专辑、
       按 limit/offset 自己切 —— 不能像上游那样「先按混合列表分页再筛」，
       否则某页全是歌单时专辑会被整页截掉，hasMore 也不可信。
       没登录 / 登录态失效时和 QQ、波点一样回 code 401（HTTP 仍是 200）。 */
    if (part === 'user/albums') {
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 50));
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      const u = kgUserContext();
      logSidecar = u.sidecar;
      if (!u.jar.token || !u.jar.userid) {
        return json(res, 200, {
          code: 401, source: 'kugou', profile: u.profile, data: [], hasMore: false,
          error: '先在设置里扫码登录酷狗，才能导入收藏的专辑',
        });
      }
      const l = await kugouUserPlaylistList(u.cookie, u.sidecar);
      if (l.failed) {
        return json(res, 200, {
          code: 401, source: 'kugou', profile: u.profile, data: [], hasMore: false,
          error: l.error || '酷狗登录态可能已过期，重新扫码后再试',
        });
      }
      const albums = [];
      const seen = new Set();
      for (const it of l.rawItems) {
        if (!kugouIsUserAlbum(it)) continue;
        const a = kugouUserAlbum(it);
        if (!a.id || seen.has(a.id)) continue;
        seen.add(a.id);
        albums.push(a);
      }
      return json(res, 200, {
        code: 200, source: 'kugou', profile: u.profile,
        data: albums.slice(offset, offset + limit),
        hasMore: offset + limit < albums.length,
        total: albums.length,
      });
    }

    /* ---- 电台：/fm/class 是频道目录（匿名），/fm/songs 按 fmid 取歌（匿名） ---- */
    if (part === 'fm/class') {
      const r = await scRequest(sidecar, '/fm/class', { cookie });
      const d = (r.data && r.data.data) || {};
      const classes = Array.isArray(d.class_list) ? d.class_list : [];
      const stations = [];
      for (const cls of classes) {
        for (const fm of (cls.fmlist || [])) {
          const s = kugouFmStation(fm, cls);
          if (s.id) stations.push(s);
        }
      }
      return json(res, 200, { code: 200, source: 'kugou', stations });
    }

    if (part === 'fm/songs') {
      const fmid = q.get('fmid') || q.get('id') || '';
      if (!fmid) return json(res, 400, { code: 400, error: 'fmid required' });
      const size = Math.min(100, Math.max(1, Number(q.get('limit')) || 30));
      const r = await scRequest(sidecar,
        `/fm/songs?fmid=${encodeURIComponent(fmid)}&size=${size}`, { cookie, timeout: 25000 });
      const blocks = Array.isArray(r.data && r.data.data) ? r.data.data : [];
      const songs = blocks.flatMap((b) => (Array.isArray(b && b.songs) ? b.songs : []));
      if (!songs.length) {
        return json(res, 200, {
          code: 200, source: 'kugou', tracks: [],
          error: (r.data && (r.data.error || r.data.message)) || '这个电台没有返回曲目',
        });
      }
      return json(res, 200, {
        code: 200, source: 'kugou',
        tracks: songs.map(kugouFmTrack).filter((t) => t.id),
      });
    }

    /* ---- 推荐歌单 / 推荐流 / 私人 FM（都匿名可用，给精选和跑马带兜底） ---- */
    if (part === 'top/playlists') {
      const page = Math.max(1, Number(q.get('page')) || 1);
      const size = Math.min(50, Math.max(1, Number(q.get('limit')) || 12));
      const r = await scRequest(sidecar, `/top/playlist?page=${page}&pagesize=${size}`, { cookie });
      const d = (r.data && r.data.data) || {};
      const list = Array.isArray(d.special_list) ? d.special_list : [];
      return json(res, 200, {
        code: 200, source: 'kugou',
        playlists: list.map(kugouPlaylist).filter((p) => p.id),
      });
    }

    if (part === 'recommend/songs' || part === 'personal/fm') {
      const path = part === 'personal/fm' ? '/personal/fm' : '/recommend/songs';
      const r = await scRequest(sidecar, path, { cookie, timeout: 25000 });
      const d = (r.data && r.data.data) || {};
      const list = Array.isArray(d.song_list) ? d.song_list : [];
      return json(res, 200, {
        code: 200, source: 'kugou',
        tracks: list.map(kugouListTrack).filter((t) => t.id),
      });
    }

    /* ---------------- 写入：建歌单 / 加歌（只开显式路由） ----------------
       上游 kugoumusicapi v1.6.0 的两个模块：
         /playlist/add        （module/playlist_add.js，type 缺省=0 新建）
         /playlist/tracks/add （module/playlist_tracks_add.js，data=「歌名|hash|专辑id|mixsongid」）
       模块从 query/body 合并的 params 取参数，登录态取 cookie 里的 token/userid。
       新建歌单要 list_create_userid（当前登录 userid）；list_create_listid 是「来源歌单」的 id，
       从零创建不需要（上游作者在 issue #102 明确说「创建歌单可以不填」），
       建完用 /user/playlist 按名字回读真正的 listid。 */
    if (part === 'playlist/create') {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const name = String(body.name || q.get('name') || '').trim();
      const u = kgUserContext();
      logSidecar = u.sidecar;
      if (!u.jar.token || !u.jar.userid) {
        return json(res, 200, { code: 401, error: '先在卡片上扫码登录酷狗' });
      }
      if (!name) return json(res, 400, { code: 400, error: 'name required' });
      /* 不要传 type=0：边车从 query 拿到的是字符串 "0"，module 里用的是严格 === 0，
         省略它才能命中「新建」分支并保持上游 body 里 type 是数字 0。
         list_create_listid 也省略：新建没有来源歌单，传 0 反而可能被当成真实 listid。 */
      const r = await scRequest(u.sidecar,
        `/playlist/add?name=${encodeURIComponent(name)}&source=1`
        + `&list_create_userid=${encodeURIComponent(String(u.jar.userid))}`
        /* 酷狗边车给所有成功响应挂了 2 分钟 apicache；同名重建命中缓存会拿到
           上一次的 listid（写进旧歌单）。加一个只会被忽略的时间戳破缓存。 */
        + `&_=${Date.now()}`,
        { cookie: u.cookie, timeout: 25000 });
      const d = r.data || {};
      const ok = r.status === 200 && Number(d.error_code || 0) === 0
        && (d.status === undefined || Number(d.status) === 1);
      if (!ok) {
        return json(res, 200, {
          code: Number(d.error_code) || r.status || 502,
          error: d.error_msg || d.errmsg || d.message || `酷狗建歌单失败（status ${d.status ?? r.status}）`,
        });
      }
      /* 成功体里 listid 的位置不固定：先找返回体，找不到再回读「我的歌单」按歌单名找。
         回读也拿不到就明确失败，绝不拿别的 listid 凑数（那会把歌写错歌单）。 */
      const data = (d.data && typeof d.data === 'object') ? d.data : {};
      const infos = Array.isArray(data.info) ? data.info : (data.info ? [data.info] : []);
      const named = infos.find((x) => x && x.listname === name) || infos[0];
      /* 只认 listid/list_id；global_collection_id 不是加歌接口要的 listid，不能拿来凑数。 */
      const picked = data.listid || data.list_id || data.list_create_listid
        || (named && (named.listid || named.list_id || named.list_create_listid));
      let listid = picked ? String(picked) : '';
      if (!listid) {
        const lr = await scRequest(u.sidecar, '/user/playlist', { cookie: u.cookie });
        const info = (lr.data && lr.data.data && Array.isArray(lr.data.data.info)) ? lr.data.data.info : [];
        const hit = info.find((x) => x && x.listname === name
          && (x.listid || x.list_id || x.list_create_listid));
        listid = hit ? String(hit.listid || hit.list_id || hit.list_create_listid) : '';
      }
      if (!listid) {
        return json(res, 200, {
          code: 502,
          error: '酷狗建歌单返回成功，但回读不到 listid（请到酷狗确认是否已建出）',
        });
      }
      return json(res, 200, { code: 200, listid, playlist: { id: listid, name } });
    }

    if (part === 'playlist/tracks/add') {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const listid = String(body.listid ?? body.pid ?? q.get('listid') ?? q.get('pid') ?? '');
      const picks = Array.isArray(body.picks) ? body.picks
        : (Array.isArray(body.songs) ? body.songs : []);
      const u = kgUserContext();
      logSidecar = u.sidecar;
      if (!u.jar.token || !u.jar.userid) {
        return json(res, 200, { code: 401, error: '先在卡片上扫码登录酷狗' });
      }
      if (!listid) return json(res, 400, { code: 400, error: 'listid required' });
      if (!picks.length) return json(res, 400, { code: 400, error: 'picks required' });
      /* 上游 data 格式：歌名|hash|专辑id|(mixsongid/album_audio_id)，多个用逗号分隔。
         歌名里的 , 和 | 会破坏分列，替换成空格；hash 缺失无法定位歌曲，整批直接报错。 */
      const rows = [];
      let missing = 0;
      for (const p of picks) {
        const hash = String(p.hash || (/^[0-9a-f]{32}$/i.test(String(p.id || '')) ? p.id : ''));
        if (!hash) { missing++; continue; }
        rows.push([
          String(p.name || '').replace(/[|,]/g, ' '),
          hash,
          Number(p.albumIdNum || 0),
          Number(p.albumAudioId || 0),
        ].join('|'));
      }
      if (missing) {
        return json(res, 200, {
          code: 400,
          error: `有 ${missing} 首缺少酷狗 hash，无法定位歌曲（重新搜索后再写入）`,
        });
      }
      /* data 可能很长，走 POST body（边车会把 body 合并进 params），不塞进 URL。
         但酷狗边车的缓存键只看 URL、不看 body：同一歌单第二次加歌会命中
         第一次的成功缓存，直接「假成功」而不发请求。加时间戳让每次都是新键。 */
      const r = await scRequest(u.sidecar, `/playlist/tracks/add?_=${Date.now()}`, {
        cookie: u.cookie, method: 'POST', payload: { listid, data: rows.join(',') }, timeout: 30000,
      });
      const d = r.data || {};
      const ok = r.status === 200 && Number(d.error_code || 0) === 0
        && (d.status === undefined || Number(d.status) === 1);
      if (!ok) {
        return json(res, 200, {
          code: Number(d.error_code) || r.status || 502,
          error: d.error_msg || d.errmsg || d.message || `酷狗加歌失败（status ${d.status ?? r.status}）`,
        });
      }
      return json(res, 200, { code: 200, listid, added: rows.length });
    }

    return json(res, 404, { code: 404, error: 'unknown kugou api: ' + part });
  } catch (e) {
    return json(res, 502, { code: 502, error: String(e.message), reason: e.reason || null, log: scLogTail(logSidecar) });
  }
}

/* --------------------------------------------------------------------------
   酷狗歌词候选匹配（2026-11-12 实测 sidecar /search/lyric）
   --------------------------------------------------------------------------
   证据：
   1) candidates 里**没有 hash 字段**，没法在候选层直接比 hash；
   2) 带合法 hash 也不保证对：纯音乐 / 钢琴曲大量返回同一首不相干的词
      （"The Seasons Op. 37b: June - Barcarole" / arkady sevidov / duration
      320317），实测 40 首钢琴、古筝、小提琴曲目全部命中这一条；
      它的歌词内容只有 298 字节表头，但 candidates 元数据已经和当前曲目完全不符；
   3) 按歌名搜（没给 hash / hash 非法）时，上游会用 song=singer=关键词 的
      第三方占位词，时长字段还混用秒和毫秒，不能单独当依据。
   所以候选必须能和当前曲目对上：歌名（含括号里的别名）匹配 > 歌手匹配 >
   时长佐证；对不上就返回空词。**不要**退回 cand[0]。
   -------------------------------------------------------------------------- */
/** 标题/歌手归一化：去括号、标点、空格，全小写（只用于比较，不改原字段） */
function kgNorm(s) {
  return String(s || '').toLowerCase()
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/【/g, '[').replace(/】/g, ']')
    .replace(/《/g, '<').replace(/》/g, '>')
    .replace(/[·•,，.。:：;；/／\-—_'"“”‘’!！?？~～&+<>]/g, '')
    .replace(/\s+/g, '');
}

/** 歌名的所有写法：去括号后的主名 + 每一段括号里的别名
 *  例：`연애의 조건 (恋爱的条件)` → [恋爱的条件, 연애의조건]；
 *      `若月亮没来 (若是月亮还没来)` → [若是月亮还没来, 若月亮没来]。 */
function kgTitleVariants(s) {
  let base = String(s || '').toLowerCase()
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/【/g, '[').replace(/】/g, ']')
    .replace(/《/g, '<').replace(/》/g, '>');
  const out = [];
  for (let i = 0; i < 3; i++) {
    const inner = [];
    base = base
      .replace(/\(([^()]*)\)/g, (m, x) => { inner.push(x); return ''; })
      .replace(/\[([^\[\]]*)\]/g, (m, x) => { inner.push(x); return ''; });
    if (!inner.length) break;
    for (const x of inner) { const n = kgNorm(x); if (n) out.push(n); }
  }
  const main = kgNorm(base);
  if (main) out.push(main);
  return [...new Set(out)];
}

/** 歌手拆成可比较的 token（`周杰伦 / Lara梁心颐`、`A、B` 这种都拆）
 *  「未知歌手 / 群星」不含辨识度，当作没有信息，不拿它排除歌词。 */
function kgArtistTokens(s) {
  const list = String(s || '').toLowerCase()
    .replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ')
    .split(/[\/／、,，&;；|+]+/)
    .map((x) => String(x).replace(/[·•.。\s'"“”‘‘’\-—_]/g, ''))
    .filter((x) => x.length >= 2);
  if (!list.length) return [];
  if (list.every((x) => /^(未知歌手|未知|群星|variousartists|va)$/.test(x))) return [];
  return list;
}

/** 上游 duration 混用毫秒和秒：< 1200 当秒；> 4 小时的明显是占位值
 *  （实测见过 124528385），当没有时长处理。 */
function kgDurationMs(v) {
  const n = Number(v) || 0;
  if (n <= 0) return 0;
  const ms = n < 1200 ? n * 1000 : n;
  return ms >= 10000 && ms <= 4 * 3600 * 1000 ? ms : 0;
}

/** 从 candidates 里挑出和当前曲目对得上的那一条；没有就返回 null。 */
function kugouLyricPick(cands, req) {
  const pool = (Array.isArray(cands) ? cands : []).filter((c) => c && c.id && c.accesskey);
  if (!pool.length) return null;
  const titles = kgTitleVariants(req && req.title);
  const artists = kgArtistTokens(req && req.artists);
  const wantMs = kgDurationMs(req && req.duration);
  /* 老调用只给 hash、没有任何可核对的信息：沿用上游按 hash 过滤的结果 */
  if (!titles.length && !artists.length && !wantMs) return pool[0];

  let best = null;
  let bestScore = -1;
  for (const c of pool) {
    const ctitles = kgTitleVariants(c.song);
    let titleScore = 0;                   // 100=严格同名（含括号别名），50=包含
    for (const a of titles) {
      for (const b of ctitles) {
        if (a === b) { titleScore = 100; break; }
        if (titleScore < 50 && a.length >= 4 && b.length >= 4
            && (a.includes(b) || b.includes(a))) titleScore = 50;
      }
      if (titleScore === 100) break;
    }
    const candArtists = kgArtistTokens(c.singer);
    let artistOk = null;                  // null = 信息不足，不能据此排除
    if (artists.length && candArtists.length) {
      artistOk = artists.some((a) => candArtists.some((b) => a === b || a.includes(b) || b.includes(a)));
    }
    const candMs = kgDurationMs(c.duration);
    let durOk = null;
    if (wantMs && candMs) durOk = Math.abs(candMs - wantMs) <= Math.max(8000, wantMs * 0.08);

    /* 规则：
       - 严格同名：歌手对得上、或歌手信息不足、或时长与本曲吻合，三者有其一即可
         （翻唱/搬运词常见 singer 是搬运号，但时长和录音完全一致，内容仍是这首歌）；
       - 只是包含关系（别名/翻译名）：要歌手或时长佐证；
       - 歌名完全对不上：只有调用方没给歌名时，才允许「歌手+时长」双吻合。
       DJ/现场版时长会差很多，所以时长只做佐证，不能单独把词捞回来。 */
    const acceptable = (titleScore >= 100 && (artistOk !== false || durOk === true))
      || (titleScore >= 50 && (artistOk === true || durOk === true))
      || (!titles.length && artistOk === true && durOk === true);
    if (!acceptable) continue;
    /* 同分时官方词优先；分数只用来说明先后，不合格的候选上面已经跳过 */
    const score = titleScore + (artistOk ? 40 : 0) + (durOk ? 20 : 0)
      + (/官方/.test(String(c.product_from || '')) ? 5 : 0);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

/** 酷狗「列表型」条目（新歌速递 / 每日推荐 / 歌单曲目）：小写字段，播放键仍是 hash */
function kugouListTrack(it) {
  const cover = (it.trans_param && it.trans_param.union_cover)
    ? String(it.trans_param.union_cover).replace('{size}', KUGOU_TRACK_COVER_SIZE)
    : (it.sizable_cover || it.album_sizable_cover || '');
  const fn = String(it.filename || '');
  const cut = fn.indexOf(' - ');
  const name = it.songname || (cut > 0 ? fn.slice(cut + 3) : fn);
  const artists = it.author_name || (cut > 0 ? fn.slice(0, cut) : '');
  return {
    id: it.hash || it.hash_128 || it.hash_320 || '',
    source: 'kugou',
    name,
    artists: artists || '未知歌手',
    artistIds: (Array.isArray(it.authors) ? it.authors : [])
      .map((a) => a && a.author_id).filter(Boolean).map(String),
    album: it.album_name || '',
    albumId: it.album_id ? String(it.album_id) : '',
    cover,
    /* 酷狗列表接口混用两种单位：timelength 是毫秒，time_length 是秒（实测 2026-11-07） */
    duration: Number(it.timelength || 0) || (Number(it.time_length || 0) * 1000),
    fee: Number(it.pay_type) > 0 ? 1 : 0,
    hash: it.hash || '',
    /* 和 kugouTrack 同一条规矩：只传真正的 album_audio_id / mixsongid。
       新歌速递、每日推荐/推荐流都带 album_audio_id；个人 FM 只有 mixsongid；
       两者都没有时传 0 让上游按 hash 取流。audio_id 不是曲目键，不能拿来顶替
       （传错 id 会直接放到别的歌，见 /api/kugou/song/url 的说明）。 */
    albumAudioId: Number(it.album_audio_id || it.mixsongid) || 0,
    albumIdNum: Number(it.album_id) || 0,
  };
}

/** 酷狗歌单曲目（/playlist/track/all）：name 是「歌手 - 歌名」，时长叫 timelen */
function kugouPlaylistTrack(it) {
  const singers = Array.isArray(it.singerinfo) ? it.singerinfo : [];
  const full = String(it.name || '');
  const cut = full.indexOf(' - ');
  const title = cut > 0 ? full.slice(cut + 3) : full;
  const author = cut > 0 ? full.slice(0, cut) : '';
  const tpl = it.cover || (it.trans_param && it.trans_param.union_cover) || '';
  return {
    id: it.hash || '',
    source: 'kugou',
    name: title,
    artists: singers.map((s) => s.name).filter(Boolean).join(' / ') || author || '未知歌手',
    artistIds: singers.map((s) => s.id).filter(Boolean).map(String),
    album: (it.albuminfo && it.albuminfo.name) || '',
    albumId: it.album_id ? String(it.album_id) : '',
    cover: String(tpl).replace('{size}', KUGOU_TRACK_COVER_SIZE),
    duration: Number(it.timelen || it.timelength || 0),
    fee: Number(it.feetype || it.pay_type || 0) > 0 ? 1 : 0,
    hash: it.hash || '',
    /* 这个形状里 audio_id 是「音频 id」，不是 album_audio_id；拿它取流会点到另一首
       （实测 宣美 - Siren：audio_id 42747457 → 返回 2FE001B8… 的另一首）。
       歌单条目带 mixsongid（曲目键），没有 album_audio_id 就用 0 走 hash。 */
    albumAudioId: Number(it.album_audio_id || it.mixsongid) || 0,
    albumIdNum: Number(it.album_id) || 0,
  };
}

/** 酷狗 FM（/fm/songs）：字段比榜单少，没有 singerinfo / cover，name 是「歌手 - 歌名」 */
function kugouFmTrack(it) {
  const full = String(it.name || '');
  const cut = full.indexOf(' - ');
  return {
    id: it.hash || '',
    source: 'kugou',
    name: cut > 0 ? full.slice(cut + 3) : full,
    artists: cut > 0 ? full.slice(0, cut) : '未知歌手',
    artistIds: [],
    album: '',
    albumId: it.album_id ? String(it.album_id) : '',
    cover: '',
    duration: Number(it.time || it.timelength || 0),
    fee: Number(it.pay_type) > 0 ? 1 : 0,
    hash: it.hash || '',
    /* 电台条目同时有 album_audio_id 和 audio_id；只有前者是曲目键。
       没有 album_audio_id 时用 mixsongid，再没有就传 0（按 hash 取），不拿 audio_id 顶替。 */
    albumAudioId: Number(it.album_audio_id || it.mixsongid) || 0,
    albumIdNum: Number(it.album_id) || 0,
  };
}

/** 酷狗 FM 频道（/fm/class）：一张卡一个频道，点开按 fmid 取歌 */
function kugouFmStation(it, cls) {
  return {
    id: String(it.fmid || ''),
    source: 'kugou',
    name: it.fmname || '未命名电台',
    /* FM 频道只是卡片（不会当形态大图铺屏），400 够用，别跟着曲目上 800 */
    cover: String(it.imgurl || '').replace('{size}', '400'),
    trackCount: Array.isArray(it.songlist) ? it.songlist.length : 0,
    playCount: 0,
    creator: { nickname: (cls && cls.classname) || '' },
  };
}

/** 酷狗「我的歌单」条目 → { id,name,cover,trackCount,creator }（id 用 global_collection_id 或 listid）
 *
 *  /v7/get_all_list 把「收藏的歌单」和「收藏的专辑」混在同一个 info 数组里：
 *  专辑条目的 raw `source` 是 2（歌单是 1），并带 musiclib_id。这里不能把 raw source
 *  直接写进 source —— 那个字段一直是平台标记（'kugou'），前端按它分流。所以另存
 *  rawSource，并把 musiclib_id 原样保留，/user/albums 再据此筛。 */
function kugouPlaylist(it) {
  const id = it.global_collection_id || it.listid || it.list_id || it.specialid || '';
  const cover = String(it.img_url || it.imgurl || it.pic || it.cover || '')
    .replace('{size}', '400');
  const musiclibId = it.musiclib_id ?? it.musicLibId;
  return {
    id: String(id),
    name: it.listname || it.name || it.specialname || '未命名歌单',
    cover,
    trackCount: Number(it.songcount ?? it.song_count ?? it.total ?? 0) || 0,
    playCount: Number(it.playcount ?? it.play_count ?? 0) || 0,
    creator: { nickname: it.nickname || it.username || '' },
    source: 'kugou',
    /* 收藏专辑判定用的原始字段（不影响现有歌单字段） */
    rawSource: Number(it.source) || 0,
    musiclibId: musiclibId != null ? String(musiclibId) : '',
    musiclib_id: musiclibId != null ? String(musiclibId) : '',
  };
}

/** 酷狗收藏专辑条目（/user/playlist 里混着的那一类）→ 网易云 album/sublist 形状。
 *  判定见 kugouIsUserAlbum；专辑 id 用 musiclib_id（folia 文档和 kugouProvider 的约定）。
 *  极少数条目可能只有 source=2 没有 musiclib_id，此时退回 album_id / list_create_listid，
 *  都没有就让调用方丢掉（不拿别的 id 凑数）。 */
function kugouUserAlbum(it) {
  const musiclibId = it.musiclib_id ?? it.musicLibId;
  const hasMusiclib = musiclibId != null && String(musiclibId) !== '' && String(musiclibId) !== '0';
  const fallbackId = it.album_id ?? it.AlbumID ?? it.albumId ?? it.list_create_listid ?? '';
  const id = hasMusiclib ? String(musiclibId) : String(fallbackId || '');
  const singers = Array.isArray(it.singer)
    ? it.singer.map((s) => (s && s.name) || s || '').filter(Boolean).join(' / ')
    : '';
  const artist = it.singername || it.singer_name || it.author_name || it.artist || singers || '未知歌手';
  const cover = String(it.img_url || it.imgurl || it.pic || it.cover || it.album_cover || it.albumcover || '')
    .replace('{size}', '400');
  const publishTime = it.publish_time ?? it.publishTime ?? it.pubtime ?? it.release_date ?? it.releaseDate ?? 0;
  const size = it.song_count ?? it.songcount ?? it.music_num ?? it.musicNum ?? it.count ?? it.total ?? 0;
  return {
    id,
    name: it.album_name || it.albumname || it.albumName || it.listname || it.name || '未知专辑',
    picUrl: cover,
    artists: [{ name: String(artist) }],
    publishTime: Number(publishTime) || 0,
    size: Number(size) || 0,
    source: 'kugou',
  };
}

/** 混合列表里哪一行是「收藏的专辑」：raw source=2，或带 musiclib_id。
 *  用「有值」而不是「键存在」判定：个别歌单条目也带 musiclib_id: 0/null。 */
function kugouIsUserAlbum(it) {
  if (!it || typeof it !== 'object') return false;
  if (Number(it.source) === 2) return true;
  const id = it.musiclib_id ?? it.musicLibId;
  return id != null && String(id) !== '' && String(id) !== '0';
}

/** 酷狗用户歌单列表（/user/playlist 逐页翻到底，按 id 去重）。
 *  「我喜欢」就在这份列表里（系统歌单 collection_…_2_0），
 *  /api/kugou/liked/songs 从它里面挑出来再取曲目。 */
async function kugouUserPlaylistList(cookie, sidecar = 'kugou') {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 20;
  const items = [];
  /* rawItems：翻页时原样留下的 info 行。歌单链路只认 items（按歌单 id 去重），
     收藏专辑要从同一份混合列表里筛（见 /user/albums），不能靠 items —— 专辑条目的
     歌单 id 可能为空，会被 items 的过滤丢掉。 */
  const rawItems = [];
  const seen = new Set();
  let total = 0;
  let failed = false;
  let error = '';
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await scRequest(sidecar, `/user/playlist?page=${page}&pagesize=${PAGE_SIZE}`, { cookie });
    const d = (r.data && r.data.data) || {};
    if (!Array.isArray(d.info)) {
      if (page === 1) failed = true;
      error = (r.data && (r.data.error || r.data.errmsg)) || '';
      break;
    }
    if (d.total != null && Number.isFinite(Number(d.total))) total = Number(d.total);
    for (const it of d.info) {
      if (it && typeof it === 'object') rawItems.push(it);
      const p = kugouPlaylist(it);
      if (!p.id || seen.has(p.id)) continue;
      seen.add(p.id);
      items.push(p);
    }
    /* 停法：空页、短页、累计到上游 total、翻到页数上限 */
    if (d.info.length === 0 || d.info.length < PAGE_SIZE) break;
    if (total > 0 && seen.size >= total) break;
  }
  return { items, rawItems, total, failed, error };
}

/** 酷狗 /song/url 的返回有好几种形状：data 是数组，或者 {url,...}，失败时只有 errcode。
 *  kugoumusicapi 1.6.0 起 /song/url 直接把 trackercdn 的根级对象透传出来
 *  （{ status:1, url:[...], backupUrl:[...] }），不再包一层 data；
 *  url 也可能本身就是数组。两种结构都要认，否则永远取到空串、只能放示例音乐。 */
/** 酷狗 /v5/url 返回的文件直链形如 …/v3/<32 位文件 hash>/yp/…：
 *  取出 URL 里真正的文件 hash，用来核对「拿到的音频」是不是请求的那一首。
 *  别的 CDN 形状里没有这段时返回空串，调用方只能放过。 */
function kugouUrlHash(u) {
  const m = String(u || '').match(/\/(?:v\d+)\/([0-9a-f]{32})\//i);
  return m ? m[1].toLowerCase() : '';
}

function kugouUrlOf(data) {
  const d = (data && data.data) || data || null;
  const one = Array.isArray(d) ? d[0] : d;
  const raw = one && (one.url || (Array.isArray(one.urls) ? one.urls[0] : ''));
  const url = Array.isArray(raw) ? (raw[0] || '') : (raw || '');
  return {
    url,
    preview: !!(one && (one.free_part || one.is_free_part)),
    upstream: (data && (data.error || data.message || (data.errcode && ('errcode ' + data.errcode))))
      || (one && one.status !== undefined && Number(one.status) !== 1 ? ('status ' + one.status) : null),
  };
}

/* ---------------- /api/qishui/* ---------------- */
async function handleQishui(req, res, url) {
  const part = url.pathname.slice('/api/qishui/'.length);
  const q = url.searchParams;

  if (part === 'health') {
    try {
      const port = await ensureSidecar('qishui');
      const h = await scRequest('qishui', '/health', { timeout: 5000 });
      return json(res, 200, {
        code: 200, ok: true, port, node: (h.data && h.data.node) || '', loggedIn: !!(h.data && h.data.loggedIn),
      });
    } catch (e) {
      return json(res, 502, {
        code: 502, ok: false, error: String(e.message), reason: e.reason || null, log: scLogTail('qishui'),
      });
    }
  }

  try {
    const pass = async (pathname, map) => {
      const r = await scRequest('qishui', pathname);
      return map(r);
    };

    if (part === 'status') return json(res, 200, (await scRequest('qishui', '/status')).data);
    if (part === 'logout') return json(res, 200, (await scRequest('qishui', '/logout')).data);
    if (part === 'login/qr/key') return json(res, 200, (await scRequest('qishui', '/login/qr/key', { timeout: 25000 })).data);
    if (part === 'login/qr/create') {
      const key = q.get('key') || '';
      if (!key) return json(res, 400, { code: 400, error: 'key required' });
      return json(res, 200, (await scRequest('qishui', `/login/qr/create?key=${encodeURIComponent(key)}`)).data);
    }
    if (part === 'login/qr/check') {
      const key = q.get('key') || '';
      if (!key) return json(res, 400, { code: 400, error: 'key required' });
      return json(res, 200, (await scRequest('qishui', `/login/qr/check?key=${encodeURIComponent(key)}`, { timeout: 25000 })).data);
    }

    if (part === 'search') {
      const s = (q.get('s') || q.get('keywords') || '').trim();
      if (!s) return json(res, 200, { code: 200, source: 'qishui', tracks: [], songCount: 0 });
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 20));
      const r = await scRequest('qishui', `/search?q=${encodeURIComponent(s)}&limit=${limit}&offset=0`);
      const d = r.data || {};
      if (d.code !== 200) return json(res, 200, { code: d.code || 502, source: 'qishui', tracks: [], error: d.error || '汽水搜索失败' });
      return json(res, 200, {
        code: 200, source: 'qishui',
        tracks: (d.items || []).map(qishuiTrack).filter((t) => t.id && t.name),
        songCount: (d.items || []).length,
        more: !!d.hasMore,
      });
    }

    if (part === 'song/url') {
      const id = q.get('id') || q.get('mid') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const quality = ['standard', 'high', 'lossless', 'hires'].includes(q.get('quality')) ? q.get('quality') : 'standard';
      const r = await scRequest('qishui', `/audio?id=${encodeURIComponent(id)}&quality=${quality}`, { timeout: 25000 });
      const d = r.data || {};
      return json(res, 200, {
        code: 200,
        id,
        url: d.url || '',
        preview: !!d.preview,
        // 试听片段从这首歌的第 N 毫秒开始（车机协议给的），前端据此提示
        clipStartMs: d.clipStartMs || 0,
        quality: d.quality || quality,
        reason: d.url ? (d.preview ? 'preview' : null) : (d.reason || 'unavailable'),
        error: d.url ? null : (d.error || null),
      });
    }

    if (part === 'lyric') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const r = await scRequest('qishui', `/lyrics?id=${encodeURIComponent(id)}`);
      const ent = (r.data && r.data.lyrics && r.data.lyrics.lyric_entity) || {};
      const content = String(ent.content || '');
      /* 绝大多数是 KRC（`[ms,ms]<…>`）；个别歌上游给的就是整行 LRC，原样透出 */
      const isKrc = /^\[\d+,\d+\]/m.test(content);
      const lrc = isKrc ? krcToLrc(content) : content;
      /* KRC 原文里就有逐字时间，转得出来就给 yrc（播放器认这个字段）；
         转不出来 lyric 仍是整行 LRC，和改之前一样。 */
      const yrc = isKrc ? krcToYrc(content) : '';
      return json(res, 200, {
        code: 200, lyric: lrc, yrc, tlyric: '',
        format: yrc ? 'yrc' : (lrc ? 'lrc' : 'none'),
      });
    }

    /* ---- 推荐流（匿名可用）：铺色态「精选」/ 每日推荐跑马带 ---- */
    if (part === 'feed') {
      const limit = Math.min(60, Math.max(1, Number(q.get('limit')) || 20));
      const mode = q.get('mode') || '';
      const r = await scRequest('qishui',
        `/feed?limit=${limit}${mode ? '&scene=' + encodeURIComponent(mode) : ''}`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, {
          code: d.code || 502, source: 'qishui', tracks: [],
          error: d.error || '汽水推荐流没拿到',
        });
      }
      return json(res, 200, {
        code: 200, source: 'qishui',
        tracks: (d.items || []).map(qishuiTrack).filter((t) => t.id && t.name),
      });
    }

    if (part === 'playlist/tracks') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      /* 搬运工具按 offset/limit 翻页：offset 透传给边车（边车回包只有 hasMore，没有 total） */
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 50));
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      const r = await scRequest('qishui',
        `/playlist/tracks?id=${encodeURIComponent(id)}&limit=${limit}&offset=${offset}`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'qishui', tracks: [], error: d.error || '歌单取不到' });
      }
      return json(res, 200, {
        code: 200, source: 'qishui',
        tracks: (d.items || []).map(qishuiTrack).filter((t) => t.id && t.name),
        more: !!d.hasMore,
      });
    }

    /* ---- 场景电台：/feed/modes 给场景卡，点一张再按 scene 取 /feed ---- */
    if (part === 'feed/modes') {
      const r = await scRequest('qishui', '/feed/modes', { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'qishui', stations: [], error: d.error || '汽水场景列表失败' });
      }
      return json(res, 200, {
        code: 200, source: 'qishui',
        stations: (d.modes || []).map(qishuiScene).filter((s) => s.id),
      });
    }

    /* ---- 账号曲库：汽水的第一张特殊歌单（type=1）就是「我喜欢的音乐」 ---- */
    if (part === 'user/playlists') {
      /* 边车的 /user/playlists 支持 limit/offset，并回 hasMore/nextOffset/total。
         以前只传 limit、丢掉 hasMore，超过 limit 的歌单就被截掉；这里按 offset 翻页去重。 */
      const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 100));
      const MAX_PAGES = 20;
      const playlists = [];
      const seen = new Set();
      let offset = 0;
      let total = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await scRequest('qishui', `/user/playlists?limit=${limit}&offset=${offset}`, { timeout: 25000 });
        const d = r.data || {};
        if (d.code !== 200) {
          if (page === 0) {
            return json(res, 200, {
              code: d.code || 401, source: 'qishui', playlists: [],
              error: d.code === 401 ? '先在卡片上扫码登录汽水音乐' : (d.error || '取汽水歌单失败'),
            });
          }
          break;
        }
        const items = Array.isArray(d.items) ? d.items : [];
        if (Number(d.total) > 0) total = Math.max(total, Number(d.total));
        for (const it of items) {
          const p = qishuiPlaylist(it);
          if (!p.id || seen.has(p.id)) continue;
          seen.add(p.id);
          playlists.push(p);
        }
        /* 停法：空页、hasMore=false、offset 不前进（上游异常）、翻到页数上限 */
        if (items.length === 0 || !d.hasMore) break;
        const next = Number(d.nextOffset);
        const step = Number.isSafeInteger(next) && next > offset ? next : offset + items.length;
        if (step <= offset) break;
        offset = step;
      }
      return json(res, 200, {
        code: 200, source: 'qishui',
        playlists,
        total: total || 0,
      });
    }

    if (part === 'liked_songs') {
      const r = await scRequest('qishui', '/liked_songs', { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'qishui', ids: [], total: 0,
          error: d.code === 401 ? '先在卡片上扫码登录汽水音乐' : (d.error || '取「我喜欢」失败'),
        });
      }
      return json(res, 200, { code: 200, source: 'qishui', ids: d.ids || [], total: d.total || 0 });
    }

    /* 汽水红心写入：POST { id, liked }；统一 /api/like 也复用同一个边车路由 */
    if (part === 'like') {
      if (req.method !== 'POST') return json(res, 405, { code: 405, ok: false, error: 'POST required' });
      const body = await readBody(req);
      const id = String(body.id ?? body.songId ?? q.get('id') ?? '').trim();
      if (!id) return json(res, 400, { code: 400, ok: false, error: 'id required' });
      const liked = likeFlag(body.liked ?? q.get('liked'), true);
      const out = await qishuiLikeSet({ id }, liked);
      if (!out.ok) {
        return json(res, 200, {
          code: out.error === 'LOGIN_REQUIRED' ? 401 : 502,
          ok: false,
          error: out.message || '汽水红心写入失败',
        });
      }
      return json(res, 200, { code: 200, ok: true, liked: out.liked });
    }

    if (part === 'playlist/detail') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const r = await scRequest('qishui', `/playlist/detail?id=${encodeURIComponent(id)}`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'qishui', playlist: null, error: d.error || '歌单取不到' });
      }
      return json(res, 200, { code: 200, source: 'qishui', playlist: qishuiPlaylist(d.playlist || {}) });
    }

    if (part === 'search/playlists') {
      const s = (q.get('s') || q.get('keywords') || '').trim();
      if (!s) return json(res, 200, { code: 200, source: 'qishui', playlists: [] });
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 20));
      const r = await scRequest('qishui', `/search/playlists?q=${encodeURIComponent(s)}&limit=${limit}`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'qishui', playlists: [], error: d.error || '搜歌单失败' });
      }
      return json(res, 200, {
        code: 200, source: 'qishui',
        playlists: (d.items || []).map(qishuiPlaylist).filter((p) => p.id),
      });
    }

    if (part === 'recent_played') {
      const r = await scRequest('qishui', '/recent_played?limit=50', { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'qishui', tracks: [],
          error: d.code === 401 ? '先在卡片上扫码登录汽水音乐' : (d.error || '取最近播放失败'),
        });
      }
      return json(res, 200, { code: 200, source: 'qishui', tracks: (d.items || []).map(qishuiTrack).filter((t) => t.id) });
    }

    if (part === 'artist/songs') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const r = await scRequest('qishui', `/artist/songs?id=${encodeURIComponent(id)}&limit=50`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'qishui', tracks: [], error: d.error || '取歌手歌曲失败' });
      }
      return json(res, 200, { code: 200, source: 'qishui', tracks: (d.items || []).map(qishuiTrack).filter((t) => t.id) });
    }

    return json(res, 404, { code: 404, error: 'unknown qishui api: ' + part });
  } catch (e) {
    return json(res, 502, { code: 502, error: String(e.message), reason: e.reason || null, log: scLogTail('qishui') });
  }
}

/**
 * 汽水 / 酷狗的歌词是 KRC 风格：`[起始ms,时长ms]<字偏移,字时长,0>字…`
 * 字偏移是**相对行首**的毫秒数；行首是绝对毫秒。
 *
 * krcToLrc  —— 只要整行（老行为，转换失败时的兜底，也是 lyric 字段的值）
 * krcToYrc  —— 转成播放器认的 YRC：`[行起点,行时长](字绝对起点,字时长,0)字…`
 *               任何一步对不上就返回 ''（调用方据此退回整行 LRC）
 */
function krcToLrc(content) {
  const out = [];
  for (const line of String(content || '').split('\n')) {
    const m = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) continue;
    const start = Number(m[1]);
    const text = m[3].replace(/<[^>]*>/g, '').trim();
    if (!text) continue;
    const mm = Math.floor(start / 60000);
    const ss = ((start % 60000) / 1000).toFixed(2).padStart(5, '0');
    out.push(`[${String(mm).padStart(2, '0')}:${ss}]${text}`);
  }
  return out.join('\n');
}

function krcToYrc(content) {
  try {
    const out = [];
    for (const raw of String(content || '').split('\n')) {
      const line = raw.replace(/\r$/, '');
      const m = line.match(/^\[(\d+),(\d+)\](.*)$/);
      if (!m) continue;
      const start = Number(m[1]);
      const headDur = Number(m[2]);
      const rest = m[3];
      const chars = [];
      /* 逐字三元组：<相对行首ms,字时长ms,0>字。第三个数字目前恒为 0，但别写死。 */
      const re = /<(\d+),(\d+),-?\d+>([^<]*)/g;
      let cm;
      while ((cm = re.exec(rest))) {
        if (!cm[3]) continue;
        chars.push({ off: Number(cm[1]), dur: Number(cm[2]), text: cm[3] });
      }
      if (!chars.length) continue;
      if (!chars.map((c) => c.text).join('').trim()) continue;
      const dur = headDur > 0 ? headDur : Math.max(...chars.map((c) => c.off + c.dur));
      out.push(`[${start},${dur}]` + chars.map((c) => `(${start + c.off},${c.dur},0)${c.text}`).join(''));
    }
    return out.join('\n');
  } catch {
    return '';
  }
}

/** 波点的 wordByWordText 是 AWLRC：`[mm:ss.xxx]<相对行首ms,字时长ms>字…` */
function awlrcToYrc(text) {
  try {
    const lines = String(text || '').split('\n');
    const parsed = [];
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      const m = line.match(/^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$/);
      if (!m) continue;
      const frac = Number((m[3] || '').padEnd(3, '0').slice(0, 3)) || 0;
      const start = Number(m[1]) * 60000 + Number(m[2]) * 1000 + frac;
      const rest = m[4];
      const chars = [];
      const re = /<(\d+),(\d+)>([^<]*)/g;
      let cm;
      while ((cm = re.exec(rest))) {
        if (!cm[3]) continue;
        chars.push({ off: Number(cm[1]), dur: Number(cm[2]), text: cm[3] });
      }
      if (!chars.length) continue;
      if (!chars.map((c) => c.text).join('').trim()) continue;
      parsed.push({ start, chars });
    }
    /* 行时长取「最后一个字结束」，没有字时长的行退回下一行的起点 */
    return parsed.map((p, i) => {
      const end = Math.max(...p.chars.map((c) => c.off + c.dur));
      const next = parsed[i + 1];
      const dur = end > 0 ? end : (next ? Math.max(0, next.start - p.start) : 0);
      return `[${p.start},${dur}]` + p.chars.map((c) => `(${p.start + c.off},${c.dur},0)${c.text}`).join('');
    }).join('\n');
  } catch {
    return '';
  }
}

/* ---------------- /api/bodian/* ---------------- */
async function handleBodian(req, res, url) {
  const part = url.pathname.slice('/api/bodian/'.length);
  const q = url.searchParams;

  if (part === 'health') {
    try {
      const port = await ensureSidecar('bodian');
      const h = await scRequest('bodian', '/health', { timeout: 5000 });
      return json(res, 200, {
        code: 200, ok: true, port, node: (h.data && h.data.node) || '', loggedIn: !!(h.data && h.data.loggedIn),
        license: 'AGPL-3.0',
      });
    } catch (e) {
      return json(res, 502, { code: 502, ok: false, error: String(e.message), reason: e.reason || null, log: scLogTail('bodian') });
    }
  }

  try {
    if (part === 'status') return json(res, 200, (await scRequest('bodian', '/status')).data);
    if (part === 'logout') return json(res, 200, (await scRequest('bodian', '/logout')).data);
    if (part === 'login/qr/key') return json(res, 200, (await scRequest('bodian', '/login/qr/key', { timeout: 25000 })).data);
    if (part === 'login/qr/create') {
      const key = q.get('key') || '';
      if (!key) return json(res, 400, { code: 400, error: 'key required' });
      return json(res, 200, (await scRequest('bodian', `/login/qr/create?key=${encodeURIComponent(key)}`)).data);
    }
    if (part === 'login/qr/check') {
      const key = q.get('key') || '';
      if (!key) return json(res, 400, { code: 400, error: 'key required' });
      return json(res, 200, (await scRequest('bodian', `/login/qr/check?key=${encodeURIComponent(key)}`, { timeout: 25000 })).data);
    }

    if (part === 'search') {
      const s = (q.get('s') || q.get('keywords') || '').trim();
      if (!s) return json(res, 200, { code: 200, source: 'bodian', tracks: [], songCount: 0 });
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 20));
      const r = await scRequest('bodian', `/search?q=${encodeURIComponent(s)}&limit=${limit}&offset=0`);
      const d = r.data || {};
      if (d.code !== 200) return json(res, 200, { code: d.code || 502, source: 'bodian', tracks: [], error: d.error || '波点搜索失败' });
      return json(res, 200, {
        code: 200, source: 'bodian',
        tracks: (d.items || []).map(bodianTrack).filter((t) => t.id && t.name),
        songCount: Number(d.total) || (d.items || []).length,
      });
    }

    if (part === 'song/url') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const quality = ['standard', 'high', 'lossless', 'hires'].includes(q.get('quality')) ? q.get('quality') : 'standard';
      const r = await scRequest('bodian', `/audio?id=${encodeURIComponent(id)}&quality=${quality}`, { timeout: 25000 });
      const d = r.data || {};
      return json(res, 200, {
        code: 200,
        id,
        url: d.url || '',
        preview: !!d.preview,
        previewRange: d.previewRange || null,
        quality: d.quality || quality,
        reason: d.url ? (d.preview ? 'preview' : null) : (d.region ? 'region' : (d.reason || 'unavailable')),
        error: d.url ? null : (d.error || null),
      });
    }

    if (part === 'lyric') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const r = await scRequest('bodian', `/lyrics?id=${encodeURIComponent(id)}`);
      const d = r.data || {};
      const lyric = d.lyric || '';
      /* 边车已经把波点的编码对解成毫秒（AWLRC）：`[mm:ss.xxx]<相对行首ms,字时长ms>字…`
         转得出逐字就放 yrc；转不出（或这首歌没有逐字）就还是整行 LRC。 */
      const yrc = awlrcToYrc(d.wbw || '');
      return json(res, 200, {
        code: 200, lyric, yrc, tlyric: '',
        format: yrc ? 'yrc' : (lyric ? 'lrc' : 'none'),
      });
    }

    /* 歌单曲目：波点只开放了「按 id 取歌单」这一条（没有推荐流 / 喜欢的接口） */
    if (part === 'playlist/tracks') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      /* 搬运工具按 offset/limit 翻页：offset 透传给边车；source / count 逻辑不动 */
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 50));
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      const source = Number(q.get('source'));
      const sourceQs = [1, 2, 3, 4, 5, 6].includes(source) ? `&source=${source}` : '';
      /* count 是列表里这首歌单的曲目数（musicCount）。上游对错误的 source 不是报错，
         而是回 code=200 + 空列表；只有拿到 count 才能把「参数不对」和「真空歌单」区分开，
         否则界面只会显示一个没有任何提示的空列表。 */
      const expect = Math.max(0, Number(q.get('count')) || 0);
      const r = await scRequest('bodian',
        `/playlist/tracks?id=${encodeURIComponent(id)}&limit=${limit}&offset=${offset}${sourceQs}`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'bodian', tracks: [], error: d.error || '歌单取不到' });
      }
      const tracks = (d.items || []).map(bodianTrack).filter((t) => t.id && t.name);
      if (!tracks.length && expect > 0) {
        return json(res, 200, {
          code: 502, source: 'bodian', tracks: [],
          error: `上游返回 0 首（歌单标记 ${expect} 首，source=${source || '默认 4'}）；来源参数可能和歌单类型不匹配`,
        });
      }
      return json(res, 200, {
        code: 200, source: 'bodian',
        tracks,
        more: !!(d.more || d.hasMore),
      });
    }

    /* ---- 推荐 / 日推 / 私人 FM：库在匿名下就能读（2026-11-07 实测） ---- */
    if (part === 'recommendations') {
      const r = await scRequest('bodian', '/recommendations', { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'bodian', playlists: [], error: d.error || '波点推荐歌单失败' });
      }
      return json(res, 200, {
        code: 200, source: 'bodian',
        playlists: (d.playlists || []).map(bodianPlaylist).filter((p) => p.id),
      });
    }

    if (part === 'ai/playlist') {
      const index = Math.max(0, Number(q.get('index')) || 0);
      const r = await scRequest('bodian', `/ai/playlist?index=${index}`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'bodian', tracks: [], error: d.error || '波点日推失败' });
      }
      return json(res, 200, {
        code: 200, source: 'bodian',
        title: d.title || '潮趣日推',
        subTitle: d.subTitle || '',
        tracks: (d.tracks || []).map(bodianTrack).filter((t) => t.id && t.name),
      });
    }

    if (part === 'personal/fm') {
      const r = await scRequest('bodian', '/personal/fm', { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'bodian', tracks: [], error: d.error || '波点私人 FM 失败' });
      }
      return json(res, 200, {
        code: 200, source: 'bodian',
        tracks: (d.tracks || []).map(bodianTrack).filter((t) => t.id && t.name),
      });
    }

    /* ---- 账号曲库：owned / liked 一次全量，collected 按 offset 翻页，三块合起来 ---- */
    if (part === 'user/playlists') {
      /* 边车 /user/playlists 现在把 limit/offset 透传给库的 user_playlists；
         collected 回 { playLists, bodianPagination }。按 nextOffset 翻到底，
         owned/liked 只取第一轮，全部按 id 去重。 */
      const PAGE_LIMIT = 100;
      const MAX_PAGES = 20;
      const playlists = [];
      const seen = new Set();
      /* fallbackSource：自建/红心歌单缺 sourceType 时归一化为 5，
         收藏歌单/公开集合用 4。source 传错时上游会回 200 + 0 首，
         所以必须在这里把来源带对，不能指望取曲目时兜底。 */
      const addRows = (src, fallbackSource) => {
        for (const it of bodianPlaylistRows(src)) {
          const p = bodianPlaylist(it, fallbackSource);
          if (!p.id || seen.has(p.id)) continue;
          seen.add(p.id);
          playlists.push(p);
        }
      };
      let offset = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await scRequest('bodian',
          `/user/playlists?limit=${PAGE_LIMIT}&offset=${offset}`, { timeout: 25000 });
        const d = r.data || {};
        if (d.code !== 200) {
          if (page === 0) {
            return json(res, 200, {
              code: d.code || 401, source: 'bodian', playlists: [],
              error: d.code === 401 ? '先在卡片上扫码登录波点音乐' : (d.error || '取波点歌单失败'),
            });
          }
          break;
        }
        if (page === 0) {
          addRows(d.owned, 5);
          addRows(d.liked, 5);
          if (d.liked && d.liked.id) addRows([d.liked], 5);
        }
        addRows(d.collected, 4);
        /* 停法：hasMore=false、nextOffset 缺失或不前进、翻到页数上限 */
        const pg = (d.collected && d.collected.bodianPagination) || {};
        if (!pg.hasMore) break;
        const next = Number(pg.nextOffset);
        if (!Number.isSafeInteger(next) || next <= offset) break;
        offset = next;
      }
      return json(res, 200, { code: 200, source: 'bodian', playlists });
    }

    /* 「我收藏的专辑」：边车返回 { data:{ albumList, bodianPagination } }，
       这里统一成网易云 album/sublist 的 { data, hasMore }。
       边车现在会把 limit/offset 转给库（库自己按上游原始页分页，并在 albumList 里
       只留 sourceType=6 的专辑），所以 hasMore 直接取 bodianPagination.hasMore。
       注意：一页原始数据里可能只有一部分是专辑，data.length < limit 时仍可能有下一页；
       前端不要拿「短页」当结束条件，只认 hasMore。 */
    if (part === 'user/albums') {
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 50));
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      const r = await scRequest('bodian',
        `/user/albums?limit=${limit}&offset=${offset}`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'bodian', data: [], hasMore: false,
          error: d.code === 401 ? '先在卡片上扫码登录波点音乐' : (d.error || '取波点收藏专辑失败'),
        });
      }
      const wrap = d.data || {};
      const pg = wrap.bodianPagination || {};
      return json(res, 200, {
        code: 200, source: 'bodian',
        data: (Array.isArray(wrap.albumList) ? wrap.albumList : []).map(bodianUserAlbum).filter((a) => a.id),
        hasMore: !!pg.hasMore,
      });
    }

    if (part === 'liked_songs') {
      const r = await scRequest('bodian', '/liked_songs', { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'bodian', tracks: [],
          error: d.code === 401 ? '先在卡片上扫码登录波点音乐' : (d.error || '取「我喜欢」失败'),
        });
      }
      return json(res, 200, {
        code: 200, source: 'bodian',
        tracks: (d.items || []).map(bodianTrack).filter((t) => t.id && t.name),
      });
    }

    /* 波点红心写入：POST { id, liked }；统一 /api/like 也复用同一个边车路由 */
    if (part === 'like') {
      if (req.method !== 'POST') return json(res, 405, { code: 405, ok: false, error: 'POST required' });
      const body = await readBody(req);
      const id = String(body.id ?? body.songId ?? q.get('id') ?? '').trim();
      if (!id) return json(res, 400, { code: 400, ok: false, error: 'id required' });
      const liked = likeFlag(body.liked ?? q.get('liked'), true);
      const out = await bodianLikeSet({ id }, liked);
      if (!out.ok) {
        return json(res, 200, {
          code: out.error === 'LOGIN_REQUIRED' ? 401 : 502,
          ok: false,
          error: out.message || '波点红心写入失败',
        });
      }
      return json(res, 200, { code: 200, ok: true, liked: out.liked });
    }

    if (part === 'playlist/detail') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const r = await scRequest('bodian', `/playlist/detail?id=${encodeURIComponent(id)}`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'bodian', playlist: null, error: d.error || '歌单取不到' });
      }
      return json(res, 200, { code: 200, source: 'bodian', playlist: bodianPlaylist(d.playlist || {}) });
    }

    if (part === 'artist/songs') {
      const id = q.get('id') || '';
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const r = await scRequest('bodian', `/artist/songs?id=${encodeURIComponent(id)}&limit=50`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'bodian', tracks: [], error: d.error || '取歌手歌曲失败' });
      }
      return json(res, 200, {
        code: 200, source: 'bodian',
        tracks: (d.items || []).map(bodianTrack).filter((t) => t.id && t.name),
      });
    }

    return json(res, 404, { code: 404, error: 'unknown bodian api: ' + part });
  } catch (e) {
    return json(res, 502, { code: 502, error: String(e.message), reason: e.reason || null, log: scLogTail('bodian') });
  }
}

/* ==========================================================================
   统一红心（网易云 / QQ / 酷狗 / 汽水 / 波点）
   --------------------------------------------------------------------------
   前端契约：
     GET  /api/like/state?source=&id=&mid=&songId=&hash=
       200 { ok:true, liked, limited? }
       200 { ok:false, error:'LOGIN_REQUIRED'|'UNSUPPORTED'|'FAILED', message }
     POST /api/like  body { source, track, liked }
       200 { ok:true, liked } | { ok:false, error, message }

   规矩：
     - 未登录一律 LOGIN_REQUIRED + 中文提示，绝不假装成功；
     - 平台失败把可读的 message 带出去，但不回传 cookie / token；
     - 重复点赞 / 取消不报错（先查后写或平台自身幂等）。
   ========================================================================== */
const LIKE_SOURCES = new Set(['netease', 'qq', 'kugou', 'qishui', 'bodian']);

/** liked 兼容布尔、"true"/"false"、1/0；缺省按 fallback（写接口默认点赞） */
function likeFlag(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  return fallback;
}

function likeErr(error, message) {
  return { ok: false, error, message };
}

/** 兜底异常信息先脱敏：scRequest 的酷狗请求会把 cookie 放在 URL 上，
 *  万一 fetch 报错把 URL 带进 message，不能原样回给前端。 */
function likeSafeMessage(e) {
  let m = String((e && e.message) || e || '红心操作失败');
  m = m
    .replace(/([?&]cookie=)[^&\s]*/gi, '$1[已隐藏]')
    .replace(/(qqmusic_session=)[^;,\s]+/gi, '$1[已隐藏]')
    .replace(/(MUSIC_U=)[^;,\s]+/gi, '$1[已隐藏]')
    .replace(/(token=)[^;,\s]+/gi, '$1[已隐藏]');
  return m.slice(0, 500);
}

function likeOk(liked, limited) {
  const out = { ok: true, liked: !!liked };
  if (limited) out.limited = true;
  return out;
}

/* ---------------- 网易云 ----------------
   登录态只看 MUSIC_U；uid 不在 cookie 里，问一次 /login/status 并缓存 10 分钟。
   state 优先 /song/like/check（不需要 uid），形状不认识再退回 /likelist。
   写入 /song/like 必须带 uid + like=true/false。 */
let neUidCache = { musicU: '', uid: 0, at: 0 };

async function neteaseUid() {
  const musicU = String(cookies.MUSIC_U || '');
  if (!musicU) return 0;
  if (neUidCache.musicU === musicU && Date.now() - neUidCache.at < 10 * 60 * 1000) {
    return neUidCache.uid;
  }
  const r = await ncRequest('/login/status', { params: {}, cookie: cookieHeader(), timeout: 12000 });
  const d = r.data || {};
  const profile = (d.data && d.data.profile) || d.profile || {};
  const uid = Number(profile.userId) || 0;
  if (uid > 0) neUidCache = { musicU, uid, at: Date.now() };
  return uid;
}

function neteaseIdOf(track) {
  const n = Number(track && (track.id ?? track.songId));
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** /song/like/check 的返回形状在不同版本里变过：数组可能在 ids / data / data.ids 里 */
function neteaseLikedIds(d) {
  if (!d || typeof d !== 'object') return null;
  for (const c of [d.ids, d.data, d.data && d.data.ids, d.data && d.data.trackIds, d.songLikes]) {
    if (Array.isArray(c)) return c.map((x) => String(x));
  }
  if (d.data && typeof d.data === 'object') {
    const keys = Object.keys(d.data);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
      return keys.filter((k) => d.data[k]).map(String);
    }
  }
  return null;
}

async function neteaseLikeState(track) {
  if (!cookies.MUSIC_U) return likeErr('LOGIN_REQUIRED', '先在设置里登录网易云音乐');
  const id = neteaseIdOf(track);
  if (!id) return likeErr('FAILED', '缺少网易云歌曲 id');

  let checkCode = 0;
  let checkMessage = '';
  try {
    const r = await ncRequest('/song/like/check', {
      params: { ids: JSON.stringify([id]) }, cookie: cookieHeader(), timeout: 20000,
    });
    const d = r.data || {};
    checkCode = Number(d.code) || 0;
    checkMessage = d.message || d.msg || '';
    if (checkCode === 200) {
      const ids = neteaseLikedIds(d);
      if (ids) return likeOk(ids.includes(String(id)));
    }
  } catch (e) {
    checkMessage = e.message || '';
  }

  /* check 拿不到 / 形状不认识：退回「我喜欢的音乐」全量列表 */
  const uid = await neteaseUid().catch(() => 0);
  if (!uid) {
    if (checkCode === 301 || checkCode === 401) {
      return likeErr('LOGIN_REQUIRED', '网易云登录态已失效，重新登录后再试');
    }
    return likeErr('FAILED', checkMessage || '拿不到网易云红心状态（登录态或接口异常）');
  }
  try {
    const r = await ncRequest('/likelist', { params: { uid }, cookie: cookieHeader(), timeout: 20000 });
    const d = r.data || {};
    const code = Number(d.code) || 0;
    const ids = Array.isArray(d.ids) ? d.ids
      : (d.data && Array.isArray(d.data.ids) ? d.data.ids : null);
    if (code === 200 && ids) {
      return likeOk(ids.map((x) => String(x)).includes(String(id)));
    }
    if (code === 301 || code === 401) {
      return likeErr('LOGIN_REQUIRED', '网易云登录态已失效，重新登录后再试');
    }
    return likeErr('FAILED', d.message || d.msg || '拿不到网易云「我喜欢」列表');
  } catch (e) {
    return likeErr('FAILED', e.message || '拿不到网易云「我喜欢」列表');
  }
}

async function neteaseLikeSet(track, liked) {
  if (!cookies.MUSIC_U) return likeErr('LOGIN_REQUIRED', '先在设置里登录网易云音乐');
  const id = neteaseIdOf(track);
  if (!id) return likeErr('FAILED', '缺少网易云歌曲 id');

  /* 幂等：已经是要的状态就直接返回，不重复写；登录态明确失效也提前返回 */
  const cur = await neteaseLikeState(track).catch(() => null);
  if (cur && cur.ok && cur.liked === !!liked) return likeOk(!!liked);
  if (cur && !cur.ok && cur.error === 'LOGIN_REQUIRED') return cur;

  const uid = await neteaseUid().catch(() => 0);
  if (!uid) return likeErr('FAILED', '网易云登录态里拿不到 uid，请重新登录');

  const r = await ncRequest('/song/like', {
    params: { id, uid, like: String(!!liked) }, cookie: cookieHeader(), timeout: 20000,
  });
  const d = r.data || {};
  const code = Number(d.code) || 0;
  if (code === 200) return likeOk(!!liked);
  if (code === 301 || code === 401) {
    return likeErr('LOGIN_REQUIRED', '网易云登录态已失效，重新登录后再试');
  }
  return likeErr('FAILED', d.message || d.msg || `网易云返回 ${code || r.status}`);
}

/* ---------------- QQ ----------------
   track.id 就是 mid；写入还必须有数字 songId。
   state 只看「我喜欢」前 100 首；total > 100 且没命中时带 limited。 */
function qqIdOf(track) {
  const t = track || {};
  const rawId = String(t.id || '').trim();
  const mid = String(t.mid || '').trim()
    || (/^[A-Za-z0-9]{1,64}$/.test(rawId) && !/^\d+$/.test(rawId) ? rawId : '');
  const songId = Number(t.songId) > 0
    ? Number(t.songId)
    : (/^\d+$/.test(rawId) && !mid ? Number(rawId) : 0);
  return { mid, songId: Number.isSafeInteger(songId) && songId > 0 ? songId : 0 };
}

async function qqLikeState(track, authCookie) {
  if (!qqTokenFromCookieLine(authCookie)) {
    return likeErr('LOGIN_REQUIRED', '先在设置里登录 QQ 音乐');
  }
  const { mid, songId } = qqIdOf(track);
  if (!mid && !songId) return likeErr('FAILED', '缺少 QQ 歌曲 mid 或数字 songId');

  const r = await qqRequest('/user/liked-songs?limit=100&offset=0', { cookie: authCookie, timeout: 20000 });
  const d = r.data || {};
  const code = Number(d.code) || 0;
  if (r.status === 401 || code === 401) {
    return likeErr('LOGIN_REQUIRED', 'QQ 音乐登录态已失效，重新扫码登录');
  }
  if (code !== 200) {
    return likeErr('FAILED', d.message || d.errorKey || `QQ 返回 ${code || r.status}`);
  }

  const songs = Array.isArray(d.songs) ? d.songs : [];
  const total = Number(d.total) || songs.length;
  const hit = songs.some((it) => {
    const itMid = String(it.mid || it.songmid || '');
    const itId = Number(it.id ?? it.songid) || 0;
    return (mid && itMid === mid) || (songId && itId === songId);
  });
  /* more 是上游明确的「还有下一页」；total 缺失时只看条数会漏判 */
  return likeOk(hit, !hit && (!!d.more || total > songs.length));
}

async function qqLikeSet(track, liked, authCookie) {
  if (!qqTokenFromCookieLine(authCookie)) {
    return likeErr('LOGIN_REQUIRED', '先在设置里登录 QQ 音乐');
  }
  const { mid, songId } = qqIdOf(track);
  if (!mid || !songId) {
    return likeErr('FAILED', '缺少 QQ 歌曲 mid 或数字 songId（重新搜索后再试）');
  }
  const r = await qqRequest('/user/song/like', {
    cookie: authCookie,
    method: 'POST',
    payload: { song: { id: songId, mid, type: 0 }, liked: !!liked },
    timeout: 25000,
  });
  const d = r.data || {};
  const code = Number(d.code) || 0;
  if (r.status === 401 || code === 401) {
    return likeErr('LOGIN_REQUIRED', 'QQ 音乐登录态已失效，重新扫码登录');
  }
  if (code !== 200) {
    return likeErr('FAILED', d.message || d.errorKey || `QQ 返回 ${code || r.status}`);
  }
  if (d.liked !== undefined && !!d.liked !== !!liked) {
    return likeErr('FAILED', 'QQ 返回的红心状态与请求不一致');
  }
  return likeOk(!!liked);
}

/* ---------------- 酷狗 ----------------
   「我喜欢」是 /user/playlist 里的系统歌单：
     - 取曲目用 items 里的 global_collection_id（collection_…_2_0）；
     - 写歌单的 add/del 只认 raw 行里的 listid。
   state 翻 /playlist/track/all 最多 5 页 / 500 首，按 hash 小写比对，缓存 60 秒。
   取消时还需要曲目原始行里的 fileid。 */
const KG_LIKE_TTL = 60 * 1000;
const kgLikeCache = new Map();

function kugouLikeCacheKey(jar = kgActiveJar()) {
  return String(jar.userid || '') || String(jar.token || '');
}

function kugouLikedName(it) {
  return String((it && (it.listname || it.name || it.specialname)) || '');
}

function kugouRawListid(raw) {
  for (const key of ['listid', 'list_id', 'specialid', 'list_create_listid']) {
    const v = raw && raw[key];
    if (v !== undefined && v !== null && String(v) !== '' && String(v) !== '0') return String(v);
  }
  return '';
}

async function kugouLikedPlaylist(cookie, sidecar = kgActiveSidecar()) {
  const l = await kugouUserPlaylistList(cookie, sidecar);
  if (l.failed) {
    return likeErr('LOGIN_REQUIRED', l.error || '酷狗登录态可能已过期，重新扫码后再试');
  }
  const like = l.items.find((p) => p.name === '我喜欢' || p.name === '我喜欢的音乐'
    || /collection_[^_]+_[^_]+_2_0$/.test(p.id));
  if (!like) {
    return likeErr('FAILED', '没找到酷狗的「我喜欢」歌单（在酷狗 App 里点几首红心再回来）');
  }
  /* rawItems 就是 /user/playlist 的原始 info 行：按 id 或名字回找那一行，listid 才是写入键 */
  const raw = l.rawItems.find((it) => String(kugouPlaylist(it).id) === String(like.id))
    || l.rawItems.find((it) => {
      const name = kugouLikedName(it);
      return name === '我喜欢' || name === '我喜欢的音乐';
    });
  const listid = kugouRawListid(raw);
  if (!listid) {
    return likeErr('FAILED', '拿不到酷狗「我喜欢」的 listid（歌单列表里缺少 listid 字段）');
  }
  return {
    ok: true,
    id: like.id,
    listid,
    trackCount: Number(like.trackCount || (raw && (raw.songcount ?? raw.song_count)) || 0) || 0,
  };
}

/** 拉「我喜欢」曲目构建 hash -> fileid 索引；限 5 页 / 500 首，60 秒缓存。
    显式接收 sidecar / jar，跟着 kgUserContext 走（active 缺 userid 时可能是另一版）。 */
async function kugouLikedIndex(cookie, force = false, sidecar = kgActiveSidecar(), jar = kgActiveJar()) {
  const key = kugouLikeCacheKey(jar);
  const hit = kgLikeCache.get(key);
  if (!force && hit && Date.now() - hit.at < KG_LIKE_TTL) return hit.value;

  const lp = await kugouLikedPlaylist(cookie, sidecar);
  if (!lp.ok) return lp;

  const rows = new Map();
  let total = Number(lp.trackCount) || 0;
  let complete = false;
  for (let page = 1; page <= 5; page++) {
    /* 酷狗边车给成功响应挂 2 分钟 apicache：带时间戳，保证写完红心后重建索引
       拿到的是新列表，而不是写之前的缓存。 */
    const r = await scRequest(sidecar,
      `/playlist/track/all?id=${encodeURIComponent(lp.id)}&page=${page}&pagesize=100&_=${Date.now()}`,
      { cookie, timeout: 25000 });
    const d = (r.data && r.data.data) || {};
    const list = Array.isArray(d.songs) ? d.songs
      : Array.isArray(d.info) ? d.info
        : (Array.isArray(d.list) ? d.list : null);
    if (!list) {
      if (page === 1) {
        return likeErr('FAILED',
          (r.data && (r.data.error || r.data.errmsg || r.data.message)) || '酷狗「我喜欢」曲目取不到');
      }
      break;
    }
    total = Number(d.count || d.total) || total;
    for (const it of list) {
      const hash = String((it && it.hash) || '').toLowerCase();
      if (!hash) continue;
      const fileid = Number(it.fileid ?? it.file_id ?? it.fileId ?? 0) || 0;
      rows.set(hash, { fileid });
    }
    if (list.length < 100) { complete = true; break; }
    if (total > 0 && rows.size >= total) { complete = true; break; }
  }

  const limited = !complete && (total === 0 || rows.size < total);
  const value = { ok: true, listid: lp.listid, rows, total, limited };
  kgLikeCache.set(key, { at: Date.now(), value });
  return value;
}

function kugouWriteOk(r) {
  const d = r.data || {};
  return r.status === 200
    && Number(d.error_code || 0) === 0
    && (d.status === undefined || Number(d.status) === 1);
}

function kugouWriteMessage(r) {
  const d = r.data || {};
  return d.error_msg || d.errmsg || d.message
    || `酷狗返回 status ${d.status ?? r.status}`;
}

async function kugouLikeState(track) {
  /* 不先跑 VIP 检测：账号接口只看 jar 里有没有 token / userid。
     active 缺时 kgUserContext 会退到另一版已登录的 jar（同一账号同步）。 */
  const ctx = kgUserContext();
  if (!ctx.jar.token || !ctx.jar.userid) return likeErr('LOGIN_REQUIRED', '先在设置里扫码登录酷狗音乐');
  const hash = String((track && (track.hash || track.id)) || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hash)) return likeErr('FAILED', '缺少酷狗歌曲 hash');

  const idx = await kugouLikedIndex(ctx.cookie, false, ctx.sidecar, ctx.jar);
  if (!idx.ok) return idx;
  const liked = idx.rows.has(hash);
  return likeOk(liked, !liked && idx.limited);
}

async function kugouLikeSet(track, liked) {
  const ctx = kgUserContext();
  if (!ctx.jar.token || !ctx.jar.userid) return likeErr('LOGIN_REQUIRED', '先在设置里扫码登录酷狗音乐');
  const rawHash = String((track && (track.hash || track.id)) || '');
  if (!/^[0-9a-f]{32}$/i.test(rawHash)) return likeErr('FAILED', '缺少酷狗歌曲 hash');
  const hash = rawHash.toLowerCase();   // 只用于和索引比对；写入保留原大小写

  const cookie = ctx.cookie;
  const idx = await kugouLikedIndex(cookie, false, ctx.sidecar, ctx.jar);
  if (!idx.ok) return idx;

  /* 幂等：已经点过红心就不再写；已经不在列表里且索引完整，就当取消成功 */
  if (liked && idx.rows.has(hash)) return likeOk(true);
  if (!liked && !idx.rows.has(hash) && !idx.limited) return likeOk(false);

  if (liked) {
    const name = String((track && track.name) || '').replace(/[|,]/g, ' ').trim() || '未知歌曲';
    const data = [
      name,
      rawHash,
      Number(track && track.albumIdNum) || 0,
      Number(track && track.albumAudioId) || 0,
    ].join('|');
    /* 酷狗边车的缓存键只看 URL，加时间戳避免同一歌单第二次写入命中上次的成功缓存 */
    const r = await scRequest(ctx.sidecar, `/playlist/tracks/add?_=${Date.now()}`, {
      cookie, method: 'POST',
      payload: { listid: idx.listid, data },
      timeout: 30000,
    });
    if (!kugouWriteOk(r)) return likeErr('FAILED', kugouWriteMessage(r));
    kgLikeCache.delete(kugouLikeCacheKey(ctx.jar));
    return likeOk(true);
  }

  const entry = idx.rows.get(hash);
  if (!entry) {
    return likeErr('FAILED', '酷狗「我喜欢」前 500 首里没找到这首歌，无法取消红心');
  }
  if (!entry.fileid) {
    return likeErr('FAILED', '在酷狗「我喜欢」里找到了这首歌，但上游没给 fileid，无法取消红心');
  }
  const r = await scRequest(ctx.sidecar, `/playlist/tracks/del?_=${Date.now()}`, {
    cookie, method: 'POST',
    payload: { listid: idx.listid, fileids: String(entry.fileid) },
    timeout: 30000,
  });
  if (!kugouWriteOk(r)) return likeErr('FAILED', kugouWriteMessage(r));
  kgLikeCache.delete(kugouLikeCacheKey(ctx.jar));
  return likeOk(false);
}

/* ---------------- 汽水 ----------------
   边车 /like_song 把写操作交给库；state 直接用 /liked_songs 的 ids。
   库的 mediaId 只收纯数字字符串，这里先校验，错误更可读。 */
function qishuiIdOf(track) {
  const id = String((track && (track.id ?? track.songId)) || '').trim();
  return /^\d{1,30}$/.test(id) ? id : '';
}

async function qishuiLikeState(track) {
  const id = qishuiIdOf(track);
  if (!id) return likeErr('FAILED', '缺少汽水歌曲 id（应为数字）');
  const r = await scRequest('qishui', '/liked_songs', { timeout: 25000 });
  const d = r.data || {};
  const code = Number(d.code) || 0;
  if (r.status === 401 || code === 401) {
    return likeErr('LOGIN_REQUIRED', '先在设置里登录汽水音乐');
  }
  if (code !== 200) return likeErr('FAILED', d.error || `汽水返回 ${code || r.status}`);
  const ids = Array.isArray(d.ids) ? d.ids.map((x) => String(x)) : [];
  const liked = ids.includes(id);
  return likeOk(liked, !liked && d.whole === false);
}

async function qishuiLikeSet(track, liked) {
  const id = qishuiIdOf(track);
  if (!id) return likeErr('FAILED', '缺少汽水歌曲 id（应为数字）');

  /* 幂等：已经是要的状态就不重复写；列表被截断且没命中时不能当成「未赞」 */
  const cur = await qishuiLikeState(track).catch(() => null);
  if (cur && cur.ok && cur.liked === !!liked && (!cur.limited || cur.liked)) return likeOk(!!liked);
  if (cur && !cur.ok && cur.error === 'LOGIN_REQUIRED') return cur;

  const r = await scRequest('qishui', '/like_song', {
    method: 'POST', payload: { id, liked: !!liked }, timeout: 25000,
  });
  const d = r.data || {};
  const code = Number(d.code) || 0;
  if (r.status === 401 || code === 401) {
    return likeErr('LOGIN_REQUIRED', '先在设置里登录汽水音乐');
  }
  if (code !== 200) return likeErr('FAILED', d.error || `汽水返回 ${code || r.status}`);
  return likeOk(d.liked !== undefined ? !!d.liked : !!liked);
}

/* ---------------- 波点 ----------------
   边车 /liked_songs 目前只取前 50 首；没命中且总数 / hasMore 更大时带 limited。
   写入走边车 /like_song（库要求数字 id + boolean）。 */
function bodianIdOf(track) {
  const id = String((track && (track.id ?? track.songId ?? track.musicRid)) || '').trim();
  return /^\d{1,30}$/.test(id) ? id : '';
}

async function bodianLikeState(track) {
  const id = bodianIdOf(track);
  if (!id) return likeErr('FAILED', '缺少波点歌曲 id（应为数字）');
  const r = await scRequest('bodian', '/liked_songs', { timeout: 25000 });
  const d = r.data || {};
  const code = Number(d.code) || 0;
  if (r.status === 401 || code === 401) {
    return likeErr('LOGIN_REQUIRED', '先在设置里登录波点音乐');
  }
  if (code !== 200) return likeErr('FAILED', d.error || `波点返回 ${code || r.status}`);
  const items = Array.isArray(d.items) ? d.items : [];
  const liked = items.some((it) => String(it.id ?? it.musicRid ?? '') === id);
  const total = Number(d.total) || items.length;
  return likeOk(liked, !liked && (!!d.more || total > items.length));
}

async function bodianLikeSet(track, liked) {
  const id = bodianIdOf(track);
  if (!id) return likeErr('FAILED', '缺少波点歌曲 id（应为数字）');

  /* 幂等：已经是要的状态就不重复写；列表被截断且没命中时不能当成「未赞」 */
  const cur = await bodianLikeState(track).catch(() => null);
  if (cur && cur.ok && cur.liked === !!liked && (!cur.limited || cur.liked)) return likeOk(!!liked);
  if (cur && !cur.ok && cur.error === 'LOGIN_REQUIRED') return cur;

  const r = await scRequest('bodian', '/like_song', {
    method: 'POST', payload: { id, liked: !!liked }, timeout: 25000,
  });
  const d = r.data || {};
  const code = Number(d.code) || 0;
  if (r.status === 401 || code === 401) {
    return likeErr('LOGIN_REQUIRED', '先在设置里登录波点音乐');
  }
  if (code !== 200) return likeErr('FAILED', d.error || `波点返回 ${code || r.status}`);
  return likeOk(d.liked !== undefined ? !!d.liked : !!liked);
}

/* ---------------- 统一入口 ---------------- */
function likeSourceOf(value) {
  return String(value || '').trim().toLowerCase();
}

async function handleLikeState(req, res, url) {
  const q = url.searchParams;
  const source = likeSourceOf(q.get('source'));
  if (!LIKE_SOURCES.has(source)) {
    return json(res, 200, likeErr('UNSUPPORTED',
      '这个音源不支持红心（只支持网易云、QQ、酷狗、汽水、波点）'));
  }
  const track = {
    id: q.get('id') || q.get('songId') || '',
    mid: q.get('mid') || '',
    songId: q.get('songId') || '',
    hash: q.get('hash') || q.get('id') || '',
    name: q.get('name') || '',
    albumIdNum: q.get('albumIdNum') || 0,
    albumAudioId: q.get('albumAudioId') || 0,
  };
  try {
    let out;
    if (source === 'netease') out = await neteaseLikeState(track);
    else if (source === 'qq') out = await qqLikeState(track, qqAuthCookie(req.headers.cookie || '', res));
    else if (source === 'kugou') out = await kugouLikeState(track);
    else if (source === 'qishui') out = await qishuiLikeState(track);
    else out = await bodianLikeState(track);
    return json(res, 200, out);
  } catch (e) {
    return json(res, 200, likeErr('FAILED', likeSafeMessage(e)));
  }
}

async function handleLikeSet(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, likeErr('FAILED', '/api/like 只支持 POST'));
  }
  const body = await readBody(req);
  const source = likeSourceOf(body.source);
  if (!LIKE_SOURCES.has(source)) {
    return json(res, 200, likeErr('UNSUPPORTED',
      '这个音源不支持红心（只支持网易云、QQ、酷狗、汽水、波点）'));
  }
  if (typeof body.liked !== 'boolean') {
    return json(res, 200, likeErr('FAILED', 'liked 必须是 true 或 false'));
  }
  const track = body.track && typeof body.track === 'object' ? body.track : {};
  try {
    let out;
    if (source === 'netease') out = await neteaseLikeSet(track, body.liked);
    else if (source === 'qq') out = await qqLikeSet(track, body.liked, qqAuthCookie(req.headers.cookie || '', res));
    else if (source === 'kugou') out = await kugouLikeSet(track, body.liked);
    else if (source === 'qishui') out = await qishuiLikeSet(track, body.liked);
    else out = await bodianLikeSet(track, body.liked);
    return json(res, 200, out);
  } catch (e) {
    return json(res, 200, likeErr('FAILED', likeSafeMessage(e)));
  }
}

/* ---------------- /api/spotify/*（本期只有元数据） ---------------- */
async function handleSpotify(req, res, url) {
  const part = url.pathname.slice('/api/spotify/'.length);
  const q = url.searchParams;

  const NEED = '需要 Premium + node-librespot 原生二进制（59.4MB），且属解密 DRM 的灰区；本期不接音频';

  if (part === 'health') {
    try {
      const port = await ensureSidecar('spotify');
      const h = await scRequest('spotify', '/health', { timeout: 5000 });
      return json(res, 200, {
        code: 200,
        ok: !!(h.data && h.data.ok),
        port,
        hasClientId: !!(h.data && h.data.clientId),
        hasSecret: !!(h.data && h.data.hasSecret),
        loggedIn: !!(h.data && h.data.loggedIn),
        callback: (h.data && h.data.callback) || '',
        audio: false,
        audioReason: NEED,
        error: (h.data && h.data.ok) ? null : '缺少 SPOTIFY_CLIENT_ID：Spotify 不预置第三方凭证，需自己注册免费 App',
      });
    } catch (e) {
      return json(res, 502, { code: 502, ok: false, error: String(e.message), reason: e.reason || null, log: scLogTail('spotify') });
    }
  }

  try {
    if (part === 'status') return json(res, 200, (await scRequest('spotify', '/status')).data);
    if (part === 'logout') return json(res, 200, (await scRequest('spotify', '/logout')).data);
    if (part === 'login/url') return json(res, 200, (await scRequest('spotify', '/login/url')).data);

    if (part === 'search') {
      const s = (q.get('s') || q.get('keywords') || '').trim();
      if (!s) return json(res, 200, { code: 200, source: 'spotify', tracks: [], songCount: 0 });
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 20));
      const r = await scRequest('spotify', `/search?q=${encodeURIComponent(s)}&limit=${limit}`, { timeout: 20000 });
      const d = r.data || {};
      return json(res, 200, {
        code: d.code || 502,
        source: 'spotify',
        tracks: (d.items || []).map(spotifyTrack).filter((t) => t.id && t.name),
        songCount: Number(d.total) || (d.items || []).length,
        error: d.error || null,
        // 每次搜索都提醒一次：这些结果点了不会有声音
        note: '仅元数据 · 本期不接音频',
      });
    }

    if (part === 'song/url') {
      return json(res, 200, { code: 200, id: q.get('id') || '', url: '', preview: false, reason: 'drm', error: NEED });
    }

    if (part === 'lyric') {
      return json(res, 200, { code: 200, lyric: '', format: 'none', reason: 'no-lyrics-api' });
    }

    return json(res, 404, { code: 404, error: 'unknown spotify api: ' + part });
  } catch (e) {
    return json(res, 502, { code: 502, error: String(e.message), reason: e.reason || null, log: scLogTail('spotify') });
  }
}

/* ---------------- /api/kuwo/* ----------------
   上游能力边界（2026-11-06 全部 curl 验过，见 services/kuwo-api/README.md）：
     有：搜索、歌单详情/搜索、推荐歌单、排行榜、专辑、每日推荐、完整时长直链、歌词
     没有：扫码登录（只能粘 Cookie）、用户歌单、我喜欢的音乐、电台单集曲目
   拿不到的就不返回假数据，宁可 { code:200, tracks:[], error:'原因' }。 */
async function handleKuwo(req, res, url) {
  const part = url.pathname.slice('/api/kuwo/'.length);
  const q = url.searchParams;

  if (part === 'health') {
    try {
      const port = await ensureSidecar('kuwo');
      const h = await scRequest('kuwo', '/health', { timeout: 5000 });
      return json(res, 200, {
        code: 200,
        ok: !!(h.data && h.data.ok),
        port,
        node: process.versions.node,
        audio: true,
        login: 'cookie',
      });
    } catch (e) {
      return json(res, 502, { code: 502, ok: false, error: String(e.message), reason: e.reason || null, log: scLogTail('kuwo') });
    }
  }

  try {
    if (part === 'status') return json(res, 200, (await scRequest('kuwo', '/status')).data);
    if (part === 'logout') return json(res, 200, (await scRequest('kuwo', '/logout')).data);

    /* 登录：只收整段 Cookie。cookie 走 JSON body（不进 URL / 不进边车日志） */
    if (part === 'login/cookie') {
      if (req.method !== 'POST') return json(res, 405, { code: 405, error: '请用 POST 提交 Cookie' });
      const body = await readBody(req);
      const cookie = String(body.cookie || body.value || '').trim();
      if (!cookie) return json(res, 200, { code: 200, loggedIn: false, error: 'Cookie 是空的' });
      const port = await ensureSidecar('kuwo');
      const r = await fetch(`http://127.0.0.1:${port}/login/cookie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await r.json().catch(() => ({ code: 502, error: '边车返回无法解析' }));
      return json(res, 200, data);
    }

    /* 不伪造二维码：酷我 Web 端没有扫码登录接口 */
    if (part.startsWith('login/qr/')) {
      return json(res, 200, {
        code: 501,
        error: '酷我 Web 端不提供扫码登录；请登录 www.kuwo.cn 后粘贴 Cookie',
      });
    }

    if (part === 'search') {
      const s = (q.get('s') || q.get('keywords') || '').trim();
      if (!s) return json(res, 200, { code: 200, source: 'kuwo', tracks: [], songCount: 0 });
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 20));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const d = (await scRequest('kuwo', `/search?s=${encodeURIComponent(s)}&limit=${limit}&page=${page}`, { timeout: 25000 })).data || {};
      return json(res, 200, {
        code: d.code || 502,
        source: 'kuwo',
        tracks: (d.list || []).map(kuwoTrack).filter((t) => t.id && t.name),
        songCount: Number(d.total) || 0,
        error: d.error || null,
      });
    }

    if (part === 'playlist/tracks') {
      const id = String(q.get('id') || '').trim();
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 100));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const d = (await scRequest('kuwo', `/playlist/tracks?id=${encodeURIComponent(id)}&limit=${limit}&page=${page}`, { timeout: 25000 })).data || {};
      return json(res, 200, {
        code: d.code || 502,
        source: 'kuwo',
        id: String(d.id || id),
        name: d.name || '',
        cover: d.cover || '',
        creator: d.creator || '',
        total: Number(d.total) || 0,
        tracks: (d.list || []).map(kuwoTrack).filter((t) => t.id && t.name),
        error: d.error || null,
      });
    }

    if (part === 'playlist/search') {
      const key = (q.get('key') || q.get('s') || '').trim();
      if (!key) return json(res, 200, { code: 200, source: 'kuwo', playlists: [] });
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 30));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const d = (await scRequest('kuwo', `/playlist/search?key=${encodeURIComponent(key)}&limit=${limit}&page=${page}`, { timeout: 25000 })).data || {};
      return json(res, 200, {
        code: d.code || 502,
        source: 'kuwo',
        playlists: (d.list || []).map(kuwoPlaylist).filter((p) => p.id && p.name),
        total: Number(d.total) || 0,
        error: d.error || null,
      });
    }

    if (part === 'recommend/playlists') {
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 12));
      const d = (await scRequest('kuwo', `/recommend/playlists?limit=${limit}`)).data || {};
      return json(res, 200, {
        code: d.code || 502,
        source: 'kuwo',
        playlists: (d.list || []).map(kuwoPlaylist).filter((p) => p.id && p.name),
        error: d.error || null,
      });
    }

    if (part === 'rank/list') {
      const d = (await scRequest('kuwo', '/rank/list')).data || {};
      const groups = d.list || [];
      const playlists = [];
      for (const g of groups) {
        for (const it of (g.list || [])) playlists.push(kuwoPlaylist(it));
      }
      return json(res, 200, {
        code: d.code || 502,
        source: 'kuwo',
        playlists: playlists.filter((p) => p.id && p.name),
        error: d.error || null,
      });
    }

    if (part === 'rank/tracks') {
      const id = String(q.get('id') || '16');
      const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 50));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const d = (await scRequest('kuwo', `/rank/tracks?id=${encodeURIComponent(id)}&limit=${limit}&page=${page}`)).data || {};
      return json(res, 200, {
        code: d.code || 502,
        source: 'kuwo',
        id,
        total: Number(d.total) || 0,
        tracks: (d.list || []).map(kuwoTrack).filter((t) => t.id && t.name),
        error: d.error || null,
      });
    }

    if (part === 'album/tracks') {
      const id = String(q.get('id') || '').trim();
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 100));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const d = (await scRequest('kuwo', `/album/tracks?id=${encodeURIComponent(id)}&limit=${limit}&page=${page}`)).data || {};
      return json(res, 200, {
        code: d.code || 502,
        source: 'kuwo',
        id: String(d.id || id),
        name: d.name || '',
        cover: d.cover || '',
        total: Number(d.total) || 0,
        tracks: (d.list || []).map(kuwoTrack).filter((t) => t.id && t.name),
        error: d.error || null,
      });
    }

    if (part === 'radio/stations') {
      const d = (await scRequest('kuwo', '/radio/stations')).data || {};
      return json(res, 200, {
        code: d.code || 502,
        source: 'kuwo',
        // 只有栏目目录，没有单集曲目接口：playable=false，前端不会拿它冒充可播电台
        playable: false,
        stations: (d.list || []).map((it) => ({
          id: String(it.rid || ''),
          source: 'kuwo',
          name: it.album || '未命名电台',
          cover: it.pic || '',
          creator: { nickname: it.artist || '' },
          playCount: Number(it.listencnt) || 0,
          playable: false,
        })),
        error: d.error || null,
        note: '酷我只开放电台栏目目录，没有单集曲目接口',
      });
    }

    if (part === 'daily') {
      const d = (await scRequest('kuwo', '/daily', { timeout: 25000 })).data || {};
      return json(res, 200, {
        code: d.code || 502,
        source: 'kuwo',
        name: d.name || '每日推荐',
        from: d.source || '',
        tracks: (d.list || []).map(kuwoTrack).filter((t) => t.id && t.name),
        error: d.error || null,
      });
    }

    if (part === 'song/url') {
      const id = String(q.get('id') || q.get('mid') || '').trim();
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const quality = String(q.get('quality') || '320');
      const d = (await scRequest('kuwo', `/song/url?id=${encodeURIComponent(id)}&quality=${encodeURIComponent(quality)}`, { timeout: 25000 })).data || {};
      return json(res, 200, {
        code: d.code || 502,
        id,
        url: d.url || '',
        quality: d.quality || '',
        format: d.format || '',
        preview: false,
        source: d.source || 'kuwo',
        reason: d.url ? null : (d.reason || 'unavailable'),
        error: d.url ? null : (d.error || '上游没给播放地址'),
      });
    }

    if (part === 'lyric') {
      const id = String(q.get('id') || q.get('mid') || '').trim();
      if (!id) return json(res, 400, { code: 400, error: 'id required' });
      const d = (await scRequest('kuwo', `/lyric?id=${encodeURIComponent(id)}`, { timeout: 25000 })).data || {};
      const lyric = d.lyric || '';
      /* 边车把 lrcx 里的 `<...>` 解成了逐字时间轴（以前当翻译标记整段删掉）。
         解出来就放 yrc；边车若退回 H5 整行歌词，就没有 yrc。 */
      const yrc = d.yrc || '';
      return json(res, 200, {
        code: d.code || 502,
        lyric,
        yrc,
        tlyric: '',
        format: yrc ? 'yrc' : (d.format || (lyric ? 'lrc' : 'none')),
        source: d.source || '',
        error: (lyric || yrc) ? null : (d.error || '酷我没给这首歌歌词'),
      });
    }

    /* 上游确实没有这两个接口（www/wapi/mobile wapi 全 404）：返回空态 + 原因 */
    if (part === 'user/playlists' || part === 'liked') {
      return json(res, 200, {
        code: 200,
        source: 'kuwo',
        playlists: [],
        tracks: [],
        error: part === 'liked'
          ? '酷我 Web 没有「我喜欢的音乐」接口，不编内容'
          : '酷我 Web 没有用户歌单接口，不编内容',
      });
    }

    return json(res, 404, { code: 404, error: 'unknown kuwo api: ' + part });
  } catch (e) {
    return json(res, 502, { code: 502, error: String(e.message), reason: e.reason || null, log: scLogTail('kuwo') });
  }
}

/* ---------------- 各平台音频代理（一律转发 Range） ----------------
   `<audio>` 拖进度条会发 Range 请求，代理不转发就会整段重下（QQ 那边踩过）。
   只放行目标 CDN 域名，别把这个口子变成任意 SSRF。 */
const AUDIO_HOSTS = {
  kugou: [/\.kugou\.com$/i, /\.kgmusic\.cn$/i, /\.kglink\.com$/i, /\.kugou\.com\.cn$/i],
  qishui: [/\.365yg\.com$/i, /\.douyinvod\.com$/i, /\.byteicdn\.com$/i, /\.pstatp\.com$/i, /\.douyinpic\.com$/i, /\.snssdk\.com$/i],
  bodian: [/\.kuwo\.cn$/i, /\.kugou\.com$/i, /\.bodian\.com$/i],
  /* 酷我：mobi convert_url2 实测返回 kw-er.kuwo.cn / kw-lv.kuwo.cn（都带 Range 206）。
     只放行 kuwo.cn / kuwo.com 两个域，别把代理开成任意 CDN。 */
  kuwo: [/\.kuwo\.cn$/i, /\.kuwo\.com$/i],
  spotify: [],   // 本期不接音频，直接拒
  /* 网易云的 CDN（*.music.126.net）**不回 Access-Control-Allow-Origin**。
     10-30 实测：m704/m804 上 standard/higher/exhigh/lossless/hires 五档全部 ACAO=<none>，
     连发 14 次 0/14 带 ACAO；同一对象换 m701/m801 才回 `*`。而 player.js 必须设
     `audio.crossOrigin='anonymous'`（Web Audio 吃 analyser，BPM + 235 个形态都靠它），
     于是浏览器按 CORS 模式请求 → 被拦成 net::ERR_FAILED → <audio> 报 error 4
     "MEDIA_ELEMENT_ERROR: Format error"，一首歌都放不出来。
     结论：网易云和 QQ 一样，直链必须走本机代理（同源 = 没有 CORS 这道门）。 */
  netease: [/\.music\.126\.net$/i],
};
const AUDIO_REFERER = {
  kugou: 'https://www.kugou.com/',
  /* 汽水的 CDN（*.365yg.com）**认了 Referer 反而回 403**（实测 qishui.com 的 referer 被拒，
     不带 referer 才是 206）。所以这条留空，别「顺手补上」。 */
  qishui: '',
  bodian: 'https://www.bodian.com/',
};

async function proxySourceAudio(req, res, url, source) {
  let u;
  try { u = new URL(url.searchParams.get('url') || ''); } catch { return json(res, 400, { error: 'bad url' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return json(res, 400, { error: 'bad protocol' });
  const allow = AUDIO_HOSTS[source] || [];
  if (!allow.length) return json(res, 403, { error: `no audio for source ${source}` });
  if (!allow.some((re) => re.test(u.hostname))) return json(res, 403, { error: 'host not allowed: ' + u.hostname });

  const headers = { 'User-Agent': 'Mozilla/5.0' };
  if (AUDIO_REFERER[source]) headers.Referer = AUDIO_REFERER[source];
  if (req.headers.range) headers.Range = req.headers.range;
  /* If-Range 也要转发：拖进度条时浏览器可能带它，丢了会让 CDN 把
     条件 Range 当成整段请求。 */
  if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
  /* 只给「等响应头」设超时，不设整段超时：音频是长流，15 秒总超时
     会把正在播的歌在第 15 秒掐断。拿到响应头后立刻清计时器。 */
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  let upstream;
  try {
    upstream = await fetch(u, { headers, redirect: 'follow', signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
    return json(res, timedOut ? 504 : 502, {
      code: timedOut ? 504 : 502,
      error: timedOut ? '上游音频 15 秒没有响应' : String(e.message),
    });
  }
  clearTimeout(timer);
  /* 上游没兑现 Range 时不要谎报 Accept-Ranges: bytes。之前无条件写，
     浏览器以为任意位置都能拖；实际 CDN 回 200/403/挂起时，<audio>
     会永久 waiting 且不触发 error（酷狗概念版拖动静音就是这么来的）。 */
  const ranged = !!req.headers.range;
  const honorsRange = upstream.status === 206
    || /bytes/i.test(String(upstream.headers.get('accept-ranges') || ''));
  const out = {
    'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
    'Cache-Control': 'no-store',
  };
  if (honorsRange) out['Accept-Ranges'] = upstream.headers.get('accept-ranges') || 'bytes';
  for (const k of ['content-length', 'content-range']) {
    const v = upstream.headers.get(k);
    if (v) out[k] = v;
  }
  if (ranged && upstream.status !== 206) {
    console.warn(`  [audio] Range 没兑现：${source} ${u.hostname} 请求 ${req.headers.range}`
      + ` → ${upstream.status}`
      + (upstream.headers.get('content-range')
        ? ` Content-Range=${upstream.headers.get('content-range')}`
        : ' 无 Content-Range'));
  }
  res.writeHead(upstream.status, out);
  if (!upstream.body) return res.end();
  pipeUpstream(upstream, res);
}

/* --------------------------------------------------------------------------
   路由表：/api/<name> → 网易云 weapi 路径
   下面这些路径是实探出来的（网易云对猜的路径会返回 code:404「接口未找到」）
   -------------------------------------------------------------------------- */
const ROUTES = {
  /* 登录
     ---- 扫码走 eapi ----
     weapi 那版扫码（/weapi/login/qrcode/*）会被上游回 8821「请切换其他登录方式
     或升级新版本再试」；eapi 版实测新 key + 立即 check 稳定回 801。
     channel 决定 dispatch 用哪套加密发请求，别的路由不写 channel 就还是 weapi。 */
  'login/qr/key':          { path: '/login/qrcode/unikey',       channel: 'eapi' },
  'login/qr/check':        { path: '/login/qrcode/client/login', channel: 'eapi' },
  'login/cellphone':       { path: '/login/cellphone' },
  'login/status':          { path: '/w/nuser/account/get' },
  'logout':                { path: '/logout' },
  // 用户内容
  'user/playlist':         { path: '/user/playlist' },
  // 个人主页：头像 / 背景图 / 个性签名 / 等级 / 听歌量 / 关注粉丝 全在
  // /v1/user/detail/{uid} 里。uid 在**路径**里，所以 dispatch 里做了 :uid 占位符替换。
  // 匿名就能拿到公开信息；最近播放（/v1/play/record）和动态要登录。
  'user/detail':           { path: '/v1/user/detail/:uid' },
  'playlist/detail':       { path: '/v6/playlist/detail' },
  'playlist/track/all':    { path: '/v6/playlist/detail' },   // 曲目从 detail.playlist.tracks 取
  'song/url':              { path: '/song/enhance/player/url/v1' },
  'song/detail':           { path: '/v3/song/detail' },
  // 歌曲百科：带 BPM、语言、风格标签、获奖等元数据。
  // 匿名也能用，实测 9/9 覆盖（网易云的常规歌曲接口里是没有 BPM 字段的，
  // 只有这个百科接口有）。
  'song/wiki':             { path: '/song/play/about/block/page' },
  // /song/lyric/v1 比 /song/lyric 多给 klyric/tlyric/romalrc，
  // 登录后也是这个接口下发逐字歌词 yrc。
  'lyric':                 { path: '/song/lyric/v1' },
  'search':                { path: '/search/get' },
  'personalized':          { path: '/personalized/newsong' },
  'recommend/songs':       { path: '/v1/discovery/recommend/songs' },
  // 大厅下滑那一屏：推荐歌单。
  // 实探：/top/playlist、/v3/top/playlist、/top/playlist/highquality 都返回 404，
  // /v1/discovery/recommend/resource 返回 301，**只有 /personalized/playlist 匿名可用**。
  'top/playlist':          { path: '/personalized/playlist' },
  /* ---- 歌手页 / 专辑页（10-27 接入）----
     路径里的 :id 由 dispatch 里那个「通用占位符」循环替换，和 user/detail 的 :uid
     共用同一套机制（不要另写一套）。实测不存在：/artist/detail、/v1/artist/albums、
     /artist/top/song 都是 404，别试。 */
  'artist/:id':            { path: '/v1/artist/:id' },           // 歌手 + hotSongs[50]
  'artist/albums/:id':     { path: '/artist/albums/:id' },      // limit/offset/total
  'artist/songs':          { path: '/v1/artist/songs' },        // id/limit/offset/order
  'album/:id':             { path: '/v1/album/:id' },           // 专辑 + songs[]
};

/** 路由查找：先按精确名字找；找不到再按 'artist/:id' 这类模式逐段匹配。
 *  返回 { key, route, params }，pathParams 供 dispatch 做 :id 替换。 */
function matchRoute(name) {
  if (ROUTES[name]) return { key: name, route: ROUTES[name], params: {} };
  const segs = name.split('/');
  for (const key of Object.keys(ROUTES)) {
    if (!key.includes(':')) continue;
    const ks = key.split('/');
    if (ks.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < ks.length; i++) {
      if (ks[i].startsWith(':')) params[ks[i].slice(1)] = segs[i];
      else if (ks[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { key, route: ROUTES[key], params };
  }
  return null;
}

/* --------------------------------------------------------------------------
   批量取歌曲详情
   -------------------------------------------------------------------------- */
/** 每批最多 500 首（上游限制约 1000，留余量更稳） */
async function fetchTrackDetails(ids) {
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const c = JSON.stringify(batch.map((id) => ({ id })));
    const d = await weapiRequest('/v3/song/detail', { c });
    if (Array.isArray(d.songs)) out.push(...d.songs);
  }
  return out;
}

/** 上游字段名千奇百怪（artist/artists/ar、album/al、duration/dt…），
    这里统一成前端只认一种的形状：{ id, name, artists, album, cover, duration, fee }
 *
 * 封面尤其坑：不同接口给的字段完全不同 ——
 *   /v3/song/detail  → al.picUrl              ✅ 有完整 URL
 *   /playlist/detail → al.picUrl              ✅
 *   /search/get      → album.picId            ❌ 只有 id，**没有** picUrl
 *
 * 注意：搜索接口的 picId 不能拿来拼 URL —— 实测 URL 里的文件名和 picId
 * 并不一致（picId=...270 但文件名是 ...276.jpg），拼出来是 404。
 * 所以 search 走「拿到 id 后再查一次 song/detail 补封面」的路子，见 normalize()。
 */
function coverOf(s, album) {
  return album.picUrl || album.blurPicUrl || s.picUrl || s.coverImgUrl || '';
}

function toTrack(s) {
  if (!s) return null;
  const artists = s.ar || s.artists || [];
  const album = s.al || s.album || {};
  return {
    id: s.id,
    name: s.name,
    artists: artists.map((a) => a.name).join(' / ') || '未知歌手',
    artistIds: artists.map((a) => a.id),
    album: album.name || '',
    // 专辑页入口要用：曲目行里的专辑名 → /api/album/:id（纯附加字段，不影响老代码）
    albumId: album.id || null,
    cover: coverOf(s, album),
    duration: s.dt || s.duration || 0,
    fee: s.fee ?? 0,
  };
}

/* 扫码诊断：最近一次 login/qr/check 的上游响应摘要（只读，给「查看诊断」用）。
   只记 code / message / 用的哪条通道 / 有没有 MUSIC_U / cookie **键名** ——
   绝不记任何 cookie 值、token（这个对象会原样发给前端）。 */
let lastQrCheck = null;
function recordQrCheck(raw, channel = 'weapi') {
  lastQrCheck = {
    at: new Date().toISOString(),
    channel,                             // 'weapi' | 'eapi'：下次一看就知道走的是哪条
    code: raw && raw.code !== undefined && raw.code !== null ? raw.code : null,
    message: (raw && (raw.message ?? raw.msg)) || '',
    hasMusicU: !!cookies.MUSIC_U,
    loggedIn: !!cookies.MUSIC_U,
    cookieKeys: Object.keys(cookies),
  };
}

/* --------------------------------------------------------------------------
   网易云「富文本行」→ 标准 LRC
   —— 上游 /song/lyric/v1 现在会把创作信息（作词/作曲/编曲/制作名单…）以 NDJSON
      塞进 lrc.lyric：**一行一个 JSON 对象**
        {"t":0,"c":[{"tx":"作词: "},{"tx":"周杰伦","li":"…","or":"orpheus://…"}]}
      c 里 tx 是文字（一行内多个 tx 顺序拼起来），li 是艺人头像、or 是 orpheus
      链接，都不是歌词正文，丢掉。这些行和普通 `[mm:ss.xx]正文` 行**混排**：
      开头 3~4 条头部信息、结尾一堆制作名单；纯信息歌（纯音乐等）甚至整首
      只有 JSON 行。前端 parseLrcLines 只认 `[mm:ss`，这些行全被跳过 ——
      行数少的歌看起来就是「整首歌词空」。
      实测（284 首、4261 个 c 项）：
        · 时间只有行级 t（毫秒；见过 -1，也有整块缺 t 的）；
        · c 项只有 tx / li / or 三种键，**没有**字级时间 —— 所以这里只产整行
          LRC，不伪造 yrc（没有逐字时前端本来就会退回整行，行为不变）。
   规则（为了「正常文本路径一个字都不变」）：
     · 只改能解析成 {c:[{tx:String}]} 的行；其他行（含普通 LRC）原样保留；
       纯文本 LRC 进来是恒等返回，连字符串引用都不换；
     · t 缺失：沿用上一条的时间 +1000ms（实测带时版就是 0/1000/2000… 这节奏）；
     · t 为负：按 0 算（实测见过 "t":-1；负数进 LRC 前端正则认不出）；
     · 任何一步失败 / 结构不认识：退回原串，绝不抛异常。
   时间格式跟 krcToLrc 保持一致：`[mm:ss.xx]`（两位小数、秒补到 5 位）。
   -------------------------------------------------------------------------- */
function isRichLyricObj(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o)
    && Array.isArray(o.c)
    && o.c.every((x) => x && typeof x === 'object' && typeof x.tx === 'string');
}

function richLyricText(o) {
  return o.c.map((x) => x.tx).join('').replace(/[\r\n]+/g, ' ').trim();
}

function fmtLrcTime(ms) {
  // 先落到 10ms（LRC 的 .xx 精度），免得 59.999s 被 toFixed 进成 "60.00"
  const v = Math.max(0, Math.round((Number(ms) || 0) / 10) * 10);
  const mm = Math.floor(v / 60000);
  const ss = ((v % 60000) / 1000).toFixed(2).padStart(5, '0');
  return `[${String(mm).padStart(2, '0')}:${ss}]`;
}

/** 取这一行的毫秒时间：没有/非数字 → 上一条 +1000；负数 → 0 */
function richLyricMs(o, prevT) {
  const raw = (o.t === undefined || o.t === null || o.t === '') ? NaN : Number(o.t);
  const t = Number.isFinite(raw) ? raw : prevT + 1000;
  return t < 0 ? 0 : t;
}

function richLyricToLrc(text) {
  try {
    if (typeof text !== 'string' || text.indexOf('{') < 0) return text;

    // ① 极少数情况整串就是一个 JSON 数组（不是 NDJSON）：逐项转
    const whole = text.trim();
    if (whole.startsWith('[')) {
      try {
        const arr = JSON.parse(whole);
        if (Array.isArray(arr) && arr.length && arr.every(isRichLyricObj)) {
          let prevT = -1000;
          const out = [];
          for (const o of arr) {
            const body = richLyricText(o);
            const t = richLyricMs(o, prevT);
            prevT = t;
            out.push(fmtLrcTime(t) + body);
          }
          if (out.length) return out.join('\n');
        }
      } catch { /* 不是合法 JSON 数组 → 按逐行处理 */ }
    }

    // ② 常态：NDJSON，一行一个对象，和普通 LRC 行混排
    let changed = false;
    let prevT = -1000;              // 首条缺时间的行落在 0
    const out = [];
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      const s = line.trim();
      if (!s.startsWith('{')) { out.push(line); continue; }
      let o;
      try { o = JSON.parse(s); } catch { out.push(line); continue; }
      if (!isRichLyricObj(o)) { out.push(line); continue; }
      const body = richLyricText(o);        // 可能为空（实测有空占位行）→ 只留时间戳
      const t = richLyricMs(o, prevT);
      prevT = t;
      out.push(fmtLrcTime(t) + body);
      changed = true;
    }
    return changed ? out.join('\n') : text;
  } catch {
    return text;
  }
}

async function normalize(name, data, channel = 'weapi') {
  switch (name) {
    case 'login/qr/key':
      return { code: data.code ?? 200, key: data.unikey || null, message: data.message };

    case 'playlist/detail':
    case 'playlist/track/all': {
      const p = data.playlist || {};
      // v6/detail 的 playlist.tracks 只给 6 首试听，完整曲目在 trackIds 里，
      // 需要再拿 trackIds 去 batch 查详情（每批 500 首，别一次塞 1000 个 id）。
      let tracks = p.tracks || [];
      const ids = (p.trackIds || []).map((t) => t.id);
      if (ids.length > tracks.length || name === 'playlist/track/all') {
        tracks = await fetchTrackDetails(ids);
      }
      return {
        code: data.code ?? 200,
        playlist: {
          id: p.id,
          name: p.name,
          cover: p.coverImgUrl,
          trackCount: p.trackCount,
          playCount: p.playCount,
          description: p.description,
          creator: p.creator ? { nickname: p.creator.nickname, avatar: p.creator.avatarUrl } : null,
        },
        tracks: tracks.map(toTrack).filter(Boolean),
      };
    }

    case 'user/playlist':
      return {
        code: data.code ?? 200,
        playlists: (data.playlist || []).map((p) => ({
          id: p.id,
          name: p.name,
          cover: p.coverImgUrl,
          trackCount: p.trackCount,
          playCount: p.playCount,
          subscribed: !!p.subscribed,
          /* 5 =「我喜欢的音乐」系统歌单：原来被这里抹掉，前端那几条
             specialType !== 5 / === 5 的过滤实际一直没生效。 */
          specialType: Number(p.specialType) || 0,
        })),
      };

    case 'song/url': {
      // v1 接口每首返回 { url, fee, freeTrialInfo, code }，url 为 null 即拿不到版权/VIP 地址
      const list = Array.isArray(data.data) ? data.data : [];
      return {
        code: data.code ?? 200,
        data: list.map((s) => ({
          id: s.id,
          url: s.url || null,
          br: s.br,
          size: s.size,
          fee: s.fee ?? 0,
          // code -110 = 无版权/需付费；前端据此决定降级
          reason: s.url ? null : (s.code === -110 ? 'vip' : 'unavailable'),
          freeTrialInfo: s.freeTrialInfo || null,
          level: s.level || null,
        })),
      };
    }

    case 'song/detail':
      return { code: data.code ?? 200, tracks: (data.songs || []).map(toTrack).filter(Boolean) };
    case 'song/wiki': {
      // 百科数据是一堆 block，只挑我们要的那块
      const blocks = data?.data?.blocks || data?.blocks || [];
      const basic = blocks.find((b) => b.code === 'SONG_PLAY_ABOUT_SONG_BASIC');
      const creatives = basic?.creatives || [];
      const pick = (type) => creatives.find((c) => c.creativeType === type);
      const textOf = (c) => c?.uiElement?.textLinks?.[0]?.text ?? null;
      const listOf = (c) => (c?.resources || []).map((r) => r.text || r.name).filter(Boolean);

      const bpmRaw = textOf(pick('bpm'));
      const bpm = bpmRaw && /^\d+$/.test(bpmRaw.trim()) ? Number(bpmRaw.trim()) : null;
      return {
        code: data.code ?? 200,
        bpm,                                   // 网易云给的权威 BPM（没有则为 null）
        language: textOf(pick('language')),
        tags: listOf(pick('songTag')),
        bizTags: listOf(pick('songBizTag')),
        awards: listOf(pick('songAward')),
        // 相似歌曲 / 相关歌单也在这份数据里，先只取 id 备用
        similarIds: (blocks.find((b) => b.code === 'SONG_PLAY_ABOUT_SIMILAR_SONG')?.creatives || [])
          .flatMap((c) => (c.resources || []).map((r) => r.resourceId || r.id)).filter(Boolean),
      };
    }

    case 'lyric': {
      // 逐字歌词（YRC）网易云只在**已登录**时下发：匿名请求即使带 kv/yv 参数，
      // 返回的也只有 lrc / tlyric / romalrc（已实测：yrc 字段始终缺失）。
      // 所以这里把能拿到的都拿上，前端按「有 yrc 用 yrc，没有退回 lrc」渲染。
      const lrcRaw = data?.lrc?.lyric ?? data?.lyric ?? '';
      /* 上游会把「作词/作曲/制作名单」以 NDJSON 混进 lrc.lyric（见 richLyricToLrc），
         不转这段前端一行都认不出 → 整首空。纯文本 LRC 走这里原样返回。 */
      const lrc = richLyricToLrc(lrcRaw);
      const yrc = data?.yrc?.lyric ?? '';
      return {
        code: data.code ?? 200,
        lyric: lrc,
        // 逐字：有则用，前端会解析 [起,时长] 三元组
        yrc,
        tlyric: data?.tlyric?.lyric ?? '',
        ytlrc: data?.ytlrc?.lyric ?? '',
        romalrc: data?.romalrc?.lyric ?? '',
        // 纯音乐的判定
        nolyric: !!data.nolyric,
        // 告诉前端这次到底用上了哪种格式，播放页可以显示
        format: yrc ? 'yrc' : (lrc ? 'lrc' : 'none'),
      };
    }

    case 'search': {
      const r = data.result || {};
      const raw = r.songs || [];
      // 搜索接口只给 album.picId，没有 picUrl，而 picId 拼不出封面 URL
      // （文件名和 picId 并不一致，实测拼出来是 404）。
      // 所以拿到 id 后再批量查一次详情，把真实封面补齐。
      let tracks = raw.map(toTrack).filter(Boolean);
      if (tracks.some((t) => !t.cover)) {
        try {
          const full = await fetchTrackDetails(tracks.map((t) => t.id));
          const byId = new Map(full.map((s) => [s.id, toTrack(s)]));
          tracks = tracks.map((t) => {
            const f = byId.get(t.id);
            // 详情里可能缺时长等字段，只在本地缺封面时用详情覆盖
            return f ? { ...t, cover: t.cover || f.cover, fee: f.fee ?? t.fee, duration: t.duration || f.duration } : t;
          });
        } catch { /* 补封面失败不影响搜索本身 */ }
      }
      return { code: data.code ?? 200, tracks, songCount: r.songCount ?? tracks.length };
    }

    case 'personalized':
      return {
        code: data.code ?? 200,
        tracks: (data.result || []).map((it) => toTrack(it.song || it)).filter(Boolean),
      };

    case 'top/playlist': {
      // 各家返回字段不一样：playlists / result / recommend
      const list = data.playlists || data.result || data.recommend || [];
      return {
        code: data.code ?? 200,
        more: !!(data.more ?? data.hasMore),
        playlists: (Array.isArray(list) ? list : []).map((p) => ({
          id: p.id,
          name: p.name,
          cover: p.coverImgUrl || p.picUrl || p.pic || '',
          count: p.playCount || p.playcount || 0,
          creator: (p.creator && p.creator.nickname) || '',
          tracks: p.trackCount || 0,
        })).filter((p) => p.id),
      };
    }

    case 'recommend/songs':
      return {
        code: data.code ?? 200,
        tracks: (data.recommend || []).map((it) => toTrack(it)).filter(Boolean),
      };

    case 'login/qr/check': {
      /* 801 等待扫码 / 802 待确认 / 803 成功 / 800 过期。
         code / message **原样透出**：上游偶尔给字符串 "803"，缺 code 就是 null ——
         不再用 `?? 200` 把真实状态抹掉（前端统一 Number() 归一后判断）。 */
      const msg = data.message ?? data.msg ?? data.errmsg ?? '';
      const out = {
        code: data.code ?? null,
        message: msg || null,
        nickname: data.nickname,
        avatar: data.avatarUrl,
        /* 803 只代表「手机上授权了」。真正的登录态是 cookie 里的 MUSIC_U，
           这个字段在 saveCookies 之后算，所以能直接回答「803 但没 cookie」。 */
        loggedIn: !!cookies.MUSIC_U,
      };
      recordQrCheck(data, channel);        // 诊断留档（不含值，但记通道名）
      return out;
    }

    case 'login/status': {
      const p = data.profile;
      return p
        ? { loggedIn: true, profile: { userId: p.userId, nickname: p.nickname, avatar: p.avatarUrl, vipType: p.vipType } }
        : { loggedIn: false };
    }

    /* 个人主页。字段名统一成前端好用的短名字。
       注意 backgroundUrl 不吃 ?param= 尺寸参数（实测 md5 和原图一致，937×832），
       avatarUrl 吃（?param=200y200 → 200×200）。 */
    case 'user/detail': {
      const p = data.profile || {};
      return {
        code: data.code ?? 200,
        level: data.level ?? 0,
        listenSongs: data.listenSongs ?? 0,
        createDays: data.createDays ?? 0,
        canSeePlayRecord: !!data.peopleCanSeeMyPlayRecord,
        profile: {
          userId: p.userId,
          nickname: p.nickname || '',
          avatar: p.avatarUrl || '',
          background: p.backgroundUrl || '',
          signature: p.signature || '',
          description: p.description || '',
          follows: p.follows ?? 0,
          followeds: p.followeds ?? 0,
          playlistCount: p.playlistCount ?? 0,
          eventCount: p.eventCount ?? 0,
          createTime: p.createTime ?? 0,
          province: p.province ?? 0,
          city: p.city ?? 0,
          gender: p.gender ?? 0,
          vipType: p.vipType ?? 0,
          auth: (p.allAuthTypes || []).map((x) => x && x.desc).filter(Boolean),
        },
      };
    }

    /* ---------------- 歌手页 / 专辑页 ----------------
       上游字段都很"原生"（nickname/img1v1Url/briefDesc、picUrl/hotAlbums/size…），
       这里统一成短名字，前端不用记两套。 */
    case 'artist/:id': {
      const a = data.artist || {};
      return {
        code: data.code ?? 200,
        artist: {
          id: a.id,
          name: a.name || a.nickname || '',
          nickname: a.nickname || a.name || '',
          // 头像：img1v1Url 是方形小图，cover 是横图；前端两者兜底
          avatar: a.img1v1Url || a.cover || a.picUrl || '',
          cover: a.cover || a.img1v1Url || '',
          briefDesc: a.briefDesc || '',
          albumSize: a.albumSize ?? 0,
          musicSize: a.musicSize ?? 0,
          alias: a.alias || [],
          trans: a.trans || '',
        },
        // 热门 50 首：字段是老命名（al/ar），toTrack() 两种都吃
        hotSongs: (data.hotSongs || []).map(toTrack).filter(Boolean),
      };
    }

    case 'artist/albums/:id': {
      const list = data.hotAlbums || data.albums || [];
      return {
        code: data.code ?? 200,
        more: !!(data.more ?? data.hasMore),
        albums: (Array.isArray(list) ? list : []).map((a) => ({
          id: a.id,
          name: a.name || '',
          cover: a.picUrl || a.blurPicUrl || a.coverImgUrl || '',
          publishTime: a.publishTime ?? 0,
          size: a.size ?? a.songCount ?? 0,
        })).filter((a) => a.id),
      };
    }

    case 'artist/songs':
      return {
        code: data.code ?? 200,
        total: data.total ?? (data.songs || []).length,
        more: !!(data.more ?? data.hasMore),
        songs: (data.songs || []).map(toTrack).filter(Boolean),
      };

    case 'album/:id': {
      const al = data.album || {};
      const arts = al.artists || al.ar || [];
      return {
        code: data.code ?? 200,
        album: {
          id: al.id,
          name: al.name || '',
          cover: al.picUrl || al.blurPicUrl || '',
          company: al.company || '',
          description: al.description || '',
          publishTime: al.publishTime ?? 0,
          size: al.size ?? (data.songs || []).length,
          artists: arts.map((x) => ({ id: x.id, name: x.name })).filter((x) => x.id || x.name),
        },
        songs: (data.songs || []).map(toTrack).filter(Boolean),
      };
    }

    default:
      return data;
  }
}

/* ==========================================================================
   高潮 / 副歌节点（2026-11-15）
   --------------------------------------------------------------------------
   给形态用的一条统一接口：不同音源把「副歌从哪到哪」放在完全不同的地方，
   这里抹平成一个 { start, end }（毫秒，从歌曲开头算）。

   GET /api/chorus?plat=<bodian|netease>&id=<曲目 id>
     → { code:200, ok:true,  plat, id, start, end, length, unit:'ms' }
     → { code:200, ok:false, plat, id, reason:'no-chorus' }                这首没有
     → { code:200, ok:false, plat, id, reason:'unsupported', supported:[] } 这个音源接不了

   GET /api/chorus/capabilities
     → { code:200, unit:'ms', supported:['bodian','netease'], detail:{...}, note:'...' }
     形态在开跑之前先问一次这个，就知道当前音源能不能拿高潮、字段是什么。

   为什么只有这两家（2026-11-15 实测，不是猜的）：
     · 波点：song/detail 原本就返回 payInfo.refrain_start / refrain_end，白拿；
     · 网易云：边车里已有 /song/chorus?id= → chorus[0].startTime / endTime，多一次请求；
     · 酷狗：kugoumusicapi 里有 song_climax 模块（/v1/audio_climax/audio），
       但端点要酷狗 App 的签名 + cookie，本机直连是超时 / ECONNRESET，还没打通；
     · QQ：qq-music-api 的能力表里写死 getChorusRanges:false，库没实现；
     · 汽水 / 酷我 / Spotify：详情和歌词里都没有 refrain / chorus 字段。
   实测样本：波点 晴天 84346–142843、稻香 53951–77968；
             网易 晴天 98393–141783、稻香 115653–139682、告白气球 43000–86500。
   结果缓存 6 小时：同一个 id 反复问不会反复打边车（形态里可能每帧都要）。
   ========================================================================== */
const CHORUS_SOURCES = {
  bodian: {
    detail: 'song/detail → track.payInfo.refrain_start / refrain_end',
    async get(id) {
      const r = await scRequest('bodian', `/song/detail?id=${encodeURIComponent(id)}`, { timeout: 8000 });
      if (r.status !== 200) throw new Error(`波点边车 HTTP ${r.status}`);
      const p = r.data && r.data.track && r.data.track.payInfo;
      if (!p) return null;
      const s = Number(p.refrain_start), e = Number(p.refrain_end);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || s < 0) return null;
      return { start: s, end: e };
    },
  },
  netease: {
    detail: '/song/chorus?id= → chorus[0].startTime / endTime',
    async get(id) {
      const r = await scRequest('netease', `/song/chorus?id=${encodeURIComponent(id)}`, { timeout: 8000 });
      if (r.status !== 200) throw new Error(`网易云边车 HTTP ${r.status}`);
      const d = r.data || {};
      const row = (d.chorus && d.chorus[0]) || (d.data && d.data[0]);
      if (!row) return null;
      const s = Number(row.startTime), e = Number(row.endTime);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || s < 0) return null;
      return { start: s, end: e };
    },
  },
};

const CHORUS_TTL = 6 * 3600 * 1000;
const CHORUS_MAX = 400;
const chorusCache = new Map();          // `plat:id` → { at, value }

async function chorusLookup(plat, id) {
  const key = `${plat}:${id}`;
  const hit = chorusCache.get(key);
  if (hit && Date.now() - hit.at < CHORUS_TTL) return hit.value;
  const value = await CHORUS_SOURCES[plat].get(id);
  chorusCache.delete(key);              // 重新插入，让它排到队尾（LRU 近似的淘汰顺序）
  chorusCache.set(key, { at: Date.now(), value });
  while (chorusCache.size > CHORUS_MAX) chorusCache.delete(chorusCache.keys().next().value);
  return value;
}

async function handleChorus(req, res, url) {
  const supported = Object.keys(CHORUS_SOURCES);

  if (url.pathname === '/api/chorus/capabilities') {
    return json(res, 200, {
      code: 200,
      unit: 'ms',
      supported,
      detail: Object.fromEntries(supported.map((k) => [k, CHORUS_SOURCES[k].detail])),
      note: '酷狗协议里有（/v1/audio_climax/audio）但还没打通签名；QQ 库未实现；汽水/酷我/Spotify 没有字段。',
    });
  }
  if (url.pathname !== '/api/chorus') return json(res, 404, { code: 404, ok: false, error: 'not found' });

  const plat = String(url.searchParams.get('plat') || '').toLowerCase();
  const id = String(url.searchParams.get('id') || '').trim();
  if (!CHORUS_SOURCES[plat]) return json(res, 200, { code: 200, ok: false, plat, id, reason: 'unsupported', supported });
  if (!id) return json(res, 400, { code: 400, ok: false, plat, error: 'id required' });

  try {
    const v = await chorusLookup(plat, id);
    if (!v) return json(res, 200, { code: 200, ok: false, plat, id, reason: 'no-chorus' });
    return json(res, 200, {
      code: 200, ok: true, plat, id,
      start: v.start, end: v.end, length: v.end - v.start, unit: 'ms',
    });
  } catch (e) {
    /* 边车抽风 / 这首查不到：仍然回 200，让形态拿到一个能判断的结构，
       而不是被 fetch 的非 2xx 当异常吞掉（API.chorus 用的是会抛错的 call()）。 */
    return json(res, 200, { code: 200, ok: false, plat, id, reason: 'sidecar', error: String((e && e.message) || e) });
  }
}

/* ==========================================================================
   手机本地曲目（路径引用）—— GET /api/local-file?path=<绝对路径>
   --------------------------------------------------------------------------
   安卓壳扫描 MediaStore 导入的曲目不复制进 IndexedDB，曲目里只存 path，
   播放时由这条路由按需流式读取。桌面上没有 /storage，一律 403/404。

   安全边界（这是唯一一个能按路径读文件的接口，别放宽）：
     · 只允许 GET；
     · realpath 之后必须落在 /storage/emulated、/sdcard、/storage/self/primary
       之下（/sdcard 在 Android 上常是指向 /storage/self/primary 的软链，
       所以三个前缀都按 realpath 结果判断）；
     · 扩展名只放音频；文件必须存在、不是目录、≤ 300 MB；
     · 校验失败一律 403/404，不回显服务器目录结构。
   支持 Range（bytes=start-end / bytes=-N），播放器拖进度条要靠它。
   ========================================================================== */
const LOCAL_AUDIO_EXT = new Set([
  '.mp3', '.flac', '.wav', '.m4a', '.m4b', '.aac',
  '.ogg', '.oga', '.opus', '.wma', '.aiff',
]);
const LOCAL_AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
};
const LOCAL_FILE_ROOTS = ['/storage/emulated/', '/sdcard/', '/storage/self/primary/'];
const LOCAL_FILE_MAX = 300 * 1024 * 1024;

async function handleLocalFile(req, res, url) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  let raw = url.searchParams.get('path') || '';
  try { raw = decodeURIComponent(raw); } catch { /* 路径里本来就有 % 之类，保持原样 */ }
  if (!raw || raw.indexOf('\0') >= 0) return json(res, 404, { error: 'not found' });

  let file;
  try {
    file = await fs.promises.realpath(path.resolve(raw));
  } catch {
    return json(res, 404, { error: 'not found' });
  }
  if (!LOCAL_FILE_ROOTS.some((root) => file.startsWith(root))) {
    return json(res, 403, { error: 'forbidden' });
  }
  const ext = path.extname(file).toLowerCase();
  if (!LOCAL_AUDIO_EXT.has(ext)) return json(res, 403, { error: 'forbidden' });

  let stat;
  try { stat = await fs.promises.stat(file); } catch { return json(res, 404, { error: 'not found' }); }
  if (!stat.isFile()) return json(res, 404, { error: 'not found' });
  const total = stat.size;
  if (total > LOCAL_FILE_MAX) return json(res, 403, { error: 'file too large' });

  const base = {
    'Content-Type': LOCAL_AUDIO_MIME[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  const send = (code, headers, start, end) => {
    res.writeHead(code, headers);
    if (start === undefined) return res.end();
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
    stream.pipe(res);
  };

  if (total === 0) return send(200, { ...base, 'Content-Length': 0 });

  const range = req.headers.range;
  if (!range) return send(200, { ...base, 'Content-Length': total });

  const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return json(res, 416, { error: 'bad range', total });
  }
  let start;
  let end;
  if (m[1] === '') {
    // bytes=-N：最后 N 字节
    const n = Number(m[2]);
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    res.writeHead(416, { ...base, 'Content-Range': `bytes */${total}` });
    return res.end();
  }
  send(206, {
    ...base,
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Content-Length': end - start + 1,
  }, start, end);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  /* ---- 静态图片代理 ---- */
  if (url.pathname === '/api/img') {
    return proxyImage(res, url.searchParams.get('url') || '');
  }

  /* ---- 高潮 / 副歌节点（形态用）：必须在下面 /api/ 通用转发之前，
         否则会被当成 unknown api 直接 404。字段说明见 handleChorus 上面那段。 */
  if (url.pathname === '/api/chorus' || url.pathname.startsWith('/api/chorus/')) {
    return handleChorus(req, res, url);
  }

  /* ---- Wallpaper Engine 壁纸（见 wallpaper-api.mjs） ----
     必须排在 /api/ 通用转发之前，否则会被当成 unknown api 直接 404 */
  if (url.pathname === '/api/wallpaper' || url.pathname.startsWith('/api/wallpaper/')) {
    return handleWallpaper(req, res, url);
  }

  /* ---- 统一红心：网易云 / QQ / 酷狗 / 汽水 / 波点 ----
     必须排在下面 /api/ 通用转发之前，否则会被当成 unknown api。
     契约见 handleLikeState / handleLikeSet 上方那段说明。 */
  if (url.pathname === '/api/like/state') return handleLikeState(req, res, url);
  if (url.pathname === '/api/like') return handleLikeSet(req, res, url);

  /* ---- QQ 音乐（独立边车，见文件上半部分的说明） ----
     必须在网易云那个 /api/ 分支之前：否则会被当成 unknown api: qq/... 直接 404 */
  if (url.pathname === '/api/qq/audio') {
    return proxyQQAudio(req, res, url);
  }
  if (url.pathname === '/api/qq' || url.pathname.startsWith('/api/qq/')) {
    return handleQQ(req, res, url);
  }

  /* ---- 其它三个音源 + Spotify 骨架（同一套边车，见上半部分说明） ----
     音频代理必须单独一步：它要拿 full URL 做白名单，不能进 handleXxx 的路径分发 */
  for (const [name, handler] of [['kugou', handleKugou], ['qishui', handleQishui], ['bodian', handleBodian], ['spotify', handleSpotify], ['kuwo', handleKuwo]]) {
    if (url.pathname === `/api/${name}/audio`) return proxySourceAudio(req, res, url, name);
    if (url.pathname === `/api/${name}` || url.pathname.startsWith(`/api/${name}/`)) return handler(req, res, url);
  }

  /* ---- VST3 离线处理（services/vst-host/，Python 边车，2026-11-17 加） ----
     必须排在下面 /api/ 通用转发之前，否则 /api/vst/* 会被当成 unknown api。
     音频白名单在 handleVst 里按 AUDIO_HOSTS 单独判断（它要拿原始 full URL）。 */
  if (url.pathname === '/api/vst' || url.pathname.startsWith('/api/vst/')) {
    return handleVst(req, res, url);
  }

  /* 网易云音频代理：必须排在下面 handleNetease 的兜底转发之前，否则会被当成边车路径。
     为什么网易云也要代理，见 AUDIO_HOSTS.netease 的注释（CDN 不给 ACAO）。 */
  if (url.pathname === '/api/netease/audio') return proxySourceAudio(req, res, url, 'netease');

  /* ---- 网易云边车（services/netease-api/）：扫码登录换到这条通道 ----
     和 QQ 一样必须排在 /api/ 通用转发之前，否则会被当成 unknown api。 */
  if (url.pathname === '/api/netease' || url.pathname.startsWith('/api/netease/')) {
    return handleNetease(req, res, url);
  }

  /* ---- 登录收尾：扫码成功后收 cookie / 直接粘贴 cookie ----
     两条都在通用转发之前，且响应里只有键名/资料，没有 cookie 值。 */
  if (url.pathname === '/api/login/harvest' && req.method === 'POST') {
    return handleLoginHarvest(req, res);
  }
  if (url.pathname === '/api/session/import' && req.method === 'POST') {
    return handleSessionImport(req, res);
  }

  /* ---- 会话状态：前端启动时问一次「我登录了吗」 ---- */
  if (url.pathname === '/api/session') {
    if (!cookies.MUSIC_U) return json(res, 200, { loggedIn: false });
    try {
      /* 边车和自家 weapi 两条都问，任一条认登录就算登录 ——
         以前只走自家 weapi，被风控挑中时会误报 false。 */
      const v = await sessionVerify();
      return json(res, 200, v || { loggedIn: false });
    } catch {
      return json(res, 200, { loggedIn: false });
    }
  }

  /* ---- 扫码诊断：最近一次 login/qr/check 的上游原始码（只读） ----
     必须排在 /api/ 通用转发之前，否则会被当成 unknown api。
     返回体只有 code / message / hasMusicU / cookie 键名，**没有任何 cookie 值和 token**。 */
  if (url.pathname === '/api/login/qr/last') {
    return json(res, 200, {
      ...(lastQrCheck || {
        at: null,
        channel: null,
        code: null,
        message: '还没有 check 过',
      }),
      hasMusicU: !!cookies.MUSIC_U,
      loggedIn: !!cookies.MUSIC_U,
      cookieKeys: Object.keys(cookies),
      /* 收 cookie 的最近一次结果：试过哪几处 / 拿没拿到 / 来自哪个字段（不含值） */
      harvest: lastHarvest,
    });
  }

  /* ---- 手机扫描导入的曲目：按路径流式读本机音频（白名单见 handleLocalFile） ----
     必须排在下面 /api/ 通用转发之前，否则会被当成 unknown api 直接 404。 */
  if (url.pathname === '/api/local-file') {
    return handleLocalFile(req, res, url);
  }

  /* ---- 网易云接口转发 ---- */
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5);
    /* 精确名优先；否则按 'artist/:id'、'album/:id' 这类模式匹配。
       pathParams 是从 URL 路径段里抠出来的，供下面的 :id 替换用。 */
    const hit = matchRoute(name);
    if (!hit) return json(res, 404, { error: 'unknown api: ' + name });
    const { route, key: routeKey, params: pathParams } = hit;

    let payload = req.method === 'POST'
      ? await readBody(req)
      : Object.fromEntries(url.searchParams.entries());

    // 参数整形：网易云对字段名和类型很挑
    const idList = (v) => String(v || '').split(',').map((s) => Number(s.trim())).filter(Boolean);

    switch (routeKey) {
      case 'login/qr/key':
        payload = { type: 1 };
        break;
      case 'login/qr/check':
        payload = { key: payload.key, type: 1 };
        break;
      case 'song/url': {
        const ids = idList(payload.ids);
        /* 音质：level 决定档位，encodeType 必须跟着走 —— lossless/hires 要 flac，
           否则上游按 mp3 回（实测：encodeType=mp3 时请求 lossless 只会拿到 exhigh）。
           注意：**未登录时上游仍然降级到 exhigh 320kbps**，不是我们吞掉的；
           返回体的 level / br 原样透传，界面据此如实显示"实际拿到的音质"。 */
        const LEVELS = ['standard', 'higher', 'exhigh', 'lossless', 'hires', 'jymaster', 'jyeffect'];
        const level = LEVELS.includes(payload.level) ? payload.level : 'exhigh';
        const encodeType = level === 'standard' || level === 'higher' ? 'mp3' : 'flac';
        payload = { ids: JSON.stringify(ids), level, encodeType };
        break;
      }
      case 'song/detail': {
        const ids = idList(payload.ids);
        const tracks = await fetchTrackDetails(ids);
        return json(res, 200, { code: 200, tracks: tracks.map(toTrack).filter(Boolean) });
      }
      case 'playlist/detail':
      case 'playlist/track/all':
        // v6/detail 一次最多给 1000 首，够用；不要传 limit/offset（这个接口不认）
        payload = { id: Number(payload.id), n: 1000, s: 8 };
        break;
      case 'lyric':
        // cp=false 拿完整歌词；lv/tv/rv 普通、翻译、罗马音；
        // kv/yv/ytv/yrv 是逐字系列的开关（登录后才会真的下发）
        payload = {
          id: Number(payload.id), cp: false,
          lv: -1, tv: -1, rv: -1,
          kv: -1, yv: -1, ytv: -1, yrv: -1,
        };
        break;
      case 'song/wiki':
        payload = { songId: Number(payload.id) };
        break;
      case 'user/playlist':
        payload = { uid: Number(payload.uid), limit: 1000, offset: 0, includeVideo: true };
        break;
      case 'user/detail':
        payload = { uid: Number(payload.uid || payload.userId || 0) };
        break;
      case 'search':
        payload = { s: payload.s || payload.keywords || '', type: 1, limit: Number(payload.limit || 30), offset: Number(payload.offset || 0) };
        break;
      case 'top/playlist':
        // cat 分类、order 排序（hot / new）、limit 一次给多少
        payload = {
          cat: payload.cat || '全部',
          order: payload.order || 'hot',
          limit: Number(payload.limit || 12),
          offset: Number(payload.offset || 0),
          total: true,
        };
        break;
      /* ---- 歌手页 / 专辑页 ---- */
      case 'artist/albums/:id':
        // 一次 12 张，offset 翻页；total:true 才会带 more
        payload = {
          limit: Number(payload.limit || 12),
          offset: Number(payload.offset || 0),
          total: true,
        };
        break;
      case 'artist/songs':
        // 全部歌曲：id 在 body（这条路径里没有 :id）
        payload = {
          id: Number(payload.id),
          limit: Number(payload.limit || 100),
          offset: Number(payload.offset || 0),
          order: payload.order === 'time' ? 'time' : 'hot',
        };
        break;
    }

    try {
      /* 路径占位符：一条循环吃两种来源 ——
           · /api/artist/6452  → 从 URL 路径段抠出来的 pathParams
           · /api/user/detail  → 从前端 body 里取的 payload.uid（历史写法）
         替换完就把这个键从 body 里删掉（路径参数不该再进 body）。 */
      let apiPath = route.path;
      for (const m of route.path.matchAll(/:(\w+)/g)) {
        const key = m[1];
        const val = pathParams[key] ?? payload[key];
        if (!val) return json(res, 400, { error: key + ' required' });
        apiPath = apiPath.replace(':' + key, encodeURIComponent(String(val)));
        delete payload[key];
      }
      const send = route.channel === 'eapi' ? eapiRequest : weapiRequest;
      const data = await send(apiPath, payload);
      return json(res, 200, await normalize(routeKey, data, route.channel || 'weapi'));
    } catch (e) {
      return json(res, 502, { code: 502, error: String(e.message) });
    }
  }

  /* ---- 创意网站：按原路径只读提供 ---- */
  if (url.pathname.startsWith('/creative/')) {
    const relC = path.normalize(decodeURIComponent(url.pathname.slice('/creative/'.length)));
    if (relC.startsWith('..') || path.isAbsolute(relC)) return json(res, 403, { error: 'forbidden' });
    const fp = path.join(CREATIVE_DIR, relC === '.' ? 'index.html' : relC);
    if (!fp.startsWith(CREATIVE_DIR)) return json(res, 403, { error: 'forbidden' });

    fs.readFile(fp, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 创意站点文件不存在: ' + relC);
      }
      const ext = path.extname(fp).toLowerCase();
      let body = buf;
      let type = MIME[ext] || 'application/octet-stream';

      // HTML 在**发送时**打两个补丁，不动磁盘上的原文件：
      //   1. body 加 data-chrome="off" —— base.js 据此不再注入它的返回键和角标
      //      （播放器有自己的界面，不需要那套画廊 chrome）
      //   2. 注入桥接脚本 —— 让作品能收到播放器的节拍/能量/主色；不监听也照常工作
      if (ext === '.html') {
        let html = buf.toString('utf8');
        if (!/data-chrome=/.test(html)) html = html.replace(/<body\b/, '<body data-chrome="off"');
        html = html.replace('</body>', BRIDGE_TAG + '\n</body>');
        body = Buffer.from(html, 'utf8');
        type = 'text/html; charset=utf-8';
      }

      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': body.length });
      res.end(body);
    });
    return;
  }

  /* ---- 静态文件 ---- */
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  /* 目录带尾斜杠补 index.html：官网在 public/site/，所以 /site/ 和 /site/index.html 都能进
     （以前只有根目录做了这件事，子目录一路 404） */
  else if (rel.endsWith('/')) rel += 'index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

/* ==========================================================================
   进程级兜底（11-04 加）
   --------------------------------------------------------------------------
   这个服务是「转发的中间人」：一边是浏览器/播放器，一边是网易云和各种音源边车。
   对端随时可能半路断流（用户切歌、断网、上游抽风），这类错误发生在异步
   回调里，try/catch 包不到，一旦没人接就是整个进程退出 —— 表现就是
   「所有形态都黑屏 / 没 ready」，而真正的原因在服务已经死了。

   原则：**只记日志，不退出**。宁可某个请求失败，也不能让整个播放器失去服务。
   真正致命的错误（比如端口全占）在 listen() 的 error 里单独处理。
   ========================================================================== */

process.on('unhandledRejection', (reason) => {
  const msg = reason && (reason.message || String(reason));
  // undici 的断流噪音太多，压成一行，不要把控制台刷满
  console.warn('[server] 未处理的 Promise 异常（已忽略，服务继续）：', msg);
});

process.on('uncaughtException', (err) => {
  const msg = err && (err.stack || err.message || String(err));
  console.warn('[server] 未捕获异常（已忽略，服务继续）：', String(msg).split('\n')[0]);
});

/* 监听：端口 0 = 让系统分配。Windows 上有一大批端口被系统/Hyper-V 保留
   （监听会报 EACCES），所以默认不写死端口，拿到之后写进 .port 供 start.cmd 打开浏览器。 */
function listen() {
  server.listen(PORT, '127.0.0.1', () => {
    PORT = server.address().port;
    fs.writeFileSync(path.join(__dirname, '.port'), String(PORT));
    console.log(`\n  液态玻璃 · 网易云音乐播放器`);
    console.log(`  → http://127.0.0.1:${PORT}\n`);
    console.log(`  登录态: ${cookies.MUSIC_U ? '已保存（重启后仍有效）' : '未登录（可匿名浏览歌单）'}`);
    console.log(`  停止: Ctrl+C\n`);
  });
}

server.on('error', (e) => {
  if (e.code === 'EACCES' || e.code === 'EADDRINUSE') {
    console.warn(`  端口 ${PORT} 不可用（${e.code}），换一个…`);
    PORT = 0;                       // 交回系统分配
    setTimeout(listen, 50);
  } else {
    throw e;
  }
});
listen();

/* 主服务退出时把 QQ 边车一起收掉（Ctrl+C 在 Windows 上走 SIGINT；任务管理器杀进程走 exit）。
   边车那边还盯着 QQ_PARENT_PID 兜底，两条路都留着。 */
const stopQQ = () => {
  if (qqChild && qqChild.exitCode === null) {
    try { qqChild.kill(); } catch { /* 已经没了 */ }
  }
};
process.on('exit', stopQQ);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, () => { stopQQ(); process.exit(0); });
}



