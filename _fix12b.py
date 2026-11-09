import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi12-lensing.html"
s = io.open(p, encoding="utf-8").read()
reps = [
  ('`rgba(${Math.min(255, ar - 70)},${Math.min(255, ag2 - 60)},${Math.min(255, ab - 20)},0.30)`',
   '`rgba(${Math.min(255, ar - 40)},${Math.min(255, ag2 - 30)},${Math.min(255, ab + 4)},0.55)`'),
  ('`rgba(${Math.min(255, ar - 20)},${Math.min(255, ag2 - 10)},${Math.min(255, ab + 6)},0.60)`',
   '`rgba(${Math.min(255, ar + 10)},${Math.min(255, ag2 + 14)},${Math.min(255, ab + 22)},0.92)`'),
  ('const s = ssz[i] * (1 + near * 1.6) * z;', 'const s = ssz[i] * 1.5 * (1 + near * 2.2) * z;'),
  ('const tang = s * (1 + bend * 2.4);', 'const tang = s * (1 + bend * 1.15);'),
  ('const RE2 = Math.max(400, RE * RE) * 0.42;', 'const RE2 = Math.max(400, RE * RE) * 0.62;'),
  ('ctx.lineWidth = 2.2;', 'ctx.lineWidth = 2.8;'),
]
for a, b in reps:
    if a not in s: print("MISS:", a[:52])
    s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
