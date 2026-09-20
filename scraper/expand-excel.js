// One-time restructure: turns the ssc/jsc sheets (one row per EIIN) into one
// row per EIIN x year within the valid range, and adds tracking columns
// (scrape_status, scrape_note) so the batch runner can resume safely.
// Skips sheets that are already expanded (idempotent).
const XLSX = require('xlsx');
const path = require('path');

const FILE = path.join(__dirname, '..', 'excel', 'ssc_jsc_results_scraped.xlsx');

const RANGES = {
  ssc: { start: 2011, end: 2026 },
  jsc: { start: 2011, end: 2019 },
};

const DATA_COLUMNS = [
  'eiin', 'exam', 'school_name_pulled', 'exam_year',
  'examinee_total', 'examinee_passed', 'examinee_gpa5', 'avg_gpa',
  'science_examinee_total', 'science_examinee_passed', 'science_examinee_gpa5', 'science_avg_gpa',
  'nonscience_examinee_total', 'nonscience_examinee_passed', 'nonscience_examinee_gpa5', 'nonscience_avg_gpa',
];
const TRACKING_COLUMNS = ['scrape_status', 'scrape_note'];
const ALL_COLUMNS = [...DATA_COLUMNS, ...TRACKING_COLUMNS];

function expandSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

  if (rows.length && Object.prototype.hasOwnProperty.call(rows[0], 'scrape_status')) {
    console.log(`Sheet "${sheetName}" already expanded (${rows.length} rows) — skipping.`);
    return;
  }

  const { start, end } = RANGES[sheetName];
  const expanded = [];
  for (const row of rows) {
    for (let year = start; year <= end; year++) {
      expanded.push({
        eiin: row.eiin,
        exam: row.exam,
        school_name_pulled: null,
        exam_year: year,
        examinee_total: null,
        examinee_passed: null,
        examinee_gpa5: null,
        avg_gpa: null,
        science_examinee_total: null,
        science_examinee_passed: null,
        science_examinee_gpa5: null,
        science_avg_gpa: null,
        nonscience_examinee_total: null,
        nonscience_examinee_passed: null,
        nonscience_examinee_gpa5: null,
        nonscience_avg_gpa: null,
        scrape_status: 'pending',
        scrape_note: null,
      });
    }
  }

  const newWs = XLSX.utils.json_to_sheet(expanded, { header: ALL_COLUMNS });
  wb.Sheets[sheetName] = newWs;
  console.log(`Sheet "${sheetName}": expanded ${rows.length} schools x ${end - start + 1} years = ${expanded.length} rows.`);
}

const wb = XLSX.readFile(FILE);
expandSheet(wb, 'ssc');
expandSheet(wb, 'jsc');
XLSX.writeFile(wb, FILE);
console.log('Saved', FILE);
