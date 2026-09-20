// One-off probe: open the form, inspect what result_type options appear once
// board/exam/year are chosen (site may populate them dynamically via JS/AJAX),
// so we know whether an "Analytics" option (which might carry avg GPA) exists.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://result.dhakaeducationboard.gov.bd/v2/home', { waitUntil: 'networkidle' });

  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', 'ssc');
  await page.selectOption('#year', '2023');

  // give any onchange/AJAX handlers time to populate result_type
  await page.waitForTimeout(1500);

  const options = await page.$$eval('#result_type option', (opts) =>
    opts.map((o) => ({ value: o.value, text: o.textContent.trim() }))
  );
  console.log('result_type options after selecting board/exam/year:', JSON.stringify(options, null, 2));

  console.log('Leaving browser open for 5 minutes for manual inspection. Press Ctrl+C to stop early.');
  await page.waitForTimeout(5 * 60 * 1000);
  await browser.close();
})();
