/**
 * OM Assets Library — scope / visibility access control
 *
 * public   — any authenticated OM church user may read (visibility-dependent for files)
 * church   — only that church's users + platform admins
 * site     — platform admins only
 * internal — platform admins only; never exposed via public APIs
 */

const {
  PLATFORM_ADMIN_ROLES,
  SUPER_ADMIN_ROLES,
  CHURCH_ASSET_WRITE_ROLES,
} = require('./omAssetsConstants');

function userRole(req) {
  return req.user?.role || req.session?.user?.role || null;
}

function userId(req) {
  return req.user?.id || req.session?.user?.id || null;
}

function userEmail(req) {
  return req.user?.email || req.session?.user?.email || null;
}

function userChurchId(req) {
  const cid = Number(req.user?.church_id ?? req.session?.user?.church_id);
  return Number.isFinite(cid) && cid > 0 ? cid : null;
}

function isPlatformAdmin(req) {
  return PLATFORM_ADMIN_ROLES.has(userRole(req));
}

function isSuperAdmin(req) {
  return SUPER_ADMIN_ROLES.has(userRole(req));
}

function isAuthenticated(req) {
  return !!userId(req);
}

function isInternalAsset(asset) {
  return asset?.scope === 'internal' || asset?.visibility === 'internal_only';
}

function canReadAsset(req, asset) {
  if (!asset || asset.status === 'archived') return false;

  if (isInternalAsset(asset)) {
    return isAuthenticated(req) && isPlatformAdmin(req);
  }

  if (!isAuthenticated(req)) {
    return asset.scope === 'public' && asset.visibility === 'public';
  }

  if (isPlatformAdmin(req)) return true;

  switch (asset.scope) {
    case 'public':
      return true;
    case 'church':
      return userChurchId(req) === Number(asset.church_id);
    case 'site':
      return false;
    case 'internal':
      return false;
    default:
      return false;
  }
}

/** File streaming — respects visibility; internal_only never served without admin auth */
function canReadAssetFile(req, asset) {
  if (!asset || asset.status === 'archived') return false;

  if (isInternalAsset(asset)) {
    return isAuthenticated(req) && isPlatformAdmin(req);
  }

  if (asset.visibility === 'internal_only') {
    return isAuthenticated(req) && isPlatformAdmin(req);
  }

  if (asset.visibility === 'authenticated') {
    return isAuthenticated(req) && canReadAsset(req, asset);
  }

  // visibility public
  if (asset.scope === 'public' && asset.visibility === 'public') return true;
  return canReadAsset(req, asset);
}

function canWriteAsset(req, asset) {
  if (!isAuthenticated(req)) return false;
  if (isPlatformAdmin(req)) return true;

  if (asset?.scope === 'internal') return false;

  if (asset?.scope === 'church') {
    const role = userRole(req);
    return CHURCH_ASSET_WRITE_ROLES.has(role)
      && userChurchId(req) === Number(asset.church_id);
  }
  return false;
}

function canCreateScope(req, scope, churchId) {
  if (!isAuthenticated(req)) return false;

  switch (scope) {
    case 'public':
    case 'site':
      return isPlatformAdmin(req);
    case 'internal':
      return isPlatformAdmin(req);
    case 'church': {
      if (!churchId) return false;
      if (isPlatformAdmin(req)) return true;
      const role = userRole(req);
      return role === 'church_admin' && userChurchId(req) === Number(churchId);
    }
    default:
      return false;
  }
}

/** Scopes visible in list queries — internal excluded for non-admins */
function readableScopesForUser(req) {
  if (isPlatformAdmin(req)) return ['public', 'church', 'site', 'internal'];
  const scopes = ['public'];
  if (userChurchId(req)) scopes.push('church');
  return scopes;
}

/** Visibility values a user may see in list filters */
function readableVisibilitiesForUser(req) {
  if (isPlatformAdmin(req)) return ['public', 'authenticated', 'internal_only'];
  return ['public', 'authenticated'];
}

function resolveListChurchId(req, queryChurchId) {
  if (isPlatformAdmin(req)) {
    const q = Number(queryChurchId);
    return Number.isFinite(q) && q > 0 ? q : null;
  }
  return userChurchId(req);
}

module.exports = {
  userRole,
  userId,
  userEmail,
  userChurchId,
  isPlatformAdmin,
  isSuperAdmin,
  isAuthenticated,
  isInternalAsset,
  canReadAsset,
  canReadAssetFile,
  canWriteAsset,
  canCreateScope,
  readableScopesForUser,
  readableVisibilitiesForUser,
  resolveListChurchId,
};
