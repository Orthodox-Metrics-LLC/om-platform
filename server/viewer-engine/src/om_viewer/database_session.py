"""Connection and server checks for the standalone resource viewer."""
import re
import pymysql
from .database_connection import validate_settings

def connect(settings):
    s=validate_settings(settings)
    options={k:s[k] for k in ('host','port','user','password','database')}
    options['password']=s['password'].encode('utf-8')
    options.update(charset='utf8mb4',autocommit=False,local_infile=False,connect_timeout=5,read_timeout=15,write_timeout=15)
    if s['transport']=='socket':options['unix_socket']=s['socket']
    return pymysql.connect(**options)

def server_check(cursor,expected_database=None):
    cursor.execute('SELECT VERSION(), DATABASE(), CURRENT_USER(), @@max_allowed_packet')
    version,database,account,packet=cursor.fetchone()
    match=re.match(r'(\d+)\.(\d+)',version)
    if not database or (expected_database is not None and database!=expected_database) or 'mariadb' not in version.lower() or not match or tuple(map(int,match.groups()))<(10,6):
        raise ValueError('Import requires MariaDB 10.6 or later and the selected database.')
    return {'server_version':version,'database':database,'account':account,'max_allowed_packet':packet}
