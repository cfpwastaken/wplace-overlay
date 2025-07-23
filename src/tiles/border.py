from PIL import Image
import sys

# Load original image
img = Image.open(sys.argv[1] + "_orig.png").convert("RGBA")
w, h = img.size

# Create new image with spacing
new_w = w * 2
new_h = h * 2
new_img = Image.new("RGBA", (new_w, new_h), (0, 0, 0, 0))  # transparent background

# Copy each pixel to its new position
for y in range(h):
    for x in range(w):
        pixel = img.getpixel((x, y))
        new_img.putpixel((x * 2, y * 2), pixel)

# Save it
new_img = new_img.resize((2000, 2000), resample=Image.NEAREST)
new_img.save(sys.argv[1] + ".png")
