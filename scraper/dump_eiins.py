"""Helper: dump EIIN lists from Excel as JSON to stdout."""
import openpyxl, json, sys

excel_path = sys.argv[1]
wb = openpyxl.load_workbook(excel_path)
result = {}
for sheet in ['ssc', 'jsc']:
    ws = wb[sheet]
    result[sheet] = [row[0] for row in ws.iter_rows(min_row=2, values_only=True) if row[0] is not None]
print(json.dumps(result))
