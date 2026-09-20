import os
import cv2
import numpy as np

ground_truth = {
    'captcha_sample.png': ('1486', [(18, 48), (48, 85), (85, 120), (120, 155)]),
    'sample_1.png':        ('6415', [(15, 48), (48, 85), (85, 120), (120, 155)]),
    'sample_2.png':        ('3769', [(15, 48), (48, 85), (85, 120), (120, 155)]),
    'sample_3.png':        ('3994', [(15, 48), (48, 85), (85, 120), (120, 155)]),
    'sample_4.png':        ('2799', [(15, 48), (48, 85), (85, 120), (120, 155)]),
    'sample_5.png':        ('4853', [(15, 48), (48, 85), (85, 120), (120, 155)]),
}

out_dir = os.path.join(os.path.dirname(__file__), 'digit_templates')
os.makedirs(out_dir, exist_ok=True)

digit_counts = {}

for filename, (digits, x_ranges) in ground_truth.items():
    filepath = os.path.join(os.path.dirname(__file__), filename if filename == 'captcha_sample.png' else os.path.join('captcha_samples', filename))
    if not os.path.exists(filepath):
        continue
        
    img = cv2.imread(filepath)
    h, w = img.shape[:2]
    
    # Clean white mask
    b, g, r = cv2.split(img)
    white_mask = ((r > 185) & (g > 185) & (b > 185)).astype(np.uint8) * 255
    
    flood = white_mask.copy()
    bg_mask = np.zeros((h + 2, w + 2), dtype=np.uint8)
    for x in range(w):
        if flood[0, x] == 255: cv2.floodFill(flood, bg_mask, (x, 0), 0)
        if flood[h-1, x] == 255: cv2.floodFill(flood, bg_mask, (x, h-1), 0)
    for y in range(h):
        if flood[y, 0] == 255: cv2.floodFill(flood, bg_mask, (0, y), 0)
        if flood[y, w-1] == 255: cv2.floodFill(flood, bg_mask, (w-1, y), 0)
        
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    closed = cv2.morphologyEx(flood, cv2.MORPH_CLOSE, kernel, iterations=2)
    
    for i, d in enumerate(digits):
        x1, x2 = x_ranges[i]
        # Calculate proportional coordinates based on image width
        px1 = int(w * (x1 / 161.0))
        px2 = int(w * (x2 / 161.0))
        
        crop = closed[:, px1:px2]
        
        count = digit_counts.get(d, 0) + 1
        digit_counts[d] = count
        
        out_path = os.path.join(out_dir, f"{d}_{count}.png")
        cv2.imwrite(out_path, crop)
        print(f"Saved template for digit '{d}': {out_path}")

print("\nDigit template extraction completed:", digit_counts)
