// Quick debug: scrape ONE result and log the full AJAX response to see the PDF URL
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SOLVER_PY = path.join(__dirname, 'solver.py');
const TEMP_CAP  = path.join(__dirname, 'temp_captcha.png');
const BASE_URL  = 'https://result.dhakaeducationboard.gov.bd/v2/home';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function solveCapImg(imgPath) {
  try { return execSync(`python "${SOLVER_PY}" "${imgPath}"`, { encoding: 'utf8', timeout: 20000 }).trim(); }
  catch (e) { return ''; }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', 'ssc');
  await page.selectOption('#year', '2011');
  await sleep(400);
  await page.selectOption('#result_type', '2');
  await sleep(400);
  await page.fill('#eiin', '108258');

  for (let attempt = 1; attempt <= 150; attempt++) {
    const captchaEl = await page.$('#captcha_img');
    if (!captchaEl) { console.log('No captcha element'); break; }

    await captchaEl.screenshot({ path: TEMP_CAP });
    const code = solveCapImg(TEMP_CAP);
    if (!code || code.length !== 4) {
      console.log(`Attempt ${attempt}: bad captcha code "${code}", reloading...`);
      await page.click('#captcha_reload');
      await sleep(1000);
      continue;
    }

    await page.fill('#captcha', code);

    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/v2/getres') && r.request().method() === 'POST', { timeout: 10000 }),
      page.click('#submit'),
    ]);

    let json;
    try { json = await response.json(); } catch (_) { json = null; }

    console.log(`\nAttempt ${attempt}: status=${json?.status}`);
    
    if (!json || Number(json.status) !== 0) {
      console.log('Response msg:', json?.msg);
      await page.click('#captcha_reload');
      await sleep(1000);
      continue;
    }

    // SUCCESS - dump the full response structure
    console.log('\n=== FULL RESPONSE KEYS ===');
    console.log('Top-level keys:', Object.keys(json));
    console.log('\n=== json.extra ===');
    console.log(JSON.stringify(json.extra, null, 2));
    console.log('\n=== json.extra.download ===');
    console.log(json.extra?.download);
    console.log('\n=== json.extra.view ===');
    console.log(json.extra?.view);

    // Save full response for inspection
    fs.writeFileSync(path.join(__dirname, 'debug_ajax_response.json'), JSON.stringify(json, null, 2));
    console.log('\nSaved full response to debug_ajax_response.json');
    break;
  }

  await browser.close();
})();
