/**
 * Files the clerk added in this tab, by media file id, so thumbnails show at
 * once from disk instead of a round trip to storage. Lost on reload; the thumbs
 * then load from media.
 */
const files = new Map<string, File>();

export const rememberLocalFile = (fileId: string, file: File) => {
    files.set(fileId, file);
};

export const localFile = (fileId: string): File | undefined => files.get(fileId);
