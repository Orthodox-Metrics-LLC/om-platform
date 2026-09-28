import { CONFIG } from 'src/global-config';

// ----------------------------------------------------------------------

/**
 * The Orthodox Metrics avatar presets a user can choose from. Selection is
 * persisted to `users.avatar_url` through `PUT /api/user/profile` — the URL is a
 * static asset path so it survives re-deploys and needs no upload pipeline.
 */
export type OmAvatarPreset = {
  id: 'female' | 'male-priest' | 'male-bishop' | 'monk-elder' | 'priest-kamilavka' | 'priest-fur-hat' | 'hierarch-elder';
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
