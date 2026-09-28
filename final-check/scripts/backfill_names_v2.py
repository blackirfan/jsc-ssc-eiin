import openpyxl

PATH = "excel/ssc_jsc_results_scraped_version_two.xlsx"
wb = openpyxl.load_workbook(PATH, data_only=True)

for sn in ('ssc', 'jsc'):
    ws = wb[sn]
    header = [c.value for c in ws[1]]
    idx = {h: i + 1 for i, h in enumerate(header)}
    eiin_col = idx['eiin']
    name_col = idx['school_name_pulled']

    known_names = {}
    for r in range(2, ws.max_row + 1):
        eiin = ws.cell(row=r, column=eiin_col).value
        name = ws.cell(row=r, column=name_col).value
        if name and eiin not in known_names:
            known_names[eiin] = name

    filled = 0
    for r in range(2, ws.max_row + 1):
        eiin = ws.cell(row=r, column=eiin_col).value
        cell = ws.cell(row=r, column=name_col)
        if cell.value is None and eiin in known_names:
            cell.value = known_names[eiin]
            filled += 1
    print(sn, "backfilled names:", filled, "schools with no name anywhere:",
          sum(1 for r in range(2, ws.max_row+1)
              if ws.cell(row=r, column=eiin_col).value not in known_names))

wb.save(PATH)
print("saved.")
