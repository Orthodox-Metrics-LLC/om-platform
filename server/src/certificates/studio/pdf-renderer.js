/**
 * Certificate Studio — server-side PDF renderer from layout JSON
 */

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { APPROVED_FONTS, resolvePageDimensions } = require('./constants');

function hexToRgb(hex) {
  if (!hex || hex === '#000000') return rgb(0, 0, 0);
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.substring(0, 2), 16) / 255;
  const g = parseInt(cleaned.substring(2, 4), 16) / 255;
  const b = parseInt(cleaned.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

async function loadFonts(pdfDoc) {
  const fonts = {};
  for (const [key, def] of Object.entries(APPROVED_FONTS)) {
    const stdName = def.pdfLib;
    if (fonts[stdName]) continue;
    const map = {
      TimesRoman: StandardFonts.TimesRoman,
      TimesRomanBold: StandardFonts.TimesRomanBold,
      TimesRomanItalic: StandardFonts.TimesRomanItalic,
      Helvetica: StandardFonts.Helvetica,
      HelveticaBold: StandardFonts.HelveticaBold,
      Courier: StandardFonts.Courier,
    };
    if (map[stdName]) {
      fonts[stdName] = await pdfDoc.embedFont(map[stdName]);
    }
  }
  return fonts;
}

function resolveFont(fonts, fontFamily) {
  const def = APPROVED_FONTS[fontFamily] || APPROVED_FONTS['Times-Roman'];
  return fonts[def.pdfLib] || fonts.TimesRoman;
}

function wrapText(text, font, fontSize, maxWidth) {
  if (!maxWidth || !text) return [text || ''];
  const words = String(text).split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function alignedX(text, x, align, font, fontSize, maxWidth) {
  const tw = font.widthOfTextAtSize(text, fontSize);
  if (align === 'center') return maxWidth ? x + (maxWidth - tw) / 2 : x - tw / 2;
  if (align === 'right') return maxWidth ? x + maxWidth - tw : x - tw;
  return x;
}

function applyTransform(text, transform) {
  if (!text) return '';
  switch (transform) {
    case 'uppercase': return text.toUpperCase();
    case 'lowercase': return text.toLowerCase();
    case 'capitalize':
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default: return text;
  }
}

async function embedAssetImage(pdfDoc, assetPath, storageRoot) {
  if (!assetPath) return null;
  const full = path.isAbsolute(assetPath)
    ? assetPath
    : path.join(storageRoot, assetPath);
  if (!fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full);
  const ext = path.extname(full).toLowerCase();
  if (ext === '.png') return pdfDoc.embedPng(buf);
  if (ext === '.jpg' || ext === '.jpeg') return pdfDoc.embedJpg(buf);
  return null;
}

/**
 * Render a certificate PDF from template + binding values.
 */
async function renderCertificatePdf({
  template,
  version,
  bindingValues,
  assetResolver,
}) {
  const layout = typeof version.layout_json === 'string'
    ? JSON.parse(version.layout_json)
    : version.layout_json;

  const { width: pageW, height: pageH } = resolvePageDimensions(template);
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([pageW, pageH]);
  const fonts = await loadFonts(pdfDoc);

  const layers = [...(layout.layers || [])].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
  const storageRoot = path.join(__dirname, '../../../storage');

  for (const layer of layers) {
    if (layer.visible === false) continue;

    const x = Number(layer.x) || 0;
    const y = Number(layer.y) || 0;
    const w = Number(layer.width) || 0;
    const h = Number(layer.height) || 0;
    const opacity = layer.opacity != null ? Number(layer.opacity) : 1;

    // PDF origin is bottom-left; layout JSON uses top-left
    const pdfY = pageH - y - (h || 0);

    if (layer.type === 'background' || layer.type === 'image' || layer.type === 'border') {
      const fillColor = layer.style?.fill;
      const drawW = w || pageW;
      const drawH = h || pageH;
      const bgY = pageH - y - drawH;

      if (fillColor) {
        page.drawRectangle({
          x,
          y: bgY,
          width: drawW,
          height: drawH,
          color: hexToRgb(fillColor),
          opacity,
        });
      } else if (layer.type === 'background') {
        // Default parchment tone when background layer has no image asset
        page.drawRectangle({
          x,
          y: bgY,
          width: drawW,
          height: drawH,
          color: hexToRgb('#f7f3eb'),
          opacity,
        });
      }

      let imgPath = layer.asset_path;
      if (layer.asset_id && assetResolver) {
        imgPath = await assetResolver(layer.asset_id) || imgPath;
      }
      const img = await embedAssetImage(pdfDoc, imgPath, storageRoot);
      if (img) {
        const imgDims = img.scale(1);
        const drawW = w || pageW;
        const drawH = h || pageH;
        const fitContain = layer.type === 'background' || layer.style?.fit === 'contain';

        if (fitContain) {
          const scale = Math.min(drawW / imgDims.width, drawH / imgDims.height);
          const scaledW = imgDims.width * scale;
          const scaledH = imgDims.height * scale;
          const imgX = x + (drawW - scaledW) / 2;
          const imgY = pageH - y - drawH + (drawH - scaledH) / 2;
          page.drawImage(img, {
            x: imgX,
            y: imgY,
            width: scaledW,
            height: scaledH,
            opacity,
          });
        } else {
          page.drawImage(img, {
            x,
            y: pageH - y - (h || imgDims.height),
            width: w || imgDims.width,
            height: h || imgDims.height,
            opacity,
          });
        }
      }
      continue;
    }

    if (layer.type === 'shape' || layer.type === 'border') {
      const color = hexToRgb(layer.style?.color || '#c9a227');
      const borderWidth = layer.style?.border_width || 2;
      page.drawRectangle({
        x,
        y: pdfY,
        width: w,
        height: h,
        borderColor: color,
        borderWidth,
        opacity,
      });
      continue;
    }

    if (layer.type === 'text' || layer.type === 'bound_field') {
      let text = layer.type === 'bound_field'
        ? (bindingValues[layer.binding?.key] || layer.binding?.fallback || '')
        : (layer.style?.text || '');

      text = applyTransform(text, layer.style?.text_transform);

      const fontSize = Number(layer.style?.font_size) || 14;
      const font = resolveFont(fonts, layer.style?.font_family || 'Times-Roman');
      const color = hexToRgb(layer.style?.color || '#000000');
      const align = layer.style?.alignment || 'left';
      const lineHeight = (layer.style?.line_height || 1.2) * fontSize;
      const allowWrap = layer.style?.allow_wrap || (h > fontSize * 2);

      let lines = allowWrap
        ? wrapText(text, font, fontSize, w || undefined)
        : [text];

      // Single-line fields: truncate like legacy pdf-generator
      if (!allowWrap && w && lines[0]) {
        let displayText = lines[0];
        let textWidth = font.widthOfTextAtSize(displayText, fontSize);
        while (textWidth > w && displayText.length > 0) {
          displayText = displayText.slice(0, -1);
          textWidth = font.widthOfTextAtSize(`${displayText}...`, fontSize);
        }
        if (displayText.length < lines[0].length) displayText += '...';
        lines = [displayText];
      }

      let lineY = pageH - y - fontSize;

      for (const line of lines) {
        const drawX = alignedX(line, x, align, font, fontSize, w || undefined);
        page.drawText(line, {
          x: drawX,
          y: lineY,
          size: fontSize,
          font,
          color,
          opacity,
        });
        lineY -= lineHeight;
        if (h && (pageH - y - lineY) > h) break;
      }
    }
  }

  return pdfDoc.save();
}

module.exports = {
  renderCertificatePdf,
};
