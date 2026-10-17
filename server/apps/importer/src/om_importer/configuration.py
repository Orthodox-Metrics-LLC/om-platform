"""Import configuration independent of any source's business field names."""
from copy import deepcopy
from importlib.resources import files
import json
import re
from jsonschema import Draft202012Validator

SQL_TYPES = {'string': 'TEXT', 'integer': 'BIGINT', 'number': 'DOUBLE',
             'boolean': 'BOOLEAN', 'date': 'DATE', 'partial_date': 'JSON', 'json': 'JSON'}


def validate_config(configuration):
    schema = json.loads(files('om_importer').joinpath('schemas/import-configuration-1.0.0.json').read_text())
    Draft202012Validator(schema).validate(configuration)
    names = [f['name'] for f in configuration['fields']]
    if len(names) != len(set(names)):
        raise ValueError('Field names must be unique')
    profile = configuration['profile']
    allowed = {'xlsx': {'header','column'}, 'docx_table': {'header','column'},
               'docx_paragraphs': {'path','capture'}, 'cemetery_v1': {'path'},
               'parish_announcements_v1': {'path'}}[profile]
    for field in configuration['fields']:
        if not set(field['source']) <= allowed:
            raise ValueError(f"Source selector is incompatible with {profile}")
        if 'format' in field and field['type'] not in ('date','partial_date'):
            raise ValueError('Explicit formats apply only to date fields')
        if field.get('format'):
            directives = set(re.findall(r'%([A-Za-z])',field['format']))
            if not directives <= {'Y','y','m','b','B','d'} or not directives & {'Y','y'}:
                raise ValueError('Date formats must include a year and use year/month/day directives')
            has_month = bool(directives & {'m','b','B'})
            if ('d' in directives and not has_month) or (field['type'] == 'date' and (not has_month or 'd' not in directives)):
                raise ValueError('Full dates require year, month and day; partial_date can retain year or month precision')
        if profile == 'docx_paragraphs'  and 'path' in field['source'] and field['source']['path'] != 'text':
            raise ValueError('Paragraph path must be text; use named captures for other fields')
    selection = configuration.get('selection', {})
    if profile in ('xlsx','docx_table'):
        header = selection.get('header_row',1)
        start = selection.get('start_row',header+1)
        if start <= header or selection.get('end_row',start) < start:
            raise ValueError('Data rows must follow headers and form a valid range')
    if profile == 'docx_paragraphs':
        start = selection.get('start_paragraph',0)
        if selection.get('end_paragraph',start) < start:
            raise ValueError('Invalid paragraph range')
        if any('capture' in f['source'] for f in configuration['fields']):
            if not selection.get('pattern'):
                raise ValueError('Named capture mappings require a paragraph pattern')
    result = deepcopy(configuration)
    result.setdefault('selection', {})
    for f in result['fields']:
        f.setdefault('label',f['name'].replace('_',' ').title())
        f.setdefault('nullable',True)
    return result


def field_columns(config):
    return [{'name':f['name'], 'label':f['label'], 'type':f['type'],
             'sql_type': SQL_TYPES[f['type']], 'nullable':f['nullable']} for f in config['fields']]
