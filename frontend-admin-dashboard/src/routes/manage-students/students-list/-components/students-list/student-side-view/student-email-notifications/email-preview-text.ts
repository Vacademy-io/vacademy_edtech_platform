/**
 * Plain text out of a stored email's HTML, for one-line previews and, when a log row stored no
 * subject, the subject a resend falls back to.
 *
 * Regex only, never innerHTML on a temporary node: that would fetch linked images and widen the
 * XSS surface, and preview text does not need a real parser.
 */

/** Named entities that show up in real emails (MJML output, pasted Word text). */
const NAMED_ENTITIES: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    rsquo: '\u2019',
    lsquo: '\u2018',
    rdquo: '\u201D',
    ldquo: '\u201C',
    sbquo: '\u201A',
    bdquo: '\u201E',
    ndash: '\u2013',
    mdash: '\u2014',
    hellip: '\u2026',
    bull: '\u2022',
    middot: '\u00B7',
    copy: '\u00A9',
    reg: '\u00AE',
    trade: '\u2122',
    deg: '\u00B0',
    pound: '\u00A3',
    euro: '\u20AC',
    rarr: '\u2192',
    larr: '\u2190',
    zwnj: '\u200C',
    zwj: '\u200D',
};

const codePoint = (n: number): string => {
    try {
        return String.fromCodePoint(n);
    } catch {
        return '';
    }
};

export const decodeEntities = (text: string): string =>
    text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
        .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);

/**
 * Invisible characters email builders pad the hidden preheader with (MJML uses &#847; &zwnj;
 * &nbsp; runs) so inbox previews stop after it. Left in, they show as blank runs in our preview.
 */
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2060-\u2064\u3164\uFEFF\uFFA0]/g;

export const htmlToPreviewText = (html: string, maxLen = 140): string => {
    const stripped = html
        // Comments go first, whole. That includes the Outlook-only block MJML puts in <head>
        // (<!--[if mso]><xml><o:PixelsPerInch>96</o:PixelsPerInch>...<![endif]-->): stripping its
        // tags one by one left a stray "96" at the start of every preview.
        .replace(/<!--[\s\S]*?-->/g, ' ')
        // Nothing in <head> is message text (title, meta, styles, Outlook settings).
        .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
        // <style>/<script> outside <head> too, so their CSS/JS does not leak in.
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        // every remaining complete tag
        .replace(/<[^>]+>/g, ' ')
        // a dangling/unclosed tag: backend previews are often HTML cut mid-tag (e.g.
        // "<table align='center' width='600' style='...mar"), which has no closing ">"
        .replace(/<[^>]*$/g, ' ');
    const text = decodeEntities(stripped).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text;
};
