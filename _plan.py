import io, re
p = r"E:\DSHdesktop\work\music-player\LIZI-PLAN.md"
s = io.open(p, encoding="utf-8").read()
s = s.replace("| 15 | 星云坍缩 | nebula |", "| ✅15 | 星云坍缩 | nebula-collapse |")
s = re.sub(r"(?m)^> 进度：.*$", "> 进度：✅ 已完成并验收 = 01-04 / 06-15（共 14 个，均已注册进播放器，`?stage=lizi01` 可直接看）。⚠ 05 有结构 bug，已改名 `_wip-lizi05-ferrofluid.html` 不注册。下一步：16 潮汐水痕。", s)
io.open(p, "w", encoding="utf-8").write(s)
print("plan ok")
