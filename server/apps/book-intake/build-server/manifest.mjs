// src/lib/dates.ts
function normalizeDateKey(value) {
  const m = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec((value || "").trim());
  if (!m) return "";
  const month = Number(m[1]), day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(2e3, month, 0).getDate()) return "";
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// src/lib/text.ts
function validCrop(c) {
  return [c.x, c.y, c.w, c.h].every(Number.isFinite) && c.x >= 0 && c.y >= 0 && c.w > 0.02 && c.h > 0.02 && c.x + c.w <= 1.000001 && c.y + c.h <= 1.000001;
}

// src/lib/db.ts
var changeEvent = new EventTarget();
function validateManifest(input) {
  const m = input;
  const safeId = (s) => typeof s === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(s);
  const str = (s, max = 2e6) => typeof s === "string" && s.length <= max;
  if (!m || m.format !== "om-book" || m.version !== 1 || !["backup", "publication"].includes(m.kind) || !Array.isArray(m.pages) || !Array.isArray(m.sources) || !Array.isArray(m.annotations) || !Array.isArray(m.bookmarks) || m.pages.length > 2e3)
    throw new Error("Not a supported OM book file (format version 1).");
  if (!m.book || !["title", "subtitle", "year", "calendar"].every((k) => str(m.book[k], 1e3)))
    throw new Error("Invalid book details.");
  if (m.book.author !== void 0 && !str(m.book.author, 1e3) || m.book.coverPageId !== void 0 && !safeId(m.book.coverPageId))
    throw new Error("Invalid optional book metadata.");
  if (m.publication !== void 0 && (!m.publication || !["draft", "published"].includes(m.publication.status) || m.publication.publishedAt !== void 0 && (!str(m.publication.publishedAt, 100) || !Number.isFinite(Date.parse(m.publication.publishedAt))) || m.publication.acceptedExceptions !== void 0 && (!Number.isInteger(m.publication.acceptedExceptions) || m.publication.acceptedExceptions < 0)))
    throw new Error("Invalid publication metadata.");
  const sources = /* @__PURE__ */ new Set();
  for (const s of m.sources) {
    if (!safeId(s.id) || sources.has(s.id) || !str(s.name, 1e3) || !["image/jpeg", "image/png", "image/webp"].includes(s.mime) || !Number.isFinite(s.width) || !Number.isFinite(s.height) || s.width <= 0 || s.height <= 0)
      throw new Error("Invalid source image metadata.");
    sources.add(s.id);
  }
  const pages = /* @__PURE__ */ new Set();
  for (const p of m.pages) {
    if (!safeId(p.id) || pages.has(p.id) || !sources.has(p.sourceId) || !p.crop || !validCrop(p.crop) || ![0, 90, 180, 270].includes(p.rotation) || !Number.isFinite(p.order) || !Number.isInteger(p.textVersion) || !Number.isInteger(p.cropVersion) || typeof p.reviewed !== "boolean" || typeof p.read !== "boolean" || !["none", "sample-transcription", "ocr", "manual"].includes(p.textSource) || !Array.isArray(p.words) || !["title", "detail", "dateKey", "weekday", "feast", "fasting", "readings", "sourceName", "text", "createdAt"].every((k) => str(p[k])))
      throw new Error("Invalid page data.");
    if (p.review !== void 0 && (!p.review || !["individual", "bulk"].includes(p.review.method) || !str(p.review.at, 100) || !Number.isFinite(Date.parse(p.review.at)) || !Number.isInteger(p.review.textVersion) || p.review.textVersion < 0 || !Number.isInteger(p.review.cropVersion) || p.review.cropVersion < 0 || p.review.method === "bulk" && !safeId(p.review.batchId)))
      throw new Error("Invalid page review metadata.");
    if (p.manualDate !== void 0 && (!str(p.manualDate, 10) || p.manualDate !== "" && !normalizeDateKey(p.manualDate))) throw new Error("Invalid manual printed date.");
    if (p.dateIndex !== void 0 && (!p.dateIndex || p.dateIndex.version !== 4 || !["resolved", "unverified", "unresolved", "undated", "conflict"].includes(p.dateIndex.status) || !["manual", "metadata", "text-header", "layout-header", "header-ocr"].includes(p.dateIndex.source) || !str(p.dateIndex.key, 10) || p.dateIndex.key !== "" && !normalizeDateKey(p.dateIndex.key) || !str(p.dateIndex.evidence, 2e3) || !Number.isInteger(p.dateIndex.textVersion) || !Number.isInteger(p.dateIndex.cropVersion))) throw new Error("Invalid printed date index.");
    if (p.ocrError !== void 0 && !str(p.ocrError, 2e3)) throw new Error("Invalid OCR error metadata.");
    for (const w of p.words)
      if (!str(w.text) || !Number.isInteger(w.start) || !Number.isInteger(w.end) || w.start < 0 || w.end < w.start || w.end > p.text.length || ![w.x, w.y, w.w, w.h].every(Number.isFinite) || w.x < 0 || w.y < 0 || w.w < 0 || w.h < 0 || w.x + w.w > 1.001 || w.y + w.h > 1.001)
        throw new Error("Invalid OCR word positions.");
    pages.add(p.id);
  }
  const annotationIds = /* @__PURE__ */ new Set();
  for (const a of m.annotations) {
    if (!safeId(a.id) || annotationIds.has(a.id) || !pages.has(a.pageId) || !["text", "region", "note"].includes(a.kind) || !["gold", "green", "blue", "rose"].includes(a.color) || !str(a.note) || !str(a.createdAt))
      throw new Error("Invalid annotation.");
    if (a.kind === "text" && (!a.anchor || !Number.isInteger(a.anchor.start) || !Number.isInteger(a.anchor.end) || a.anchor.start < 0 || a.anchor.end <= a.anchor.start || !str(a.anchor.quote) || !str(a.anchor.prefix) || !str(a.anchor.suffix)))
      throw new Error("Invalid text highlight.");
    if (a.kind === "region" && (!a.rect || ![a.rect.x, a.rect.y, a.rect.w, a.rect.h].every(Number.isFinite) || a.rect.x < 0 || a.rect.y < 0 || a.rect.w <= 0 || a.rect.h <= 0 || a.rect.x + a.rect.w > 1.001 || a.rect.y + a.rect.h > 1.001 || !Number.isInteger(a.cropVersion)))
      throw new Error("Invalid scan highlight.");
    annotationIds.add(a.id);
  }
  const bookmarkIds = /* @__PURE__ */ new Set();
  for (const b of m.bookmarks) {
    if (!safeId(b.id) || bookmarkIds.has(b.id) || !pages.has(b.pageId) || !str(b.createdAt))
      throw new Error("Invalid bookmark.");
    bookmarkIds.add(b.id);
  }
  if (!m.prefs || !str(m.prefs.pageId, 128) || !["read", "scan", "compare"].includes(m.prefs.view) || !["paper", "light", "dark"].includes(m.prefs.theme) || !Number.isFinite(m.prefs.fontSize) || m.prefs.fontSize < 15 || m.prefs.fontSize > 27)
    throw new Error("Invalid reader preferences.");
  const pref = m.prefs;
  if (pref.readingLayout !== void 0 && !["single", "spread", "continuous"].includes(pref.readingLayout)) throw new Error("Invalid reading layout.");
  for (const k of ["autoMarkRead", "autoOpenToday", "narrationFollow", "narrationCloudConsent"])
    if (pref[k] !== void 0 && typeof pref[k] !== "boolean") throw new Error("Invalid reader automation preference.");
  if (pref.narrationEngine !== void 0 && !["browser", "azure"].includes(pref.narrationEngine)) throw new Error("Invalid narration engine.");
  if (pref.narrationPreset !== void 0 && !["us-female", "us-male", "uk-female", "uk-male"].includes(pref.narrationPreset)) throw new Error("Invalid narrator.");
  if (pref.narrationVoiceURI !== void 0 && !str(pref.narrationVoiceURI, 2e3)) throw new Error("Invalid speech voice.");
  if (pref.narrationRate !== void 0 && (!Number.isFinite(pref.narrationRate) || pref.narrationRate < 0.65 || pref.narrationRate > 1.5)) throw new Error("Invalid narration speed.");
  return m;
}
export {
  validateManifest
};
