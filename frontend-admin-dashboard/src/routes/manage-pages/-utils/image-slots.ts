/**
 * Image slots: what an image field in the page editor is FOR, so the upload
 * can be cropped to the shape the site shows, kept small enough to load fast,
 * and checked before it goes live.
 *
 * A field names its slot (`<ImageUploadField slot="card" />`); everything the
 * field does with the picked file — the cropper's suggested shape, the size
 * hint, the resize and the warnings — reads from this one table. A new kind of
 * image is one entry here, not a change to the field.
 *
 * The site never relies on the crop: it fills a box with an image of about the
 * box's shape and shows any other image whole (learner FitImage). The crop is
 * the admin's chance to choose what shows; the rules below only advise.
 */

export type ImageSlotId =
    | 'card'
    | 'gallery'
    | 'square'
    | 'portrait'
    | 'background'
    | 'social'
    | 'logo'
    | 'avatar'
    | 'free';

export interface ImageSlot {
    id: ImageSlotId;
    /** Width / height the site shows it at; null = any shape. */
    aspect: number | null;
    /** "16:9" — how the shape is named to the admin. */
    aspectLabel?: string;
    /** The size to aim for, in px (2× the largest the site draws it). */
    recommended: { width: number; height?: number };
    /** Narrower than this looks soft where the site shows it. */
    minWidth: number;
    /** Longer edge an upload is scaled down to; never scaled up. */
    maxEdge: number;
    /** Logos: shown on the site's light and dark surfaces, transparency kept. */
    logo?: boolean;
}

export const IMAGE_SLOTS: Record<ImageSlotId, ImageSlot> = {
    // Course, folder, blog and feature cards; a video poster.
    card: { id: 'card', aspect: 16 / 9, aspectLabel: '16:9', recommended: { width: 1280, height: 720 }, minWidth: 640, maxEdge: 1920 },
    // Gallery photos and document covers (4:3 tiles).
    gallery: { id: 'gallery', aspect: 4 / 3, aspectLabel: '4:3', recommended: { width: 1200, height: 900 }, minWidth: 600, maxEdge: 1600 },
    square: { id: 'square', aspect: 1, aspectLabel: '1:1', recommended: { width: 800, height: 800 }, minWidth: 300, maxEdge: 1200 },
    portrait: { id: 'portrait', aspect: 3 / 4, aspectLabel: '3:4', recommended: { width: 900, height: 1200 }, minWidth: 450, maxEdge: 1600 },
    // Full-width section backgrounds: any height, so any crop is the admin's call.
    background: { id: 'background', aspect: null, recommended: { width: 1920, height: 1080 }, minWidth: 1280, maxEdge: 2560 },
    // Link previews (WhatsApp, LinkedIn, X): 1.91:1.
    social: { id: 'social', aspect: 1200 / 630, aspectLabel: '1.91:1', recommended: { width: 1200, height: 630 }, minWidth: 600, maxEdge: 1200 },
    logo: { id: 'logo', aspect: null, recommended: { width: 400 }, minWidth: 120, maxEdge: 800, logo: true },
    avatar: { id: 'avatar', aspect: 1, aspectLabel: '1:1', recommended: { width: 400, height: 400 }, minWidth: 120, maxEdge: 600 },
    free: { id: 'free', aspect: null, recommended: { width: 1600 }, minWidth: 600, maxEdge: 2400 },
};

export const slotOf = (slot: ImageSlotId | ImageSlot | undefined): ImageSlot =>
    typeof slot === 'object' && slot ? slot : IMAGE_SLOTS[slot ?? 'free'] ?? IMAGE_SLOTS.free;

export interface Size {
    width: number;
    height: number;
}

/** "Best: 1280 × 720 px (16:9)" — the hint under the field. */
export const slotHint = (slot: ImageSlot): string => {
    const { width, height } = slot.recommended;
    const size = height ? `${width} × ${height} px` : `at least ${width} px wide`;
    if (slot.logo) return `Best: ${size}, PNG or SVG with a transparent background`;
    return `Best: ${size}${slot.aspectLabel ? ` (${slot.aspectLabel})` : ''}`;
};

/** The share of an image (0..1) that filling the slot's shape would cut off. */
export const cropShare = (image: Size, aspect: number): number => {
    const ri = image.width / image.height;
    return 1 - Math.min(ri, aspect) / Math.max(ri, aspect);
};

/** The site's own threshold (learner fit-mode): past it, an image is shown whole. */
export const SITE_MAX_CROP = 0.3;

export type ImageAdvice =
    | { kind: 'lowRes'; message: string }
    | { kind: 'shape'; message: string };

const shapeName = (s: Size) => {
    const r = s.width / s.height;
    if (r > 1.15) return 'wide';
    if (r < 0.87) return 'tall';
    return 'square';
};

/**
 * What to tell the admin about an image in this slot. Advice only: nothing is
 * blocked, since the site shows any image well (see the header comment).
 */
export const imageAdvice = (image: Size | null | undefined, slot: ImageSlot): ImageAdvice[] => {
    if (!image || !(image.width > 0 && image.height > 0)) return [];
    const out: ImageAdvice[] = [];
    if (image.width < slot.minWidth) {
        out.push({
            kind: 'lowRes',
            message: `This image is ${image.width} × ${image.height} px and may look blurry here. ${slotHint(slot)}.`,
        });
    }
    if (slot.aspect && cropShare(image, slot.aspect) > SITE_MAX_CROP) {
        out.push({
            kind: 'shape',
            message: `This image is ${shapeName(image)}, and this spot shows ${slot.aspectLabel}. The site will show it whole on a soft blurred background; crop it to ${slot.aspectLabel} to fill the space instead.`,
        });
    }
    return out;
};

/** Types the browser cannot re-encode without losing something (vector, animation). */
const KEEP_AS_IS = new Set(['image/svg+xml', 'image/gif']);
/** A file this small and within the size limit is uploaded untouched. */
export const SMALL_FILE_BYTES = 600 * 1024;

export interface PrepPlan {
    /** Upload the original file, byte for byte. */
    keepOriginal: boolean;
    /** Scale to this size (never larger than the source). */
    width: number;
    height: number;
}

/**
 * What the upload does with a file that was NOT cropped: nothing when it is
 * already fine (or cannot be re-encoded safely), else scaled down to the
 * slot's longer edge. A cropped image is always encoded (it is a new image).
 */
export const prepPlan = (file: { type: string; size: number }, image: Size, slot: ImageSlot): PrepPlan => {
    const longest = Math.max(image.width, image.height);
    const scale = longest > slot.maxEdge ? slot.maxEdge / longest : 1;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const keepOriginal =
        KEEP_AS_IS.has(file.type) || !file.type.startsWith('image/') || (scale === 1 && file.size <= SMALL_FILE_BYTES);
    return { keepOriginal, width, height };
};

/** Scaled size for a cropped image (its own pixels, capped at the slot's edge). */
export const fitWithin = (image: Size, maxEdge: number): Size => {
    const longest = Math.max(image.width, image.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    return {
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale)),
    };
};

/** Types the cropper can open (the browser decodes them to pixels). */
export const canCrop = (type: string): boolean => type.startsWith('image/') && !KEEP_AS_IS.has(type);
