/**
 * Governed duplicate soft-delete / restore for parish records.
 * Prefer soft-delete; never hard-delete from NL. Survivor cannot be removed in same op.
 */

const { randomUUID, createHash } = require('crypto');
const { RECORD_TYPES } = require('./recordFieldRegistry');
const { getTableColumns, softDeleteSupported } = require('./schemaSupport');
const { logParishSearchEvent } = require('./audit');
const { formatDateOnlyIso } = require('./dateDisplay');
const { canDeleteRecords, hasRole } = require('../../utils/roles');
function duplicateSignature(churchId, type, ids) {
  return createHash('sha256').update(`${churchId}|${type}|${[...ids].sort((a, b) => a - b).join(',')}`).digest('hex');
}

const SKIP_COMPARE_KEYS = new Set([
  'id', 'church_id', 'deleted_at', 'deleted_by', 'deletion_reason',
  'created_at', 'updated_at', 'verified_by', 'verified_at', 'ocr_confidence',
  'source_scan_id',
]);

class DuplicateRemovalError extends Error {
  constructor(message, code = 'duplicate_removal_error', status = 400, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function assertCanDeleteDuplicates(user) {
  if (!canDeleteRecords(user)) {
    throw new DuplicateRemovalError(
      'Removing duplicate sacramental records requires priest role or higher',
      'forbidden',
      403,
    );
  }
}

function assertCanRestore(user) {
  if (!canDeleteRecords(user)) {
    throw new DuplicateRemovalError(
      'Restoring deleted records requires priest role or higher',
      'forbidden',
      403,
    );
  }
}

function assertCanPermanentDelete(user) {
  if (!hasRole(user, 'church_admin')) {
    throw new DuplicateRemovalError(
      'Permanent deletion requires church_admin role or higher',
      'forbidden',
      403,
    );
  }
}

function isEmptyValue(v) {
  if (v == null) return true;
  if (v instanceof Date) return false;
  const s = String(v).trim();
  return s === '' || s === 'null' || s === 'undefined';
}

function recommendSurvivor(records) {
  if (!records.length) return null;
  const scored = records.map((r) => {
    const values = r.values || r;
    let score = 0;
    const filled = Object.keys(values).filter((k) => !SKIP_COMPARE_KEYS.has(k) && !isEmptyValue(values[k]));
    score += filled.length * 3;
    if (String(r.status || values.status || '').toLowerCase() === 'verified') score += 20;
    if (values.verified_at) score += 10;
    if (values.ocr_confidence != null && Number(values.ocr_confidence) > 0) score += 2;
    else score += 5; // prefer non-OCR / manual when confidence absent
    const event = r.canonicalEventDate || values.reception_date || values.mdate || values.burial_date;
    if (event && formatDateOnlyIso(event)) score += 5;
    return { id: Number(r.sourceRecordId || r.id), score, filled: filled.length };
  });
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  return scored[0]?.id ?? null;
}

function missingFieldsOnSurvivor(survivorRow, removeRows) {
  const warnings = [];
  for (const rem of removeRows) {
    const fields = [];
    for (const key of Object.keys(rem)) {
      if (SKIP_COMPARE_KEYS.has(key)) continue;
      if (!isEmptyValue(rem[key]) && isEmptyValue(survivorRow[key])) fields.push(key);
    }
    if (fields.length) {
      warnings.push({
        recordId: rem.id,
        fields,
        message: `Record #${rem.id} contains data not present in the survivor: ${fields.join(', ')}`,
      });
    }
  }
  return warnings;
}

async function loadRecords(pool, recordType, ids) {
  const cfg = RECORD_TYPES[recordType];
  if (!cfg) throw new DuplicateRemovalError(`Unsupported record type: ${recordType}`);
  const uniq = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!uniq.length) throw new DuplicateRemovalError('No valid record ids');
  const [rows] = await pool.query(
    `SELECT * FROM \`${cfg.table}\` WHERE id IN (${uniq.map(() => '?').join(',')})`,
    uniq,
  );
  return rows;
}

function completenessScore(row) {
  return Object.keys(row).filter((k) => !SKIP_COMPARE_KEYS.has(k) && !isEmptyValue(row[k])).length;
}

async function previewDuplicateRemoval(pool, {
  churchId, recordType, survivorId, removeIds, user,
}) {
  assertCanDeleteDuplicates(user);
  const remove = [...new Set((removeIds || []).map(Number))];
  const survivor = Number(survivorId);
  if (!Number.isFinite(survivor) || survivor <= 0) {
    throw new DuplicateRemovalError('Exactly one survivor record must be selected', 'survivor_required');
  }
  if (!remove.length) throw new DuplicateRemovalError('Select at least one record to remove', 'remove_required');
  if (remove.includes(survivor)) {
    throw new DuplicateRemovalError('Survivor cannot also be selected for removal', 'survivor_in_remove_set');
  }
  const allIds = [survivor, ...remove];
  const rows = await loadRecords(pool, recordType, allIds);
  if (rows.length !== allIds.length) {
    throw new DuplicateRemovalError('One or more records were not found in this church database', 'record_not_found', 404);
  }
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const survivorRow = byId.get(survivor);
  const removeRows = remove.map((id) => byId.get(id));
  for (const r of rows) {
    if (r.deleted_at) {
      throw new DuplicateRemovalError(`Record #${r.id} is already deleted`, 'already_deleted');
    }
  }
  const supported = await softDeleteSupported(pool, RECORD_TYPES[recordType].table);
  const warnings = missingFieldsOnSurvivor(survivorRow, removeRows);
  const recommendedId = recommendSurvivor(rows.map((r) => ({
    sourceRecordId: r.id,
    status: r.status,
    values: r,
    canonicalEventDate: r.reception_date || r.mdate || r.burial_date,
  })));

  return {
    churchId,
    recordType,
    survivorId: survivor,
    removeIds: remove,
    recommendedSurvivorId: recommendedId,
    reversible: supported,
    deletionMode: supported ? 'soft_delete' : 'unsupported',
    confirmationPhraseRequired: remove.length > 1,
    confirmationPhrase: remove.length > 1 ? 'REMOVE DUPLICATES' : null,
    missingDataWarnings: warnings,
    records: rows.map((r) => ({
      id: r.id,
      role: r.id === survivor ? 'keep' : 'remove',
      completeness: completenessScore(r),
      status: r.status || null,
    })),
    explanation: supported
      ? 'Selected duplicates will be soft-deleted (archived with deleted_at). They are excluded from normal search and can be restored by authorized administrators.'
      : 'Soft-delete columns are not available on this church database. Run the soft-delete migration before removing duplicates.',
  };
}

async function executeDuplicateRemoval(pool, {
  churchId, recordType, survivorId, removeIds, user, reason, confirmationPhrase,
  acknowledgeMissingData = false, requestId, signature,
}) {
  const preview = await previewDuplicateRemoval(pool, {
    churchId, recordType, survivorId, removeIds, user,
  });
  if (preview.deletionMode !== 'soft_delete') {
    throw new DuplicateRemovalError(preview.explanation, 'soft_delete_unavailable', 409);
  }
  if (preview.confirmationPhraseRequired) {
    if (String(confirmationPhrase || '').trim() !== preview.confirmationPhrase) {
      throw new DuplicateRemovalError(
        `Type ${preview.confirmationPhrase} to confirm removal of multiple records`,
        'confirmation_required',
      );
    }
  }
  if (preview.missingDataWarnings.length && !acknowledgeMissingData) {
    throw new DuplicateRemovalError(
      'Removed records contain data absent from the survivor. Acknowledge the warning or return to comparison.',
      'missing_data_warning',
      409,
      { warnings: preview.missingDataWarnings, choices: ['cancel', 'return_to_comparison', 'continue_without_merging'] },
    );
  }

  const table = RECORD_TYPES[recordType].table;
  const cols = await getTableColumns(pool, table);
  const conn = await pool.getConnection();
  const executionId = requestId || randomUUID();
  const removed = [];
  try {
    await conn.beginTransaction();
    for (const id of preview.removeIds) {
      const [result] = await conn.query(
        `UPDATE \`${table}\`
            SET deleted_at = UTC_TIMESTAMP(), deleted_by = ?, deletion_reason = ?
            ${cols.has('updated_at') ? ', updated_at = UTC_TIMESTAMP()' : ''}
          WHERE id = ? AND deleted_at IS NULL`,
        [user.id || null, String(reason || 'duplicate_removal').slice(0, 500), id],
      );
      if (!result.affectedRows) {
        throw new DuplicateRemovalError(`Failed to soft-delete record #${id}`, 'delete_failed', 409);
      }
      removed.push(id);
      try {
        const { writeSacramentHistory } = require('../../utils/writeSacramentHistory');
        await writeSacramentHistory({
          historyTableName: table.replace('_records', '_history'),
          churchId,
          recordId: id,
          type: 'delete',
          description: `Soft-deleted as duplicate; survivor #${preview.survivorId}`,
          before: { id, deleted_at: null },
          after: { id, deleted_at: new Date().toISOString() },
          actorUserId: user.id,
          source: 'duplicate_review',
          requestId: executionId,
        });
      } catch (_) { /* history best-effort */ }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await logParishSearchEvent('duplicate_deletion_completed', {
    churchId,
    userId: user.id,
    executionId,
    meta: {
      recordType,
      survivorId: preview.survivorId,
      removedIds: removed,
      duplicateGroupSignature: signature || null,
      reason: reason || 'duplicate_removal',
      acknowledgedMissingData: Boolean(acknowledgeMissingData),
      reversible: true,
    },
  });
  if (acknowledgeMissingData && preview.missingDataWarnings.length) {
    await logParishSearchEvent('missing_data_warning_overridden', {
      churchId,
      userId: user.id,
      executionId,
      meta: { recordType, survivorId: preview.survivorId, removedIds: removed, warningCount: preview.missingDataWarnings.length },
    });
  }

  return {
    ...preview,
    removedIds: removed,
    reviewStatusSuggested: 'confirmed_duplicate',
    message: `Soft-deleted ${removed.length} duplicate record(s). Survivor #${preview.survivorId} retained.`,
  };
}

async function resolveDuplicateGroup(pool, {
  churchId, signature, recordType, keepRecordId, removeRecordIds, user,
  reviewNotes, reason = 'confirmed_duplicate', requestId,
}) {
  assertCanDeleteDuplicates(user);
  const table = RECORD_TYPES[recordType]?.table;
  if (!table) throw new DuplicateRemovalError(`Unsupported record type: ${recordType}`);
  if (!/^[a-f0-9]{64}$/.test(String(signature || ''))) throw new DuplicateRemovalError('Invalid duplicate group signature', 'invalid_signature');
  const keepId = Number(keepRecordId);
  const removeIds = [...new Set((removeRecordIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!Number.isInteger(keepId) || keepId <= 0) throw new DuplicateRemovalError('Exactly one record to keep is required', 'keep_record_required');
  if (!removeIds.length) throw new DuplicateRemovalError('At least one duplicate must be removed', 'remove_required');
  if (removeIds.includes(keepId)) throw new DuplicateRemovalError('The kept record cannot also be removed', 'survivor_in_remove_set');
  const allIds = [keepId, ...removeIds].sort((a, b) => a - b);
  if (duplicateSignature(churchId, recordType, allIds) !== signature) {
    throw new DuplicateRemovalError('The supplied records do not belong to this duplicate group', 'records_outside_duplicate_group', 409);
  }
  if (!(await softDeleteSupported(pool, table))) throw new DuplicateRemovalError('Soft-delete is not available for this record type', 'soft_delete_unavailable', 409);

  const tenantConn = await pool.getConnection();
  const executionId = requestId || randomUUID();
  try {
    await tenantConn.beginTransaction();
    const [rows] = await tenantConn.query(
      `SELECT * FROM \`${table}\` WHERE id IN (${allIds.map(() => '?').join(',')}) FOR UPDATE`, allIds,
    );
    if (rows.length !== allIds.length) throw new DuplicateRemovalError('One or more records were not found in this parish', 'record_not_found', 404);
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    if (byId.get(keepId)?.deleted_at) throw new DuplicateRemovalError('The record to keep is not active', 'keep_record_inactive', 409);
    const activeRemoveIds = removeIds.filter((id) => !byId.get(id)?.deleted_at);
    for (const id of activeRemoveIds) {
      const previousStatus = byId.get(id)?.status ?? null;
      const [result] = await tenantConn.query(
        `UPDATE \`${table}\` SET deleted_at=UTC_TIMESTAMP(), deleted_by=?, deletion_reason='confirmed_duplicate'
          ${((await getTableColumns(pool, table)).has('updated_at')) ? ', updated_at=UTC_TIMESTAMP()' : ''}
         WHERE id=? AND deleted_at IS NULL`, [user.id || null, id],
      );
      if (result.affectedRows !== 1) throw new DuplicateRemovalError(`Failed to soft-delete record #${id}`, 'delete_failed', 409);
      await tenantConn.query(
        `INSERT INTO duplicate_resolution_audit
          (church_id, duplicate_group_signature, record_type, removed_record_id, canonical_record_id,
           acting_user_id, review_notes, deletion_reason, previous_record_status, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed_duplicate', ?, ?)`,
        [churchId, signature, recordType, id, keepId, user.id || null, reviewNotes || null, previousStatus, executionId],
      );
    }
    await tenantConn.query(
      `INSERT INTO orthodoxmetrics_db.parish_duplicate_reviews
        (church_id, duplicate_group_signature, record_type, record_ids_json, classification, review_status,
         reviewed_by, reviewed_at, notes, canonical_record_id, resolution_decision, resolved_at)
       VALUES (?, ?, ?, ?, 'Confirmed duplicate', 'confirmed_duplicate', ?, NOW(), ?, ?, 'keep_and_remove', NOW())
       ON DUPLICATE KEY UPDATE record_ids_json=VALUES(record_ids_json), classification=VALUES(classification),
         review_status=VALUES(review_status), reviewed_by=VALUES(reviewed_by), reviewed_at=NOW(), notes=VALUES(notes),
         canonical_record_id=VALUES(canonical_record_id), resolution_decision=VALUES(resolution_decision), resolved_at=NOW()`,
      [churchId, signature, recordType, JSON.stringify(allIds), user.id || null, reviewNotes || null, keepId],
    );
    await tenantConn.commit();
    return { churchId, duplicateGroupId: signature.slice(0, 12), signature, recordType, keepRecordId: keepId, removedRecordIds: activeRemoveIds, alreadyRemovedRecordIds: removeIds.filter((id) => !activeRemoveIds.includes(id)), reversible: true };
  } catch (err) {
    await tenantConn.rollback().catch(() => {});
    throw err;
  } finally {
    tenantConn.release();
  }
}

async function restoreDeletedRecords(pool, {
  churchId, recordType, recordIds, user, reason, requestId,
}) {
  assertCanRestore(user);
  const table = RECORD_TYPES[recordType]?.table;
  if (!table) throw new DuplicateRemovalError(`Unsupported record type: ${recordType}`);
  if (!(await softDeleteSupported(pool, table))) {
    throw new DuplicateRemovalError('Soft-delete columns unavailable; cannot restore', 'soft_delete_unavailable', 409);
  }
  const ids = [...new Set((recordIds || []).map(Number).filter((n) => n > 0))];
  if (!ids.length) throw new DuplicateRemovalError('No record ids to restore');
  const cols = await getTableColumns(pool, table);
  const conn = await pool.getConnection();
  const executionId = requestId || randomUUID();
  const restored = [];
  try {
    await conn.beginTransaction();
    for (const id of ids) {
      const [result] = await conn.query(
        `UPDATE \`${table}\`
            SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
            ${cols.has('updated_at') ? ', updated_at = UTC_TIMESTAMP()' : ''}
          WHERE id = ? AND deleted_at IS NOT NULL`,
        [id],
      );
      if (result.affectedRows) {
        restored.push(id);
        try {
          const { writeSacramentHistory } = require('../../utils/writeSacramentHistory');
          await writeSacramentHistory({
            historyTableName: table.replace('_records', '_history'),
            churchId,
            recordId: id,
            type: 'restore',
            description: reason || 'Restored soft-deleted duplicate',
            before: { id, deleted_at: 'set' },
            after: { id, deleted_at: null },
            actorUserId: user.id,
            source: 'duplicate_review',
            requestId: executionId,
          });
        } catch (_) { /* best-effort */ }
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await logParishSearchEvent('record_restored', {
    churchId,
    userId: user.id,
    executionId,
    meta: { recordType, restoredIds: restored, reason: reason || null },
  });
  return { restoredIds: restored, recordType, churchId };
}

async function permanentDeleteRecords(pool, {
  churchId, recordType, recordIds, user, confirmationPhrase, secondConfirmationPhrase, reason, requestId,
}) {
  assertCanPermanentDelete(user);
  if (String(confirmationPhrase || '').trim() !== 'PERMANENTLY DELETE'
      || String(secondConfirmationPhrase || '').trim() !== 'I UNDERSTAND THIS CANNOT BE UNDONE') {
    throw new DuplicateRemovalError(
      'Permanent deletion requires both confirmation phrases',
      'confirmation_required',
    );
  }
  const table = RECORD_TYPES[recordType]?.table;
  if (!table) throw new DuplicateRemovalError(`Unsupported record type: ${recordType}`);
  const ids = [...new Set((recordIds || []).map(Number).filter((n) => n > 0))];
  if (!ids.length) throw new DuplicateRemovalError('No record ids');

  // Require soft-deleted first (protected workflow)
  const [rows] = await pool.query(
    `SELECT id, deleted_at FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  if (rows.some((r) => !r.deleted_at)) {
    throw new DuplicateRemovalError(
      'Permanent deletion is only allowed for already soft-deleted records with no protected restore path required',
      'permanent_delete_restricted',
      409,
    );
  }

  const conn = await pool.getConnection();
  const executionId = requestId || randomUUID();
  const deleted = [];
  try {
    await conn.beginTransaction();
    for (const id of ids) {
      const [result] = await conn.query(`DELETE FROM \`${table}\` WHERE id = ? AND deleted_at IS NOT NULL`, [id]);
      if (result.affectedRows) deleted.push(id);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await logParishSearchEvent('permanent_deletion_completed', {
    churchId,
    userId: user.id,
    executionId,
    meta: { recordType, deletedIds: deleted, reason: reason || null },
  });
  return { permanentlyDeletedIds: deleted, recordType, churchId };
}

module.exports = {
  DuplicateRemovalError,
  previewDuplicateRemoval,
  executeDuplicateRemoval,
  restoreDeletedRecords,
  permanentDeleteRecords,
  recommendSurvivor,
  missingFieldsOnSurvivor,
  assertCanDeleteDuplicates,
  resolveDuplicateGroup,
  duplicateSignature,
};
