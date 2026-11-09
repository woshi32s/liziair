/**
 * 汽水登录二维码「瘦身」——只做无损简化，不改 token、不改轮询。
 *
 * 上游 open.douyin.com/oauth/get_qrcode/ 一次返回两样东西：
 *   - data.qrcode            base64 PNG（77×77，3px/模块，ECC M）
 *   - data.qrcode_index_url  这个 PNG 里编码的原始字符串（356 字节的 aweme:// 深链）
 *
 * 356 字节里有一大截是**空值参数**（certification_scope= / openid= /
 * optional_scope_check= / optional_scope_uncheck= / user_ticket=），
 * 对 URL 解析来说「key=」和「key 不存在」是同一件事，删掉不影响授权。
 * 剩下的 client_key / scopes / token / source / not_skip_confirm 全部原样保留。
 *
 * 然后用 ECC L 重新编码渲染（版本按内容长度自动选，实测这条深链是 V10）：
 *   - 77×77（ECC M）→ 57×57（ECC L），模块数降 26%，面积降 45%
 *   - 8px/模块 + 4 模块留白 → 520×520 PNG，浏览器缩放时不再只有 3px/模块
 *
 * 任何一步失败都原样返回上游响应——绝不能因为「变好看」把登录弄坏。
 */
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// 缺这个依赖也不让边车起不来：渲染时抛错，wrapQrFetch 会回退上游原图。
let qrcode = null;
try { qrcode = require('qrcode-generator'); } catch { /* 下面 renderQrPng 会抛 */ }

const QR_PATH = 'https://open.douyin.com/oauth/get_qrcode/';

/** 删掉「有 key、值为空」的 query 段；其它字节原样保留（包括顺序和 %2C）。 */
export function simplifyQrPayload(raw) {
  if (typeof raw !== 'string') return raw;
  const q = raw.indexOf('?');
  if (q < 0) return raw;
  const head = raw.slice(0, q + 1);
  const kept = raw.slice(q + 1).split('&').filter((seg) => {
    const eq = seg.indexOf('=');
    return eq < 0 || seg.slice(eq + 1) !== '';
  });
  return head + kept.join('&');
}

/* ---------------- PNG（1bit 灰度，无依赖） ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * 把 qrcode-generator 的模块矩阵画成 1bit 灰度 PNG。
 * @param {string} text 要编码的字符串（按 Byte 模式）
 * @param {{ecc?: 'L'|'M'|'Q'|'H', scale?: number, quiet?: number}} opts
 * @returns {{ png: Buffer, modules: number, px: number, payload: number }}
 */
export function renderQrPng(text, opts = {}) {
  if (!qrcode) throw new Error('缺少 qrcode-generator 依赖');
  const ecc = opts.ecc || 'L';
  const scale = Math.max(1, Math.round(opts.scale || 8));
  const quiet = Math.max(0, Math.round(opts.quiet == null ? 4 : opts.quiet));

  const qr = qrcode(0, ecc);          // typeNumber 0 = 按内容自动选最小版本
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const total = (n + quiet * 2) * scale;

  // 1bit 灰度：0 = 黑，1 = 白。每行开头一个 filter 字节 0。
  const stride = Math.ceil(total / 8);
  const raw = Buffer.alloc((stride + 1) * total, 0xff); // 默认整行白
  for (let y = 0; y < total; y++) raw[y * (stride + 1)] = 0;
  for (let my = 0; my < n; my++) {
    for (let mx = 0; mx < n; mx++) {
      if (!qr.isDark(my, mx)) continue;
      const py0 = (my + quiet) * scale;
      const px0 = (mx + quiet) * scale;
      for (let dy = 0; dy < scale; dy++) {
        const row = py0 + dy;
        const base = row * (stride + 1) + 1;
        for (let dx = 0; dx < scale; dx++) {
          const px = px0 + dx;
          raw[base + (px >> 3)] &= ~(0x80 >> (px & 7));
        }
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(total, 0);
  ihdr.writeUInt32BE(total, 4);
  ihdr[8] = 1;   // bit depth
  ihdr[9] = 0;   // grayscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, modules: n, px: total, payload: Buffer.byteLength(text, 'utf8') };
}

/**
 * fetch 包装：只拦 get_qrcode，把上游 PNG 换成瘦身后的 PNG。
 * 失败时原样返回，登录流程（token / check_qrcode）完全不受影响。
 */
export function wrapQrFetch(fetcher = globalThis.fetch, { log = () => {} } = {}) {
  return async function qrFetch(input, init) {
    const response = await fetcher(input, init);
    let href = '';
    try {
      href = typeof input === 'string' ? input
        : input instanceof URL ? input.href
          : (input && input.url) || '';
    } catch { /* ignore */ }
    if (!href.startsWith(QR_PATH)) return response;

    try {
      const json = await response.clone().json();
      const data = json && json.data;
      if (!data || typeof data.qrcode_index_url !== 'string' || !data.qrcode_index_url) return response;
      const payload = simplifyQrPayload(data.qrcode_index_url);
      const out = renderQrPng(payload, { ecc: 'L', scale: 8, quiet: 4 });
      const next = JSON.parse(JSON.stringify(json));
      next.data.qrcode = out.png.toString('base64');
      next.data.qrcode_index_url = payload;
      log(`二维码已瘦身：${data.qrcode_index_url.length}→${payload.length} 字节，${out.modules}×${out.modules} 模块，${out.px}px，${out.png.length}B`);
      return new Response(JSON.stringify(next), {
        status: response.status,
        statusText: response.statusText,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    } catch (e) {
      log('二维码瘦身失败，回退上游原图：' + ((e && e.message) || e));
      return response;
    }
  };
}
