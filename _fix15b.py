import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi15-nebula-collapse.html"
s = io.open(p, encoding="utf-8").read()
reps = [
  ("const NK = 4;", "const NK = 3;"),
  # 引力太弱 + 阻尼太强 → 3 秒过去粒子还没塌下去，只剩一团雾
  ("      const g = 90000 / (d + 60);", "      const g = 520000 / (d + 60);"),
  ("      vx[i] += ((dx / d) * g + cxv - vx[i] * 1.6) * dt;", "      vx[i] += ((dx / d) * g + cxv - vx[i] * 0.95) * dt;"),
  ("      vy[i] += ((dy / d) * g + cyv - vy[i] * 1.6) * dt;", "      vy[i] += ((dy / d) * g + cyv - vy[i] * 0.95) * dt;"),
  # 初始散开别太大，否则要塌很久
  ("    const a = rnd(0, 6.2832), rr = rnd(280, 620);", "    const a = rnd(0, 6.2832), rr = rnd(110, 300);"),
  # 烟团小一点，别糊成马赛克
  ("        const s = (1.6 + (1 - conv[i]) * 3.2) * zz[i] * (1 / NK) * 2.4;", "        const s = (1.1 + (1 - conv[i]) * 1.7) * zz[i];"),
  ("? `rgba(${Math.min(255, ar + 26)},${Math.min(255, ag2 + 20)},${Math.min(255, ab + 6)},0.30)`", "? `rgba(${Math.min(255, ar + 30)},${Math.min(255, ag2 + 26)},${Math.min(255, ab + 10)},0.42)`"),
  (": `rgba(${Math.min(255, ar - 60)},${Math.min(255, ag2 - 60)},${Math.min(255, ab - 10)},0.20)`", ": `rgba(${Math.min(255, ar - 50)},${Math.min(255, ag2 - 54)},${Math.min(255, ab - 6)},0.26)`"),
]
for a, b in reps:
    if a not in s: print("MISS:", a[:56])
    s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
