import os
import cv2
import numpy as np
import easyocr

ground_truth = {
    'captcha_sample.png': '1486',
    'sample_1.png': '6415',
    'sample_2.png': '3769',
    'sample_3.png': '3994',
    'sample_4.png': '2799',
    'sample_5.png': '4853'
}

reader = easyocr.Reader(['en'], gpu=False)

def solve_by_quadrants(img_path):
    img = cv2.imread(img_path)
    h, w = img.shape[:2]
    
    # Preprocess with white threshold & corner floodfill
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
    
    # Cut into 4 horizontal slices for the 4 digits
    # The digits span roughly from x=0.08*w to x=0.92*w
    start_x = int(w * 0.08)
    end_x = int(w * 0.92)
    digit_width = (end_x - start_x) / 4.0
    
    predicted_digits = []
    
    for i in range(4):
        x1 = int(start_x + i * digit_width)
        x2 = int(start_x + (i + 1) * digit_width)
        
        # Add 5px overlap padding
        px1 = max(0, x1 - 4)
        px2 = min(w, x2 + 4)
        
        crop = closed[:, px1:px2]
        
        # Resize crop up 3x
        crop_resized = cv2.resize(crop, (0, 0), fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC)
        inv_crop = cv2.bitwise_not(crop_resized)
        bordered_crop = cv2.copyMakeBorder(inv_crop, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
        
        res = reader.readtext(bordered_crop, allowlist='0123456789', detail=1)
        if res:
            # Pick highest confidence digit
            best = max(res, key=lambda r: r[2])
            digit = best[1]
            if len(digit) > 1:
                digit = digit[0] # take first digit
            predicted_digits.append(digit)
        else:
            predicted_digits.append('?')
            
    return ''.join(predicted_digits)

correct = 0
total = len(ground_truth)

for filename, expected in ground_truth.items():
    if filename == 'captcha_sample.png':
        filepath = os.path.join(os.path.dirname(__file__), filename)
    else:
        filepath = os.path.join(os.path.dirname(__file__), 'captcha_samples', filename)
    
    if not os.path.exists(filepath):
        continue

    predicted = solve_by_quadrants(filepath)
    is_pass = (predicted == expected)
    if is_pass:
        correct += 1
    print(f"[{'PASS' if is_pass else 'FAIL'}] {filename} | Expected: {expected} | Quadrant OCR: '{predicted}'")

print(f"\nQuadrant Score: {correct}/{total} ({correct/total*100:.1f}%)")
