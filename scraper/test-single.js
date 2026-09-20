// One-off interactive test: fills the form for a known EIIN/year, waits for
// YOU to type the CAPTCHA and click "View Result" in the opened browser,
// then dumps the result HTML text and downloads the PDF for inspection.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { handleCaptcha } = require('./captcha-handler');

const EIIN = process.argv[2] || '108258';
const EXAM = process.argv[3] || 'ssc';
const YEAR = process.argv[4] || '2011';

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null, acceptDownloads: true });
  const page = await context.newPage();

  await page.goto('https://result.dhakaeducationboard.gov.bd/v2/home', { waitUntil: 'networkidle' });
  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', EXAM);
  await page.selectOption('#year', YEAR);
  await page.waitForTimeout(400);
  await page.selectOption('#result_type', '2');
  await page.waitForTimeout(400);
  await page.fill('#eiin', String(EIIN));

  const outcome = await handleCaptcha(page, { exam: EXAM, year: YEAR, eiin: EIIN }, { timeoutMs: 5 * 60 * 1000 });

  if (outcome.result !== 'SUCCESS') {
    console.log('CAPTCHA handling ended with:', outcome.result);
    await browser.close();
    process.exit(outcome.result === 'CAPTCHA_TIMEOUT' ? 2 : 3);
  }

  // The /v2/getres JSON response carries the result HTML in either `res`
  // or `extra.content` depending on response shape.
  const resultHtml =
    outcome.responseJson.res ||
    (outcome.responseJson.extra && outcome.responseJson.extra.content) ||
    '';
  fs.writeFileSync(path.join(__dirname, 'sample_result.html'), resultHtml);
  console.log('Saved sample_result.html (from network response)');

  // Also grab whatever the DOM shows, as a cross-check.
  await page.waitForTimeout(500);
  const domText = await page.$eval('#result_display', (el) => el.innerText).catch(() => '(empty)');
  fs.writeFileSync(path.join(__dirname, 'sample_result.txt'), domText);
  console.log('Saved sample_result.txt (from DOM)');

  // Try clicking the Download button to grab the PDF
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('#download'),
    ]);
    const pdfDir = path.join(__dirname, '..', 'pdfs');
    fs.mkdirSync(pdfDir, { recursive: true });
    const pdfPath = path.join(pdfDir, `${EXAM}_${EIIN}_${YEAR}.pdf`);
    await download.saveAs(pdfPath);
    console.log('Saved PDF to', pdfPath);
  } catch (e) {
    console.log('Could not capture PDF download automatically:', e.message);
    console.log('(You can also click "View" to see it, or "Download" manually — check your Downloads folder.)');
  }

  console.log('\nDone. Leaving browser open 30s for you to look around, then closing.');
  await page.waitForTimeout(30000);
  await browser.close();
})();
