/**
 * Bake EXIF orientation into pixel data and strip the tag.
 * Phone uploads often store landscape sensor pixels + Orientation=6; without
 * this, region splitting and flat-field run on the sideways canvas.
 */

import fs from 'fs';
import sharp from 'sharp';

export async function bakeExifOrientation(imagePath: string): Promise<{
  applied: boolean;
  orientation?: number;
  width?: number;
  height?: number;
}> {
  if (!fs.existsSync(imagePath)) {
    return { applied: false };
  }

  const meta = await sharp(imagePath).metadata();
  const orientation = meta.orientation || 1;
  if (orientation <= 1) {
    return {
      applied: false,
      orientation,
      width: meta.width,
      height: meta.height,
    };
  }

  const tmpPath = `${imagePath}.orient.tmp`;
  try {
    const ext = imagePath.toLowerCase();
    const pipeline = sharp(imagePath).rotate(); // applies EXIF, then clears tag
    if (ext.endsWith('.png')) {
      await pipeline.png().toFile(tmpPath);
    } else if (ext.endsWith('.webp')) {
      await pipeline.webp({ quality: 92 }).toFile(tmpPath);
    } else {
      await pipeline.jpeg({ quality: 92, mozjpeg: true }).toFile(tmpPath);
    }
    fs.renameSync(tmpPath, imagePath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }

  const after = await sharp(imagePath).metadata();
  return {
    applied: true,
    orientation,
    width: after.width,
    height: after.height,
  };
}
