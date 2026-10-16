/**
 * Website files — browse and replace om-platform's public site files.
 *
 * Source of truth: /var/www/om-platform/front-end/public
 * Live site: nginx serves the same relative path from front-end/dist
 * (Vite copies public/ into dist/ at build time). A replace writes both
 * so the website updates immediately and the next build keeps the change.
 *
 * Platform admins only. Every path is jailed to those two roots.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const { requireAuth } = require('../middleware/auth');
const { isPlatformAdmin } = require('./omAssetsPermissions');
const { mimeFromExt } = require('./omAssetsConstants');
const { auditFromRequest } = require('./omAssetsAudit');

const router = express.Router();

const PUBLIC_ROOT = '/var/www/om-platform/front-end/public';
const DIST_ROOT = '/var/www/om-platform/front-end/dist';
const THUMB_ROOT = path.join(__dirname, '../../storage/om-assets/website-cache/thumbs');
const MAX_BYTES = 80 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.mp4', '.webm', '.mov', '.m4v',
  '.ttf', '.otf', '.woff', '.woff2',
]);

const RASTER_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Relative path inside public/. Empty string is the root. Rejects traversal. */
function normalizeWebsiteRel(input) {
  if (typeof input !== 'string') return null;
  const rel = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.includes('\0')) return null;
  if (rel === '') return '';
  const parts = rel.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  if (parts.some((part) => part.startsWith('.'))) return null;
  return parts.join('/');
}

function resolveInside(root, rel) {
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(`${base}${path.sep}`)) return null;
  return abs;
}

function realInside(abs, root) {
  let realRoot;
  let real;
  try {
    realRoot = fs.realpathSync(root);
    real = fs.realpathSync(abs);
  } catch {
    return null;
  }
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) return null;
  return real;
}

function safeUploadName(originalName) {
  const base = path.basename(String(originalName || '').replace(/\\/g, '/'));
  if (!base || base.length > 180 || base.startsWith('.')) return null;
  if (!/^[\w .()-]+$/.test(base)) return null;
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  return base;
}

function describeEntry(rel, name, stat, isDir) {
  const entryRel = rel ? `${rel}/${name}` : name;
  const isRaster = !isDir && RASTER_EXT.test(name);
  const isVector = !isDir && /\.svg$/i.test(name);
  const version = Math.floor(stat.mtimeMs);
  const fileUrl = `/api/assets/website-files/file?path=${encodeURIComponent(entryRel)}&v=${version}`;
  return {
    name,
    type: isDir ? 'directory' : 'file',
    size: isDir ? null : stat.size,
    modified_at: stat.mtime.toISOString(),
    path: entryRel,
    public_url: isDir ? null : `/${entryRel}`,
    file_url: isDir ? null : fileUrl,
    thumb_url: isRaster
      ? `/api/assets/website-files/thumb?path=${encodeURIComponent(entryRel)}&v=${version}`
      : isVector
        ? fileUrl
        : null,
  };
}

function listWebsiteDir(rel) {
  const abs = resolveInside(PUBLIC_ROOT, rel);
  if (!abs) throw httpError(400, 'Invalid path');
  const real = realInside(abs, PUBLIC_ROOT);
  if (!real) throw httpError(404, 'Path not found');
  const stat = fs.statSync(real);
  if (!stat.isDirectory()) throw httpError(400, 'Not a directory');

  const entries = fs.readdirSync(real, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.name || entry.name.startsWith('.') || entry.name.includes('/') || entry.name.includes('\\')) return [];
    const entryAbs = path.join(real, entry.name);
    let entryStat;
    try {
      const lst = fs.lstatSync(entryAbs);
      if (lst.isSymbolicLink()) return [];
      entryStat = fs.statSync(entryAbs);
    } catch {
      return [];
    }
    if (!realInside(entryAbs, PUBLIC_ROOT)) return [];
    const isDir = entryStat.isDirectory();
    if (!isDir && !entryStat.isFile()) return [];
    return [describeEntry(rel, entry.name, entryStat, isDir)];
  });

  entries.sort((a, b) => (a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)));
  return entries;
}

function existingFile(rel) {
  if (!rel) throw httpError(400, 'Choose a file');
  const abs = resolveInside(PUBLIC_ROOT, rel);
  if (!abs) throw httpError(400, 'Invalid path');
  let lst;
  try {
    lst = fs.lstatSync(abs);
  } catch {
    throw httpError(404, 'File not found');
  }
  if (lst.isSymbolicLink()) throw httpError(400, 'Refusing to replace a symlink');
  if (!lst.isFile()) throw httpError(400, 'Not a file');
  const real = realInside(abs, PUBLIC_ROOT);
  if (!real) throw httpError(400, 'Invalid path');
  return real;
}

function writeAtomic(destAbs, sourceAbs) {
  const dir = path.dirname(destAbs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(destAbs)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.copyFileSync(sourceAbs, tmp);
    if (fs.existsSync(destAbs)) {
      try { fs.chmodSync(tmp, fs.statSync(destAbs).mode); } catch { /* keep the temp mode */ }
    }
    fs.renameSync(tmp, destAbs);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw err;
  }
}

/** Copy the public file onto the matching dist path so nginx serves it now. */
function mirrorToDist(rel) {
  const source = existingFile(rel);
  const dest = resolveInside(DIST_ROOT, rel);
  if (!dest) return false;
  if (fs.existsSync(dest)) {
    const lst = fs.lstatSync(dest);
    if (lst.isSymbolicLink() || !lst.isFile()) return false;
    const real = realInside(dest, DIST_ROOT);
    if (!real) return false;
    writeAtomic(real, source);
    return true;
  }
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  const parentReal = realInside(parent, DIST_ROOT);
  if (!parentReal) return false;
  writeAtomic(path.join(parentReal, path.basename(dest)), source);
  return true;
}

function entryForRel(rel) {
  const abs = existingFile(rel);
  const stat = fs.statSync(abs);
  const parent = path.posix.dirname(rel);
  const name = path.posix.basename(rel);
  return describeEntry(parent === '.' ? '' : parent, name, stat, false);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(os.tmpdir(), 'om-website-files');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      cb(httpError(400, 'This file type cannot be placed on the website'));
      return;
    }
    cb(null, true);
  },
}).single('file');

function handleUpload(req, res, next) {
  upload(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.status || 400);
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 80 MB' : (err.message || 'Upload failed');
      return res.status(status).json({ error: message });
    }
    next();
  });
}

function requirePlatformAdmin(req, res) {
  if (!isPlatformAdmin(req)) {
    res.status(403).json({ error: 'Platform admin required' });
    return false;
  }
  return true;
}

function sendFailure(res, err, logLabel) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(`[om-assets] ${logLabel}:`, err.message);
    res.status(500).json({ error: 'Failed to update website file' });
    return;
  }
  res.status(status).json({ error: err.message });
}

function cleanupUpload(req) {
  if (req.file?.path) {
    fs.unlink(req.file.path, () => {});
  }
}

router.use(requireAuth);

router.get('/list', async (req, res) => {
  try {
    if (!requirePlatformAdmin(req, res)) return;
    const rel = normalizeWebsiteRel(typeof req.query.path === 'string' ? req.query.path : '');
    if (rel === null) return res.status(400).json({ error: 'Invalid path' });
    const entries = listWebsiteDir(rel);
    res.json({
      path: rel,
      root: 'front-end/public',
      entries,
    });
  } catch (err) {
    sendFailure(res, err, 'GET /website-files/list');
  }
});

router.get('/file', async (req, res) => {
  try {
    if (!requirePlatformAdmin(req, res)) return;
    const rel = normalizeWebsiteRel(typeof req.query.path === 'string' ? req.query.path : '');
    if (!rel) return res.status(400).json({ error: 'Invalid path' });
    const abs = existingFile(rel);
    res.setHeader('Content-Type', mimeFromExt(path.extname(abs)));
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(abs).replace(/"/g, '')}"`);
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    sendFailure(res, err, 'GET /website-files/file');
  }
});

router.get('/thumb', async (req, res) => {
  try {
    if (!requirePlatformAdmin(req, res)) return;
    const rel = normalizeWebsiteRel(typeof req.query.path === 'string' ? req.query.path : '');
    if (!rel) return res.status(400).json({ error: 'Invalid path' });
    const abs = existingFile(rel);
    if (!RASTER_EXT.test(abs)) return res.status(400).json({ error: 'Not an image' });

    const key = crypto.createHash('sha1').update(rel).digest('hex');
    const thumbPath = path.join(THUMB_ROOT, key.slice(0, 2), `${key}.webp`);
    const srcMtime = fs.statSync(abs).mtimeMs;
    const fresh = fs.existsSync(thumbPath) && fs.statSync(thumbPath).mtimeMs >= srcMtime;
    if (!fresh) {
      fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
      const tmp = `${thumbPath}.${process.pid}.tmp`;
      await sharp(abs, { failOn: 'none' })
        .resize({ width: 320, withoutEnlargement: true })
        .webp({ quality: 70 })
        .toFile(tmp);
      fs.renameSync(tmp, thumbPath);
    }

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    fs.createReadStream(thumbPath).pipe(res);
  } catch (err) {
    try {
      const rel = normalizeWebsiteRel(typeof req.query.path === 'string' ? req.query.path : '');
      const abs = rel ? existingFile(rel) : null;
      if (abs) {
        res.setHeader('Content-Type', mimeFromExt(path.extname(abs)));
        res.setHeader('Cache-Control', 'private, no-cache');
        fs.createReadStream(abs).pipe(res);
        return;
      }
    } catch { /* fall through */ }
    sendFailure(res, err, 'GET /website-files/thumb');
  }
});

router.post('/replace', handleUpload, async (req, res) => {
  try {
    if (!requirePlatformAdmin(req, res)) return;
    const rel = normalizeWebsiteRel(typeof req.body.path === 'string' ? req.body.path : '');
    if (!rel) return res.status(400).json({ error: 'Invalid path' });
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
    if (!req.file.size) return res.status(400).json({ error: 'The uploaded file is empty' });

    const abs = existingFile(rel);
    const existingExt = path.extname(abs).toLowerCase();
    const uploadExt = path.extname(req.file.originalname || '').toLowerCase();
    let sourcePath = req.file.path;
    let converted = false;
    if (uploadExt !== existingExt) {
      if (existingExt === '.webp' && uploadExt === '.png') {
        sourcePath = `${req.file.path}.converted.webp`;
        try {
          await sharp(req.file.path, { failOn: 'none' })
            .webp({ quality: 90, alphaQuality: 90, effort: 4 })
            .toFile(sourcePath);
        } catch (convErr) {
          console.error('[om-assets] website-files png→webp:', convErr.message);
          return res.status(400).json({ error: 'Could not convert that PNG to WebP' });
        }
        if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size === 0) {
          return res.status(400).json({ error: 'Could not convert that PNG to WebP' });
        }
        converted = true;
      } else {
        const hint = existingExt === '.webp' ? ' Upload a .webp or a .png (PNG is converted to WebP).' : '';
        return res.status(400).json({ error: `Replacement must stay a ${existingExt} file so the website address stays the same.${hint}` });
      }
    }

    writeAtomic(abs, sourcePath);
    let mirrored = false;
    try {
      mirrored = mirrorToDist(rel);
    } catch (mirrorErr) {
      console.error('[om-assets] website-files mirror:', mirrorErr.message);
    }

    await auditFromRequest(req, 'edit', {
      payload: { kind: 'website_public_replace', path: rel, bytes: req.file.size, mirrored, converted },
    });

    res.json({ success: true, mirrored, converted, entry: entryForRel(rel) });
  } catch (err) {
    sendFailure(res, err, 'POST /website-files/replace');
  } finally {
    if (req.file?.path) fs.unlink(`${req.file.path}.converted.webp`, () => {});
    cleanupUpload(req);
  }
});

router.post('/upload', handleUpload, async (req, res) => {
  try {
    if (!requirePlatformAdmin(req, res)) return;
    const dirRel = normalizeWebsiteRel(typeof req.body.path === 'string' ? req.body.path : '');
    if (dirRel === null) return res.status(400).json({ error: 'Invalid path' });
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
    if (!req.file.size) return res.status(400).json({ error: 'The uploaded file is empty' });

    const name = safeUploadName(req.file.originalname);
    if (!name) return res.status(400).json({ error: 'Use a simple filename with an image, font, or video extension' });

    const dirAbs = resolveInside(PUBLIC_ROOT, dirRel);
    const dirReal = dirAbs && realInside(dirAbs, PUBLIC_ROOT);
    if (!dirReal || !fs.statSync(dirReal).isDirectory()) return res.status(400).json({ error: 'Folder not found' });

    const rel = dirRel ? `${dirRel}/${name}` : name;
    const dest = path.join(dirReal, name);
    if (fs.existsSync(dest)) {
      return res.status(409).json({ error: `${name} already exists. Use Replace to overwrite it.` });
    }

    writeAtomic(dest, req.file.path);
    let mirrored = false;
    try {
      mirrored = mirrorToDist(rel);
    } catch (mirrorErr) {
      console.error('[om-assets] website-files mirror:', mirrorErr.message);
    }

    await auditFromRequest(req, 'upload', {
      payload: { kind: 'website_public_upload', path: rel, bytes: req.file.size, mirrored },
    });

    res.json({ success: true, mirrored, entry: entryForRel(rel) });
  } catch (err) {
    sendFailure(res, err, 'POST /website-files/upload');
  } finally {
    cleanupUpload(req);
  }
});

module.exports = router;
module.exports.normalizeWebsiteRel = normalizeWebsiteRel;
module.exports.resolveInside = resolveInside;
module.exports.PUBLIC_ROOT = PUBLIC_ROOT;
module.exports.DIST_ROOT = DIST_ROOT;
