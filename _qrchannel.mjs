/**
 * 扫码通道验收 —— 纯 Node，零依赖，不需要浏览器。
 *
 *   1) 把候选通道逐个实测：新 key → 立即 check，打出 {code, message}
 *   2) 最终通道连测 3 次必须都是 801（直连 + 经本机服务各 3 次）
 *   3) /api/login/qr/last 必须带 channel，且等于最终通道
 *   4) 回归：/api/session、/api/top/playlist、/api/user/detail、/api/qq/health 都 200
 *
 * 跑法：node _qrchannel.mjs         （端口从 .port 读）
 *      node _qrchannel.mjs 11701
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PORT = process.argv[2] || (fs.existsSync('.port') ? fs.readFileSync('.port', 'utf8').trim() : '');
const LOCAL = `http://127.0.0.1:${PORT}`;
const SELECTED = 'eapi';                       // 最终选中的通道（见报告）

/* ============================ 加密（服务端同款） ============================ */
const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';
const PUB_KEY = '010001';
const MODULUS =
  '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const aesB64 = (text, key, iv = IV) => {
  const c = crypto.createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
};
function modPow(b, e, m) {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
const rsaEncrypt = (t) => {
  const rev = Buffer.from(t.split('').reverse().join(''), 'utf8').toString('hex');
  return modPow(BigInt('0x' + rev), BigInt('0x' + PUB_KEY), BigInt('0x' + MODULUS)).toString(16).padStart(256, '0');
};
const weapiBody = (obj) => {
  const text = JSON.stringify(obj);
  const key = Array.from({ length: 16 }, () => BASE62[Math.floor(Math.random() * 62)]).join('');
  return new URLSearchParams({ params: aesB64(aesB64(text, PRESET_KEY), key), encSecKey: rsaEncrypt(key) }).toString();
};

const EAPI_KEY = Buffer.from('e82ckenh8dichen8');
const MD5_SEP = '-36cd479b6b5-';
const eapiHeader = () => ({
  osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
  deviceId: 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
  appver: '8.9.70',
  versioncode: '140',
  mobilename: '',
  buildver: String(Date.now()).slice(0, 10),
  resolution: '1920x1080',
  __csrf: '',
  os: 'pc',
  channel: 'netease',
  requestId: `${Date.now()}_0001`,
});
function eapiBody(apiPath, obj) {
  const text = JSON.stringify({ ...obj, header: eapiHeader() });
  const digest = crypto.createHash('md5').update(`nobody${apiPath}use${text}md5forencrypt`, 'utf8').digest('hex');
  const c = crypto.createCipheriv('aes-128-ecb', EAPI_KEY, null);
  const hex = Buffer.concat([c.update(Buffer.from(`${apiPath}${MD5_SEP}${text}${MD5_SEP}${digest}`, 'utf8')), c.final()])
    .toString('hex')
    .toUpperCase();
  return new URLSearchParams({ params: hex }).toString();
}
/* /api 通道：同 eapi 明文，但 AES-128-CBC + 固定 IV */
function apiBody(apiPath, obj) {
  const text = JSON.stringify(obj);
  const digest = crypto.createHash('md5').update(`nobody${apiPath}use${text}md5forencrypt`, 'utf8').digest('hex');
  const c = crypto.createCipheriv('aes-128-cbc', EAPI_KEY, Buffer.from('0102030405060708'));
  const hex = Buffer.concat([c.update(Buffer.from(`${apiPath}${MD5_SEP}${text}${MD5_SEP}${digest}`, 'utf8')), c.final()])
    .toString('hex')
    .toUpperCase();
  return new URLSearchParams({ params: hex }).toString();
}

/* ============================ 网络 ============================ */
async function upstream(url, body, jar) {
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://music.163.com',
      Origin: 'https://music.163.com',
      'User-Agent': UA,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  for (const l of r.headers.getSetCookie?.() || []) {
    const [pair] = l.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  const text = await r.text();
  try { return { http: r.status, body: JSON.parse(text) }; } catch { return { http: r.status, body: { raw: text.slice(0, 120) } }; }
}

async function local(pathname, { method = 'POST', body = {} } = {}) {
  const r = await fetch(LOCAL + pathname, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 120) }; }
  return { http: r.status, body: parsed };
}

/* ============================ 候选通道 ============================ */
/* 每条 = { name, keyEndpoint, keyBody, checkEndpoint, checkBody(key) } */
const CANDIDATES = [
  {
    name: 'weapi /client/login（改动前的老通道）',
    keyEndpoint: 'https://music.163.com/weapi/login/qrcode/unikey',
    keyBody: () => weapiBody({ type: 1 }),
    checkEndpoint: 'https://music.163.com/weapi/login/qrcode/client/login',
    checkBody: (key) => weapiBody({ key, type: 1 }),
  },
  {
    name: 'weapi /login/qrcode/check（check 版 endpoint）',
    keyEndpoint: 'https://music.163.com/weapi/login/qrcode/unikey',
    keyBody: () => weapiBody({ type: 1 }),
    checkEndpoint: 'https://music.163.com/weapi/login/qrcode/check',
    checkBody: (key) => weapiBody({ key, type: 1 }),
  },
  {
    name: 'eapi /client/login（现用通道）',
    keyEndpoint: 'https://music.163.com/eapi/login/qrcode/unikey',
    keyBody: () => eapiBody('/api/login/qrcode/unikey', { type: 1 }),
    checkEndpoint: 'https://music.163.com/eapi/login/qrcode/client/login',
    checkBody: (key) => eapiBody('/api/login/qrcode/client/login', { key, type: 1 }),
  },
  {
    name: 'eapi /login/qrcode/check（check 版 endpoint）',
    keyEndpoint: 'https://music.163.com/eapi/login/qrcode/unikey',
    keyBody: () => eapiBody('/api/login/qrcode/unikey', { type: 1 }),
    checkEndpoint: 'https://music.163.com/eapi/login/qrcode/check',
    checkBody: (key) => eapiBody('/api/login/qrcode/check', { key, type: 1 }),
  },
  {
    name: 'api /client/login（AES-CBC + eapi 明文）',
    keyEndpoint: 'https://music.163.com/api/login/qrcode/unikey',
    keyBody: () => apiBody('/api/login/qrcode/unikey', { type: 1 }),
    checkEndpoint: 'https://music.163.com/api/login/qrcode/client/login',
    checkBody: (key) => apiBody('/api/login/qrcode/client/login', { key, type: 1 }),
  },
];

const codeOf = (b) => (b && b.code !== undefined && b.code !== null ? b.code : '—');
const msgOf = (b) => (b && (b.message ?? b.msg ?? b.errmsg ?? b.raw)) || '';

/* 上游对 unikey 有频率限制：一分钟内连开 ~6 个之后回 406「操作频繁，请稍候再试」
   （实测约一分钟恢复）。本脚本要连开十来个 key，所以遇到 406 就等一会儿重取 ——
   这是限流，不是通道死了。限流次数会打在结果里，不藏。 */
let rateLimited = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withKeyRetry(get, label, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const r = await get();
    if (r && r.key) return r;
    if (Number(r && r.code) === 406) {
      rateLimited++;
      console.log(`  · ${label}：上游限流 406「${(r && r.message) || '操作频繁'}」，等 20s 重取 key…`);
      await sleep(20000);
      continue;
    }
    return r;
  }
  return { key: null, code: 0, message: '连续限流，取不到 key' };
}

/* ---------------------------- 1) 通道实测表 ---------------------------- */
const rows = [];
for (const c of CANDIDATES) {
  const jar = {};
  let key;
  let keyCode = '—';
  try {
    const k = await withKeyRetry(async () => {
      const r = await upstream(c.keyEndpoint, c.keyBody(), jar);
      return { key: r.body?.unikey || r.body?.data?.unikey || null, code: codeOf(r.body), message: msgOf(r.body) };
    }, c.name);
    keyCode = k.code;
    key = k.key;
    if (!key) {
      rows.push({ 通道: c.name, endpoint: c.checkEndpoint.replace('https://music.163.com', ''), code: 'NO KEY', message: `unikey=${keyCode} ${k.message || ''}`.trim() });
      continue;
    }
  } catch (e) {
    rows.push({ 通道: c.name, endpoint: c.checkEndpoint.replace('https://music.163.com', ''), code: 'EXC', message: String(e.message).slice(0, 50) });
    continue;
  }
  const t0 = Date.now();
  try {
    const ck = await upstream(c.checkEndpoint, c.checkBody(key), jar);
    rows.push({
      通道: c.name,
      endpoint: c.checkEndpoint.replace('https://music.163.com', ''),
      code: codeOf(ck.body),
      message: msgOf(ck.body) || `HTTP ${ck.http}`,
      ms: Date.now() - t0,
    });
  } catch (e) {
    rows.push({ 通道: c.name, endpoint: c.checkEndpoint.replace('https://music.163.com', ''), code: 'EXC', message: String(e.message).slice(0, 50) });
  }
}
console.log('\n=== 1) 候选通道实测（新 key → 立即 check） ===');
console.table(rows);

/* 直连下的最终通道连测 3 次 */
const sel = CANDIDATES.find((c) => c.name.includes(SELECTED + ' /client/login'));
const directCodes = [];
for (let i = 0; i < 3; i++) {
  const jar = {};
  const k = await withKeyRetry(async () => {
    const r = await upstream(sel.keyEndpoint, sel.keyBody(), jar);
    return { key: r.body?.unikey || null, code: codeOf(r.body), message: msgOf(r.body) };
  }, `直连#${i + 1}`);
  const ck = await upstream(sel.checkEndpoint, sel.checkBody(k.key), jar);
  directCodes.push(Number(codeOf(ck.body)));
}
console.log(`直连 ${SELECTED} 通道，新 key + 立即 check ×3：`, directCodes.join(' / '));

/* ---------------------- 2) 经本机服务：新 key → 立即 check ×3 ---------------------- */
const KEY = '/api/login/qr/key';
const CHECK = '/api/login/qr/check';

const getServerKey = (label) =>
  withKeyRetry(async () => {
    const r = await local(KEY, { method: 'POST', body: {} });
    return { key: r.body?.key || null, code: r.body?.code, message: r.body?.message };
  }, label);

const kRes = await getServerKey('服务端#1');
const qrKey = kRes.key;
console.log('\n=== 2) 本机服务 /api/login/qr/key ===');
console.log(`{"code":${kRes.code},"key":${JSON.stringify(qrKey)},"message":${JSON.stringify(kRes.message ?? '')}}`);

const serverCodes = [];
for (let i = 0; i < 3; i++) {
  /* 每次都用**新** key：判据是「新 key + 立即 check」 */
  const useKey = i === 0 ? qrKey : (await getServerKey(`服务端#${i + 1}`)).key;
  const ck = await local(CHECK, { method: 'POST', body: { key: useKey } });
  serverCodes.push({ code: Number(ck.body?.code), message: ck.body?.message, http: ck.http });
}
console.table(serverCodes.map((r, i) => ({ 第几次: i + 1, code: r.code, message: r.message, http: r.http })));

/* ---------------------- 3) /api/login/qr/last 的 channel ---------------------- */
const last = await local('/api/login/qr/last', { method: 'GET' });
console.log('\n=== 3) /api/login/qr/last ===');
console.log(JSON.stringify(last.body, null, 2));

/* ---------------------- 4) 回归 ---------------------- */
const regress = [
  ['/api/session', 'GET'],
  ['/api/top/playlist', 'GET'],
  ['/api/user/detail?uid=1', 'GET'],
  ['/api/qq/health', 'GET'],
];
const regRows = [];
for (const [p, m] of regress) {
  let r;
  try { r = await local(p, { method: m }); } catch (e) { r = { http: 0, body: { error: String(e.message) } }; }
  regRows.push({ 接口: p, http: r.http, ok: r.http === 200, code: r.body?.code ?? null });
}
console.log('\n=== 4) 回归 ===');
console.table(regRows);

/* ---------------------- 判定 ---------------------- */
if (rateLimited) {
  console.log(`\n注：过程中遇到上游限流 406「操作频繁」共 ${rateLimited} 次，已等待后重取 key。`);
  console.log('    这是 /eapi/login/qrcode/unikey 的频率限制（约 6 个/分钟），不是通道问题。');
}
const checks = [
  ['通道表里 eapi 回 801', rows.some((r) => r.通道.includes('eapi /client/login') && Number(r.code) === 801)],
  [`直连 ${SELECTED} 连测 3 次都是 801`, directCodes.length === 3 && directCodes.every((c) => c === 801)],
  ['经服务连测 3 次都是 801', serverCodes.every((r) => r.code === 801)],
  [`/api/login/qr/last.channel === '${SELECTED}'`, last.body?.channel === SELECTED],
  ['回归 4 个接口全 200', regRows.every((r) => r.ok)],
];
console.log('\n=== 判定 ===');
let pass = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${checks.length} 通过`);
process.exitCode = pass === checks.length ? 0 : 1;
