import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi12-lensing.html"
s = io.open(p, encoding="utf-8").read()
start = s.find("  /* ① 被透镜弯折的星场")
end = s.find("  /* ② 爱因斯坦环本体")
assert start > 0 and end > start
new = """  /* ① 被透镜弯折的星场：r' = r + RE²/r（点质量薄透镜）
     只画两批：普通星 / 环上的亮星。之前用"按亮度分 3 档 + 条件筛"，
     结果绝大多数星都掉进最暗那档、在画面上等于没有（判据边界把它全滤掉了）。
     两批直白地画，肉眼一定看得见。 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(${Math.min(255, ar - 20)},${Math.min(255, ag2 - 6)},${Math.min(255, ab + 16)},0.72)`;
  ctx.beginPath();
  for (let i = 0; i < NS; i++) {
    const dx = sx0[i] - lensX, dy = sy0[i] - lensY;
    const r = Math.sqrt(dx * dx + dy * dy) + 1;
    const rp = r + RE2 / r;
    const k2 = rp / r;
    const px2 = pjX(lensX + dx * k2, lensY + dy * k2);
    const py2 = pjY(lensX + dx * k2, lensY + dy * k2);
    if (px2 < -6 || px2 > W + 6 || py2 < -6 || py2 > H + 6) continue;
    const s = ssz[i] * 1.7 * z;
    ctx.rect(px2 - s * 0.5, py2 - s * 0.5, s, s);
  }
  ctx.fill();

  /* 环上的星被"堆"住 → 更亮更大的一批白星，爱因斯坦环才真的有厚度 */
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  for (let i = 0; i < NS; i++) {
    const dx = sx0[i] - lensX, dy = sy0[i] - lensY;
    const r = Math.sqrt(dx * dx + dy * dy) + 1;
    const near = Math.exp(-Math.pow((r - RE) / (RE * 0.30 + 1), 2));
    if (near < 0.25) continue;
    const rp = r + RE2 / r;
    const k2 = rp / r;
    const px2 = pjX(lensX + dx * k2, lensY + dy * k2);
    const py2 = pjY(lensX + dx * k2, lensY + dy * k2);
    if (px2 < -8 || px2 > W + 8 || py2 < -8 || py2 > H + 8) continue;
    const s = ssz[i] * (1.6 + near * 2.6) * z;
    ctx.rect(px2 - s * 0.5, py2 - s * 0.5, s, s);
  }
  ctx.fill();

"""
s = s[:start] + new + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
