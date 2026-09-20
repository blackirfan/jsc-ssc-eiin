import os
import sys
import random
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader
from PIL import Image, ImageDraw, ImageFont
import cv2

torch.manual_seed(42)
np.random.seed(42)
random.seed(42)

FONT_PATHS = [
    "C:\\Windows\\Fonts\\georgia.ttf",
    "C:\\Windows\\Fonts\\georgiab.ttf",
    "C:\\Windows\\Fonts\\times.ttf",
    "C:\\Windows\\Fonts\\timesbd.ttf"
]
available_fonts = [f for f in FONT_PATHS if os.path.exists(f)]

def generate_synthetic_captcha(text, width=160, height=50):
    img = Image.new('RGB', (width, height), color=(random.randint(40, 120), random.randint(40, 120), random.randint(40, 120)))
    draw = ImageDraw.Draw(img)
    
    font_path = random.choice(available_fonts) if available_fonts else None
    font = ImageFont.truetype(font_path, size=random.randint(28, 34)) if font_path else ImageFont.load_default()
        
    x_start = 12
    for char in text:
        char_img = Image.new('RGBA', (40, 45), (0, 0, 0, 0))
        char_draw = ImageDraw.Draw(char_img)
        char_draw.text((5, 2), char, font=font, fill=(255, 255, 255, 255))
        
        rot_deg = random.randint(-15, 15)
        char_img = char_img.rotate(rot_deg, expand=False, resample=Image.BICUBIC)
        
        img.paste(char_img, (x_start, random.randint(2, 8)), char_img)
        x_start += random.randint(32, 36)
        
    cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    
    h, w = cv_img.shape[:2]
    for _ in range(random.randint(4, 8)):
        x = random.randint(0, w)
        cv2.line(cv_img, (x, 0), (x, h), (0, 0, 0), thickness=1)
    for _ in range(random.randint(4, 8)):
        y = random.randint(0, h)
        cv2.line(cv_img, (0, y), (w, y), (0, 0, 0), thickness=1)
        
    return cv_img

def preprocess_cv_image(cv_img):
    h, w = cv_img.shape[:2]
    b, g, r = cv2.split(cv_img)
    white_mask = ((r > 170) & (g > 170) & (b > 170)).astype(np.uint8) * 255
    
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
    
    resized = cv2.resize(closed, (160, 50), interpolation=cv2.INTER_AREA)
    norm = resized.astype(np.float32) / 255.0
    return norm

class CaptchaCNN(nn.Module):
    def __init__(self):
        super(CaptchaCNN, self).__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 16, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2, 2), # 16 x 25 x 80
            
            nn.Conv2d(16, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2, 2), # 32 x 12 x 40
        )
        self.fc = nn.Sequential(
            nn.Linear(32 * 12 * 40, 128),
            nn.ReLU()
        )
        self.digit1 = nn.Linear(128, 10)
        self.digit2 = nn.Linear(128, 10)
        self.digit3 = nn.Linear(128, 10)
        self.digit4 = nn.Linear(128, 10)
        
    def forward(self, x):
        x = self.features(x)
        x = x.view(x.size(0), -1)
        x = self.fc(x)
        return self.digit1(x), self.digit2(x), self.digit3(x), self.digit4(x)

if __name__ == '__main__':
    NUM_SAMPLES = 250
    print(f"Pre-generating {NUM_SAMPLES} synthetic captchas...", flush=True)
    imgs_list = []
    labels_list = []
    for _ in range(NUM_SAMPLES):
        digits = ''.join([str(random.randint(0, 9)) for _ in range(4)])
        cv_img = generate_synthetic_captcha(digits)
        norm_img = preprocess_cv_image(cv_img)
        imgs_list.append(norm_img)
        labels_list.append([int(c) for c in digits])
        
    X = torch.tensor(np.array(imgs_list), dtype=torch.float32).unsqueeze(1)
    Y = torch.tensor(np.array(labels_list), dtype=torch.long)
    
    loader = DataLoader(TensorDataset(X, Y), batch_size=32, shuffle=True)
    
    model = CaptchaCNN()
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=0.005)
    
    model.train()
    epochs = 10
    print("Training CNN model...", flush=True)
    for epoch in range(1, epochs + 1):
        total_loss = 0.0
        for imgs, labels in loader:
            optimizer.zero_grad()
            out1, out2, out3, out4 = model(imgs)
            loss = (criterion(out1, labels[:, 0]) + 
                    criterion(out2, labels[:, 1]) + 
                    criterion(out3, labels[:, 2]) + 
                    criterion(out4, labels[:, 3]))
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        print(f"Epoch {epoch}/{epochs} | Loss: {total_loss/len(loader):.4f}", flush=True)
            
    torch.save(model.state_dict(), 'captcha_cnn.pth')
    print("Saved model to captcha_cnn.pth", flush=True)
    
    ground_truth = {
        'captcha_sample.png': '1486',
        'sample_1.png': '6415',
        'sample_2.png': '3769',
        'sample_3.png': '3994',
        'sample_4.png': '2799',
        'sample_5.png': '4853'
    }
    
    model.eval()
    correct = 0
    total = len(ground_truth)
    print("\n--- Evaluating PyTorch CNN on Real Captchas ---", flush=True)
    with torch.no_grad():
        for filename, expected in ground_truth.items():
            filepath = os.path.join(os.path.dirname(__file__), filename if filename == 'captcha_sample.png' else os.path.join('captcha_samples', filename))
            if not os.path.exists(filepath): continue
            
            real_cv_img = cv2.imread(filepath)
            norm_img = preprocess_cv_image(real_cv_img)
            t_in = torch.tensor(norm_img, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
            
            o1, o2, o3, o4 = model(t_in)
            d1 = str(torch.argmax(o1, dim=1).item())
            d2 = str(torch.argmax(o2, dim=1).item())
            d3 = str(torch.argmax(o3, dim=1).item())
            d4 = str(torch.argmax(o4, dim=1).item())
            
            pred = d1 + d2 + d3 + d4
            is_pass = (pred == expected)
            if is_pass: correct += 1
            print(f"[{'PASS' if is_pass else 'FAIL'}] {filename} | Expected: {expected} | CNN Predicted: '{pred}'", flush=True)
            
    print(f"\nReal Captcha Accuracy: {correct}/{total} ({correct/total*100:.1f}%)", flush=True)
