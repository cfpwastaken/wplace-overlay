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