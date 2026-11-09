import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi12-lensing.html"
s = io.open(p, encoding="utf-8").read()

# 1) 投影改成相对相机（原来相对透镜中心 → 整行字被推歪出画）
old = """  const pjX = (x, y) => { const dx = (x - lensX) * z, dy = (y - lensY) * z; return W / 2 + cam.shx + dx * cosR - dy * sinR; };
  const pjY = (x, y) => { const dx = (x - lensX) * z, dy = (y - lensY) * z; return H / 2 + cam.shy + dx * sinR + dy * cosR; };"""
new = """  /* 投影必须相对**相机**，不能相对透镜中心。
     相对透镜中心的话，正在唱的那个字永远在屏幕正中，整行字的其余部分就被推到画外了
     （这是这个形态第一版的样子：只有半个词在画面上）。 */
  const pjX = (x, y) => { const dx = (x - cam.x) * z, dy = (y - cam.y) * z; return W / 2 + cam.shx + dx * cosR - dy * sinR; };
  const pjY = (x, y) => { const dx = (x - cam.x) * z, dy = (y - cam.y) * z; return H / 2 + cam.shy + dx * sinR + dy * cosR; };"""
assert old in s
s = s.replace(old, new)

# 2) 相机跟随（轻微，0.25 幅度）
old2 = """  cam.tz = 1.02 + Math.sin(T0 * 0.14) * 0.02;
  camUpdate(dtReal, T0);"""
new2 = """  cam.tx = W / 2 + (lensX - W / 2) * 0.25;
  cam.ty = H / 2 + (lensY - H / 2) * 0.25;
  cam.tz = 1.02 + Math.sin(T0 * 0.14) * 0.02;
  camUpdate(dtReal, T0);"""
assert old2 in s
s = s.replace(old2, new2)

# cam 补 tx/ty 字段
s = s.replace("const cam = { x: 0, y: 0, z: 1, tz: 1, vz: 0, sh: 0, dirx: 0, diry: 0, shx: 0, shy: 0, rot: 0, vrot: 0 };",
              "const cam = { x: 0, y: 0, tx: 0, ty: 0, z: 1, tz: 1, vz: 0, sh: 0, dirx: 0, diry: 0, shx: 0, shy: 0, rot: 0, vrot: 0 };")
s = s.replace("""  cam.x += (W / 2 - cam.x) * ke;
  cam.y += (H / 2 - cam.y) * ke;""",
              """  cam.x += ((cam.tx || W / 2) - cam.x) * ke;
  cam.y += ((cam.ty || H / 2) - cam.y) * ke;""")

# 3) 环画在透镜的真实屏幕位置（原来画在屏幕中心）
old3 = """  const lx2 = pjX(lensX, lensY), ly2 = pjY(lensY, lensY);
  const cx2 = W / 2 + cam.shx, cy2 = H / 2 + cam.shy;
  const rr = RE * z;"""
new3 = """  const cx2 = pjX(lensX, lensY), cy2 = pjY(lensX, lensY);
  const rr = RE * z;"""
assert old3 in s
s = s.replace(old3, new3)

# 4) 偏折别太狠（原来 RE² 把大片星推光，画面空了），星也加多点
s = s.replace("const RE2 = Math.max(400, RE * RE);", "const RE2 = Math.max(400, RE * RE) * 0.42;   // 偏折强度：全量会把画面推空")
s = s.replace("const NS = 1500;", "const NS = 2600;")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
