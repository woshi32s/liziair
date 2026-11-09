/**
 * LIZI · 扫码收尾（harvest）核心
 * ---------------------------------------------------------------------------
 * 这个文件只做「从上游响应里把 MUSIC_U 抠出来 → 写进会话 → 验一次」这一件事，
 * 不依赖 server.mjs、不读盘、不联网：所有副作用都由调用方注入。
 * 好处是三种上游形状（body.cookie / body.data.cookie / set-cookie 头）都能用
 * 假响应直接断言，不用真的拿手机去扫。
 *
 * 背景（真实踩坑，别再改回去）：
 *   @neteasecloudmusicapienhanced/api 的 /login/qr/check 在 803 那一次响应里
 *   就把 cookie 带回来了（module/login_qr_check.js: body.cookie = result.cookie.join(';')），
 *   同时还有 Set-Cookie 响应头。**那一次不抓，下一秒就抓不到了** ——
 *   二维码 key 是一次性的，同一个 key 再 check 会回 800「二维码不存在或已过期」。
 *   所以：803 当场缓存 + 当场写入；/api/login/harvest 只是兜底确认。
 *
 * 安全：本文件从不返回、不记录任何 cookie 值。对外的只有键名和「来源字段名」。
 */

/** Cookie 属性名（不是 cookie 本身）。从 "MUSIC_U=..; Path=/; Expires=.." 里剔掉 */
const COOKIE_ATTRS = new Set([
  'path', 'domain', 'expires', 'max-age', 'secure', 'httponly',
  'samesite', 'version', 'priority', 'comment', 'partitioned',
]);

/**
 * 宽容解析一段 cookie 文本。用户从 F12 复制出来的四种写法都要能用：
 *   MUSIC_U=abc
 *   a=1; MUSIC_U=abc; b=2
 *   Cookie: MUSIC_U=abc
 *   裸值 abc            （只粘了值本身，按 MUSIC_U 处理）
 * 也吃上游 Set-Cookie 那种 "MUSIC_U=abc; Path=/; Expires=..."。
 * 返回 { 键: 值 }；没有 MUSIC_U 时由调用方决定怎么报错。
 */
export function parseCookieInput(raw) {
  let s = String(raw == null ? '' : raw).trim();
  const out = {};
  if (!s) return out;
  s = s.replace(/^cookie\s*:\s*/i, '').trim();       // 带 "Cookie:" 前缀的整行
  s = s.replace(/^["']+|["']+$/g, '').trim();        // 浏览器复制偶尔带引号
  if (!s) return out;
  if (!s.includes('=') && !s.includes(';')) {        // 裸值
    out.MUSIC_U = s;
    return out;
  }
  for (const part of s.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k || !v) continue;
    if (COOKIE_ATTRS.has(k.toLowerCase())) continue;  // Path=/ 这类不是 cookie
    out[k] = v;
  }
  return out;
}

/**
 * 从一次上游响应里找 cookie。三种形状都兜：
 *   1. body.cookie            ← 这个包 /login/qr/check 803 的正规位置
 *   2. body.data.cookie       ← 有的版本 / 转发层会多包一层 data
 *   3. Set-Cookie 响应头       ← 上游直发、body 被过滤时唯一还在的地方
 * 优先返回「含 MUSIC_U」的那份；都没有就返回第一个非空来源（让调用方报清楚缺什么）。
 * @returns {{ field: 'body.cookie'|'body.data.cookie'|'header'|null, pairs: Record<string,string> }}
 */
export function extractCookie(body, setCookies = []) {
  const b = body && typeof body === 'object' ? body : {};
  const candidates = [];
  if (typeof b.cookie === 'string' && b.cookie.trim()) {
    candidates.push(['body.cookie', b.cookie]);
  }
  if (b.data && typeof b.data === 'object' && typeof b.data.cookie === 'string' && b.data.cookie.trim()) {
    candidates.push(['body.data.cookie', b.data.cookie]);
  }
  if (Array.isArray(setCookies) && setCookies.length) {
    candidates.push(['header', setCookies.join('; ')]);
  }
  let first = null;
  for (const [field, text] of candidates) {
    const pairs = parseCookieInput(text);
    if (!first) first = { field, pairs };
    if (pairs.MUSIC_U) return { field, pairs };
  }
  return first || { field: null, pairs: {} };
}

/** 缓存里存的东西（只留 MUSIC_U / __csrf 这类真 cookie，键名可以进日志） */
function slim(pairs) {
  const out = {};
  for (const [k, v] of Object.entries(pairs || {})) if (v) out[k] = v;
  return out;
}

/**
 * 扫码收尾主流程。所有 I/O 都注入，方便测试：
 *
 * @param {object} deps
 * @param {string} deps.key                         二维码 key（只用于缓存查找）
 * @param {{get:Function,set:Function}} [deps.cache] key → { pairs, field }（803 当场缓存）
 * @param {Function} deps.recheck                   async () => { body, setCookies }  同一个 key 再问一次
 * @param {Function} [deps.status]                  async () => { body, setCookies }  803 但没 cookie 时的第二落点
 * @param {Function} deps.verify                    async () => profile|null         用写好的会话验一次
 * @param {{snapshot:Function,apply:Function,restore:Function}} deps.session
 * @param {Function} [deps.record]                  (info) => void  诊断留档（不含值）
 * @returns {Promise<{
 *   ok: boolean, reason?: string, message?: string, code?: number|null,
 *   profile?: object|null, field: string|null, gotCookie: boolean,
 *   keys: string[], tried: string[]
 * }>}
 */
export async function harvest(deps) {
  const {
    key = '', cache = null, recheck, status = null,
    verify, session, record = () => {},
  } = deps || {};

  const tried = [];
  let pairs = {};
  let field = null;
  let code = null;

  /* 1) 803 当场缓存的那一份最可信：key 一次性，重查必 800 */
  if (cache && key) {
    const hit = cache.get(key);
    if (hit && hit.pairs && hit.pairs.MUSIC_U) {
      tried.push('cache');
      pairs = hit.pairs;
      field = hit.field || 'body.cookie';
    }
  }

  /* 2) 缓存没有才重查。注意：重查很可能回 800（key 已被消费），这不是 bug 是常态 */
  if (!pairs.MUSIC_U && typeof recheck === 'function') {
    tried.push('check');
    try {
      const r = (await recheck()) || {};
      if (r.body && r.body.code !== undefined && r.body.code !== null) code = Number(r.body.code);
      const ex = extractCookie(r.body, r.setCookies);
      if (ex.pairs.MUSIC_U) {
        pairs = ex.pairs;
        field = ex.field;
        if (cache && key) cache.set(key, pairs, field);
      }
    } catch { /* 边车抽风：下面统一报 no-music-u / sidecar */ }
  }

  /* 3) 还是没有 → 问一次 /login/status（有的版本把刷新后的 cookie 只放响应头） */
  if (!pairs.MUSIC_U && typeof status === 'function') {
    tried.push('status');
    try {
      const r = (await status()) || {};
      const ex = extractCookie(r.body, r.setCookies);
      if (ex.pairs.MUSIC_U) {
        pairs = ex.pairs;
        field = ex.field;
        if (cache && key) cache.set(key, pairs, field);
      }
    } catch { /* 忽略：下面统一报错 */ }
  }

  const keys = Object.keys(pairs);
  const info = () => ({ tried, gotCookie: !!pairs.MUSIC_U, field: field || null, keys });

  if (!pairs.MUSIC_U) {
    /* 803 只代表「手机上授权了」。上游没下发 MUSIC_U 时绝不能动现有会话。 */
    const out = {
      ok: false,
      reason: code !== null && code !== 803 ? 'not-authorized' : 'no-music-u',
      code,
      gotCookie: false,
      field: field || null,
      keys,
      tried,
      message: code !== null && code !== 803
        ? `上游这次回的是 ${code}（不是 803）：二维码 key 已被用过或已过期`
        : '扫码已确认，但上游这次没下发 MUSIC_U',
    };
    record(out);
    return out;
  }

  /* 4) 写盘 → 用刚写进去的 cookie 验一次 → 不过就原样回滚 */
  const snap = session.snapshot();
  session.apply(slim(pairs));
  let profile = null;
  let verifyError = null;
  try {
    profile = await verify();
  } catch (e) {
    verifyError = e;
  }
  if (!profile) {
    session.restore(snap);
    const out = {
      ok: false,
      reason: verifyError ? 'error' : 'invalid',
      code,
      gotCookie: true,
      field,
      keys,
      tried,
      message: verifyError
        ? '拿到了 MUSIC_U，但校验时出错了：' + (verifyError.message || String(verifyError))
        : '拿到了 MUSIC_U，但用它校验没通过（可能已过期）',
    };
    record(out);
    return out;
  }

  const ok = { ok: true, code, gotCookie: true, field, keys, tried, profile };
  record(ok);
  return ok;
}
