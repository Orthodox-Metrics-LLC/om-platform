/**
 * Super-admin handoff notes — the Cursor / OMBrain updates that are written
 * under /mnt/cursor/for_nick, shown inside Asset Manager so they don't have
 * to be read off the share.
 *
 * Read is jailed to that directory. Replies are appended beside the note
 * (or to FROM-NICK.md for a note that isn't tied to one update). Secrets,
 * dotfiles, and non-text files are never listed or served.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');

const { requireAuth } = require('../middleware/auth');
const { isSuperAdmin, userEmail } = require('./omAssetsPermissions');
const { auditFromRequest } = require('./omAssetsAudit');

const router = express.Router();

const ROOT = '/mnt/cursor/for_nick';
const INBOX_REL = 'FROM-NICK.md';
const TEXT_EXT = new Set(['.md', '.markdown', '.txt']);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_NOTE_CHARS = 8000;
const MAX_DEPTH = 4;
const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;
const SKIP_NAME = /(credential|secret|\.env|password|\.sqlite|\.db$)/i;

/** Extension → content type. Anything else is refused. */
const ATTACHMENT_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.heic', 'image/heic'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.m4v', 'video/x-m4v'],
  ['.pdf', 'application/pdf'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.odt', 'application/vnd.oasis.opendocument.text'],
  ['.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['.odp', 'application/vnd.oasis.opendocument.presentation'],
  ['.rtf', 'application/rtf'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.md', 'text/markdown'],
  ['.zip', 'application/zip'],
]);

const INLINE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.mp4', '.webm', '.pdf']);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function rootReal() {
  return fs.realpathSync(ROOT);
}

/** Relative path inside for_nick. Null when it would leave the directory. */
function resolveHandoffPath(input) {
  if (typeof input !== 'string') return null;
  if (input.includes('\0')) return null;
  const rel = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel) return null;
  const parts = rel.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return null;
  if (parts.some((part) => SKIP_NAME.test(part))) return null;
  const abs = path.resolve(ROOT, rel);
  const root = path.resolve(ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function realInside(abs) {
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return null;
  }
  const root = rootReal();
  if (real !== root && !real.startsWith(root + path.sep)) return null;
  return real;
}

function isTextFile(name) {
  return TEXT_EXT.has(path.extname(name).toLowerCase());
}

function replyRelFor(rel) {
  if (rel === INBOX_REL) return INBOX_REL;
  const ext = path.extname(rel);
  const base = path.basename(rel, ext);
  const dir = path.posix.dirname(rel);
  const name = `${base}.reply.md`;
  return dir && dir !== '.' ? `${dir}/${name}` : name;
}

function readTextFile(abs) {
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink() || !st.isFile()) throw httpError(400, 'Not a file');
  if (st.size > MAX_FILE_BYTES) throw httpError(413, 'Note is too large to show here');
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) throw httpError(415, 'Not a text note');
  return { text: buf.toString('utf8'), modified_at: st.mtime.toISOString(), size: st.size };
}

function walk(dir, rel, depth, out) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || SKIP_NAME.test(ent.name)) continue;
    if (ent.isSymbolicLink()) continue;
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    const childAbs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (rel === '' && ent.name === 'attachments') continue;
      walk(childAbs, childRel, depth + 1, out);
      continue;
    }
    if (!ent.isFile() || !isTextFile(ent.name)) continue;
    if (ent.name.endsWith('.reply.md') || ent.name === 'FROM-NICK.md') continue;
    let st;
    try {
      st = fs.statSync(childAbs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
    out.push({
      path: childRel,
      name: ent.name,
      folder: rel,
      size: st.size,
      modified_at: st.mtime.toISOString(),
      latest: childRel.startsWith('latest_work/'),
    });
  }
}

function listHandoffNotes() {
  if (!fs.existsSync(ROOT)) throw httpError(503, 'Handoff notes are not available on this server');
  const found = [];
  walk(ROOT, '', 0, found);

  const groups = new Map();
  for (const item of found) {
    const key = `${item.name}:${item.size}`;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  const items = [];
  for (const group of groups.values()) {
    const archive = group.find((item) => !item.latest);
    const chosen = archive || group[0];
    const newest = group.reduce((a, b) => (a.modified_at > b.modified_at ? a : b));
    const replyRel = replyRelFor(chosen.path);
    const replyAbs = resolveHandoffPath(replyRel);
    items.push({
      path: chosen.path,
      name: chosen.name,
      folder: chosen.folder,
      size: chosen.size,
      modified_at: newest.modified_at,
      latest: group.some((item) => item.latest),
      has_reply: Boolean(replyAbs && fs.existsSync(replyAbs)),
      attachment_count: listAttachments(chosen.path).length,
    });
  }

  items.sort((a, b) => (a.modified_at < b.modified_at ? 1 : a.modified_at > b.modified_at ? -1 : a.name.localeCompare(b.name)));

  let inbox = null;
  const inboxAbs = resolveHandoffPath(INBOX_REL);
  if (inboxAbs && fs.existsSync(inboxAbs)) {
    const st = fs.statSync(inboxAbs);
    inbox = { path: INBOX_REL, modified_at: st.mtime.toISOString(), size: st.size };
  }

  return { items, inbox };
}

function readHandoffNote(rel) {
  if (rel === INBOX_REL) {
    const abs = resolveHandoffPath(INBOX_REL);
    if (!abs) throw httpError(400, 'Invalid path');
    if (!fs.existsSync(abs)) {
      return { path: INBOX_REL, name: 'Notes to Cursor', folder: '', modified_at: null, content: '', reply: '', attachments: listAttachments(INBOX_REL) };
    }
    const file = readTextFile(abs);
    return {
      path: INBOX_REL,
      name: 'Notes to Cursor',
      folder: '',
      modified_at: file.modified_at,
      content: file.text,
      reply: '',
      attachments: listAttachments(INBOX_REL),
    };
  }

  const abs = resolveHandoffPath(rel);
  if (!abs || !isTextFile(rel) || rel.endsWith('.reply.md')) throw httpError(400, 'Invalid path');
  const real = realInside(abs);
  if (!real || !fs.existsSync(real)) throw httpError(404, 'Note not found');
  const file = readTextFile(real);
  const replyAbs = resolveHandoffPath(replyRelFor(rel));
  let reply = '';
  if (replyAbs && fs.existsSync(replyAbs)) {
    reply = readTextFile(replyAbs).text;
  }
  return {
    path: rel,
    name: path.basename(rel),
    folder: path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel),
    modified_at: file.modified_at,
    content: file.text,
    reply,
    attachments: listAttachments(rel),
  };
}

function attachmentKind(ext) {
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(ext)) return 'image';
  if (ext === '.mp4' || ext === '.webm') return 'video';
  return 'file';
}

function bucketName(rel) {
  return crypto.createHash('sha256').update(rel).digest('hex').slice(0, 20);
}

function attachmentBucket(rel) {
  const abs = path.resolve(ROOT, 'attachments', bucketName(rel));
  const root = path.resolve(ROOT, 'attachments');
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function assertNoteTarget(rel) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('attachments/')) throw httpError(400, 'Invalid path');
  if (rel === INBOX_REL) return;
  const abs = resolveHandoffPath(rel);
  if (!abs || !isTextFile(rel) || rel.endsWith('.reply.md')) throw httpError(400, 'Invalid path');
  if (!realInside(abs)) throw httpError(404, 'Note not found');
}

function displayName(original) {
  const base = path.basename(String(original || 'file')).replace(/[\0\r\n"]/g, '').trim();
  const cleaned = base.replace(/[^\w .()-]+/g, '_').slice(0, 180);
  return cleaned || 'file';
}

function readIndex(rel) {
  const bucket = attachmentBucket(rel);
  if (!bucket) return [];
  const indexPath = path.join(bucket, 'index.json');
  if (!fs.existsSync(indexPath)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function listAttachments(rel) {
  const bucket = attachmentBucket(rel);
  if (!bucket) return [];
  return readIndex(rel).filter((row) => {
    if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return false;
    return fs.existsSync(path.join(bucket, row.id));
  }).map((row) => ({
    id: row.id,
    name: row.name,
    size: Number(row.size) || 0,
    modified_at: row.modified_at || null,
    kind: row.kind === 'image' || row.kind === 'video' ? row.kind : 'file',
  }));
}

function saveAttachments(rel, files, actor) {
  assertNoteTarget(rel);
  const bucket = attachmentBucket(rel);
  if (!bucket) throw httpError(400, 'Invalid path');
  fs.mkdirSync(bucket, { recursive: true, mode: 0o775 });
  const saved = [];
  for (const file of files) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ATTACHMENT_TYPES.has(ext)) throw httpError(400, `Can't attach a ${ext || 'file of that type'}`);
    const id = `${crypto.randomUUID()}${ext}`;
    const dest = path.join(bucket, id);
    fs.copyFileSync(file.path, dest);
    fs.unlink(file.path, () => {});
    const st = fs.statSync(dest);
    saved.push({
      id,
      name: displayName(file.originalname),
      size: st.size,
      modified_at: new Date().toISOString(),
      by: actor,
      kind: attachmentKind(ext),
    });
  }
  const indexPath = path.join(bucket, 'index.json');
  const next = readIndex(rel).concat(saved);
  const tmp = path.join(bucket, `.index-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o664 });
  fs.renameSync(tmp, indexPath);
  return saved.map(({ by, ...row }) => row);
}

function attachmentFile(rel, id) {
  assertNoteTarget(rel);
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(id)) throw httpError(400, 'Invalid file');
  const ext = path.extname(id).toLowerCase();
  if (!ATTACHMENT_TYPES.has(ext)) throw httpError(400, 'Invalid file');
  const known = listAttachments(rel).find((row) => row.id === id);
  if (!known) throw httpError(404, 'File not found');
  const abs = path.join(attachmentBucket(rel), id);
  const real = realInside(abs);
  if (!real) throw httpError(404, 'File not found');
  return { abs: real, item: known, ext };
}

function actorLabel(req) {
  const email = userEmail(req);
  const label = typeof email === 'string' ? email.replace(/[\r\n]/g, ' ').trim() : '';
  return label || 'super admin';
}

function appendHandoffNote(rel, message, actor) {
  const text = typeof message === 'string' ? message.replace(/\0/g, '').trim() : '';
  if (!text) throw httpError(400, 'Write a note first');
  if (text.length > MAX_NOTE_CHARS) throw httpError(400, 'Note is too long');
  if (!fs.existsSync(ROOT)) throw httpError(503, 'Handoff notes are not available on this server');

  const targetRel = rel === INBOX_REL ? INBOX_REL : replyRelFor(rel);
  if (rel !== INBOX_REL) {
    const source = resolveHandoffPath(rel);
    if (!source || !isTextFile(rel) || rel.endsWith('.reply.md')) throw httpError(400, 'Invalid path');
    if (!realInside(source)) throw httpError(404, 'Note not found');
  }

  const abs = resolveHandoffPath(targetRel);
  if (!abs) throw httpError(400, 'Invalid path');
  if (fs.existsSync(abs)) {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink() || !st.isFile()) throw httpError(400, 'Cannot write that note');
    if (!realInside(abs)) throw httpError(400, 'Invalid path');
  }

  const block = `\n\n---\n\n**${actor}** · ${new Date().toISOString()}\n\n${text}\n`;
  fs.appendFileSync(abs, block, { encoding: 'utf8', mode: 0o664 });
  return readHandoffNote(rel);
}

function requireSuper(req, res) {
  if (isSuperAdmin(req)) return true;
  res.status(403).json({ error: 'Super administrators only' });
  return false;
}

router.use(requireAuth);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

router.get('/list', (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    res.json(listHandoffNotes());
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[om-handoff-notes] list:', err.message);
    res.status(status).json({ error: status >= 500 ? 'Could not read handoff notes' : err.message });
  }
});

router.get('/file', (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const rel = typeof req.query.path === 'string' ? req.query.path : '';
    res.json(readHandoffNote(rel));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[om-handoff-notes] file:', err.message);
    res.status(status).json({ error: status >= 500 ? 'Could not read that note' : err.message });
  }
});

router.post('/note', (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const rel = typeof req.body?.path === 'string' && req.body.path ? req.body.path : INBOX_REL;
    const note = appendHandoffNote(rel, req.body?.message, actorLabel(req));
    auditFromRequest(req, 'edit', { payload: { handoff_note: rel } });
    res.json({ success: true, note });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[om-handoff-notes] note:', err.message);
    res.status(status).json({ error: status >= 500 ? 'Could not save that note' : err.message });
  }
});

const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(os.tmpdir(), 'om-handoff-notes');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ATTACHMENT_TYPES.has(ext)) {
      cb(httpError(400, `Can't attach a ${ext || 'file of that type'}`));
      return;
    }
    cb(null, true);
  },
}).array('files', MAX_ATTACHMENTS);

function cleanupUploads(req) {
  const files = Array.isArray(req.files) ? req.files : [];
  for (const file of files) {
    if (file?.path) fs.unlink(file.path, () => {});
  }
}

function handleAttach(req, res, next) {
  attachmentUpload(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    cleanupUploads(req);
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    const tooMany = err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE';
    const status = tooBig ? 413 : (err.status || 400);
    let message = err.message || 'Upload failed';
    if (tooBig) message = 'Each file must be 200 MB or smaller';
    if (tooMany) message = 'You can attach up to 8 files at a time';
    res.status(status).json({ error: message });
  });
}

router.post('/attach', handleAttach, (req, res) => {
  try {
    if (!requireSuper(req, res)) {
      cleanupUploads(req);
      return;
    }
    const rel = typeof req.body?.path === 'string' && req.body.path ? req.body.path : INBOX_REL;
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: 'Choose a file to attach' });
    const saved = saveAttachments(rel, files, actorLabel(req));
    const lines = saved.map((file) => `- ${file.name}`).join('\n');
    const typed = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const message = [typed, `Attached:\n${lines}`].filter(Boolean).join('\n\n');
    const note = appendHandoffNote(rel, message, actorLabel(req));
    auditFromRequest(req, 'upload', { payload: { handoff_note: rel, files: saved.map((file) => file.name) } });
    res.json({ success: true, note });
  } catch (err) {
    cleanupUploads(req);
    const status = err.status || 500;
    if (status >= 500) console.error('[om-handoff-notes] attach:', err.message);
    res.status(status).json({ error: status >= 500 ? 'Could not save that attachment' : err.message });
  }
});

router.get('/attachment', (req, res) => {
  try {
    if (!requireSuper(req, res)) return;
    const rel = typeof req.query.note === 'string' ? req.query.note : '';
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const { abs, item, ext } = attachmentFile(rel, id);
    const type = ATTACHMENT_TYPES.get(ext) || 'application/octet-stream';
    const filename = item.name.replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${INLINE_EXT.has(ext) ? 'inline' : 'attachment'}; filename="${filename}"`);
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[om-handoff-notes] attachment:', err.message);
    if (!res.headersSent) res.status(status).json({ error: status >= 500 ? 'Could not open that file' : err.message });
  }
});

module.exports = router;
module.exports.resolveHandoffPath = resolveHandoffPath;
module.exports.listHandoffNotes = listHandoffNotes;
module.exports.readHandoffNote = readHandoffNote;
module.exports.saveAttachments = saveAttachments;
module.exports.attachmentFile = attachmentFile;
module.exports.ROOT = ROOT;
module.exports.INBOX_REL = INBOX_REL;
