import calendar
from functools import lru_cache
from datetime import date
import json
import math
import re
from importlib.resources import files
from jsonschema import Draft202012Validator, FormatChecker


@lru_cache(maxsize=3)
def schema_for(version):
    if version not in ('1.0.0','2.0.0','2.1.0'):
        raise ValueError(f'Unsupported package schema version: {version}')
    return json.loads(files('om_viewer').joinpath(f'schemas/import-package-{version}.json').read_text())


def validate_partial_date(d):
    schema=schema_for('1.0.0')
    Draft202012Validator(schema['$defs']['partial_date']).validate(d)
    if d['precision']=='year' and (d['month'] is not None or d['day'] is not None):
        raise ValueError('Year precision cannot carry month/day')
    if d['precision']=='month' and (not d['month'] or d['day'] is not None):
        raise ValueError('Invalid month precision')
    if d['precision']=='day' and (not d['month'] or not d['day']):
        raise ValueError('Day precision requires month/day')
    if d['day'] and d['day']>calendar.monthrange(d['year'],d['month'])[1]:
        raise ValueError('Invalid partial date')


def validate_recurrence(rule):
    schema=schema_for('1.0.0')
    Draft202012Validator({'$defs':schema['$defs'],'$ref':'#/$defs/recurrence'}).validate(rule)
    if rule['type']=='fixed' and rule['day']>calendar.monthrange(2000,rule['month'])[1]:
        raise ValueError('Invalid fixed annual date')
    if rule['type']=='weekday_in_range' and rule['parameters']['start_day']>rule['parameters']['end_day']:
        raise ValueError('Recurrence range is reversed')


def validate_preset(values,profile):
    schema=schema_for('1.0.0')
    definition='parish' if profile=='parish_announcements_v1' else 'cemetery'
    Draft202012Validator({'$defs':schema['$defs'],'$ref':'#/$defs/'+definition}).validate(values)
    if definition=='parish':
        rule=values['recurrence']
        if rule['type']=='fixed' and rule['day']>calendar.monthrange(2000,rule['month'])[1]:
            raise ValueError('Invalid fixed annual date')
        if rule['type']=='weekday_in_range' and rule['parameters']['start_day']>rule['parameters']['end_day']:
            raise ValueError('Recurrence range is reversed')
        if (values['event_year'] is None)!=(values['year_role'] is None):
            raise ValueError('Year and role must be paired')
    else:
        for key in ('birth','death'):
            if values[key] is not None:
                validate_partial_date(values[key])


def validate_typed_value(value,field):
    typ=field['type']
    if value is None:
        return
    if typ=='string' and not isinstance(value,str):
        raise ValueError('Expected string field')
    if typ=='integer' and (type(value) is not int or not -(2**63)<=value<2**63):
        raise ValueError('Expected BIGINT-compatible integer field')
    if typ=='number' and (type(value) not in (int,float) or not math.isfinite(value)):
        raise ValueError('Expected finite number field')
    if typ=='boolean' and type(value) is not bool:
        raise ValueError('Expected boolean field')
    if typ=='date':
        if not isinstance(value,str) or date.fromisoformat(value).isoformat()!=value:
            raise ValueError('Expected ISO full date field')
    if typ=='partial_date':
        validate_partial_date(value)
    if typ=='json':
        json.dumps(value,allow_nan=False)


