#!/usr/bin/env python3
"""Publish a checksummed staged release using Python's standard library only."""
import argparse,base64,fcntl,hashlib,json,os,pathlib,re,shutil,tempfile

def checksum(path):
    digest=hashlib.sha512()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    return base64.b64encode(digest.digest()).decode()

def publish(staging,root):
    staging=pathlib.Path(staging).resolve();root=pathlib.Path(root).resolve()
    data=json.loads((staging/'release.json').read_text())
    if data.get('schema')!=1 or data.get('platform') not in ('windows','linux') or data.get('arch')!='x64':raise ValueError('Unsupported release platform or manifest')
    version=data.get('version','')
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',version):raise ValueError('A stable x.y.z version is required')
    metadata='latest.yml' if data['platform']=='windows' else 'latest-linux.yml'
    if data.get('metadata')!=metadata:raise ValueError('Wrong platform metadata')
    files=data.get('files',[]);names=[item['name'] for item in files]
    if len(names)!=len(set(names)) or metadata not in names:raise ValueError('Duplicate or missing release files')
    suffix='.exe' if data['platform']=='windows' else '.AppImage'
    installers=[name for name in names if name.endswith(suffix)]
    if len(installers)!=1 or version not in installers[0] or not ('x64' in installers[0] or (data['platform']=='linux' and 'x86_64' in installers[0])):raise ValueError('Expected one versioned x64 installer')
    expected={metadata,installers[0]}
    if data['platform']=='windows':expected.add(installers[0]+'.blockmap')
    if set(names)!=expected:raise ValueError('Unexpected release files')
    for item in files:
        name=item['name']
        if '/' in name or '\\' in name or pathlib.Path(name).name!=name or name in ('.','..'):raise ValueError('Unsafe file name')
        source=staging/name
        if source.is_symlink() or not source.is_file() or source.stat().st_size!=item['size'] or checksum(source)!=item['sha512']:raise ValueError('Checksum or size mismatch: '+name)
    root.mkdir(parents=True,exist_ok=True)
    with (root/'.publish.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        feed=root/data['platform']/'x64';feed.mkdir(parents=True,exist_ok=True)
        statefile=feed/'.current-release.json'
        if statefile.exists():
            previous=json.loads(statefile.read_text())
            if tuple(map(int,version.split('.')))<tuple(map(int,previous['version'].split('.'))):raise ValueError('Refusing to downgrade the feed')
            if previous['version']==version and previous!=data:raise ValueError('A version cannot be republished with different files')
        elif (feed/metadata).exists():raise ValueError('Existing unmanaged metadata found; review this feed before adopting it')
        # Validate every immutable destination before changing any published file.
        for item in files:
            target=feed/item['name']
            if item['name']!=metadata and target.exists() and checksum(target)!=item['sha512']:raise ValueError('Refusing to overwrite an immutable artifact')
        def atomic_copy(source,target,mode=0o644):
            handle,temporary=tempfile.mkstemp(prefix='.upload-',dir=feed)
            try:
                with os.fdopen(handle,'wb') as output,source.open('rb') as content:shutil.copyfileobj(content,output);output.flush();os.fsync(output.fileno())
                os.chmod(temporary,mode);os.replace(temporary,target)
            finally:
                if os.path.exists(temporary):os.unlink(temporary)
        for item in files:
            if item['name']!=metadata:
                target=feed/item['name']
                if not target.exists():atomic_copy(staging/item['name'],target)
        # Record the release before committing its metadata; retries of the same release repair interrupted commits.
        handle,temporary=tempfile.mkstemp(prefix='.state-',dir=feed)
        try:
            with os.fdopen(handle,'w') as output:json.dump(data,output,sort_keys=True);output.flush();os.fsync(output.fileno())
            os.replace(temporary,statefile)
        finally:
            if os.path.exists(temporary):os.unlink(temporary)
        atomic_copy(staging/metadata,feed/metadata)
        print('Published '+data['platform']+' '+version+'; update metadata committed last.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('staging',help='Directory containing a generated release.json and its release files');parser.add_argument('--root',default='/var/www/orthodoxmetrics-updates/om-viewer');args=parser.parse_args()
    try:publish(args.staging,args.root)
    except (ValueError,OSError,KeyError) as error:parser.exit(1,str(error)+'\n')
