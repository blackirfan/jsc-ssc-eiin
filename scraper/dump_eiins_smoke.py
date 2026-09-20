"""Quick smoke-test: override Excel with just 2 EIINs and use 2 years."""
import json, sys, os

# Patch dump_eiins to return limited set
os.environ['SMOKE_TEST'] = '1'
data = {'ssc': [108258, 108019], 'jsc': [108258]}
print(json.dumps(data))
