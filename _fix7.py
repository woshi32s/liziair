import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi07-boids-sweep.html"
s = io.open(p, encoding="utf-8").read()
reps = [
  ("  brad[i] = rnd(5, 26);", "  brad[i] = rnd(1.6, 5.5);   // 盘旋半径必须远小于笔画宽度，否则整团糊成鸟云、字读不出来"),
  ("  bspd[i] = rnd(90, 210);", "  bspd[i] = rnd(34, 86);"),
  ("      const nz1 = Math.sin(T0 * 3.1 + bph[i] * 7.3) * (24 + sc * 320);", "      const nz1 = Math.sin(T0 * 3.1 + bph[i] * 7.3) * (9 + sc * 300);"),
  ("      const nz2 = Math.cos(T0 * 2.7 + bph[i] * 5.1) * (24 + sc * 320);", "      const nz2 = Math.cos(T0 * 2.7 + bph[i] * 5.1) * (9 + sc * 300);"),
  ("      const rr = brad[i] * (1 + sc * 3.2) * px2;", "      const rr = brad[i] * (1 + sc * 1.6);"),
]
for a, b in reps:
    if a not in s: print("MISS:", a[:56])
    s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
