"""Typed projections from preserved extraction data; configurable per import."""
from copy import deepcopy
from datetime import date, datetime
import json
import math
import re
from .common import issue
from .configuration import validate_config, field_columns
from .xlsx import partial_date


def get_path(values, path):
    current = values
    for key in path.split('.'):
        if current is None:
            return None
        if not isinstance(current,dict) or key not in current:
            raise ValueError(f'Unknown extracted field path: {path}')
        current = current[key]
    return deepcopy(current)


def convert(value, field):
    if value is None:
        return None
    typ = field['type']
    if typ == 'json':
        result = json.loads(value) if isinstance(value,str) else deepcopy(value)
        json.dumps(result,allow_nan=False)
        return result
    if typ == 'string':
        if isinstance(value,(dict,list)):
            raise ValueError('Use json type for structured data')
        if isinstance(value,(date,datetime)):
            return value.isoformat()
        return str(value)
    if typ == 'boolean':
        if isinstance(value,bool):
            return value
        # Explicit grammar, no arbitrary truthiness.
        if type(value) is int and value in (0,1):
            return bool(value)
        if isinstance(value,str) and value.strip().lower() in ('true','false','yes','no','1','0'):
            return value.strip().lower() in ('true','yes','1')
        raise ValueError('Expected boolean, true/false, yes/no or 1/0')
    if typ in ('integer','number'):
        if isinstance(value,bool) or isinstance(value,(dict,list)):
            raise ValueError('Expected numeric value')
        if typ == 'integer':
            if isinstance(value,float) and (not math.isfinite(value) or not value.is_integer()):
                raise ValueError('Integer conversion would lose precision')
            if isinstance(value,str) and not re.fullmatch(r'[+-]?\d+',value.strip()):
                raise ValueError('Expected an integer')
            result = int(value)
            if not -(2**63) <= result < 2**63:
                raise ValueError('Integer exceeds BIGINT range')
            return result
        result = float(value)
        if not math.isfinite(result):
            raise ValueError('Expected a finite number')
        return result
    if typ in ('date','partial_date'):
        if isinstance(value,dict) and typ == 'partial_date':
            from .validation import validate_partial_date
            validate_partial_date(value)
            return deepcopy(value)
        if isinstance(value,dict) and typ == 'date':
            from .validation import validate_partial_date
            validate_partial_date(value)
            if value['precision'] != 'day':
                raise ValueError('Full date required; choose partial_date for incomplete dates')
            value = date(value['year'],value['month'],value['day'])
        if isinstance(value,str):
            if field.get('format'):
                parsed = datetime.strptime(value,field['format'])
                if typ == 'partial_date':
                    directives = set(re.findall(r'%([A-Za-z])',field['format']))
                    has_month = bool(directives & {'m','b','B'})
                    return {'year':parsed.year,'month':parsed.month if has_month else None,
                            'day':parsed.day if 'd' in directives else None,
                            'precision':'day' if 'd' in directives else 'month' if has_month else 'year'}
                value = parsed
            elif re.fullmatch(r'\d{4}-\d{2}-\d{2}T.+',value):
                value = datetime.fromisoformat(value)
            elif typ == 'date':
                # Only ISO unless the administrator supplies a format.
                value = date.fromisoformat(value)
            elif re.fullmatch(r'\d{4}',value):
                value = int(value)
            elif re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):
                value = date.fromisoformat(value)
        if typ == 'date':
            if not isinstance(value,(date,datetime)):
                raise ValueError('Full date required; choose partial_date for incomplete dates')
            return value.date().isoformat() if isinstance(value,datetime) else value.isoformat()
        normalized,error = partial_date(value)
        # Suspicious years are representable source values, not parse failures.
        if normalized is None:
            raise ValueError(error or 'Cannot parse partial date')
        return normalized
    raise ValueError('Unknown field type')


def apply_fields(p,config,resolver):
    """Apply mappings to records; keep failures and raw evidence in the package."""
    config = validate_config(config)
    if p['schema_version'] != '2.1.0':
        p['schema_version'] = '2.0.0'
    p['configuration'] = config
    p['resource']['columns'] = field_columns(config)
    if 'resource_name' in config:
        p['resource']['name'] = config['resource_name']
    for r in p['records']:
        r.setdefault('extracted',deepcopy(r['normalized']))
        r['normalized'] = {}
        r['field_sources'] = {}
        for field in config['fields']:
            value, location, error = resolver(r,field)
            r['field_sources'][field['name']] = {'selector':deepcopy(field['source']),
                                                 'value':deepcopy(value), 'location':location}
            converted = None
            if error is None:
                try:
                    converted = convert(value,field)
                except (ValueError,TypeError,OverflowError) as exc:
                    error = str(exc)
            if converted is None and not field['nullable'] and error is None:
                error = 'Required field is empty'
            if error:
                issue(p,'mapping_error', f"{field['name']}: {error}",r['block_id'],r['id'],'error')
            r['normalized'][field['name']] = converted
    return p


def configure_package(p,configuration):
    """Remap preserved extraction fields without rereading DOCX/XLSX bytes."""
    from .validation import validate
    validate(p)
    config = validate_config(configuration)
    if config['profile'] != p['extraction']['profile']:
        raise ValueError('Configuration profile must match the extracted package')
    result = deepcopy(p)
    profile = config['profile']
    if profile in ('cemetery_v1','parish_announcements_v1'):
        for field in config['fields']:
            for r in result['records']:
                get_path(r.get('extracted',r['normalized']),field['source']['path'])
        def resolver(r,field):
            return get_path(r['extracted'],field['source']['path']),dict(r['source_location']),None
    else:
        # Source row/paragraph selection is fixed for JSON-only remapping. All chosen
        # raw values remain available, including columns omitted from the first mapping.
        previous_selection = p['configuration']['selection']
        requested = config['selection']
        if any(previous_selection.get(k) != v for k,v in requested.items()):
            raise ValueError('JSON-only remapping preserves source selection; extract again to select different source rows or patterns')
        config['selection'] = deepcopy(previous_selection)
        if profile in ('xlsx','docx_table'):
            from .generic import column_bindings
            from openpyxl.utils import get_column_letter
            header_row = previous_selection['header_row']
            if profile == 'xlsx':
                block = next(b for b in result['source_blocks'] if b['location'].get('sheet') == previous_selection['sheet']
                             and b['location'].get('row') == header_row)
                headers = [v['value'] for v in block['raw'].values()]
            else:
                block = next(b for b in result['source_blocks'] if b['location'].get('table') == previous_selection['table_index']
                             and b['location'].get('row') == header_row)
                headers = list(block['raw'].values())
            bindings = column_bindings(config,headers)
            result['extraction']['metadata']['column_bindings'] = bindings
            def resolver(r,field):
                col = bindings[field['name']]
                letter = get_column_letter(col)
                if profile == 'docx_table':
                    value = r['extracted'][letter]
                    return (None if not value.strip() else value),{**r['source_location'],'column':col},None
                cell = letter + str(r['source_location']['row'])
                original = r['original'][cell]
                value = original['value']
                error = 'Formula or cell error cannot be converted' if original['type'] in ('f','e') else None
                if field['type'] == 'string' and type(value) is int and re.fullmatch('0+',original['number_format']):
                    value = str(value).zfill(len(original['number_format']))
                return value,{**r['source_location'],'cell':cell},error
        else:
            pattern = re.compile(previous_selection['pattern']) if previous_selection.get('pattern') else None
            for field in config['fields']:
                if 'capture' in field['source'] and (pattern is None or field['source']['capture'] not in pattern.groupindex):
                    raise ValueError('Unknown named capture')
            def resolver(r,field):
                if 'path' in field['source']:
                    return r['extracted']['text'],dict(r['source_location']),None
                capture = field['source']['capture']
                match = pattern.fullmatch(r['extracted']['text']) if pattern else None
                loc = dict(r['source_location'])
                if not match:
                    return None,loc,'Paragraph pattern did not match'
                a,z = match.span(capture)
                if a >= 0:
                    loc.update(char_start=a,char_end=z)
                return match[capture],loc,None
    # Retain previous configuration/edits as history; replacing normalized fields is explicit.
    result['extraction']['metadata'].setdefault('mapping_history',[]).append({
        'revision':p['revision'], 'configuration':deepcopy(p.get('configuration')),
        'columns':deepcopy(p['resource']['columns']),
        'records': [{'id':r['id'],'normalized':deepcopy(r['normalized'])} for r in p['records']],
        'issues':deepcopy(p['issues'])})
    for finding in result['issues']:
        if finding['code']=='mapping_error':
            finding['status']='resolved'
    # Old mapping findings remain traceable; new conversion failures get new IDs.
    result['revision'] += 1
    from .decisions import invalidate
    invalidate(result,'Local operator','Field mappings changed; package requires review again')
    result['review_status'] = 'needs_review'
    for r in result['records']:
        r['review_status'] = 'needs_review'
    apply_fields(result,config,resolver)
    validate(result)
    return result
