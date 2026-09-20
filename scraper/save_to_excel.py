"""
save_to_excel.py  ─  Merge scraped JSON results back into the Excel workbook.

Usage:
  python save_to_excel.py [--exam both|ssc|jsc]

Reads  : excel/scraped_json/results_both.json  (or results_ssc.json / results_jsc.json)
Updates: excel/ssc_jsc_results_scraped.xlsx
"""
import json
import os
import sys
import openpyxl
from pathlib import Path

ROOT      = Path(__file__).parent.parent
EXCEL     = ROOT / 'excel' / 'ssc_jsc_results_scraped.xlsx'
JSON_DIR  = ROOT / 'excel' / 'scraped_json'

# Column mapping (1-indexed) from the worksheet header
COL_MAP = {
    'school_name_pulled':       3,
    'exam_year':                4,
    'examinee_total':           5,
    'examinee_passed':          6,
    'examinee_gpa5':            7,
    # avg_gpa col 8 – filled separately if we can compute it
    'science_examinee_total':   9,
    'science_examinee_passed':  10,
    'science_examinee_gpa5':    11,
    # science_avg_gpa col 12
    'nonscience_examinee_total':  13,
    'nonscience_examinee_passed': 14,
    'nonscience_examinee_gpa5':   15,
    # nonscience_avg_gpa col 16
}

def load_json(exam_arg):
    candidates = []
    if exam_arg in ('both', 'ssc'):
        f = JSON_DIR / 'results_ssc.json'
        if f.exists(): candidates.append(f)
    if exam_arg in ('both', 'jsc'):
        f = JSON_DIR / 'results_jsc.json'
        if f.exists(): candidates.append(f)
    f_both = JSON_DIR / 'results_both.json'
    if f_both.exists(): candidates.append(f_both)

    merged = {}
    for c in candidates:
        merged.update(json.loads(c.read_text(encoding='utf-8')))
    return merged


def update_sheet(ws, results, exam_name):
    """Update rows in worksheet. One row per (eiin, year)."""
    # Build index: eiin -> row_number  (first column = eiin)
    eiin_to_row = {}
    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=False), start=2):
        eiin_val = row[0].value
        if eiin_val is not None:
            eiin_to_row[int(eiin_val)] = row_idx

    updated = 0
    for key, rec in results.items():
        if rec.get('error'):
            continue
        if rec.get('exam', '').lower() != exam_name.lower():
            continue

        eiin = int(rec['eiin'])
        year = str(rec['year'])
        row_idx = eiin_to_row.get(eiin)
        if row_idx is None:
            continue

        # Write school name
        if rec.get('school_name'):
            ws.cell(row=row_idx, column=COL_MAP['school_name_pulled']).value = rec['school_name']

        ws.cell(row=row_idx, column=COL_MAP['exam_year']).value = year

        if rec.get('examinee_total'):
            ws.cell(row=row_idx, column=COL_MAP['examinee_total']).value  = rec['examinee_total']
        if rec.get('examinee_passed'):
            ws.cell(row=row_idx, column=COL_MAP['examinee_passed']).value = rec['examinee_passed']
        if rec.get('examinee_gpa5'):
            ws.cell(row=row_idx, column=COL_MAP['examinee_gpa5']).value   = rec['examinee_gpa5']

        if rec.get('science_examinee_total'):
            ws.cell(row=row_idx, column=COL_MAP['science_examinee_total']).value  = rec['science_examinee_total']
        if rec.get('science_examinee_passed'):
            ws.cell(row=row_idx, column=COL_MAP['science_examinee_passed']).value = rec['science_examinee_passed']
        if rec.get('science_examinee_gpa5'):
            ws.cell(row=row_idx, column=COL_MAP['science_examinee_gpa5']).value   = rec['science_examinee_gpa5']

        if rec.get('nonscience_examinee_total'):
            ws.cell(row=row_idx, column=COL_MAP['nonscience_examinee_total']).value  = rec['nonscience_examinee_total']
        if rec.get('nonscience_examinee_passed'):
            ws.cell(row=row_idx, column=COL_MAP['nonscience_examinee_passed']).value = rec['nonscience_examinee_passed']
        if rec.get('nonscience_examinee_gpa5'):
            ws.cell(row=row_idx, column=COL_MAP['nonscience_examinee_gpa5']).value   = rec['nonscience_examinee_gpa5']

        updated += 1

    return updated


def main():
    exam_arg = 'both'
    for i, a in enumerate(sys.argv[1:]):
        if a == '--exam' and i + 1 < len(sys.argv) - 1:
            exam_arg = sys.argv[sys.argv.index('--exam') + 1]

    print(f'Loading results from JSON (exam={exam_arg})...')
    results = load_json(exam_arg)
    print(f'  {len(results)} records found.')

    print(f'Opening Excel: {EXCEL}')
    wb = openpyxl.load_workbook(EXCEL)

    total_updated = 0
    if exam_arg in ('both', 'ssc'):
        n = update_sheet(wb['ssc'], results, 'ssc')
        print(f'  SSC sheet: {n} rows updated.')
        total_updated += n
    if exam_arg in ('both', 'jsc'):
        n = update_sheet(wb['jsc'], results, 'jsc')
        print(f'  JSC sheet: {n} rows updated.')
        total_updated += n

    out_path = EXCEL.parent / (EXCEL.stem + '_updated.xlsx')
    wb.save(out_path)
    print(f'\nSaved updated workbook to: {out_path}')
    print(f'Total rows updated: {total_updated}')


if __name__ == '__main__':
    main()
