/** Centralized archive limits. MiB/GiB are binary units, not decimal MB/GB. */
export const MIB = 1024 * 1024;
export const MAX_IMAGE_BYTES = 45 * MIB;
export const MAX_IMAGE_PIXELS = 60_000_000;
export const MAX_BOOK_SOURCE_BYTES = 1024 * MIB;
export const MAX_ARCHIVE_BYTES = 1152 * MIB; // Space for text, annotations and ZIP headers.
export const MAX_MANIFEST_BYTES = 40 * MIB;
export const MAX_LEGACY_COMPRESSED_BYTES = 350 * MIB;
export const ARCHIVE_READ_CHUNK_BYTES = MIB;
export function formatBytes(bytes: number): string {
    return bytes >= 1024 * MIB ? `${(bytes / (1024 * MIB)).toFixed(2)} GiB` : `${(bytes / MIB).toFixed(1)} MiB`;
}
export const IMPORT_LIMITS_LABEL = '45 MiB / 60 MP per image · Full-book backup/restore: up to 1 GiB of source images. Folder import depends on available browser storage.';
