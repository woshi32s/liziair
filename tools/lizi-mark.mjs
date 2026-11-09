/**
 * lizi-mark.mjs —— 给 LIZI-PLAN.md 的 51-100 表格打 ✅ 并重算进度行。
 *
 *   node tools/lizi-mark.mjs lizi52 lizi57 lizi100
 *   node tools/lizi-mark.mjs --status          # 只打印统计，不写
 *
 * 只动 "# LIZI · 51-100" 那一节的表格行和它下面的进度行，不碰 01-50。
 */
import fs from 'node:fs';

const ROOT = 'E:/DSHdesktop/work/music-player';
const PLAN = ROOT + '/LIZI-PLAN.md';
const DIR = ROOT + '/public/stages';

const argv = process.argv.slice(2);
const statusOnly = argv.includes('--status');
const ids = argv.filter((a) => /^lizi\d+$/.test(a)).map((a) => Number(a.slice(4)));

let src = fs.readFileSync(PLAN, 'utf8');
const lines = src.split('\n');

/* 找 51-100 那一节的起止 */
const start = lines.findIndex((l) => l.startsWith('# LIZI · 51-100'));
if (start < 0) { console.error('LIZI-PLAN.md 里找不到 51-100 那一节'); process.exit(1); }

const rowRe = /^\|\s*(✅|⚠|✔|★)?\s*(\d{2,3})\s*\|/;
let marked = 0;
for (let i = start; i < lines.length; i++) {
  const m = lines[i].match(rowRe);
  if (!m) continue;
  const n = Number(m[2]);
  if (n < 51 || n > 100) continue;
  const want = ids.includes(n);
  if (statusOnly) continue;
  if (want && !m[1]) {
    lines[i] = lines[i].replace(/^\|\s*/, '| ✅');
    marked++;
  }
}

/* 统计：计划行里的 ✅ 数 / 磁盘上的 html 数 */
let okRows = 0, totalRows = 0;
for (let i = start; i < lines.length; i++) {
  const m = lines[i].match(rowRe);
  if (!m || Number(m[2]) < 51 || Number(m[2]) > 100) continue;
  totalRows++;
  if (m[1] === '✅') okRows++;
}
const files = fs.readdirSync(DIR).filter((f) => /^lizi(\d+)-.+\.html$/.test(f));
const have = files.map((f) => Number(f.match(/^lizi(\d+)/)[1])).filter((n) => n >= 51 && n <= 100);
const missing = [];
for (let n = 51; n <= 100; n++) if (!have.includes(n)) missing.push(n);

/* 进度行：插在这一节标题下面第一行（空行之后） */
const prog = `> 进度（第二批）：已验收并打勾 **${okRows}/${totalRows}**；磁盘上已构建 **${have.length}** 个` +
  (missing.length ? `；未做：${missing.join('、')}` : '；100 个全部已构建') + '。';

let insertAt = start + 1;
while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
const isProg = (s) => s.startsWith('> 进度（第二批）');
if (isProg(lines[insertAt] || '')) lines[insertAt] = prog;
else lines.splice(insertAt, 0, prog);

if (!statusOnly) fs.writeFileSync(PLAN, lines.join('\n'), 'utf8');

console.log(`打勾 ${statusOnly ? '(只读)' : marked + ' 个'}；表格 ✅ ${okRows}/${totalRows}；磁盘已构建 ${have.length}/50${missing.length ? '；缺 ' + missing.join(',') : ''}`);
