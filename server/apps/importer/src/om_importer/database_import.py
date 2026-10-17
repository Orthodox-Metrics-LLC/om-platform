"""Confirmed cemetery and parish imports into new version tables, never existing church tables."""
from datetime import datetime, timezone, date
import hashlib
import re
import uuid
import pymysql
from .database_connection import validate_settings, DATABASE
from .sql_preview import dry_run, identifier, row_bindings, json_text
from .xlsx import HEADERS


def import_plan(package):
    plan=dry_run(package)
    config=package['configuration']
    cemetery=config['profile']=='cemetery_v1'
    if config['profile']=='xlsx':
        sel=config['selection']
        header=next((b for b in package['source_blocks'] if b['location'].get('row')==sel.get('header_row',1)
                     and b['location'].get('sheet')==sel.get('sheet')),None)
        cemetery=bool(header and [v['value'] for v in header['raw'].values()]==HEADERS)
    parish=package['source']['file_type']=='docx' and config['profile']=='parish_announcements_v1'
    if not ((package['source']['file_type']=='xlsx' and cemetery) or parish):
        raise ValueError('Database import supports approved cemetery XLSX and parish DOCX packages only.')
    plan['resource_kind']='parish' if parish else 'cemetery'
    if plan['counts']['errors']:
        raise ValueError('Resolve SQL compatibility errors before importing.')
    plan['ddl_sql']=plan['ddl_sql'][plan['ddl_sql'].index('CREATE TABLE '):]
    plan['target']['schema']=DATABASE
    plan['review_sha256']=hashlib.sha256(json_text({'package':package,'target':plan['target'],'data':plan['data_plan']}).encode()).hexdigest()
    return plan


def connect(settings):
    s=validate_settings(settings)
    options={k:s[k] for k in ('host','port','user','password','database')}
    options['password']=s['password'].encode('utf-8')
    options.update(charset='utf8mb4',autocommit=False,local_infile=False,connect_timeout=5,read_timeout=15,write_timeout=15)
    if s['transport']=='socket':options['unix_socket']=s['socket']
    return pymysql.connect(**options)


def server_check(cursor):
    cursor.execute('SELECT VERSION(), DATABASE(), CURRENT_USER(), @@max_allowed_packet')
    version,database,account,packet=cursor.fetchone()
    match=re.match(r'(\d+)\.(\d+)',version)
    if database!=DATABASE or 'mariadb' not in version.lower() or not match or tuple(map(int,match.groups()))<(10,6):
        raise ValueError('Import requires MariaDB 10.6 or later and database om_church_46.')
    return {'server_version':version,'database':database,'account':account,'max_allowed_packet':packet}


def exists(cursor, table):
    cursor.execute('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s',(DATABASE,table))
    return cursor.fetchone()[0]!=0


def preflight(package,settings):
    plan=import_plan(package)
    conn=None
    try:
        conn=connect(settings)
        with conn.cursor() as c:
            c.execute('START TRANSACTION READ ONLY')
            server=server_check(c)
            if exists(c,plan['target']['table']):raise ValueError('This approved revision already has a destination table. Existing tables will not be changed.')
        conn.rollback()
        return {'plan':plan,'server':server,'writes_performed':False}
    except pymysql.MySQLError:
        raise ValueError('Import preflight failed. Check the connection and SELECT permissions. No tables were created.') from None
    finally:
        if conn:conn.close()


def execute_import(package,settings,review_sha256,confirmed=False):
    plan=import_plan(package)
    if confirmed is not True or review_sha256!=plan['review_sha256']:
        raise ValueError('Review the current package and explicitly confirm the import first.')
    conn=None;created=False;create_started=False;commit_started=False
    stage='_om_stage_'+uuid.uuid4().hex
    target=plan['target']['table']
    try:
        conn=connect(settings)
        with conn.cursor() as c:
            server=server_check(c)
            c.execute('SELECT GET_LOCK(%s, 0)',('om_import_'+package['import_id'],))
            if c.fetchone()[0]!=1:raise ValueError('Another import of this package is running.')
            if exists(c,target):raise ValueError('Destination table already exists. Reimport refused; no existing records were changed.')
            c.execute("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'")
            c.execute('SET SESSION lock_wait_timeout=10')
            from .resource_viewer import ensure_catalog,register_import
            ensure_catalog(c)
            ddl=plan['ddl_sql'][plan['ddl_sql'].index('CREATE TABLE '):].replace(identifier(target),identifier(stage),1)
            create_started=True
            c.execute(ddl);created=True
            c.execute('START TRANSACTION')
            insert=plan['insert_sql'].replace(identifier(target),identifier(stage),1).replace('?','%s')
            for r in package['records']:
                if r['review_status']=='approved':
                    c.execute(insert,row_bindings(package,r))
                    if c.warning_count:raise ValueError('MariaDB reported a value warning; import stopped.')
            c.execute('SELECT COUNT(*) FROM '+identifier(stage))
            if c.fetchone()[0]!=plan['counts']['approved_rows']:raise ValueError('Inserted row count did not match the reviewed package.')
            order=plan['parameter_order']
            c.execute('SELECT '+', '.join(identifier(n) for n in order)+' FROM '+identifier(stage)+' ORDER BY '+identifier('_om_row_id'))
            actual=c.fetchall()
            expected=[row_bindings(package,r) for r in package['records'] if r['review_status']=='approved']
            for got,want in zip(actual,expected):
                normalized=[v.isoformat() if isinstance(v,date) else v for v in got]
                if normalized!=want:raise ValueError('Stored values differ from the reviewed package; import stopped.')
            if len(actual)!=len(expected):raise ValueError('Stored row count changed during verification.')
            register_import(c,target,package,plan['resource_kind'])
            commit_started=True
            conn.commit()
            c.execute('RENAME TABLE '+identifier(stage)+' TO '+identifier(target))
            return {'status':'imported','resource_kind':plan['resource_kind'],'database':DATABASE,'table':target,'rows_imported':len(expected),
                    'import_id':package['import_id'],'revision':package['revision'],
                    'approval_sha256':package['approval']['sha256'],'review_sha256':review_sha256,
                    'verified_all_values':True,'server':server,'source_sha256':package['source']['sha256'],
                    'data_sha256':plan['data_plan']['sha256'],'completed_at':datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        if conn and not commit_started:
            try:
                conn.rollback()
                if created:
                    with conn.cursor() as c:c.execute('DROP TABLE '+identifier(stage))
                    created=False;create_started=False
            except Exception:pass
        suffix=(' Inspect '+DATABASE+'.'+stage+' and '+target+' before retrying; committed data may remain.' if commit_started
                else (' Staging table '+stage+' may remain; inspect it before retrying.' if create_started else ' No destination table was published.'))
        if isinstance(e,pymysql.MySQLError):
            code=e.args[0] if e.args and isinstance(e.args[0],int) else 'unknown'
            raise ValueError('MariaDB import failed (error '+str(code)+'). Check CREATE, INSERT, SELECT and DROP permissions and server limits.'+suffix) from None
        raise ValueError(str(e)+suffix) from None
    finally:
        if conn:
            try:conn.close()
            except pymysql.MySQLError:pass
