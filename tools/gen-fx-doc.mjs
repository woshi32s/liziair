/**
 * tools/gen-fx-doc.mjs —— 从 public/fx-lab.html 里解析出 66 个特效，生成 FX-LIBRARY.md（带编号）。
 *   node tools/gen-fx-doc.mjs
 * 编号规则：按 `add()` 出现顺序，两位数字 01..NN，永远不要重排（新效果只能往末尾加）。
 */
import fs from 'node:fs';

const ROOT = 'E:/DSHdesktop/work/music-player';
const html = fs.readFileSync(ROOT + '/public/fx-lab.html', 'utf8');
const s = html.indexOf('<script>'), e = html.lastIndexOf('</script>');
const js = html.slice(s + 8, e);

const re = /add\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g;
const items = [];
let m;
while ((m = re.exec(js))) {
  const tail = js.slice(m.index, m.index + 4000);
  const next = tail.indexOf('\nadd(');
  const body = next > 0 ? tail.slice(0, next) : tail;
  items.push({ cat: m[1], id: m[2], name: m[3], note: m[4], webgl: /,\s*true\);/.test(body) });
}
items.forEach((it, i) => { it.no = String(i + 1).padStart(2, '0'); });

/* 鼓点/切句友好清单（按 id） */
const BEAT = new Set(['shake-dir', 'shake-burst', 'shake-vertical', 'shake-zoom', 'flash-white', 'flash-neg',
  'flash-bloom', 'flash-strobe', 'impact-ring', 'blur-zoom', 'glitch-slice', 'glitch-rgb', 'shake-hi', 'shake-jump']);
const LINE = new Set(['tr-fade', 'tr-zoom', 'tr-slide', 'tr-wipe', 'tr-pixel', 'tr-glitch', 'tr-iris', 'tr-wind', 'tr-crosswarp', 'tr-roll']);

const cats = [...new Set(items.map((i) => i.cat))];
let out = `# FX 特效库 · 编号表

> 台账文件。**编号是稳定契约**：` + '`FX01`~`FX' + items.length + '` 按添加顺序固定，**永远不要重排、不要复用**；' + `
> 新效果只能往末尾追加（编号接着往后排）。
> 试片台：\`http://127.0.0.1:<.port>/fx-lab.html?fx=FX07\`（深链支持编号，也支持 id）
> 生成方式：\`node tools/gen-fx-doc.mjs\`（从 \`public/fx-lab.html\` 解析，别手改这张表）

## 怎么调用

| 场景 | 写法 |
|---|---|
| 规则表里 | \`{ "when": "onDownbeat", "fx": "FX18", "amp": 0.9 }\` |
| 代码里 | \`fxLab.run('FX18', ctx, t, amp)\`（接入后）或直接抄 \`fx-lab.html\` 里对应 \`add()\` 的 draw 体 |
| 试片台深链 | \`fx-lab.html?fx=FX18\` |

**画质列**：\`canvas\` = 纯 Canvas 2D 真实现；\`webgl\` = Canvas 2D 只能近似，要"剪映级"得上 WebGL 后处理（见 HANDOFF §7）。
**鼓点/切句**：★ = 适合挂 \`onBeat / onDownbeat / onLineEnd\`。

`;

for (const cat of cats) {
  const list = items.filter((i) => i.cat === cat);
  out += `## ${cat}（${list.length} 个）\n\n`;
  out += '| 编号 | id | 名称 | 说明 | 画质 | 鼓点/切句 |\n|---|---|---|---|---|---|\n';
  for (const it of list) {
    const mark = [...BEAT].includes(it.id) ? '★ 鼓点' : LINE.has(it.id) ? '★ 切句' : '';
    out += `| **FX${it.no}** | \`${it.id}\` | ${it.name} | ${it.note} | ${it.webgl ? 'webgl' : 'canvas'} | ${mark} |\n`;
  }
  out += '\n';
}

out += `## 鼓点系统对接建议（2026-10-28）

- **每拍**（\`onBeat\`）：FX10 竖向鼓点震（轻）/ FX03 高频颗粒抖（弱拍）
- **小节首拍**（\`onDownbeat\`）：FX01 定向冲击震 + FX11 白闪、或 FX18 冲击环 + FX19 变焦模糊
- **每 4/8 拍**：FX06 爆震 / FX15 泛光爆闪
- **这句唱完**（\`onLineEnd\`）：FX41-FX50 任选一个转场（推荐 FX46 故障切、FX42 缩放切、FX50 滚动切）
- **常驻氛围**（always）：FX51 胶片颗粒、FX52 暗角（都很便宜）
`;

fs.writeFileSync(ROOT + '/FX-LIBRARY.md', out, 'utf8');
console.log('wrote FX-LIBRARY.md:', items.length, 'effects');
console.log(items.map((i) => i.no + ':' + i.id).join(' '));
