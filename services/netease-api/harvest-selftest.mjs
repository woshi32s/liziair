/**
 * harvest 管线自测 —— 不联外网、不碰真实会话，全用注入的假响应。
 * 用法: node services/netease-api/harvest-selftest.mjs
 *
 * 覆盖验收要求的三形状 + 两条真实踩坑路径：
 *   A body.cookie             → 成功
 *   B Set-Cookie 头            → 成功
 *   C 两处都没有               → 400/ no-music-u，且**会话没被改**
 *   D 803 当场缓存命中         → 成功（重查已回 800 也不影响）
 *   E 取到了但校验不过         → invalid，且**回滚**
 * 另附：粘贴 cookie 的四种写法。
 */

import { parseCookieInput, extractCookie, harvest } from './harvest-core.mjs';

let pass = 0, fail = 0;
const rows = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; rows.push(['PASS', name, detail]); }
  else { fail++; rows.push(['FAIL', name, detail]); }
}

/** 假会话：只记 apply / restore 次数和当前 jar，不落盘 */
function fakeSession() {
  const st = { jar: { NMTID: 'old-nmtid' }, applied: 0, restored: 0, writes: [] };
  return {
    st,
    api: {
      snapshot: () => ({ jar: { ...st.jar }, raw: JSON.stringify(st.jar) }),
      apply: (pairs) => { st.applied++; st.jar = { ...pairs }; st.writes.push(Object.keys(pairs)); },
      restore: (snap) => { st.restored++; st.jar = { ...snap.jar }; },
    },
  };
}
const fakeCache = () => {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, pairs, field) => m.set(k, { pairs: { ...pairs }, field }), m };
};
const recheckOnce = (body, setCookies = []) => { let n = 0; return async () => { n++; return { body, setCookies }; }; };

const MUSIC_U_VAL = 'TESTVALUE_do_not_log_0001';
const bodyOk = { code: 803, message: '授权登陆成功', cookie: `MUSIC_U=${MUSIC_U_VAL}; __csrf=testcsrf` };
const headerOk = [`MUSIC_U=${MUSIC_U_VAL}; Path=/; Expires=Wed, 29 Oct 2026 00:00:00 GMT`, '__csrf=testcsrf; Path=/'];

/* ---------------- A: body.cookie ---------------- */
{
  const s = fakeSession();
  let verified = 0;
  const r = await harvest({
    key: 'k-a', cache: fakeCache(),
    recheck: recheckOnce(bodyOk, []),
    verify: async () => { verified++; return { userId: 42, nickname: 'n' }; },
    session: s.api,
  });
  check('A body.cookie → ok', r.ok === true && r.field === 'body.cookie', `field=${r.field} reason=${r.reason || '-'}`);
  check('A 写入会话并校验', s.st.applied === 1 && verified === 1 && s.st.jar.MUSIC_U === MUSIC_U_VAL);
  check('A tried 只有 check', JSON.stringify(r.tried) === '["check"]', r.tried.join(','));
}

/* ---------------- B: Set-Cookie 头 ---------------- */
{
  const s = fakeSession();
  let verified = 0;
  const r = await harvest({
    key: 'k-b', cache: fakeCache(),
    recheck: recheckOnce({ code: 803, message: '授权登陆成功' }, headerOk),
    verify: async () => { verified++; return { userId: 43, nickname: 'n' }; },
    session: s.api,
  });
  check('B header set-cookie → ok', r.ok === true && r.field === 'header', `field=${r.field} reason=${r.reason || '-'}`);
  check('B 写入会话并校验', s.st.applied === 1 && verified === 1 && s.st.jar.MUSIC_U === MUSIC_U_VAL);
}

/* ---------------- C: 两处都没有 ---------------- */
{
  const s = fakeSession();
  let verified = 0;
  const r = await harvest({
    key: 'k-c', cache: fakeCache(),
    recheck: recheckOnce({ code: 803, message: '授权登陆成功', cookie: '' }, []),
    status: async () => ({ body: { data: { code: 200, account: null, profile: null } }, setCookies: [] }),
    verify: async () => { verified++; return { userId: 1 }; },
    session: s.api,
  });
  check('C 都没有 → 失败且 reason=no-music-u', r.ok === false && r.reason === 'no-music-u', `reason=${r.reason} code=${r.code}`);
  check('C 会话完全没动（无写入/无回滚）', s.st.applied === 0 && s.st.restored === 0 && s.st.jar.NMTID === 'old-nmtid');
  check('C 没有去 verify', verified === 0);
  check('C tried = check,status', JSON.stringify(r.tried) === '["check","status"]', r.tried.join(','));
}

/* ---------------- D: 803 当场缓存命中（重查必 800） ---------------- */
{
  const s = fakeSession();
  const cache = fakeCache();
  let rechecked = 0;
  const r = await harvest({
    key: 'k-d', cache,
    recheck: async () => { rechecked++; return { body: { code: 800, message: '二维码不存在或已过期' } }; },
    verify: async () => ({ userId: 44, nickname: 'n' }),
    session: s.api,
    record: () => {},
  });
  /* 先手动把缓存塞进去，模拟「803 那次已经抓过」 */
  const s2 = fakeSession();
  cache.set('k-d', { MUSIC_U: MUSIC_U_VAL, __csrf: 'c' }, 'body.cookie');
  const r2 = await harvest({
    key: 'k-d', cache,
    recheck: async () => { rechecked++; return { body: { code: 800 } }; },
    verify: async () => ({ userId: 44, nickname: 'n' }),
    session: s2.api,
  });
  check('D 缓存命中 → ok（不等重查）', r2.ok === true && r2.field === 'body.cookie', `field=${r2.field}`);
  check('D 命中缓存后没有再去 check', rechecked === 1 && r2.tried[0] === 'cache', r2.tried.join(','));
  check('D 缓存命中也能写入会话', s2.st.applied === 1 && s2.st.jar.MUSIC_U === MUSIC_U_VAL);
  check('D 无缓存时 800 如实报 not-authorized', r.ok === false && r.reason === 'not-authorized' && r.code === 800);
}

/* ---------------- E: 取到了但校验不过 → 回滚 ---------------- */
{
  const s = fakeSession();
  const r = await harvest({
    key: 'k-e', cache: fakeCache(),
    recheck: recheckOnce(bodyOk, []),
    verify: async () => null,
    session: s.api,
  });
  check('E 校验不过 → invalid', r.ok === false && r.reason === 'invalid' && r.gotCookie === true);
  check('E 回滚生效', s.st.restored === 1 && s.st.jar.MUSIC_U === undefined && s.st.jar.NMTID === 'old-nmtid');
}

/* ---------------- F: extractCookie 三种形状 ---------------- */
{
  const a = extractCookie({ cookie: `MUSIC_U=${MUSIC_U_VAL}` }, []);
  const b = extractCookie({ data: { cookie: `MUSIC_U=${MUSIC_U_VAL}` } }, []);
  const c = extractCookie({}, [`MUSIC_U=${MUSIC_U_VAL}; Path=/`]);
  const d = extractCookie({ code: 803, cookie: '' }, []);
  check('F body.cookie', a.field === 'body.cookie' && a.pairs.MUSIC_U === MUSIC_U_VAL);
  check('F body.data.cookie', b.field === 'body.data.cookie' && b.pairs.MUSIC_U === MUSIC_U_VAL);
  check('F header', c.field === 'header' && c.pairs.MUSIC_U === MUSIC_U_VAL);
  check('F 空响应的 field=null', d.field === null && !d.pairs.MUSIC_U);
  check('F 属性名被剔掉', a.pairs.Path === undefined && c.pairs.Path === undefined && c.pairs.Expires === undefined);
}

/* ---------------- G: 粘贴 cookie 的四种写法 ---------------- */
{
  const forms = [
    'MUSIC_U=' + MUSIC_U_VAL,
    'a=1; MUSIC_U=' + MUSIC_U_VAL + '; b=2',
    'Cookie: MUSIC_U=' + MUSIC_U_VAL,
    MUSIC_U_VAL,
  ];
  const got = forms.map((f) => parseCookieInput(f).MUSIC_U === MUSIC_U_VAL);
  check('G 四种写法都能取到 MUSIC_U', got.every(Boolean), got.join(','));
  check('G 空输入不产生 MUSIC_U', !parseCookieInput('').MUSIC_U && !parseCookieInput('   ').MUSIC_U);
  check('G 纯名字没有值的串不产生 MUSIC_U', !parseCookieInput('MUSIC_U=').MUSIC_U);
}

/* ---------------- 输出（绝不打印 cookie 值） ---------------- */
for (const [st, name, detail] of rows) {
  console.log(`${st}  ${name}${detail ? '  · ' + detail : ''}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
