import io, re
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi06-ant-pheromone.html"
s = io.open(p, encoding="utf-8").read()
start = s.find('/* 先在"地面"上铺一层')
if start < 0:
    start = s.find('信息素底')
end = s.find('cam.tz = 1.06;', start)
assert start > 0 and end > start, (start, end)
new_block = '''/* 信息素底色层：把字形采样点铺成一层"旧路"。
     为什么必须有这一层：380 只蚁盖不满 5000 个采样点，覆盖率不到一成，
     只靠蚁走出来的路字根本读不出来（第一版就是一片横着糊掉的拖影）。
     铺底之后字从一开始就在，蚁的作用是沿着笔画把它踩亮 —— 这也更像真实的蚁路。
     这一层必须画进 bctx（不褪色那张），画进 gctx 会被 destination-out 很快擦掉。 */
  if (bctx) {
    bctx.clearRect(0, 0, GW, GH);
    bctx.globalCompositeOperation = 'lighter';
    bctx.fillStyle = 'rgba(' + Math.min(255, accent[0] - 8) + ',' + Math.min(255, accent[1] - 24) + ',' + Math.min(255, accent[2] - 38) + ',0.6)';
    bctx.beginPath();
    for (let k = 0; k < g.pc; k++) {
      const gx2 = (blockGx + g.px[k]) / GK, gy2 = (blockGy + g.py[k]) / GK;
      bctx.rect(gx2 - 1.4, gy2 - 1.4, 2.9, 2.9);
    }
    bctx.fill();
    bctx.globalCompositeOperation = 'source-over';
  }
  if (gctx) gctx.clearRect(0, 0, GW, GH);
  '''
s = s[:start] + new_block + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("patched")
