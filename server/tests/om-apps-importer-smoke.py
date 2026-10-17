from pathlib import Path
import tempfile,os,json,subprocess,sys
from openpyxl import Workbook
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'Sample.xlsx'; w=Workbook();w.active.append(['Name','Count']);w.active.append(['Example',3]);w.save(p)
 env={**os.environ,'OM_IMPORTER_DATABASE':'om_church_47','OM_IMPORTER_DB_HOST':'db.internal'}
 def run(request):
  result=subprocess.run([sys.executable,'-m','om_importer.desktop_bridge'],input=json.dumps(request),text=True,capture_output=True,env=env,check=True)
  value=json.loads(result.stdout);assert value['ok'],value;return value['result']
 info=run({'operation':'inspect','source':str(p)})
 package=run({'operation':'extract','source':str(p),'configuration':info['configuration']})
 assert package['source']['filename']=='Sample.xlsx'
 assert len(package['records'])==1
 assert run({'operation':'validate','package':package})['records'][0]['normalized']['name']=='Example'
 check=subprocess.run([sys.executable,'-c',"from om_importer.database_connection import DATABASE,validate_settings; assert DATABASE=='om_church_47'; assert validate_settings({'database':DATABASE,'host':'db.internal','user':'test','password':''})['database']==DATABASE"],env=env,check=True)
 print('Hosted Python smoke passed: inspect, configurable extraction, validation, original filename and server-selected tenant.')
