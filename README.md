# JSC/SSC Result Scraper — Dhaka Education Board

Scrapes SSC (2011–2026) and JSC (2011–2019) institution-level result summaries
from `result.dhakaeducationboard.gov.bd` for every EIIN listed in the workbook,
solving the site's CAPTCHA automatically, and writes the parsed numbers back
into an Excel workbook.

## Directory layout

```
excel/
  ssc_jsc_results_scraped.xlsx   Source of truth: one row per (eiin, exam_year)
  scraped_json/                 JSON checkpoints (resume safety net, not authoritative)
pdfs/                           Downloaded per-institution result PDFs (exam_eiin_year.pdf)
scraper/
  scrape.js                     Main driver (Playwright browser automation)
  solver.py                     CAPTCHA OCR solver (EasyOCR), run as a long-lived subprocess
  pdf-analyzer.js                Parses a downloaded result PDF into GPA/pass-rate columns
```

## Excel schema

Two data sheets, `ssc` and `jsc`, both using this column order:

| Column | Meaning |
|---|---|
| `eiin` | Institution ID (input, from the original EIIN list) |
| `exam` | `SSC` or `JSC` |
| `school_name_pulled` | Institution name as returned by the board's site |
| `exam_year` | Year of the exam |
| `examinee_total` / `examinee_passed` / `examinee_gpa5` / `avg_gpa` | Overall stats |
| `science_examinee_*`, `nonscience_examinee_*` | Same stats split by group (non-science = business studies + humanities, per the `instructions` sheet) |
| `scrape_status` | `done` \| `no_result` \| `error` (see below) |
| `scrape_note` | Error/board message when status isn't `done` |

`scrape_status` values:
- **`done`** — result found and parsed successfully.
- **`no_result`** — CAPTCHA was accepted by the board's site, but it explicitly
  responded "No Result Found" for that EIIN/year. Not a scraper failure — the
  board has no record.
- **`error`** — scrape didn't get a clean answer (CAPTCHA solver exhausted its
  retries, browser crash, network error, etc.). Ambiguous; worth retrying.

A third sheet, `instructions`, documents the science/non-science grouping rule
and the average-GPA formula (failed examinees count as GPA 0).

## Running the scraper

```
cd scraper
node scrape.js                        # scrape both SSC and JSC, resuming by default
node scrape.js --exam ssc             # only SSC
node scrape.js --exam jsc             # only JSC
node scrape.js --fresh                # ignore JSON checkpoint, re-scrape everything not "done"/"no_result" in Excel
node scrape.js --recheck-no-result    # re-scrape ONLY rows currently marked scrape_status="no_result"
node scrape.js --recheck-no-result --exam ssc   # ...limited to one exam
```

Excel is the source of truth: on every run, rows are read fresh from
`ssc_jsc_results_scraped.xlsx`, and each row is written back **immediately**
after it's scraped (not just at the end), so a crash never loses more than the
row in progress.

By default (no flags), a run skips any row already `done` or `no_result` and
retries anything else (`error` rows, or rows missing from the sheet's status
entirely). `--recheck-no-result` is the exception: it targets exactly the rows
stuck at `no_result` and re-checks them against the live site, in case the
board has since published or corrected a result. It's naturally resumable —
since it re-reads Excel each run, any row already fixed by an earlier recheck
pass now shows `done` and gets skipped automatically.

JSON checkpoints under `excel/scraped_json/` (`results_ssc.json`,
`results_jsc.json`, `results_recheck_*.json`) are a resume safety net only —
Excel is authoritative.

### How one row is scraped

1. Fill in board=`dhaka`, exam, year, EIIN on the site's form.
2. Screenshot the CAPTCHA image, pipe it to `solver.py --serve` (a persistent
   process — EasyOCR's model loads once, not per attempt) to get a 4-digit
   guess.
3. Submit; if the board rejects the CAPTCHA, reload and retry (up to
   `MAX_ATTEMPTS = 150`). A "No Result Found" response is treated as final —
   the CAPTCHA was valid, so retrying won't change the answer.
4. On success, parse the on-page result text and download the official PDF
   (URL comes from the AJAX response, not a browser download event).
5. Run `pdf-analyzer.js` on the PDF to extract `avg_gpa` /
   `science_avg_gpa` / `nonscience_avg_gpa` (these need the per-student GPA
   list, which isn't on the results page itself).
6. Write everything back to the matching Excel row and mark it `done`.

## Current status (as of the last recheck, 2026-09-26)

- SSC: 6663 `done`, 1059 `no_result`, 6 `error`
- JSC: 3766 `done`, 579 `no_result`, 2 `error`

All 1646 rows that were `no_result` were re-checked against the live site;
none had a result available (0 newly found). 8 rows (6 SSC + 2 JSC) couldn't
get a clean answer during the recheck and are marked `error` — a plain
`node scrape.js --resume` (no special flags) will retry just those.

## Requirements

- Node.js with `playwright`, `xlsx`, `pdf-parse` (see `scraper/package.json`)
- Python 3 with `easyocr`, `opencv-python`, `numpy` for `solver.py`
- Playwright's Chromium browser installed (`npx playwright install chromium`)
