/**
 * One-sided copies scanned the wrong way up come out as a pile of empty pages:
 * the scanner read the blank side of every sheet. Spot that from the previews
 * before anything is uploaded, so the clerk turns the pile over at once instead
 * of waiting for the server to say no name was found.
 */

/** Below this share of dark pixels a preview counts as empty (ruled lines are light). */
export const EMPTY_DARK_SHARE = 0.002;
/** A pixel this dark or darker is ink (0-255 luminance); ruling and show-through are lighter. */
const DARK_LUMA = 110;
/** The pile looks the wrong way up when at least this share of its pages is empty. */
export const WRONG_SIDE_SHARE = 0.6;

/** Share of dark pixels in an image, or null when the browser cannot decode it here. */
export const darkShare = async (blob: Blob): Promise<number | null> => {
    try {
        if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
        const bitmap = await createImageBitmap(blob);
        const w = Math.max(1, Math.min(bitmap.width, 360));
        const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const { data } = ctx.getImageData(0, 0, w, h);
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) {
            const luma = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
            if (luma <= DARK_LUMA) dark++;
        }
        return dark / (w * h);
    } catch {
        return null;
    }
};

/**
 * True when most pages look empty. Unknown pages (not decodable here) never
 * count either way, and with no page measured the answer is false: the server's
 * own checks still catch a wrong pile.
 */
export const looksLikeWrongSide = (shares: (number | null)[]): boolean => {
    const known = shares.filter((s): s is number => s !== null);
    if (known.length === 0) return false;
    const empty = known.filter((s) => s < EMPTY_DARK_SHARE).length;
    return empty / known.length >= WRONG_SIDE_SHARE;
};

/** Which side of the pile this scanner reads, learned once per scanner in this browser. */
const faceKey = (scannerId: string) => `scanStation.readsFaceDown.${scannerId}`;

export const readsFaceDown = (scannerId: string): boolean => {
    try {
        return window.localStorage.getItem(faceKey(scannerId)) === '1';
    } catch {
        return false;
    }
};

export const rememberFaceDown = (scannerId: string, faceDown: boolean) => {
    try {
        if (faceDown) window.localStorage.setItem(faceKey(scannerId), '1');
        else window.localStorage.removeItem(faceKey(scannerId));
    } catch {
        // Storage blocked: the hint is shown again next time.
    }
};
