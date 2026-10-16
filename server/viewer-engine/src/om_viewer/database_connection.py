"""MariaDB connection verification. No schema/data modification API."""
from datetime import datetime, timezone
from pathlib import Path
import pymysql

def validate_database(database):
    if not isinstance(database,str) or not database.strip() or len(database.strip())>64 or any(ord(c)<32 or c in ('/',chr(92),'.') for c in database):
        raise ValueError('Enter a valid database name (up to 64 characters)')
    return database.strip()


def validate_settings(settings):
    if not isinstance(settings,dict):raise ValueError('Connection settings must be an object')
    if set(settings)-{'host','port','database','user','password','transport','socket'}:
        raise ValueError('Unknown connection setting')
    host=settings.get('host','localhost')
    if not isinstance(host,str) or not host.strip() or len(host.strip())>253 or any(c.isspace() or c in ('/', chr(92), chr(0)) for c in host.strip()):
        raise ValueError('Enter a valid MariaDB hostname or IP address')
    host=host.strip()
    port=settings.get('port',3306)
    if type(port) is not int or not 1<=port<=65535:raise ValueError('Port must be between 1 and 65535')
    database=validate_database(settings.get('database'))
    user=settings.get('user','')
    password=settings.get('password','')
    if not isinstance(user,str) or not user.strip() or len(user)>128:raise ValueError('Enter your MariaDB username')
    if not isinstance(password,str):raise ValueError('Password must be text')
    transport=settings.get('transport','tcp')
    if transport not in ('tcp','socket'):raise ValueError('Choose TCP or Unix socket')
    socket=settings.get('socket','')
    if transport=='socket' and (not isinstance(socket,str) or not Path(socket).is_absolute()):
        raise ValueError('Enter an absolute local Unix socket path')
    return {'host':host,'port':port,'database':database,'user':user.strip(),'password':password,
            'transport':transport,'socket':socket if transport=='socket' else ''}


def verify_connection(settings):
    s=validate_settings(settings)
    options={'host':s['host'],'port':s['port'],'user':s['user'],'password':s['password'].encode('utf-8'),
             'database':s['database'],'charset':'utf8mb4','connect_timeout':5,'read_timeout':5,'write_timeout':5,
             'autocommit':False,'local_infile':False}
    if s['transport']=='socket':options['unix_socket']=s['socket']
    connection=None
    try:
        connection=pymysql.connect(**options)
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION READ ONLY')
            cursor.execute('SELECT VERSION(), DATABASE(), CURRENT_USER(), @@character_set_database, @@collation_database')
            version,database,account,charset,collation=cursor.fetchone()
            if database!=s['database']:raise ValueError('Server selected an unexpected database')
            if 'mariadb' not in version.lower():raise ValueError('The server is not identified as MariaDB')
        connection.rollback()
        return {'status':'verified','database':database,'server_version':version,'account':account,
                'charset':charset,'collation':collation,'host':s['host'],'port':s['port'],'transport':s['transport'],
                'verified_at':datetime.now(timezone.utc).isoformat(),'session_closed':True,
                'database_modified':False,'message':'Connection verified with a read-only metadata query. Session closed after verification.'}
    except pymysql.MySQLError as exc:
        code=exc.args[0] if exc.args and isinstance(exc.args[0],int) else None
        messages={1045:'Access denied. Check the MariaDB username, password and host grants.',
                  1698:'Socket authentication denied. Use a MariaDB account permitted for your Linux user, or use TCP credentials.',
                  1044:'This account cannot access the selected database. Check its database grants.',
                  1049:'The selected database does not exist on this server. The app will not create it automatically.',
                  2002:'Cannot reach the local MariaDB socket. Check its path and the server status.',
                  2003:'Cannot reach MariaDB. Check the host, TCP port, firewall and server status.',
                  2013:'The MariaDB connection timed out or was lost.'}
        # Driver messages can echo sensitive input. Return only a fixed explanation and code.
        raise ValueError(messages.get(code,'MariaDB connection verification failed. Check account and server configuration.')+(f' (MariaDB error {code})' if code else '')) from None
    finally:
        if connection is not None:
            try:connection.close()
            except pymysql.MySQLError:pass
