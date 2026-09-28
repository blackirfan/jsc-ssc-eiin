# Final-check work log

Purpose: track what's been done auditing `excel/ssc_jsc_results_scraped.xlsx`
against the source PDFs in `pdfs/`, and what's left. Update this file as work
continues (don't just rely on chat history).

## Status: audit complete, corrected excel produced, original left untouched

## Done

1. Inventoried inputs: 10,415 PDFs (`ssc_<eiin>_<year>.pdf` x 6,649,
   `jsc_<eiin>_<year>.pdf` x 3,766), excel has `ssc` (7,728 rows) and `jsc`
   (4,347 rows) sheets + an `instructions` sheet with the rules to check
   against (non-science = business studies + humanities combined; avg GPA =
   sum/total examinees, failed = 0).
2. Wrote `scripts/audit.py`: parses every PDF (all pages — result sheets for
   large schools span multiple pages with "GROUPNAME (CONTD.)" headers),
   recomputes examinee/pass/GPA-5 counts and average GPA per the
   instructions sheet's rules, and diffs against the matching excel row.
3. Ran it against all 10,414 available PDFs (1 school/year pair skipped,
   see missing_pdfs.csv). Iterated twice on bugs found in my own script
   (page-1-only read, blank-vs-zero false positives, GPA-5 undercount when
   per-student GPA isn't printed) before trusting the output.
4. Findings written up in `audit_output/FINDINGS.md`, backed by
   `audit_output/mismatches.csv` (19,358 field-level diffs across 8,300 of
   10,414 records — see FINDINGS.md for the 3 systemic root causes) and
   `audit_output/missing_pdfs.csv` (15 records marked "done" with no PDF on
   disk).
5. User decision: keep `excel/ssc_jsc_results_scraped.xlsx` intact, produce
   a separate corrected file instead of editing in place.
6. Wrote `scripts/apply_corrections.py`: copies the original to
   `excel/ssc_jsc_results_corrected.xlsx`, recomputes the same 7 fields
   (avg_gpa, science_examinee_total/passed/avg_gpa,
   nonscience_examinee_total/passed/avg_gpa) from the PDFs for every `done`
   row, and overwrites only the cells that actually disagree. Every changed
   cell is recorded in `audit_output/correction_log.csv` (old value → new
   value). Result: 8,300 rows changed, 19,358 cells changed — matches the
   audit's mismatch count exactly.
7. Verified: `scripts/verify_corrected.py` re-diffs the corrected file
   against the PDFs from scratch — **0 mismatches remain**. Also checked
   row counts (7729/4348 incl. header, matches original), the
   `instructions` sheet, and confirmed the original file's mtime is
   unchanged (never opened for writing).

8. Full cell-by-cell re-check across ALL 12 result columns (not just the 7
   corrected ones), prompted by the user asking about blank
   `nonscience_avg_gpa` cells. Found 0 further errors — every remaining blank
   traces to either (a) the 15 missing-PDF rows, or (b) JSC 2011 PDFs not
   printing individual student GPA (326 rows) — both already known, neither
   fixable from the PDFs as they stand.
9. Found and fixed a real bug in `scraper/scrape.js`: it marked a row `done`
   as soon as the results page parsed, even if the separate PDF-download
   step had silently failed. That's how the original 15 rows lost their PDF.
   Fix: a row is now only marked `done` if the PDF actually saved; otherwise
   `error` (so resume runs retry it instead of masking the gap). Wrote
   `scripts/reset_done_without_pdf.py` (scans the whole workbook for
   done-but-no-PDF rows and resets them to `error`) — more general than the
   earlier `reset_missing_rows.py`, which is now superseded.
10. User ran `node scrape.js --exam ssc` once (before the scrape.js fix):
    recovered PDFs for EIIN 108019 years 2012–2017 (6 of 14). The other 9
    target rows (108019: 2018/2019/2021–2026, and 108487/2022) got the same
    silent-failure bug — marked `done` with data but still no PDF. **Not yet
    re-run** with the fix in place — `reset_done_without_pdf.py` needs to run
    again first, then the scraper again.
11. New request: a second workbook, `excel/ssc_jsc_results_scraped_version_two.xlsx`
    (schema: `examinee_appeared`, `sum_gpa` instead of `avg_gpa`, no
    `scrape_status`/`scrape_note` columns; ssc sheet adds
    science/nonscience breakdowns with the same appeared/sum_gpa shape, jsc
    sheet has no science split). It arrived as a 483-row template (one row
    per EIIN, no years). Wrote `scripts/build_version_two.py`: expands each
    EIIN into the full year grid (SSC 2011–2026 ×16, JSC 2011–2019 ×9 =
    7,728 / 4,347 rows, matching the original schema's row counts exactly),
    computing every field straight from the PDFs (reusing `audit.py`'s
    parser) — including `examinee_appeared` (= board's own "Appeared" header
    figure; per-group appeared = group total − group's `ABS.` count, cross-
    checked against the header's own arithmetic) and `sum_gpa` (sum of GPA
    points of passed examinees, left blank when the PDF doesn't print
    individual GPAs rather than guessing). Verified output against
    hand-computed values for EIIN 108019 (multiple years, both exams) —
    exact match. Ran `scripts/backfill_names_v2.py` afterward to fill
    `school_name_pulled` on missing-PDF rows using the same school's name
    from any other available year.
    Result: ssc 6,654/7,728 rows populated (1,074 blank = exactly the known
    1,059 no_result + 6 error + 9 still-missing-PDF rows), jsc 3,766/4,347
    (581 blank = exactly 579 no_result + 2 error). No unexplained gaps.
    **Not yet handled**: `ssc_jsc_results_scraped_version_two_raw.xlsx` is
    an identical empty template sitting alongside it — purpose unclear
    (unfilled), asked the user what it's for before touching it.

## Remaining / open items

- **15 missing PDFs** (EIIN 108019 almost all years, EIIN 108487/2022): 6
  recovered (108019 2012–2017); 9 still outstanding (108019: 2018, 2019,
  2021, 2022, 2023, 2024, 2025, 2026; 108487: 2022). Next step is on the
  user: run `reset_done_without_pdf.py` then `node scrape.js --exam ssc`
  again now that the scrape.js bug is fixed.
- Once those 9 are recovered, both `ssc_jsc_results_corrected.xlsx` and
  `ssc_jsc_results_scraped_version_two.xlsx` should be rebuilt/re-corrected
  for just those rows (scripts already exist for both, just re-run).
- `ssc_jsc_results_scraped_version_two_raw.xlsx` — waiting on the user to
  say what it's for.
- Corrected file (`ssc_jsc_results_corrected.xlsx`) only touches the 7
  group/average fields; `examinee_total/passed/gpa5`, `school_name_pulled`,
  `scrape_status`, and `scrape_note` are copied as-is from the original
  (they already matched the PDFs in the audit).
- Nothing has been committed to git yet — both project's excel files and all
  of `scripts/`, `audit_output/`, and this log are currently untracked/new.
