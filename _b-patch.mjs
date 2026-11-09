import fs from "node:fs";
/* 暂停时把"过渡类"状态直接钉死：settle 归位、kick 清零 → 2D 层逐像素稳定 */
for (const p of ["_b-tpl.html", "public/stages/210-paper-deboss.html"]) {
  let s = fs.readFileSync(p, "utf8");
  const a = "  kick *= Math.exp(-dt * 3.2);";
  if (!s.includes(a)) { console.error("MISS kick " + p); process.exit(1); }
  s = s.split(a).join(a + "\n  /* 暂停：不收尾的过渡（settle/kick）会让画面在暂停时继续微动 —— 直接钉死 */\n  if (!playing) { settle = 1; kick = 0; }");
  fs.writeFileSync(p, s);
}
console.log("patched");
