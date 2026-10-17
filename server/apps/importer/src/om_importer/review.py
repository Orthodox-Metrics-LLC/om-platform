"""Apply JSON corrections without opening source files; retain revision evidence."""
from copy import deepcopy
from datetime import datetime, timezone
from .validation import validate


def correct(p, record_id, changes, *, actor, note):
    validate(p)
    result = deepcopy(p)
    r = next(r for r in result['records'] if r['id'] == record_id)
    before = deepcopy(r['normalized'])
    if not actor.strip() or not note.strip():
        raise ValueError('Correction requires actor and explanation')
    if not set(changes) <= set(before):
        raise ValueError('Unknown normalized field')
    r['normalized'].update(deepcopy(changes))
    r['review_status'] = 'needs_review'
    result['review_status'] = 'needs_review'
    result['revision'] += 1
    from .decisions import invalidate
    invalidate(result,actor,note)
    result['audit'].append({'revision':result['revision'],'record_id':record_id,
                            'actor':actor,'at':datetime.now(timezone.utc).isoformat(),
                            'before':before,'after':deepcopy(r['normalized']),'note':note})
    validate(result)
    return result
