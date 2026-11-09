/**
 * 验收专用：给 server.mjs 用的「假上游」预加载模块。
 *
 *   node --import ./_stub-net.mjs server.mjs
 *
 * **只给 _neteaselogin.mjs 用，不是产品代码**，也不改产品代码：
 * 它在本进程里替换 globalThis.fetch，只拦两个 URL，其它原样透传。
 *
 *   1) https://music.163.com/weapi/*  → 回一个假的登录态（用来验 harvest 的"校验"那一步）
 *   2) 任意 /login/qr/check           → 按 _stub-mode.txt 回
 *        ok      : { code:803, cookie:'MUSIC_U=…; __csrf=…' }
 *        nomusic : { code:803, cookie:'NMTID=…' }        ← 803 但没 MUSIC_U
 *
 * 为什么必须这么绕：803 那句 cookie 只有在用户真扫过手机之后才存在，
 * 而验证「写进会话 + 校验」又必须让 /w/nuser/account/get 回一次成功。
 * 在测试进程里拦 fetch 是唯一不往产品代码里塞测试开关的办法。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.LIZI_STUB_ROOT || process.cwd();
const MODE_FILE = path.join(ROOT, '_stub-mode.txt');

const FAKE_PROFILE = { userId: 900000001, nickname: '验收假用户', avatarUrl: '', vipType: 0 };

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function readMode() {
  try { return fs.readFileSync(MODE_FILE, 'utf8').trim() || 'ok'; } catch { return 'ok'; }
}

const realFetch = globalThis.fetch;

globalThis.fetch = function liziStubFetch(input, init) {
  const url = typeof input === 'string' ? input : ((input && input.url) || String(input));

  // 1) 网易云 weapi：登录态校验
  if (url.includes('music.163.com/weapi/')) {
    return Promise.resolve(jsonResponse({ code: 200, profile: FAKE_PROFILE }));
  }

  // 2) 边车的扫码状态：模拟 803
  if (url.includes('/login/qr/check')) {
    if (readMode() === 'nomusic') {
      return Promise.resolve(jsonResponse({ code: 803, message: '授权成功', cookie: 'NMTID=FAKE_NMTID_ONLY' }));
    }
    return Promise.resolve(jsonResponse({
      code: 803,
      message: '授权成功',
      cookie: 'MUSIC_U=FAKE_MUSIC_U_FOR_TEST_ONLY; __csrf=FAKE_CSRF_FOR_TEST_ONLY',
    }));
  }

  return realFetch(input, init);
};
