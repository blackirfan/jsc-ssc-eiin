import os
import cv2
import numpy as np

# Load sample_3 (expected 3994)
img_path = os.path.join(os.path.dirname(__file__), 'captcha_samples', 'sample_3.png')
img = cv2.imread(img_path)
h, w = img.shape[:2]

# Threshold white text (r, g, b > 180)
b, g, r = cv2.split(img)
white_mask = (r > 180) & (g > 180) & (b > 180)
mask = np.zeros((h, w), dtype=np.uint8)
mask[white_mask] = 255

# Remove top/bottom/left/right border margins
crop_mask = mask.copy()
crop_mask[:int(h*0.1), :] = 0
crop_mask[int(h*0.9):, :] = 0
crop_mask[:, :int(w*0.05)] = 0
crop_mask[:, int(w*0.95):] = 0

# Apply morphological close with 3x3 kernel
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
closed = cv2.morphologyEx(crop_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

# Save mask
cv2.imwrite('debug_sample3_mask.png', closed)

# Find vertical projection (sum of white pixels per column)
col_sums = np.sum(closed, axis=0)
print("Column sums shape:", col_sums.shape)
print("Non-zero columns:", np.where(col_sums > 0)[0])
