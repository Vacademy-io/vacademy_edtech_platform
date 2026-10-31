/**
 * `{{course.*}}` tokens for HTML pages rendered on a course details route.
 *
 * The typed heroSection can read course fields (it resolves "package_name"
 * style placeholders), but a pasted HTML page could not — so one designed
 * course template could never serve every course. These tokens close that
 * gap: the `details` page of a catalogue can be an htmlPage with
 * `{{course.title}}`, `{{course.price}}`, `{{course.image}}` … and the same
 * markup renders for each course.
 *
 * Text tokens are HTML-escaped; `*_html` tokens are the course's own rich
 * text and are inserted raw — the whole page still goes through the sanitiser
 * afterwards, so they cannot carry scripts. Unknown tokens render as ''.
 * Image tokens hold media ids until the host resolves them (see
 * courseTokenMediaKeys / resolveCourseMedia in HtmlPageSection).
 */

export const COURSE_TOKEN_RE = /\{\{\s*course\.([a-z_]+)\s*\}\}/g;
/** `{{#course.mrp}} … {{/course.mrp}}` — the block stays only when the token is non-empty. */
export const COURSE_BLOCK_RE = /\{\{#\s*course\.([a-z_]+)\s*\}\}([\s\S]*?)\{\{\/\s*course\.\1\s*\}\}/g;

/** Tokens whose value is a media id/URL the host must resolve before render. */
export const COURSE_MEDIA_TOKENS = ['image', 'banner', 'thumbnail'] as const;

const RAW_HTML_TOKENS = new Set(['description_html', 'about_html', 'why_html', 'who_html']);

const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ' };

const formatMoney = (amount: number | undefined | null, currency: string | undefined): string => {
    if (amount === undefined || amount === null || Number.isNaN(Number(amount))) return '';
    const n = Number(amount);
    const sym = CURRENCY_SYMBOL[(currency || 'INR').toUpperCase()] ?? `${(currency || '').toUpperCase()} `;
    const body = Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sym}${body}`;
};

/** The subset of CourseDetailsPage's courseData these tokens read. */
export interface CourseTokenSource {
    courseId?: string;
    title?: string;
    fullDescription?: string;
    about_the_course_html?: string;
    aboutCourse?: string | null;
    whyLearn?: string;
    whoShouldLearn?: string;
    price?: number;
    elevatedPrice?: number;
    currency?: string;
    duration?: string | null;
    level?: string;
    instructor?: string | null;
    rating?: number;
    tags?: string[];
    previewImage?: string;
    bannerImage?: string;
    thumbnail?: string;
}

const isPlaceholder = (v: string | undefined): boolean => !v || v.startsWith('/api/placeholder/') || v === 'null';

/** Build the token → value map. Media tokens carry the raw id/URL from courseData. */
export const buildCourseTokens = (c: CourseTokenSource): Record<string, string> => {
    const price = c.price;
    const mrp = c.elevatedPrice && c.price !== undefined && c.elevatedPrice > c.price ? c.elevatedPrice : undefined;
    const discount = mrp ? Math.round(((mrp - (price ?? 0)) / mrp) * 100) : undefined;
    return {
        id: c.courseId || '',
        title: c.title || '',
        description_html: c.about_the_course_html || c.fullDescription || '',
        about_html: c.aboutCourse || '',
        why_html: c.whyLearn || '',
        who_html: c.whoShouldLearn || '',
        // A missing/zero price means "not known here" (the invite fetch did not run,
        // e.g. a search-engine visitor without enrollInviteId) — render nothing rather than "$0".
        price: price && price > 0 ? formatMoney(price, c.currency) : '',
        mrp: formatMoney(mrp, c.currency),
        discount: discount && discount > 0 ? String(discount) : '',
        duration: c.duration || '',
        level: c.level || '',
        instructor: c.instructor || '',
        rating: c.rating ? String(c.rating) : '',
        tags: (c.tags || []).join(', '),
        image: isPlaceholder(c.previewImage) ? (isPlaceholder(c.thumbnail) ? '' : c.thumbnail!) : c.previewImage!,
        banner: isPlaceholder(c.bannerImage) ? '' : c.bannerImage!,
        thumbnail: isPlaceholder(c.thumbnail) ? '' : c.thumbnail!,
    };
};

/** Media tokens actually used by this html — only those need a media-service round trip. */
export const courseTokenMediaKeys = (html: string): string[] => {
    const used = new Set<string>();
    for (const m of html.matchAll(COURSE_TOKEN_RE)) {
        if ((COURSE_MEDIA_TOKENS as readonly string[]).includes(m[1])) used.add(m[1]);
    }
    return [...used];
};

/** Resolve conditional blocks, then replace every `{{course.x}}`; text escaped, *_html raw, unknown → ''. */
export const applyCourseTokens = (html: string, tokens: Record<string, string>): string =>
    html
        .replace(COURSE_BLOCK_RE, (_m, key: string, body: string) => (tokens[key] ? body : ''))
        .replace(COURSE_TOKEN_RE, (_m, key: string) => {
            const v = tokens[key] ?? '';
            return RAW_HTML_TOKENS.has(key) ? v : escapeHtml(v);
        });
