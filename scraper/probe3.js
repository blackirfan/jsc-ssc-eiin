const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://result.dhakaeducationboard.gov.bd/v2/home', { waitUntil: 'networkidle' });
  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', 'ssc');
  await page.selectOption('#year', '2023');
  await page.waitForTimeout(500);
  await page.selectOption('#result_type', '2');
  await page.waitForTimeout(800);

  const html = await page.$eval('#form', (el) => el.outerHTML);
  require('fs').writeFileSync('form_after_institution.html', html);
  console.log('saved form_after_institution.html, length', html.length);
})();
