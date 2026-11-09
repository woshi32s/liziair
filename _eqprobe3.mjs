/**
 * _eqprobe3.mjs —— 直接打上游 weapi，验证 encodeType（mp3 vs flac）对返回的影响。
 * 匿名会话（不带 MUSIC_U），所以结果代表"未登录"用户的真实处境。
 *   node _eqprobe3.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';
const PUB_KEY = '010001';
const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const aesEncrypt = (t, k) => {
  const c = crypto.createCipheriv('aes-128-cbc', k, IV);
  return Buffer.concat([c.update(t, 'utf8'), c.final()]).toString('base64');
};
const randomKey = () => Array.from({ length: 16 }, () => BASE62[Math.floor(Math.random() * 62)]).join('');
function modPow(base, exp, mod) {
  let r = 1n; base %= mod;
  while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; }
  return r;
}
const rsaEncrypt = (text) => {
  const rev = Buffer.from(text.split('').reverse().join(''), 'utf8').toString('hex');
  return modPow(BigInt('0x' + rev), BigInt('0x' + PUB_KEY), BigInt('0x' + MODULUS)).toString(16).padStart(256, '0');
};
const weapi = (o) => {
  const key = randomKey();
  return { params: aesEncrypt(aesEncrypt(JSON.stringify(o), PRESET_KEY), key), encSecKey: rsaEncrypt(key) };
};

async function call(apiPath, payload) {
  const data = weapi({ ...payload, csrf_token: '' });
  const body = new URLSearchParams({ ...data, csrf_token: '' }).toString();
  const r = await fetch('https://music.163.com/weapi' + apiPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://music.163.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'X-Real-IP': '118.88.88.88',
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; }
}

const rows = [];
for (const id of [2528009, 5276791, 1901371647]) {
  for (const enc of ['mp3', 'flac']) {
    for (const lv of ['standard', 'exhigh', 'lossless', 'hires', 'jymaster']) {
      const j = await call('/song/enhance/player/url/v1', { ids: JSON.stringify([id]), level: lv, encodeType: enc });
      const it = (j.data || [])[0] || {};
      rows.push({ id, enc, lv, url: !!it.url, level: it.level ?? null, br: it.br ?? null, size: it.size ?? null, type: it.type ?? null, fee: it.fee ?? null, code: it.code ?? null, reason: it.reason ?? null });
      console.log(`id=${id} enc=${enc.padEnd(4)} ask=${lv.padEnd(8)} url=${it.url ? 'YES' : 'no '} got=${String(it.level).padEnd(9)} br=${String(it.br).padEnd(7)} size=${String(it.size).padEnd(9)} type=${it.type} fee=${it.fee} code=${it.code}`);
    }
    console.log('');
  }
}
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
fs.writeFileSync(path.join(dir, '_eqprobe3.json'), JSON.stringify(rows, null, 2));
console.log('→ _eqprobe3.json');
