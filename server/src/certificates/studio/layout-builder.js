/**
 * Build Certificate Studio layout_json from legacy coordinate-maps (2026 OCA PNG templates).
 * Converts PDF bottom-left coordinates to layout top-left origin.
 */

const { BAPTISM_CERTIFICATE_MAP, MARRIAGE_CERTIFICATE_MAP } = require('../coordinate-maps');

const PAGE_W = 612;
const PAGE_H = 792;

/** @typedef {{ key: string, format?: string, hidden?: boolean }} BindingSpec */

/** @type {Record<string, BindingSpec>} */
const BAPTISM_BINDINGS = {
  fullName: { key: 'baptism.full_name' },
  fatherName: { key: 'baptism.father_name' },
  motherName: { key: 'baptism.mother_name' },
  birthDateMD: { key: 'baptism.birth_date.md' },
  birthDateYY: { key: 'baptism.birth_date.yy' },
  birthplace: { key: 'baptism.birthplace' },
  baptismDateMD: { key: 'baptism.baptism_date.md' },
  baptismDateYY: { key: 'baptism.baptism_date.yy' },
  sponsors: { key: 'baptism.godparent_names' },
  clergyBy: { key: 'baptism.clergy_name' },
  clergyRector: { key: 'church.priest_name' },
  church: { key: 'church.name' },
};

/** @type {Record<string, BindingSpec>} */
const MARRIAGE_BINDINGS = {
  groomName: { key: 'marriage.groom_name' },
  brideName: { key: 'marriage.bride_name' },
  marriageDateMD: { key: 'marriage.marriage_date.md' },
  marriageDateYY: { key: 'marriage.marriage_date.yy' },
  witnesses: { key: 'marriage.witnesses' },
  clergy: { key: 'marriage.clergy_name' },
  clergyRector: { key: 'church.priest_name' },
  church: { key: 'church.name' },
};

/** @type {Record<string, BindingSpec>} */
const RECEPTION_BINDINGS = {
  fullName: { key: 'reception.person_name' },
  baptismDateMD: { key: 'reception.reception_date.md' },
  baptismDateYY: { key: 'reception.reception_date.yy' },
  clergyBy: { key: 'reception.clergy_name' },
  clergyRector: { key: 'church.priest_name' },
  church: { key: 'church.name' },
};

function pdfToLayoutY(pdfY, fontSize) {
  return PAGE_H - pdfY - fontSize;
}

function pdfCenterToLayoutX(pdfX, maxWidth) {
  return pdfX - (maxWidth || 300) / 2;
}

function fieldLayer(id, name, fieldConfig, bindingSpec, zIndex) {
  const fontSize = fieldConfig.fontSize || 14;
  const maxWidth = fieldConfig.maxWidth || 300;
  const align = fieldConfig.align || 'center';
  const layoutX = align === 'center'
    ? pdfCenterToLayoutX(fieldConfig.x, maxWidth)
    : fieldConfig.x;

  return {
    id,
    type: 'bound_field',
    name,
    x: Math.round(layoutX),
    y: Math.round(pdfToLayoutY(fieldConfig.y, fontSize)),
    width: maxWidth,
    height: Math.round(fontSize * (fieldConfig.allowWrap ? 3 : 1.4)),
    rotation: 0,
    opacity: 1,
    z_index: zIndex,
    locked: false,
    visible: true,
    style: {
      font_family: fieldConfig.fontWeight === 'bold' ? 'Times-Bold' : 'Times-Roman',
      font_size: fontSize,
      color: '#000000',
      alignment: align,
      line_height: fieldConfig.allowWrap ? 1.2 : 1,
    },
    binding: {
      key: bindingSpec.key,
      required: ['fullName', 'groomName', 'brideName'].includes(id),
    },
  };
}

/**
 * @param {object} coordinateMap
 * @param {Record<string, BindingSpec>} bindingMap
 * @param {number} backgroundAssetId
 */
function buildLayoutFromCoordinateMap(coordinateMap, bindingMap, backgroundAssetId) {
  const layers = [{
    id: 'bg2026',
    type: 'background',
    name: '2026 OCA Template',
    x: 0,
    y: 0,
    width: PAGE_W,
    height: PAGE_H,
    rotation: 0,
    opacity: 1,
    z_index: 0,
    locked: true,
    visible: true,
    asset_id: backgroundAssetId,
    style: { fit: 'contain' },
  }];

  let z = 1;
  for (const [fieldId, bindingSpec] of Object.entries(bindingMap)) {
    const fieldConfig = coordinateMap.fields[fieldId];
    if (!fieldConfig) continue;
    layers.push(fieldLayer(fieldId, fieldId, fieldConfig, bindingSpec, z));
    z += 1;
  }

  return {
    version: 2,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    bleed: 0,
    showGuides: false,
    layers,
  };
}

function buildBaptismLayout2026(assetId) {
  return buildLayoutFromCoordinateMap(BAPTISM_CERTIFICATE_MAP, BAPTISM_BINDINGS, assetId);
}

function buildMarriageLayout2026(assetId) {
  return buildLayoutFromCoordinateMap(MARRIAGE_CERTIFICATE_MAP, MARRIAGE_BINDINGS, assetId);
}

function buildReceptionLayout2026(assetId) {
  return buildLayoutFromCoordinateMap(BAPTISM_CERTIFICATE_MAP, RECEPTION_BINDINGS, assetId);
}

module.exports = {
  PAGE_W,
  PAGE_H,
  buildBaptismLayout2026,
  buildMarriageLayout2026,
  buildReceptionLayout2026,
  buildLayoutFromCoordinateMap,
};
