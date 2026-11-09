from PIL import Image
import os
base = r"E:\DSHdesktop\work\music-player\shots\review"
im = Image.open(os.path.join(base,"007-h.png")).convert("RGB")
box=(200,290,660,520)
im.crop(box).resize(((box[2]-box[0])*2,(box[3]-box[1])*2), Image.LANCZOS).save(os.path.join(base,"007-h-crop.png"))
print("ok")
