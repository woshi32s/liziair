import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi15-nebula-collapse.html"
s = io.open(p, encoding="utf-8").read()
old = """      vx[i] += ((dx / d) * g + cxv - vx[i] * 0.95) * dt;
      vy[i] += ((dy / d) * g + cyv - vy[i] * 0.95) * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt;"""
new = """      /* 靠近落点时阻尼必须**急剧变大**，否则粒子会以 2000px/s 冲过目标、
         在目标两侧来回振荡，整团永远塌不成字（这是这一版最重要的一个修正）。
         再加一个速度上限：一帧 16ms，速度超过 900 就会一步跳过落点。 */
      const damp = d < 70 ? 9.0 : 1.1;
      vx[i] += ((dx / d) * g + cxv - vx[i] * damp) * dt;
      vy[i] += ((dy / d) * g + cyv - vy[i] * damp) * dt;
      const sp2 = Math.hypot(vx[i], vy[i]);
      if (sp2 > 900) { vx[i] *= 900 / sp2; vy[i] *= 900 / sp2; }
      px[i] += vx[i] * dt; py[i] += vy[i] * dt;"""
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
