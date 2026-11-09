/**
 * lizi-register.mjs —— 把 public/stages/lizi*.html 自动登记进 app.js 的 STAGES。
 *
 *   node lizi-register.mjs            # 写入
 *   node lizi-register.mjs --dry      # 只看会登记什么，不写
 *
 * 名字和描述来自 LIZI-PLAN.md 那张表；表里没有的（还没规划）就用文件名兜底。
 * 只登记 001-065 之后的 lizi 段，**不碰**任何已有条目，可以反复跑。
 */
import fs from 'node:fs';

const ROOT = 'E:/DSHdesktop/work/music-player';
const DIR = ROOT + '/public/stages';
const APP = ROOT + '/public/app.js';
const PLAN = ROOT + '/LIZI-PLAN.md';
const dry = process.argv.includes('--dry');

/* ---- 1. 从 LIZI-PLAN.md 读"编号 → 中文名 / 机制" ---- */
const plan = new Map();
if (fs.existsSync(PLAN)) {
  for (const line of fs.readFileSync(PLAN, 'utf8').split('\n')) {
    /* | 01 | 泼墨黏墙 | thrown-splat | 机制… | */
    const m = line.match(/^\|\s*(?:[✅⚠✔★]\s*)?(\d{2})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    plan.set('lizi' + m[1], { name: m[2].trim(), desc: m[4].trim() });
  }
}

/* ---- 2. 扫磁盘 ---- */
const files = fs.readdirSync(DIR).filter((f) => /^lizi\d+-.+\.html$/.test(f)).sort();
if (!files.length) { console.log('没有 lizi*.html，什么都不做'); process.exit(0); }

const entries = [];
const bad = [];
for (const f of files) {
  const id = f.match(/^(lizi\d+)/)[1];
  const text = fs.readFileSync(DIR + '/' + f, 'utf8');
  const m = text.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
  if (!m) { bad.push(id + '(找不到脚本)'); continue; }
  try { new Function(m[1]); } catch (e) { bad.push(id + '(' + e.message.slice(0, 50) + ')'); continue; }
  const p = plan.get(id);
  entries.push({
    id,
    name: p ? p.name : id,
    desc: p ? p.desc : '（未在 LIZI-PLAN.md 登记）',
    url: 'stages/' + f,
  });
}
entries.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

/* ---- 3. 重写 app.js 里的 lizi 段 ---- */
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
let app = fs.readFileSync(APP, 'utf8');

const START = "    /* --- lizi 系列（自研粒子特效） --- */";
const END = '  ];';
let a = app.indexOf(START);
if (a < 0) {
  /* 第一次：插在 065 那行之后 */
  const anchor = app.indexOf("url: 'stages/065-domino-lyrics.html' },");
  if (anchor < 0) { console.log('★ 找不到 065 锚点，放弃'); process.exit(1); }
  const lineEnd = app.indexOf('\n', anchor);
  a = lineEnd + 1;
  app = app.slice(0, a) + START + '\n' + app.slice(a);
}
const b = app.indexOf(END, a);
if (b < 0) { console.log('★ 找不到 lizi 段结尾，放弃'); process.exit(1); }

const body = entries.map((e) =>
  "    { id: '" + e.id + "', name: '" + esc(e.name) + "', desc: '" + esc(e.desc) + "', url: '" + e.url + "' },").join('\n');
const next = app.slice(0, a) + START + '\n' + body + '\n' + app.slice(b);
if (next !== app) {
  if (!dry) fs.writeFileSync(APP, next);
}

console.log('登记 ' + entries.length + ' 个 lizi 形态：' + entries.map((e) => e.id + ' ' + e.name).join(' / '));
if (bad.length) console.log('★ 语法不过、已跳过：' + bad.join(' | '));
if (dry) console.log('（--dry：没有写文件）');
