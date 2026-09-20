import os
import cv2
import numpy as np
import easyocr

reader = easyocr.Reader(['en'], gpu=False)

def test_variations(img_path):
    img = cv2.imread(img_path)
    
    # Var 1: Raw
    r1 = reader.readtext(img, allowlist='0123456789')
    t1 = ''.join([r[1] for r in r1])
    
    # Var 2: Grayscale + 2.5x Upscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray2x = cv2.resize(gray, (0,0), fx=2.5, fy=2.5)
    r2 = reader.readtext(gray2x, allowlist='0123456789')
    t2 = ''.join([r[1] for r in r2])
    
    # Var 3: Contrast Stretch (CLAHE) + 2.5x
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    cl = clahe.apply(gray)
    cl2x = cv2.resize(cl, (0,0), fx=2.5, fy=2.5)
    r3 = reader.readtext(cl2x, allowlist='0123456789')
    t3 = ''.join([r[1] for r in r3])
    
    # Var 4: Inverted Grayscale 2.5x
    inv = 255 - gray2x
    r4 = reader.readtext(inv, allowlist='0123456789')
    t4 = ''.join([r[1] for r in r4])
    
    return t1, t2, t3, t4

ground_truth = {
    'captcha_sample.png': '1486',
    'sample_1.png': '6415',
    'sample_2.png': '3769',
    'sample_3.png': '3994',
    'sample_4.png': '2799',
    'sample_5.png': '4853'
}

for fn, exp in ground_truth.items():
    fp = fn if fn == 'captcha_sample.png' else os.path.join('captcha_samples', fn)
    if os.path.exists(fp):
        t1, t2, t3, t4 = test_variations(fp)
        print(f"File: {fn:20s} | Exp: {exp} | Raw: '{t1:6s}' | Gray2x: '{t2:6s}' | CLAHE: '{t3:6s}' | Inv: '{t4:6s}'")
