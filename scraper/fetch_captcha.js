const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('https://result.dhakaeducationboard.gov.bd/v2/home', { waitUntil: 'networkidle', timeout: 30000 });
    await page.selectOption('#board', 'dhaka');
    await page.selectOption('#exam', 'ssc');
    await page.selectOption('#year', '2023');
    await page.waitForTimeout(500);
    await page.selectOption('#result_type', '2');
    await page.waitForTimeout(800);

    const captchaImg = await page.$('#captcha_img');
    if (captchaImg) {
      const outPath = path.join(__dirname, 'captcha_sample.png');
      await captchaImg.screenshot({ path: outPath });
      console.log('Saved captcha_sample.png at', outPath);
    } else {
      console.log('captcha_img element not found after selecting options!');
    }
  } catch (err) {
    console.error('Error fetching captcha:', err);
  } finally {
    await browser.close();
  }
})();
