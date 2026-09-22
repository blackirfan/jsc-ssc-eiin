"""
solver.py - CAPTCHA solver for dhakaeducationboard.gov.bd
Uses EasyOCR with white-pixel isolation + border floodfill to read 4-digit codes.
"""
import os
import sys
import cv2
import numpy as np
import warnings
warnings.filterwarnings("ignore")

import easyocr
_reader = None

def get_reader():
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(['en'], gpu=False, verbose=False)
    return _reader


def _preprocess_mask(img, thresh_val):
    h, w = img.shape[:2]
    b, g, r = cv2.split(img)
    white_mask = ((r > thresh_val) & (g > thresh_val) & (b > thresh_val)).astype(np.uint8) * 255

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

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(closed)
    clean = np.zeros_like(closed)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= 15:
            clean[labels == i] = 255

    resized = cv2.resize(clean, (0, 0), fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
    inv = cv2.bitwise_not(resized)
    bordered = cv2.copyMakeBorder(inv, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=255)
    return bordered


def _extract_digits(results):
    if not results:
        return ""
    results_sorted = sorted(results, key=lambda res: res[0][0][0])
    raw = ''.join([r[1] for r in results_sorted if r[1].isdigit()])
    if len(raw) == 5:
        if raw.startswith('7') or raw.startswith('1'):
            raw = raw[1:]
        else:
            raw = raw[:4]
    elif len(raw) > 4:
        raw = raw[:4]
    return raw


def solve(img_path_or_bytes):
    """Return 4-digit CAPTCHA string or empty string on failure."""
    reader = get_reader()

    if isinstance(img_path_or_bytes, (str, os.PathLike)):
        img = cv2.imread(str(img_path_or_bytes))
    else:
        nparr = np.frombuffer(img_path_or_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return ""

    # Sweep threshold values; first match of exactly 4 digits wins
    for thresh in [185, 190, 180, 195, 175, 200, 165]:
        proc = _preprocess_mask(img, thresh)
        results = reader.readtext(proc, allowlist='0123456789')
        digits = _extract_digits(results)
        if len(digits) == 4:
            return digits

    # Fallback: CLAHE grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    cl = cv2.resize(clahe.apply(gray), (0, 0), fx=2.5, fy=2.5)
    results = reader.readtext(cl, allowlist='0123456789')
    digits = _extract_digits(results)
    if len(digits) == 4:
        return digits

    # Fallback: raw image
    results = reader.readtext(img, allowlist='0123456789')
    digits = _extract_digits(results)
    return digits[:4] if len(digits) >= 4 else digits


def serve():
    """Long-lived mode: read one image path per stdin line, print one result line.
    Keeps the EasyOCR model loaded so each solve avoids the ~5s startup cost."""
    get_reader()
    print("READY", flush=True)
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            out = solve(path)
        except Exception:
            out = ""
        print(out, flush=True)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--serve':
        serve()
    elif len(sys.argv) > 1:
        print(solve(sys.argv[1]))
