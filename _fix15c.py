import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi15-nebula-collapse.html"
s = io.open(p, encoding="utf-8").read()
start = s.find("  /* 烟层：半分辨率画小方块，放大插值成雾 */")
end = s.find("  /* 归位的粒子：亮一点的核（字从这里读出来） */")
assert start > 0 and end > start
new = """  /* 星云本体：**全分辨率小点**，两遍（散开的暗 / 归位的亮）。
     一开始我用了"半分辨率画方块再放大"想做体积雾，结果放大后是明显的马赛克方块，
     完全不像雾。这个形态的粒子本来就密，直接全分辨率画小点反而干净、也读得清字。 */
  ctx.globalCompositeOperation = 'lighter';
  for (let band = 0; band < 2; band++) {
    const hot = !!band;
    ctx.fillStyle = hot
      ? `rgba(${Math.min(255, ar + 20)},${Math.min(255, ag2 + 16)},${Math.min(255, ab + 8)},0.55)`
      : `rgba(${Math.min(255, ar - 56)},${Math.min(255, ag2 - 58)},${Math.min(255, ab - 6)},0.30)`;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (ci[i] < 0) continue;
      if ((conv[i] > 0.45) !== hot) continue;
      const sx = (px[i] - cam.x) * z + W / 2 + shx;
      const sy = (py[i] - cam.y) * z + H / 2 + shy;
      if (sx < -6 || sx > W + 6 || sy < -6 || sy > H + 6) continue;
      const s = (hot ? 1.7 : 2.6) * zz[i] * z;
      ctx.rect(sx - s * 0.5, sy - s * 0.5, s, s);
    }
    ctx.fill();
  }

"""
s = s[:start] + new + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
