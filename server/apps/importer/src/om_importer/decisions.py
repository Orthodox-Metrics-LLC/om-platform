"""Audited operator decisions and revision-bound JSON approval; no publication."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json

TECHNICAL_CODES = frozenset({'mapping_error','formula_or_cell_error','unsupported_sheet','unsupported_table','extra_columns','merged_cells'})


def fingerprint(package):
    def canonical(value):
        if isinstance(value,dict):return {k:canonical(v) for k,v in value.items()}
        if isinstance(value,list):return [canonical(v) for v in value]
        if type(value) is float and value.is_integer():return int(value)
        return value
    # JSON/JavaScript round trips do not distinguish 12.0 from 12.
    content=canonical({k:v for k,v in package.items() if k!='approval'})
    return hashlib.sha256(json.dumps(content,sort_keys=True,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8')).hexdigest()


def credentials(actor,note):
    if not isinstance(actor,str) or not actor.strip() or not isinstance(note,str) or not note.strip():
        raise ValueError('Reviewer and explanation are required')
    return actor.strip(),note.strip()


def event(p,action,actor,note,issue_ids,before,after):
    p['review_history'].append({'action':action,'revision':p['revision'],'actor':actor,'note':note,
        'at':datetime.now(timezone.utc).isoformat(),'issue_ids':issue_ids,'before':before,'after':after})


def invalidate(p,actor,note):
    """Call after advancing a revision and before validating a changed package."""
    if p.get('approval') is not None:
        old=deepcopy(p['approval']);p['approval']=None
        event(p,'invalidate_approval',actor,note,[],{'approval':old},{'review_status':'needs_review'})
    p['review_status']='needs_review'


def prepare(package,actor,note):
    from .validation import validate
    validate(package)
    actor,note=credentials(actor,note)
    if package['schema_version'] not in ('2.0.0','2.1.0'):
        raise ValueError('Configure legacy packages before making review decisions')
    p=deepcopy(package)
    p['schema_version']='2.1.0';p.setdefault('approval',None);p.setdefault('review_history',[])
    p['revision']+=1
    invalidate(p,actor,note)
    return p,actor,note


def decide_flags(package,issue_ids,decision,*,actor,note):
    if decision not in ('accept','resolve','reopen'):
        raise ValueError('Choose accept, resolve or reopen')
    if not isinstance(issue_ids,list) or not issue_ids or len(set(issue_ids))!=len(issue_ids):
        raise ValueError('Select one or more distinct validation flags')
    p,actor,note=prepare(package,actor,note)
    lookup={i['id']:i for i in p['issues']}
    if any(key not in lookup for key in issue_ids):raise ValueError('Unknown validation flag')
    selected=[lookup[key] for key in issue_ids]
    target={'accept':'accepted','resolve':'resolved','reopen':'open'}[decision]
    if any(i['status']==target for i in selected):raise ValueError('A selected flag already has that decision')
    for i in selected:
        if decision=='accept' and i['code'] in TECHNICAL_CODES:
            raise ValueError('Technical extraction or mapping errors cannot be accepted as source conditions')
        if decision=='resolve' and i['code'] in TECHNICAL_CODES:
            if i['code']!='mapping_error':
                raise ValueError('Reconfigure or re-extract to clear technical extraction flags')
            name=i['message'].split(':',1)[0]
            r=next((r for r in p['records'] if r['id']==i['record_id']),None)
            if not r or r['normalized'].get(name) is None:
                raise ValueError('Correct the mapped field before resolving its mapping error')
    before={i['id']:i['status'] for i in selected}
    for i in selected:i['status']=target
    event(p,{'accept':'accept_flags','resolve':'resolve_flags','reopen':'reopen_flags'}[decision],actor,note,issue_ids,before,{i['id']:target for i in selected})
    from .validation import validate
    return validate(p)


def approve_package(package,*,actor,note,confirmed=False):
    if confirmed is not True:raise ValueError('Confirm review of every included record, mapping and flag decision')
    p,actor,note=prepare(package,actor,note)
    if not p['records']:raise ValueError('Cannot approve an empty package')
    if any(i['severity']=='error' and i['status']=='open' for i in p['issues']):
        raise ValueError('Accept or resolve all open blocking flags before approval')
    for r in p['records']:
        if r['review_status']!='rejected':r['review_status']='approved'
    p['review_status']='approved'
    event(p,'approve_package',actor,note,[],{'review_status':package['review_status']},
          {'review_status':'approved','approved_records':sum(r['review_status']=='approved' for r in p['records'])})
    p['approval']={'revision':p['revision'],'actor':actor,'note':note,
                   'at':p['review_history'][-1]['at'],'sha256':fingerprint(p)}
    from .validation import validate
    return validate(p)
