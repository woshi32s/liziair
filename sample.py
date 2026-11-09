from PIL import Image
import glob, os
pts = [("左上", 120, 120), ("中上", 720, 120), ("正中", 720, 405), ("右下", 1300, 640), ("左下", 120, 640)]
print(f'{"帧":<10}' + ''.join(f'{n:<22}' for n,_,_ in pts))
for f in sorted(glob.glob('shots/px/*.png')):
    im = Image.open(f).convert('RGB')
    row = f'{os.path.basename(f):<10}'
    for _, x, y in pts:
        r, g, b = im.getpixel((x, y))
        # 粗略判断色相
        mx, mn = max(r,g,b), min(r,g,b)
        if mx - mn < 18: hue = '灰'
        elif mx == r: hue = '红橙' if (g-b) >= 0 else '粉紫'
        elif mx == g: hue = '绿'
        else: hue = '蓝'
        row += f'{f"({r},{g},{b}){hue}":<22}'
    print(row)
