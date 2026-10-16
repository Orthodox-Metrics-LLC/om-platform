/**
 * Certificate Studio — record / church field binding resolver
 */

const SAMPLE_DATA = {
  baptism: {
    'baptism.first_name': 'John',
    'baptism.last_name': 'Smith',
    'baptism.baptism_date': 'March 15, 2024',
    'baptism.birth_date': 'January 3, 2024',
    'baptism.father_name': 'Michael Smith',
    'baptism.mother_name': 'Anna Smith',
    'baptism.godparent_names': 'Peter Johnson, Mary Johnson',
    'baptism.clergy_name': 'Fr. Nicholas',
    'baptism.full_name': 'John Smith',
    'baptism.birthplace': 'Somerville, NJ',
    // Split-date samples match the rendered formats (M/D and 2-digit year)
    'baptism.baptism_date.md': '3/15',
    'baptism.baptism_date.yy': '24',
    'baptism.birth_date.md': '1/3',
    'baptism.birth_date.yy': '24',
  },
  marriage: {
    'marriage.groom_name': 'Alexander Petrov',
    'marriage.bride_name': 'Maria Ivanova',
    'marriage.marriage_date': 'June 22, 2023',
    'marriage.clergy_name': 'Fr. Nicholas',
    'marriage.witnesses': 'John Doe, Jane Doe',
    'marriage.marriage_date.md': '6/22',
    'marriage.marriage_date.yy': '23',
  },
  reception: {
    'reception.person_name': 'Elizabeth Brown',
    'reception.reception_date': 'April 10, 2024',
    'reception.clergy_name': 'Fr. Nicholas',
    'reception.former_communion': 'Roman Catholic',
    'reception.reception_date.md': '4/10',
    'reception.reception_date.yy': '24',
  },
  church: {
    'church.name': 'St. Nicholas Orthodox Church',
    'church.city': 'Chicago',
    'church.state': 'IL',
    'church.priest_name': 'Fr. Nicholas Anderson',
  },
};

function splitParents(combined) {
  if (!combined) return ['', ''];
  const trimmed = String(combined).trim();
  if (!trimmed) return ['', ''];
  for (const sep of [' & ', '&', ';', ',']) {
    if (trimmed.includes(sep)) {
      const parts = trimmed.split(sep).map((s) => s.trim()).filter(Boolean);
      return [parts[0] || '', parts[1] || ''];
    }
  }
  return [trimmed, ''];
}

function _parseUtcDate(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function dateMDY(raw) {
  const d = _parseUtcDate(raw);
  if (!d) return '';
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function dateMD(raw) {
  const d = _parseUtcDate(raw);
  if (!d) return '';
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function dateYY(raw) {
  const d = _parseUtcDate(raw);
  if (!d) return '';
  return String(d.getUTCFullYear()).slice(-2);
}

const BINDING_MAP = {
  'baptism.first_name': { record: 'first_name' },
  'baptism.last_name': { record: 'last_name' },
  'baptism.baptism_date': { record: 'reception_date', alt: 'date_of_baptism', format: 'date' },
  'baptism.baptism_date.md': { record: 'reception_date', alt: 'date_of_baptism', format: 'split_md' },
  'baptism.baptism_date.yy': { record: 'reception_date', alt: 'date_of_baptism', format: 'split_yy' },
  'baptism.birth_date': { record: 'birth_date', alt: 'date_of_birth', format: 'date' },
  'baptism.birth_date.md': { record: 'birth_date', alt: 'date_of_birth', format: 'split_md' },
  'baptism.birth_date.yy': { record: 'birth_date', alt: 'date_of_birth', format: 'split_yy' },
  'baptism.birthplace': { record: 'birthplace' },
  'baptism.father_name': { record: 'father_name', computed: 'father_from_parents' },
  'baptism.mother_name': { record: 'mother_name', computed: 'mother_from_parents' },
  'baptism.godparent_names': { record: 'sponsors' },
  'baptism.clergy_name': { record: 'clergy' },
  'baptism.full_name': { computed: 'baptism_full_name' },
  'marriage.groom_name': { computed: 'groom_full_name' },
  'marriage.bride_name': { computed: 'bride_full_name' },
  'marriage.marriage_date': { record: 'mdate', format: 'date' },
  'marriage.marriage_date.md': { record: 'mdate', format: 'split_md' },
  'marriage.marriage_date.yy': { record: 'mdate', format: 'split_yy' },
  'marriage.clergy_name': { record: 'clergy' },
  'marriage.witnesses': { record: 'witnesses' },
  'reception.person_name': { computed: 'reception_full_name' },
  'reception.reception_date': { record: 'reception_date', alt: 'date_of_baptism', format: 'date' },
  'reception.reception_date.md': { record: 'reception_date', alt: 'date_of_baptism', format: 'split_md' },
  'reception.reception_date.yy': { record: 'reception_date', alt: 'date_of_baptism', format: 'split_yy' },
  'reception.clergy_name': { record: 'clergy' },
  'reception.former_community': { record: 'former_community' },
  'church.name': { church: 'name' },
  'church.city': { church: 'city' },
  'church.state': { church: 'state' },
  'church.priest_name': { church: 'rector_name', alt: 'priest_name' },
};

function formatDate(val) {
  if (!val) return '';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function applyDateFormat(val, format) {
  if (!val) return '';
  switch (format) {
    case 'short': return dateMDY(val);
    case 'split_md': return dateMD(val);
    case 'split_yy': return dateYY(val);
    case 'date':
    default: return formatDate(val);
  }
}

function resolveComputed(key, record) {
  switch (key) {
    case 'baptism_full_name':
      return [record.first_name, record.last_name].filter(Boolean).join(' ').trim();
    case 'father_from_parents': {
      if (record.father_name) return String(record.father_name);
      const [father] = splitParents(record.parents);
      return father;
    }
    case 'mother_from_parents': {
      if (record.mother_name) return String(record.mother_name);
      const [, mother] = splitParents(record.parents);
      return mother;
    }
    case 'groom_full_name':
      return [record.fname_groom, record.lname_groom].filter(Boolean).join(' ').trim()
        || record.groom_name || '';
    case 'bride_full_name':
      return [record.fname_bride, record.lname_bride].filter(Boolean).join(' ').trim()
        || record.bride_name || '';
    case 'reception_full_name':
      return [record.first_name || record.name, record.last_name || record.lastname]
        .filter(Boolean).join(' ').trim();
    default:
      return '';
  }
}

function resolveBinding(bindingKey, record, church, layerFormat) {
  const def = BINDING_MAP[bindingKey];
  if (!def) return '';

  if (def.church) {
    const val = church[def.church] || (def.alt ? church[def.alt] : '');
    return val != null ? String(val) : '';
  }

  if (def.computed && !def.record) {
    return resolveComputed(def.computed, record);
  }

  let val = record[def.record];
  // Prefer computed split/format (e.g. parents → father/mother) before
  // falling back to a raw alt column — avoids putting the full
  // "Father & Mother" string into both parent fields.
  if ((val == null || val === '') && def.computed) {
    val = resolveComputed(def.computed, record);
  }
  if ((val == null || val === '') && def.alt) val = record[def.alt];

  const fmt = layerFormat || def.format;
  if (fmt && val) return applyDateFormat(val, fmt);
  return val != null ? String(val) : '';
}

function resolveAllBindings(certificateType, record, church, useSample = false) {
  const values = {};
  const prefix = certificateType === 'baptism' ? 'baptism' : certificateType;

  for (const [key, def] of Object.entries(BINDING_MAP)) {
    if (key.startsWith('church.')) {
      values[key] = useSample
        ? (SAMPLE_DATA.church[key] || '')
        : resolveBinding(key, record, church);
    } else if (key.startsWith(`${prefix}.`) || key.startsWith('church.')) {
      values[key] = useSample
        ? ((SAMPLE_DATA[certificateType] || {})[key] || SAMPLE_DATA.church[key] || '')
        : resolveBinding(key, record, church);
    }
  }

  Object.assign(values, useSample ? SAMPLE_DATA.church : {});
  if (useSample && SAMPLE_DATA[certificateType]) {
    Object.assign(values, SAMPLE_DATA[certificateType]);
  }

  return values;
}

function validateRequiredFields(layers, bindingValues) {
  const warnings = [];
  const missing = [];

  for (const layer of layers) {
    if (layer.type !== 'bound_field' || !layer.binding?.key) continue;
    const key = layer.binding.key;
    const val = bindingValues[key];
    const required = layer.binding.required !== false;
    if (required && (!val || String(val).trim() === '')) {
      missing.push({ layerId: layer.id, layerName: layer.name, bindingKey: key });
    }
  }

  if (missing.length) {
    warnings.push({
      type: 'missing_fields',
      message: `${missing.length} required field(s) have no data`,
      fields: missing,
    });
  }

  return { warnings, missing, valid: missing.length === 0 };
}

function estimateTextOverflow(layer, text, fontSize) {
  if (!text || !layer.width) return false;
  const avgCharWidth = fontSize * 0.55;
  const charsPerLine = Math.floor(layer.width / avgCharWidth);
  const lines = Math.ceil(text.length / Math.max(charsPerLine, 1));
  const lineHeight = (layer.style?.line_height || 1.2) * fontSize;
  const needed = lines * lineHeight;
  const boxHeight = layer.height || lineHeight * 1.4;
  // Match legacy pdf-generator: single-line fields truncate, not wrap.
  if (layer.type === 'bound_field' && !layer.style?.allow_wrap) {
    return fontSize * 1.1 > boxHeight;
  }
  return needed > boxHeight;
}

function checkOverflowWarnings(layers, bindingValues) {
  const warnings = [];
  for (const layer of layers) {
    if (layer.type !== 'bound_field' && layer.type !== 'text') continue;
    const text = layer.type === 'bound_field'
      ? bindingValues[layer.binding?.key] || layer.style?.text || ''
      : layer.style?.text || '';
    const fontSize = layer.style?.font_size || 14;
    if (estimateTextOverflow(layer, text, fontSize)) {
      warnings.push({
        type: 'overflow',
        layerId: layer.id,
        layerName: layer.name,
        message: `Text may overflow the bounding box for "${layer.name}"`,
      });
    }
  }
  return warnings;
}

module.exports = {
  SAMPLE_DATA,
  BINDING_MAP,
  resolveBinding,
  resolveAllBindings,
  validateRequiredFields,
  checkOverflowWarnings,
  formatDate,
  dateMDY,
  dateMD,
  dateYY,
  splitParents,
};
