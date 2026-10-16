/**
 * Certificate Field Coordinate Maps
 * 
 * Single source of truth for all certificate field positions.
 * Coordinates are in PDF points (1/72 inch) relative to bottom-left origin.
 * 
 * Template dimensions:
 * - Standard letter size: 612 x 792 points (8.5" x 11")
 * - Certificate templates are scaled to fit letter size
 */

/**
 * Baptism Certificate Field Positions
 * Calibrated for 2026 OCA baptism artwork (adult-baptism.png ≡ baptism-child.pdf).
 * PDF points, bottom-left origin — matches certificate_template_fields for
 * OCA baptism_child (see 20260503_oca_baptism_child_split_fields.sql).
 */
const BAPTISM_CERTIFICATE_MAP = {
  // Template metadata
  templateDimensions: {
    width: 612,  // Letter width in points
    height: 792, // Letter height in points
  },
  
  // Font configuration
  fonts: {
    default: {
      family: 'TimesRoman',
      size: 13,
      color: { r: 0, g: 0, b: 0 },
    },
    name: {
      family: 'TimesRoman',
      size: 18,
      color: { r: 0, g: 0, b: 0 },
      bold: true,
    },
  },
  
  // Field positions (x, y from bottom-left, in PDF points)
  fields: {
    fullName: {
      x: 304,
      y: 346,
      fontSize: 18,
      fontWeight: 'bold',
      align: 'center',
      maxWidth: 305,
    },
    fatherName: {
      x: 250,
      y: 324,
      fontSize: 13,
      align: 'center',
      maxWidth: 135,
    },
    motherName: {
      x: 422,
      y: 324,
      fontSize: 13,
      align: 'center',
      maxWidth: 135,
    },
    parents: {
      x: 304,
      y: 324,
      fontSize: 13,
      align: 'center',
      maxWidth: 305,
    },
    birthDate: {
      x: 291,
      y: 280,
      fontSize: 13,
      align: 'center',
      maxWidth: 220,
    },
    birthplace: {
      x: 368,
      y: 302,
      fontSize: 13,
      align: 'center',
      maxWidth: 226,
    },
    baptismDate: {
      x: 291,
      y: 168,
      fontSize: 13,
      align: 'center',
      maxWidth: 220,
    },
    birthDateMD: {
      x: 291,
      y: 280,
      fontSize: 13,
      align: 'center',
      maxWidth: 194,
    },
    birthDateYY: {
      x: 425,
      y: 280,
      fontSize: 13,
      align: 'center',
      maxWidth: 26,
    },
    baptismDateMD: {
      x: 291,
      y: 168,
      fontSize: 13,
      align: 'center',
      maxWidth: 194,
    },
    baptismDateYY: {
      x: 425,
      y: 168,
      fontSize: 13,
      align: 'center',
      maxWidth: 26,
    },
    sponsors: {
      x: 338,
      y: 146,
      fontSize: 12,
      align: 'center',
      maxWidth: 281,
      allowWrap: true,
    },
    clergyBy: {
      x: 316,
      y: 212,
      fontSize: 13,
      align: 'center',
      maxWidth: 282,
    },
    clergyRector: {
      x: 202,
      y: 101,
      fontSize: 11,
      align: 'center',
      maxWidth: 130,
    },
    church: {
      x: 372,
      y: 190,
      fontSize: 13,
      align: 'center',
      maxWidth: 226,
    },
  },
};

/**
 * Marriage Certificate Field Positions
 * Based on 2026 marriage template
 */
const MARRIAGE_CERTIFICATE_MAP = {
  // Template metadata
  templateDimensions: {
    width: 612,
    height: 792,
  },
  
  // Font configuration
  fonts: {
    default: {
      family: 'TimesRoman',
      size: 14,
      color: { r: 0, g: 0, b: 0 },
    },
    name: {
      family: 'TimesRoman',
      size: 18,
      color: { r: 0, g: 0, b: 0 },
      bold: true,
    },
  },
  
  // Field positions
  fields: {
    groomName: {
      x: 306,
      y: 520,
      fontSize: 18,
      fontWeight: 'bold',
      align: 'center',
      maxWidth: 400,
    },
    brideName: {
      x: 306,
      y: 480,
      fontSize: 18,
      fontWeight: 'bold',
      align: 'center',
      maxWidth: 400,
    },
    marriageDate: {
      x: 306,
      y: 420,
      fontSize: 14,
      align: 'center',
      maxWidth: 200,
    },
    // Split date variants — match the OCA artwork's "ON ___, 20___"
    // layout. Operators drag to fine-tune; these are starter coords.
    marriageDateMD: {
      x: 280,
      y: 420,
      fontSize: 14,
      align: 'center',
      maxWidth: 100,
    },
    marriageDateYY: {
      x: 430,
      y: 420,
      fontSize: 14,
      align: 'center',
      maxWidth: 40,
    },
    witnesses: {
      x: 306,
      y: 280,
      fontSize: 14,
      align: 'center',
      maxWidth: 400,
      allowWrap: true,
    },
    clergy: {
      x: 306,
      y: 240,
      fontSize: 14,
      align: 'center',
      maxWidth: 300,
    },
    // Marriage cert has two clergy slots — the officiating priest on
    // the "By" line (rendered as `clergy`) and a second signature on
    // the "Rector" line at the bottom. Same value as `clergy`.
    clergyRector: {
      x: 450,
      y: 150,
      fontSize: 12,
      align: 'left',
      maxWidth: 200,
    },
    church: {
      x: 306,
      y: 200,
      fontSize: 14,
      align: 'center',
      maxWidth: 400,
    },
  },
};

/**
 * Convert canvas coordinates (top-left origin) to PDF coordinates (bottom-left origin)
 * This is for backward compatibility with existing saved positions
 */
function canvasToPdfCoordinates(canvasX, canvasY, canvasHeight, pdfHeight) {
  // Canvas Y is from top, PDF Y is from bottom
  const pdfY = pdfHeight - (canvasY / canvasHeight * pdfHeight);
  const pdfX = canvasX / canvasHeight * pdfHeight; // Maintain aspect ratio
  
  return { x: pdfX, y: pdfY };
}

/**
 * Get coordinate map for a certificate type
 */
function getCoordinateMap(certificateType) {
  switch (certificateType.toLowerCase()) {
    case 'baptism':
      return BAPTISM_CERTIFICATE_MAP;
    case 'marriage':
      return MARRIAGE_CERTIFICATE_MAP;
    default:
      throw new Error(`Unknown certificate type: ${certificateType}`);
  }
}

/**
 * Merge custom positions with default coordinate map
 * Custom positions override defaults
 */
function mergeCustomPositions(coordinateMap, customPositions) {
  if (!customPositions || Object.keys(customPositions).length === 0) {
    return coordinateMap;
  }

  const merged = JSON.parse(JSON.stringify(coordinateMap)); // Deep clone

  // Sane defaults for any field the front-end exposes but the
  // back-end map hasn't been taught about — prevents silently
  // dropping a saved position when the front-end ships a new field
  // before coordinate-maps catches up.
  const defaultFieldStyle = {
    fontSize: 14,
    align: 'center',
    maxWidth: 300,
  };

  Object.keys(customPositions).forEach(fieldName => {
    const pos = customPositions[fieldName];
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
    if (merged.fields[fieldName]) {
      merged.fields[fieldName] = {
        ...merged.fields[fieldName],
        x: pos.x,
        y: pos.y,
      };
    } else {
      merged.fields[fieldName] = {
        ...defaultFieldStyle,
        x: pos.x,
        y: pos.y,
      };
    }
  });

  return merged;
}

module.exports = {
  BAPTISM_CERTIFICATE_MAP,
  MARRIAGE_CERTIFICATE_MAP,
  getCoordinateMap,
  mergeCustomPositions,
  canvasToPdfCoordinates,
};
