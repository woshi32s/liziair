from PIL import Image
import numpy as np, os
base = r"E:\DSHdesktop\work\music-player\shots\review"
a=np.asarray(Image.open(os.path.join(base,"007-d.png")).convert("RGB")).astype(int)
m=(a.max(axis=2)>150)
m[0:60,:]=False
col=m.sum(axis=0); row=m.sum(axis=1)
print("col bins(50px):")
print([int(col[i:i+50].sum()) for i in range(0,1440,50)])
print("row bins(50px):")
print([int(row[i:i+50].sum()) for i in range(0,810,50)])
ys=np.where(row>0)[0]
print("rows with >5 px:", [int(y) for y in ys if row[y]>5][:20], "...", [int(y) for y in ys if row[y]>5][-10:])
