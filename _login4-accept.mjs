/**
 * 登录专项验收（临时脚本，跑完可删）
 * 只打印 code / 键名 / 布尔 —— 绝不打印任何 cookie 值。
 */
import fs from 'node:fs';

const APP = Number(fs.readFileSync('.port', 'utf8').trim()) || 11701;
const BASE = `http://127.0.0.1:${APP}`;
const SIDE = 'http://127.0.0.1:3215';
const SESSION = '.session.json';
const DUMMY = 'LIZI_DUMMY_NOT_A_REAL_COOKIE_0001';

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail = '') => {
  if (cond) { pass++; rows.push(['PASS', name, detail]); }
  else { fail++; rows.push(['FAIL', name, detail]); }
};
const j = async (url, opt) => {
  const r = await fetch(url, opt);
  let body = null;
  const text = await r.text();
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  return { status: r.status, body, text };
};
const shape = (o, depth = 0) => {
  if (o === null || o === undefined) return String(o);
  if (Array.isArray(o)) return `[${o.length} items]`;
  if (typeof o === 'object') return '{ ' + Object.keys(o).join(', ') + ' }';
  return typeof o;
};
const fileState = () => (fs.existsSync(SESSION) ? fs.readFileSync(SESSION, 'utf8') : null);

console.log('=== 0) 边车与主服务 ===');
const health = await j(`${BASE}/api/netease/health`);
console.log(`  /api/netease/health  ${health.status}  ${JSON.stringify(health.body).slice(0, 160)}`);
check('边车存活', health.status === 200 && health.body.ok === true);

console.log('\n=== 1) 上游响应字段结构（只有键名，没有值）===');
const st = await j(`${SIDE}/login/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
console.log(`  GET/POST /login/status  → 顶层 ${shape(st.body)}`);
console.log(`    data → ${shape(st.body && st.body.data)}`);
const keyResp = await j(`${SIDE}/login/qr/key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":1}' });
console.log(`  /login/qr/key           → 顶层 ${shape(keyResp.body)}   data → ${shape(keyResp.body && keyResp.body.data)}`);
const unikey = keyResp.body?.data?.unikey;
const ck = await j(`${SIDE}/login/qr/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: unikey, type: 1 }) });
console.log(`  /login/qr/check (新 key) → 顶层 ${shape(ck.body)}   code=${ck.body.code}`);
console.log(`    cookie 字段类型=${typeof ck.body.cookie} 长度=${String(ck.body.cookie || '').length}（空串=这一次没下发凭据，正常）`);
check('qr/check 顶层有 cookie 字段', 'cookie' in (ck.body || {}));

console.log('\n=== 2) 真实链路：新 key → 立即 check 必须是 801（不是 8821）===');
const k1 = await j(`${BASE}/api/netease/login/qr/key`);
console.log(`  /api/netease/login/qr/key  ${k1.status}  code=${k1.body.code}  key=${k1.body.key ? '有' : '无'}  qrimg=${k1.body.qrimg ? '有' : '无'}`);
const codes = [];
for (let i = 0; i < 3; i++) {
  const c = await j(`${BASE}/api/netease/login/qr/check?key=${encodeURIComponent(k1.body.key)}`);
  codes.push(c.body.code);
  console.log(`  check #${i + 1}: http=${c.status} code=${c.body.code} message=${c.body.message} hasMusicU=${c.body.hasMusicU} cookieKeys=${JSON.stringify(c.body.cookieKeys)}`);
}
check('三次立即 check 都是 801', codes.every((c) => Number(c) === 801), codes.join('/'));
check('没有 8821 风控码', !codes.some((c) => Number(c) === 8821));

console.log('\n=== 3) /api/login/harvest（新 key，没扫过 → 必须 400 且不碰会话）===');
const before = fileState();
const hv = await j(`${BASE}/api/login/harvest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: unikey }) });
console.log(`  http=${hv.status} reason=${hv.body.reason} code=${hv.body.code ?? '-'} harvest=${JSON.stringify(hv.body.harvest)}`);
console.log(`  message=${hv.body.message}`);
check('harvest 未扫码 → 400', hv.status === 400);
check('harvest 报告了 tried/gotCookie/field', !!hv.body.harvest && Array.isArray(hv.body.harvest.tried) && hv.body.harvest.gotCookie === false && hv.body.harvest.field === null, JSON.stringify(hv.body.harvest));
check('harvest 失败没改 .session.json', fileState() === before);

console.log('\n=== 4) /api/session/import 四种写法（假值 → 必须 invalid + 回滚）===');
const forms = [
  [`MUSIC_U=${DUMMY}`, '单行 k=v'],
  [`a=1; MUSIC_U=${DUMMY}; b=2`, '整串'],
  [`Cookie: MUSIC_U=${DUMMY}`, '带 Cookie: 前缀'],
  [DUMMY, '裸值'],
];
for (const [raw, label] of forms) {
  const snap = fileState();
  const r = await j(`${BASE}/api/session/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: raw }) });
  const leaked = r.text.includes(DUMMY);
  console.log(`  ${label.padEnd(16)} http=${r.status} reason=${r.body.reason} keys=${JSON.stringify(r.body.cookieKeys)} 回滚=${fileState() === snap} 泄露值=${leaked}`);
  check(`import ${label} 认出了 MUSIC_U`, r.status === 400 && r.body.reason === 'invalid' && (r.body.cookieKeys || []).includes('MUSIC_U'));
  check(`import ${label} 回滚`, fileState() === snap);
  check(`import ${label} 响应不含 cookie 值`, !leaked);
}
{
  const snap = fileState();
  const r = await j(`${BASE}/api/session/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'a=1; b=2' }) });
  console.log(`  没有 MUSIC_U      http=${r.status} reason=${r.body.reason} 回滚=${fileState() === snap}`);
  check('import 缺 MUSIC_U → 400 no-music-u', r.status === 400 && r.body.reason === 'no-music-u');
  check('import 缺 MUSIC_U 回滚', fileState() === snap);
}

console.log('\n=== 5) 回归 ===');
for (const p of ['/api/session', '/api/top/playlist?limit=3', '/api/user/detail?uid=1', '/api/qq/health']) {
  const t0 = Date.now();
  const r = await j(`${BASE}${p}`);
  console.log(`  ${p.padEnd(28)} http=${r.status} ${Date.now() - t0}ms  code=${r.body && (r.body.code ?? '-')}`);
  check(`回归 ${p} 200`, r.status === 200);
}

console.log('\n=== 6) 诊断接口 ===');
const last = await j(`${BASE}/api/login/qr/last`);
console.log('  ' + JSON.stringify(last.body));
check('qr/last 带 harvest 段', 'harvest' in last.body);
check('qr/last 不含 cookie 值', !last.text.includes(DUMMY) && !/MUSIC_U=/.test(last.text));

console.log('\n=== 7) 会话文件现状（只列键名）===');
const jar = JSON.parse(fileState() || '{}');
console.log(`  键名: ${JSON.stringify(Object.keys(jar))}`);
check('会话文件里没有残留的假 MUSIC_U', !('MUSIC_U' in jar));

for (const [s, n, d] of rows) console.log(`${s}  ${n}${d ? '  · ' + d : ''}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
