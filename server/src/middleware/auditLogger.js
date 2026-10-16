/**
 * Orthodox Metrics — Audit Logger Middleware
 * Middleware for logging user actions and record changes.
 *
 * OMSD-1640: Events are forwarded to the OMStudio central audit store
 * in addition to the local audit_log table.
 */

const path = require('path');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

let _omAudit = null;
try {
  const emitterPath =
    process.env.OMSTUDIO_EMITTER_PATH
    || path.join(__dirname, '../utils/auditEmitter.js');
  const { createAuditEmitter } = require(emitterPath);
  _omAudit = createAuditEmitter({ sourceSystem: 'OM' });
} catch (_) {
  // OMStudio emitter not available — local-only audit mode.
}

const getDbConnection = async () => mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'orthodmetrics_dev',
});

const auditLogger = (action) => async (req, res, next) => {
  const originalJson = res.json;

  res.json = function jsonWithAudit(data) {
    originalJson.call(this, data);

    setImmediate(async () => {
      await logAuditAction(req, res, action, data);
    });
  };

  next();
};

const logAuditAction = async (req, res, action, responseData) => {
  let connection;

  try {
    connection = await getDbConnection();

    const auditId = uuidv4();
    const userId = req.user?.id || null;
    const userRole = req.user?.role || 'anonymous';
    const recordType = req.recordType || req.params.recordType || null;
    const recordId = req.params.id || responseData?.data?.id || null;
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    const userAgent = req.get('User-Agent') || null;

    const requestData = {
      method: req.method,
      url: req.originalUrl,
      body: req.body ? JSON.stringify(req.body) : null,
      query: req.query ? JSON.stringify(req.query) : null,
      headers: {
        'user-agent': userAgent,
        referer: req.get('Referer'),
      },
    };

    const responseInfo = {
      statusCode: res.statusCode,
      success: responseData?.success || false,
      data: responseData?.data || null,
    };

    const sql = `
      INSERT INTO audit_log (
        id, user_id, user_role, action, record_type, record_id,
        request_data, response_data, ip_address, user_agent,
        created_at, status_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
    `;

    await connection.execute(sql, [
      auditId,
      userId,
      userRole,
      action,
      recordType,
      recordId,
      JSON.stringify(requestData),
      JSON.stringify(responseInfo),
      ipAddress,
      userAgent,
      res.statusCode,
    ]);

    console.log(`[AUDIT] ${action} by user ${userId} (${userRole}) - Status: ${res.statusCode}`);

    if (_omAudit) {
      _omAudit.emit({
        event_type: 'http_action',
        action,
        actor_id: userId != null ? String(userId) : null,
        actor_role: userRole,
        target_type: recordType || null,
        target_id: recordId || null,
        ip_address: ipAddress,
        user_agent: userAgent,
        details: {
          method: req.method,
          url: req.originalUrl,
          status_code: res.statusCode,
          success: responseData?.success || false,
        },
      });
    }
  } catch (error) {
    // Silently skip — audit table may not exist yet
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch (closeError) {
        console.error('Error closing audit log connection:', closeError);
      }
    }
  }
};

const logUserAction = (action, details = null) => async (req, res, next) => {
  const userId = req.user?.id;
  const userRole = req.user?.role;

  if (userId) {
    console.log(`[USER ACTION] ${action} - User: ${userId} (${userRole})`, details);

    if (_omAudit) {
      _omAudit.emitFromRequest(req, {
        event_type: 'user_action',
        action,
        details: details || undefined,
      });
    }
  }

  next();
};

const initializeAuditTables = async () => {
  let connection;

  try {
    connection = await getDbConnection();

    const auditLogSql = `
      CREATE TABLE IF NOT EXISTS audit_log (
        id VARCHAR(36) PRIMARY KEY,
        user_id INT NULL,
        user_role VARCHAR(50) NULL,
        action VARCHAR(100) NOT NULL,
        record_type VARCHAR(50) NULL,
        record_id VARCHAR(36) NULL,
        request_data JSON NULL,
        response_data JSON NULL,
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status_code INT NULL,
        INDEX idx_user_id (user_id),
        INDEX idx_action (action),
        INDEX idx_record_type (record_type),
        INDEX idx_created_at (created_at)
      )
    `;

    const recordAuditSql = `
      CREATE TABLE IF NOT EXISTS record_audit_log (
        id VARCHAR(36) PRIMARY KEY,
        record_type VARCHAR(50) NOT NULL,
        record_id VARCHAR(36) NOT NULL,
        user_id INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        changes JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45) NULL,
        INDEX idx_record (record_type, record_id),
        INDEX idx_user_id (user_id),
        INDEX idx_created_at (created_at)
      )
    `;

    await connection.execute(auditLogSql);
    await connection.execute(recordAuditSql);

    console.log('Audit tables initialized successfully');
  } catch (error) {
    console.error('Error initializing audit tables:', error);
  } finally {
    if (connection) await connection.end();
  }
};

const getAuditLogs = async (req, res) => {
  let connection;

  try {
    connection = await getDbConnection();

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = (page - 1) * limit;
    const action = req.query.action || '';
    const userId = req.query.userId || '';
    const recordType = req.query.recordType || '';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';

    let whereClause = 'WHERE 1=1';
    const queryParams = [];

    if (action) {
      whereClause += ' AND action = ?';
      queryParams.push(action);
    }

    if (userId) {
      whereClause += ' AND user_id = ?';
      queryParams.push(userId);
    }

    if (recordType) {
      whereClause += ' AND record_type = ?';
      queryParams.push(recordType);
    }

    if (startDate) {
      whereClause += ' AND created_at >= ?';
      queryParams.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND created_at <= ?';
      queryParams.push(endDate);
    }

    const countSql = `SELECT COUNT(*) as total FROM audit_log ${whereClause}`;
    const [countRows] = await connection.execute(countSql, queryParams);
    const total = countRows[0].total;

    const sql = `
      SELECT al.*, u.username, u.role
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await connection.execute(sql, [...queryParams, limit, offset]);

    const logs = rows.map((row) => ({
      ...row,
      request_data: row.request_data ? JSON.parse(row.request_data) : null,
      response_data: row.response_data ? JSON.parse(row.response_data) : null,
    }));

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({
      error: 'Database error',
      message: 'Failed to retrieve audit logs',
    });
  } finally {
    if (connection) await connection.end();
  }
};

const shutdownAuditEmitter = async () => {
  if (_omAudit) {
    await _omAudit.shutdown();
  }
};

module.exports = {
  auditLogger,
  logUserAction,
  initializeAuditTables,
  getAuditLogs,
  shutdownAuditEmitter,
};
