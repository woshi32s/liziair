import sys
from collections import Counter
from PIL import Image
p = sys.argv[1] if len(sys.argv) > 1 else "shots/review/p300-A-239-r2.png"
im = Image.open(p).convert("RGB").resize((360, 225), Image.LANCZOS)
px = list(im.getdata())
N = len(px)
cnt = Counter(((r >> 4, g >> 4, b >> 4) for r, g, b in px))
(bk, bn) = cnt.most_common(1)[0]
br, bg, bb = (bk[0] << 4) + 8, (bk[1] << 4) + 8, (bk[2] << 4) + 8
d = [abs(r - br) + abs(g - bg) + abs(b - bb) for r, g, b in px]
lum = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in px]
bl = sorted(lum[i] for i in range(N) if d[i] < 36)
ik = sorted(lum[i] for i in range(N) if d[i] > 150)


def q(a, t):
    return a[min(len(a) - 1, int(len(a) * t))] if a else 0.0


print(p)
print("modal", (br, bg, bb), "frac", round(bn / N, 3), "blank", round(len(bl) / N, 3), "ink", round(len(ik) / N, 3))
print("contrast", round(q(ik, 0.90) / max(1e-3, q(bl, 0.50)), 2),
      "inkP90", round(q(ik, 0.90), 1), "blankMed", round(q(bl, 0.50), 1),
      "inkP50", round(q(ik, 0.50), 1), "inkP99", round(q(ik, 0.99), 1))
ys = [i // 360 for i in range(N) if d[i] > 150]
if ys:
    print("ink rows", min(ys), max(ys), "span", round((max(ys) - min(ys)) / 225, 3))
print("top buckets:", [(k, round(v / N, 3)) for k, v in cnt.most_common(8)])
lum.sort()
print("lum p10,p50,p90,p99,max:", [round(lum[int(N * t)], 1) for t in (0.1, 0.5, 0.9, 0.99)], round(lum[-1], 1))
