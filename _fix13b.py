import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi13-accretion.html"
s = io.open(p, encoding="utf-8").read()
s = s.replace("const tang = s * (1 + shear * 1.5);   // 剪切别过头，否则字读不出来",
              "const tang = s * (1 + shear * 0.85);  // 剪切要能看出\"被拉成弧\"，但不能拉到自己都认不出")
s = s.replace("        const s = 1.7 * z;", "        const s = 2.0 * z;")
s = s.replace("? `rgba(${Math.min(255, ar + 34)},${Math.min(255, ag2 + 6)},${Math.min(255, ab - 18)},0.95)`",
              "? `rgba(${Math.min(255, ar + 30)},${Math.min(255, ag2 + 30)},${Math.min(255, ab + 10)},1)`")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
