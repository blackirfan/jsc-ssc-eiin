import os, sys, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

spec = importlib.util.spec_from_file_location("audit", os.path.join(ROOT, "scripts", "audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

spec2 = importlib.util.spec_from_file_location("apply_corrections", os.path.join(ROOT, "scripts", "apply_corrections.py"))
apply_corrections = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(apply_corrections)

import glob, re, time

excel_data = audit.load_excel_rows("excel/ssc_jsc_results_corrected.xlsx")
print("Loaded corrected excel: ssc=%d jsc=%d" % (len(excel_data['ssc']), len(excel_data['jsc'])))

mismatches = []
for kind in ('ssc', 'jsc'):
    files = sorted(glob.glob(f"pdfs/{kind}_*.pdf"))
    t0 = time.time()
    for i, path in enumerate(files, 1):
        base = os.path.basename(path)
        m = re.match(rf'{kind}_(\d+)_(\d+)\.pdf$', base)
        eiin, year = int(m.group(1)), int(m.group(2))
        row = excel_data[kind].get((eiin, year))
        if row is None:
            continue
        pdf_vals = apply_corrections.compute_pdf_values(kind, eiin, year)
        if pdf_vals is None:
            continue
        for field in apply_corrections.CORRECTABLE_FIELDS:
            pdf_val = pdf_vals[field]
            if field.endswith('avg_gpa') and pdf_val is None:
                continue
            excel_val = row.get(field)
            cmp_excel, cmp_pdf = excel_val, pdf_val
            if not field.endswith('avg_gpa'):
                if cmp_excel is None:
                    cmp_excel = 0
                if cmp_pdf is None:
                    cmp_pdf = 0
            if not audit.close(cmp_excel, cmp_pdf):
                mismatches.append((kind, eiin, year, field, excel_val, pdf_val))
    print(f"{kind} done in {time.time()-t0:.1f}s, mismatches so far={len(mismatches)}")

print("TOTAL remaining mismatches after correction:", len(mismatches))
for m in mismatches[:20]:
    print(m)
