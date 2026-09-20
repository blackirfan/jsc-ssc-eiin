// Check whether an "Analytics" result_type option ever appears, across exam
// types and years, and inspect field visibility for Institution Result.
const { chromium } = require('playwright');

const combos = [
  ['ssc', '2023'], ['ssc', '2015'], ['jsc', '2018'], ['jsc', '2012'], ['hsc', '2023'],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const [exam, year] of combos) {
    await page.goto('https://result.dhakaeducationboard.gov.bd/v2/home', { waitUntil: 'networkidle' });
    await page.selectOption('#board', 'dhaka');
    await page.selectOption('#exam', exam);
    await page.selectOption('#year', year);
    await page.waitForTimeout(1000);
    const options = await page.$$eval('#result_type option', (opts) =>
      opts.map((o) => ({ value: o.value, text: o.textContent.trim() }))
    );
    console.log(exam, year, JSON.stringify(options));
  }

  // Now check field visibility for Institution Result on ssc/2023
  await page.goto('https://result.dhakaeducationboard.gov.bd/v2/home', { waitUntil: 'networkidle' });
  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', 'ssc');
  await page.selectOption('#year', '2023');
  await page.waitForTimeout(500);
  await page.selectOption('#result_type', '2');
  await page.waitForTimeout(500);
  const rowEiinVisible = await page.isVisible('#row_eiin');
  const rowDcodeVisible = await page.isVisible('#row_dcode');
  const rowCcodeVisible = await page.isVisible('#row_ccode');
  console.log('Institution Result field visibility -> eiin:', rowEiinVisible, 'dcode:', rowDcodeVisible, 'ccode:', rowCcodeVisible);

  const captchaSrc = await page.getAttribute('#captcha_img', 'src');
  console.log('captcha src:', captchaSrc);

  await browser.close();
})();
