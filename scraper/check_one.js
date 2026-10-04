/**
 * check_one.js — one-off direct check of a single (eiin, exam, year), run
 * alongside recheck_v3.js without touching its checkpoint or temp files.
 * Usage: node check_one.js <eiin> <exam> <year>
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs    = require('fs');
const path  = require('path');

const SCRAPER_DIR = __dirname;
const PROJECT_ROOT = path.join(SCRAPER_DIR, '..');
const PDF_DIR = path.join(PROJECT_ROOT, 'pdfs');
const SOLVER_PY = path.join(SCRAPER_DIR, 'solver.py');
const TEMP_CAP = path.join(SCRAPER_DIR, 'temp_captcha_one.png');
const BASE_URL = 'https://result.dhakaeducationboard.gov.bd/v2/home';
const MAX_ATTEMPTS = 150;

const [, , eiinArg, examArg, yearArg] = process.argv;
if (!eiinArg || !examArg || !yearArg) {
  console.error('Usage: node check_one.js <eiin> <exam> <year>');
  process.exit(1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let solver = null, solverBuf = '', solverWaiter = null;
function startSolver() {
  solverBuf = '';
  solver = spawn('python', [SOLVER_PY, '--serve'], { stdio: ['pipe', 'pipe', 'ignore'] });
  solver.stdout.setEncoding('utf8');
  solver.stdout.on('data', chunk => {
    solverBuf += chunk;
    let i;
    while ((i = solverBuf.indexOf('\n')) >= 0) {
      const line = solverBuf.slice(0, i).trim();
      solverBuf = solverBuf.slice(i + 1);
      if (solverWaiter) { const w = solverWaiter; solverWaiter = null; w(line); }
    }
  });
  const dead = () => { solver = null; if (solverWaiter) { const w = solverWaiter; solverWaiter = null; w(''); } };
  solver.on('exit', dead);
  solver.on('error', dead);
}
function readSolverLine(timeoutMs) {
  return new Promise(resolve => {
    const t = setTimeout(() => { solverWaiter = null; resolve(''); }, timeoutMs);
    solverWaiter = line => { clearTimeout(t); resolve(line); };
  });
}
async function solveCapImg(imgPath) {
  try {
    if (!solver) { startSolver(); await readSolverLine(120000); if (!solver) return ''; }
    const reply = readSolverLine(20000);
    solver.stdin.write(imgPath + '\n');
    const out = await reply;
    if (!out && solver) { solver.kill(); solver = null; }
    return out;
  } catch (e) { return ''; }
}

async function downloadPdfFromUrl(page, pdfUrl, eiin, exam, year) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  const pdfPath = path.join(PDF_DIR, `${exam}_${eiin}_${year}.pdf`);
  try {
    const absUrl = new URL(pdfUrl, BASE_URL).href;
    const response = await page.request.get(absUrl);
    if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
    const buffer = await response.body();
    if (buffer.slice(0, 4).toString() !== '%PDF') throw new Error('response is not a PDF');
    fs.writeFileSync(pdfPath, buffer);
    return pdfPath;
  } catch (e) {
    console.log(`  PDF download failed: ${e.message}`);
    return null;
  }
}

async function reloadCaptcha(page) {
  try {
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/v2/captcha'), { timeout: 4000 }),
      page.click('#captcha_reload')
    ]);
  } catch (_) { await page.click('#captcha_reload'); }
  await sleep(300);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const eiin = eiinArg, exam = examArg, year = yearArg;
  console.log(`Checking ${exam.toUpperCase()} ${year} EIIN=${eiin} ...`);

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (_) { await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 }); }

  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', exam);
  await page.selectOption('#year', year);
  await sleep(400);
  await page.selectOption('#result_type', '2');
  await page.waitForSelector('#eiin', { state: 'visible', timeout: 20000 });
  await sleep(600);
  await page.fill('#eiin', String(eiin));

  let outcome = { error: 'captcha_attempts_exhausted' };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const captchaEl = await page.$('#captcha_img');
    if (!captchaEl) { outcome = { error: 'captcha_element_not_found' }; break; }
    await captchaEl.screenshot({ path: TEMP_CAP });
    const code = await solveCapImg(TEMP_CAP);
    if (!code || code.length !== 4) { await reloadCaptcha(page); continue; }
    console.log(`  attempt ${attempt}: solved="${code}"`);
    await page.fill('#captcha', code);
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/v2/getres') && r.request().method() === 'POST', { timeout: 10000 }),
      page.click('#submit'),
    ]);
    let json;
    try { json = await response.json(); } catch (_) { json = null; }
    if (!json || Number(json.status) !== 0) {
      const serverMsg = json ? (json.message || json.msg || `status=${json.status}`) : 'no response';
      if (/no result found/i.test(serverMsg)) { outcome = { noResult: true, message: serverMsg }; break; }
      console.log(`  attempt ${attempt}: mismatch (${serverMsg})`);
      await reloadCaptcha(page);
      continue;
    }
    try {
      await page.waitForFunction(
        () => { const e = document.getElementById('result_display'); return e && e.innerText && e.innerText.trim().length > 20; },
        undefined, { timeout: 5000 }
      );
      const resultText = await page.$eval('#result_display', el => el.innerText);
      const m = resultText.match(/Institution:\s+(.+?)\s+\(EIIN:/);
      const school_name = m ? m[1].trim() : null;
      const pdfUrl = json.extra && json.extra.download;
      let pdf_saved = null;
      if (pdfUrl) pdf_saved = await downloadPdfFromUrl(page, pdfUrl, eiin, exam, year);
      outcome = { found: true, school_name, pdf_saved };
      break;
    } catch (_) {
      await reloadCaptcha(page);
    }
  }

  console.log('RESULT:', JSON.stringify(outcome));
  try { await browser.close(); } catch (_) {}
  if (solver) { try { solver.kill(); } catch (_) {} }
})();
