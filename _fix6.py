import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi06-ant-pheromone.html"
s = io.open(p, encoding="utf-8").read()
reps = [
  ("${Math.min(255, accent[0] - 46)},${Math.min(255, accent[1] - 64)},${Math.min(255, accent[2] - 64)},0.30",
   "${Math.min(255, accent[0] - 10)},${Math.min(255, accent[1] - 26)},${Math.min(255, accent[2] - 40)},0.62"),
  ("bctx.rect(gx2 - 1.1, gy2 - 1.1, 2.4, 2.4);", "bctx.rect(gx2 - 1.4, gy2 - 1.4, 2.9, 2.9);"),
  ("${Math.min(255, accent[0] + 20)},${Math.min(255, accent[1] + 8)},${Math.min(255, accent[2] - 20)},0.26",
   "${Math.min(255, accent[0] + 30)},${Math.min(255, accent[1] + 16)},${Math.min(255, accent[2] - 10)},0.48"),
  ("${Math.min(255, accent[0] - 40)},${Math.min(255, accent[1] - 52)},${Math.min(255, accent[2] - 46)},0.14",
   "${Math.min(255, accent[0] - 26)},${Math.min(255, accent[1] - 38)},${Math.min(255, accent[2] - 40)},0.24"),
  ("gctx.lineWidth = band ? 1.5 : 1.1;", "gctx.lineWidth = band ? 2.1 : 1.5;"),
  ("rgba(255,240,210,0.85)", "rgba(255,244,220,0.34)"),
  ("ctx.rect(sx - 1, sy - 1, 2.2, 2.2);", "ctx.rect(sx - 0.8, sy - 0.8, 1.8, 1.8);"),
]
for a, b in reps:
    if a not in s: print("MISS:", a[:52])
    s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("done")
