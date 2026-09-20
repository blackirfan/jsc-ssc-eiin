// Batch runner: for each pending row in the ssc/jsc sheet, drives the
// result form, lets a human solve the CAPTCHA (via handleCaptcha), then
// downloads + analyzes the result PDF and writes the columns back into
// ssc_jsc_results_scraped.xlsx. Safe to stop (Ctrl+C) and resume anytime —
// progress is checkpointed to the xlsx after every row.
//
// Usage:
//   node batch.js --exam ssc [--limit 50] [--eiin 108019]

const { chromium } = require('playwright');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { handleCaptcha } = require('./captcha-handler');
const { analyzeResultPdf } = require('./pdf-analyzer');

const FILE = path.join(__dirname, '..', 'excel', 'ssc_jsc_results_scraped.xlsx');
const PDF_DIR = path.join(__dirname, '..', 'pdfs');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { exam: null, limit: Infinity, eiin: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exam') out.exam = args[++i];
    else if (args[i] === '--limit') out.limit = Number(args[++i]);
    else if (args[i] === '--eiin') out.eiin = Number(args[++i]);
  }
  if (!out.exam || !['ssc', 'jsc'].includes(out.exam)) {
    console.error('Usage: node batch.js --exam ssc|jsc [--limit N] [--eiin N]');
    process.exit(1);
  }
  return out;
}

function loadWorkbook() {
  return XLSX.readFile(FILE);
}

function saveWorkbook(wb) {
  XLSX.writeFile(wb, FILE);
}

function sheetToRows(wb, sheetName) {
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
}

function rowsToSheet(wb, sheetName, rows) {
  const header = [
    'eiin', 'exam', 'school_name_pulled', 'exam_year',
    'examinee_total', 'examinee_passed', 'examinee_gpa5', 'avg_gpa',
    'science_examinee_total', 'science_examinee_passed', 'science_examinee_gpa5', 'science_avg_gpa',
    'nonscience_examinee_total', 'nonscience_examinee_passed', 'nonscience_examinee_gpa5', 'nonscience_avg_gpa',
    'scrape_status', 'scrape_note',
  ];
  wb.Sheets[sheetName] = XLSX.utils.json_to_sheet(rows, { header });
}

async function lookupOne(page, { exam, year, eiin }) {
  await page.goto('https://result.dhakaeducationboard.gov.bd/v2/home', { waitUntil: 'networkidle' });
  await page.selectOption('#board', 'dhaka');
  await page.selectOption('#exam', exam);
  await page.selectOption('#year', String(year));
  await page.waitForTimeout(300);
  await page.selectOption('#result_type', '2'); // Institution Result
  await page.waitForTimeout(300);
  await page.fill('#eiin', String(eiin));

  const outcome = await handleCaptcha(page, { exam, year, eiin }, { timeoutMs: 5 * 60 * 1000 });
  return outcome;
}

async function downloadPdf(page, { exam, year, eiin }) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  const pdfPath = path.join(PDF_DIR, `${exam}_${eiin}_${year}.pdf`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#download'),
  ]);
  await download.saveAs(pdfPath);
  return pdfPath;
}

function applyAnalysis(row, analysis) {
  row.school_name_pulled = analysis.school_name;
  row.examinee_total = analysis.examinee_total;
  row.examinee_passed = analysis.examinee_passed;
  row.examinee_gpa5 = analysis.examinee_gpa5;
  row.avg_gpa = analysis.avg_gpa;
  row.science_examinee_total = analysis.science_examinee_total;
  row.science_examinee_passed = analysis.science_examinee_passed;
  row.science_examinee_gpa5 = analysis.science_examinee_gpa5;
  row.science_avg_gpa = analysis.science_avg_gpa;
  row.nonscience_examinee_total = analysis.nonscience_examinee_total;
  row.nonscience_examinee_passed = analysis.nonscience_examinee_passed;
  row.nonscience_examinee_gpa5 = analysis.nonscience_examinee_gpa5;
  row.nonscience_avg_gpa = analysis.nonscience_avg_gpa;
}

(async () => {
  const { exam, limit, eiin: onlyEiin } = parseArgs();

  const wb = loadWorkbook();
  let rows = sheetToRows(wb, exam);

  let pending = rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => row.scrape_status === 'pending' && (!onlyEiin || row.eiin === onlyEiin));

  if (pending.length === 0) {
    console.log(`No pending rows for exam=${exam}${onlyEiin ? ` eiin=${onlyEiin}` : ''}. Nothing to do.`);
    return;
  }
  if (limit < pending.length) pending = pending.slice(0, limit);

  console.log(`${pending.length} pending row(s) to process for exam=${exam}.`);

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null, acceptDownloads: true });
  const page = await context.newPage();

  let processed = 0;
  for (const { row, idx } of pending) {
    processed += 1;
    console.log(`\n[${processed}/${pending.length}] eiin=${row.eiin} exam=${exam} year=${row.exam_year}`);

    let outcome;
    try {
      outcome = await lookupOne(page, { exam, year: row.exam_year, eiin: row.eiin });
    } catch (e) {
      console.log('Navigation/form error:', e.message);
      row.scrape_status = 'error';
      row.scrape_note = `nav_error: ${e.message}`.slice(0, 200);
      rowsToSheet(wb, exam, rows);
      saveWorkbook(wb);
      continue;
    }

    if (outcome.result === 'CAPTCHA_TIMEOUT') {
      console.log('CAPTCHA timed out — stopping batch here. Progress saved; rerun the same command to resume.');
      break;
    }

    if (outcome.result === 'CAPTCHA_FAILED') {
      const msg = outcome.responseJson && outcome.responseJson.msg;
      const isCaptchaIssue = msg && /captcha|security key/i.test(msg);
      row.scrape_status = isCaptchaIssue ? 'error' : 'no_result';
      row.scrape_note = (msg || 'unknown failure').slice(0, 200);
      console.log('Row marked', row.scrape_status, '-', row.scrape_note);
      rowsToSheet(wb, exam, rows);
      saveWorkbook(wb);
      continue;
    }

    // SUCCESS
    try {
      const pdfPath = await downloadPdf(page, { exam, year: row.exam_year, eiin: row.eiin });
      const analysis = await analyzeResultPdf(pdfPath);
      if (!analysis.ok) {
        row.scrape_status = 'error';
        row.scrape_note = `pdf_parse_error: ${analysis.error}`.slice(0, 200);
      } else {
        applyAnalysis(row, analysis);
        row.scrape_status = 'done';
        row.scrape_note = null;
        console.log('Saved:', row.school_name_pulled, '| examinees:', row.examinee_total, '| avg_gpa:', row.avg_gpa);
      }
    } catch (e) {
      row.scrape_status = 'error';
      row.scrape_note = `pdf_download_error: ${e.message}`.slice(0, 200);
      console.log('PDF step failed:', e.message);
    }

    rowsToSheet(wb, exam, rows);
    saveWorkbook(wb);
    await page.waitForTimeout(800);
  }

  console.log(`\nDone this session. Processed ${processed} row(s).`);
  await browser.close();
})();
