import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi12-lensing.html"
s = io.open(p, encoding="utf-8").read()

old_init = """for (let i = 0; i < NS; i++) {
  sx0[i] = rnd(-0.12, 1.12) * W; sy0[i] = rnd(-0.12, 1.12) * H;
  sdep[i] = rnd(0.35, 1.0);         // 视差深度（近星偏折更明显？不：远星偏折更明显，这里当视觉层）
  sbr[i] = rnd(0.25, 1);
  ssz[i] = rnd(0.8, 2.2);
}"""
new_init = """/* ⚠ 星场必须在 resize() 之后初始化：
   模块顶层执行时 W/H 还是 0，rnd()*0 会让所有星全落在世界原点，
   画面上一颗星都看不到（lizi04 的板画布踩的是同一类坑）。
   这条也适用于任何"用 W/H 预先撒点"的数组。 */
function initStars() {
  if (!W || !H) return;
  for (let i = 0; i < NS; i++) {
    sx0[i] = rnd(-0.12, 1.12) * W; sy0[i] = rnd(-0.12, 1.12) * H;
    sdep[i] = rnd(0.35, 1.0);
    sbr[i] = rnd(0.25, 1);
    ssz[i] = rnd(0.8, 2.2);
  }
}"""
assert old_init in s
s = s.replace(old_init, new_init)

s = s.replace("""  buildBg();
  if (L && curIdx >= 0) assignLine(curIdx);""",
"""  buildBg();
  initStars();
  if (L && curIdx >= 0) assignLine(curIdx);""")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
