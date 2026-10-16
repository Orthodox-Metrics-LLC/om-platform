/**
 * sacramentalRecordsShared — Helpers shared by api/baptism.js, api/marriage.js,
 * and api/funeral.js, which otherwise duplicated the same church-database
 * lookup and single-record route handlers (jscpd flagged ~800+ duplicated
 * lines across these three files).
 *
 * NOTE: getChurchInfo() is intentionally NOT shared here — funeral.js's
 * version has already diverged (no try/catch fallback, different query
 * shape) from baptism.js/marriage.js's identical copies, so unifying it
 * would either add unwanted error-handling to funeral or remove the
 * fallback-to-default-church behavior from baptism/marriage. Each file
 * keeps its own getChurchInfo.
 */

const { getAppPool } = require('../config/db-compat');

/**
 * Get church database name by church_id, falling back to the first active
 * church, and finally to a hardcoded known-working database if all else fails.
 * @param {number|string|null} churchId
 * @returns {Promise<string>} database name
 */
async function getChurchDatabaseName(churchId) {
    try {
        if (!churchId || churchId === '0') {
            // Get the first active church as default
            console.log('🏛️ No church_id provided, looking for default church...');
            const [defaultChurches] = await getAppPool().query(
                'SELECT id, database_name FROM orthodoxmetrics_db.churches WHERE is_active = 1 ORDER BY id LIMIT 1'
            );

            if (defaultChurches.length === 0) {
                console.error('❌ No active churches found in database');
                throw new Error('No active churches configured');
            }

            const defaultChurch = defaultChurches[0];
            console.log(`🏛️ Using default church ID: ${defaultChurch.id}, database: ${defaultChurch.database_name}`);
            return defaultChurch.database_name || `orthodoxmetrics_ch_${defaultChurch.id}`;
        }

        console.log('🔍 Looking up database name for church_id:', churchId);

        const [churches] = await getAppPool().query(
            'SELECT database_name FROM orthodoxmetrics_db.churches WHERE id = ? AND database_name IS NOT NULL',
            [churchId]
        );

        if (churches.length === 0) {
            console.warn(`⚠️ No active church found with ID: ${churchId}, using default church`);
            // Get the first active church as fallback
            const [defaultChurches] = await getAppPool().query(
                'SELECT id, database_name FROM orthodoxmetrics_db.churches WHERE is_active = 1 ORDER BY id LIMIT 1'
            );

            if (defaultChurches.length === 0) {
                throw new Error('No active churches configured');
            }

            const defaultChurch = defaultChurches[0];
            return defaultChurch.database_name || `orthodoxmetrics_ch_${defaultChurch.id}`;
        }

        if (!churches[0].database_name) {
            console.warn(`⚠️ No database_name configured for church ID: ${churchId}, using generated database name`);
            return `orthodoxmetrics_ch_${churchId}`;
        }

        console.log(`✅ Found database: ${churches[0].database_name} for church_id: ${churchId}`);
        return churches[0].database_name;
    } catch (error) {
        console.error('❌ Error in getChurchDatabaseName:', error);
        console.log('🔄 Falling back to orthodoxmetrics_ch_37');
        return 'orthodoxmetrics_ch_37'; // Fallback to known working database
    }
}

/**
 * Build the `GET /:id/history` handler shared by baptism/marriage/funeral —
 * audit trail lookup from the record type's *_history table.
 */
function createHistoryRoute({ recordTypeLabel, historyTable, getChurchInfo, readSacramentHistory }) {
    return async function historyHandler(req, res) {
        try {
            const churchId = req.query.church_id || req.session?.user?.church_id || req.user?.church_id || null;
            const churchInfo = await getChurchInfo(churchId);
            if (!churchInfo || !churchInfo.databaseName) {
                return res.status(404).json({ success: false, error: 'Church not found' });
            }
            const history = await readSacramentHistory(churchInfo.databaseName, historyTable, req.params.id);
            res.json({ success: true, history });
        } catch (err) {
            console.error(`❌ Error fetching ${recordTypeLabel} record history:`, err);
            res.status(500).json({ success: false, error: 'Failed to fetch record history' });
        }
    };
}

/**
 * Build the `GET /:id` handler shared by baptism/marriage/funeral — single
 * record lookup by immutable PK (deep links, drawer), optionally scoped to
 * a church_id.
 */
function createGetByIdRoute({ recordTypeLabel, table, transform, getChurchInfo, getChurchDbConnection }) {
    return async function getByIdHandler(req, res) {
        try {
            const { id } = req.params;
            if (!/^\d+$/.test(id)) {
                return res.status(400).json({ success: false, error: 'Invalid record ID' });
            }

            const church_id = req.query.church_id || req.session?.user?.church_id || req.user?.church_id || null;
            const churchInfo = await getChurchInfo(church_id);
            if (!churchInfo?.databaseName) {
                return res.status(404).json({ success: false, error: 'Church not found' });
            }

            const churchDbPool = await getChurchDbConnection(churchInfo.databaseName);
            const params = [id];
            let churchFilter = '';
            if (church_id && church_id !== '0') {
                churchFilter = ' AND church_id = ?';
                params.push(church_id);
            }

            const [rows] = await churchDbPool.query(
                `SELECT * FROM ${table} WHERE id = ?${churchFilter}`,
                params
            );

            if (!rows.length) {
                return res.status(404).json({ success: false, error: 'Record not found' });
            }

            const record = transform(rows[0]);
            res.json({ success: true, data: record, ...record });
        } catch (err) {
            console.error(`❌ Error fetching ${recordTypeLabel} record by id:`, err);
            res.status(500).json({ success: false, error: 'Failed to fetch record' });
        }
    };
}

module.exports = {
    getChurchDatabaseName,
    createHistoryRoute,
    createGetByIdRoute,
};
