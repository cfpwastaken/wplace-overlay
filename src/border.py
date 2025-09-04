from PIL import Image
import sys
import numpy as np

# Load original image
img = Image.open(sys.argv[1] + "_orig.png").convert("RGBA")
arr = np.array(img)

# Create new array with 3x size and transparent background
h, w = arr.shape[:2]
new_arr = np.zeros((h*3, w*3, 4), dtype=np.uint8)

# Place each pixel at the center of its 3x3 block
new_arr[1::3, 1::3] = arr

# Convert back to image and resize
new_img = Image.fromarray(new_arr, "RGBA")
new_img = new_img.resize((3000, 3000), resample=Image.NEAREST)
new_img.save(sys.argv[1] + ".png")
