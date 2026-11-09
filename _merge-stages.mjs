/**
 * _merge-stages.mjs —— 把 public/stages 里新的 3 位编号文件**增量**并入 app.js 的 STAGES。
 *
 * 为什么不跑 register-stages.mjs：那个脚本只收 `/^\d{3}-.+\.html$/`，
 * 会把 STAGES 里已有的 100 个 `lizi*` 条目一起删掉（另一条会话的作品）。
 * 这里只追加缺失的 id，绝不删任何现存条目。
 */
import fs from 'node:fs';

const ROOT = 'E:/DSHdesktop/work/music-player';
const APP = `${ROOT}/public/app.js`;
const DIR = `${ROOT}/public/stages`;

const app = fs.readFileSync(APP, 'utf8');
const start = app.indexOf('  const STAGES = [');
const end = app.indexOf('\n  ];', start);
if (start < 0 || end < 0) { console.error('定位不到 STAGES 数组'); process.exit(1); }

const block = app.slice(start, end);
const have = new Set([...block.matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1]));

const files = fs.readdirSync(DIR).filter((f) => /^\d{3}-.+\.html$/.test(f)).sort();
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const added = [];
for (const f of files) {
  const id = f.slice(0, 3);
  if (have.has(id)) continue;
  const text = fs.readFileSync(`${DIR}/${f}`, 'utf8');
  const title = (text.match(/<title>([^<]+)<\/title>/) || [, ''])[1].trim();
  /* 机制一句话：取文件头注释里第一行有实质内容的 */
  let desc = '';
  const head = text.slice(0, 2600);
  const lines = head.split('\n').map((l) => l.replace(/^\s*(\/\*+|\*+\/?|\/\/+)\s?/, '').trim());
  for (const l of lines) {
    if (!l || l.length < 6) continue;
    if (/^(<!DOCTYPE|<html|const |let |function |import )/i.test(l)) break;
    if (/^[\d\s./-]+$/.test(l)) continue;
    desc = l.slice(0, 46);
    break;
  }
  added.push({ id, f, name: title || id, desc: desc || title || id });
}

if (!added.length) { console.log('没有需要新增的条目'); process.exit(0); }

const body = added
  .map((e) => `    { id: '${e.id}', name: '${esc(e.name)}', desc: '${esc(e.desc)}', url: 'stages/${e.f}' },`)
  .join('\n');

const next = app.slice(0, end) + '\n' + body + app.slice(end);
fs.writeFileSync(APP, next);
console.log(`追加 ${added.length} 条：${added.map((e) => e.id).join(', ')}`);

const after = fs.readFileSync(APP, 'utf8');
const lizi = (after.match(/url: 'stages\/lizi/g) || []).length;
const num = (after.match(/url: 'stages\/\d{3}-/g) || []).length;
console.log(`STAGES 现在：数字 ${num} 条 + lizi ${lizi} 条`);
for (const e of added) console.log(`  ${e.id}  ${e.name}  —  ${e.desc}`);
