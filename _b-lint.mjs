/** 规格体检：_b-spec/*.mjs 里有没有漏掉收尾引号的行（我老是漏）
 *  用法：node _b-lint.mjs [240 241 ...]（缺省检查全部） */
import fs from 'node:fs';
const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync('_b-spec').filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();
let bad = 0;
for (const id of ids) {
  const p = '_b-spec/' + id + '.mjs';
  if (!fs.existsSync(p)) { console.log(id, 'MISSING'); bad++; continue; }
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith("'") && t.endsWith("*/")) { console.log(`${id}:${i + 1} 未收尾: ${t.slice(0, 70)}`); bad++; }
  });
}
console.log(bad ? `!! ${bad} 处` : 'lint ok');
process.exit(bad ? 1 : 0);
