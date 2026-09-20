const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EIIN = process.argv[2] || '108258';
const EXAM = process.argv[3] || 'ssc';
const YEAR = process.argv[4] || '2023';

(async () => {
  console.log(`Starting automated scraper test for EXAM=${EXAM}, YEAR=${YEAR}, EIIN=${EIIN}`);
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null, acceptDownloads: true });
  const page = await context.newPage();

  await page.goto('https://result.dhakaeducationboard.gov.bd/v2/home', { waitUntil: 'networkidle' });
  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', EXAM);
  await page.selectOption('#year', YEAR);
  await page.waitForTimeout(500);
  await page.selectOption('#result_type', '2');
  await page.waitForTimeout(500);
  await page.fill('#eiin', String(EIIN));

  const maxAttempts = 8;
  let success = false;
  const tempCaptchaPath = path.join(__dirname, 'temp_captcha.png');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\n--- Attempt ${attempt} of ${maxAttempts} ---`);
    
    // Ensure element is visible
    const captchaEl = await page.$('#captcha_img');
    if (!captchaEl) {
      console.log('Captcha image element not found!');
      break;
    }
    
    await captchaEl.screenshot({ path: tempCaptchaPath });
    
    // Solve using solver.py
    let captchaCode = '';
    try {
      const output = execSync(`python solver.py "${tempCaptchaPath}"`, { encoding: 'utf8' });
      captchaCode = output.trim();
    } catch (err) {
      console.error('Error running solver.py:', err.message);
    }
    
    console.log(`Solved CAPTCHA code: "${captchaCode}"`);

    if (!captchaCode || captchaCode.length !== 4) {
      console.log('Solver returned invalid code (not 4 digits). Reloading captcha...');
      try {
        await Promise.all([
          page.waitForResponse(res => res.url().includes('/v2/captcha'), { timeout: 5000 }),
          page.click('#captcha_reload')
        ]);
        await page.waitForTimeout(500);
      } catch (err) {
        await page.click('#captcha_reload');
        await page.waitForTimeout(1000);
      }
      continue;
    }

    // Fill CAPTCHA input
    await page.fill('#captcha', captchaCode);
    await page.click('#submit');

    // Wait to see if result loads or error occurs
    try {
      await page.waitForFunction(
        () => {
          const el = document.getElementById('result_display');
          return el && el.innerText && el.innerText.trim().length > 20;
        },
        undefined,
        { timeout: 4000 }
      );
      
      console.log('SUCCESS! Result loaded in #result_display');
      success = true;
      break;
    } catch (e) {
      console.log('Result did not load (likely wrong CAPTCHA digits). Reloading CAPTCHA and retrying...');
      try {
        await Promise.all([
          page.waitForResponse(res => res.url().includes('/v2/captcha'), { timeout: 5000 }),
          page.click('#captcha_reload')
        ]);
        await page.waitForTimeout(500);
      } catch (err) {
        await page.click('#captcha_reload');
        await page.waitForTimeout(1000);
      }
    }
  }

  if (success) {
    const resultHtml = await page.$eval('#result_display', (el) => el.innerHTML);
    const resultText = await page.$eval('#result_display', (el) => el.innerText);
    fs.writeFileSync(path.join(__dirname, 'auto_result.html'), resultHtml);
    fs.writeFileSync(path.join(__dirname, 'auto_result.txt'), resultText);
    console.log('\nSaved result to auto_result.html and auto_result.txt!');
  } else {
    console.log(`\nFAILED to solve CAPTCHA after ${maxAttempts} attempts.`);
  }

  console.log('Closing browser in 5s...');
  await page.waitForTimeout(5000);
  await browser.close();
})();
