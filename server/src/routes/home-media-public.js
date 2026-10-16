/**
 * Home hero video reel — public, read-only directory listing.
 * GET /api/public/home-media/hero-videos
 *
 * Lists dated folders (MM-DD-YYYY) under front-end's served
 * assets/video/latest/ so the home hero can auto-cycle through them
 * (latest folder first) without a frontend rebuild each time a new
 * dated folder of videos is dropped in.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const router = express.Router();

const DATE_FOLDER_RE = /^(\d{2})-(\d{2})-(\d{4})$/;
const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;

// Prefer the directory nginx actually serves (dist/); fall back to the
// front-end source (public/) e.g. in local/dev setups without a build yet.
const CANDIDATE_DIRS = [
  path.join(__dirname, '../../../front-end/dist/assets/video/latest'),
  path.join(__dirname, '../../../front-end/public/assets/video/latest'),
];

function folderDateValue([, mm, dd, yyyy]) {
  return Number(yyyy) * 10000 + Number(mm) * 100 + Number(dd);
}

router.get('/hero-videos', (req, res) => {
  try {
    const baseDir = CANDIDATE_DIRS.find((dir) => fs.existsSync(dir));
    if (!baseDir) return res.json({ success: true, folders: [] });

    const folders = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, match: DATE_FOLDER_RE.exec(entry.name) }))
      .filter((entry) => entry.match)
      .sort((a, b) => folderDateValue(b.match) - folderDateValue(a.match))
      .map(({ name }) => {
        const videos = fs
          .readdirSync(path.join(baseDir, name))
          .filter((file) => VIDEO_EXT_RE.test(file))
          .sort();
        return { date: name, videos };
      })
      .filter((folder) => folder.videos.length > 0);

    res.json({ success: true, folders });
  } catch (err) {
    console.error('[home-media-public] GET /hero-videos:', err.message);
    res.status(500).json({ success: false, message: 'Failed to list hero videos' });
  }
});

module.exports = router;
