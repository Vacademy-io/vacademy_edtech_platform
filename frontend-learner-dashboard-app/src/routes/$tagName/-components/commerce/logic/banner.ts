/**
 * The rotating banner's props (commerceBannerCarousel) read from page data. Pure: lazy.tsx
 * reads the same ratios to hold the banner's exact box while the shop's code loads, so the page
 * below never moves when the banner arrives.
 */
import { cta, isRecord, linkKind, str, type Cta } from './content';
import { DEFAULT_RATIO, phoneRatio, readRatio, slidesOnShow, type Ratio } from './banner-box';

export { ratioCss, type Ratio } from './banner-box';

/** Seconds a slide stays, by default and at the bounds. */
export const DEFAULT_INTERVAL_MS = 5000;
const MIN_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 15000;

const interval = (value: unknown, fallback: number): number => {
    const ms = Number(value);
    return Number.isFinite(ms) && ms > 0 ? Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.round(ms))) : fallback;
};

export interface BannerSlide {
    /** Desktop picture, base language. */
    image: string;
    /** Desktop picture for English visitors (the words are often in the picture); "" = `image`. */
    imageEn: string;
    /** Phone pictures (below 640px), base language and English; "" = the desktop one. */
    imageMobile: string;
    imageMobileEn: string;
    alt: string;
    headline: string;
    text: string;
    cta: Cta | null;
    /** Without a button, the whole slide links here. */
    route: string;
    textPosition: 'start' | 'center' | 'end';
    textTone: 'light' | 'dark';
}

export interface BannerSettings {
    slides: BannerSlide[];
    autoplay: boolean;
    intervalMs: number;
    /** Below 640px. */
    intervalMsPhone: number;
    transition: 'slide' | 'fade';
    transitionMs: number;
    pauseOnHover: boolean;
    showDots: boolean;
    showArrows: boolean;
    ratio: Ratio;
    ratioPhone: Ratio;
}

const picture = (value: unknown): string => {
    const src = str(value, 600);
    return /^https?:\/\//i.test(src) || (src.startsWith('/') && !src.startsWith('//')) ? src : '';
};

/** The settings, and the slides on show now (within their dates), at most 6. */
export const readBanner = (props: unknown, now = Date.now()): BannerSettings => {
    const p = isRecord(props) ? props : {};
    const slides = slidesOnShow(p, now)
        .map((s): BannerSlide => {
            const route = str(s.route, 600);
            const position = str(s.textPosition, 10);
            return {
                image: picture(s.image),
                imageEn: picture(s.imageEn),
                imageMobile: picture(s.imageMobile),
                imageMobileEn: picture(s.imageMobileEn),
                alt: str(s.alt, 200),
                headline: str(s.headline, 120),
                text: str(s.text, 300),
                cta: cta(s.cta),
                route: route && linkKind(route) !== 'invalid' ? route : '',
                textPosition: position === 'center' || position === 'end' ? position : 'start',
                textTone: s.textTone === 'dark' ? 'dark' : 'light',
            };
        });
    const desktop = interval(p.intervalMs, DEFAULT_INTERVAL_MS);
    const ms = Number(p.transitionMs);
    return {
        slides,
        autoplay: p.autoplay !== false,
        intervalMs: desktop,
        intervalMsPhone: interval(p.intervalMsPhone, desktop),
        transition: p.transition === 'fade' ? 'fade' : 'slide',
        transitionMs: Number.isFinite(ms) && ms >= 0 ? Math.min(1500, Math.round(ms)) : 500,
        pauseOnHover: p.pauseOnHover !== false,
        showDots: p.showDots !== false,
        showArrows: p.showArrows !== false,
        ratio: readRatio(p.ratio, DEFAULT_RATIO),
        // Never taller than 4:5 on a phone.
        ratioPhone: phoneRatio(p.ratioPhone),
    };
};

/** The pictures of a slide for a visitor's language: desktop and phone. */
export const slidePictures = (slide: BannerSlide, locale: string): { desktop: string; phone: string } => {
    const english = (locale || '').toLowerCase().startsWith('en');
    const desktop = (english && slide.imageEn) || slide.image;
    const phone = (english && (slide.imageMobileEn || (slide.imageEn ? '' : slide.imageMobile))) || (!english && slide.imageMobile) || '';
    return { desktop, phone: phone && phone !== desktop ? phone : '' };
};

/** The next slide's index, round the ring either way. */
export const stepIndex = (index: number, by: number, count: number): number => (count > 0 ? (((index + by) % count) + count) % count : 0);
