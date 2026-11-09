/**
 * LIZI · 酷我音乐边车
 *
 * 酷我没有现成的 npm 协议包，这一层是自己写的最小 HTTP 壳（零运行时依赖）：
 *   - 搜索 / 歌单 / 推荐 / 榜单 / 电台目录：www.kuwo.cn 的 www 接口
 *   - 播放直链：mobi.kuwo.cn 的 convert_url2（q 参数用酷我客户端的自定义 DES 变体加密）
 *   - 歌词：newlyric.kuwo.cn 的 PC 歌词（lrcx 逐字，解压后 XOR + gb18030 解码）
 *   - 登录：酷我 Web 只有登录后下发 Cookie，没有扫码接口。这里只接收用户粘贴的 Cookie，
 *           **不伪造二维码、不伪造登录态**。
 *
 * 端口：KUWO_API_PORT > 上次的 .port > 3216（避开 3211-3215 的其它边车）。
 * 只绑 127.0.0.1；日志/.port/Cookie 都落在本目录，Cookie 只写盘不打印。
 *
 * 启动：node services/kuwo-api/start.mjs     （平时由 server.mjs 按需 spawn）
 * 停止：关掉进程即可（Ctrl+C / 按端口找 PID），没有别的状态
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_FILE = path.join(__dirname, '.port');
const LOG_FILE = path.join(__dirname, '.log');
const COOKIE_FILE = path.join(__dirname, '.auth-cookies.json');

try {
  if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
} catch { /* 第一次跑没有日志 */ }

/* ---------------- 日志：控制台 + 文件（EPIPE 不能拖垮服务） ---------------- */
for (const stream of [process.stdout, process.stderr]) {
  try { stream.on('error', () => { /* 输出管道断了不影响服务 */ }); } catch { /* ignore */ }
}
function log(...parts) {
  const line = `[kuwo-api ${new Date().toISOString()}] ${parts.join(' ')}`;
  try { console.log(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}
function fail(...parts) {
  const line = `[kuwo-api ${new Date().toISOString()}] FATAL ${parts.join(' ')}`;
  try { console.error(line); } catch { /* ignore */ }
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

/* ---------------- 端口：和主服务同一套规矩 ---------------- */
function preferredPort() {
  if (process.env.KUWO_API_PORT) return Number(process.env.KUWO_API_PORT) || 0;
  try {
    const prev = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    // 读完删掉：server.mjs 靠「文件出现」判断子进程是否就绪
    fs.unlinkSync(PORT_FILE);
    if (Number.isInteger(prev) && prev > 1024 && prev < 65536) return prev;
  } catch { /* 第一次跑 */ }
  return 3216;
}

/* ---------------- 常量 ---------------- */
const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const UA_OK = 'okhttp/3.10.0';
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const COOKIE_PREFIX = 'Hm_Iuvt_';
const COOKIE_FALLBACK = 'Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324';
const CRED = 'user=0&corp=kuwo&source=kwplayer_ar_5.1.0.0_B_jiakong_vh.apk&p2p=1';

/* ---------------- 用户 Cookie（只存键值，日志里不出现值） ---------------- */
let userCookies = {};
function loadCookies() {
  try {
    const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v !== 'string' || !k || k.startsWith(COOKIE_PREFIX)) continue;
        userCookies[k] = v;
      }
    }
  } catch { /* 没登录过 */ }
}
function saveCookies() {
  try {
    if (!Object.keys(userCookies).length) { try { fs.unlinkSync(COOKIE_FILE); } catch { /* 本来就没有 */ } return; }
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(userCookies, null, 2), { mode: 0o600 });
  } catch (e) { log('Cookie 写盘失败：', e && e.message); }
}
function parseCookieInput(raw) {
  const out = {};
  let text = String(raw || '').trim();
  if (!text) return out;
  text = text.replace(/^cookie\s*:\s*/i, '');
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text);
      for (const [k, v] of Object.entries(j || {})) if (typeof v === 'string' && k) out[k] = v;
      return out;
    } catch { /* 不是 JSON，按 ; 分 */ }
  }
  for (const part of text.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim().replace(/^"|"$/g, '');
    if (k) out[k] = v;
  }
  return out;
}
function userUid() {
  return String(userCookies.userid || userCookies.userId || userCookies.uid || '');
}
function userSid() {
  return String(userCookies.sid || userCookies.websid || '');
}
loadCookies();

/* ---------------- token + Secret ----------------
   Hm_Iuvt_* 是网页端下发的匿名 token；www 接口要 `Secret: h(token, cookieName)`。
   算法来自公开逆向实现（listen1 / 酷我网页），只在本机请求里用。 */
function secretFor(token, name) {
  let n = '';
  for (let i = 0; i < name.length; i++) n += name.charCodeAt(i).toString();
  const r = Math.floor(n.length / 5);
  const o = parseInt(n.charAt(r) + n.charAt(2 * r) + n.charAt(3 * r) + n.charAt(4 * r) + n.charAt(5 * r));
  const l = Math.ceil(name.length / 2);
  const c = 2147483647;
  let d = Math.round(1e9 * Math.random()) % 1e8;
  if (!(o >= 2)) throw new Error('酷我 Secret 算法参数异常');
  for (n += d; n.length > 10;) n = (parseInt(n.substring(0, 10)) + parseInt(n.substring(10))).toString();
  n = (o * n + l) % c;
  let f = '';
  for (let i = 0; i < token.length; i++) {
    const h = parseInt(token.charCodeAt(i) ^ Math.floor((n / c) * 255));
    f += h < 16 ? '0' + h.toString(16) : h.toString(16);
    n = (o * n + l) % c;
  }
  for (d = d.toString(16); d.length < 8;) d = '0' + d;
  return f + d;
}

let tokenState = { token: '', name: COOKIE_FALLBACK, secret: '', at: 0 };

function parseTokenCookie(headers) {
  let lines = [];
  try { lines = headers.getSetCookie ? headers.getSetCookie() : []; } catch { /* 老 Node */ }
  if (!lines.length) {
    const raw = headers.get('set-cookie') || '';
    if (raw) lines = raw.split(/,(?=\s*[^;=]+=[^;]*)/);
  }
  for (const line of lines) {
    const m = /^\s*([^=;]+)=([^;]*)/.exec(String(line));
    if (m && m[1].startsWith(COOKIE_PREFIX)) return { name: m[1], value: m[2] };
  }
  return null;
}

async function refreshToken() {
  const r = await fetch('https://www.kuwo.cn/', {
    headers: { 'User-Agent': UA_WEB },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  const hit = parseTokenCookie(r.headers);
  if (!hit) throw new Error('酷我首页没有下发 Hm_Iuvt_ token（上游可能改了鉴权）');
  tokenState = {
    token: hit.value,
    name: hit.name,
    secret: secretFor(hit.value, hit.name),
    at: Date.now(),
  };
  log(`拿到匿名 token ${hit.name.slice(0, 12)}…（不打印值）`);
}

function cookieHeader() {
  const parts = [];
  for (const [k, v] of Object.entries(userCookies)) {
    if (k.startsWith(COOKIE_PREFIX)) continue;
    parts.push(`${k}=${v}`);
  }
  parts.push(`${tokenState.name}=${tokenState.token}`);
  return parts.join('; ');
}

async function www(pathname, { retry = true, timeout = 20000, referer = 'https://www.kuwo.cn/' } = {}) {
  if (!tokenState.token || Date.now() - tokenState.at > 5 * 60 * 1000) await refreshToken();
  const headers = {
    'User-Agent': UA_WEB,
    Referer: referer,
    Cookie: cookieHeader(),
    Secret: tokenState.secret,
  };
  const r = await fetch('https://www.kuwo.cn' + pathname, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  if (retry && /The request is illegal/i.test(text)) {
    log('www 接口回 illegal，刷新 token 后重试一次');
    await refreshToken();
    return www(pathname, { retry: false, timeout, referer });
  }
  return { status: r.status, text };
}

function parseJson(text) {
  let t = String(text || '').trim();
  if (t.startsWith("'")) t = t.slice(1);
  if (t.endsWith("'")) t = t.slice(0, -1);
  try { return JSON.parse(t); } catch { return null; }
}

/* ---------------- q 参数加密（酷我客户端自定义 DES 变体） ----------------
   算法来自公开逆向实现（JayZorn-LJZ/GetFreeMusicYourself / kwmc-q- 的 JS 移植），
   密钥 ylzsxkwm，标准 DES 库解不开。只用来请求 mobi.kuwo.cn 的 convert_url2。 */
const KLS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const KLSMASK = [0n, 0x100001n, 0x300003n];
const KE = [31, 0, 1, 2, 3, 4, -1, -1, 3, 4, 5, 6, 7, 8, -1, -1, 7, 8, 9, 10, 11, 12, -1, -1, 11, 12, 13, 14, 15, 16, -1, -1, 15, 16, 17, 18, 19, 20, -1, -1, 19, 20, 21, 22, 23, 24, -1, -1, 23, 24, 25, 26, 27, 28, -1, -1, 27, 28, 29, 30, 31, 30, -1, -1];
const KIP1 = [39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25, 32, 0, 40, 8, 48, 16, 56, 24];
const KIP2 = [57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7, 56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6];
const KMASK = Array.from({ length: 64 }, (_, i) => 1n << BigInt(i));
const KP = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24];
const KPC1 = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
const KPC2 = [13, 16, 10, 23, 0, 4, -1, -1, 2, 27, 14, 5, 20, 9, -1, -1, 22, 18, 11, 3, 25, 7, -1, -1, 15, 6, 26, 19, 12, 1, -1, -1, 40, 51, 30, 36, 46, 54, -1, -1, 29, 39, 50, 44, 32, 47, -1, -1, 43, 48, 38, 55, 33, 52, -1, -1, 45, 41, 49, 35, 28, 31, -1, -1];
const KSBOX = [
  [14, 4, 3, 15, 2, 13, 5, 3, 13, 14, 6, 9, 11, 2, 0, 5, 4, 1, 10, 12, 15, 6, 9, 10, 1, 8, 12, 7, 8, 11, 7, 0, 0, 15, 10, 5, 14, 4, 9, 10, 7, 8, 12, 3, 13, 1, 3, 6, 15, 12, 6, 11, 2, 9, 5, 0, 4, 2, 11, 14, 1, 7, 8, 13],
  [15, 0, 9, 5, 6, 10, 12, 9, 8, 7, 2, 12, 3, 13, 5, 2, 1, 14, 7, 8, 11, 4, 0, 3, 14, 11, 13, 6, 4, 1, 10, 15, 3, 13, 12, 11, 15, 3, 6, 0, 4, 10, 1, 7, 8, 4, 11, 14, 13, 8, 0, 6, 2, 15, 9, 5, 7, 1, 10, 12, 14, 2, 5, 9],
  [10, 13, 1, 11, 6, 8, 11, 5, 9, 4, 12, 2, 15, 3, 2, 14, 0, 6, 13, 1, 3, 15, 4, 10, 14, 9, 7, 12, 5, 0, 8, 7, 13, 1, 2, 4, 3, 6, 12, 11, 0, 13, 5, 14, 6, 8, 15, 2, 7, 10, 8, 15, 4, 9, 11, 5, 9, 0, 14, 3, 10, 7, 1, 12],
  [7, 10, 1, 15, 0, 12, 11, 5, 14, 9, 8, 3, 9, 7, 4, 8, 13, 6, 2, 1, 6, 11, 12, 2, 3, 0, 5, 14, 10, 13, 15, 4, 13, 3, 4, 9, 6, 10, 1, 12, 11, 0, 2, 5, 0, 13, 14, 2, 8, 15, 7, 4, 15, 1, 10, 7, 5, 6, 12, 11, 3, 8, 9, 14],
  [2, 4, 8, 15, 7, 10, 13, 6, 4, 1, 3, 12, 11, 7, 14, 0, 12, 2, 5, 9, 10, 13, 0, 3, 1, 11, 15, 5, 6, 8, 9, 14, 14, 11, 5, 6, 4, 1, 3, 10, 2, 12, 15, 0, 13, 2, 8, 5, 11, 8, 0, 15, 7, 14, 9, 4, 12, 7, 10, 9, 1, 13, 6, 3],
  [12, 9, 0, 7, 9, 2, 14, 1, 10, 15, 3, 4, 6, 12, 5, 11, 1, 14, 13, 0, 2, 8, 7, 13, 15, 5, 4, 10, 8, 3, 11, 6, 10, 4, 6, 11, 7, 9, 0, 6, 4, 2, 13, 1, 9, 15, 3, 8, 15, 3, 1, 14, 12, 5, 11, 0, 2, 12, 14, 7, 5, 10, 8, 13],
  [4, 1, 3, 10, 15, 12, 5, 0, 2, 11, 9, 6, 8, 7, 6, 9, 11, 4, 12, 15, 0, 3, 10, 5, 14, 13, 7, 8, 13, 14, 1, 2, 13, 6, 14, 9, 4, 1, 2, 14, 11, 13, 5, 0, 1, 10, 8, 3, 0, 11, 3, 5, 9, 4, 15, 2, 7, 8, 12, 15, 10, 7, 6, 12],
  [13, 7, 10, 0, 6, 9, 5, 15, 8, 4, 3, 10, 11, 14, 12, 5, 2, 11, 9, 6, 15, 12, 0, 3, 4, 1, 14, 13, 1, 2, 7, 8, 1, 2, 12, 15, 10, 4, 0, 3, 13, 14, 6, 9, 7, 8, 9, 6, 15, 1, 5, 12, 3, 10, 14, 5, 8, 7, 11, 0, 4, 13, 2, 11],
];
const M64 = (1n << 64n) - 1n;
const M32 = (1n << 32n) - 1n;
const u64 = (x) => x & M64;
const u32 = (x) => x & M32;
function bitTransform(table, n, value) {
  let out = 0n;
  for (let i = 0; i < n; i++) {
    const idx = table[i];
    if (idx < 0) continue;
    if ((value & KMASK[idx]) !== 0n) out |= KMASK[i];
  }
  return u64(out);
}
function des64(subKeys, value) {
  const out = bitTransform(KIP2, 64, value);
  let l = u32(out);
  let r = u32((out & 0xFFFFFFFF00000000n) >> 32n);
  for (let i = 0; i < 16; i++) {
    const expanded = bitTransform(KE, 64, r) ^ subKeys[i];
    let sOut = 0n;
    for (let j = 0; j < 8; j++) {
      const byteVal = Number((expanded >> BigInt(j * 8)) & 0xFFn);
      sOut |= BigInt(KSBOX[j][byteVal] & 0xF) << BigInt(j * 4);
    }
    const nl = r;
    const nr = u32(l ^ bitTransform(KP, 32, sOut));
    l = nl;
    r = nr;
  }
  const outv = ((l << 32n) & 0xFFFFFFFF00000000n) | (r & 0xFFFFFFFFn);
  return u64(bitTransform(KIP1, 64, outv));
}
function buildSubKeys(keyStr, mode) {
  let keyLong = 0n;
  for (let i = 0; i < 8; i++) keyLong |= BigInt(keyStr.charCodeAt(i) & 0xFF) << BigInt(i * 8);
  let value = bitTransform(KPC1, 56, u64(keyLong));
  const rotate = (x, r) => {
    const mask = KLSMASK[r];
    return u64(u64((x & mask) << BigInt(28 - r)) | ((x & u64(~mask & M64)) >> BigInt(r)));
  };
  const states = [value];
  for (let i = 0; i < 16; i++) {
    value = rotate(value, KLS[i]);
    states.push(value);
  }
  let subKeys = states.slice(1).map((x) => bitTransform(KPC2, 64, x));
  if (mode === 1) subKeys = subKeys.slice().reverse();
  return subKeys;
}
function cryptBlocks(bytes, keyStr, mode) {
  const subKeys = buildSubKeys(keyStr || 'ylzsxkwm', mode);
  const n = bytes.length;
  const blockCount = Math.floor(n / 8);
  const out = [];
  for (let m = 0; m < blockCount; m++) {
    let v = 0n;
    for (let i = 0; i < 8; i++) v |= BigInt(bytes[m * 8 + i] & 0xFF) << BigInt(i * 8);
    out.push(des64(subKeys, u64(v)));
  }
  out.push(0n);
  if (n - blockCount * 8 !== 0 || mode === 0) {
    let tail = 0n;
    for (let i = blockCount * 8; i < n; i++) {
      tail |= BigInt(bytes[i] & 0xFF) << BigInt((i - blockCount * 8) * 8);
    }
    out[blockCount] = des64(subKeys, u64(tail));
  }
  const res = new Uint8Array(out.length * 8);
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    for (let j = 0; j < 8; j++) res[i * 8 + j] = Number((b >> BigInt(j * 8)) & 0xFFn);
  }
  return res;
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}
function encryptKuwoQuery(plain) {
  return b64(cryptBlocks(new TextEncoder().encode(plain), 'ylzsxkwm', 0));
}

/* ---------------- 播放直链：mobi convert_url2 ---------------- */
const QUALITY = {
  '128': '128kmp3',
  '320': '320kmp3',
  flac: '2000kflac',
};

async function mobiUrl(id, br) {
  let plain = `${CRED}&type=convert_url2&sig=0&format=${br.includes('flac') ? 'flac' : 'mp3'}&br=${br}&rid=${id}`;
  if (userUid() && userSid()) plain += `&loginUid=${encodeURIComponent(userUid())}&loginSid=${encodeURIComponent(userSid())}`;
  const q = encryptKuwoQuery(plain);
  const r = await fetch('https://mobi.kuwo.cn/mobi.s?f=kuwo&q=' + encodeURIComponent(q), {
    headers: { 'User-Agent': UA_OK },
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  const m = /url=(https?:\/\/[^\s]+)/.exec(text);
  return m ? m[1] : '';
}

async function webPlayUrl(id) {
  const r = await www(`/api/v1/www/music/playUrl?mid=${encodeURIComponent(id)}&type=music&httpsStatus=1&plat=web_www&from=&br=128kmp3`);
  const j = parseJson(r.text);
  return (j && j.data && j.data.url) || '';
}

async function resolveSongUrl(id, quality) {
  const want = QUALITY[quality] || QUALITY['320'];
  const tries = [want];
  if (want !== '320kmp3') tries.push('320kmp3');
  if (want !== '128kmp3') tries.push('128kmp3');
  let last = '';
  for (const br of tries) {
    try {
      const u = await mobiUrl(id, br);
      if (u) return { url: u, quality: br.replace('kmp3', '').replace('kflac', ''), format: br.includes('flac') ? 'flac' : 'mp3', source: 'mobi' };
      last = 'mobi 没返回 url';
    } catch (e) { last = String((e && e.message) || e); }
  }
  try {
    const u = await webPlayUrl(id);
    if (u) return { url: u, quality: 'web', format: 'mp3', source: 'web' };
  } catch (e) { last = String((e && e.message) || e); }
  return { url: '', reason: 'unavailable', error: last || '上游没给播放地址' };
}

/* ---------------- 歌词 ----------------
   PC 通道：newlyric.kuwo.cn/newlyric.lrc，参数 XOR('yeelion') + base64；
   返回 zlib 压缩体，lrcx 再 base64 + XOR + gb18030。H5 通道只做兜底。 */
function buildLyricParams(id, lrcx = true) {
  let params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${id}`;
  if (lrcx) params += '&lrcx=1';
  const src = Buffer.from(params);
  const key = Buffer.from('yeelion');
  const out = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] ^ key[i % key.length];
  return out.toString('base64');
}

function decodeGb18030(buf) {
  try { return new TextDecoder('gb18030').decode(buf); }
  catch { return buf.toString('utf8'); }
}

/* lrcx 里的 `<左,右>` 不是翻译标记，而是**逐字时间**：
   `[kuwo:NNN]` 给出两个系数（八进制），左/右是「起点 + 时长」的混合编码。
   用 bodian 的同一套算式解回 `<相对行首ms,字时长ms>`。
   没有 `[kuwo:…]` 标签的旧歌词，`<…>` 本来就是毫秒，原样保留。 */
function decodeWordTiming(content) {
  const tag = content.match(/\[kuwo:([0-7]+)\]/);
  if (!tag) return null;
  const factors = parseInt(tag[1], 8);
  const startFactor = Math.trunc(factors / 10);
  const durationFactor = factors % 10;
  if (!startFactor || !durationFactor) return null;
  return content
    .replace(/\[kuwo:[^\]]*\]/g, '')
    .replace(/<(-?\d+),(-?\d+)>/g, (_m, a, b) => {
      const A = Number(a), B = Number(b);
      const start = Math.trunc(Math.abs((A + B) / (2 * startFactor)));
      const duration = Math.trunc(Math.abs((A - B) / (2 * durationFactor)));
      return `<${start},${duration}>`;
    });
}

function convertLrcx(raw) {
  const src = String(raw || '');
  const decoded = decodeWordTiming(src);
  const out = [];       // 整行 LRC（老行为，降级用）
  const yrcOut = [];    // 逐字 YRC
  let lastTime = '';
  for (const line of (decoded ?? src).split(/\r\n|\r|\n/)) {
    /* PC 通道是 [mm:ss.SSS]；个别老歌 / 降级结果会只有 1~2 位小数，都收 */
    const m = /^\[(\d{2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/.exec(line);
    if (!m) {
      if (/^\[(ti|ar|al|by|offset):/.test(line)) out.push(line);
      continue;
    }
    const frac = (m[3] || '000').padEnd(3, '0').slice(0, 3);
    const time = `${m[1]}:${m[2]}.${frac}`;
    const content = m[4];
    /* 翻译行整行都是 `<0,0>`（没有时间轴），原文行才带真实逐字时间 */
    const isTrans = /^<0,0>/.test(content);
    const text = content.replace(/<[^>]*>/g, '').trim();
    if (!text) continue;
    if (isTrans && time === lastTime) continue;   // 同一时间点已有原文，翻译行不重复铺
    out.push(`[${time}]${text}`);
    if (!isTrans) lastTime = time;
    if (isTrans) continue;
    const chars = [];
    const re = /<(\d+),(\d+)>([^<]*)/g;
    let cm;
    while ((cm = re.exec(content))) {
      if (!cm[3]) continue;
      chars.push({ off: Number(cm[1]), dur: Number(cm[2]), text: cm[3] });
    }
    if (!chars.length) continue;
    const start = Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(frac);
    const dur = Math.max(...chars.map((c) => c.off + c.dur));
    yrcOut.push(`[${start},${dur}]` + chars.map((c) => `(${start + c.off},${c.dur},0)${c.text}`).join(''));
  }
  return { lyric: out.join('\n'), yrc: yrcOut.join('\n') };
}

function secToLrc(t) {
  const total = Number(t) || 0;
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(Math.floor(total % 60)).padStart(2, '0');
  const cs = String(Math.round((total - Math.floor(total)) * 100)).padStart(2, '0');
  return `${mm}:${ss}.${cs}`;
}

async function lyricPc(id) {
  const url = 'https://newlyric.kuwo.cn/newlyric.lrc?' + buildLyricParams(id, true);
  const r = await fetch(url, { headers: { 'User-Agent': UA_WEB }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('歌词 HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.toString('utf8', 0, 12).indexOf('tp=content') !== 0) throw new Error('歌词返回格式不是 tp=content');
  const sep = buf.indexOf('\r\n\r\n');
  if (sep < 0) throw new Error('歌词返回缺分隔头');
  const inflated = zlib.inflateSync(buf.slice(sep + 4));
  const asText = inflated.toString('utf8');
  let raw;
  if (/^\s*\[/.test(asText)) {
    raw = decodeGb18030(inflated);
  } else {
    const enc = Buffer.from(asText, 'base64');
    const key = Buffer.from('yeelion');
    const dec = Buffer.alloc(enc.length);
    for (let i = 0; i < enc.length; i++) dec[i] = enc[i] ^ key[i % key.length];
    raw = decodeGb18030(dec);
  }
  return convertLrcx(raw);
}

async function lyricH5(id) {
  const r = await fetch('http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=' + encodeURIComponent(id), {
    headers: { 'User-Agent': UA_MOBILE, Referer: 'https://m.kuwo.cn/' },
    signal: AbortSignal.timeout(15000),
  });
  const j = parseJson(await r.text());
  const list = j && j.data && j.data.lrclist;
  if (!Array.isArray(list) || !list.length) return '';
  return list
    .filter((x) => x && x.lineLyric != null)
    .map((x) => `[${secToLrc(x.time)}]${String(x.lineLyric)}`)
    .join('\n');
}

/* ---------------- 每日推荐：官方「每日最新单曲推荐」歌单，失败退热歌榜 ---------------- */
async function dailyList() {
  try {
    const r = await www('/api/www/rcm/index/playlist?id=37&pn=1&rn=10&httpsStatus=1');
    const j = parseJson(r.text);
    const list = (j && j.data && j.data.list) || [];
    const pick = list.find((p) => p && /每日|推荐/.test(String(p.name || ''))) || list[0];
    if (pick && pick.id) {
      const pr = await www(`/api/www/playlist/playListInfo?pid=${encodeURIComponent(pick.id)}&pn=1&rn=20&httpsStatus=1`);
      const pj = parseJson(pr.text);
      const tracks = (pj && pj.data && pj.data.musicList) || [];
      if (tracks.length) return { code: 200, name: pick.name || '每日最新单曲推荐', source: 'playlist', list: tracks };
    }
  } catch { /* 退榜单 */ }
  const r = await www('/api/www/bang/bang/musicList?bangId=16&pn=1&rn=20&httpsStatus=1');
  const j = parseJson(r.text);
  return { code: 200, name: '酷我热歌榜', source: 'rank', list: (j && j.data && j.data.musicList) || [] };
}

/* ---------------- HTTP ---------------- */
function send(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 256 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function statusBody() {
  const uid = userUid();
  const loggedIn = !!(uid && userSid());
  return {
    code: 200,
    loggedIn,
    uid: uid || '',
    nickname: '',
    avatar: '',
    vip: false,
    verified: false,
    hasCookie: !!uid,
    note: loggedIn
      ? '登录态来自粘贴的 Cookie；酷我 Web 没有可用的校验接口，播放时会自动带上'
      : (uid ? 'Cookie 里只有 userid，缺 sid/websid —— 请复制整段 Cookie' : '还没粘贴酷我 Cookie'),
  };
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return send(res, 400, { code: 400, error: 'bad url' }); }
  const p = url.pathname;
  const q = url.searchParams;
  try {
    if (p === '/health' || p === '/') return send(res, 200, { code: 200, ok: true, node: process.versions.node });

    if (p === '/status' || p === '/login/status') return send(res, 200, statusBody());

    if (p === '/login/cookie') {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const raw = q.get('cookie') || body.cookie || req.headers.cookie || '';
      const parsed = parseCookieInput(raw);
      const uid = String(parsed.userid || parsed.userId || parsed.uid || '');
      const sid = String(parsed.sid || parsed.websid || '');
      if (!uid || !sid) {
        return send(res, 200, {
          code: 200,
          loggedIn: false,
          error: 'Cookie 里没有 userid / sid（或 websid）。请登录 www.kuwo.cn 后复制整段 Cookie',
        });
      }
      userCookies = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (k && !k.startsWith(COOKIE_PREFIX)) userCookies[k] = v;
      }
      saveCookies();
      log('已保存酷我 Cookie 键名：' + Object.keys(userCookies).join(', '));
      return send(res, 200, statusBody());
    }

    if (p === '/logout') {
      userCookies = {};
      saveCookies();
      log('已清除酷我 Cookie');
      return send(res, 200, { code: 200, loggedIn: false });
    }

    if (p === '/login/qr/key' || p === '/login/qr/create' || p === '/login/qr/check') {
      // 不伪造扫码：酷我 Web 端没有二维码登录接口
      return send(res, 200, {
        code: 501,
        error: '酷我 Web 端不提供扫码登录；请在浏览器登录 www.kuwo.cn 后粘贴 Cookie',
      });
    }

    if (p === '/search') {
      const s = String(q.get('s') || q.get('key') || q.get('keywords') || '').trim();
      if (!s) return send(res, 200, { code: 200, total: 0, list: [] });
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 20));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const path = `/search/searchMusicBykeyWord?vipver=1&client=kt&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&mobi=1&issubtitle=1&show_copyright_off=1&pn=${page - 1}&rn=${limit}&all=${encodeURIComponent(s)}`;
      const r = await www(path, { referer: 'https://www.kuwo.cn/search' });
      const j = parseJson(r.text);
      if (!j || !Array.isArray(j.abslist)) {
        return send(res, 200, { code: 502, total: 0, list: [], error: '酷我搜索返回无法解析' });
      }
      return send(res, 200, { code: 200, total: Number(j.TOTAL) || j.abslist.length, list: j.abslist });
    }

    if (p === '/playlist/tracks') {
      const id = String(q.get('id') || '').trim();
      if (!id) return send(res, 400, { code: 400, error: 'id required' });
      const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 100));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const r = await www(`/api/www/playlist/playListInfo?pid=${encodeURIComponent(id)}&pn=${page}&rn=${limit}&httpsStatus=1`);
      const j = parseJson(r.text);
      if (!j || Number(j.code) !== 200) {
        return send(res, 200, { code: (j && j.code) || 502, id, list: [], error: (j && (j.msg || j.message)) || '取歌单失败' });
      }
      const d = j.data || {};
      return send(res, 200, {
        code: 200,
        id: String(d.id || id),
        name: d.name || '',
        cover: d.img || '',
        creator: d.uname || d.userName || '',
        total: Number(d.total) || (d.musicList || []).length,
        list: d.musicList || [],
      });
    }

    if (p === '/playlist/search') {
      const key = String(q.get('key') || q.get('s') || '').trim();
      if (!key) return send(res, 200, { code: 200, total: 0, list: [] });
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 30));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const r = await www(`/api/www/search/searchPlayListBykeyWord?key=${encodeURIComponent(key)}&pn=${page}&rn=${limit}&httpsStatus=1`);
      const j = parseJson(r.text);
      if (!j || Number(j.code) !== 200) return send(res, 200, { code: (j && j.code) || 502, total: 0, list: [], error: (j && (j.msg || j.message)) || '搜索歌单失败' });
      const d = j.data || {};
      return send(res, 200, { code: 200, total: Number(d.total) || (d.list || []).length, list: d.list || [] });
    }

    if (p === '/recommend/playlists') {
      const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 12));
      const id = String(q.get('id') || '37');
      const r = await www(`/api/www/rcm/index/playlist?id=${encodeURIComponent(id)}&pn=1&rn=${limit}&httpsStatus=1`);
      const j = parseJson(r.text);
      if (!j || Number(j.code) !== 200) return send(res, 200, { code: (j && j.code) || 502, list: [], error: (j && (j.msg || j.message)) || '取推荐歌单失败' });
      return send(res, 200, { code: 200, list: (j.data && j.data.list) || [] });
    }

    if (p === '/rank/list') {
      const r = await www('/api/www/bang/bang/bangMenu?&httpsStatus=1', { referer: 'https://www.kuwo.cn/rankList' });
      const j = parseJson(r.text);
      if (!j || Number(j.code) !== 200) return send(res, 200, { code: (j && j.code) || 502, list: [], error: '取榜单目录失败' });
      return send(res, 200, { code: 200, list: j.data || [] });
    }

    if (p === '/rank/tracks') {
      const id = String(q.get('id') || '16');
      const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 30));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const r = await www(`/api/www/bang/bang/musicList?bangId=${encodeURIComponent(id)}&pn=${page}&rn=${limit}&httpsStatus=1`, { referer: 'https://www.kuwo.cn/rankList' });
      const j = parseJson(r.text);
      if (!j || Number(j.code) !== 200) return send(res, 200, { code: (j && j.code) || 502, list: [], error: (j && (j.msg || j.message)) || '取榜单失败' });
      const d = j.data || {};
      return send(res, 200, { code: 200, total: Number(d.num) || (d.musicList || []).length, list: d.musicList || [] });
    }

    if (p === '/radio/stations') {
      const r = await www('/api/www/radio/index/radioList?&httpsStatus=1', { referer: 'https://www.kuwo.cn/rankList' });
      const j = parseJson(r.text);
      if (!j || Number(j.code) !== 200) return send(res, 200, { code: (j && j.code) || 502, list: [], error: '取电台目录失败' });
      return send(res, 200, { code: 200, list: (j.data && j.data.albumList) || [] });
    }

    if (p === '/album/tracks') {
      const id = String(q.get('id') || '').trim();
      if (!id) return send(res, 400, { code: 400, error: 'id required' });
      const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 100));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const r = await www(`/api/www/album/albumInfo?albumId=${encodeURIComponent(id)}&pn=${page}&rn=${limit}&httpsStatus=1`);
      const j = parseJson(r.text);
      if (!j || Number(j.code) !== 200) return send(res, 200, { code: (j && j.code) || 502, list: [], error: (j && (j.msg || j.message)) || '取专辑失败' });
      const d = j.data || {};
      return send(res, 200, { code: 200, id: String(d.albumid || id), name: d.album || '', cover: d.pic || '', total: Number(d.total) || 0, list: d.musicList || [] });
    }

    if (p === '/daily') {
      const d = await dailyList();
      return send(res, 200, d);
    }

    if (p === '/song/url') {
      const id = String(q.get('id') || q.get('mid') || '').trim();
      if (!id) return send(res, 400, { code: 400, error: 'id required' });
      const quality = String(q.get('quality') || '320');
      const hit = await resolveSongUrl(id, quality);
      return send(res, 200, { code: 200, id, ...hit });
    }

    if (p === '/lyric') {
      const id = String(q.get('id') || q.get('mid') || '').trim();
      if (!id) return send(res, 400, { code: 400, error: 'id required' });
      let parsed = { lyric: '', yrc: '' };
      let source = 'kw-pc';
      let error = null;
      try { parsed = await lyricPc(id); } catch (e) { error = String((e && e.message) || e); }
      if (!parsed.lyric && !parsed.yrc) {
        source = 'kw-h5';
        try { parsed = { lyric: await lyricH5(id), yrc: '' }; } catch (e) { error = error || String((e && e.message) || e); }
      }
      return send(res, 200, {
        code: 200,
        lyric: parsed.lyric,
        /* PC 通道的 lrcx 能解出逐字时间轴；H5 兜底只有整行，yrc 为空 */
        yrc: parsed.yrc,
        format: parsed.yrc ? 'yrc' : (parsed.lyric ? 'lrc' : 'none'),
        source,
        error: (parsed.lyric || parsed.yrc) ? null : (error || '酷我没给这首歌歌词（或上游限流）'),
      });
    }

    return send(res, 404, { code: 404, error: 'unknown kuwo api: ' + p });
  } catch (e) {
    log('请求失败', p, (e && e.message) || e);
    return send(res, 502, { code: 502, error: String((e && e.message) || e) });
  }
});

/* ---------------- 就绪 / 失败 / 父进程 ---------------- */
const wantPort = preferredPort();
let retried = false;
function ready() {
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : wantPort;
  fs.writeFileSync(PORT_FILE, String(port));
  log(`就绪 http://127.0.0.1:${port}`);
  console.log(`KUWO_API_READY ${port}`);
}
server.on('error', (e) => {
  const code = e && e.code;
  if ((code === 'EADDRINUSE' || code === 'EACCES') && !retried) {
    retried = true;
    log(`端口 ${wantPort} 不可用（${code}），改用系统分配…`);
    setTimeout(() => {
      try { server.listen(0, '127.0.0.1'); }
      catch (err) { fail('重试监听失败:', err && err.message); process.exit(1); }
    }, 80);
    return;
  }
  fail(`监听失败（${code || 'unknown'}）: ${e && e.message}`);
  process.exit(1);
});
server.listen(wantPort, '127.0.0.1', ready);

const parentPid = Number(process.env.KUWO_PARENT_PID || 0);
if (Number.isInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try { process.kill(parentPid, 0); }
    catch { log('父进程已退出，边车跟着收工'); process.exit(0); }
  }, 5000).unref();
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
