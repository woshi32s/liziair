import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi07-boids-sweep.html"
s = io.open(p, encoding="utf-8").read()
old = """  const projX = (x, y, pz) => ex + (x - cam.x) * z * pz;
  const projY = (x, y, pz) => ey + (y - cam.y) * z * pz;"""
new = """  /* 透视只作用在"大小 / 亮度 / 拖尾长度"上，**不能**作用在位置上。
     一开始把位置也乘了 1/(1+dep)，结果每只鸟按自己的深度朝画面中心缩不同比例 ——
     字形被彻底打散，看起来就是一团鸟云而不是字（这是这个形态最大的一个坑）。
     位置保持共面，纵深交给尺寸和亮度表达，字才读得出来。 */
  const projX = (x) => ex + (x - cam.x) * z;
  const projY = (y) => ey + (y - cam.y) * z;"""
assert old in s
s = s.replace(old, new)
s = s.replace("const sx = projX(bx[i], by[i], dq), sy = projY(bx[i], by[i], dq);", "const sx = projX(bx[i]), sy = projY(by[i]);")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
