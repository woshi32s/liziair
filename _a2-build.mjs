/**
 * _a2-build.mjs —— A 组第二批 230-239 拼装器
 * 每个形态 = 共享骨架（_a2-core.js，与 200-209 同源）+ 机制体（_a2-<NNN>.js）
 * 产物是**单文件自包含 HTML**（零外部请求），字数统计与「机制一句话」在构建期校验。
 * 用法：node _a2-build.mjs [230]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const CORE = fs.readFileSync(path.join(ROOT, '_a2-core.js'), 'utf8');

const STAGES = [
  { num: '230', slug: 'counter-flood' },
  { num: '231', slug: 'type-case' },
  { num: '232', slug: 'glyph-jelly' },
  { num: '233', slug: 'grid-collapse' },
  { num: '234', slug: 'knife-register' },
  { num: '235', slug: 'ink-sort' },
  { num: '236', slug: 'fit-measure' },
  { num: '237', slug: 'arc-typeset' },
  { num: '238', slug: 'wrap-flow' },
  { num: '239', slug: 'page-turn' }
];

const only = process.argv[2] || '';

const CSS = [
  'html,body{margin:0;height:100%;background:#04060a;overflow:hidden}',
  '#c{position:fixed;inset:0;width:100%;height:100%;display:block}',
  '#vig{position:fixed;inset:0;pointer-events:none;z-index:2;',
  '     background:radial-gradient(132% 108% at 50% 48%,transparent 38%,rgba(2,4,8,.50) 74%,rgba(1,2,5,.92))}',
  '#hint{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:3;',
  '      font:500 11px/1.5 ui-monospace,Consolas,monospace;',
  '      color:rgba(150,205,220,.32);letter-spacing:.10em;pointer-events:none;transition:opacity .6s;white-space:nowrap}'
].join('\n  ');

let n = 0;
for (const st of STAGES) {
  if (only && st.num !== only) continue;
  const bodyPath = path.join(ROOT, `_a2-${st.num}.js`);
  if (!fs.existsSync(bodyPath)) { console.log(`skip ${st.num}（没有 ${path.basename(bodyPath)}）`); continue; }
  const body = fs.readFileSync(bodyPath, 'utf8');
  const meta = /^\/\*!([\s\S]*?)\*\//.exec(body);
  if (!meta) throw new Error(`${st.num}: 缺少 /*! 元信息 */（标题 / 机制一句话）`);
  const metaLines = meta[1].split('\n').map((s) => s.trim()).filter(Boolean);
  const title = (metaLines[0] || '').replace(/^title:/, '').trim();
  if (!/机制一句话/.test(meta[1])) throw new Error(`${st.num}: 文件头必须有「机制一句话」`);

  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title}</title>`,
    '<style>',
    '  ' + CSS,
    '</style>',
    '</head>',
    '<body data-chrome="off">',
    '<canvas id="c"></canvas>',
    '<div id="vig"></div>',
    '<div id="hint">等待第一句…</div>',
    '<script>',
    '"use strict";',
    meta[0],
    '',
    CORE,
    '',
    body,
    '',
    '/* ---- 启动（必须在所有机制代码之后） ---- */',
    'mechInit();',
    'resize();',
    'requestAnimationFrame(frame);',
    '</script>',
    '</body>',
    '</html>',
    ''
  ].join('\n');

  const out = path.join(ROOT, 'public/stages', `${st.num}-${st.slug}.html`);
  fs.writeFileSync(out, html);
  n++;
  console.log(`${st.num} → public/stages/${st.num}-${st.slug}.html  ${(html.length / 1024).toFixed(1)}KB  「${title}」`);
}
console.log(`built ${n}`);
