import os
import cv2
import numpy as np

ground_truth = {
    'captcha_sample.png': '1486',
    'sample_1.png': '6415',
    'sample_2.png': '3769',
    'sample_3.png': '3994',
    'sample_4.png': '2799',
    'sample_5.png': '4853'
}

templates_dir = os.path.join(os.path.dirname(__file__), 'digit_templates')

# Load and normalize all digit templates to 32x40
templates = []
for fname in os.listdir(templates_dir):
    if fname.endswith('.png'):
        digit_label = fname.split('_')[0]
        tpath = os.path.join(templates_dir, fname)
        timg = cv2.imread(tpath, cv2.IMREAD_GRAYSCALE)
        # Bounding box crop around non-zero pixels
        ys, xs = np.where(timg > 0)
        if len(ys) > 0:
            timg = timg[min(ys):max(ys)+1, min(xs):max(xs)+1]
        timg_resized = cv2.resize(timg, (32, 40), interpolation=cv2.INTER_AREA)
        templates.append((digit_label, timg_resized, fname))

print(f"Loaded {len(templates)} templates for digits: {set(t[0] for t in templates)}")

def match_digit_crop(crop):
    ys, xs = np.where(crop > 0)
    if len(ys) == 0:
        return '?'
    # Crop to non-zero bounding box
    crop_boxed = crop[min(ys):max(ys)+1, min(xs):max(xs)+1]
    crop_resized = cv2.resize(crop_boxed, (32, 40), interpolation=cv2.INTER_AREA)
    
    best_score = -1.0
    best_digit = '?'
    
    for label, timg, fname in templates:
        # Normalized cross-correlation
        res = cv2.matchTemplate(crop_resized, timg, cv2.TM_CCOEFF_NORMED)
        score = res[0][0]
        if score > best_score:
            best_score = score
            best_digit = label
            
    return best_digit

correct = 0
total = len(ground_truth)

for filename, expected in ground_truth.items():
    filepath = os.path.join(os.path.dirname(__file__), filename if filename == 'captcha_sample.png' else os.path.join('captcha_samples', filename))
    if not os.path.exists(filepath): continue
    
    img = cv2.imread(filepath)
    h, w = img.shape[:2]
    
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
    
    start_x = int(w * 0.08)
    end_x = int(w * 0.92)
    digit_w = (end_x - start_x) / 4.0
    
    predicted = []
    for i in range(4):
        x1 = int(start_x + i * digit_w)
        x2 = int(start_x + (i + 1) * digit_w)
        crop = closed[:, x1:x2]
        d = match_digit_crop(crop)
        predicted.append(d)
        
    pred_str = ''.join(predicted)
    is_pass = (pred_str == expected)
    if is_pass: correct += 1
    print(f"[{'PASS' if is_pass else 'FAIL'}] {filename} | Expected: {expected} | Template Match: '{pred_str}'")

print(f"\nTemplate Match Accuracy (self-test): {correct}/{total} ({correct/total*100:.1f}%)")
