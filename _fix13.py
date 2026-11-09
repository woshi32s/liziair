import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi13-accretion.html"
s = io.open(p, encoding="utf-8").read()

old = """  ctx.strokeStyle = `rgba(${Math.min(255, ar)},${Math.min(255, ag2 - 40)},${Math.min(255, ab - 60)},0.13)`;
  ctx.lineWidth = R0 * 0.55;
  ctx.beginPath(); ctx.ellipse(dcx, dcy, R0 * 1.5, R0 * 1.5 * DISK_TILT, DISK_ROT, 0, 6.2832); ctx.stroke();
  ctx.strokeStyle = `rgba(255,240,220,${(0.10 + ringPulse * 0.22).toFixed(3)})`;
  ctx.lineWidth = R0 * 0.13;
  ctx.beginPath(); ctx.ellipse(dcx, dcy, R0 * 0.72, R0 * 0.72 * DISK_TILT, DISK_ROT, 0, 6.2832); ctx.stroke();"""
new = """  /* 盘面辉光：**细环叠层**，不要用一根超粗的 ellipse 描边 ——
     那会变成一整块灰板（第一版就是这样，像盖了个盘子）。
     改成 6 条不同半径的细环，颜色从内圈暖橙到外圈暗红，alpha 很低，
     叠起来才有"炽热气体"的通透感。 */
  for (let q = 0; q < 6; q++) {
    const rr2 = R0 * (0.62 + q * 0.17);
    const hot = 1 - q / 6;
    const cr = Math.min(255, Math.round(ar * (0.7 + 0.3 * hot)));
    const cg = Math.min(255, Math.round(ag2 * (0.25 + 0.35 * hot)));
    const cb = Math.min(255, Math.round(ab * (0.2 + 0.2 * hot)));
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(0.05 + hot * 0.09 + ringPulse * hot * 0.18).toFixed(3)})`;
    ctx.lineWidth = (2.4 + hot * 3.2) * z;
    ctx.beginPath(); ctx.ellipse(dcx, dcy, rr2, rr2 * DISK_TILT, DISK_ROT, 0, 6.2832); ctx.stroke();
  }"""
assert old in s
s = s.replace(old, new)

s = s.replace("const tang = s * (1 + shear * 4.2);", "const tang = s * (1 + shear * 1.5);   // 剪切别过头，否则字读不出来")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
