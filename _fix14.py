import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi14-supernova.html"
s = io.open(p, encoding="utf-8").read()
reps = [
  # 余辉要长得多，否则激波扫过 1 秒后字就暗没了（截图全在 2.6s 之后，只看到残灰）
  ("I = Math.exp(-dt2 / 0.045) * 1.0 + Math.exp(-dt2 / 1.15) * 0.42;",
   "I = Math.exp(-dt2 / 0.045) * 1.0 + Math.exp(-dt2 / 2.6) * 0.72;"),
  ("I = Math.exp(-(-dt2) / 0.10) * 0.06;         // 还没被扫到：极暗的底",
   "I = Math.exp(-(-dt2) / 0.10) * 0.14;         // 还没被扫到：极暗的底"),
  # 波速降一半：激波扫过整行要有 1.5~2 秒，才看得出"一圈圈点着"
  ("blastV = Math.max(W, H) * 1.05;", "blastV = Math.max(W, H) * 0.55;"),
  ("burstDebris(first ? 90 : 40, first ? 1 : 0.55);", "burstDebris(first ? 150 : 70, first ? 1.3 : 0.7);"),
  ("dlf[i] = rnd(0.4, 1.1);", "dlf[i] = rnd(0.7, 1.8);"),
]
for a, b in reps:
    if a not in s: print("MISS:", a[:52])
    s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
