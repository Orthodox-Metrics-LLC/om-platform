/**
 * Deterministic natural-language parser → parish search AST + interpretation chips.
 * No AI; no SQL generation.
 */

const { CANONICAL_DATE_FIELDS, listRecordTypes } = require('./recordFieldRegistry');

const TYPE_PATTERNS = [
  { re: /\b(baptisms?|baptized|baptismal)\b/i, type: 'baptism' },
  { re: /\b(marriages?|married|wedding|weddings|nuptial)\b/i, type: 'marriage' },
  { re: /\b(funerals?|burial|burials|deceased|died|death)\b/i, type: 'funeral' },
];

const THIS_YEAR = () => new Date().getFullYear();
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Relative and open-ended periods for sacramental event dates:
 * "this year", "last year", "this month", "last month", "the 1980s", "since 2020",
 * "before 1950", "after 1990", "last 5 years", "past decade".
 * Returns { from, to, label } as ISO dates or null.
 */
function relativeDateRangeFromText(q) {
  let m;
  const y = THIS_YEAR();
  const now = new Date();
  if (/\bthis\s+year\b/i.test(q)) return { from: `${y}-01-01`, to: `${y}-12-31`, label: `This year (${y})` };
  if (/\b(?:last|previous)\s+year\b/i.test(q)) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `Last year (${y - 1})` };
  if (/\bthis\s+month\b/i.test(q)) { const mm = pad2(now.getMonth() + 1); const last = new Date(y, now.getMonth() + 1, 0).getDate(); return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${pad2(last)}`, label: 'This month' }; }
  if (/\b(?:last|previous)\s+month\b/i.test(q)) { const d = new Date(y, now.getMonth() - 1, 1); const yy = d.getFullYear(); const mm = pad2(d.getMonth() + 1); const last = new Date(yy, d.getMonth() + 1, 0).getDate(); return { from: `${yy}-${mm}-01`, to: `${yy}-${mm}-${pad2(last)}`, label: 'Last month' }; }
  if ((m = q.match(/\b(?:last|past)\s+(\d{1,3})\s+years?\b/i))) { const n = Number(m[1]); return { from: `${y - n}-01-01`, to: `${y}-12-31`, label: `Last ${n} years` }; }
  if (/\b(?:last|past)\s+decade\b/i.test(q)) return { from: `${y - 10}-01-01`, to: `${y}-12-31`, label: 'Past decade' };
  if ((m = q.match(/\b(?:the\s+)?(\d{3})0'?s\b/i))) { const start = Number(`${m[1]}0`); return { from: `${start}-01-01`, to: `${start + 9}-12-31`, label: `The ${start}s` }; }
  if ((m = q.match(/\b(?:since|from|starting)\s+(\d{4})\b(?!\s*(?:-|–|to|through|until))/i))) return { from: `${m[1]}-01-01`, to: `${y}-12-31`, label: `Since ${m[1]}` };
  if ((m = q.match(/\b(?:before|prior to|earlier than|until|up to)\s+(\d{4})\b/i))) return { from: '1000-01-01', to: `${Number(m[1]) - 1}-12-31`, label: `Before ${m[1]}` };
  if ((m = q.match(/\b(?:after|later than|following)\s+(\d{4})\b/i))) return { from: `${Number(m[1]) + 1}-01-01`, to: `${y}-12-31`, label: `After ${m[1]}` };
  if ((m = q.match(/\b(?:in|during|for)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i))) {
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const mi = months.indexOf(m[1].toLowerCase()); const yy = Number(m[2]); const last = new Date(yy, mi + 1, 0).getDate();
    return { from: `${yy}-${pad2(mi + 1)}-01`, to: `${yy}-${pad2(mi + 1)}-${pad2(last)}`, label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${yy}` };
  }
  return null;
}

/** "missing birthplace", "without sponsors", "no clergy", "empty burial location" → is_empty field. */
const EMPTY_FIELD_ALIASES = [
  { re: /\b(?:birth\s*place|place\s+of\s+birth)\b/i, field: 'birthplace', types: ['baptism'] },
  { re: /\b(?:date\s+of\s+birth|birth\s*date|dob)\b/i, field: 'birth_date', types: ['baptism'] },
  { re: /\b(?:sponsors?|god\s*parents?)\b/i, field: 'sponsors', types: ['baptism'] },
  { re: /\bparents?\b/i, field: 'parents', types: ['baptism'] },
  { re: /\bwitness(?:es)?\b/i, field: 'witness', types: ['marriage'] },
  { re: /\b(?:burial\s+(?:location|place)|cemetery)\b/i, field: 'burial_location', types: ['funeral'] },
  { re: /\b(?:date\s+of\s+death|death\s+date)\b/i, field: 'deceased_date', types: ['funeral'] },
  { re: /\bage\b/i, field: 'age', types: ['funeral'] },
  { re: /\b(?:clergy|priest|celebrant)\b/i, field: 'clergy', types: null },
  { re: /\b(?:location|place)\b/i, field: 'location', types: null },
  { re: /\b(?:event\s+)?dates?\b/i, field: 'canonical_event_date', types: null },
  { re: /\bstatus\b/i, field: 'status', types: null },
];
function extractMissingField(q) {
  const m = q.match(/\b(?:missing|without|no|empty|blank|lacking|unknown)\s+(?:a\s+|an\s+|the\s+|their\s+)?([a-z][a-z ]{2,30}?)(?=\s+(?:and|or|in|for|by|between|from|since|before|after)\b|[,.]|$)/i);
  if (!m) return null;
  const phrase = m[1];
  const hit = EMPTY_FIELD_ALIASES.find((a) => a.re.test(phrase));
  return hit ? { ...hit, phrase: phrase.trim() } : null;
}

function yearRangeFromText(q) {
  let m;
  if ((m = q.match(/\bbetween\s+(\d{4})\s+and\s+(\d{4})\b/i))) {
    return [Number(m[1]), Number(m[2])];
  }
  if ((m = q.match(/\bfrom\s+(\d{4})\s+(?:through|to|until|-)\s+(\d{4})\b/i))) {
    return [Number(m[1]), Number(m[2])];
  }
  if ((m = q.match(/\bin\s+(\d{4})\b/i))) {
    return [Number(m[1]), Number(m[1])];
  }
  if ((m = q.match(/\b(\d{4})\s*(?:-|–|through|to)\s*(\d{4})\b/i))) {
    return [Number(m[1]), Number(m[2])];
  }
  return null;
}

function extractClergy(q) {
  const m = q.match(/\b(?:performed by|officiated by|celebrant|by)\s+((?:Rev\.?|Fr\.?|Father|Priest)\s+[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3})(?=\s+(?:between|from|in|to|with|and|,)|$)/i);
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  const m2 = q.match(/\b((?:Rev\.?|Fr\.?)\s+[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})\b/);
  if (m2) return m2[1].replace(/\s+/g, ' ').trim();
  return null;
}

function extractLocation(q) {
  let m;
  if ((m = q.match(/\b(?:burial location|location|at|in|mentioning)\s+contains\s+["']?([^"']+?)["']?(?:\s+to\s|\s+with\s|$)/i))) {
    return { op: 'contains', value: m[1].trim() };
  }
  if ((m = q.match(/\bburial location contains\s+(.+)$/i))) {
    return { op: 'contains', value: m[1].trim() };
  }
  if ((m = q.match(/\b(?:mentioning|records mentioning)\s+([A-Z][A-Za-z0-9 .'-]+)/))) {
    return { op: 'contains', value: m[1].trim() };
  }
  return null;
}

function extractName(q) {
  let m;
  if ((m = q.match(/\b(?:last name|surname)\s+([A-Z][a-zA-Z'-]+)/i))) {
    return { kind: 'last', value: m[1] };
  }
  if ((m = q.match(/\b(?:involving|for|connected to(?: the)?|records for)\s+(?:the\s+)?([A-Z][a-zA-Z'-]+)(?:\s+family)?\b/))) {
    const v = m[1];
    if (!/^(All|Baptism|Marriage|Funeral|Rev|Fr|Father)$/i.test(v)) {
      return { kind: /family/i.test(q) ? 'family' : 'name', value: v };
    }
  }
  if ((m = q.match(/\b(?:for|named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/))) {
    return { kind: 'full', value: m[1] };
  }
  if ((m = q.match(/\ball records for\s+(.+)$/i))) {
    return { kind: 'full', value: m[1].trim() };
  }
  return null;
}

function detectRecordTypes(q) {
  const found = [];
  for (const p of TYPE_PATTERNS) {
    if (p.re.test(q)) found.push(p.type);
  }
  if (/\bbaptism,\s*marriage,\s*and\s*funeral\b/i.test(q) || /\ball records\b/i.test(q) || /\bparish records\b/i.test(q)) {
    return listRecordTypes();
  }
  if (!found.length && /\b(people|person|family|records)\b/i.test(q)) {
    return listRecordTypes();
  }
  return found.length ? [...new Set(found)] : listRecordTypes();
}

function parseNaturalLanguage(queryText, { churchId } = {}) {
  const q = String(queryText || '').trim();
  const clarifications = [];
  const interpretation = [];
  if (!q) {
    return {
      ast: null,
      interpretation: [],
      clarifications: [{ id: 'empty', message: 'Enter a search query.' }],
      confidence: 0,
      exportIntent: null,
    };
  }

  const recordTypes = detectRecordTypes(q);
  interpretation.push({ id: 'recordTypes', label: 'Record types', value: recordTypes.map((t) => t[0].toUpperCase() + t.slice(1)).join(', '), field: 'scope.recordTypes', editable: true });

  const conditions = [];
  let workflowIntent = null;
  let activity = null;
  let rules = [];

  // Destructive NL never executes deletion — navigate to duplicate review workflow only
  const deleteDuplicateWorkflow = /\b(?:delete|remove)\s+(?:selected\s+)?duplicates?\b|\bkeep\s+this\s+record\s+and\s+remove\b|\bdelete\s+duplicate\s+records\b/i.test(q);

  // Activity intents — NEVER map to sacramental event dates
  const activityPast24h = /\b(?:past|last)\s+24\s+hours?\b|\bin\s+the\s+past\s+24\s+hours?\b|\bpast\s+day\b/i.test(q);
  const activityToday = /\b(?:created|added|imported|new)\b.*\btoday\b|\btoday\b.*\b(?:records?|baptisms?|marriages?|funerals?)\b|\brecords?\s+added\s+today\b|\bocr\s+records?\s+added\s+today\b/i.test(q);
  const activitySinceYesterday = /\bsince\s+yesterday\b|\bmodified\s+since\s+yesterday\b/i.test(q);
  const TIME_PHRASE = /\b(?:today|yesterday|24|this\s+week|last\s+week|past\s+week|this\s+month|last\s+month|past\s+month|(?:past|last)\s+\d+\s+(?:hours?|days?|weeks?|months?)|recent(?:ly)?)\b/i;
  const activityModified = /\b(?:modified|changed|updated|edited|recently\s+changed)\b/i.test(q);
  const activityImported = /\b(?:imported|ocr)\b/i.test(q) && TIME_PHRASE.test(q);
  const activityCreated = /\b(?:created|added|new|entered)\b/i.test(q) && TIME_PHRASE.test(q);
  const activityDeleted = /\b(?:deleted|removed)\b/i.test(q) && !/\bduplicates?\b/i.test(q);
  const activityRestored = /\brestored\b/i.test(q);
  const activityVerified = /\bverified\b/i.test(q) && TIME_PHRASE.test(q);
  const generalRecent = /\brecords?\s+in\s+the\s+past\s+24\s+hours?\b|\brecent(?:ly)?\s+(?:changed\s+)?(?:funeral|baptism|marriage)?\s*records?\b/i.test(q);
  // "this week" / "last N days" etc. → activity window (only when an activity verb is present)
  let windowFromPhrase = null; let windowLabel = null;
  let wm;
  if (/\bthis\s+week\b/i.test(q)) { windowFromPhrase = { amount: 7, unit: 'days' }; windowLabel = 'This week'; }
  else if (/\b(?:last|past)\s+week\b/i.test(q)) { windowFromPhrase = { amount: 14, unit: 'days' }; windowLabel = 'Last week'; }
  else if (/\bthis\s+month\b/i.test(q)) { windowFromPhrase = { amount: 31, unit: 'days' }; windowLabel = 'This month'; }
  else if (/\b(?:last|past)\s+month\b/i.test(q)) { windowFromPhrase = { amount: 2, unit: 'months' }; windowLabel = 'Last month'; }
  else if ((wm = q.match(/\b(?:past|last)\s+(\d+)\s+(hours?|days?|weeks?|months?)\b/i))) { windowFromPhrase = { amount: Number(wm[1]), unit: wm[2].toLowerCase().replace(/s?$/, 's') }; windowLabel = `Past ${wm[1]} ${wm[2].toLowerCase()}`; }
  else if (/\brecent(?:ly)?\b/i.test(q) && (activityModified || activityCreated || activityImported || activityDeleted || activityRestored)) { windowFromPhrase = { amount: 30, unit: 'days' }; windowLabel = 'Past 30 days'; }

  const anyActivityVerb = activityCreated || activityModified || activityImported || activityDeleted || activityRestored || activityVerified;
  if (activityPast24h || activityToday || activitySinceYesterday || generalRecent || (anyActivityVerb && (TIME_PHRASE.test(q) || activityDeleted || activityRestored))) {
    let eventTypes = ['created', 'imported'];
    if (activityDeleted && !activityRestored) eventTypes = ['deleted'];
    else if (activityRestored && !activityDeleted) eventTypes = ['restored'];
    else if (activityVerified && !activityModified && !activityCreated) eventTypes = ['verified'];
    else if (activityModified && !activityCreated && !activityImported && !generalRecent) eventTypes = ['modified'];
    else if (activityImported && !activityCreated && !activityModified) eventTypes = ['imported'];
    else if (activityCreated && !activityImported && !activityModified) eventTypes = ['created'];
    else if (/\bany\s+activity\b|\brecently\s+changed\b/i.test(q) && activityModified) eventTypes = ['modified'];
    let relativeWindow = { amount: 24, unit: 'hours' };
    if (activityToday) relativeWindow = { preset: 'today' };
    else if (activitySinceYesterday) relativeWindow = { preset: 'since_yesterday' };
    else if (windowFromPhrase) relativeWindow = windowFromPhrase;
    else if (activityDeleted || activityRestored) { relativeWindow = { amount: 12, unit: 'months' }; windowLabel = 'Past 12 months'; }
    activity = { eventTypes, relativeWindow };
    interpretation.push({
      id: 'activity',
      label: 'Activity',
      value: eventTypes.includes('created') && eventTypes.includes('imported')
        ? 'Created or imported'
        : eventTypes.map((e) => e[0].toUpperCase() + e.slice(1)).join(', '),
      field: 'activity.eventTypes',
      editable: true,
    });
    interpretation.push({
      id: 'timeWindow',
      label: 'Time window',
      value: relativeWindow.preset === 'today' ? 'Today' : relativeWindow.preset === 'since_yesterday' ? 'Since yesterday' : windowLabel || 'Past 24 hours',
      field: 'activity.relativeWindow',
      editable: true,
    });
    if (generalRecent || (activityPast24h && !activityModified && !activityCreated && !activityImported)) {
      clarifications.push({
        id: 'activity_event_types',
        message: 'Interpreted as records created or imported in this window. Change activity type?',
        options: [
          { id: 'created_or_imported', label: 'Created or imported' },
          { id: 'created', label: 'Created' },
          { id: 'modified', label: 'Modified' },
          { id: 'imported', label: 'Imported' },
          { id: 'verified', label: 'Verified' },
          { id: 'any_activity', label: 'Any activity' },
        ],
        default: 'created_or_imported',
      });
    }
  }

  // Data-quality intents
  const dqConflicting = /\b(?:conflicting|inconsistent)\s+date\s+formats?\b|\brecords?\s+with\s+inconsistent\s+dates?\b/i.test(q);
  const dqInvalid = /\b(?:invalid|unparseable)\s+dates?\b|\bdates?\s+could\s+not\s+be\s+parsed\b/i.test(q);
  const dqAmbiguous = /\bambiguous\s+dates?\b/i.test(q);
  const dqBirthAfter = /\bbirth\s+date\s+(?:is\s+)?(?:after|follows)\s+(?:baptism|reception)\b|\bbirth\s+date\s+follows\s+reception\b/i.test(q);
  const dqDeathAfter = /\bdeath\s+date\s+(?:is\s+)?(?:after|follows)\s+burial\b|\bdeath\s+date\s+follows\s+burial\b/i.test(q);
  if (dqConflicting || dqInvalid || dqAmbiguous || dqBirthAfter || dqDeathAfter) {
    if (dqConflicting) rules.push({ rule: 'inconsistent_raw_date_format' });
    if (dqInvalid) rules.push({ rule: 'invalid_date' });
    if (dqAmbiguous) rules.push({ rule: 'ambiguous_date' });
    if (dqBirthAfter) rules.push({ rule: 'birth_after_reception' });
    if (dqDeathAfter) rules.push({ rule: 'death_after_burial' });
    interpretation.push({
      id: 'dataQuality',
      label: 'Search mode',
      value: 'Data quality',
      field: 'operation',
      editable: false,
    });
    interpretation.push({
      id: 'dqRule',
      label: 'Rule',
      value: rules.map((r) => r.rule.replace(/_/g, ' ')).join(', '),
      field: 'rules',
      editable: true,
    });
  }

  const ambiguousDuplicateIntent = /\b(?:matching\s+records?|same\s+records?)\b/i.test(q);
  const duplicateRecordIntent = /\b(?:duplicate|duplicates|duplicated|repeated\s+records?|same\s+records?|matching\s+records?|probable\s+duplicates?|same\s+couple|same\s+deceased\s+name|same\s+name[^.]*\bdate)\b/i.test(q) || deleteDuplicateWorkflow;
  const possiblePersonIntent = /\b(?:possible\s+duplicate\s+people|duplicate\s+people|same\s+person|likely\s+same\s+person|possible\s+person|people\s+who\s+may\s+have\s+more\s+than\s+one)\b/i.test(q);
  const quotedDuplicateWord = /(?:containing|contains|mentioning|named)\s+["']?duplicate["']?/i.test(q);
  let operation = { type: 'records' };
  if (deleteDuplicateWorkflow) {
    workflowIntent = 'duplicate_removal_review';
    interpretation.push({
      id: 'workflow',
      label: 'Workflow',
      value: 'Duplicate review (selection required — not deleted by this search)',
      field: 'workflowIntent',
      editable: false,
    });
  }
  if (rules.length) {
    operation = { type: 'data_quality' };
  } else if (activity) {
    operation = { type: 'record_activity' };
  } else if (!quotedDuplicateWord && (duplicateRecordIntent || possiblePersonIntent)) {
    if (ambiguousDuplicateIntent || /\b(?:duplicates?|duplicated)\b/i.test(q) && !/\b(?:records?|baptisms?|marriages?|funerals?|people|person)\b/i.test(q)) {
      clarifications.push({ id: 'duplicate_mode', message: 'What do you want to find?', options: [{ id: 'record_duplicates', label: 'Repeated sacramental records' }, { id: 'possible_people', label: 'Records that may belong to the same person' }, { id: 'both', label: 'Both' }], default: 'record_duplicates' });
    }
    const mode = possiblePersonIntent ? 'possible_people' : 'record_duplicates';
    const matchLevel = /\bexact|strict\b/i.test(q) ? 'strict' : /\bloose|possible\b/i.test(q) ? 'loose' : 'standard';
    operation = { type: 'duplicate_detection', mode, matchLevel, fields: [], minimumGroupSize: 2, ocrTolerance: /\bocr\b/i.test(q) ? 2 : 1, source: /\bocr(?:\s+imports?)?\b/i.test(q) ? 'ocr' : null };
    interpretation.push({ id: 'operation', label: 'Search mode', value: mode === 'possible_people' ? 'Possible person matches' : 'Duplicate records', field: 'operation', editable: true });
    interpretation.push({ id: 'preset', label: 'Match preset', value: matchLevel[0].toUpperCase() + matchLevel.slice(1), field: 'operation.matchLevel', editable: true });
  }
  const clergy = extractClergy(q);
  if (clergy) {
    // Registers vary in honorifics ("Fr." vs "Rev." vs "Father"): match on the name itself.
    const clergyName = clergy.replace(/^(?:Rev\.?|Fr\.?|Father|Priest|Archbishop|Bishop|Deacon|Dn\.?|Protodeacon|Archpriest|Hieromonk|Metropolitan)\s+/i, '').trim() || clergy;
    conditions.push({ field: 'clergy', operator: 'contains', value: clergyName });
    interpretation.push({ id: 'clergy', label: 'Clergy', value: clergy, field: 'clergy', editable: true });
  }

  const years = yearRangeFromText(q);
  const mentionsDeath = /\b(death|died|deceased|date of death)\b/i.test(q);
  const mentionsBurial = /\b(burial|buried|funeral date|date of burial)\b/i.test(q);
  if (years) {
    const [y1, y2] = years[0] <= years[1] ? years : [years[1], years[0]];
    const from = `${y1}-01-01`;
    const to = `${y2}-12-31`;
    if (recordTypes.length === 1 && recordTypes[0] === 'funeral' && mentionsDeath && !mentionsBurial) {
      conditions.push({ field: 'deceased_date', operator: 'between', value: [from, to] });
      interpretation.push({ id: 'date', label: 'Date of death', value: `${from} through ${to}`, field: 'deceased_date', editable: true });
    } else if (recordTypes.length === 1 && recordTypes[0] === 'funeral' && !mentionsDeath && !mentionsBurial && /\b(date|between|from|in )\b/i.test(q)) {
      // Ambiguous funeral date — ask
      clarifications.push({
        id: 'funeral_date_field',
        message: 'Which date should be used?',
        options: [
          { id: 'burial_date', label: 'Date of burial' },
          { id: 'deceased_date', label: 'Date of death' },
        ],
        default: 'burial_date',
      });
      // Prefer canonical burial_date pending clarification application by client
      conditions.push({ field: 'canonical_event_date', operator: 'between', value: [from, to] });
      interpretation.push({ id: 'date', label: 'Burial date', value: `${from} through ${to}`, field: 'canonical_event_date', editable: true });
    } else {
      conditions.push({ field: 'canonical_event_date', operator: 'between', value: [from, to] });
      interpretation.push({ id: 'date', label: 'Event date', value: `${from} through ${to}`, field: 'canonical_event_date', editable: true });
    }
  }

  // Relative / open-ended periods ("this year", "the 1980s", "since 2020", "before 1950") — event dates, not activity
  const rel = !years && operation.type === 'records' ? relativeDateRangeFromText(q) : null;
  if (rel) {
    const field = recordTypes.length === 1 && recordTypes[0] === 'funeral' && mentionsDeath && !mentionsBurial ? 'deceased_date' : 'canonical_event_date';
    conditions.push({ field, operator: 'between', value: [rel.from, rel.to] });
    interpretation.push({ id: 'date', label: field === 'deceased_date' ? 'Date of death' : 'Event date', value: rel.label, field, editable: true });
  }

  // Missing / empty field ("baptisms with missing birthplace", "funerals without a burial location")
  const missing = operation.type === 'records' ? extractMissingField(q) : null;
  if (missing) {
    conditions.push({ field: missing.field, operator: 'is_empty' });
    interpretation.push({ id: 'missing', label: 'Missing', value: missing.phrase, field: missing.field, editable: true });
  }

  // Register status
  if (operation.type === 'records') {
    if (/\bawaiting\s+clergy\b/i.test(q)) { conditions.push({ field: 'status', operator: 'equals', value: 'Awaiting Clergy' }); interpretation.push({ id: 'status', label: 'Status', value: 'Awaiting Clergy', field: 'status', editable: true }); }
    else if (/\bverified\b/i.test(q) && !/\bunverified\b/i.test(q) && !activity) { conditions.push({ field: 'status', operator: 'equals', value: 'Verified' }); interpretation.push({ id: 'status', label: 'Status', value: 'Verified', field: 'status', editable: true }); }
    else if (/\b(?:recorded|unverified)\b/i.test(q) && /\brecorded\b/i.test(q)) { conditions.push({ field: 'status', operator: 'equals', value: 'Recorded' }); interpretation.push({ id: 'status', label: 'Status', value: 'Recorded', field: 'status', editable: true }); }
  }

  const loc = extractLocation(q);
  if (loc) {
    conditions.push({ field: 'location', operator: loc.op, value: loc.value });
    interpretation.push({ id: 'location', label: 'Location', value: loc.value, field: 'location', editable: true });
  }

  const name = extractName(q);
  let textSearch = null;
  const relationships = [];
  if (name) {
    if (name.kind === 'last' || name.kind === 'family') {
      // last name across types via textSearch + contains on last-name fields handled in planner via textSearch
      textSearch = name.value;
      interpretation.push({ id: 'name', label: name.kind === 'family' ? 'Family' : 'Last name', value: name.value, field: 'textSearch', editable: true });
      if (name.kind === 'family' || /connected to|family/i.test(q)) {
        relationships.push({ type: 'family', value: name.value });
      }
    } else {
      textSearch = name.value;
      interpretation.push({ id: 'name', label: 'Name', value: name.value, field: 'textSearch', editable: true });
    }
  }

  // Bare names: "Petrowsky", "Olga Yazkowsky", "smith family" — anything left that isn't a keyword
  if (!name && !textSearch && operation.type === 'records') {
    const STOP = /^(?:all|records?|baptisms?|baptism|baptized|marriages?|marriage|married|weddings?|funerals?|funeral|burials?|buried|deceased|died|death|in|the|this|last|past|year|years|month|decade|since|before|after|by|for|with|and|or|of|at|to|from|between|through|missing|without|no|empty|verified|recorded|awaiting|clergy|status|export|csv|xml|excel|pdf|sorted|sort|show|find|list|me|new|old|rev|fr|father|priest|celebrant|people|person|family|records|dates?|birthplace|sponsors?|parents?|witness(?:es)?|location|place|age|license|january|february|march|april|may|june|july|august|september|october|november|december|during|show|search)$/i;
    const leftovers = q.replace(/\b\d{4}s?\b/g, ' ').split(/[^A-Za-z'’-]+/).filter((w) => w.length > 1 && !STOP.test(w));
    const clergyWords = new Set((clergy || '').toLowerCase().split(/\s+/));
    const nameWords = leftovers.filter((w) => !clergyWords.has(w.toLowerCase()) && !(loc && loc.value.toLowerCase().includes(w.toLowerCase())) && !(missing && missing.phrase.toLowerCase().includes(w.toLowerCase())));
    if (nameWords.length && nameWords.length <= 3) {
      textSearch = nameWords.join(' ');
      interpretation.push({ id: 'name', label: 'Name contains', value: textSearch, field: 'textSearch', editable: true });
    }
  }

  if (/\bpeople baptized here who later married here\b/i.test(q) || /\bbaptized.*married\b/i.test(q)) {
    relationships.push({ type: 'baptized_then_married' });
    interpretation.push({ id: 'rel', label: 'Relationship', value: 'Baptized then married (probable match)', field: 'relationships', editable: false });
  }
  if (/\bsame person\b/i.test(q) || /\bbaptism and funeral\b/i.test(q)) {
    relationships.push({ type: 'same_person' });
  }

  const aggregates = [];
  const groupBy = [];
  if (/\bcount\b/i.test(q) && /\bby year\b/i.test(q)) {
    aggregates.push({ fn: 'count', field: '*' });
    groupBy.push('canonical_event_year');
    interpretation.push({ id: 'agg', label: 'Aggregate', value: 'Count by year', field: 'aggregates', editable: false });
  }

  let exportIntent = null;
  if (/\bexport\b/i.test(q)) {
    let format = 'xlsx';
    if (/\bcsv\b/i.test(q)) format = 'csv';
    else if (/\bxml\b/i.test(q)) format = 'xml';
    else if (/\bexcel|xlsx\b/i.test(q)) format = 'xlsx';
    exportIntent = { format, includeQuerySummary: true };
    interpretation.push({ id: 'export', label: 'Export', value: format.toUpperCase(), field: 'export', editable: true });
  }

  const sort = [{ field: 'canonical_event_date', direction: 'asc' }];
  if (operation.type === 'duplicate_detection') sort[0] = { field: 'confidence', direction: 'desc' };
  if (operation.type === 'record_activity') sort[0] = { field: 'activity_at', direction: 'desc' };
  if (operation.type !== 'record_activity') {
    interpretation.push({ id: 'sort', label: 'Sort', value: 'Event date ascending', field: 'sort', editable: true });
  }

  // Unverified — skip for activity/data-quality primary intents
  if (/\bunverified\b/i.test(q) && operation.type === 'records') {
    conditions.push({ field: 'status', operator: 'equals', value: 'Awaiting Clergy' });
  }

  // Activity/data-quality searches must not treat year ranges as sacramental event filters
  if (operation.type === 'record_activity' || operation.type === 'data_quality') {
    // drop event-date conditions accidentally added from year phrases when activity window is present
    if (operation.type === 'record_activity') {
      for (let i = conditions.length - 1; i >= 0; i--) {
        if (['canonical_event_date', 'burial_date', 'deceased_date', 'reception_date', 'mdate', 'birth_date'].includes(conditions[i].field)) {
          conditions.splice(i, 1);
        }
      }
    }
  }

  const mode = operation.type === 'duplicate_detection'
    ? 'duplicate_detection'
    : operation.type === 'record_activity'
      ? 'record_activity'
      : operation.type === 'data_quality'
        ? 'data_quality'
        : (relationships.length ? 'related' : 'union');

  const ast = {
    version: 1,
    scope: { churchId: Number(churchId) || null, recordTypes },
    operation,
    activity,
    rules,
    workflowIntent,
    filters: { operator: 'and', conditions },
    textSearch,
    relationships,
    select: ['record_type', 'primary_name', 'canonical_event_date', 'clergy', 'location', 'status', 'source_record_id'],
    groupBy,
    aggregates,
    sort,
    limit: 50,
    offset: 0,
    mode,
    export: exportIntent,
  };

  // Confidence: lower when clarifications or very short free text
  let confidence = 0.9;
  if (clarifications.length) confidence = 0.55;
  if (!conditions.length && !textSearch && recordTypes.length === 3 && operation.type === 'records') confidence = Math.min(confidence, 0.5);
  if (q.split(/\s+/).length <= 2 && !years && !clergy && !conditions.length && !textSearch && operation.type === 'records') confidence = Math.min(confidence, 0.45);
  if (textSearch && !conditions.length && operation.type === 'records') confidence = Math.min(confidence, 0.75);
  if (operation.type === 'record_activity' || operation.type === 'data_quality' || operation.type === 'duplicate_detection') {
    confidence = Math.max(confidence, 0.8);
  }

  return { ast, interpretation, clarifications, confidence, exportIntent, rawQuery: q, workflowIntent };
}

module.exports = { parseNaturalLanguage, yearRangeFromText, extractClergy, detectRecordTypes };
