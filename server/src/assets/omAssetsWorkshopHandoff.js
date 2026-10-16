/**
 * OM Asset Manager → OM Workshop handoff.
 * Authz on OM, then push bytes + provenance meta to Workshop ingest.
 */

const fs = require('fs');
const path = require('path');
const { getAppPool } = require('../config/db');
const { canReadAsset } = require('./omAssetsPermissions');
const { getAssetById, resolveAssetFilePath } = require('./omAssetsService');
const { logAssetAuditEvent } = require('./omAssetsAudit');

function workshopBaseUrl() {
  return String(process.env.OM_WORKSHOP_BASE_URL || 'http://192.168.1.251').replace(/\/$/, '');
}

function workshopServiceToken() {
  return (
    process.env.OM_WORKSHOP_SERVICE_TOKEN ||
    process.env.OMSTUDIO_SERVICE_TOKEN ||
    ''
  );
}

async function workshopFetch(pathname, { method = 'GET', body = null } = {}) {
  const token = workshopServiceToken();
  if (!token) {
    const err = new Error('OM_WORKSHOP_SERVICE_TOKEN / OMSTUDIO_SERVICE_TOKEN not configured');
    err.code = 'workshop_token_missing';
    err.status = 503;
    throw err;
  }
  const url = `${workshopBaseUrl()}${pathname}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  let payload;
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const err = new Error(
      (data && (data.message || data.error)) || `workshop_http_${res.status}`,
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function fetchWorkshopDestinations() {
  return workshopFetch('/__server/workshop/assets/destinations', { method: 'GET' });
}

function assetSha(asset) {
  return String(asset.sha256 || asset.checksum_sha256 || asset.content_hash || '').toLowerCase() || null;
}

function readAssetBuffer(asset) {
  const abs = resolveAssetFilePath(asset);
  if (!abs || !fs.existsSync(abs)) {
    const err = new Error(`asset_file_missing:${asset.id}`);
    err.status = 404;
    throw err;
  }
  return fs.readFileSync(abs);
}

async function insertTransferRow(row) {
  const pool = getAppPool();
  const [result] = await pool.query(
    `INSERT INTO om_asset_workshop_transfers
      (asset_id, actor_user_id, destination_type, workshop_site_id, workshop_revision_id,
       workshop_import_id, source_sha256, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.asset_id,
      row.actor_user_id,
      row.destination_type,
      row.workshop_site_id,
      row.workshop_revision_id,
      row.workshop_import_id,
      row.source_sha256,
      row.status,
      row.error_message,
    ],
  );
  return result.insertId;
}

/**
 * @param {import('express').Request} req
 * @param {{ assetIds: number[], destinationType: string, siteId?: string, revisionId?: string }} body
 */
async function sendAssetsToWorkshop(req, body) {
  const ids = Array.isArray(body.assetIds)
    ? [...new Set(body.assetIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))]
    : [];
  if (!ids.length) {
    return { ok: false, status: 400, error: 'assetIds_required' };
  }

  let destinationType = String(body.destinationType || body.destination_type || 'inbox');
  if (destinationType === 'revision') destinationType = 'workspace';
  if (destinationType !== 'inbox' && destinationType !== 'workspace') {
    return { ok: false, status: 400, error: 'invalid_destination_type' };
  }

  const siteId = body.siteId || body.site_id || null;
  const revisionId = body.revisionId || body.revision_id || null;
  if (destinationType === 'workspace' && !siteId) {
    return { ok: false, status: 400, error: 'siteId_required_for_workspace' };
  }

  const actorUserId = req.user?.id || req.session?.user?.id || null;
  const actorEmail = req.user?.email || req.session?.user?.email || null;

  const assetsPayload = [];
  const denied = [];
  const missing = [];
  // Prefer Workshop pull (avoids nginx 413 on large base64 JSON). Embed bytes only for tiny files.
  const INLINE_MAX_BYTES = Number(process.env.OM_WORKSHOP_INLINE_MAX_BYTES || 256 * 1024);

  for (const id of ids) {
    const asset = await getAssetById(id);
    if (!asset) {
      missing.push(id);
      continue;
    }
    if (!canReadAsset(req, asset)) {
      denied.push(id);
      continue;
    }
    let buffer = null;
    try {
      buffer = readAssetBuffer(asset);
    } catch (e) {
      missing.push(id);
      continue;
    }
    const sha = assetSha(asset) || require('crypto').createHash('sha256').update(buffer).digest('hex');
    const entry = {
      sourceAssetId: asset.id,
      sourceSha256: sha,
      sourceUpdatedAt: asset.updated_at || null,
      originalFilename: asset.name || path.basename(asset.file_path || `asset-${asset.id}`),
      mimeType: asset.mime_type || asset.file_type || null,
      width: asset.width,
      height: asset.height,
      category: asset.category,
      tags: Array.isArray(asset.tags) ? asset.tags : [],
      scope: asset.scope,
      visibility: asset.visibility,
      churchId: asset.church_id,
      fetchMode: 'om-pull',
    };
    if (buffer.length <= INLINE_MAX_BYTES) {
      entry.fileBase64 = buffer.toString('base64');
      entry.fetchMode = 'inline';
    }
    assetsPayload.push(entry);
  }

  if (denied.length) {
    return {
      ok: false,
      status: 403,
      error: 'access_denied',
      deniedAssetIds: denied,
      missingAssetIds: missing,
    };
  }
  if (!assetsPayload.length) {
    return {
      ok: false,
      status: 404,
      error: 'no_readable_assets',
      missingAssetIds: missing,
    };
  }

  let workshopResult;
  try {
    workshopResult = await workshopFetch('/__server/workshop/assets/import-from-om', {
      method: 'POST',
      body: {
        destinationType: destinationType === 'workspace' ? 'revision' : 'inbox',
        siteId,
        revisionId,
        actorUserId,
        actorEmail,
        assets: assetsPayload,
      },
    });
  } catch (err) {
    for (const a of assetsPayload) {
      await insertTransferRow({
        asset_id: a.sourceAssetId,
        actor_user_id: actorUserId,
        destination_type: destinationType,
        workshop_site_id: siteId,
        workshop_revision_id: revisionId,
        workshop_import_id: null,
        source_sha256: a.sourceSha256,
        status: 'failed',
        error_message: String(err.message || err).slice(0, 500),
      });
      await logAssetAuditEvent({
        event_type: 'workshop_send',
        asset_id: a.sourceAssetId,
        actor_user_id: actorUserId,
        actor_email: actorEmail,
        payload: {
          status: 'failed',
          destinationType,
          siteId,
          revisionId,
          error: String(err.message || err).slice(0, 200),
        },
      });
    }
    return {
      ok: false,
      status: err.status || 502,
      error: 'workshop_import_failed',
      message: err.message,
      data: err.data || null,
    };
  }

  const imported = Array.isArray(workshopResult?.imported) ? workshopResult.imported : [];
  const failed = Array.isArray(workshopResult?.failed) ? workshopResult.failed : [];
  const bySource = new Map(imported.map((i) => [Number(i.sourceAssetId), i]));

  const transfers = [];
  for (const a of assetsPayload) {
    const item = bySource.get(Number(a.sourceAssetId));
    const failedItem = failed.find(
      (f) => Number(f.sourceAssetId) === Number(a.sourceAssetId),
    );
    const status = item ? 'sent' : failedItem ? 'failed' : workshopResult?.ok ? 'sent' : 'partial';
    const transferId = await insertTransferRow({
      asset_id: a.sourceAssetId,
      actor_user_id: actorUserId,
      destination_type: destinationType,
      workshop_site_id: workshopResult?.siteId || siteId,
      workshop_revision_id: workshopResult?.revisionId || revisionId,
      workshop_import_id: item?.id || null,
      source_sha256: a.sourceSha256,
      status,
      error_message: failedItem ? String(failedItem.message || failedItem.error || '').slice(0, 500) : null,
    });
    await logAssetAuditEvent({
      event_type: 'workshop_send',
      asset_id: a.sourceAssetId,
      actor_user_id: actorUserId,
      actor_email: actorEmail,
      payload: {
        status,
        destinationType,
        siteId: workshopResult?.siteId || siteId,
        revisionId: workshopResult?.revisionId || revisionId,
        workshopImportId: item?.id || null,
        transferId,
      },
    });
    transfers.push({
      transferId,
      assetId: a.sourceAssetId,
      status,
      workshopImportId: item?.id || null,
    });
  }

  return {
    ok: failed.length === 0,
    status: failed.length && !imported.length ? 502 : 200,
    destinationType,
    siteId: workshopResult?.siteId || siteId,
    revisionId: workshopResult?.revisionId || revisionId,
    imported,
    failed,
    transfers,
    missingAssetIds: missing,
  };
}

module.exports = {
  fetchWorkshopDestinations,
  sendAssetsToWorkshop,
  workshopBaseUrl,
};
