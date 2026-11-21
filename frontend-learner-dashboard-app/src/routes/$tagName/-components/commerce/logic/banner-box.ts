/**
 * The rotating banner's box (commerceBannerCarousel): its aspect ratios, which slides are on
 * show, and whether a row of dots sits under it. lazy.tsx draws this box while the shop's code
 * loads, so it lives outside the shop chunk: no imports but the date window, kept small.
 */
import { withinDates } from './date-window';

/** A width:height pair as written ("32:17", "4:5"). */
export interface Ratio {
    w: number;
    h: number;
}

export const DEFAULT_RATIO: Ratio = { w: 21, h: 9 };
/**
 * The phone box: 4:5 by default, and never taller than that, so a tall (9:16) phone picture
 * cannot push the products off the first screen; the picture fills the box (cropped, centred).
 */
export const DEFAULT_PHONE_RATIO: Ratio = { w: 4, h: 5 };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const readRatio = (value: unknown, fallback: Ratio): Ratio => {
    const match = /^(\d{1,3}):(\d{1,3})$/.exec(text(value));
    if (!match) return fallback;
    const w = Number(match[1]);
    const h = Number(match[2]);
    // Between 1:4 and 4:1: anything else is a typing slip.
    return w > 0 && h > 0 && w / h >= 0.25 && w / h <= 4 ? { w, h } : fallback;
};

/** The phone ratio as read, capped at 4:5. */
export const phoneRatio = (value: unknown): Ratio => {
    const ratio = readRatio(value, DEFAULT_PHONE_RATIO);
    return ratio.h / ratio.w > DEFAULT_PHONE_RATIO.h / DEFAULT_PHONE_RATIO.w ? DEFAULT_PHONE_RATIO : ratio;
};

/** "32 / 17", the CSS aspect-ratio value. */
export const ratioCss = (ratio: Ratio): string => `${ratio.w} / ${ratio.h}`;

/** An address the banner draws: http(s) or a site path. */
export const isBannerPicture = (src: string): boolean => /^https?:\/\//i.test(src) || (src.startsWith('/') && !src.startsWith('//'));

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The raw slides on show now: a picture, inside their dates, at most 6. */
export const slidesOnShow = (props: unknown, now: number): Record<string, unknown>[] => {
    const slides = isRecord(props) && Array.isArray(props.slides) ? props.slides : [];
    return slides
        .slice(0, 12)
        .filter(isRecord)
        .filter((s) => isBannerPicture(text(s.image).slice(0, 600)) && withinDates(now, text(s.startDate).slice(0, 30), text(s.endDate).slice(0, 30)))
        .slice(0, 6);
};

/** What the box needs at the first paint. */
export const bannerBox = (props: unknown, now = Date.now()) => {
    const p = isRecord(props) ? props : {};
    const slides = slidesOnShow(p, now).length;
    return {
        slides,
        ratio: readRatio(p.ratio, DEFAULT_RATIO),
        ratioPhone: phoneRatio(p.ratioPhone),
        // The row under the picture: dots, and the pause button while it moves by itself.
        bar: slides > 1 && (p.showDots !== false || p.autoplay !== false),
    };
};
