/**
 * _c-build.mjs —— C 组 226-229 拼装器
 * 每个形态 = 共享内核（_c-core.js，含协议/排版/预烘/时钟/四条纪律）+ 机制体（_c-<NNN>.js）
 * 产物是**单文件自包含 HTML**，不引任何外部资源。
 * 用法：node _c-build.mjs [226]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const CORE = fs.readFileSync(path.join(ROOT, '_c-core.js'), 'utf8');

const STAGES = [
  { num: '226', slug: 'gravity-lens' },
  { num: '227', slug: 'vortex-tube' },
  { num: '228', slug: 'iso-voxel' },
  { num: '229', slug: 'shadow-room' }
];

const only = process.argv[2] || '';

const CSS = [
  'html,body{margin:0;height:100%;background:#04060b;overflow:hidden}',
  '#c{position:fixed;inset:0;width:100%;height:100%;display:block}',
  '#hint{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);',
  '      font:500 11px/1.6 ui-monospace,Consolas,monospace;color:rgba(150,190,255,.26);',
  '      letter-spacing:.16em;pointer-events:none;transition:opacity .6s;white-space:nowrap}'
].join('\n  ');

for (const st of STAGES) {
  if (only && st.num !== only) continue;
  const bodyPath = path.join(ROOT, `_c-${st.num}.js`);
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
    '<div id="hint">等待第一句…</div>',
    '<script>',
    '"use strict";',
    meta[0],
    CORE,
    body,
    'boot();',
    '</script>',
    '</body>',
    '</html>',
    ''
  ].join('\n');

  const out = path.join(ROOT, 'public/stages', `${st.num}-${st.slug}.html`);
  fs.writeFileSync(out, html);
  console.log(`${st.num} → public/stages/${st.num}-${st.slug}.html  ${(html.length / 1024).toFixed(1)}KB  「${title}」`);
}
