from PIL import Image
import sys

# Load original image
img = Image.open(sys.argv[1] + "_orig.png").convert("RGBA")
w, h = img.size

# Create new 3x image with 1px border around each pixel
new_w = w * 3
new_h = h * 3
new_img = Image.new("RGBA", (new_w, new_h), (0, 0, 0, 0))  # transparent background

# Place each pixel with a 1px border on all sides
for y in range(h):
	for x in range(w):
		pixel = img.getpixel((x, y))
		new_img.putpixel((x * 3 + 1, y * 3 + 1), pixel)

# Resize to 3000x3000
new_img = new_img.resize((3000, 3000), resample=Image.NEAREST)
new_img.save(sys.argv[1] + ".png")

sym_w = w * 7
sym_h = h * 7
sym_img = Image.new("RGBA", (sym_w, sym_h), (0, 0, 0, 0))  # transparent background

hexes = ["000000","0c816e","0eb968","0f799f","10aea6","13e1be","13e67b","28509e","333941","3c3c3c","4093e4","4a4284","4a6b3a","4d31b8","5a944a","600018","60f7f2","684634","6b50f6","6d643f","6d758d","780c99","787878","7a71c4","7b6352","7dc7ff","84c573","87ff5e","948c6b","95682a","99b1fb","9b5249","9c8431","9c846b","a50e1e","aa38b9","aaaaaa","b3b9d1","b5aef1","bbfaf2","c5ad31","cb007a","cdc59e","d18051","d18078","d2d2d2","d6b594","dba463","e09ff9","e45c1a","e8d45f","ec1f80","ed1c24","f38da9","f6aa09","f8b277","f9dd3b","fa8072","fab6a4","ff7f27","ffc5a5","fffabc","ffffff"]
symbols = {}
for col in hexes:
	symbols[col] = Image.open("symbols/"+col+".png").convert("RGBA")

# magic
for y in range(h):
	for x in range(w):
		r, g, b, a = img.getpixel((x,y))
		hexa = f"{r:02x}{g:02x}{b:02x}"
		if (a == 255 and hexa in hexes):
			sym_img.paste(symbols[hexa], (x*7,y*7))


# Resize to 7000x7000
sym_img = sym_img.resize((7000, 7000), resample=Image.NEAREST)
sym_img.save(sys.argv[1] + "_sym.png")