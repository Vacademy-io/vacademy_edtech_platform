/**
 * The news carousel's props (commerceNewsCarousel) read from page data. Pure and tolerant, like
 * the other content readers: a bad value takes its default, an item without a title or a link
 * is left out.
 *
 * Each card links to a page of the site (usually the news page at the item's anchor,
 * "news#<id>", where the full story is an ordinary authored section) or to an outside page.
 */
import { isRecord, linkKind, records, str } from './content';
import { withinDates } from './dates';

/** Card photo shapes; anything else is 4:3. */
export const NEWS_RATIOS = ['4:3', '3:2', '16:9', '1:1', '4:5'] as const;
export type NewsRatio = (typeof NEWS_RATIOS)[number];

export interface NewsItem {
    id: string;
    title: string;
    /** "2026-04-27" as written; the block formats it for the reader. */
    date: string;
    excerpt: string;
    image: string;
    imageAlt: string;
    /** "contain" shows the whole picture (a press clipping) on the card's own background. */
    imageFit: 'cover' | 'contain';
    /** CSS object-position ("50% 30%"); "" = centred. */
    imagePosition: string;
    /** A site address ("news#<id>") or an outside one (https://…). */
    route: string;
}

export interface NewsSettings {
    items: NewsItem[];
    /** Cards in view at once, by breakpoint. */
    perView: { phone: number; tablet: number; desktop: number };
    imageRatio: NewsRatio;
    showDate: boolean;
    /** Off unless the page turns it on; milliseconds between moves. */
    autoplay: boolean;
    intervalMs: number;
    pauseOnHover: boolean;
}

const picture = (value: unknown): string => {
    const src = str(value, 600);
    return /^https?:\/\//i.test(src) || (src.startsWith('/') && !src.startsWith('//')) ? src : '';
};

/** "50% 30%", "center top", "left": percentages and keywords only, so nothing else reaches CSS. */
const POSITION = /^(?:(?:\d{1,3}(?:\.\d+)?%|left|right|center|top|bottom)\s*){1,2}$/i;

const count = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 4 ? n : fallback;
};

export const DEFAULT_NEWS_INTERVAL_MS = 7000;

/** The block's settings and the items on show now (within their dates), at most 12. */
export const readNews = (props: unknown, now = Date.now()): NewsSettings => {
    const p = isRecord(props) ? props : {};
    const per = isRecord(p.perView) ? p.perView : {};
    const items = records(p.items, 24)
        .filter((item) => withinDates(now, str(item.startDate, 30), str(item.endDate, 30)))
        .map((item, i): NewsItem | null => {
            const title = str(item.title, 200);
            const route = str(item.route, 600);
            if (!title || !route || linkKind(route) === 'invalid' || linkKind(route) === 'anchor') return null;
            const position = str(item.imagePosition, 40);
            return {
                id: str(item.id, 80) || `item-${i}`,
                title,
                date: str(item.date, 30),
                excerpt: str(item.excerpt, 300),
                image: picture(item.image),
                imageAlt: str(item.imageAlt, 200),
                imageFit: item.imageFit === 'contain' ? 'contain' : 'cover',
                imagePosition: POSITION.test(position) ? position : '',
                route,
            };
        })
        .filter((item): item is NewsItem => !!item)
        .slice(0, 12);
    const ratio = str(p.imageRatio, 8);
    const interval = Number(p.intervalMs);
    return {
        items,
        perView: { phone: count(per.phone, 1), tablet: count(per.tablet, 2), desktop: count(per.desktop, 3) },
        imageRatio: (NEWS_RATIOS as readonly string[]).includes(ratio) ? (ratio as NewsRatio) : '4:3',
        showDate: p.showDate !== false,
        autoplay: p.autoplay === true,
        intervalMs: Number.isFinite(interval) && interval > 0 ? Math.max(3000, Math.min(20000, Math.round(interval))) : DEFAULT_NEWS_INTERVAL_MS,
        pauseOnHover: p.pauseOnHover !== false,
    };
};

/**
 * "27 अप्रैल 2026" / "27 April 2026" for an authored date in the visitor's language, Latin digits
 * in both; "" for a missing or unreadable date. A bare date is that day wherever the reader is.
 */
export const formatNewsDate = (value: string, locale: string): string => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
    const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(Date.parse(value || ''));
    if (!Number.isFinite(date.getTime())) return '';
    const lang = (locale || 'en').toLowerCase().split('-')[0] || 'en';
    try {
        return new Intl.DateTimeFormat(`${lang}-IN-u-nu-latn`, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    } catch {
        return '';
    }
};
