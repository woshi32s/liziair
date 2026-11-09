import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi10-crt-beam.html"
s = io.open(p, encoding="utf-8").read()
reps = [
  ("const PK = 2;                                    // 荧光层降采样",
   "const PK = 1;   // 荧光层**不**降采样：半分辨率再放大时，细笔画会被插值拉出纵向重影，字读不清"),
  ('<div id="crt"></div>', '<div id="crt"></div>'),
  ("opacity:.5;\n       background:repeating-linear-gradient(180deg,rgba(0,0,0,.34) 0 1px,rgba(0,0,0,0) 1px 3px)",
   "opacity:.34;\n       background:repeating-linear-gradient(180deg,rgba(0,0,0,.30) 0 1px,rgba(0,0,0,0) 1px 4px)"),
  ("      const s = lit ? 3.0 : 2.3;", "      const s = lit ? 2.6 : 2.0;"),
]
for a, b in reps:
    if a not in s: print("MISS:", a[:50].replace("\n", "\\n"))
    s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
