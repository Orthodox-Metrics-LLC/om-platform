/**
 * OM Assets Library — Smart Upload Assist (deterministic heuristics).
 *
 * Pure, dependency-light heuristics FIRST: filename cleanup, MIME/dimension
 * signals, keyword→taxonomy mapping, context/scope inheritance, smart-rename
 * convention, and editable metadata suggestions. A vision provider can be
 * plugged in behind a feature flag (ASSETS_SMART_VISION_ENABLED) but is never a
 * hard dependency — with vision disabled the module still returns useful
 * suggestions.
 *
 * Nothing here trusts client paths: filenames are sanitised to a basename and a
 * safe character set before ever touching storage.
 */

const path = require('path');
const {
  SCOPES,
  VISIBILITIES,
  CATEGORIES,
  defaultVisibilityForScope,
} = require('./omAssetsConstants');

/* ─────────────────────────── Taxonomy ─────────────────────────── */

// Smart Upload Assist taxonomy → canonical category id (must exist in CATEGORIES).
const TAXONOMY = [
  { id: 'background', label: 'Backgrounds' },
  { id: 'logo', label: 'Logos & Marks' },
  { id: 'icon', label: 'Icons' },
  { id: 'diagram', label: 'Diagrams' },
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'ui_reference', label: 'UI References' },
  { id: 'screenshot', label: 'Screenshots' },
  { id: 'church_photo', label: 'Church Photos' },
  { id: 'clergy', label: 'Clergy/People' },
  { id: 'certificate', label: 'Certificates' },
  { id: 'map', label: 'Maps' },
  { id: 'document_scan', label: 'Documents/Scans' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'social_media', label: 'Social Media' },
  { id: 'misc', label: 'Miscellaneous' },
];

// Keyword → category weights. Background is intentionally narrow so unknown
// images never silently fall into "Background".
const CATEGORY_KEYWORDS = {
  infrastructure: [
    'server', 'mini pc', 'mini-pc', 'minipc', 'pfsense', 'firewall', 'network switch',
    'switch', 'pdu', 'power distribution', 'rack', 'wall panel', 'wall-mount', 'wall mount',
    'cooling fan', 'cooling', 'cable management', 'patch panel', 'ethernet', 'homelab',
    'home lab', 'network lab', 'wiring', 'ups', 'gigabit', 'nas', 'poe', 'tripp lite',
    'tp-link', 'rj45', 'datacenter', 'data center', 'network cabinet',
  ],
  diagram: [
    'diagram', 'schematic', 'topology', 'flowchart', 'flow chart', 'architecture',
    'blueprint', 'floor plan', 'floorplan', 'annotated', 'callout', 'legend', 'airflow',
    'wiring diagram', 'network diagram', 'layout diagram', 'exploded view', 'labeled',
  ],
  screenshot: ['screenshot', 'screen shot', 'screen-shot', 'screen capture', 'capture'],
  ui_reference: [
    'ui', 'ux', 'mockup', 'wireframe', 'figma', 'dashboard', 'interface', 'modal',
    'design ref', 'design reference', 'component library', 'style guide',
  ],
  logo: ['logo', 'wordmark', 'brand mark', 'brandmark', 'emblem', 'monogram', 'favicon'],
  icon: ['icon', 'glyph', 'pictogram', 'sprite', 'app icon'],
  background: ['background', 'backdrop', 'wallpaper', 'texture', 'gradient background', 'seamless pattern'],
  church_photo: [
    'church', 'cathedral', 'chapel', 'parish', 'iconostasis', 'nave', 'dome',
    'sanctuary', 'altar', 'temple', 'monastery', 'basilica',
  ],
  clergy: [
    'priest', 'clergy', 'bishop', 'deacon', 'patriarch', 'metropolitan', 'archbishop',
    'portrait', 'headshot', 'saint',
  ],
  certificate: [
    'certificate', 'baptism certificate', 'marriage certificate', 'diploma', 'award',
    'credential', 'chrismation certificate',
  ],
  map: ['map', 'region map', 'diocese map', 'location map', 'geographic', 'atlas'],
  document_scan: [
    'scan', 'scanned', 'document', 'ledger', 'record book', 'register', 'page scan',
    'metrical book', 'parish register',
  ],
  marketing: [
    'marketing', 'banner', 'promo', 'promotion', 'flyer', 'poster', 'advertisement',
    'campaign', 'hero image', 'landing',
  ],
  social_media: [
    'instagram', 'facebook', 'twitter', 'og image', 'open graph', 'story', 'reel',
    'social media', 'social post', 'thumbnail',
  ],
};

// Tags worth surfacing when a category matches (kept small + relevant).
const CATEGORY_DEFAULT_TAGS = {
  infrastructure: ['hardware', 'infrastructure'],
  diagram: ['diagram'],
  screenshot: ['screenshot'],
  ui_reference: ['ui', 'reference'],
  church_photo: ['church'],
  clergy: ['clergy'],
  certificate: ['certificate'],
  map: ['map'],
  document_scan: ['document', 'scan'],
  marketing: ['marketing'],
  social_media: ['social-media'],
};

const SOURCE_WEIGHT = { label: 3, text: 2, filename: 1 };

/* ─────────────────────────── Filename hygiene ─────────────────────────── */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SCREENSHOT_TS_RE = /\b(screenshot|screen[ _-]?shot)\b.*?\d{2,4}[._-]\d{1,2}[._-]\d{1,4}/gi;
// e.g. "ChatGPT Image Jul 2, 2026, 07_38_27 PM"
const AI_IMAGE_RE = /\b(chatgpt|dall[\s·.-]?e|midjourney|stable diffusion)\b\s*image?/gi;
const NOISE_WORDS = new Set([
  'screenshot', 'screen', 'shot', 'copy', 'final', 'draft', 'new', 'untitled',
  'image', 'img', 'photo', 'pic', 'picture', 'export', 'edited', 'version', 'v',
]);
const MONTHS = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';

/** Lower-case, kebab-case, strip punctuation. Never returns leading/trailing dashes. */
function slugifySegment(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Server-side filename sanitiser: strips any path components (prevents
 * traversal), lower-cases, and restricts to a safe charset while preserving a
 * single extension. Always returns just a basename.
 */
function sanitizeFilename(name, fallbackExt = '') {
  const raw = String(name || '').replace(/\\/g, '/');
  const base = path.basename(raw); // drops directories & traversal
  let ext = path.extname(base).toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (!ext && fallbackExt) ext = fallbackExt.startsWith('.') ? fallbackExt.toLowerCase() : `.${fallbackExt.toLowerCase()}`;
  let stem = ext ? base.slice(0, base.length - path.extname(base).length) : base;
  stem = slugifySegment(stem) || 'file';
  if (stem.length > 120) stem = stem.slice(0, 120).replace(/-+$/g, '');
  return `${stem}${ext}`;
}

/** Remove UUIDs, screenshot timestamps, AI-image prefixes, dates, noise words. */
function stripNoiseTokens(stem) {
  let s = ` ${String(stem || '')} `;
  s = s.replace(UUID_RE, ' ');
  s = s.replace(SCREENSHOT_TS_RE, ' ');
  s = s.replace(AI_IMAGE_RE, ' ');
  // Date-ish tokens: "jul 2, 2026", "2026-07-02", "07_38_27 pm"
  s = s.replace(new RegExp(`\\b${MONTHS}\\b`, 'gi'), ' ');
  s = s.replace(/\b\d{4}[-_.]\d{1,2}[-_.]\d{1,2}\b/g, ' ');
  s = s.replace(/\b\d{1,2}[-_.:]\d{2}([-_.:]\d{2})?\s*(am|pm)?\b/gi, ' ');
  s = s.replace(/\b\d{1,2}[,]?\s*\d{4}\b/g, ' ');
  s = s.replace(/\b(am|pm)\b/gi, ' ');
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !NOISE_WORDS.has(t))
    // drop pure numbers unless they look like a meaningful dimension token
    .filter((t) => !/^\d+$/.test(t) || t.length >= 3);
  return tokens;
}

/** Extract dimension descriptors like "28x48" or "1920x1080" from free text. */
function extractDimensionToken(...texts) {
  const joined = texts.filter(Boolean).join(' ').toLowerCase();
  const m = joined.match(/(\d{2,5})\s*(?:in|px|")?\s*[x×]\s*(\d{2,5})\s*(?:in|px|")?/);
  if (m) return `${m[1]}x${m[2]}`;
  return '';
}

/* ─────────────────────────── Classification ─────────────────────────── */

function countKeywordHits(haystack, keywords) {
  if (!haystack) return { hits: 0, matched: [] };
  const hay = ` ${haystack.toLowerCase()} `;
  let hits = 0;
  const matched = [];
  for (const kw of keywords) {
    // word-ish boundary match
    const re = new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(hay)) {
      hits += 1;
      matched.push(kw);
    }
  }
  return { hits, matched };
}

/**
 * Classify an asset into the taxonomy using (in order of trust) detected vision
 * labels, detected/OCR text, then the filename. Background is only chosen with
 * explicit background signals, so unknown images fall back to context or
 * "misc" — never silently to Background.
 *
 * @returns {{category, confidence, explanation, source, scores, theme, matched}}
 */
function classifyAsset({
  filename = '',
  ext = '',
  mime = '',
  width = null,
  height = null,
  detectedText = '',
  detectedLabels = [],
  contextCategory = null,
} = {}) {
  const labelStr = Array.isArray(detectedLabels) ? detectedLabels.join(' ') : String(detectedLabels || '');
  const stemTokens = stripNoiseTokens(path.basename(String(filename)).replace(/\.[^.]+$/, ''));
  const filenameStr = stemTokens.join(' ');

  const scores = {};
  const matchedByCat = {};
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const l = countKeywordHits(labelStr, keywords);
    const t = countKeywordHits(detectedText, keywords);
    const f = countKeywordHits(filenameStr, keywords);
    const score = l.hits * SOURCE_WEIGHT.label + t.hits * SOURCE_WEIGHT.text + f.hits * SOURCE_WEIGHT.filename;
    if (score > 0) {
      scores[cat] = score;
      matchedByCat[cat] = [...new Set([...l.matched, ...t.matched, ...f.matched])];
    }
  }

  const isImage = /^image\//.test(mime) || /\.(png|jpe?g|gif|webp|svg)$/i.test(ext || filename);
  const isSvg = /svg/.test(mime) || /\.svg$/i.test(ext || filename);
  const isPdf = /pdf/.test(mime) || /\.pdf$/i.test(ext || filename);

  // Deterministic non-keyword nudges.
  if (isSvg) scores.icon = (scores.icon || 0) + 1;
  if (isPdf) scores.document_scan = (scores.document_scan || 0) + 2;

  let category = null;
  let source = 'heuristic';
  let theme = null;
  let matched = [];

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    // A labelled figure OF infrastructure is a Diagram (category) themed on
    // infrastructure (folder/collection/tags), matching the wall-panel case.
    if (scores.diagram && scores.infrastructure) {
      category = 'diagram';
      theme = 'infrastructure';
    } else {
      category = ranked[0][0];
      if (category === 'infrastructure') theme = 'infrastructure';
    }
    matched = matchedByCat[category] || [];
    source = (Array.isArray(detectedLabels) && detectedLabels.length) || detectedText ? 'content' : 'filename';
  } else if (contextCategory && CATEGORIES.has(contextCategory)) {
    category = contextCategory;
    source = 'context';
  } else {
    category = 'misc';
    source = 'fallback';
  }

  // Confidence: strongest when content signals drove it; weakest on fallback.
  const topScore = ranked.length ? ranked[0][1] : 0;
  let confidence;
  if (source === 'fallback') confidence = 0.2;
  else if (source === 'context') confidence = 0.4;
  else confidence = Math.max(0.35, Math.min(0.97, 0.45 + topScore * 0.08));

  const explanationParts = [];
  if (matched.length) explanationParts.push(`matched ${matched.slice(0, 6).join(', ')}`);
  if (theme) explanationParts.push(`themed as ${theme}`);
  if (source === 'fallback') explanationParts.push('no strong signal — defaulted to Miscellaneous (not Background)');
  if (source === 'context') explanationParts.push('inherited from the current asset area');
  const explanation = `Category "${labelFor(category)}" — ${explanationParts.join('; ') || 'derived from available signals'}.`;

  return { category, confidence: Number(confidence.toFixed(3)), explanation, source, scores, theme, matched };
}

function labelFor(categoryId) {
  const t = TAXONOMY.find((x) => x.id === categoryId);
  if (t) return t.label;
  return categoryId;
}

/* ─────────────────────────── Context inheritance ─────────────────────────── */

/**
 * Derive destination scope + visibility from the area the upload was opened
 * from. Never defaults to Public unless the context is actually Public.
 * Falls back to a role-appropriate scope when context is absent.
 */
function deriveContextDefaults({
  contextScope = null,
  contextChurchId = null,
  allowedScopes = ['public'],
  hasChurch = false,
} = {}) {
  let scope = null;
  if (contextScope && SCOPES.has(contextScope)) scope = contextScope;
  else if (hasChurch) scope = 'church';
  else if (allowedScopes.includes('public')) scope = 'public';
  else scope = allowedScopes[0] || 'public';

  const permitted = allowedScopes.includes(scope);
  const visibility = defaultVisibilityForScope(scope);
  return {
    scope,
    visibility,
    church_id: scope === 'church' ? (contextChurchId || null) : null,
    permitted,
  };
}

/* ─────────────────────────── Smart rename ─────────────────────────── */

/**
 * Build the deterministic stored filename:
 *   {scope}-{category}-{subject}-{descriptor}-{yyyy-mm-dd}.{ext}
 * lowercase, kebab-case, ≤120 chars before extension, extension preserved.
 * Collision handling is applied separately (resolveStoredFilename).
 */
function buildStoredFilename({ scope, category, subject, descriptor, ext, date = new Date() }) {
  const parts = [
    slugifySegment(scope),
    slugifySegment(category),
    slugifySegment(subject),
    slugifySegment(descriptor),
    isoDate(date),
  ].filter(Boolean);
  let stem = parts.join('-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  if (stem.length > 120) stem = stem.slice(0, 120).replace(/-+$/g, '');
  const safeExt = normalizeExt(ext);
  return `${stem}${safeExt}`;
}

function isoDate(d) {
  const dt = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeExt(ext) {
  if (!ext) return '';
  const e = String(ext).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return e.startsWith('.') ? e : `.${e}`;
}

/**
 * Collision-safe stored filename resolver. Never overwrites an existing asset:
 * checks the DB (per-scope stored_filename) and the target directory on disk,
 * appending -2, -3, … then a short content-hash suffix as a last resort.
 */
async function resolveStoredFilename({ pool, scope, churchId, desiredName, targetDir, contentHash = '', fsMod = require('fs') }) {
  const safe = sanitizeFilename(desiredName);
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);

  const existsInDb = async (candidate) => {
    if (!pool) return false;
    const params = [scope, candidate];
    let sql = "SELECT 1 FROM om_assets WHERE scope = ? AND stored_filename = ? AND status = 'active'";
    if (scope === 'church' && churchId) { sql += ' AND church_id = ?'; params.push(churchId); }
    sql += ' LIMIT 1';
    const [rows] = await pool.query(sql, params);
    return rows.length > 0;
  };
  const existsOnDisk = (candidate) => {
    if (!targetDir) return false;
    try { return fsMod.existsSync(path.join(targetDir, candidate)); } catch { return false; }
  };
  const taken = async (candidate) => (await existsInDb(candidate)) || existsOnDisk(candidate);

  if (!(await taken(safe))) return { filename: safe, collision: false };

  for (let n = 2; n <= 50; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await taken(candidate))) return { filename: candidate, collision: true };
  }
  const suffix = (contentHash || Math.random().toString(36).slice(2)).slice(0, 8);
  return { filename: `${stem}-${suffix}${ext}`, collision: true };
}

/* ─────────────────────────── Suggestions ─────────────────────────── */

function toTitleCase(slug) {
  return String(slug || '')
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^[a-z]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function suggestSubjectDescriptor({ filenameTokens, detectedLabels = [], detectedText = '', title = '' }) {
  const labelTokens = (Array.isArray(detectedLabels) ? detectedLabels : [])
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !NOISE_WORDS.has(t));
  const titleTokens = slugifySegment(title).split('-').filter(Boolean);
  const pool = titleTokens.length ? titleTokens : (labelTokens.length ? labelTokens : filenameTokens);
  const subject = pool.slice(0, 4).join('-');
  const dim = extractDimensionToken(detectedText, (detectedLabels || []).join(' '), filenameTokens.join(' '));
  const descriptorTokens = pool.slice(4, 7);
  if (dim) descriptorTokens.push(dim);
  const descriptor = descriptorTokens.join('-');
  return { subject: subject || 'asset', descriptor };
}

const VISION_FLAG = 'ASSETS_SMART_VISION_ENABLED';
let _visionProvider = null;

/** Register a pluggable vision/OCR provider: async ({buffer|path, mime}) => {labels[], text, tags[]}. */
function registerVisionProvider(fn) { _visionProvider = typeof fn === 'function' ? fn : null; }
function isVisionEnabled() {
  const v = String(process.env[VISION_FLAG] || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
function getVisionProvider() { return isVisionEnabled() ? _visionProvider : null; }

/**
 * Orchestrate a per-file suggestion. Deterministic heuristics always run;
 * detectedText/detectedLabels may come from the client preview or an enabled
 * vision provider. `analyzeUpload` (in the route) supplies scope/context.
 */
function buildSuggestion({
  originalFilename,
  mime = '',
  width = null,
  height = null,
  scope,
  visibility,
  churchId = null,
  contextCategory = null,
  contextCollectionId = null,
  contextFolder = null,
  detectedText = '',
  detectedLabels = [],
  title = '',
  date = new Date(),
} = {}) {
  const ext = path.extname(String(originalFilename || '')).toLowerCase();
  const isImage = /^image\//.test(mime) || /\.(png|jpe?g|gif|webp|svg)$/i.test(ext || originalFilename || '');
  const warnings = [];

  const cls = classifyAsset({
    filename: originalFilename, ext, mime, width, height, detectedText, detectedLabels, contextCategory,
  });

  const filenameTokens = stripNoiseTokens(String(originalFilename || '').replace(/\.[^.]+$/, ''));
  const { subject, descriptor } = suggestSubjectDescriptor({ filenameTokens, detectedLabels, detectedText, title });

  const displayName = title
    ? title
    : toTitleCase(subject + (descriptor ? `-${descriptor.replace(/-?\d+x\d+$/, '')}` : '')) || toTitleCase(subject) || 'Untitled asset';

  const storedFilename = buildStoredFilename({ scope, category: cls.category, subject, descriptor, ext, date });

  // Folder: theme-driven for infra/diagram; otherwise category-based, with year.
  const year = isoDate(date).slice(0, 4);
  let folder = contextFolder || '';
  if (!folder) {
    if (cls.theme === 'infrastructure') folder = `infrastructure/${subject}/${year}`;
    else if (cls.category === 'screenshot') folder = `screenshots/${year}`;
    else if (cls.category === 'certificate') folder = `certificates/${year}`;
    else if (cls.category === 'diagram') folder = `diagrams/${year}`;
    else folder = `${cls.category}/${year}`;
  }

  // Tags: category defaults + notable matched keywords + dimension.
  const dim = extractDimensionToken(detectedText, (detectedLabels || []).join(' '));
  const tagSet = new Set([
    ...(CATEGORY_DEFAULT_TAGS[cls.category] || []),
    ...(cls.theme ? (CATEGORY_DEFAULT_TAGS[cls.theme] || []) : []),
    ...cls.matched.map((m) => slugifySegment(m)).filter((t) => t && t.length > 1),
  ]);
  const tags = [...tagSet].slice(0, 12);

  // Alt text / caption (suggested; enforcement handled at upload for public images).
  const altText = isImage
    ? `${displayName}${dim ? ` (${dim})` : ''} — ${labelFor(cls.category).toLowerCase()}`
    : '';
  const caption = isImage ? `${labelFor(cls.category)}: ${displayName}.` : '';
  const description = cls.matched.length
    ? `${labelFor(cls.category)} featuring ${cls.matched.slice(0, 6).join(', ')}.`
    : `${labelFor(cls.category)} asset.`;

  // Collection suggestion (name only; route resolves to an id if it exists).
  let collectionName = null;
  if (cls.theme === 'infrastructure') collectionName = 'Mini Server Wall Panel';
  else if (cls.category === 'screenshot') collectionName = 'OM Internal Screenshots';
  else if (cls.category === 'certificate') collectionName = 'Certificate Studio Templates';

  const ownerSystem = 'om';
  const sourceType = cls.category === 'screenshot' ? 'screenshot'
    : (cls.source === 'content' ? 'upload' : 'upload');

  if (isImage && scope === 'public' && !altText) {
    warnings.push('Public image requires alt text before upload.');
  }
  if (cls.confidence < 0.5) {
    warnings.push(`Low category confidence (${cls.confidence}) — please review.`);
  }

  return {
    original_filename: originalFilename,
    stored_filename: storedFilename,
    display_name: displayName,
    title: displayName,
    category: cls.category,
    category_label: labelFor(cls.category),
    category_confidence: cls.confidence,
    classification_source: cls.source,
    collection_name: collectionName,
    collection_id: contextCollectionId || null,
    folder,
    tags,
    alt_text: altText,
    caption,
    description,
    source_type: sourceType,
    owner_system: ownerSystem,
    theme: cls.theme,
    explanation: cls.explanation,
    warnings,
    is_image: isImage,
  };
}

module.exports = {
  TAXONOMY,
  CATEGORY_KEYWORDS,
  labelFor,
  slugifySegment,
  sanitizeFilename,
  stripNoiseTokens,
  extractDimensionToken,
  classifyAsset,
  deriveContextDefaults,
  buildStoredFilename,
  resolveStoredFilename,
  buildSuggestion,
  suggestSubjectDescriptor,
  isoDate,
  // vision (pluggable, flag-gated)
  registerVisionProvider,
  getVisionProvider,
  isVisionEnabled,
  VISION_FLAG,
};
