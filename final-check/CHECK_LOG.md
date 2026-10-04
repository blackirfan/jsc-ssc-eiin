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

12. Added `scrape_status` column to `ssc_jsc_results_scraped_version_two.xlsx`
    (`scripts/add_status_column_v2.py`), pulled from the master sheet and
    collapsed to two values (`done`/`no_result`, folding `error` into
    `no_result`) as requested. Verified 100% consistency between this column
    and which rows actually have data (0 mismatches). Along the way,
    resolved a confusing false alarm: an older verification script
    (`check_target_status.py`) was reading a *stale* copy of the master
    sheet cached under `final-check/excel/` from before any of the
    reset/rescrape work — the real master sheet was correct the whole time.
13. Investigated "many JSC rows missing sum_gpa": it's exactly and only all
    391 JSC-2011 `done` rows (100% of that year, 0% of every other year/exam)
    — that year's PDFs don't print individual student GPA at all (blank
    brackets), same root cause as the earlier avg_gpa gap, not a parsing bug.
14. New request: `ssc_jsc_results_scraped_version_three.xlsx` — rebuild
    version_two but with every `no_result` row given a *fresh live* recheck
    against the board's site (not reusing the 2026-09-25 cached recheck),
    adding a new review-outcome column, and computing full data for any row
    that now returns a result (same calculation path as everything else).
    Found a prior recheck already existed (`scraper/recheck_run.log` +
    `excel/scraped_json/results_recheck_both.json`, dated 2026-09-25): 1,646
    rows checked live, 0 found, 8 inconclusive (browser errors, not
    CAPTCHA), took 666.5 minutes. Asked the user whether to reuse that or
    force a brand new full recheck — **user chose a brand new full recheck**
    despite the ~11h cost.
    Built `scraper/recheck_v3.js`: a standalone script (does **not** touch
    the master `ssc_jsc_results_scraped.xlsx` at all) that reads the 1,655
    `no_result` rows straight from `version_two.xlsx`, re-runs the live
    CAPTCHA-solve-and-submit flow for each, downloads any newly-found PDF
    into `pdfs/`, and checkpoints to `final-check/recheck_v3/checkpoint.json`
    (resumable). Smoke-tested on the JSC subset first (confirmed real
    CAPTCHA-solving and correct checkpointing: 10 rows in ~3 min, all
    genuinely re-confirmed `no_result` from the live site), then stopped it
    and relaunched the full run across both exams (resumed cleanly from the
    smoke-test's 10 entries, 1,645 remaining).
    Ran in the background 2026-10-03 15:13 UTC → 23:15 UTC (481.3 min, ~8h,
    faster than the 8-11h estimate). Final tally: **1,645 rows rechecked —
    9 found, 1,627 confirmed genuinely no_result, 9 inconclusive (transient
    browser errors: "execution context destroyed", screenshot timeouts —
    not CAPTCHA failures)**. The 9 "found" were exactly EIIN 108019 (all 8
    still-missing years: 2018/2019/2021-2026) + EIIN 108487/2022 — i.e.
    *exactly* the 9 rows still outstanding from the original 15-missing-PDF
    saga (item 9/10). They were swept into this no_result recheck queue
    only because the `error`→`no_result` status-collapsing in item 12 hid
    the distinction; the board had real results for them all along, the
    original scrape.js bug just never downloaded the PDF. All 9 PDFs are
    now saved in `pdfs/` and patched into `version_two.xlsx` via
    `scripts/patch_version_two_rows.py` (re-run safely idempotent; it
    skips any target whose PDF still doesn't exist).
    **This also fully closes out the original 15-missing-PDF item** — all
    15 are now recovered (6 from the user's manual scrape run + 9 from this
    recheck).
    Along the way: tried a one-off out-of-band check
    (`scraper/check_one.js`) to jump the queue for 108487/2022 instead of
    waiting — failed twice with a reproducible "EIIN field stays hidden"
    error, almost certainly from running two browser automation sessions
    against the site concurrently in this environment. Abandoned it rather
    than risk destabilizing the main job; the main queue reached and
    resolved 108487/2022 on its own shortly after anyway.
    Wrote `scripts/build_version_three.py`: copies `version_two.xlsx`,
    adds a `recheck_2026_10_03` column per row (`found` /
    `confirmed_no_result` / `error_inconclusive` / `not_rechecked` — the
    last for rows that weren't in the no_result set to begin with), and
    fills any newly-found row's data (idempotent — the 9 were already
    patched into version_two by this point, so 0 additional fills needed
    here). Verified counts reconcile exactly: ssc 9 found + 1,059
    confirmed_no_result + 6 error_inconclusive = 1,074 (matches the
    original ssc blank count exactly); jsc 0 found + 578 + 3 = 581 (matches
    exactly).

## Remaining / open items

- **15-missing-PDF saga: fully resolved.** All 15 original rows (EIIN
  108019 × 14 years, EIIN 108487 × 2022) now have PDFs on disk and full
  computed data in `version_two.xlsx` and `version_three.xlsx`.
- `ssc_jsc_results_corrected.xlsx` (the *other* deliverable, built on the
  original schema) was never updated with these 9 recovered rows — it
  still predates this recovery. Low priority unless the user asks for it,
  since `version_two`/`version_three` are the current focus, but flagging
  so it isn't assumed up to date.
- The master `excel/ssc_jsc_results_scraped.xlsx` still shows `error` (not
  `done`) for these 9 rows, since `recheck_v3.js` deliberately never
  touches it. Whether to reconcile the master sheet too is the user's call
  — not done automatically.
- 9 rows are `error_inconclusive` in version_three (transient browser
  errors, never got a clean answer either way) — could be retried cheaply
  (just 9 rows) if the user wants full certainty on those.
- `ssc_jsc_results_scraped_version_two_raw.xlsx` — still waiting on the
  user to say what it's for; untouched since it first appeared.
- Corrected file (`ssc_jsc_results_corrected.xlsx`) only touches the 7
  group/average fields; `examinee_total/passed/gpa5`, `school_name_pulled`,
  `scrape_status`, and `scrape_note` are copied as-is from the original
  (they already matched the PDFs in the audit).
- Nothing has been committed to git yet — both project's excel files and all
  of `scripts/`, `audit_output/`, and this log are currently untracked/new.
