import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi07-boids-sweep.html"
s = io.open(p, encoding="utf-8").read()
old = """      const ph = bph[i] + T0 * (1.4 + sc * 5.5);"""
new = """      /* 盘旋角速度要够快：鸟是"追着一个绕圈的落点"，落点跑得慢于鸟的速度时，
         鸟会一直落在目标后面 v/ω 的距离上 —— ω=1.4 时滞后 40+px，
         整行字就被这一圈滞后糊成鸟云了。ω 提到 2.4 起，滞后降到十几像素内。 */
      const ph = bph[i] + T0 * (2.4 + sc * 6.5);"""
assert old in s
s = s.replace(old, new)

old2 = """      const dx = wx2 - bx[i], dy = wy2 - by[i];
      const dl = Math.hypot(dx, dy) || 1;
      const want = bspd[i] * px2 * (1 + sc * 2.2);
      const nz1 = Math.sin(T0 * 3.1 + bph[i] * 7.3) * (9 + sc * 300);
      const nz2 = Math.cos(T0 * 2.7 + bph[i] * 5.1) * (9 + sc * 300);
      bvx[i] += ((dx / dl) * want + nz1 - bvx[i]) * Math.min(1, dt * 7.5);
      bvy[i] += ((dy / dl) * want + nz2 - bvy[i]) * Math.min(1, dt * 7.5);"""
new2 = """      const dx = wx2 - bx[i], dy = wy2 - by[i];
      /* 用**硬弹簧**追落点，而不是"朝方向匀速飞"。
         匀速追的时候鸟永远追不上一个绕圈的落点，会拖出一条尾巴把字糊掉。
         弹簧是位置约束：落点在哪鸟就在哪，只保留一点点冲过头的手感。 */
      const nz1 = Math.sin(T0 * 5.1 + bph[i] * 7.3) * (6 + sc * 260);
      const nz2 = Math.cos(T0 * 4.7 + bph[i] * 5.1) * (6 + sc * 260);
      bvx[i] += (dx * (150 - sc * 90) + nz1 - bvx[i] * (16 - sc * 6)) * dt;
      bvy[i] += (dy * (150 - sc * 90) + nz2 - bvy[i] * (16 - sc * 6)) * dt;
      if (bvx[i] > 700) bvx[i] = 700; else if (bvx[i] < -700) bvx[i] = -700;
      if (bvy[i] > 700) bvy[i] = 700; else if (bvy[i] < -700) bvy[i] = -700;"""
assert old2 in s
s = s.replace(old2, new2)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
