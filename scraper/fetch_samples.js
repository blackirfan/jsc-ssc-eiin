const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const dir = path.join(__dirname, 'captcha_samples');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  await page.goto('https://result.dhakaeducationboard.gov.bd/v2/home', { waitUntil: 'networkidle' });
  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', 'ssc');
  await page.selectOption('#year', '2023');
  await page.waitForTimeout(500);
  await page.selectOption('#result_type', '2');
  await page.waitForTimeout(800);

  for (let i = 1; i <= 5; i++) {
    const captchaImg = await page.$('#captcha_img');
    if (captchaImg) {
      const outPath = path.join(dir, `sample_${i}.png`);
      await captchaImg.screenshot({ path: outPath });
      console.log(`Saved sample_${i}.png`);
    }
    await page.click('#captcha_reload');
    await page.waitForTimeout(1000);
  }

  await browser.close();
})();
