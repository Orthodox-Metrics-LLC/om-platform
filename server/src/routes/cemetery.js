/**
 * Parish Cemetery API — tenant-scoped burial records, map, and maintenance.
 * Mounted at /api/churches/:churchId/cemetery
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const { getTenantPool } = require('../config/db');
const { computeDirections } = require('../services/cemetery/directions');
const { getRenderGeometry } = require('../services/cemetery/geometryEngine');
const { formatOccupantDisplayName } = require('../services/cemetery/displayNames');
const {
  getCemeteryPlotColumns,
  hasCemeteryPlotsTable,
  isTenantSchemaError,
  plotIdentitySelect,
  plotKeyFieldsSelect,
  plotSearchSelect,
  plotMapSelect,
  plotSurnameSelect,
  plotOrderClause,
  plotSearchLikeClauses,
  plotSearchParams,
} = require('../services/cemetery/plotSchema');

const ADMIN_ROLES = ['super_admin', 'admin'];

function assertChurchAccess(req, res, churchId) {
  const cid = Number(churchId);
  if (!Number.isFinite(cid) || cid <= 0) {
    res.status(400).json({ success: false, error: 'Church ID is required' });
    return false;
  }
  const role = req.user?.role;
  if (ADMIN_ROLES.includes(role)) return true;
  if (Number(req.user?.church_id) === cid) return true;
  res.status(403).json({ success: false, error: 'Access denied for this church' });
  return false;
}

function getPool(req, res) {
  const churchId = req.params.churchId;
  if (!assertChurchAccess(req, res, churchId)) return null;
  try {
    return getTenantPool(churchId);
  } catch (err) {
    console.error('[cemetery] tenant pool error:', err.message);
    res.status(404).json({ success: false, error: 'Church database not found' });
    return null;
  }
}

router.use(requireAuth);

/** GET /render-geometry — explicit map world + road/circle geometry for portal renderer */
router.get('/render-geometry', (req, res) => {
  const churchId = Number(req.params.churchId);
  if (!assertChurchAccess(req, res, churchId)) return;
  try {
    const data = getRenderGeometry(churchId);
    if (data.error) {
      return res.status(404).json({ success: false, error: data.error });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[cemetery] GET /render-geometry:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load render geometry' });
  }
});

/** GET /sections */
router.get('/sections', async (req, res) => {
  try {
    const pool = getPool(req, res);
    if (!pool) return;
    const [rows] = await pool.query(
      `SELECT id, code, name, description, center_x AS centerX, center_y AS centerY
         FROM cemetery_sections
         ORDER BY code`,
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[cemetery] GET /sections:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list sections' });
  }
});

/** GET /plots?section=CODE */
router.get('/plots', async (req, res) => {
  try {
    const pool = getPool(req, res);
    if (!pool) return;
    if (!(await hasCemeteryPlotsTable(pool))) {
      return res.json({ success: true, data: [] });
    }
    const cols = await getCemeteryPlotColumns(pool);
    const sectionCode = req.query.section ? String(req.query.section) : null;
    const params = [];
    let where = '';
    if (sectionCode) {
      where = 'WHERE s.code = ?';
      params.push(sectionCode);
    }
    const [rows] = await pool.query(
      `SELECT ${plotIdentitySelect(cols)},
              ${plotMapSelect(cols)},
              s.code AS sectionCode, s.name AS sectionName,
              r.number AS rowNo,
              (SELECT GROUP_CONCAT(
                 CONCAT(
                   CASE
                     WHEN pe.first_name != '' AND pe.first_name IS NOT NULL
                     THEN CONCAT(pe.first_name, ' ', pe.last_name)
                     ELSE pe.last_name
                   END
                 ) SEPARATOR ', ')
                 FROM cemetery_interments i JOIN cemetery_people pe ON pe.id = i.person_id
                WHERE i.plot_id = p.id) AS occupants,
              ${plotSurnameSelect(cols)},
              (SELECT COUNT(*) FROM cemetery_interments i WHERE i.plot_id = p.id) AS occupantCount
         FROM cemetery_plots p
         JOIN cemetery_sections s ON s.id = p.section_id
         LEFT JOIN cemetery_rows r ON r.id = p.row_id
         ${where}
         ${plotOrderClause(cols)}`,
      params,
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    if (isTenantSchemaError(err)) {
      return res.json({ success: true, data: [] });
    }
    console.error('[cemetery] GET /plots:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list plots' });
  }
});

/** GET /plots/:plotId */
router.get('/plots/:plotId', async (req, res) => {
  try {
    const pool = getPool(req, res);
    if (!pool) return;
    const plotId = Number(req.params.plotId);
    if (!Number.isFinite(plotId)) {
      return res.status(400).json({ success: false, error: 'Invalid plot ID' });
    }

    if (!(await hasCemeteryPlotsTable(pool))) {
      return res.status(404).json({ success: false, error: 'Plot not found' });
    }
    const cols = await getCemeteryPlotColumns(pool);
    const [plotRows] = await pool.query(
      `SELECT ${plotIdentitySelect(cols)},
              p.status, p.map_x AS mapX, p.map_y AS mapY,
              p.notes,
              ${cols.has('family_crest') ? 'p.family_crest AS familyCrest,' : 'NULL AS familyCrest,'}
              ${cols.has('plot_kind') ? 'p.plot_kind AS plotKind,' : "'grave' AS plotKind,"}
              s.code AS sectionCode, s.name AS sectionName,
              r.number AS rowNo
         FROM cemetery_plots p
         JOIN cemetery_sections s ON s.id = p.section_id
         LEFT JOIN cemetery_rows r ON r.id = p.row_id
        WHERE p.id = ?
        LIMIT 1`,
      [plotId],
    );
    const plot = plotRows[0];
    if (!plot) {
      return res.status(404).json({ success: false, error: 'Plot not found' });
    }

    const [occupants] = await pool.query(
      `SELECT i.id AS intermentId, i.burial_date AS burialDate, i.interment_type AS intermentType,
              pe.id AS personId, pe.first_name AS firstName, pe.last_name AS lastName,
              pe.birth_date AS birthDate, pe.death_date AS deathDate
         FROM cemetery_interments i
         JOIN cemetery_people pe ON pe.id = i.person_id
        WHERE i.plot_id = ?
        ORDER BY i.burial_date`,
      [plotId],
    );

    const familyCrest = plot.familyCrest || null;
    const occupantsWithDisplay = occupants.map((o) => ({
      ...o,
      displayName: formatOccupantDisplayName(o.firstName, o.lastName, familyCrest),
    }));

    res.json({ success: true, data: { ...plot, occupants: occupantsWithDisplay } });
  } catch (err) {
    if (isTenantSchemaError(err)) {
      return res.status(404).json({ success: false, error: 'Plot not found' });
    }
    console.error('[cemetery] GET /plots/:plotId:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load plot detail' });
  }
});

/** GET /plots/search?q= — occupant name or grave number component */
router.get('/plots/search', async (req, res) => {
  try {
    const pool = getPool(req, res);
    if (!pool) return;
    const q = String(req.query.q || '').trim();
    if (q.length < 1) {
      return res.json({ success: true, data: [] });
    }
    if (!(await hasCemeteryPlotsTable(pool))) {
      return res.json({ success: true, data: [] });
    }
    const cols = await getCemeteryPlotColumns(pool);
    const likeClauses = plotSearchLikeClauses(cols);
    const params = plotSearchParams(q, cols);
    if (cols.has('family_crest')) {
      likeClauses.push('p.family_crest LIKE ?');
      params.splice(params.length - 3, 0, `%${q}%`);
    }
    const [rows] = await pool.query(
      `SELECT ${plotSearchSelect(cols)}, p.status,
              ${cols.has('family_crest') ? 'p.family_crest AS familyCrest,' : 'NULL AS familyCrest,'}
              ${cols.has('plot_kind') ? 'p.plot_kind AS plotKind,' : "'grave' AS plotKind,"}
              s.code AS sectionCode, s.name AS sectionName, r.number AS rowNo,
              (SELECT GROUP_CONCAT(
                 CONCAT(
                   CASE
                     WHEN pe.first_name != '' AND pe.first_name IS NOT NULL
                     THEN CONCAT(pe.first_name, ' ', pe.last_name)
                     ELSE pe.last_name
                   END
                 ) SEPARATOR ', ')
                 FROM cemetery_interments i JOIN cemetery_people pe ON pe.id = i.person_id
                WHERE i.plot_id = p.id) AS occupants
         FROM cemetery_plots p
         JOIN cemetery_sections s ON s.id = p.section_id
         LEFT JOIN cemetery_rows r ON r.id = p.row_id
        WHERE ${likeClauses.join('\n           OR ')}
           OR EXISTS (
                SELECT 1 FROM cemetery_interments i
                  JOIN cemetery_people pe ON pe.id = i.person_id
                 WHERE i.plot_id = p.id
                   AND (pe.first_name LIKE ? OR pe.last_name LIKE ?
                        OR CONCAT(pe.first_name,' ',pe.last_name) LIKE ?)
              )
        ${plotOrderClause(cols)}
        LIMIT 50`,
      params,
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    if (isTenantSchemaError(err)) {
      return res.json({ success: true, data: [] });
    }
    console.error('[cemetery] GET /plots/search:', err.message);
    res.status(500).json({ success: false, error: 'Plot search failed' });
  }
});

/** GET /people/search?q= */
router.get('/people/search', async (req, res) => {
  try {
    const pool = getPool(req, res);
    if (!pool) return;
    const q = String(req.query.q || '').trim();
    if (q.length < 1) {
      return res.json({ success: true, data: [] });
    }
    if (!(await hasCemeteryPlotsTable(pool))) {
      return res.json({ success: true, data: [] });
    }
    const cols = await getCemeteryPlotColumns(pool);
    const like = `%${q}%`;
    const plotMatch = [
      'p.plot_number LIKE ?',
      cols.has('display_numbers') ? 'p.display_numbers LIKE ?' : null,
    ].filter(Boolean);
    const plotParams = cols.has('display_numbers') ? [like, like] : [like];
    const [rows] = await pool.query(
      `SELECT pe.id AS personId, pe.first_name AS firstName, pe.last_name AS lastName,
              pe.birth_date AS birthDate, pe.death_date AS deathDate,
              p.id AS plotId, p.plot_number AS plotNumber, p.status,
              s.code AS sectionCode, r.number AS rowNo
         FROM cemetery_people pe
         LEFT JOIN cemetery_interments i ON i.person_id = pe.id
         LEFT JOIN cemetery_plots p ON p.id = i.plot_id
         LEFT JOIN cemetery_sections s ON s.id = p.section_id
         LEFT JOIN cemetery_rows r ON r.id = p.row_id
        WHERE pe.first_name LIKE ? OR pe.last_name LIKE ?
           OR CONCAT(pe.first_name,' ',pe.last_name) LIKE ?
           OR CONCAT(pe.last_name,', ',pe.first_name) LIKE ?
           OR ${plotMatch.join(' OR ')}
        ORDER BY pe.last_name, pe.first_name
        LIMIT 50`,
      [like, like, like, like, ...plotParams],
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    if (isTenantSchemaError(err)) {
      return res.json({ success: true, data: [] });
    }
    console.error('[cemetery] GET /people/search:', err.message);
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

/** GET /people */
router.get('/people', async (req, res) => {
  try {
    const pool = getPool(req, res);
    if (!pool) return;
    if (!(await hasCemeteryPlotsTable(pool))) {
      return res.json({ success: true, data: [] });
    }
    const cols = await getCemeteryPlotColumns(pool);
    const [rows] = await pool.query(
      `SELECT pe.id AS personId, pe.first_name AS firstName, pe.last_name AS lastName,
              pe.birth_date AS birthDate, pe.death_date AS deathDate,
              p.id AS plotId, ${plotKeyFieldsSelect(cols)},
              s.code AS sectionCode, r.number AS rowNo
         FROM cemetery_people pe
         LEFT JOIN cemetery_interments i ON i.person_id = pe.id
         LEFT JOIN cemetery_plots p ON p.id = i.plot_id
         LEFT JOIN cemetery_sections s ON s.id = p.section_id
         LEFT JOIN cemetery_rows r ON r.id = p.row_id
        ORDER BY pe.last_name, pe.first_name`,
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    if (isTenantSchemaError(err)) {
      return res.json({ success: true, data: [] });
    }
    console.error('[cemetery] GET /people:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list people' });
  }
});

/** GET /stats */
router.get('/stats', async (req, res) => {
  try {
    const pool = getPool(req, res);
    if (!pool) return;
    const [byStatus] = await pool.query(
      'SELECT status, COUNT(*) AS count FROM cemetery_plots GROUP BY status',
    );
    const [totalsRows] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM cemetery_plots) AS plots,
              (SELECT COUNT(*) FROM cemetery_people) AS people,
              (SELECT COUNT(*) FROM cemetery_interments) AS interments,
              (SELECT COUNT(*) FROM cemetery_sections) AS sections`,
    );
    res.json({
      success: true,
      data: {
        byStatus,
        totals: totalsRows[0] || { plots: 0, people: 0, interments: 0, sections: 0 },
      },
    });
  } catch (err) {
    console.error('[cemetery] GET /stats:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

/** GET /maintenance */
router.get('/maintenance', async (req, res) => {
  try {
    const pool = getPool(req, res);
    if (!pool) return;
    const [rows] = await pool.query(
      `SELECT m.id, m.title, m.description, m.status, m.due_date AS dueDate,
              s.code AS sectionCode, p.plot_number AS plotNumber
         FROM cemetery_maintenance_tasks m
         LEFT JOIN cemetery_sections s ON s.id = m.section_id
         LEFT JOIN cemetery_plots p ON p.id = m.plot_id
        ORDER BY FIELD(m.status,'open','in_progress','done'), m.due_date`,
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[cemetery] GET /maintenance:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list maintenance tasks' });
  }
});

/** GET /directions/:plotId */
router.get('/directions/:plotId', async (req, res) => {
  try {
    const pool = getPool(req, res);
    if (!pool) return;
    const plotId = Number(req.params.plotId);
    if (!Number.isFinite(plotId)) {
      return res.status(400).json({ success: false, error: 'Invalid plot ID' });
    }
    const data = await computeDirections(pool, plotId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Could not compute directions' });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[cemetery] GET /directions/:plotId:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute directions' });
  }
});

module.exports = router;
