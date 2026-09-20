// Research-only probe: submit a deliberately WRONG captcha value once to
// observe how the site signals failure (DOM change / network response),
// so the retry handler can detect it reliably. Not an attempt to guess or
// bypass the captcha.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  page.on('response', async (res) => {
    if (res.request().method() === 'POST') {
      let body = '';
      try { body = (await res.text()).slice(0, 500); } catch (e) {}
      console.log('POST response:', res.url(), res.status(), body);
    }
  });

  await page.goto('https://result.dhakaeducationboard.gov.bd/v2/home', { waitUntil: 'networkidle' });
  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', 'ssc');
  await page.selectOption('#year', '2011');
  await page.waitForTimeout(300);
  await page.selectOption('#result_type', '2');
  await page.waitForTimeout(300);
  await page.fill('#eiin', '108258');
  await page.fill('#captcha', '000000'); // deliberately wrong, just to see the error UI

  const before = await page.getAttribute('#captcha_img', 'src');
  await page.click('#submit');
  await page.waitForTimeout(4000);

  const html = await page.content();
  require('fs').writeFileSync('wrong_captcha_page.html', html);
  const after = await page.getAttribute('#captcha_img', 'src').catch(() => null);
  console.log('captcha src before:', before);
  console.log('captcha src after :', after);
  console.log('saved wrong_captcha_page.html');

  await browser.close();
})();
