/**
 * OM Charts API
 * Provides chart data from church sacramental records (baptisms, marriages, funerals)
 *
 * Endpoint: GET /api/churches/:churchId/charts/summary
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const { getTenantPool } = require('../config/db');
const { getAppPool } = require('../config/db-compat');
const { getEffectiveFeatures } = require('../utils/featureFlags');
const { detectColumns } = require('../utils/detectColumns');

/**
 * GET /summary
 * Returns 6 chart datasets from the church's sacramental records
 */
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const churchId = req.params.churchId;
    if (!churchId) {
      return res.status(400).json({ success: false, error: 'Church ID is required' });
    }

    // Check feature flag
    const appPool = getAppPool();
    const { effective } = await getEffectiveFeatures(appPool, churchId);
    if (!effective.om_charts_enabled) {
      return res.status(403).json({
        success: false,
        error: 'OM Charts is not enabled for this church'
      });
    }

    const pool = getTenantPool(churchId);
    const cols = await detectColumns(pool);
    // Soft-deleted rows (records UI delete) must not count. Tables without deleted_at fall back to 1=1.
    const [delCols] = await pool.query("SELECT TABLE_NAME AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'deleted_at' AND TABLE_NAME IN ('baptism_records','marriage_records','funeral_records')");
    const hasDel = new Set(delCols.map((r) => r.t));
    const live = (t) => (hasDel.has(t) ? `${t}.deleted_at IS NULL` : '1=1');

    // Build UNION parts only for tables that have the right columns
    const yearParts = [];
    const monthParts = [];
    const seasonParts = [];
    const clergyParts = [];

    if (cols.baptismDate) {
      yearParts.push(`SELECT YEAR(${cols.baptismDate}) AS year_val, 'baptism' AS type FROM baptism_records WHERE ${live('baptism_records')} AND ${cols.baptismDate} IS NOT NULL`);
      monthParts.push(`SELECT DATE_FORMAT(${cols.baptismDate}, '%Y-%m') AS month_val, 'baptism' AS type FROM baptism_records WHERE ${live('baptism_records')} AND ${cols.baptismDate} IS NOT NULL`);
      seasonParts.push(`SELECT MONTH(${cols.baptismDate}) AS month_num, 'baptism' AS type FROM baptism_records WHERE ${live('baptism_records')} AND ${cols.baptismDate} IS NOT NULL`);
    }
    if (cols.marriageDate) {
      yearParts.push(`SELECT YEAR(${cols.marriageDate}) AS year_val, 'marriage' AS type FROM marriage_records WHERE ${live('marriage_records')} AND ${cols.marriageDate} IS NOT NULL`);
      monthParts.push(`SELECT DATE_FORMAT(${cols.marriageDate}, '%Y-%m') AS month_val, 'marriage' AS type FROM marriage_records WHERE ${live('marriage_records')} AND ${cols.marriageDate} IS NOT NULL`);
      seasonParts.push(`SELECT MONTH(${cols.marriageDate}) AS month_num, 'marriage' AS type FROM marriage_records WHERE ${live('marriage_records')} AND ${cols.marriageDate} IS NOT NULL`);
    }
    if (cols.funeralDate) {
      yearParts.push(`SELECT YEAR(${cols.funeralDate}) AS year_val, 'funeral' AS type FROM funeral_records WHERE ${live('funeral_records')} AND ${cols.funeralDate} IS NOT NULL`);
      monthParts.push(`SELECT DATE_FORMAT(${cols.funeralDate}, '%Y-%m') AS month_val, 'funeral' AS type FROM funeral_records WHERE ${live('funeral_records')} AND ${cols.funeralDate} IS NOT NULL`);
      seasonParts.push(`SELECT MONTH(${cols.funeralDate}) AS month_num, 'funeral' AS type FROM funeral_records WHERE ${live('funeral_records')} AND ${cols.funeralDate} IS NOT NULL`);
    }
    if (cols.baptismClergy) {
      clergyParts.push(`SELECT TRIM(${cols.baptismClergy}) AS clergy_name FROM baptism_records WHERE ${live('baptism_records')} AND ${cols.baptismClergy} IS NOT NULL AND TRIM(${cols.baptismClergy}) != ''`);
    }
    if (cols.marriageClergy) {
      clergyParts.push(`SELECT TRIM(${cols.marriageClergy}) AS clergy_name FROM marriage_records WHERE ${live('marriage_records')} AND ${cols.marriageClergy} IS NOT NULL AND TRIM(${cols.marriageClergy}) != ''`);
    }
    if (cols.funeralClergy) {
      clergyParts.push(`SELECT TRIM(${cols.funeralClergy}) AS clergy_name FROM funeral_records WHERE ${live('funeral_records')} AND ${cols.funeralClergy} IS NOT NULL AND TRIM(${cols.funeralClergy}) != ''`);
    }

    // Build queries (return empty results if no date columns found)
    const yearQuery = yearParts.length > 0
      ? `SELECT year_val AS year, type, COUNT(*) AS count FROM (${yearParts.join(' UNION ALL ')}) combined WHERE year_val IS NOT NULL GROUP BY year_val, type ORDER BY year_val`
      : null;

    const monthQuery = monthParts.length > 0
      ? `SELECT month_val AS month, type, COUNT(*) AS count FROM (${monthParts.join(' UNION ALL ')}) combined WHERE month_val IS NOT NULL GROUP BY month_val, type ORDER BY month_val`
      : null;

    const seasonQuery = seasonParts.length > 0
      ? `SELECT month_num, type, COUNT(*) AS count FROM (${seasonParts.join(' UNION ALL ')}) combined WHERE month_num IS NOT NULL GROUP BY month_num, type ORDER BY month_num`
      : null;

    const clergyQuery = clergyParts.length > 0
      ? `SELECT clergy_name, COUNT(*) AS count FROM (${clergyParts.join(' UNION ALL ')}) combined GROUP BY clergy_name ORDER BY count DESC LIMIT 15`
      : null;

    const ageQuery = (cols.baptismDate && cols.birthDate)
      ? `SELECT
          CASE
            WHEN age_days <= 90 THEN '0-3 months'
            WHEN age_days <= 180 THEN '3-6 months'
            WHEN age_days <= 365 THEN '6-12 months'
            WHEN age_days <= 730 THEN '1-2 years'
            WHEN age_days <= 1825 THEN '2-5 years'
            ELSE '5+ years'
          END AS age_range,
          COUNT(*) AS count
        FROM (
          SELECT DATEDIFF(${cols.baptismDate}, ${cols.birthDate}) AS age_days
          FROM baptism_records
          WHERE ${live('baptism_records')} AND ${cols.baptismDate} IS NOT NULL AND ${cols.birthDate} IS NOT NULL
        ) ages
        WHERE age_days >= 0
        GROUP BY age_range
        ORDER BY MIN(age_days)`
      : null;

    const clergyYearParts = [];
    if (cols.baptismDate && cols.baptismClergy) clergyYearParts.push(`SELECT YEAR(${cols.baptismDate}) AS year_val, 'baptism' AS type, TRIM(${cols.baptismClergy}) AS clergy_name FROM baptism_records WHERE ${live('baptism_records')} AND ${cols.baptismDate} IS NOT NULL AND ${cols.baptismClergy} IS NOT NULL AND TRIM(${cols.baptismClergy}) != ''`);
    if (cols.marriageDate && cols.marriageClergy) clergyYearParts.push(`SELECT YEAR(${cols.marriageDate}) AS year_val, 'marriage' AS type, TRIM(${cols.marriageClergy}) AS clergy_name FROM marriage_records WHERE ${live('marriage_records')} AND ${cols.marriageDate} IS NOT NULL AND ${cols.marriageClergy} IS NOT NULL AND TRIM(${cols.marriageClergy}) != ''`);
    if (cols.funeralDate && cols.funeralClergy) clergyYearParts.push(`SELECT YEAR(${cols.funeralDate}) AS year_val, 'funeral' AS type, TRIM(${cols.funeralClergy}) AS clergy_name FROM funeral_records WHERE ${live('funeral_records')} AND ${cols.funeralDate} IS NOT NULL AND ${cols.funeralClergy} IS NOT NULL AND TRIM(${cols.funeralClergy}) != ''`);
    const clergyYearQuery = clergyYearParts.length
      ? `SELECT year_val AS year, type, clergy_name, COUNT(*) AS count FROM (${clergyYearParts.join(' UNION ALL ')}) combined WHERE year_val IS NOT NULL GROUP BY year_val, type, clergy_name ORDER BY year_val`
      : null;

    // Most recent sacraments across the register (quick glance card)
    const recentParts = [];
    if (cols.baptismDate) recentParts.push(`SELECT 'baptism' AS type, id, TRIM(CONCAT_WS(' ', first_name, last_name)) AS person, ${cols.baptismDate} AS event_date, ${cols.baptismClergy || 'NULL'} AS clergy, birthplace AS place FROM baptism_records WHERE ${live('baptism_records')} AND ${cols.baptismDate} IS NOT NULL AND ${cols.baptismDate} <= CURDATE()`);
    if (cols.marriageDate) recentParts.push(`SELECT 'marriage' AS type, id, TRIM(CONCAT_WS(' & ', TRIM(CONCAT_WS(' ', fname_groom, lname_groom)), TRIM(CONCAT_WS(' ', fname_bride, lname_bride)))) AS person, ${cols.marriageDate} AS event_date, ${cols.marriageClergy || 'NULL'} AS clergy, NULL AS place FROM marriage_records WHERE ${live('marriage_records')} AND ${cols.marriageDate} IS NOT NULL AND ${cols.marriageDate} <= CURDATE()`);
    if (cols.funeralDate) recentParts.push(`SELECT 'funeral' AS type, id, TRIM(CONCAT_WS(' ', name, lastname)) AS person, ${cols.funeralDate} AS event_date, ${cols.funeralClergy || 'NULL'} AS clergy, burial_location AS place FROM funeral_records WHERE ${live('funeral_records')} AND ${cols.funeralDate} IS NOT NULL AND ${cols.funeralDate} <= CURDATE()`);
    const recentQuery = recentParts.length ? `SELECT * FROM (${recentParts.join(' UNION ALL ')}) ev ORDER BY event_date DESC, id DESC LIMIT 8` : null;

    // Run all queries in parallel
    const [
      sacramentsByYear,
      monthlyTrends,
      byPriest,
      baptismAge,
      typeDistribution,
      seasonalPatterns,
      clergyByYear,
      recentEvents
    ] = await Promise.all([
      yearQuery ? pool.query(yearQuery) : [[]],
      monthQuery ? pool.query(monthQuery) : [[]],
      clergyQuery ? pool.query(clergyQuery) : [[]],
      ageQuery ? pool.query(ageQuery) : [[]],
      pool.query(`
        SELECT 'Baptisms' AS type, COUNT(*) AS count, SUM(${cols.baptismDate ? `${cols.baptismDate} IS NULL` : '0'}) AS undated FROM baptism_records WHERE ${live('baptism_records')}
        UNION ALL
        SELECT 'Marriages' AS type, COUNT(*) AS count, SUM(${cols.marriageDate ? `${cols.marriageDate} IS NULL` : '0'}) AS undated FROM marriage_records WHERE ${live('marriage_records')}
        UNION ALL
        SELECT 'Funerals' AS type, COUNT(*) AS count, SUM(${cols.funeralDate ? `${cols.funeralDate} IS NULL` : '0'}) AS undated FROM funeral_records WHERE ${live('funeral_records')}
      `),
      seasonQuery ? pool.query(seasonQuery) : [[]],
      clergyYearQuery ? pool.query(clergyYearQuery) : [[]],
      recentQuery ? pool.query(recentQuery) : [[]],
    ]);

    // Extract rows (mysql2 returns [rows, fields])
    const getRows = (result) => Array.isArray(result[0]) ? result[0] : result;

    // Pivot helpers for Recharts format
    const pivotByYear = (rows) => {
      const map = {};
      rows.forEach(r => {
        if (!map[r.year]) map[r.year] = { year: r.year, baptism: 0, marriage: 0, funeral: 0 };
        map[r.year][r.type] = Number(r.count);
      });
      return Object.values(map).sort((a, b) => a.year - b.year);
    };

    const pivotByMonth = (rows) => {
      const map = {};
      rows.forEach(r => {
        if (!map[r.month]) map[r.month] = { month: r.month, baptism: 0, marriage: 0, funeral: 0 };
        map[r.month][r.type] = Number(r.count);
      });
      return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
    };

    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pivotBySeason = (rows) => {
      const map = {};
      rows.forEach(r => {
        const key = r.month_num;
        if (!map[key]) map[key] = { month: monthNames[key] || key, baptism: 0, marriage: 0, funeral: 0 };
        map[key][r.type] = Number(r.count);
      });
      return Object.values(map).sort((a, b) => monthNames.indexOf(a.month) - monthNames.indexOf(b.month));
    };

    res.json({
      success: true,
      data: {
        sacramentsByYear: pivotByYear(getRows(sacramentsByYear)),
        monthlyTrends: pivotByMonth(getRows(monthlyTrends)),
        byPriest: getRows(byPriest).map(r => ({ name: r.clergy_name, count: Number(r.count) })),
        baptismAge: getRows(baptismAge).map(r => ({ range: r.age_range, count: Number(r.count) })),
        typeDistribution: getRows(typeDistribution).map(r => ({ name: r.type, value: Number(r.count) })),
        // True register totals (soft-deleted excluded) incl. records that have no sacrament date and so are absent from the year series
        totals: Object.fromEntries(getRows(typeDistribution).map(r => [({ Baptisms: 'baptism', Marriages: 'marriage', Funerals: 'funeral' })[r.type] || r.type, { total: Number(r.count), undated: Number(r.undated || 0) }])),
        clergyByYear: getRows(clergyByYear).map(r => ({ year: Number(r.year), type: r.type, name: r.clergy_name, count: Number(r.count) })),
        recentEvents: getRows(recentEvents).map(r => ({ type: r.type, id: Number(r.id), name: r.person, date: r.event_date, clergy: r.clergy, place: r.place })),
        seasonalPatterns: pivotBySeason(getRows(seasonalPatterns))
      }
    });

  } catch (error) {
    console.error('[OM Charts] Error fetching chart data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chart data',
      message: error.message
    });
  }
});

module.exports = router;
