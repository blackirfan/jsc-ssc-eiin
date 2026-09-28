import re, glob, os, json, time, sys, csv
import fitz
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

HEADER_RE = re.compile(
    r"No\. of Students:\s*\{\s*Examinee:\s*(\d+),\s*Appeared:\s*(\d+),\s*Passed:\s*(\d+),\s*Percentage of Pass:\s*([\d.]+),\s*GPA 5:\s*(\d+)\s*\}"
)
GROUP_HEADER_RE = re.compile(r'^-+\s*:\s*(.+?)\s*:\s*-+\s*$')
ENTRY_RE = re.compile(r'(\d+)\[\s*([^\]]*?)\s*\]')
NUM_RE = re.compile(r'^\d\.\d{2}$')

OUT_DIR = os.path.join(ROOT, "audit_output")
os.makedirs(OUT_DIR, exist_ok=True)
LOG_PATH = os.path.join(OUT_DIR, "progress_log.txt")


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")


CONTD_RE = re.compile(r'\s*\(CONT[\'D]*\.?\)\s*$', re.IGNORECASE)


def parse_pdf(path):
    doc = fitz.open(path)
    text = "\n".join(page.get_text() for page in doc)
    doc.close()
    lines = text.split('\n')
    m = HEADER_RE.search(text)
    if not m:
        return None, "header_not_found"
    header = {
        'examinee': int(m.group(1)),
        'appeared': int(m.group(2)),
        'passed': int(m.group(3)),
        'pct_pass': float(m.group(4)),
        'gpa5': int(m.group(5)),
    }
    groups = {}
    current = None
    for line in lines:
        stripped = line.strip()
        gm = GROUP_HEADER_RE.match(stripped)
        if gm and stripped.startswith('-') and stripped.count('-') > 5:
            name = gm.group(1).strip()
            name = CONTD_RE.sub('', name).strip()
            if 'END OF RESULT' in name:
                current = None
                continue
            current = name
            groups.setdefault(current, [])
            continue
        if current is not None:
            for em in ENTRY_RE.finditer(line):
                groups[current].append((em.group(1), em.group(2).strip()))
    return {'header': header, 'groups': groups, 'raw_text': text}, None


def summarize(entries):
    total = len(entries)
    passed = 0
    gpa5 = 0
    known_sum = 0.0
    known_count = 0
    unknown_pass_count = 0
    for roll, content in entries:
        if content == '':
            passed += 1
            unknown_pass_count += 1
        elif NUM_RE.match(content):
            val = float(content)
            passed += 1
            known_sum += val
            known_count += 1
            if abs(val - 5.0) < 1e-9:
                gpa5 += 1
        else:
            pass
    return {
        'total': total, 'passed': passed, 'gpa5': gpa5,
        'known_sum': known_sum, 'known_count': known_count,
        'unknown_pass_count': unknown_pass_count,
    }


def avg_of(summary):
    if summary['total'] == 0:
        return None, 'empty'
    if summary['unknown_pass_count'] == 0:
        return round(summary['known_sum'] / summary['total'], 2), 'ok'
    if summary['unknown_pass_count'] == summary['passed']:
        return None, 'all_unknown'
    return None, 'partial_unknown'


def load_excel_rows(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    data = {}
    for sn in ('ssc', 'jsc'):
        ws = wb[sn]
        rows = ws.iter_rows(values_only=True)
        header = next(rows)
        idx = {h: i for i, h in enumerate(header)}
        d = {}
        for r in rows:
            key = (r[idx['eiin']], r[idx['exam_year']])
            d[key] = {h: r[idx[h]] for h in header}
        data[sn] = d
    return data


def close(a, b, tol=0.011):
    if a is None or b is None:
        return a == b
    try:
        return abs(float(a) - float(b)) <= tol
    except Exception:
        return a == b


def main():
    kinds = sys.argv[1:] if len(sys.argv) > 1 else ['ssc', 'jsc']
    log(f"=== Audit run starting for: {kinds} ===")
    excel_path = "excel/ssc_jsc_results_scraped.xlsx"
    excel_data = load_excel_rows(excel_path)
    log("Loaded excel rows: ssc=%d jsc=%d" % (len(excel_data['ssc']), len(excel_data['jsc'])))

    mismatches = []  # dicts
    anomalies = []   # dicts: unexpected group names, header parse fail, partial unknown gpa
    seen_keys = {'ssc': set(), 'jsc': set()}

    all_group_names = {}

    for kind in kinds:
        files = sorted(glob.glob(f"pdfs/{kind}_*.pdf"))
        n = len(files)
        log(f"--- {kind}: {n} pdf files found ---")
        t0 = time.time()
        for i, path in enumerate(files, 1):
            base = os.path.basename(path)
            m = re.match(rf'{kind}_(\d+)_(\d+)\.pdf$', base)
            if not m:
                anomalies.append({'file': base, 'issue': 'filename_pattern_mismatch'})
                continue
            eiin, year = int(m.group(1)), int(m.group(2))
            seen_keys[kind].add((eiin, year))

            parsed, err = parse_pdf(path)
            if err:
                anomalies.append({'file': base, 'issue': err})
                continue

            header = parsed['header']
            groups = parsed['groups']
            for gname in groups:
                all_group_names[gname] = all_group_names.get(gname, 0) + 1

            science_entries = groups.get('SCIENCE', [])
            nonscience_entries = []
            for gname, entries in groups.items():
                if gname != 'SCIENCE':
                    nonscience_entries.extend(entries)
            all_entries = []
            for entries in groups.values():
                all_entries.extend(entries)

            overall_sum = summarize(all_entries)
            science_sum = summarize(science_entries)
            nonscience_sum = summarize(nonscience_entries)

            # sanity check: overall computed vs header
            if overall_sum['total'] != header['examinee']:
                anomalies.append({
                    'file': base, 'issue': 'bracket_total_ne_examinee',
                    'bracket_total': overall_sum['total'], 'header_examinee': header['examinee']
                })
            if overall_sum['passed'] != header['passed']:
                anomalies.append({
                    'file': base, 'issue': 'bracket_passed_ne_header_passed',
                    'bracket_passed': overall_sum['passed'], 'header_passed': header['passed']
                })
            if overall_sum['gpa5'] != header['gpa5']:
                anomalies.append({
                    'file': base, 'issue': 'bracket_gpa5_ne_header_gpa5',
                    'bracket_gpa5': overall_sum['gpa5'], 'header_gpa5': header['gpa5']
                })

            overall_avg, overall_avg_status = avg_of(overall_sum)
            science_avg, science_avg_status = avg_of(science_sum) if science_entries else (None, 'no_group')
            nonscience_avg, nonscience_avg_status = avg_of(nonscience_sum) if nonscience_entries else (None, 'no_group')

            if overall_avg_status == 'partial_unknown':
                anomalies.append({'file': base, 'issue': 'overall_partial_unknown_gpa'})
            if science_avg_status == 'partial_unknown':
                anomalies.append({'file': base, 'issue': 'science_partial_unknown_gpa'})
            if nonscience_avg_status == 'partial_unknown':
                anomalies.append({'file': base, 'issue': 'nonscience_partial_unknown_gpa'})

            row = excel_data[kind].get((eiin, year))
            if row is None:
                anomalies.append({'file': base, 'issue': 'pdf_without_excel_row', 'eiin': eiin, 'year': year})
                continue

            # gpa5 counts recomputed from bracket data are unreliable when some
            # passed entries have no visible per-student GPA (early-year PDFs)
            science_gpa5_unreliable = science_sum['unknown_pass_count'] > 0
            nonscience_gpa5_unreliable = nonscience_sum['unknown_pass_count'] > 0
            science_gpa5 = science_sum['gpa5']
            nonscience_gpa5 = nonscience_sum['gpa5']

            computed = {
                'examinee_total': header['examinee'],
                'examinee_passed': header['passed'],
                'examinee_gpa5': header['gpa5'],
                'avg_gpa': overall_avg,
                'science_examinee_total': science_sum['total'] if science_entries else None,
                'science_examinee_passed': science_sum['passed'] if science_entries else None,
                'science_examinee_gpa5': science_gpa5 if science_entries else None,
                'science_avg_gpa': science_avg,
                'nonscience_examinee_total': nonscience_sum['total'] if nonscience_entries else None,
                'nonscience_examinee_passed': nonscience_sum['passed'] if nonscience_entries else None,
                'nonscience_examinee_gpa5': nonscience_gpa5 if nonscience_entries else None,
                'nonscience_avg_gpa': nonscience_avg,
            }

            for field, pdf_val in computed.items():
                excel_val = row.get(field)
                # skip avg fields where computed is None due to unavailable per-student gpa data
                if field.endswith('avg_gpa') and pdf_val is None:
                    continue
                if field == 'science_examinee_gpa5' and science_gpa5_unreliable:
                    continue
                if field == 'nonscience_examinee_gpa5' and nonscience_gpa5_unreliable:
                    continue
                # excel stores blank instead of 0 for zero counts; treat as equivalent
                if not field.endswith('avg_gpa'):
                    if excel_val is None:
                        excel_val = 0
                    if pdf_val is None:
                        pdf_val = 0
                if not close(excel_val, pdf_val):
                    mismatches.append({
                        'kind': kind, 'eiin': eiin, 'year': year, 'field': field,
                        'excel_value': excel_val, 'pdf_value': pdf_val,
                        'file': base,
                    })

            if i % 500 == 0 or i == n:
                elapsed = time.time() - t0
                rate = i / elapsed if elapsed > 0 else 0
                remaining = n - i
                eta = remaining / rate if rate > 0 else 0
                log(f"[{kind}] processed {i}/{n} ({i*100//n}%) mismatches_so_far={len(mismatches)} anomalies_so_far={len(anomalies)} rate={rate:.1f}/s eta={eta:.0f}s")

    # missing pdfs: excel 'done' rows without a corresponding pdf file
    missing_pdfs = []
    for kind in ('ssc', 'jsc'):
        for (eiin, year), row in excel_data[kind].items():
            if row.get('scrape_status') == 'done' and (eiin, year) not in seen_keys[kind]:
                missing_pdfs.append({'kind': kind, 'eiin': eiin, 'year': year, 'scrape_status': row.get('scrape_status')})

    # write outputs
    with open(os.path.join(OUT_DIR, 'mismatches.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['kind', 'eiin', 'year', 'field', 'excel_value', 'pdf_value', 'file'])
        w.writeheader()
        w.writerows(mismatches)

    with open(os.path.join(OUT_DIR, 'anomalies.csv'), 'w', newline='', encoding='utf-8') as f:
        fieldnames = sorted({k for a in anomalies for k in a.keys()})
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(anomalies)

    with open(os.path.join(OUT_DIR, 'missing_pdfs.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['kind', 'eiin', 'year', 'scrape_status'])
        w.writeheader()
        w.writerows(missing_pdfs)

    with open(os.path.join(OUT_DIR, 'group_names_seen.json'), 'w', encoding='utf-8') as f:
        json.dump(all_group_names, f, indent=2, ensure_ascii=False)

    log(f"=== DONE === mismatches={len(mismatches)} anomalies={len(anomalies)} missing_pdfs={len(missing_pdfs)}")
    log(f"Group names seen: {all_group_names}")


if __name__ == '__main__':
    main()
