/**
 * scrape.js  ─  Full automated scraper for dhakaeducationboard.gov.bd
 *
 * Reads EIIN list from Excel, iterates every (eiin, year) combo,
 * auto-solves the CAPTCHA via solver.py, parses the result page text,
 * downloads the PDF, and writes results to Excel immediately.
 *
 * Usage:
 *   node scrape.js                    # scrape both SSC and JSC
 *   node scrape.js --exam ssc         # only SSC
 *   node scrape.js --exam jsc         # only JSC
 *   node scrape.js --resume           # skip already-saved records
 *   node scrape.js --exam ssc --resume
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs           = require('fs');
const path         = require('path');
const XLSX         = require('xlsx');
const { analyzeResultPdf } = require('./pdf-analyzer');

// ─── Paths ────────────────────────────────────────────────────────────────────
const SCRAPER_DIR = __dirname;
const EXCEL_PATH  = path.join(SCRAPER_DIR, '..', 'excel', 'ssc_jsc_results_scraped.xlsx');
const OUTPUT_DIR  = path.join(SCRAPER_DIR, '..', 'excel', 'scraped_json');
const PDF_DIR     = path.join(SCRAPER_DIR, '..', 'pdfs');
const SOLVER_PY   = path.join(SCRAPER_DIR, 'solver.py');
const TEMP_CAP    = path.join(SCRAPER_DIR, 'temp_captcha.png');
const BASE_URL    = 'https://result.dhakaeducationboard.gov.bd/v2/home';

// ─── Config ───────────────────────────────────────────────────────────────────
const MAX_ATTEMPTS = 150;   // max CAPTCHA retries per (eiin, year)
const DELAY_MS     = 600;   // polite delay between requests (ms)

const SSC_YEARS = ['2011','2012','2013','2014','2015','2016','2017',
                   '2018','2019','2020','2021','2022','2023','2024','2025','2026'];
const JSC_YEARS = ['2011','2012','2013','2014','2015','2016','2017','2018','2019'];

// ─── Excel column mapping (matches expand-excel.js / save_to_excel.py) ───────
const EXCEL_HEADER = [
  'eiin', 'exam', 'school_name_pulled', 'exam_year',
  'examinee_total', 'examinee_passed', 'examinee_gpa5', 'avg_gpa',
  'science_examinee_total', 'science_examinee_passed', 'science_examinee_gpa5', 'science_avg_gpa',
  'nonscience_examinee_total', 'nonscience_examinee_passed', 'nonscience_examinee_gpa5', 'nonscience_avg_gpa',
  'scrape_status', 'scrape_note',
];

// ─── CLI args ────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const examArg  = args.includes('--exam') ? args[args.indexOf('--exam') + 1].toLowerCase() : 'both';
const doResume = !args.includes('--fresh');  // resume by default, use --fresh to start over

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Persistent solver process: EasyOCR loads once instead of on every attempt.
let solver = null;
let solverBuf = '';
let solverWaiter = null;   // resolver for the line currently awaited

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
      await readSolverLine(120000);   // wait for "READY" (model load)
      if (!solver) return '';
    }
    const reply = readSolverLine(20000);
    solver.stdin.write(imgPath + '\n');
    const out = await reply;
    if (!out && solver) { solver.kill(); solver = null; }   // hung/timed out: restart next time
    return out;
  } catch (e) { return ''; }
}

// ─── Excel read/write helpers ────────────────────────────────────────────────
function loadExcelRows(sheetName) {
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

function saveExcelRows(sheetName, rows) {
  const wb = XLSX.readFile(EXCEL_PATH);
  wb.Sheets[sheetName] = XLSX.utils.json_to_sheet(rows, { header: EXCEL_HEADER });
  XLSX.writeFile(wb, EXCEL_PATH);
}

function findExcelRowIndex(rows, eiin, year) {
  return rows.findIndex(r => r.eiin === eiin && String(r.exam_year) === String(year));
}

function writeOneToExcel(sheetName, rows, rowIdx, data) {
  const row = rows[rowIdx];
  row.school_name_pulled     = data.school_name || null;
  row.examinee_total         = data.examinee_total || null;
  row.examinee_passed        = data.examinee_passed || null;
  row.examinee_gpa5          = data.examinee_gpa5 || null;
  row.avg_gpa                = data.avg_gpa || null;
  row.science_examinee_total = data.science_examinee_total || null;
  row.science_examinee_passed= data.science_examinee_passed || null;
  row.science_examinee_gpa5  = data.science_examinee_gpa5 || null;
  row.science_avg_gpa        = data.science_avg_gpa || null;
  row.nonscience_examinee_total = data.nonscience_examinee_total || null;
  row.nonscience_examinee_passed= data.nonscience_examinee_passed || null;
  row.nonscience_examinee_gpa5  = data.nonscience_examinee_gpa5 || null;
  row.nonscience_avg_gpa     = data.nonscience_avg_gpa || null;
  row.scrape_status           = 'done';
  row.scrape_note             = null;
  saveExcelRows(sheetName, rows);
}

function markExcelError(sheetName, rows, rowIdx, note, status = 'error') {
  const row = rows[rowIdx];
  row.scrape_status = status;
  row.scrape_note   = (note || 'unknown').slice(0, 200);
  saveExcelRows(sheetName, rows);
}

function parseResult(text) {
  const data = {};

  const nameMatch = text.match(/Institution:\s+(.+?)\s+\(EIIN:/);
  if (nameMatch) data.school_name = nameMatch[1].trim();

  const st = text.match(/Examinee:\s*(\d+),\s*Appeared:\s*(\d+),\s*Passed:\s*(\d+),\s*Percentage of Pass:\s*([\d.]+),\s*GPA 5:\s*(\d+)/);
  if (st) {
    data.examinee_total  = +st[1];
    data.examinee_appeared = +st[2];
    data.examinee_passed  = +st[3];
    data.pass_pct         = +st[4];
    data.examinee_gpa5    = +st[5];
  }

  const subjects = {};
  const re = /([A-Z][A-Z ]+):\s+PASSED=(\d+);\s+(?:NOT PASSED=(\d+);\s+)?GPA5=(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    subjects[m[1].trim()] = { passed: +m[2], not_passed: m[3] ? +m[3] : 0, gpa5: +m[4] };
  }
  data.subjects = subjects;

  let sciT = 0, sciP = 0, sciG = 0, nsT = 0, nsP = 0, nsG = 0;
  for (const [k, v] of Object.entries(subjects)) {
    const total = v.passed + v.not_passed;
    if (k.includes('SCIENCE')) {
      sciT += total; sciP += v.passed; sciG += v.gpa5;
    } else {
      nsT += total; nsP += v.passed; nsG += v.gpa5;
    }
  }
  if (sciT > 0) { data.science_examinee_total = sciT; data.science_examinee_passed = sciP; data.science_examinee_gpa5 = sciG; }
  if (nsT > 0)  { data.nonscience_examinee_total = nsT; data.nonscience_examinee_passed = nsP; data.nonscience_examinee_gpa5 = nsG; }

  return data;
}

async function reloadCaptcha(page) {
  try {
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/v2/captcha'), { timeout: 4000 }),
      page.click('#captcha_reload')
    ]);
  } catch (_) {
    await page.click('#captcha_reload');
    await sleep(900);
  }
}

// Download PDF by fetching the URL from the AJAX response (resp.extra.download)
// The site uses window.open(url) — NOT a browser download event.
async function downloadPdfFromUrl(page, pdfUrl, eiin, exam, year) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  const pdfPath = path.join(PDF_DIR, `${exam}_${eiin}_${year}.pdf`);
  try {
    // extra.download is a relative path (e.g. "/v2/pdl"); Playwright needs an absolute URL.
    const absUrl = new URL(pdfUrl, BASE_URL).href;
    // Use the page context to fetch the PDF (keeps session cookies)
    const response = await page.request.get(absUrl);
    if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
    const buffer = await response.body();
    if (buffer.slice(0, 4).toString() !== '%PDF') throw new Error('response is not a PDF');
    fs.writeFileSync(pdfPath, buffer);
    return pdfPath;
  } catch (e) {
    console.log(`  PDF download failed for ${eiin}: ${e.message}`);
    return null;
  }
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
    if (!captchaEl) {
      console.log(`    [CAPTCHA] Attempt ${attempt}: captcha element not found, aborting`);
      return null;
    }

    await captchaEl.screenshot({ path: TEMP_CAP });
    const code = await solveCapImg(TEMP_CAP);

    if (!code || code.length !== 4) {
      console.log(`    [CAPTCHA] Attempt ${attempt}: solver returned "${code || '(empty)'}" (invalid length=${code ? code.length : 0}) — reloading`);
      await reloadCaptcha(page);
      continue;
    }

    console.log(`    [CAPTCHA] Attempt ${attempt}: solved="${code}" — submitting...`);
    await page.fill('#captcha', code);

    // Intercept the AJAX response to get the PDF download URL
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/v2/getres') && r.request().method() === 'POST', { timeout: 10000 }),
      page.click('#submit'),
    ]);

    let json;
    try { json = await response.json(); } catch (_) { json = null; }

    if (!json || Number(json.status) !== 0) {
      // Wrong captcha or error — reload and try again
      const serverMsg = json ? (json.message || json.msg || `status=${json.status}`) : 'no response';
      // "No Result found" is only returned after the CAPTCHA was accepted: the EIIN has no
      // result for this exam/year, so retrying with new CAPTCHAs is pointless.
      if (/no result found/i.test(serverMsg)) {
        console.log(`    [CAPTCHA] Attempt ${attempt}: captcha OK but no result for this EIIN/year`);
        return { noResult: true, message: serverMsg };
      }
      console.log(`    [CAPTCHA] Attempt ${attempt}: ✗ MISMATCH (server: ${serverMsg}) — reloading`);
      await reloadCaptcha(page);
      continue;
    }

    console.log(`    [CAPTCHA] Attempt ${attempt}: ✓ MATCH — captcha accepted!`);

    // Success — parse the result from DOM
    try {
      await page.waitForFunction(
        () => { const e = document.getElementById('result_display'); return e && e.innerText && e.innerText.trim().length > 20; },
        undefined,
        { timeout: 5000 }
      );
      const resultText = await page.$eval('#result_display', el => el.innerText);
      const data = parseResult(resultText);

      // Download PDF using the URL from the AJAX response
      const pdfUrl = json.extra && json.extra.download;
      if (pdfUrl) {
        const pdfPath = await downloadPdfFromUrl(page, pdfUrl, eiin, exam, year);
        if (pdfPath) {
          try {
            const pdfData = await analyzeResultPdf(pdfPath);
            if (pdfData.ok) {
              data.avg_gpa = pdfData.avg_gpa;
              data.science_avg_gpa = pdfData.science_avg_gpa;
              data.nonscience_avg_gpa = pdfData.nonscience_avg_gpa;
              data.pdf_saved = pdfPath;
            }
          } catch (e) {
            data.pdf_parse_error = e.message.slice(0, 100);
          }
        }
      }

      return data;
    } catch (_) {
      console.log(`    [CAPTCHA] Attempt ${attempt}: captcha matched but result page failed to load — retrying`);
      await reloadCaptcha(page);
    }
  }
  console.log(`    [CAPTCHA] All ${MAX_ATTEMPTS} attempts exhausted`);
  return null;
}

// ─── Browser management (auto-recovery on crash) ────────────────────────────
async function launchBrowser() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page    = await context.newPage();
  return { browser, context, page };
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // JSON checkpoint (backup)
  const OUTPUT_FILE = path.join(OUTPUT_DIR, `results_${examArg}.json`);
  let results = {};
  if (doResume && fs.existsSync(OUTPUT_FILE)) {
    results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    console.log(`Resuming – ${Object.keys(results).length} entries already cached in JSON.`);
  }

  // Excel is the source of truth: one row per (eiin, year), so tasks come straight from its rows.
  console.log('Loading rows from Excel...');
  const excelData = {};  // sheetName -> rows[]
  if (examArg !== 'jsc') excelData.ssc = loadExcelRows('ssc');
  if (examArg !== 'ssc') excelData.jsc = loadExcelRows('jsc');

  const rKey = (e, ex, y) => `${e}|${ex}|${y}`;

  const tasks = [];
  const seen = new Set();
  for (const [exam, rows] of Object.entries(excelData)) {
    for (const row of rows) {
      if (row.eiin == null || row.exam_year == null) continue;
      const task = { eiin: row.eiin, exam, year: String(row.exam_year) };
      const k = rKey(task.eiin, exam, task.year);
      if (seen.has(k)) continue;
      seen.add(k);
      task.done = row.scrape_status === 'done' || row.scrape_status === 'no_result';
      tasks.push(task);
    }
  }

  // When resuming, skip rows already 'done' in Excel or successfully cached in JSON.
  // Rows marked 'error' (and JSON error entries) are retried.
  const remaining = tasks.filter(t => {
    if (!doResume) return true;
    if (t.done) return false;
    const cached = results[rKey(t.eiin, t.exam, t.year)];
    return !(cached && !cached.error);
  });

  console.log(`Tasks: ${tasks.length} total  |  ${remaining.length} to scrape  |  exam=${examArg}  |  resume=${doResume}`);
  if (remaining.length === 0) { console.log('Nothing to do.'); return; }

  let { browser, context, page } = await launchBrowser();

  let done = 0, ok = 0, fail = 0;
  const total = remaining.length;
  const t0 = Date.now();

  for (const { eiin, exam, year } of remaining) {
    const k = rKey(eiin, exam, year);
    const label = `[${done + 1}/${total}] ${exam.toUpperCase()} ${year} EIIN=${eiin}`;
    process.stdout.write(`${label} ... `);

    try {
      const data = await scrapeOne(page, eiin, exam, year);
      if (data && data.noResult) {
        results[k] = { eiin, exam, year, no_result: true, message: data.message, scraped_at: new Date().toISOString() };
        console.log('NO RESULT');

        const rows = excelData[exam];
        if (rows) {
          const rowIdx = findExcelRowIndex(rows, eiin, year);
          if (rowIdx >= 0) markExcelError(exam, rows, rowIdx, data.message, 'no_result');
        }
      } else if (data) {
        results[k] = { eiin, exam, year, ...data, scraped_at: new Date().toISOString() };
        ok++;
        console.log(`OK  ${data.school_name || ''}`);

        // ── Write to Excel immediately ──
        const rows = excelData[exam];
        if (rows) {
          const rowIdx = findExcelRowIndex(rows, eiin, year);
          if (rowIdx >= 0) {
            writeOneToExcel(exam, rows, rowIdx, data);
          }
        }
      } else {
        results[k] = { eiin, exam, year, error: 'captcha_failed', scraped_at: new Date().toISOString() };
        fail++;
        console.log('FAIL');

        const rows = excelData[exam];
        if (rows) {
          const rowIdx = findExcelRowIndex(rows, eiin, year);
          if (rowIdx >= 0) markExcelError(exam, rows, rowIdx, 'captcha_failed');
        }
      }
    } catch (err) {
      results[k] = { eiin, exam, year, error: err.message.slice(0, 120), scraped_at: new Date().toISOString() };
      fail++;
      console.log(`ERR  ${err.message.slice(0, 80)}`);

      const rows = excelData[exam];
      if (rows) {
        const rowIdx = findExcelRowIndex(rows, eiin, year);
        if (rowIdx >= 0) markExcelError(exam, rows, rowIdx, err.message);
      }

      // If browser/page crashed, relaunch
      if (err.message.includes('closed') || err.message.includes('crashed') || err.message.includes('Target page')) {
        console.log('  ⟳  Browser crashed — relaunching...');
        try { await browser.close(); } catch (_) {}
        ({ browser, context, page } = await launchBrowser());
      }
    }

    done++;
    // JSON checkpoint every 10
    if (done % 10 === 0 || done === total) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }
    if (done % 100 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      const eta = ((total - done) / (done / elapsed) / 60).toFixed(1);
      console.log(`\n─── ${done}/${total} done | OK:${ok} FAIL:${fail} | ETA ≈ ${eta} min ───\n`);
    }

    await sleep(DELAY_MS);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  await browser.close();
  if (solver) solver.kill();

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`DONE  |  ${done} scraped  |  OK: ${ok}  |  FAIL: ${fail}  |  ${mins} min`);
  console.log(`Output JSON: ${OUTPUT_FILE}`);
  console.log(`Output Excel: ${EXCEL_PATH}`);
})();
