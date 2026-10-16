"""Bounded JSON/stdio interface. Only connection and viewer operations are exposed."""
import json
import sys
from .database_connection import verify_connection
from .resource_viewer import dispatch as resource

def dispatch(request):
    operation=request.get('operation')
    if operation=='test_connection':return verify_connection(request['settings'])
    if operation=='resource':
        if request.get('action') not in ('resources','browse','detail','save'):raise ValueError('Unsupported resource operation')
        return resource(request['settings'],request['action'],request.get('query',{}))
    raise ValueError('Unsupported viewer operation')

def main():
    try:
        content=sys.stdin.buffer.read(30_000_001)
        if len(content)>30_000_000:raise ValueError('Viewer request exceeds 30 MB')
        response={'ok':True,'result':dispatch(json.loads(content))}
    except Exception as exc:
        response={'ok':False,'error':str(exc) or type(exc).__name__}
    sys.stdout.buffer.write(json.dumps(response,ensure_ascii=False,allow_nan=False).encode('utf-8'))

if __name__=='__main__':main()
