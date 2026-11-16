import type { MediaTagList } from '@/routes/commerce/-shared/catalogue-types';

/**
 * What a photo is, for the storefront (its "tag"). The list comes
 * from the institute's commerce setting through the server (`GET /media/tags`):
 * its own tags with the lead tag first. These constants are only what the
 * screen falls back to while that answer is not there, and the tags that have
 * a translated name; any other tag is shown as it is stored.
 */
export const MEDIA_TAGS = ['HERO', 'SWATCH', 'SIZE_CHART'] as const;
/** Tags with a name in the locale files. */
export const NAMED_MEDIA_TAGS = [...MEDIA_TAGS, 'REAL', 'RENDER'] as const;

/**
 * The tags to offer for one photo: the institute's list (or the fallback), plus
 * the tag the photo already carries when the list does not have it, so a tag
 * set by an import is kept and can be seen.
 */
export function offeredMediaTags(
    list: MediaTagList | undefined,
    current: string | null | undefined
): string[] {
    const tags = list && list.tags.length > 0 ? [...list.tags] : [...MEDIA_TAGS];
    if (current && !tags.includes(current)) tags.push(current);
    return tags;
}

/** The translated name of a tag, or the tag itself. */
export function mediaTagLabel(t: (key: string) => string, tag: string): string {
    return (NAMED_MEDIA_TAGS as readonly string[]).includes(tag)
        ? t(`products.media.tags.${tag}`)
        : tag;
}
