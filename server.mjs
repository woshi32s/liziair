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

/** QQ 封面：拿专辑 mid 拼（y.gtimg.cn 已在 /api/img 的白名单里） */
const qqCover = (albumMid) =>
  albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : '';

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
      if (!cookie.includes('qqmusic_session')) return json(res, 200, { code: 200, loggedIn: false });
      const r = await qqRequest('/login/status', { cookie });
      const p = (r.data && r.data.data && r.data.data.profile) || null;
      if (!p) {
        /* 上游 401 时登录态就是失效的（loggedIn 必须 false），但本地封存的旧凭据里
           还有昵称/头像。只把这两样带出去，别把「已失效」画成「已登录」。 */
        let stale = null;
        try {
          const c = await qqRequest('/lizi/cached-profile', { cookie, timeout: 6000 });
          if (c.data && !c.data.empty && c.data.avatar) stale = c.data;
        } catch { /* 没有本地凭据就算了 */ }
        return json(res, 200, {
          code: 200, loggedIn: false,
          ...(stale ? { stale: true, nickname: stale.nickname || '', avatar: stale.avatar, uin: stale.uid || '' } : {}),
        });
      }
      const info = p.info && typeof p.info === 'object' ? p.info : {};
      return json(res, 200, {
        code: 200,
        loggedIn: true,
        nickname: p.nick || p.nickname || p.name || info.nick || 'QQ 音乐用户',
        avatar: qqProfileAvatar(p),
        uin: p.uin || p.uin === 0 ? String(p.uin) : '',
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
      if (r.setCookies.length) res.setHeader('Set-Cookie', r.setCookies);
      if (out.code === 803) {
        out.loggedIn = true;
        // 顺手把昵称查出来：前端拿到 803 就能直接显示「已登录 xxx」，不用再等一轮
        try {
          const s = await qqRequest('/login/status', { cookie: cookieWith(r.setCookies, cookie) });
          const p = (s.data && s.data.data && s.data.data.profile) || null;
          if (p) {
            const info = p.info && typeof p.info === 'object' ? p.info : {};
            out.nickname = p.nick || p.nickname || p.name || info.nick || '';
            out.avatar = qqProfileAvatar(p);
          }
        } catch { /* 昵称查不到不影响登录本身 */ }
      }
      return json(res, 200, out);
    }

    if (part === 'logout') {
      const r = await qqRequest('/logout', { cookie });
      if (r.setCookies.length) res.setHeader('Set-Cookie', r.setCookies);
      return json(res, 200, { code: 200, loggedIn: false });
    }

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
      const cacheKey = `${cookie ? 'auth' : 'anon'}|${s}|${limit}|${page}`;
      const cached = qqSearchCache.get(cacheKey);
      if (cached && Date.now() - cached.at < QQ_SEARCH_TTL) {
        return json(res, 200, { ...cached.data, cached: true });
      }

      const api = `/search?keyword=${encodeURIComponent(s)}&limit=${limit}&page=${page}`;
      let r = await qqRequest(api, { cookie });
      /* 撞上限流就退避重试（1.2s / 2.5s，最多三次）。
         实测 2001 的冷却在 15 秒上下，重试覆盖不了长时间冷却，
         但轻度限流（最常见）这样就过去了；真不行就把上游码如实告诉用户。 */
      for (const wait of [1200, 2500]) {
        if (r.data.code === 200) break;
        await sleep(wait);
        r = await qqRequest(api, { cookie });
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
      const r = await qqRequest(`/getLyric?songmid=${encodeURIComponent(mid)}`, { cookie });
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
        `/getMusicPlay/${encodeURIComponent(mid)}?quality=${quality}`, { cookie }
      );
      let got = qqPlayUrlOf(first.data, mid);
      let loginRequired = first.status === 401;

      /* 没有会员 / 没登录：正片拿不到，退回试听片段（30~60s）。
         这是 QQ 那边的硬限制，不是我们的 bug —— 如实标 preview 让界面去说。 */
      if (!got.url) {
        const pv = await qqRequest(
          `/getMusicPlay/${encodeURIComponent(mid)}?quality=${quality}&preview=1`, { cookie }
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
      const r = await qqRequest(`/recommend/playlists?limit=${limit}`, { cookie });
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
      const r = await qqRequest(`/recommend/new-songs?limit=${limit}`, { cookie });
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
      const r = await qqRequest(`/getSongListDetail/${encodeURIComponent(id)}`, { cookie });
      const resp = (r.data && r.data.response) || {};
      const cd = (resp.cdlist && resp.cdlist[0]) || null;
      if (!cd) {
        return json(res, 200, {
          code: resp.code || 502, source: 'qq', name: '', cover: '', tracks: [], trackCount: 0,
          error: resp.code ? '歌单取不到（' + resp.code + '）' : '歌单不存在',
        });
      }
      const songs = (cd.songlist || []).map(qqTrack).filter((t) => t.id);
      return json(res, 200, {
        code: 200, source: 'qq',
        id: String(cd.disstid || id),
        name: cd.dissname || 'QQ 歌单',
        cover: cd.logo || '',
        creator: { nickname: cd.nickname || cd.nick || '' },
        tracks: songs,
        trackCount: songs.length,
      });
    }

    if (part === 'user/liked-songs') {
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 100));
      const r = await qqRequest(`/user/liked-songs?limit=${limit}`, { cookie });
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
      });
    }

    if (part === 'user/playlists') {
      const r = await qqRequest('/user/playlist', { cookie });
      const d = r.data || {};
      if (Number(d.code) !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'qq', playlists: [],
          error: d.code === 401 ? '先在卡片上扫码登录 QQ 音乐' : (d.message || '取我的歌单失败'),
        });
      }
      return json(res, 200, {
        code: 200, source: 'qq',
        playlists: (d.playlist || []).map(qqPlaylist).filter((p) => p.id),
      });
    }

    /* 「我的收藏专辑」：边车返回 { albums,total,more }，这里统一成网易云
       album/sublist 那套 { data,hasMore }，前端只写一套渲染。
       未登录 / 上游失败一律把 error 原样带出去，别回一个空列表假装成功。 */
    if (part === 'user/albums') {
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 100));
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      const r = await qqRequest(`/user/albums?offset=${offset}&limit=${limit}`, { cookie });
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
      const r = await qqRequest('/user/daily-songs', { cookie });
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
      const r = await qqRequest(`/recommend/radar?page=${page}`, { cookie });
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
      const r = await qqRequest('/radio/categories', { cookie });
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
      const r = await qqRequest(`/radio/tracks?id=${encodeURIComponent(id)}`, { cookie });
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
      if (!cookie.includes('qqmusic_session')) {
        return json(res, 200, { code: 401, error: '先在卡片上扫码登录 QQ 音乐' });
      }
      /* 上游只收 20 个字（按 Unicode 码点）以内的名字，超长/带控制字符会 400。
         搬运默认名「原名（来自搬运）」往往超过 20 字，所以这里先清洗再截断，保证能建出来。 */
      name = Array.from(name.replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 20).join('').trim();
      if (!name) return json(res, 400, { code: 400, error: '歌单名不能为空' });
      const r = await qqRequest('/user/playlist/create', {
        cookie, method: 'POST', payload: { name }, timeout: 25000,
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
      if (!cookie.includes('qqmusic_session')) {
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
          cookie, method: 'POST', payload: { songs: chunk.map((s) => ({ mid: s.mid })) }, timeout: 25000,
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
          cookie, method: 'POST',
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

/** QQ 歌单条目 → 前端那一种形状（推荐歌单用 tid/title/picurl，我的歌单用 dirId/dirName） */
function qqPlaylist(it) {
  const creator = it.creator || {};
  return {
    id: String(it.dirId ?? it.dissid ?? it.tid ?? it.id ?? ''),
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
      || (mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : ''),
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
};

const scState = {};             // name → { child, starting, jar }
for (const name of Object.keys(SIDECARS)) scState[name] = { child: null, starting: null, jar: null };

function scPaths(name) {
  const dir = path.join(__dirname, 'services', SIDECARS[name].dir);
  return { dir, entry: path.join(dir, 'start.mjs'), portFile: path.join(dir, '.port'), logFile: path.join(dir, '.log') };
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
  const bin = process.env.LIZI_NODE_BIN || 'node';
  let version = '';
  try {
    version = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
  } catch (e) {
    node24Cache = { error: `本机找不到可用的 node（试过 ${bin}）：${e.message}` };
    return node24Cache;
  }
  const vMajor = Number(String(version).replace(/^v/, '').split('.')[0]);
  if (!(vMajor >= 24)) {
    node24Cache = { error: `本机 node 版本不足：这个音源要求 ≥ 24，当前是 ${version}（${bin}）` };
    return node24Cache;
  }
  node24Cache = { bin, version };
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

  const fd = fs.openSync(logFile, 'a');
  const child = spawn(bin, [entry], {
    cwd: dir,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: {
      ...process.env,
      ...extraEnv,
      // 边车盯着父进程，主服务退出后自己不赖着占端口
      [`${meta.env}_PARENT_PID`]: String(process.pid),
    },
  });
  st.child = child;
  fs.closeSync(fd);
  child.on('error', (e) => console.warn(`  ${name} 边车启动失败:`, e.message));
  child.on('exit', (code, signal) => {
    console.warn(`  ${name} 边车退出（code=${code}${signal ? ' signal=' + signal : ''}），下次请求会重起`);
    if (st.child === child) st.child = null;
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
async function scRequest(name, pathname, { cookie = '', timeout = 20000, method = 'GET', payload } = {}) {
  const port = await ensureSidecar(name);
  const sep = pathname.includes('?') ? '&' : '?';
  const full = cookie ? `${pathname}${sep}cookie=${encodeURIComponent(cookie)}` : pathname;
  /* payload 是可选的 JSON body：酷狗边车的路由会把 body 和 query 合并成 params，
     写歌单（tracks/add 的 data 可能很长）走 body 就不用担心 GET URL 长度。原有 GET 不受影响。 */
  const headers = {};
  if (cookie && method !== 'GET') headers.Cookie = cookie;
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
    verify: sessionVerify,
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

/* ---------------- 酷狗登录态：包只认 Cookie，所以由主服务落盘/回放 ---------------- */
function kgJarFile() { return path.join(scPaths('kugou').dir, '.auth-cookies.json'); }
function kgJarGet() {
  try {
    const j = JSON.parse(fs.readFileSync(kgJarFile(), 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}
function kgJarSet(obj) {
  try {
    if (!obj || !Object.keys(obj).length) { fs.unlinkSync(kgJarFile()); return; }
    fs.writeFileSync(kgJarFile(), JSON.stringify(obj, null, 2), { mode: 0o600 });
  } catch (e) { console.warn('  酷狗登录态写盘失败:', e.message); }
}
function kgCookie() {
  const j = kgJarGet();
  return Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
}

/* ---------------- 各平台「原始条目 → 前端只认的那一种形状」 ---------------- */
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
    cover: tpl ? String(tpl).replace('{size}', '240') : '',
    duration: (it.Duration || 0) * 1000,
    // PayType: 0 免费 / 2 试听或付费 / 3 付费。只用来打小签，实际能不能放看 /song/url
    fee: Number(it.PayType) > 0 ? 1 : 0,
    hash: it.FileHash,
    albumAudioId: it.Audioid || it.MixSongID || 0,
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
  /* 列表/跑马带只要 200~400px，原图一张 0.5~2MB，20 张能把首屏拖垮。
     汽水的图片模板支持 resize：`~tplv-<id>-resize:480:480.image`（实测 38KB），
     缩图失败（老数据没模板）就退回完整图。 */
  const suffix = c.template_prefix
    ? (c.template ? `~${c.template_prefix}-${c.template}` : `~${c.template_prefix}-resize:480:480.image`)
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

/** 波点歌单：推荐流给 pic/musicCount/creatorName，收藏页给别的名字，这里一起兜住 */
function bodianPlaylist(it) {
  return {
    id: String(it.id || it.playlistId || it.fid || ''),
    source: 'bodian',
    name: it.name || it.title || it.playlistName || '未命名歌单',
    cover: it.pic || it.cover || it.img || it.coverUrl || '',
    trackCount: Number(it.musicCount ?? it.songCount ?? it.total ?? it.count ?? it.songNum) || 0,
    playCount: Number(it.playNum ?? it.play_count ?? it.playCount) || 0,
    creator: { nickname: it.creatorName || it.nickname || it.userName || '' },
    // 取曲目时上游要 source：红心歌单是 5，自建/收藏一般是 4
    sourceType: Number(it.sourceType) || 0,
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
  return {
    id: String(it.id || it.albumId || it.albumIdStr || it.rid || it.musicRid || ''),
    name: it.name || it.title || it.albumName || it.album_name || '未知专辑',
    /* 和网易云一样给对象数组，前端 impAlbum 不用为波点再写一套 */
    artists: [{ name: String(artist) }],
    cover: it.pic || it.cover || it.img || it.coverUrl || it.albumPic || it.albumPic120 || '',
    publishTime: Number(it.publishTime ?? it.pubTime ?? it.pubtime ?? it.releaseTime ?? 0) || 0,
    trackCount: Number(it.musicCount ?? it.songCount ?? it.total ?? it.count ?? it.songNum ?? 0) || 0,
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
  /* 搜索接口只给相对路径（120/s3s94/93/211513640.jpg），歌单给完整 URL */
  let cover = it.pic || it.albumpic || it.albumpic_short || it.web_albumpic_short || '';
  if (cover && !/^https?:\/\//i.test(cover)) {
    cover = 'https://img1.kuwo.cn/star/albumcover/' + String(cover).replace(/^\/+/, '');
  }
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
  const cookie = kgCookie();

  if (part === 'health') {
    try {
      const port = await ensureSidecar('kugou');
      return json(res, 200, { code: 200, ok: true, port, node: process.versions.node, loggedIn: !!kgJarGet().token });
    } catch (e) {
      return json(res, 502, { code: 502, ok: false, error: String(e.message), reason: e.reason || null, log: scLogTail('kugou') });
    }
  }

  try {
    if (part === 'status') {
      const jar = kgJarGet();
      if (!jar.token) return json(res, 200, { code: 200, loggedIn: false });
      // 有 token 就问一次「我是谁」，顺便验它还有效
      const r = await scRequest('kugou', '/user/detail', { cookie });
      const d = (r.data && r.data.data) || {};
      const ok = Number(r.data && r.data.status) === 1;
      return json(res, 200, {
        code: 200,
        loggedIn: ok,
        nickname: ok ? (d.nickname || d.user_name || '酷狗用户') : '',
        avatar: ok ? (d.pic || d.avatar || '') : '',
        uid: ok ? String(d.userid || jar.userid || '') : '',
        vip: ok ? Number(d.vip_type || 0) > 0 : false,
        error: ok ? null : '登录态可能已过期（重新扫码）',
      });
    }

    if (part === 'login/qr/key') {
      const r = await scRequest('kugou', '/login/qr/key', { timeout: 20000 });
      const key = r.data && r.data.data && (r.data.data.qrcode || r.data.data.key);
      if (!key) return json(res, 200, { code: 502, key: null, error: (r.data && (r.data.error || r.data.message)) || '拿不到二维码 key' });
      return json(res, 200, { code: 200, key });
    }

    if (part === 'login/qr/create') {
      const key = q.get('key') || '';
      if (!key) return json(res, 400, { code: 400, error: 'key required' });
      const r = await scRequest('kugou', `/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true`);
      const img = r.data && r.data.data && r.data.data.base64;
      if (!img) return json(res, 200, { code: 502, qrimg: '', key, error: (r.data && r.data.message) || '二维码生成失败（上游没给图片）' });
      return json(res, 200, { code: 200, key, qrimg: img });
    }

    if (part === 'login/qr/check') {
      const key = q.get('key') || '';
      if (!key) return json(res, 400, { code: 400, error: 'key required' });
      const r = await scRequest('kugou', `/login/qr/check?key=${encodeURIComponent(key)}`, { timeout: 25000 });
      // 酷狗：0 过期 / 1 等待 / 2 待确认 / 4 成功（成功那一轮带 token+userid）
      const st = Number(r.data && r.data.data && r.data.data.status);
      const MAP = { 0: 800, 1: 801, 2: 802, 4: 803 };
      const out = { code: MAP[st] || 801, state: st };
      if (st === 4) {
        const jar = { ...kgJarGet() };
        for (const line of r.setCookies) {
          const pair = String(line).split(';')[0];
          const i = pair.indexOf('=');
          if (i <= 0) continue;
          const k = pair.slice(0, i).trim();
          if (['token', 'userid', 'vip_type', 'vip_token'].includes(k)) jar[k] = pair.slice(i + 1).trim();
        }
        kgJarSet(jar);
        out.loggedIn = true;
        try {
          const who = await scRequest('kugou', '/user/detail', { cookie: kgCookie() });
          const d = (who.data && who.data.data) || {};
          out.nickname = d.nickname || d.user_name || '';
          out.avatar = d.pic || '';
        } catch { /* 昵称查不到不影响登录 */ }
      }
      return json(res, 200, out);
    }

    if (part === 'logout') {
      kgJarSet({});
      return json(res, 200, { code: 200, loggedIn: false });
    }

    if (part === 'search') {
      const s = (q.get('s') || q.get('keywords') || '').trim();
      if (!s) return json(res, 200, { code: 200, source: 'kugou', tracks: [], songCount: 0 });
      const limit = Math.min(30, Math.max(1, Number(q.get('limit')) || 20));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const r = await scRequest('kugou',
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
      let r = await scRequest('kugou', base, { cookie });
      let pick = kugouUrlOf(r.data);
      /* 没有会员/没登录：正片拿不到，退回「试听片段」（free_part=1）。
         酷狗对匿名播放会回 20028「本次请求需要验证」（天御风控），那就是要登录。 */
      if (!pick.url) {
        const pv = await scRequest('kugou', base + '&free_part=1', { cookie });
        const p = kugouUrlOf(pv.data);
        if (p.url) pick = p;
        else if (!pick.upstream) pick.upstream = p.upstream;
      }
      const needLogin = /20028|需要验证|check r failed/.test(String(pick.upstream || ''));
      return json(res, 200, {
        code: 200,
        hash,
        url: pick.url || '',
        preview: !!pick.preview,
        quality: pick.preview ? 'preview' : quality,
        reason: pick.url ? null : (needLogin ? 'login' : 'unavailable'),
        // 上游原话带出去，排查时不用猜（前端不显示）
        upstream: pick.upstream || null,
      });
    }

    if (part === 'lyric') {
      const hash = (q.get('hash') || q.get('id') || '').toLowerCase();
      const keyword = (q.get('s') || '').trim();
      if (!hash && !keyword) return json(res, 400, { code: 400, error: 'hash or s required' });
      /* 歌词要两步：先 search/lyric 拿 id+accesskey，再 /lyric?decode=1&fmt=krc。
         边车里 /lyric 默认就是 krc；拿不到 id/accesskey（匿名限流等）时回空歌词，
         歌词接口本身不报错（海报、播放页都按「没有歌词」处理）。 */
      try {
        const sr = await scRequest('kugou',
          `/search/lyric?keywords=${encodeURIComponent(keyword || hash)}&hash=${hash}&man=no&client=android`, { cookie });
        const sd = sr.data || {};
        /* 边车的 /search/lyric 是平铺返回；别的路由会包一层 data，两种都认 */
        const cand = Array.isArray(sd.candidates) ? sd.candidates
          : Array.isArray(sd.data && sd.data.candidates) ? sd.data.candidates : [];
        const hit = cand.find((c) => c && c.id && c.accesskey) || cand[0];
        if (!hit || !hit.id || !hit.accesskey) {
          return json(res, 200, { code: 200, lyric: '', yrc: '', tlyric: '', format: 'none' });
        }
        const lr = await scRequest('kugou',
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
      const r = await scRequest('kugou', type > 1 ? `/top/song?type=${type}` : '/top/song', { cookie });
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
      const r = await scRequest('kugou', '/everyday/recommend', { cookie });
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
      const r = await scRequest('kugou',
        `/playlist/track/all?id=${encodeURIComponent(id)}&page=${page}&pagesize=${pagesize}`, { cookie });
      const d = (r.data && r.data.data) || {};
      const list = d.songs || d.info || d.list || [];
      return json(res, 200, {
        code: 200, source: 'kugou',
        tracks: (Array.isArray(list) ? list : []).map(kugouPlaylistTrack).filter((t) => t.id && t.name),
        trackCount: Number(d.count || d.total || 0) || (Array.isArray(list) ? list.length : 0),
      });
    }

    if (part === 'user/playlists') {
      const r = await scRequest('kugou', '/user/playlist', { cookie });
      const d = (r.data && r.data.data) || {};
      const list = Array.isArray(d.info) ? d.info : [];
      if (!Array.isArray(d.info)) {
        return json(res, 200, {
          code: 401, source: 'kugou', playlists: [],
          error: '先在卡片上扫码登录酷狗（这个接口要登录）',
        });
      }
      return json(res, 200, {
        code: 200, source: 'kugou',
        playlists: list.map(kugouPlaylist).filter((p) => p.id),
      });
    }

    /* ---- 电台：/fm/class 是频道目录（匿名），/fm/songs 按 fmid 取歌（匿名） ---- */
    if (part === 'fm/class') {
      const r = await scRequest('kugou', '/fm/class', { cookie });
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
      const r = await scRequest('kugou',
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
      const r = await scRequest('kugou', `/top/playlist?page=${page}&pagesize=${size}`, { cookie });
      const d = (r.data && r.data.data) || {};
      const list = Array.isArray(d.special_list) ? d.special_list : [];
      return json(res, 200, {
        code: 200, source: 'kugou',
        playlists: list.map(kugouPlaylist).filter((p) => p.id),
      });
    }

    if (part === 'recommend/songs' || part === 'personal/fm') {
      const path = part === 'personal/fm' ? '/personal/fm' : '/recommend/songs';
      const r = await scRequest('kugou', path, { cookie, timeout: 25000 });
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
      const jar = kgJarGet();
      if (!jar.token || !jar.userid) {
        return json(res, 200, { code: 401, error: '先在卡片上扫码登录酷狗' });
      }
      if (!name) return json(res, 400, { code: 400, error: 'name required' });
      /* 不要传 type=0：边车从 query 拿到的是字符串 "0"，module 里用的是严格 === 0，
         省略它才能命中「新建」分支并保持上游 body 里 type 是数字 0。
         list_create_listid 也省略：新建没有来源歌单，传 0 反而可能被当成真实 listid。 */
      const r = await scRequest('kugou',
        `/playlist/add?name=${encodeURIComponent(name)}&source=1`
        + `&list_create_userid=${encodeURIComponent(String(jar.userid))}`
        /* 酷狗边车给所有成功响应挂了 2 分钟 apicache；同名重建命中缓存会拿到
           上一次的 listid（写进旧歌单）。加一个只会被忽略的时间戳破缓存。 */
        + `&_=${Date.now()}`,
        { cookie, timeout: 25000 });
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
        const lr = await scRequest('kugou', '/user/playlist', { cookie });
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
      const jar = kgJarGet();
      if (!jar.token || !jar.userid) {
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
      const r = await scRequest('kugou', `/playlist/tracks/add?_=${Date.now()}`, {
        cookie, method: 'POST', payload: { listid, data: rows.join(',') }, timeout: 30000,
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
    return json(res, 502, { code: 502, error: String(e.message), reason: e.reason || null, log: scLogTail('kugou') });
  }
}

/** 酷狗「列表型」条目（新歌速递 / 每日推荐 / 歌单曲目）：小写字段，播放键仍是 hash */
function kugouListTrack(it) {
  const cover = (it.trans_param && it.trans_param.union_cover)
    ? String(it.trans_param.union_cover).replace('{size}', '240')
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
    albumAudioId: Number(it.album_audio_id) || 0,
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
    cover: String(tpl).replace('{size}', '240'),
    duration: Number(it.timelen || it.timelength || 0),
    fee: Number(it.feetype || it.pay_type || 0) > 0 ? 1 : 0,
    hash: it.hash || '',
    albumAudioId: Number(it.audio_id || it.mixsongid) || 0,
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
    albumAudioId: Number(it.album_audio_id || it.audio_id) || 0,
    albumIdNum: Number(it.album_id) || 0,
  };
}

/** 酷狗 FM 频道（/fm/class）：一张卡一个频道，点开按 fmid 取歌 */
function kugouFmStation(it, cls) {
  return {
    id: String(it.fmid || ''),
    source: 'kugou',
    name: it.fmname || '未命名电台',
    cover: String(it.imgurl || '').replace('{size}', '240'),
    trackCount: Array.isArray(it.songlist) ? it.songlist.length : 0,
    playCount: 0,
    creator: { nickname: (cls && cls.classname) || '' },
  };
}

/** 酷狗「我的歌单」条目 → { id,name,cover,trackCount,creator }（id 用 global_collection_id 或 listid） */
function kugouPlaylist(it) {
  const id = it.global_collection_id || it.listid || it.list_id || it.specialid || '';
  const cover = String(it.img_url || it.imgurl || it.pic || it.cover || '')
    .replace('{size}', '400');
  return {
    id: String(id),
    name: it.listname || it.name || it.specialname || '未命名歌单',
    cover,
    trackCount: Number(it.songcount ?? it.song_count ?? it.total ?? 0) || 0,
    playCount: Number(it.playcount ?? it.play_count ?? 0) || 0,
    creator: { nickname: it.nickname || it.username || '' },
    source: 'kugou',
  };
}

/** 酷狗 /song/url 的返回有好几种形状：data 是数组，或者 {url,...}，失败时只有 errcode。
 *  kugoumusicapi 1.6.0 起 /song/url 直接把 trackercdn 的根级对象透传出来
 *  （{ status:1, url:[...], backupUrl:[...] }），不再包一层 data；
 *  url 也可能本身就是数组。两种结构都要认，否则永远取到空串、只能放示例音乐。 */
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
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 50));
      const r = await scRequest('qishui',
        `/playlist/tracks?id=${encodeURIComponent(id)}&limit=${limit}`, { timeout: 25000 });
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
      const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 100));
      const r = await scRequest('qishui', `/user/playlists?limit=${limit}`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'qishui', playlists: [],
          error: d.code === 401 ? '先在卡片上扫码登录汽水音乐' : (d.error || '取汽水歌单失败'),
        });
      }
      return json(res, 200, {
        code: 200, source: 'qishui',
        playlists: (d.items || []).map(qishuiPlaylist).filter((p) => p.id),
        total: d.total || 0,
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
      const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 50));
      const source = Number(q.get('source'));
      const sourceQs = [1, 2, 3, 4, 5, 6].includes(source) ? `&source=${source}` : '';
      const r = await scRequest('bodian',
        `/playlist/tracks?id=${encodeURIComponent(id)}&limit=${limit}${sourceQs}`, { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, { code: d.code || 502, source: 'bodian', tracks: [], error: d.error || '歌单取不到' });
      }
      return json(res, 200, {
        code: 200, source: 'bodian',
        tracks: (d.items || []).map(bodianTrack).filter((t) => t.id && t.name),
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

    /* ---- 账号曲库：owned / liked / collected 三块合起来 ---- */
    if (part === 'user/playlists') {
      const r = await scRequest('bodian', '/user/playlists', { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'bodian', playlists: [],
          error: d.code === 401 ? '先在卡片上扫码登录波点音乐' : (d.error || '取波点歌单失败'),
        });
      }
      const rows = [
        ...bodianPlaylistRows(d.owned),
        ...bodianPlaylistRows(d.liked),
        ...(d.liked && d.liked.id ? [d.liked] : []),
        ...bodianPlaylistRows(d.collected),
      ];
      const seen = new Set();
      const playlists = [];
      for (const it of rows) {
        const p = bodianPlaylist(it);
        if (!p.id || seen.has(p.id)) continue;
        seen.add(p.id);
        playlists.push(p);
      }
      return json(res, 200, { code: 200, source: 'bodian', playlists });
    }

    /* 「我收藏的专辑」：边车返回 { data:{ albumList, bodianPagination } }，
       这里统一成网易云 album/sublist 的 { data, hasMore }。
       注意：边车的 /user/albums 目前不把 offset/limit 转给库（services/ 不许改），
       永远只给第一页（默认 50 张）。所以 hasMore 固定 false —— 否则前端会按
       nextOffset 反复拿同一页，把列表叠成一堆重复项。 */
    if (part === 'user/albums') {
      const r = await scRequest('bodian', '/user/albums', { timeout: 25000 });
      const d = r.data || {};
      if (d.code !== 200) {
        return json(res, 200, {
          code: d.code || 401, source: 'bodian', data: [], hasMore: false,
          error: d.code === 401 ? '先在卡片上扫码登录波点音乐' : (d.error || '取波点收藏专辑失败'),
        });
      }
      const wrap = d.data || {};
      return json(res, 200, {
        code: 200, source: 'bodian',
        data: (Array.isArray(wrap.albumList) ? wrap.albumList : []).map(bodianUserAlbum).filter((a) => a.id),
        hasMore: false,
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  /* ---- 静态图片代理 ---- */
  if (url.pathname === '/api/img') {
    return proxyImage(res, url.searchParams.get('url') || '');
  }

  /* ---- Wallpaper Engine 壁纸（见 wallpaper-api.mjs） ----
     必须排在 /api/ 通用转发之前，否则会被当成 unknown api 直接 404 */
  if (url.pathname === '/api/wallpaper' || url.pathname.startsWith('/api/wallpaper/')) {
    return handleWallpaper(req, res, url);
  }

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



