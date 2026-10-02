import { CONFIG } from 'src/global-config';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * The Orthodox Metrics avatar presets a user can choose from. Selection is
 * persisted to `users.avatar_url` through `PUT /api/user/profile` — the URL is a
 * static asset path so it survives re-deploys and needs no upload pipeline.
 */
export type OmAvatarPreset = {
  id: string;
  label: string;
  src: string;
};

const AVATAR_DIR = `${CONFIG.assetsDir}/assets/images/avatar`;

export const OM_AVATARS: OmAvatarPreset[] = [
  { id: 'female', label: 'Woman', src: `${AVATAR_DIR}/om-avatar-female.png` },
  { id: 'male-priest', label: 'Priest', src: `${AVATAR_DIR}/om-avatar-male-priest.png` },
  { id: 'male-bishop', label: 'Bishop', src: `${AVATAR_DIR}/om-avatar-male-bishop.png` },
  { id: 'monk-elder', label: 'Monk', src: `${AVATAR_DIR}/om-avatar-monk-elder.png` },
  { id: 'priest-kamilavka', label: 'Priest (kamilavka)', src: `${AVATAR_DIR}/om-avatar-priest-kamilavka.png` },
  { id: 'priest-fur-hat', label: 'Priest (skufia)', src: `${AVATAR_DIR}/om-avatar-priest-fur-hat.png` },
  { id: 'hierarch-elder', label: 'Hierarch', src: `${AVATAR_DIR}/om-avatar-hierarch-elder.png` },
];

export function isOmAvatarPreset(url?: string | null) {
  return !!url && OM_AVATARS.some((a) => a.src === url);
}

/** Slug of the Asset Manager collection (scope=public) that feeds extra avatar choices. */
const AVATAR_COLLECTION_SLUG = 'avatars-public';

/**
 * Additional avatar presets sourced from the Asset Manager's "avatars public"
 * collection, so uploading a new headshot there makes it selectable here
 * without a code change. Returns [] (never throws) if the collection is
 * missing or the request fails, so the Account page's built-in presets
 * always keep working on their own.
 */
export async function fetchAssetManagerAvatars(): Promise<OmAvatarPreset[]> {
  try {
    const collectionsRes = await omApiFetch('/api/assets/collections?scope=public');
    const collectionsJson = await collectionsRes.json().catch(() => null);
    if (!collectionsRes.ok) return [];

    const collection = (collectionsJson?.collections || []).find(
      (c: { slug?: string }) => c.slug === AVATAR_COLLECTION_SLUG
    );
    if (!collection) return [];

    const assetsRes = await omApiFetch(`/api/assets?collection_id=${collection.id}`);
    const assetsJson = await assetsRes.json().catch(() => null);
    if (!assetsRes.ok) return [];

    return (assetsJson?.assets || [])
      .filter((a: { public_url?: string; internal_url?: string }) => a.public_url || a.internal_url)
      .map((a: { id: number; title?: string; display_name?: string; name: string; public_url?: string; internal_url?: string }) => ({
        id: `asset-${a.id}`,
        label: a.title || a.display_name || a.name,
        src: (a.public_url || a.internal_url) as string,
      }));
  } catch {
    return [];
  }
}
