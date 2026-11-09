import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi10-crt-beam.html"
s = io.open(p, encoding="utf-8").read()
reps = [
  ("    pctx.fillStyle = 'rgba(0,0,0,0.020)';", "    pctx.fillStyle = 'rgba(0,0,0,0.010)';   // 余辉要够久，否则写完就看不见了"),
  ("? `rgba(${Math.min(255, accent[0] + 40)},${Math.min(255, accent[1] + 10)},${Math.min(255, accent[2] + 20)},0.95)`",
   "? `rgba(${Math.min(255, accent[0] + 40)},${Math.min(255, accent[1] + 10)},${Math.min(255, accent[2] + 20)},1)`"),
  ("const s = lit ? 2.6 : 2.0;", "const s = lit ? 3.0 : 2.3;"),
]
for a, b in reps:
    if a not in s: print("MISS:", a[:50])
    s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
