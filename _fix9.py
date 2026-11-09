import io
p = r"E:\DSHdesktop\work\music-player\public\stages\lizi09-caustics.html"
s = io.open(p, encoding="utf-8").read()
old = "        const vv = Math.abs(I) * (0.45 + 0.85 * lit);"
new = """        /* 加一个亮度地板：纯 sin 乘积在波谷处会把点压到全黑，字就被"闪断"了。
           垫 0.17 的底，字始终在，只是波谷处更暗 —— 读得出，又保住了焦散的明暗流动。 */
        const vv = 0.17 + Math.abs(I) * (0.45 + 0.85 * lit);"""
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
