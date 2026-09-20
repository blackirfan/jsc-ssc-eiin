const { createWorker } = require('tesseract.js');
const path = require('path');
const fs = require('fs');

const groundTruth = {
  'captcha_sample.png': '1486',
  'sample_1.png': '6415',
  'sample_2.png': '3769',
  'sample_3.png': '3994',
  'sample_4.png': '2799',
  'sample_5.png': '4853'
};

(async () => {
  const worker = await createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '7', // PSM 7: Treat image as a single text line
  });

  console.log('--- Testing Tesseract.js on Cleaned Images ---');
  for (const [filename, expected] of Object.entries(groundTruth)) {
    const filePath = filename === 'captcha_sample.png'
      ? path.join(__dirname, 'captcha_sample_clean.png')
      : path.join(__dirname, 'captcha_samples', filename.replace('.png', '_clean.png'));

    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      continue;
    }

    const { data: { text } } = await worker.recognize(filePath);
    const cleanedText = text.trim().replace(/\D/g, '');
    const isPass = cleanedText === expected;
    console.log(`[${isPass ? 'PASS' : 'FAIL'}] ${filename} | Expected: ${expected} | Tesseract: '${cleanedText}'`);
  }

  await worker.terminate();
})();
