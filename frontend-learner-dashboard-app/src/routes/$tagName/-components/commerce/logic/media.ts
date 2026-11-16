/**
 * Gallery order and responsive image sources. The API lists
 * fixed renditions (WebP, 320 to 1600 px wide) with the stored width and height; nothing is
 * resized in the browser or at the edge.
 */
import type { Media } from '../api/types';
import type { CommerceImageRatio } from '../config';

/** `sizes` per slot: what share of the viewport an image fills. */
export const IMAGE_SIZES = {
    /** Two columns on a phone, three on a tablet, four on a desktop. */
    card: '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw',
    /** Full width on a phone, about half the page on a desktop. */
    gallery: '(min-width: 1024px) 50vw, 100vw',
    thumb: '80px',
    rail: '(min-width: 1024px) 20vw, (min-width: 640px) 30vw, 45vw',
    zoom: '100vw',
} as const;

/** The widest rendition the media service stores. */
export const MAX_SERVED_WIDTH = 1600;

const isImage = (media: Media): boolean => (media.kind || 'IMAGE').toUpperCase() === 'IMAGE';

export interface ImageSource {
    src: string;
    srcSet: string | undefined;
    width: number | undefined;
    height: number | undefined;
}

/**
 * src + srcset of one image. Renditions are listed by width; the original is the fallback
 * `src` and is added to the set only when its width is known and larger than every rendition.
 */
export const imageSource = (media: Media | null | undefined): ImageSource | null => {
    if (!media || !media.url) return null;
    const renditions = (media.renditions || [])
        .filter((r): r is { width: number; url: string } => !!r && !!r.url && typeof r.width === 'number' && r.width > 0)
        .sort((a, b) => a.width - b.width);
    const unique = renditions.filter((r, i) => i === 0 || r.width !== renditions[i - 1]!.width);
    const entries = unique.map((r) => `${r.url} ${r.width}w`);
    const widest = unique.length ? unique[unique.length - 1]!.width : 0;
    // The original joins the set only when the renditions stop short of the largest size the
    // shop serves: past that it is a multi-megabyte upload nobody should download.
    if (unique.length && widest < MAX_SERVED_WIDTH && typeof media.width === 'number' && media.width > widest) {
        entries.push(`${media.url} ${media.width}w`);
    }
    // A middle rendition as `src`: what a browser without srcset support, or a crawler, loads.
    const fallback = unique.find((r) => r.width >= 640) ?? unique[unique.length - 1];
    return {
        src: fallback ? fallback.url : media.url,
        srcSet: entries.length > 1 ? entries.join(', ') : undefined,
        width: typeof media.width === 'number' && media.width > 0 ? media.width : undefined,
        height: typeof media.height === 'number' && media.height > 0 ? media.height : undefined,
    };
};

/** The largest source of an image, for the zoom view: the widest rendition, never a huge original. */
export const largestSource = (media: Media): string => {
    const widest = (media.renditions || [])
        .filter((r) => !!r && !!r.url && typeof r.width === 'number')
        .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    if (widest && ((widest.width || 0) >= MAX_SERVED_WIDTH || (typeof media.width === 'number' && (widest.width || 0) >= media.width))) {
        return widest.url || media.url || '';
    }
    return media.url || widest?.url || '';
};

const tagOf = (media: Media): string => (media.tag || '').trim().toUpperCase();

/**
 * The gallery in display order:
 *  1. pictures of the picked variant first (when one is picked and has pictures);
 *  2. with a lead tag set, an image carrying it is first and an image with ANOTHER tag is
 *     never first (it moves behind the first untagged or lead image);
 *  3. otherwise the stored position.
 * Videos keep their place after the images.
 */
export const orderGallery = (media: readonly Media[], leadTag: string, variantId?: string | null): Media[] => {
    const lead = (leadTag || '').trim().toUpperCase();
    const sorted = [...media].filter((m) => !!m && !!m.url).sort((a, b) => a.position - b.position);
    const images = sorted.filter(isImage);
    const videos = sorted.filter((m) => !isImage(m));
    const ofVariant = variantId ? images.filter((m) => m.variant_id === variantId) : [];
    const pool = ofVariant.length
        ? [...ofVariant, ...images.filter((m) => m.variant_id !== variantId)]
        : images.filter((m) => !m.variant_id).concat(images.filter((m) => !!m.variant_id));
    if (lead && pool.length > 1) {
        const rank = (m: Media): number => {
            const tag = tagOf(m);
            if (tag === lead) return 0;
            return tag ? 2 : 1;
        };
        const first = pool.reduce((best, m) => (rank(m) < rank(best) ? m : best), pool[0]!);
        if (first !== pool[0]) {
            pool.splice(pool.indexOf(first), 1);
            pool.unshift(first);
        }
    }
    return [...pool, ...videos];
};

/**
 * The chip an image carries: the label of its tag when it is not the lead tag ("Styled
 * render"). An image with the lead tag, or without a tag, carries none.
 */
export const mediaChip = (media: Media, leadTag: string, labels: Record<string, string>): string | null => {
    const tag = tagOf(media);
    if (!tag || tag === (leadTag || '').trim().toUpperCase()) return null;
    return labels[tag] || null;
};

export const ratioClass = (ratio: CommerceImageRatio): string =>
    ratio === '1:1' ? 'cmx-ratio-1-1' : ratio === '3:4' ? 'cmx-ratio-3-4' : 'cmx-ratio-4-5';

/** The smallest stored source of an image, for a cart line or a suggestion row. */
export const thumbUrl = (media: Media | null | undefined): string | null => {
    if (!media) return null;
    const smallest = (media.renditions || [])
        .filter((r) => !!r && !!r.url && typeof r.width === 'number' && r.width > 0)
        .sort((a, b) => (a.width || 0) - (b.width || 0))[0];
    return smallest?.url || media.url || null;
};
