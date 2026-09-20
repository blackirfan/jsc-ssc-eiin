// Parses a Dhaka Education Board "Institution Result" PDF (as downloaded by
// test-single.js / the batch scraper) into the exact columns needed for
// ssc_jsc_results_scraped.xlsx.
//
// PDF text layout per subject group, e.g.:
//   ---- : SCIENCE : ----
//   109024[5.00], 109025[5.00], ... =77      <- passed roll[gpa], trailing "=count"
//   109074[F1 ], 109088[F4 ], 109090[F1 ] =3 <- failed roll[Fcode], trailing "=count"
// A group may continue onto a later page as "SCIENCE (CONTD.)" — treated as
// the same group. Non-SCIENCE groups (BUSINESS STUDIES, HUMANITIES, ...) are
// summed into "nonscience" per the workbook's instructions sheet.

const { PDFParse } = require('pdf-parse');
const fs = require('fs');

const HEADER_RE =
  /No\. of Students:\s*\{\s*Examinee:\s*(\d+),\s*Appeared:\s*(\d+),\s*Passed:\s*(\d+),\s*Percentage of Pass:\s*([\d.]+),\s*GPA 5:\s*(\d+)\s*\}/;
const INSTITUTION_RE = /Institution:\s*(.+?)\s*\(EIIN:\s*(\d+)\)/;
const GROUP_HEADER_RE = /-{2,}\s*:\s*([A-Z .&]+?)(?:\s*\(CONTD\.?\))?\s*:\s*-{2,}/g;
const STUDENT_RE = /(\d{4,7})\[([^\]]*)\]/g;

function normalizeGroupName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

function parseResultPdfText(text) {
  const headerMatch = HEADER_RE.exec(text);
  const instMatch = INSTITUTION_RE.exec(text);

  if (!headerMatch) {
    return { ok: false, error: 'Could not find the "No. of Students" summary line in the PDF text.' };
  }

  const examinee_total = Number(headerMatch[1]);
  const examinee_appeared = Number(headerMatch[2]);
  const examinee_passed = Number(headerMatch[3]);
  const pass_pct = Number(headerMatch[4]);
  const examinee_gpa5 = Number(headerMatch[5]);
  const school_name = instMatch ? instMatch[1].trim() : null;
  const eiin = instMatch ? Number(instMatch[2]) : null;

  // Split the text into per-group chunks using the group header markers.
  const headers = [...text.matchAll(GROUP_HEADER_RE)];
  const groups = {}; // name -> { passedCount, failedCount, gpaSum, gpa5Count }

  for (let i = 0; i < headers.length; i++) {
    const name = normalizeGroupName(headers[i][1]);
    const start = headers[i].index + headers[i][0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : text.length;
    const chunk = text.slice(start, end);

    if (!groups[name]) groups[name] = { passedCount: 0, failedCount: 0, gpaSum: 0, gpa5Count: 0 };
    const g = groups[name];

    let m;
    STUDENT_RE.lastIndex = 0;
    while ((m = STUDENT_RE.exec(chunk)) !== null) {
      const raw = m[2].trim();
      if (/^F/i.test(raw)) {
        g.failedCount += 1;
      } else {
        const gpa = parseFloat(raw);
        if (!Number.isNaN(gpa)) {
          g.passedCount += 1;
          g.gpaSum += gpa;
          if (gpa >= 5.0) g.gpa5Count += 1;
        }
      }
    }
  }

  // Aggregate into science / nonscience per the workbook's instructions
  // ("non-science = business studies, humanities").
  const agg = (predicate) => {
    let total = 0, passed = 0, gpa5 = 0, gpaSum = 0;
    for (const [name, g] of Object.entries(groups)) {
      if (!predicate(name)) continue;
      total += g.passedCount + g.failedCount;
      passed += g.passedCount;
      gpa5 += g.gpa5Count;
      gpaSum += g.gpaSum;
    }
    return { total, passed, gpa5, gpaSum };
  };

  const science = agg((name) => name.includes('SCIENCE') && !name.includes('BUSINESS'));
  const nonscience = agg((name) => !(name.includes('SCIENCE') && !name.includes('BUSINESS')));

  const overallGpaSum = science.gpaSum + nonscience.gpaSum;

  const round2 = (n) => Math.round(n * 100) / 100;

  return {
    ok: true,
    eiin,
    school_name,
    examinee_total,
    examinee_appeared,
    examinee_passed,
    pass_pct,
    examinee_gpa5,
    avg_gpa: examinee_total ? round2(overallGpaSum / examinee_total) : null,
    science_examinee_total: science.total,
    science_examinee_passed: science.passed,
    science_examinee_gpa5: science.gpa5,
    science_avg_gpa: science.total ? round2(science.gpaSum / science.total) : null,
    nonscience_examinee_total: nonscience.total,
    nonscience_examinee_passed: nonscience.passed,
    nonscience_examinee_gpa5: nonscience.gpa5,
    nonscience_avg_gpa: nonscience.total ? round2(nonscience.gpaSum / nonscience.total) : null,
    groups_raw: Object.fromEntries(
      Object.entries(groups).map(([k, v]) => [
        k,
        { passed: v.passedCount, failed: v.failedCount, total: v.passedCount + v.failedCount, gpa5: v.gpa5Count },
      ])
    ),
  };
}

async function analyzeResultPdf(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: buf });
  const { text } = await parser.getText();
  return parseResultPdfText(text);
}

module.exports = { parseResultPdfText, analyzeResultPdf };

// CLI usage: node pdf-analyzer.js <path-to-pdf>
if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node pdf-analyzer.js <path-to-pdf>');
    process.exit(1);
  }
  analyzeResultPdf(target).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((e) => {
    console.error('Failed to analyze PDF:', e);
    process.exit(1);
  });
}
