"""Pure, offline MariaDB planning. This module has no connection or execution API."""
from collections import Counter
import hashlib
import json
import re
from .configuration import SQL_TYPES
from .validation import validate

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


def dry_run(package):
    validate(package)
    if package['schema_version']!='2.1.0' or package['review_status']!='approved' or not package.get('approval'):
        raise ValueError('Approve the current JSON revision before generating a SQL dry-run')
    p=package
    records=[r for r in p['records'] if r['review_status']=='approved']
    if not records:raise ValueError('No approved records are included in this package')
    table='dr_import_'+p['import_id'].replace('-','').lower()[:12]+'_'+p['approval']['sha256'][:12]
    target=identifier(table)
    findings=[];columns=[]
    def finding(code,message,record_id=None,field=None,severity='error'):
        findings.append({'code':code,'severity':severity,'message':message,'record_id':record_id,'field':field})
    if len(p['configuration']['fields'])+len(INTERNAL)>1017:
        finding('column_limit','Proposed table exceeds the InnoDB limit of 1,017 columns.')
    if not 1<=p['revision']<2**64:
        finding('revision_range','Import revision does not fit BIGINT UNSIGNED.')
    internal_names={c[0] for c in INTERNAL}
    for f in p['configuration']['fields']:
        name=f['name'];identifier(name)
        if name in internal_names:raise ValueError('Field collides with generated provenance columns')
        values=[r['normalized'][name] for r in records]
        maximum=max((len(v.encode('utf-8')) for v in values if isinstance(v,str)),default=0)
        sql_type=SQL_TYPES[f['type']]
        reason='Configured logical type'
        if f['type']=='string' and maximum>65535:
            sql_type='MEDIUMTEXT' if maximum<=16777215 else 'LONGTEXT'
            reason='Widened to preserve the largest UTF-8 value without truncation'
        columns.append({'name':name,'label':f['label'],'logical_type':f['type'],'sql_type':sql_type,
            'nullable':f['nullable'],'role':'data','reason':reason,
            'null_count':sum(v is None for v in values),'max_utf8_bytes':maximum})
        for r,value in zip(records,values):
            if value is None and not f['nullable']:
                finding('required_null','A required column contains NULL.',r['id'],name)
            if value is not None and f['type']=='date' and value<'1000-01-01':
                finding('date_range','Value is earlier than MariaDB DATE minimum 1000-01-01; use partial_date or string to preserve it.',r['id'],name)
            if isinstance(value,str) and '\x00' in value:
                finding('embedded_nul','Value contains a NUL character; retained in the separate parameter binding.',r['id'],name,'warning')
    columns += [{'name':n,'label':n,'logical_type':'metadata','sql_type':t,'nullable':null,'role':'provenance',
                 'reason':'Generated identity and source traceability'} for n,t,null in INTERNAL]
    definitions=[]
    for c in columns:
        definition=f"  {identifier(c['name'])} {c['sql_type']} {'NULL' if c['nullable'] else 'NOT NULL'}"
        if c['name']=='_om_row_id':definition+=' AUTO_INCREMENT'
        definitions.append(definition)
    definitions += ['  PRIMARY KEY (`_om_row_id`)', '  UNIQUE KEY `uq_import_record` (`_om_import_id`, `_om_record_id`)']
    ddl='-- OFFLINE PREVIEW ONLY. No database was contacted.\n-- Target church schema must come from trusted application context.\n-- No schema selection, replacement or publication is included.\nCREATE TABLE '+target+' (\n'+',\n'.join(definitions)+'\n) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;'
    order=[c['name'] for c in columns if c['name']!='_om_row_id']
    insert='INSERT INTO '+target+' ('+', '.join(identifier(n) for n in order)+') VALUES ('+', '.join('?' for _ in order)+');'
    samples=[];parameter_bytes=0;largest_row=0;digest=hashlib.sha256()
    for r in records:
        values=row_bindings(p,r)
        encoded=json_text(values).encode('utf-8');parameter_bytes+=len(encoded);largest_row=max(largest_row,len(encoded))
        digest.update(encoded);digest.update(b'\n')
        if len(values)!=len(order):raise ValueError('Internal SQL binding count mismatch')
        if len(samples)<3:samples.append({'record_id':r['id'],'source_location':r['source_location'],'bindings':values})
    verify=f'SELECT COUNT(*) AS imported_rows FROM {target} WHERE `_om_import_id` = ? AND `_om_approval_sha256` = ?;'
    errors=sum(i['severity']=='error' for i in findings)
    return {'plan_version':'1.0.0','mode':'offline_dry_run','database_connected':False,'statements_executed':0,
        'status':'blocked' if errors else 'offline_checks_passed',
        'package':{'import_id':p['import_id'],'revision':p['revision'],'approval_sha256':p['approval']['sha256'],'source_filename':p['source']['filename']},
        'target':{'schema':None,'table':table,'engine':'InnoDB','charset':'utf8mb4','collation':'utf8mb4_unicode_ci'},
        'columns':columns,'ddl_sql':ddl,'insert_sql':insert,'parameter_style':'qmark','parameter_order':order,
        'sample_bindings':samples,'verification':{'sql':verify,'bindings':[p['import_id'],p['approval']['sha256']],'expected_count':len(records)},
        'counts':{'package_records':len(p['records']),'approved_rows':len(records),'rejected_rows':sum(r['review_status']=='rejected' for r in p['records']),
                  'bound_rows_checked':len(records),'parameters_per_row':len(order),'errors':errors,'warnings':sum(i['severity']=='warning' for i in findings)},
        'data_plan':{'sha256':digest.hexdigest(),'serialized_parameter_bytes':parameter_bytes,'largest_serialized_row_bytes':largest_row},
        'findings':findings,
        'limits':['Offline type/value and binding checks only; SQL was not parsed or executed by MariaDB.',
                  'Target schema, existing table collisions, permissions, server version, SQL mode, page/row limits and max_allowed_packet remain unverified.',
                  'CREATE TABLE can implicitly commit. A later importer must stage and verify before publication.',
                  'Partial dates and recurrence rules are JSON; no missing historical components or civil feast dates are invented.',
                  'Question-mark placeholders and sample bindings are separate; a future connector must use its own parameter API.',
                  'The unique import/record key prevents duplicate insertion within this version; reimports require explicit version reconciliation.'],
        'references':[
            {'title':'MariaDB JSON','url':'https://mariadb.com/docs/server/reference/data-types/string-data-types/json'},
            {'title':'MariaDB TEXT','url':'https://mariadb.com/docs/server/reference/data-types/string-data-types/text'},
            {'title':'MariaDB DATE','url':'https://mariadb.com/docs/server/reference/data-types/date-and-time-data-types/date'}]}


def row_bindings(p,r):
    values=[binding(r['normalized'][f['name']],f['type']) for f in p['configuration']['fields']]
    row_hash=hashlib.sha256(json_text({'normalized':r['normalized'],'location':r['source_location'],'original':r['original']}).encode()).hexdigest()
    values += [p['import_id'],r['id'],p['revision'],p['approval']['sha256'],p['source']['sha256'],json_text(r['source_location']),json_text(r['original']),row_hash]
    return values
