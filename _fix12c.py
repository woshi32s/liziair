import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi12-lensing.html"
s = io.open(p, encoding="utf-8").read()
reps = [
  ("const near = Math.exp(-Math.pow((r - RE) / (RE * 0.16 + 1), 2));",
   "/* 环上的星被\"堆\"住 → 更亮更密。核宽必须够大，否则只有极少数星落到环上，环看起来是条空线。 */\n      const near = Math.exp(-Math.pow((r - RE) / (RE * 0.30 + 1), 2));"),
  ("const b = sbr[i] * (0.55 + near * 1.5);", "const b = sbr[i] * (0.62 + near * 2.4);"),
  ("const bnd = b > 1.0 ? 2 : b > 0.55 ? 1 : 0;", "const bnd = b > 1.15 ? 2 : b > 0.62 ? 1 : 0;"),
  ("const s = ssz[i] * 1.5 * (1 + near * 2.2) * z;", "const s = ssz[i] * 1.9 * (1 + near * 2.6) * z;"),
  ("const NS = 2600;", "const NS = 4200;"),
]
for a, b in reps:
    if a not in s: print("MISS:", a[:52])
    s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
