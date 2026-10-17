"""Database resource browsing and transactional, audited manual changes."""
from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
import re
import uuid
import pymysql
from .database_connection import DATABASE
from .database_import import connect,server_check
from .sql_preview import INTERNAL,identifier,json_text,binding
from .validation import validate_typed_value

CATALOG='_om_resource_catalog'
AUDIT='_om_resource_audit'
TABLE_PATTERN=r'dr_import_[a-f0-9]{12}_[a-f0-9]{12}'
CATALOG_DDL='CREATE TABLE IF NOT EXISTS '+identifier(CATALOG)+' (table_name VARCHAR(64) NOT NULL PRIMARY KEY, manifest JSON NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
AUDIT_DDL='CREATE TABLE IF NOT EXISTS '+identifier(AUDIT)+' (audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, table_name VARCHAR(64) NOT NULL, row_id BIGINT UNSIGNED NOT NULL, action VARCHAR(16) NOT NULL, actor VARCHAR(128) NOT NULL, db_account VARCHAR(256) NOT NULL, note TEXT NOT NULL, occurred_at DATETIME(6) NOT NULL, before_json JSON NULL, after_json JSON NOT NULL, request_id CHAR(36) NOT NULL UNIQUE, INDEX ix_resource_row (table_name,row_id,audit_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'


def sidecar_exists(c,table):
    c.execute('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND TABLE_TYPE=%s',(DATABASE,table,'BASE TABLE'))
    result=c.fetchone()
    return result[0] if result else None


def ensure_sidecar(c,table,ddl,expected):
    c.execute(ddl)
    c.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s ORDER BY ORDINAL_POSITION',(DATABASE,table))
    if [r[0] for r in c.fetchall()]!=expected or sidecar_exists(c,table)!='InnoDB':
        raise ValueError('Existing '+table+' is incompatible. No records were changed.')


def require_unique(c,table,column):
    c.execute('SELECT INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s GROUP BY INDEX_NAME,NON_UNIQUE',(DATABASE,table))
    if not any(r[1]==0 and r[2]==column for r in c.fetchall()):
        raise ValueError('Existing '+table+' lacks its required unique key. No records were changed.')


def ensure_catalog(c):
    ensure_sidecar(c,CATALOG,CATALOG_DDL,['table_name','manifest'])
    require_unique(c,CATALOG,'table_name')


def ensure_audit(c):
    ensure_sidecar(c,AUDIT,AUDIT_DDL,['audit_id','table_name','row_id','action','actor','db_account','note','occurred_at','before_json','after_json','request_id'])
    require_unique(c,AUDIT,'request_id')


def register_import(c,table,package,kind):
    manifest={'kind':kind,'name':package['resource']['name'],'fields':package['configuration']['fields'],
              'profile':package['configuration']['profile'],'source':package['source'],
              'import_id':package['import_id'],'approval_sha256':package['approval']['sha256']}
    c.execute('INSERT INTO '+identifier(CATALOG)+' (table_name,manifest) VALUES (%s,%s)',(table,json_text(manifest)))


def scalar(v):
    if isinstance(v,(date,datetime)):return v.isoformat()
    if isinstance(v,Decimal):return float(v)
    return v


def fingerprint(row):
    return hashlib.sha256(json_text({k:scalar(v) for k,v in row.items()}).encode()).hexdigest()


def roles(fields,kind):
    result={}
    aliases={'plot':{'plot','plot_identifier'},'grave':{'grave','grave_number'},'last_name':{'last_name','family_name','surname'}}
    for f in fields:
        name=f['name'];source=f.get('source',{})
        candidates={name,f.get('label','').lower().replace(' ','_'),source.get('path',''),source.get('header','').lower().replace(' ','_')}
        for role,options in aliases.items():
            if candidates & options:result.setdefault(role,name)
        if kind=='cemetery':
            for role,col in [('plot','B'),('grave','C'),('last_name','E')]:
                if source.get('column')==col:result.setdefault(role,name)
    return result


def describe(c,table):
    if not isinstance(table,str) or not re.fullmatch(TABLE_PATTERN,table):
        raise ValueError('Choose an imported OM resource table.')
    identifier(table)
    if sidecar_exists(c,table)!='InnoDB':raise ValueError('Imported InnoDB resource table was not found.')
    c.execute('SELECT COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,CHARACTER_OCTET_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s ORDER BY ORDINAL_POSITION',(DATABASE,table))
    columns=c.fetchall()
    names=[r[0] for r in columns];internal={r[0] for r in INTERNAL}
    if not internal.issubset(names):raise ValueError('This table lacks OM import provenance.')
    for name in names:identifier(name)
    c.execute('SELECT '+identifier('_om_source_original')+', '+identifier('_om_import_id')+' FROM '+identifier(table)+' WHERE '+identifier('_om_revision')+'>0 ORDER BY '+identifier('_om_row_id')+' LIMIT 1')
    sample=c.fetchone()
    if not sample:raise ValueError('Resource has no imported source evidence.')
    kind='parish' if isinstance(json.loads(sample[0]),str) else 'cemetery'
    manifest=None
    if sidecar_exists(c,CATALOG):
        c.execute('SELECT manifest FROM '+identifier(CATALOG)+' WHERE table_name=%s',(table,))
        found=c.fetchone()
        if found:manifest=json.loads(found[0])
    data=[r for r in columns if r[0] not in internal]
    if not data:raise ValueError('Resource has no editable fields.')
    if manifest:
        fields=manifest['fields']
        if [f['name'] for f in fields]!=[r[0] for r in data]:raise ValueError('Resource columns changed. Restore or reconcile its field definitions before editing.')
    else:
        c.execute('SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=%s AND TABLE_NAME=%s',(DATABASE,table))
        checks=' '.join(r[0] for r in c.fetchall())
        json_fields=set(re.findall('json_valid\\('+chr(96)+'([^'+chr(96)+']+)'+chr(96)+'\\)',checks,re.I))
        fields=[]
        for name,typ,full,nullable,size in data:
            logical='json' if name in json_fields else 'boolean' if full.lower()=='tinyint(1)' else 'integer' if typ in ('bigint','int','smallint','tinyint','mediumint') else 'number' if typ in ('double','float','decimal') else 'date' if typ=='date' else 'string'
            if logical=='json' and name in ('dob','dod','birth','death','birth_date','death_date'):logical='partial_date'
            fields.append({'name':name,'label':name.replace('_',' ').title(),'type':logical,'nullable':nullable=='YES'})
    for f in fields:
        if f['type'] not in ('string','integer','number','boolean','date','partial_date','json'):raise ValueError('Unsupported resource field type.')
    constraints={r[0]:{'sql_type':r[2],'nullable':r[3]=='YES','max_bytes':r[4]} for r in data}
    return {'table':table,'kind':kind,'name':manifest['name'] if manifest else kind.title()+' · '+table,
            'fields':fields,'sort_roles':roles(fields,kind),'inferred_fields':manifest is None,
            'constraints':constraints,'import_id':sample[1]}


def row_dict(c,row):
    return dict(zip([d[0] for d in c.description],row))


def public_row(raw,resource,details=False):
    values={}
    for f in resource['fields']:
        v=raw[f['name']]
        if v is not None and f['type'] in ('json','partial_date'):v=json.loads(v)
        elif v is not None and f['type']=='boolean':v=bool(v)
        values[f['name']]=scalar(v)
    result={'row_id':raw['_om_row_id'],'values':values,'fingerprint':fingerprint(raw),
            'origin':'manual' if raw['_om_revision']==0 else 'imported'}
    if details:
        result['provenance']={k:(json.loads(v) if k in ('_om_source_original','_om_source_location') else scalar(v)) for k,v in raw.items() if k.startswith('_om_')}
    return result


def read_row(c,resource,row_id,lock=False):
    if type(row_id) is not int or row_id<1:raise ValueError('Choose a valid resource row.')
    c.execute('SELECT * FROM '+identifier(resource['table'])+' WHERE '+identifier('_om_row_id')+'=%s'+(' FOR UPDATE' if lock else ''),(row_id,))
    raw=c.fetchone()
    if raw is None:raise ValueError('This entry no longer exists.')
    return row_dict(c,raw)


def list_resources(c):
    c.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s AND TABLE_TYPE=%s AND ENGINE=%s ORDER BY TABLE_NAME',(DATABASE,'BASE TABLE','InnoDB'))
    tables=[r[0] for r in c.fetchall() if re.fullmatch(TABLE_PATTERN,r[0])]
    resources=[];unavailable=[]
    for table in tables:
        try:resources.append(describe(c,table))
        except (ValueError,KeyError,TypeError,json.JSONDecodeError):unavailable.append(table)
    return {'resources':resources,'unavailable':unavailable,'database':DATABASE}


def browse(c,r,query):
    search=query.get('search','')
    if not isinstance(search,str) or len(search)>250:raise ValueError('Search must be 250 characters or fewer.')
    page=query.get('page',0);limit=50
    if type(page) is not int or not 0<=page<=20000:raise ValueError('Invalid resource page.')
    fields={f['name']:f for f in r['fields']}
    sorting=query.get('sort',[])
    if not isinstance(sorting,list) or len(sorting)>3:raise ValueError('Choose up to three sort fields.')
    order=[]
    for sort in sorting:
        name=sort.get('field');direction=sort.get('direction','asc')
        if name not in fields or direction not in ('asc','desc'):raise ValueError('Invalid sort field or direction.')
        col=identifier(name);d=direction.upper()
        order.append(col+' IS NULL ASC')
        if name in (r['sort_roles'].get('plot'),r['sort_roles'].get('grave')) and fields[name]['type']=='string':
            numeric="NULLIF(REGEXP_SUBSTR("+col+",'^[0-9]+'),'')"
            order += [numeric+' IS NULL ASC','CAST('+numeric+' AS DECIMAL(65,0)) '+d]
        order.append(col+' '+d)
    order.append(identifier('_om_row_id')+' ASC')
    where='';params=[]
    if search:
        needle='%'+search.replace('=','==').replace('%','=%').replace('_','=_')+'%'
        where=' WHERE ('+' OR '.join('CAST('+identifier(n)+" AS CHAR) LIKE %s ESCAPE '='" for n in fields)+')'
        params=[needle]*len(fields)
    c.execute('SELECT COUNT(*) FROM '+identifier(r['table'])+where,params);count=c.fetchone()[0]
    c.execute('SELECT * FROM '+identifier(r['table'])+where+' ORDER BY '+', '.join(order)+' LIMIT %s OFFSET %s',params+[limit,page*limit])
    rows=[row_dict(c,raw) for raw in c.fetchall()]
    return {'resource':r,'rows':[public_row(raw,r) for raw in rows],'total':count,'page':page,'page_size':limit}


def audit_history(c,table,row_id):
    if not sidecar_exists(c,AUDIT):return []
    c.execute('SELECT audit_id,action,actor,db_account,note,occurred_at,before_json,after_json FROM '+identifier(AUDIT)+' WHERE table_name=%s AND row_id=%s ORDER BY audit_id DESC LIMIT 100',(table,row_id))
    return [{'id':r[0],'action':r[1],'actor':r[2],'db_account':r[3],'note':r[4],'at':scalar(r[5]),
             'before':json.loads(r[6]) if r[6] is not None else None,'after':json.loads(r[7])} for r in c.fetchall()]


def validate_values(r,values):
    if not isinstance(values,dict) or set(values)!={f['name'] for f in r['fields']}:
        raise ValueError('Provide exactly the editable fields; import provenance cannot be changed.')
    result={}
    for f in r['fields']:
        value=values[f['name']];constraints=r['constraints'][f['name']]
        if value is None and (not f['nullable'] or not constraints['nullable']):raise ValueError(f['label']+' is required.')
        validate_typed_value(value,f)
        if f['type']=='date' and value is not None and value<'1000-01-01':raise ValueError('Date must be 1000-01-01 or later; use the configured partial date format where applicable.')
        bound=binding(value,f['type'])
        if isinstance(bound,str) and constraints['max_bytes'] is not None and len(bound.encode('utf-8'))>constraints['max_bytes']:
            raise ValueError(f['label']+' exceeds the database column capacity.')
        result[f['name']]=bound
    return result


def save(c,r,request,account):
    actor=request.get('actor','');note=request.get('note','')
    if not isinstance(actor,str) or not actor.strip() or len(actor)>128:raise ValueError('Enter a reviewer name (up to 128 characters).')
    if not isinstance(note,str) or not note.strip() or len(note)>4000:raise ValueError('Enter a change reason (up to 4,000 characters).')
    values=validate_values(r,request.get('values'))
    request_id=request.get('request_id')
    try:
        if str(uuid.UUID(request_id))!=request_id:raise ValueError()
    except (ValueError,TypeError,AttributeError):raise ValueError('A valid change request ID is required.')
    row_id=request.get('row_id')
    action='add' if row_id is None else 'edit'
    # DDL runs before row locks/DML, so implicit DDL commits cannot split data and audit.
    ensure_audit(c)
    c.execute("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'")
    c.execute('START TRANSACTION')
    c.execute('SELECT table_name,row_id,action,after_json,actor,note FROM '+identifier(AUDIT)+' WHERE request_id=%s',(request_id,))
    previous=c.fetchone()
    if previous:
        if previous[0]!=r['table'] or previous[2]!=action or (row_id is not None and previous[1]!=row_id) or json.loads(previous[3])['values']!=request['values'] or previous[4]!=actor.strip() or previous[5]!=note.strip():
            raise ValueError('This change request was already used for a different entry.')
        return {'saved':True,'row':public_row(read_row(c,r,previous[1]),r,True),'already_saved':True}
    before=None
    if action=='edit':
        raw=read_row(c,r,row_id,True)
        if request.get('fingerprint')!=fingerprint(raw):raise ValueError('Another change was saved while this entry was open. Reload it before editing.')
        before=public_row(raw,r,True)
        if before['values']==request['values']:raise ValueError('No field values changed.')
        c.execute('UPDATE '+identifier(r['table'])+' SET '+', '.join(identifier(n)+'=%s' for n in values)+' WHERE '+identifier('_om_row_id')+'=%s',list(values.values())+[row_id])
    else:
        record_id=hashlib.sha256(request_id.encode()).hexdigest()
        location={'origin':'manual_entry'}
        row_hash=hashlib.sha256(json_text({'normalized':request['values'],'location':location,'original':None}).encode()).hexdigest()
        metadata={'_om_import_id':r['import_id'],'_om_record_id':record_id,'_om_revision':0,'_om_approval_sha256':'0'*64,
                  '_om_source_sha256':'0'*64,'_om_source_location':json_text(location),'_om_source_original':'null','_om_row_sha256':row_hash}
        bound={**values,**metadata}
        c.execute('INSERT INTO '+identifier(r['table'])+' ('+', '.join(identifier(n) for n in bound)+') VALUES ('+', '.join(['%s']*len(bound))+')',list(bound.values()))
        row_id=c.lastrowid
    if c.warning_count:raise ValueError('MariaDB reported a value warning; the change was rolled back.')
    after=public_row(read_row(c,r,row_id),r,True)
    if after['values']!=request['values']:raise ValueError('Stored values differ from the form. Change rolled back.')
    c.execute('INSERT INTO '+identifier(AUDIT)+' (table_name,row_id,action,actor,db_account,note,occurred_at,before_json,after_json,request_id) VALUES (%s,%s,%s,%s,%s,%s,UTC_TIMESTAMP(6),%s,%s,%s)',
              (r['table'],row_id,action,actor.strip(),account,note.strip(),json_text(before) if before else None,json_text(after),request_id))
    return {'saved':True,'row':after,'already_saved':False}


def dispatch(settings,operation,request):
    conn=None
    try:
        conn=connect(settings)
        with conn.cursor() as c:
            server=server_check(c)
            if operation=='resources':result=list_resources(c)
            else:
                r=describe(c,request.get('table'))
                if operation=='browse':result=browse(c,r,request)
                elif operation=='detail':
                    result={'resource':r,'row':public_row(read_row(c,r,request.get('row_id')),r,True),
                            'audit':audit_history(c,r['table'],request.get('row_id'))}
                elif operation=='save':result=save(c,r,request,server['account'])
                else:raise ValueError('Unsupported resource operation.')
        if operation=='save':conn.commit()
        else:conn.rollback()
        return result
    except pymysql.MySQLError as e:
        if conn:conn.rollback()
        code=e.args[0] if e.args and isinstance(e.args[0],int) else 'unknown'
        raise ValueError('Resource operation failed (MariaDB error '+str(code)+'). Check connection and permissions. Reload the entry before retrying an uncertain save.') from None
    except Exception:
        if conn:conn.rollback()
        raise
    finally:
        if conn:conn.close()
