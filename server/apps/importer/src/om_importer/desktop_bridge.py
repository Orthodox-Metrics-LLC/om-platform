"""One-request JSON/stdio adapter for the desktop host. No database capabilities."""
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import json
import re
import sys
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from jsonschema import ValidationError
from .pipeline import extract, check_source
from .mapping import configure_package
from .review import correct
from .validation import validate
from .xlsx import HEADERS


def inspect_xlsx(filename, selection=None):
    path = Path(filename)
    check_source(path)
    if path.suffix.lower() != '.xlsx':
        raise ValueError('This desktop milestone supports XLSX; DOCX remains available through the CLI.')
    w = load_workbook(path, data_only=False)
    try:
        sheets = [{'name':s.title,'rows':s.max_row,'columns':s.max_column,
                   'header_row':next((row[0].row for row in s if any(c.value is not None for c in row)),None)} for s in w]
        selection = selection or {}
        name = selection.get('sheet') or next((s['name'] for s in sheets if s['header_row'] is not None),None)
        if name not in w.sheetnames:
            raise ValueError('Select a populated worksheet')
        sheet = w[name]
        header = selection.get('header_row', next(s['header_row'] for s in sheets if s['name']==name))
        if type(header) is not int or not 1 <= header <= sheet.max_row:
            raise ValueError('Header row is outside the worksheet')
        headers = [c.value for c in sheet[header]]
        used=set();fields=[]
        for i,label in enumerate(headers,1):
            label=str(label) if label is not None else f'Column {get_column_letter(i)}'
            key=re.sub('[^a-z0-9]+','_',label.lower()).strip('_')[:55]
            if not key or not key[0].isalpha(): key='field_'+key
            base=key;suffix=1
            while key in used:
                suffix+=1;key=f'{base}_{suffix}'
            used.add(key)
            typ='partial_date' if headers==HEADERS and label in ('DOB','DOD') else 'string'
            fields.append({'name':key,'label':label,'type':typ,'source':{'column':get_column_letter(i)},'nullable':True})
        return {'filename':path.name,'worksheets':sheets,
                'columns':[{'column':get_column_letter(i),'header':str(v) if v is not None else ''} for i,v in enumerate(headers,1)],
                'configuration':{'profile':'xlsx','resource_name':path.stem,
                                 'selection':{'sheet':name,'header_row':header},'fields':fields}}
    finally:
        w.close()


def inspect_document(filename, selection=None):
    path=Path(filename)
    if path.suffix.lower()=='.xlsx':
        result=inspect_xlsx(path,selection)
        result['file_type']='xlsx'
        return result
    check_source(path)
    from docx import Document
    from .docx import LABEL,MONTHS
    from .validation import schema_for
    doc=Document(path)
    if not any(p.text.strip() in MONTHS for p in doc.paragraphs) or not any(LABEL.match(p.text) for p in doc.paragraphs):
        raise ValueError('This DOCX does not match the parish announcements preset. Generic DOCX mappings remain available through the CLI.')
    if selection:
        raise ValueError('The parish preset reads all document sections; worksheet selection does not apply.')
    definitions=schema_for('1.0.0')['$defs']['parish']['properties']
    fields=[]
    for name,definition in definitions.items():
        typ='json' if name=='recurrence' else 'integer' if name in ('source_month','event_year') else 'string'
        fields.append({'name':name,'label':name.replace('_',' ').title(),'type':typ,'source':{'path':name},'nullable':True})
    paths=list(definitions)+['recurrence.type','recurrence.text','recurrence.month','recurrence.day']
    return {'filename':path.name,'file_type':'docx','paragraph_count':len(doc.paragraphs),'table_count':len(doc.tables),
            'columns':[],'worksheets':[],'extracted_fields':paths,
            'configuration':{'profile':'parish_announcements_v1','resource_name':'Parish announcements','selection':{},'fields':fields}}


def edit_json(p, edited, actor, note):
    """Bulk normalized-only edits with one validated revision and per-record audit."""
    validate(p)
    if not isinstance(edited,dict) or not isinstance(edited.get('records'),list) or len(edited['records'])!=len(p['records']):
        raise ValueError('JSON editing must preserve the package and its record list')
    if not isinstance(actor,str) or not actor.strip() or not isinstance(note,str) or not note.strip():
        raise ValueError('Provide a reviewer and correction note')
    comparison=deepcopy(edited)
    changes=[]
    for before,after,probe in zip(p['records'],edited['records'],comparison['records']):
        if not isinstance(after,dict) or not isinstance(after.get('normalized'),dict):
            raise ValueError('Each normalized record must be an object')
        if set(before['normalized'])!=set(after['normalized']):
            raise ValueError('Change field definitions in Configure; JSON edits must keep the current field names')
        if before['normalized']!=after['normalized']:
            changes.append((before,after))
        probe['normalized']=deepcopy(before['normalized'])
    if comparison!=p:
        raise ValueError('Edit normalized values only; source evidence, IDs, audit, mappings and statuses are preserved')
    if not changes:
        return deepcopy(p)
    result=deepcopy(p)
    result['revision']+=1
    result['review_status']='needs_review'
    from .decisions import invalidate
    invalidate(result,actor,note)
    updated={r['id']:r for r in result['records']}
    for before,after in changes:
        r=updated[before['id']]
        r['normalized']=deepcopy(after['normalized'])
        r['review_status']='needs_review'
        result['audit'].append({'revision':result['revision'],'record_id':r['id'],
            'actor':actor.strip(),'at':datetime.now(timezone.utc).isoformat(),
            'before':deepcopy(before['normalized']),'after':deepcopy(r['normalized']),'note':note.strip()})
    return validate(result)


def dispatch(request):
    operation=request.get('operation')
    if operation=='resource':
        from .resource_viewer import dispatch as resource_dispatch
        return resource_dispatch(request['settings'],request['action'],request.get('query',{}))
    if operation in ('import_preflight','execute_import'):
        from .database_import import preflight,execute_import
        if operation=='import_preflight':return preflight(request['package'],request['settings'])
        return execute_import(request['package'],request['settings'],request['review_sha256'],request.get('confirmed',False))
    if operation=='test_connection':
        from .database_connection import verify_connection
        return verify_connection(request['settings'])
    if operation=='sql_preview':
        from .sql_preview import dry_run
        return dry_run(request['package'])
    if operation=='inspect': return inspect_document(request['source'],request.get('selection'))
    if operation=='extract': return extract(request['source'],request['configuration'])
    if operation=='decide_flags':
        from .decisions import decide_flags
        return decide_flags(request['package'],request['issue_ids'],request['decision'],actor=request['actor'],note=request['note'])
    if operation=='approve':
        from .decisions import approve_package
        return approve_package(request['package'],actor=request['actor'],note=request['note'],confirmed=request.get('confirmed',False))
    if operation=='configure': return configure_package(request['package'],request['configuration'])
    if operation=='correct': return correct(request['package'],request['record_id'],request['changes'],actor=request['actor'],note=request['note'])
    if operation=='edit_json': return edit_json(request['package'],request['edited'],request['actor'],request['note'])
    if operation=='open_package':
        p=validate(request['package'])
        migrated=p['schema_version']=='1.0.0'
        if migrated:
            fields=[]
            for column in p['resource']['columns']:
                name=column['name']
                values=[r['normalized'][name] for r in p['records'] if r['normalized'][name] is not None]
                typ='string'
                if values and all(isinstance(v,dict) and set(v)=={'year','month','day','precision'} for v in values): typ='partial_date'
                elif any(isinstance(v,(dict,list)) for v in values): typ='json'
                elif values and all(type(v) is int for v in values): typ='integer'
                fields.append({'name':name,'label':name.replace('_',' ').title(),'type':typ,'source':{'path':name},'nullable':True})
            p=configure_package(p,{'profile':p['extraction']['profile'],'resource_name':p['resource']['name'],'fields':fields})
        return {'package':p,'migrated':migrated}
    if operation=='validate': return validate(request['package'])
    raise ValueError('Unsupported desktop operation')


def main():
    try:
        content=sys.stdin.buffer.read(30_000_001)
        if len(content)>30_000_000: raise ValueError('Desktop request exceeds 30 MB')
        result=dispatch(json.loads(content))
        response={'ok':True,'result':result}
    except Exception as exc:
        message=exc.message if isinstance(exc,ValidationError) else str(exc)
        response={'ok':False,'error':message or type(exc).__name__}
    sys.stdout.buffer.write(json.dumps(response,ensure_ascii=False,allow_nan=False).encode('utf-8'))


if __name__=='__main__': main()
