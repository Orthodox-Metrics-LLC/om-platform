#!/usr/bin/env python3
"""Check published metadata and HTTP range downloads against a staged release."""
import argparse,json,pathlib,urllib.request,urllib.parse
parser=argparse.ArgumentParser();parser.add_argument('release',help='Staged platform release directory');parser.add_argument('--base',default='https://orthodoxmetrics.com/updates/om-viewer');args=parser.parse_args()
stage=pathlib.Path(args.release);info=json.loads((stage/'release.json').read_text());base=args.base.rstrip('/')+'/'+info['platform']+'/'+info['arch']+'/'
for file in info['files']:
 url=base+urllib.parse.quote(file['name'])
 if file['name']==info['metadata']:
  with urllib.request.urlopen(url) as response:body=response.read()
  if body!=(stage/file['name']).read_bytes():raise SystemExit('Metadata differs from the staged build: '+url)
 else:
  request=urllib.request.Request(url,headers={'Range':'bytes=0-31'})
  with urllib.request.urlopen(request) as response:
   if response.status!=206:raise SystemExit('Expected HTTP 206 range support: '+url)
   if response.read()!=(stage/file['name']).read_bytes()[:32]:raise SystemExit('Artifact bytes differ: '+url)
print('Feed metadata and range downloads verified: '+base)
