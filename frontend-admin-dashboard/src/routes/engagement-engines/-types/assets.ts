export type AssetMediaType = 'document' | 'image' | 'video' | 'audio' | 'link';

/** A sendable item, as the create request carries it (and as the live endpoints accept it). */
export interface AssetRequest {
    title: string;
    description?: string;
    mediaType: AssetMediaType;
    url: string;
    fileId?: string;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
}

export interface EngineAsset extends AssetRequest {
    id: string;
}

/** An item in the panel: saved ones have an id, ones collected before the engine exists have a local key. */
export type AssetDraftItem = AssetRequest & { key: string; id?: string };

export const ASSETS_MAX_ITEMS = 50;
export const ASSETS_TITLE_MAX = 200;
export const ASSETS_DESCRIPTION_MAX = 1000;

const MB = 1024 * 1024;

/** WhatsApp's media size limits, per kind. */
export const ASSETS_SIZE_LIMITS: Record<Exclude<AssetMediaType, 'link'>, number> = {
    image: 5 * MB,
    document: 100 * MB,
    video: 16 * MB,
    audio: 16 * MB,
};

/** Maps a file's MIME type to a assets kind; null when WhatsApp cannot send it. */
export function mediaTypeFromMime(
    mime: string | undefined | null
): Exclude<AssetMediaType, 'link'> | null {
    const m = (mime ?? '').toLowerCase().trim();
    if (!m) return null;
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    if (
        m === 'application/pdf' ||
        m === 'text/plain' ||
        m === 'text/csv' ||
        m.startsWith('application/vnd.ms-') ||
        m.startsWith('application/vnd.openxmlformats-officedocument.') ||
        m === 'application/msword'
    ) {
        return 'document';
    }
    return null;
}

export type FileCheck =
    | { ok: true; mediaType: Exclude<AssetMediaType, 'link'> }
    | { ok: false; reason: 'unsupported' }
    | {
          ok: false;
          reason: 'tooLarge';
          mediaType: Exclude<AssetMediaType, 'link'>;
          limitMb: number;
      };

export function checkAssetsFile(file: { type: string; size: number }): FileCheck {
    const mediaType = mediaTypeFromMime(file.type);
    if (!mediaType) return { ok: false, reason: 'unsupported' };
    const limit = ASSETS_SIZE_LIMITS[mediaType];
    if (file.size > limit) return { ok: false, reason: 'tooLarge', mediaType, limitMb: limit / MB };
    return { ok: true, mediaType };
}

export function isHttpsUrl(value: string): boolean {
    const v = value.trim();
    if (!v.toLowerCase().startsWith('https://')) return false;
    try {
        return !!new URL(v).hostname;
    } catch {
        return false;
    }
}

export function formatBytes(bytes: number | undefined | null): string {
    if (!bytes || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / MB).toFixed(1)} MB`;
}

/** The request body for an item: drops the local-only fields and trims text. */
export function toAssetRequest(item: AssetDraftItem): AssetRequest {
    return {
        title: item.title.trim(),
        description: item.description?.trim() || undefined,
        mediaType: item.mediaType,
        url: item.url.trim(),
        fileId: item.fileId,
        filename: item.filename,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
    };
}
