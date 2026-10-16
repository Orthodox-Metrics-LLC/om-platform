/**
 * Detect which date/clergy columns exist in each sacramental record table.
 * Churches have different schemas (mdate vs marriage_date, burial_date vs funeral_date, etc.)
 *
 * Shared by: om-charts.js, dashboard-home.js
 */

/**
 * Explicit canonical event-date columns per record type.
 * Prefer these over inferred / legacy aliases.
 */
const CANONICAL_DATE_FIELDS = {
  baptism: 'reception_date',
  marriage: 'mdate',
  funeral: 'burial_date',
};

async function detectColumns(pool) {
  const getColNames = async (table) => {
    try {
      const [cols] = await pool.query(`SHOW COLUMNS FROM ${table}`);
      return cols.map(c => c.Field);
    } catch {
      return [];
    }
  };

  const [bCols, mCols, fCols] = await Promise.all([
    getColNames('baptism_records'),
    getColNames('marriage_records'),
    getColNames('funeral_records'),
  ]);

  // Baptism date: canonical reception_date, then baptism_date
  const baptismDate = bCols.includes(CANONICAL_DATE_FIELDS.baptism) ? CANONICAL_DATE_FIELDS.baptism
    : bCols.includes('baptism_date') ? 'baptism_date' : null;

  // Birth date for age calc
  const birthDate = bCols.includes('birth_date') ? 'birth_date' : null;

  // Marriage date: canonical mdate, then marriage_date
  const marriageDate = mCols.includes(CANONICAL_DATE_FIELDS.marriage) ? CANONICAL_DATE_FIELDS.marriage
    : mCols.includes('marriage_date') ? 'marriage_date' : null;

  // Funeral event date: canonical burial_date, then legacy aliases (never created_at)
  const funeralDate = fCols.includes(CANONICAL_DATE_FIELDS.funeral) ? CANONICAL_DATE_FIELDS.funeral
    : fCols.includes('funeral_date') ? 'funeral_date'
    : fCols.includes('deceased_date') ? 'deceased_date'
    : fCols.includes('death_date') ? 'death_date' : null;

  // Clergy columns
  const baptismClergy = bCols.includes('clergy') ? 'clergy' : null;
  const marriageClergy = mCols.includes('clergy') ? 'clergy' : null;
  const funeralClergy = fCols.includes('clergy') ? 'clergy' : null;

  // Name columns (for recent activity display)
  const baptismName = bCols.includes('child_name') ? 'child_name'
    : bCols.includes('name') ? 'name' : null;
  const marriageName = mCols.includes('groom_name') ? 'groom_name'
    : mCols.includes('name') ? 'name' : null;
  const funeralName = fCols.includes('deceased_name') ? 'deceased_name'
    : fCols.includes('name') ? 'name' : null;

  return {
    baptismDate, birthDate, marriageDate, funeralDate,
    baptismClergy, marriageClergy, funeralClergy,
    baptismName, marriageName, funeralName,
    bCols, mCols, fCols
  };
}

module.exports = { detectColumns, CANONICAL_DATE_FIELDS };
