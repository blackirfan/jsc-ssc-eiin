/**
 * smoke_test.js  ─  Quick test: 2 EIINs × 2 SSC years to validate the full pipeline.
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

const SCRAPER_DIR = __dirname;
const SOLVER_PY   = path.join(SCRAPER_DIR, 'solver.py');
const TEMP_CAP    = path.join(SCRAPER_DIR, 'temp_captcha.png');
const BASE_URL    = 'https://result.dhakaeducationboard.gov.bd/v2/home';
const MAX_ATTEMPTS = 10;

const TEST_CASES = [
  { eiin: 108258, exam: 'ssc', year: '2023' },
  { eiin: 108258, exam: 'ssc', year: '2022' },
  { eiin: 108019, exam: 'ssc', year: '2023' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function solveCapImg(imgPath) {
  try {
    const out = execSync(`python "${SOLVER_PY}" "${imgPath}"`, { encoding: 'utf8', timeout: 20000 });
    return out.trim();
  } catch (e) { return ''; }
}

function parseResult(text) {
  const data = {};
  const nameMatch = text.match(/Institution:\s+(.+?)\s+\(EIIN:/);
  if (nameMatch) data.school_name = nameMatch[1].trim();
  const st = text.match(/Examinee:\s*(\d+),\s*Appeared:\s*(\d+),\s*Passed:\s*(\d+),\s*Percentage of Pass:\s*([\d.]+),\s*GPA 5:\s*(\d+)/);
  if (st) { data.examinee_total = +st[1]; data.examinee_passed = +st[3]; data.examinee_gpa5 = +st[5]; }
  return data;
}

async function reloadCaptcha(page) {
  try {
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/v2/captcha'), { timeout: 4000 }),
      page.click('#captcha_reload')
    ]);
  } catch (_) { await page.click('#captcha_reload'); await sleep(900); }
}

async function scrapeOne(page, eiin, exam, year) {
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (_) {
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
  }
  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', exam);
  await page.selectOption('#year', year);
  await sleep(400);
  await page.selectOption('#result_type', '2');
  await sleep(400);
  await page.fill('#eiin', String(eiin));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const captchaEl = await page.$('#captcha_img');
    if (!captchaEl) return null;
    await captchaEl.screenshot({ path: TEMP_CAP });
    const code = solveCapImg(TEMP_CAP);
    if (!code || code.length !== 4) { await reloadCaptcha(page); continue; }
    await page.fill('#captcha', code);
    await page.click('#submit');
    try {
      await page.waitForFunction(
        () => { const e = document.getElementById('result_display'); return e && e.innerText && e.innerText.trim().length > 20; },
        undefined, { timeout: 5000 }
      );
      const text = await page.$eval('#result_display', el => el.innerText);
      return parseResult(text);
    } catch (_) { await reloadCaptcha(page); }
  }
  return null;
}

(async () => {
  console.log('=== SMOKE TEST ===\n');
  const browser = await chromium.launch({ headless: true });
  const context  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page     = await context.newPage();

  let pass = 0, fail = 0;
  for (const { eiin, exam, year } of TEST_CASES) {
    process.stdout.write(`[${exam.toUpperCase()} ${year}] EIIN=${eiin} ... `);
    const data = await scrapeOne(page, eiin, exam, year);
    if (data && data.examinee_total) {
      console.log(`PASS  ${data.school_name || ''}  examinee=${data.examinee_total} passed=${data.examinee_passed} gpa5=${data.examinee_gpa5}`);
      pass++;
    } else {
      console.log('FAIL  (no result)');
      fail++;
    }
    await sleep(600);
  }

  await browser.close();
  console.log(`\n=== Results: ${pass} PASS, ${fail} FAIL ===`);
  if (fail === 0) {
    console.log('\n✅ Pipeline is working! Run the full scrape with:');
    console.log('   node scrape.js --exam ssc --resume');
  } else {
    console.log('\n⚠️  Some tests failed. Check CAPTCHA solver or network.');
  }
})();
