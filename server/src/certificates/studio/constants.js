/**
 * Certificate Studio — shared constants
 */

const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};

const APPROVED_FONTS = {
  'Times-Roman': { pdfLib: 'TimesRoman', css: 'Times New Roman, Times, serif' },
  'Times-Bold': { pdfLib: 'TimesRomanBold', css: 'Times New Roman, Times, serif', weight: 'bold' },
  'Times-Italic': { pdfLib: 'TimesRomanItalic', css: 'Times New Roman, Times, serif', style: 'italic' },
  'Helvetica': { pdfLib: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
  'Helvetica-Bold': { pdfLib: 'HelveticaBold', css: 'Helvetica, Arial, sans-serif', weight: 'bold' },
  'Courier': { pdfLib: 'Courier', css: 'Courier New, monospace' },
};

const CERTIFICATE_TYPES = new Set(['baptism', 'marriage', 'reception']);

const TEMPLATE_MGMT_ROLES = ['super_admin', 'admin', 'church_admin'];
const TEMPLATE_GENERATE_ROLES = ['super_admin', 'admin', 'church_admin', 'priest', 'deacon', 'editor'];

const STORAGE_ROOT = require('path').join(__dirname, '../../../storage/certificates/studio');
const ASSETS_DIR = require('path').join(STORAGE_ROOT, 'assets');
const GENERATED_DIR = require('path').join(STORAGE_ROOT, 'generated');

function resolvePageDimensions(template) {
  let w;
  let h;
  if (template.canvas_size === 'custom' && template.custom_width && template.custom_height) {
    w = Number(template.custom_width);
    h = Number(template.custom_height);
  } else {
    const base = PAGE_SIZES[template.canvas_size] || PAGE_SIZES.letter;
    w = base.width;
    h = base.height;
  }
  if (template.orientation === 'landscape') {
    return { width: Math.max(w, h), height: Math.min(w, h) };
  }
  return { width: Math.min(w, h), height: Math.max(w, h) };
}

function defaultLayoutJson() {
  return {
    version: 1,
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
    bleed: 0,
    showGuides: true,
    layers: [],
  };
}

module.exports = {
  PAGE_SIZES,
  APPROVED_FONTS,
  CERTIFICATE_TYPES,
  TEMPLATE_MGMT_ROLES,
  TEMPLATE_GENERATE_ROLES,
  STORAGE_ROOT,
  ASSETS_DIR,
  GENERATED_DIR,
  resolvePageDimensions,
  defaultLayoutJson,
};
