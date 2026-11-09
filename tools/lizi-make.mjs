/**
 * lizi-make.mjs —— 把「通用骨架 + 机制片段」拼成一个自包含的 stage HTML。
 *
 *   node tools/lizi-make.mjs lizi17 lava-flow 熔岩冷凝 tools/mech/lizi17.js
 *
 * 产物 public/stages/lizi17-lava-flow.html 只有一个 canvas + 内联脚本，
 * 不引任何外部资源；机制片段直接定义 mechResize / mechAssign / mechUpdate / mechDraw。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/DSHdesktop/work/music-player';
const [id, short, title, mechPath] = process.argv.slice(2);
if (!id || !short || !title || !mechPath) {
  console.error('用法: node tools/lizi-make.mjs <id> <short> <中文名> <机制文件>');
  process.exit(1);
}
const base = fs.readFileSync(path.join(ROOT, 'tools/lizi-base.js'), 'utf8');
const mech = fs.readFileSync(mechPath, 'utf8');
const out = path.join(ROOT, 'public/stages', `${id}-${short}.html`);

const head = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
  html,body{margin:0;height:100%;background:#05070b;overflow:hidden}
  #c{position:fixed;inset:0;width:100%;height:100%;display:block}
  #vig{position:fixed;inset:0;z-index:7;pointer-events:none;
    background:radial-gradient(118% 96% at 50% 46%,transparent 34%,rgba(3,5,10,.52) 74%,rgba(1,2,5,.95))}
  #hint{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9;
        font:500 11px/1.5 ui-monospace,Consolas,monospace;
        color:rgba(198,210,235,.30);letter-spacing:.08em;pointer-events:none;transition:opacity .6s}
</style>
</head>
<body data-chrome="off">
<canvas id="c"></canvas>
<div id="vig"></div>
<div id="hint">等待第一句…</div>
<script>
`;

const tail = `
/* 启动必须在机制片段之后：机制里的 const/let 在此之前还处于暂时性死区 */
resize();
requestAnimationFrame(frame);
</script>
</body>
</html>
`;

const html = (head + base + '\n/* ===== MECH · ' + title + ' ===== */\n' + mech + tail)
  .replace('__TITLE__', title);

fs.writeFileSync(out, html);
console.log('wrote ' + out + '  (' + Math.round(html.length / 1024) + ' KB)');
