"""SQL values and identifier helpers; no import planning or execution."""
from collections import Counter
import hashlib
import json
import re

INTERNAL = [
    ('_om_row_id','BIGINT UNSIGNED',False),
    ('_om_import_id','CHAR(36)',False),
    ('_om_record_id','CHAR(64)',False),
    ('_om_revision','BIGINT UNSIGNED',False),
    ('_om_approval_sha256','CHAR(64)',False),
    ('_om_source_sha256','CHAR(64)',False),
    ('_om_source_location','JSON',False),
    ('_om_source_original','JSON',False),
    ('_om_row_sha256','CHAR(64)',False),
]


def identifier(value):
    if not isinstance(value,str) or not re.fullmatch(r'[a-z_][a-z0-9_]{0,63}',value):
        raise ValueError('Unsafe SQL identifier')
    return '`'+value+'`'


def json_text(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)


def binding(value,logical_type):
    if value is None:return None
    if logical_type in ('json','partial_date'):return json_text(value)
    if logical_type=='boolean':return 1 if value else 0
    return value


