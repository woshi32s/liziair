import fs from "node:fs";
let s = fs.readFileSync("public/stages/210-paper-deboss.html", "utf8");
const cut = (start, end, repl, label) => {
  const i = s.indexOf(start);
  if (i < 0) throw new Error("no start " + label);
  const j = s.indexOf(end, i);
  if (j < 0) throw new Error("no end " + label);
  s = s.slice(0, i) + repl + s.slice(j + end.length);
};
/* 头部说明 */
cut("/* ============================================================================",
    "   ========================================================================== */",
    "/* ============================================================================\n__DOC__\n   ========================================================================== */", "doc");
/* 标题 */
s = s.replace("<title>纸浆压凸</title>", "<title>__TITLE__</title>");
/* 着色器 */
cut("const FS = [", "].join('\\n');", "const FS = __FS__;", "fs");
/* 凸版烘焙 */
cut("function bakePlate(L) {", "  return { cv: plateCv, w: pw, h: ph };\n}",
`function bakePlate(L) {
  const fs = L.fs;
  const d = plateDims(L);
  const pw = d.pw, ph = d.ph;
  const plateCv = document.createElement('canvas');
  plateCv.width = pw; plateCv.height = ph;
  const g = plateCv.getContext('2d');
  g.clearRect(0, 0, pw, ph);
  g.font = fontStr(fs);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cx = pw / 2, cy = ph / 2;
__PLATE__
  return { cv: plateCv, w: pw, h: ph };
}`, "plate");
/* 2D 尾段：加一个 stagePost 钩子（在颗粒/暗角之前） */
s = s.replace("  if (grainPat) {", "__POST__\n  if (grainPat) {");
/* 强调色默认值 + 混合模式 */
s = s.replace("let accent = [0.95, 0.88, 0.76];",
  "let accent = __ACCBASE__;\nconst ST = { fibers: __FIBERS__, motes: __MOTES__, plateBlend: '__PLATEBLEND__', plateAlpha: __PLATEALPHA__ };");
/* 凸版按 ST 的混合模式画 */
s = s.replace(`    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(plate.cv, W / 2 - plate.w / 2, cy - plate.h / 2 + drop, plate.w, plate.h);`,
`    ctx.globalCompositeOperation = ST.plateBlend;
    ctx.globalAlpha = ST.plateAlpha;
    ctx.drawImage(plate.cv, W / 2 - plate.w / 2, cy - plate.h / 2 + drop, plate.w, plate.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';`);
/* 纤维/纸屑开关 */
s = s.replace("  if (gl && fibCv.width > 1) {", "  if (ST.fibers && gl && fibCv.width > 1) {");
s = s.replace("  if (hasLine && gl) {\n    ctx.globalCompositeOperation = 'lighter';\n    const sp = rm ? 0.25 : 1;", "  if (ST.motes && hasLine && gl) {\n    ctx.globalCompositeOperation = 'lighter';\n    const sp = rm ? 0.25 : 1;");
fs.writeFileSync("_b-tpl.html", s);
console.log("template written", s.length);
