from PIL import Image
im = Image.open(r"E:\DSHdesktop\work\music-player\shots\lizi\lizi05-ferrofluid-2.png")
im.crop((255, 310, 605, 410)).resize((1400, 400), Image.NEAREST).save(r"E:\DSHdesktop\work\music-player\shots\lizi\_crop5.png")
print("ok")
