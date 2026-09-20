// Human-in-the-loop CAPTCHA handler for result.dhakaeducationboard.gov.bd.
//
// The site is an AJAX SPA: submitting the form POSTs to /v2/getres and
// returns JSON: { status, msg, res }. Empirically status !== 0 with a
// non-empty msg mentioning the security key/captcha means a wrong CAPTCHA
// was entered (the image auto-refreshes on the page after this); a
// successful lookup returns the result HTML in `res`.
//
// This module NEVER reads or fills the CAPTCHA value itself — it only
// detects state (image loaded / wrong attempt / success / timeout) and
// waits for a human to type the digits and submit.

const GETRES_URL_FRAGMENT = '/v2/getres';

function log(...args) {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '');
  console.log(`[captcha ${ts}]`, ...args);
}

async function waitForImageLoaded(page, timeoutMs = 15000) {
  await page.waitForFunction(
    () => {
      const img = document.getElementById('captcha_img');
      return img && img.complete && img.naturalWidth > 0;
    },
    undefined,
    { timeout: timeoutMs }
  );
}

/**
 * Wait for the human to solve the CAPTCHA for one search, retrying as many
 * times as needed (each wrong attempt clears/refocuses the input) until
 * either the lookup succeeds, a hard attempt cap is hit, or the overall
 * timeout expires.
 *
 * @param {import('playwright').Page} page
 * @param {{exam: string, year: string|number, eiin: string|number}} ctx
 * @param {{timeoutMs?: number, maxAttempts?: number}} [options]
 * @returns {Promise<{ result: 'SUCCESS'|'CAPTCHA_TIMEOUT'|'CAPTCHA_FAILED', responseJson?: any }>}
 */
async function handleCaptcha(page, ctx, options = {}) {
  const { exam, year, eiin } = ctx;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const maxAttempts = options.maxAttempts ?? 15;

  const captchaVisible = await page.isVisible('#captcha_img').catch(() => false);
  if (!captchaVisible) {
    log('No CAPTCHA present on this page, nothing to do.');
    return { result: 'SUCCESS' };
  }

  log('Waiting for CAPTCHA image to finish loading...');
  try {
    await waitForImageLoaded(page);
  } catch (e) {
    log('CAPTCHA image did not finish loading in time:', e.message);
  }

  await page.focus('#captcha').catch(() => {});

  console.log('\n' + '='.repeat(50));
  console.log('CAPTCHA REQUIRED');
  console.log(`Exam: ${exam}`);
  console.log(`Year: ${year}`);
  console.log(`EIIN: ${eiin}`);
  console.log('='.repeat(50) + '\n');

  const startedAt = Date.now();
  let attempts = 0;

  while (true) {
    const elapsed = Date.now() - startedAt;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      log(`Timed out after ${Math.round(elapsed / 1000)}s waiting for a valid CAPTCHA (exam=${exam} year=${year} eiin=${eiin}).`);
      return { result: 'CAPTCHA_TIMEOUT' };
    }
    if (attempts >= maxAttempts) {
      log(`Gave up after ${attempts} wrong CAPTCHA attempts (exam=${exam} year=${year} eiin=${eiin}).`);
      return { result: 'CAPTCHA_FAILED' };
    }

    log(`Waiting for form submission... (attempt ${attempts + 1}/${maxAttempts}, ${Math.round(remaining / 1000)}s left)`);

    let response;
    try {
      response = await page.waitForResponse(
        (res) => res.url().includes(GETRES_URL_FRAGMENT) && res.request().method() === 'POST',
        { timeout: remaining }
      );
    } catch (e) {
      log(`Timed out waiting for submission (exam=${exam} year=${year} eiin=${eiin}).`);
      return { result: 'CAPTCHA_TIMEOUT' };
    }

    attempts += 1;

    let json;
    try {
      json = await response.json();
    } catch (e) {
      log('Could not parse /v2/getres response as JSON:', e.message);
      json = null;
    }

    const looksLikeCaptchaError =
      json &&
      Number(json.status) !== 0 &&
      typeof json.msg === 'string' &&
      /captcha|security key/i.test(json.msg);

    const looksLikeSuccess = json && Number(json.status) === 0;

    if (looksLikeSuccess) {
      log(`CAPTCHA accepted on attempt ${attempts}. Result received (exam=${exam} year=${year} eiin=${eiin}).`);
      return { result: 'SUCCESS', responseJson: json };
    }

    if (looksLikeCaptchaError) {
      log(`Attempt ${attempts} rejected: "${json.msg}". A new CAPTCHA image should now be showing — please try again.`);
      try {
        await page.fill('#captcha', '');
        await waitForImageLoaded(page, 10000).catch(() => {});
        await page.focus('#captcha');
      } catch (e) {
        log('Warning: could not reset captcha input/focus:', e.message);
      }
      continue;
    }

    // Unknown / unexpected response shape — surface it but don't assume
    // success, and don't loop forever on something that isn't a captcha
    // error either.
    log('Unexpected response from server, treating as failure:', JSON.stringify(json).slice(0, 300));
    return { result: 'CAPTCHA_FAILED', responseJson: json };
  }
}

module.exports = { handleCaptcha };
