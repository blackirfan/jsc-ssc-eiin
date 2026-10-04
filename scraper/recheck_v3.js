/**
 * recheck_v3.js — standalone live recheck of every "no_result" row in
 * final-check/excel/ssc_jsc_results_scraped_version_two.xlsx, for building
 * ssc_jsc_results_scraped_version_three.xlsx.
 *
 * Deliberately does NOT touch excel/ssc_jsc_results_scraped.xlsx (the master
 * sheet) at all — it only reads the version_two workbook for the task list,
 * downloads any newly-found PDF into pdfs/, and writes its own JSON
 * checkpoint. A separate Python step (build_version_three.py) later reads
 * that checkpoint + re-parses any new PDFs to fill version_three.xlsx.
 *
 * Usage:
 *   node recheck_v3.js                # full run, both exams, resumable
 *   node recheck_v3.js --exam ssc
 *   node recheck_v3.js --exam jsc
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs    = require('fs');
const path  = require('path');
const XLSX  = require('xlsx');

const SCRAPER_DIR   = __dirname;
const PROJECT_ROOT  = path.join(SCRAPER_DIR, '..');
const V2_EXCEL_PATH = path.join(PROJECT_ROOT, 'final-check', 'excel', 'ssc_jsc_results_scraped_version_two.xlsx');
const OUT_DIR       = path.join(PROJECT_ROOT, 'final-check', 'recheck_v3');
const PDF_DIR       = path.join(PROJECT_ROOT, 'pdfs');
const SOLVER_PY     = path.join(SCRAPER_DIR, 'solver.py');
const TEMP_CAP      = path.join(SCRAPER_DIR, 'temp_captcha_v3.png');
const BASE_URL      = 'https://result.dhakaeducationboard.gov.bd/v2/home';
const CHECKPOINT    = path.join(OUT_DIR, 'checkpoint.json');
const LOG_FILE      = path.join(OUT_DIR, 'recheck_v3.log');

const MAX_ATTEMPTS = 150;
const DELAY_MS     = 600;

const args    = process.argv.slice(2);
const examArg = args.includes('--exam') ? args[args.indexOf('--exam') + 1].toLowerCase() : 'both';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ─── Persistent CAPTCHA solver subprocess ───────────────────────────────────
let solver = null;
let solverBuf = '';
let solverWaiter = null;

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
  const dead = () => {
    solver = null;
    if (solverWaiter) { const w = solverWaiter; solverWaiter = null; w(''); }
  };
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
    if (!solver) {
      startSolver();
      await readSolverLine(120000);
      if (!solver) return '';
    }
    const reply = readSolverLine(20000);
    solver.stdin.write(imgPath + '\n');
    const out = await reply;
    if (!out && solver) { solver.kill(); solver = null; }
    return out;
  } catch (e) { return ''; }
}

// ─── PDF download (same approach as scrape.js) ──────────────────────────────
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
    log(`  PDF download failed for ${exam}/${eiin}/${year}: ${e.message}`);
    return null;
  }
}

async function reloadCaptcha(page) {
  try {
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/v2/captcha'), { timeout: 4000 }),
      page.click('#captcha_reload')
    ]);
  } catch (_) {
    await page.click('#captcha_reload');
  }
  await sleep(300);
}

function parseResultName(text) {
  const m = text.match(/Institution:\s+(.+?)\s+\(EIIN:/);
  return m ? m[1].trim() : null;
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
    if (!captchaEl) return { error: 'captcha_element_not_found' };

    await captchaEl.screenshot({ path: TEMP_CAP });
    const code = await solveCapImg(TEMP_CAP);

    if (!code || code.length !== 4) {
      await reloadCaptcha(page);
      continue;
    }

    await page.fill('#captcha', code);

    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/v2/getres') && r.request().method() === 'POST', { timeout: 10000 }),
      page.click('#submit'),
    ]);

    let json;
    try { json = await response.json(); } catch (_) { json = null; }

    if (!json || Number(json.status) !== 0) {
      const serverMsg = json ? (json.message || json.msg || `status=${json.status}`) : 'no response';
      if (/no result found/i.test(serverMsg)) {
        return { noResult: true, message: serverMsg };
      }
      await reloadCaptcha(page);
      continue;
    }

    try {
      await page.waitForFunction(
        () => { const e = document.getElementById('result_display'); return e && e.innerText && e.innerText.trim().length > 20; },
        undefined,
        { timeout: 5000 }
      );
      const resultText = await page.$eval('#result_display', el => el.innerText);
      const school_name = parseResultName(resultText);

      const pdfUrl = json.extra && json.extra.download;
      let pdf_saved = null;
      if (pdfUrl) {
        pdf_saved = await downloadPdfFromUrl(page, pdfUrl, eiin, exam, year);
      }
      return { found: true, school_name, pdf_saved };
    } catch (_) {
      await reloadCaptcha(page);
    }
  }
  return { error: 'captcha_attempts_exhausted' };
}

async function launchBrowser() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page    = await context.newPage();
  return { browser, context, page };
}

// ─── Task list: no_result rows from version_two.xlsx ────────────────────────
function loadNoResultTasks() {
  const wb = XLSX.readFile(V2_EXCEL_PATH);
  const tasks = [];
  for (const sheetName of ['ssc', 'jsc']) {
    if (examArg !== 'both' && examArg !== sheetName) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    for (const row of rows) {
      if (row.eiin == null || row.exam_year == null) continue;
      if (row.scrape_status !== 'no_result') continue;
      tasks.push({ eiin: row.eiin, exam: sheetName, year: String(row.exam_year) });
    }
  }
  return tasks;
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let checkpoint = {};
  if (fs.existsSync(CHECKPOINT)) {
    checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
    log(`Resuming — ${Object.keys(checkpoint).length} entries already in checkpoint.`);
  }

  const tasks = loadNoResultTasks();
  const rKey = (e, ex, y) => `${e}|${ex}|${y}`;

  const remaining = tasks.filter(t => !checkpoint[rKey(t.eiin, t.exam, t.year)]);
  log(`Tasks: ${tasks.length} total no_result rows | ${remaining.length} remaining to recheck | exam=${examArg}`);
  if (remaining.length === 0) { log('Nothing to do.'); return; }

  let { browser, context, page } = await launchBrowser();
  let done = 0, found = 0, confirmedNoResult = 0, errored = 0;
  const total = remaining.length;
  const t0 = Date.now();

  for (const { eiin, exam, year } of remaining) {
    const k = rKey(eiin, exam, year);
    try {
      const result = await scrapeOne(page, eiin, exam, year);
      checkpoint[k] = { eiin, exam, year, ...result, checked_at: new Date().toISOString() };
      if (result.found) { found++; log(`[${done + 1}/${total}] ${exam.toUpperCase()} ${year} EIIN=${eiin} -> FOUND (${result.school_name || ''}) pdf=${result.pdf_saved ? 'saved' : 'FAILED'}`); }
      else if (result.noResult) { confirmedNoResult++; }
      else { errored++; log(`[${done + 1}/${total}] ${exam.toUpperCase()} ${year} EIIN=${eiin} -> ERROR: ${result.error}`); }
    } catch (err) {
      errored++;
      checkpoint[k] = { eiin, exam, year, error: err.message.slice(0, 200), checked_at: new Date().toISOString() };
      log(`[${done + 1}/${total}] ${exam.toUpperCase()} ${year} EIIN=${eiin} -> EXCEPTION: ${err.message.slice(0, 120)}`);
      if (err.message.includes('closed') || err.message.includes('crashed') || err.message.includes('Target page')) {
        log('  Browser crashed — relaunching...');
        try { await browser.close(); } catch (_) {}
        ({ browser, context, page } = await launchBrowser());
      }
    }

    done++;
    if (done % 10 === 0 || done === total) {
      fs.writeFileSync(CHECKPOINT, JSON.stringify(checkpoint, null, 2));
    }
    if (done % 50 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      const eta = ((total - done) / (done / elapsed) / 60).toFixed(1);
      log(`─── ${done}/${total} | found=${found} confirmed_no_result=${confirmedNoResult} errored=${errored} | ETA ≈ ${eta} min ───`);
    }
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(CHECKPOINT, JSON.stringify(checkpoint, null, 2));
  const totalMin = ((Date.now() - t0) / 60000).toFixed(1);
  log(`=== DONE === ${done} rechecked | found=${found} confirmed_no_result=${confirmedNoResult} errored=${errored} | ${totalMin} min`);

  try { await browser.close(); } catch (_) {}
  if (solver) { try { solver.kill(); } catch (_) {} }
})();
