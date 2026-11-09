import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi15-nebula-collapse.html"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""  buildBg();
  if (L && curIdx >= 0) assignLine(curIdx);""",
"""  buildBg();
  initNeb();                 // 必须在 W/H 就绪之后撒点（否则全落在 0,0，画面全黑）
  if (L && curIdx >= 0) assignLine(curIdx);""")
# 顶层那次调用现在没意义，留着也安全；但为了明确，去掉它
s = s.replace("""initNeb();
resize();""", """resize();""")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
