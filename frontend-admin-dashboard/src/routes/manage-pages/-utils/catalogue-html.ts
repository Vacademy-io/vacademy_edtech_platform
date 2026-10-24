/**
 * Custom-HTML section ("htmlBlock") safety layer — SHARED between the admin
 * page-builder and the learner renderer (kept byte-identical by
 * scripts/check-style-engine-sync.mjs).
 *
 * htmlBlock is the page-builder's governed escape hatch: AI (or an admin)
 * supplies free-form HTML + CSS for bespoke sections the typed component
 * catalog can't express. Safety model, in order:
 *   1. ai_service sanitizes AI-emitted html/css server-side (nh3 + CSS scrub).
 *   2. This module re-sanitizes at render time (DOMPurify + the same CSS
 *      scrub) — defense in depth, and the ONLY line of defense for HTML an
 *      admin pastes by hand (that path never crosses ai_service).
 *   3. The markup renders inside a shadow root on a `.catalogue-html-section`
 *      host (transform + overflow:clip), so custom CSS cannot leak out and
 *      position:fixed cannot escape the section to overlay the page.
 *
 * Theme integration: CSS custom properties inherit through shadow boundaries,
 * so sections style themselves with var(--primary-*), var(--catalogue-*) and
 * var(--catalogue-heading-font) and stay re-themeable like typed components.
 */
import DOMPurify from 'dompurify';

/** Structural/text tags only — no script/style/iframe/svg/media/form inputs.
 *
 *  del/ins/strike are here for one reason: a struck-through original price is
 *  the single most common thing a marketing page needs, and `<del>` is what
 *  every author (human or AI) writes for it. Leaving it out did not fail
 *  loudly — DOMPurify keeps the CHILDREN of a disallowed tag, so
 *  `<del>₹1,599</del>` rendered as bare `₹1,599`, and the `.price del { … }`
 *  rule in the same blob matched nothing. The page looked like it had simply
 *  ignored the edit, so it got "fixed" by hand over and over. They are
 *  presentational text-level elements with no scripting surface; their `cite`
 *  attribute is deliberately NOT allowed (it is a URL). */
const ALLOWED_TAGS = [
    'a', 'article', 'aside', 'b', 'blockquote', 'br', 'button', 'caption',
    'cite', 'code', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption',
    'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
    'i', 'img', 'ins', 'li', 'mark', 'nav', 'ol', 'p', 'pre', 's', 'section',
    'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
    'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul',
];

const ALLOWED_ATTR = [
    'class', 'id', 'style', 'title', 'role', 'aria-label', 'aria-hidden',
    'href', 'target', 'rel',
    'src', 'alt', 'width', 'height', 'loading',
    'datetime', 'colspan', 'rowspan', 'scope',
];

/* ─── Page mode ──────────────────────────────────────────────────────────
   A whole page pasted from ChatGPT/Claude needs more room and more tags than a
   bespoke SECTION does, so page mode widens three things and nothing else:
   SVG (AI-authored pages are full of inline icons), the action-hook data
   attributes, and the size caps. Scripts, forms and iframes stay out. */
const SVG_TAGS = [
    'svg', 'path', 'g', 'defs', 'circle', 'ellipse', 'rect', 'line', 'polyline',
    'polygon', 'text', 'tspan', 'title', 'desc', 'use', 'symbol', 'mask',
    'clipPath', 'linearGradient', 'radialGradient', 'stop', 'pattern',
];
const SVG_ATTR = [
    'viewBox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
    'stroke-linejoin', 'stroke-dasharray', 'cx', 'cy', 'r', 'rx', 'ry',
    'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'opacity',
    'fill-opacity', 'stroke-opacity', 'offset', 'stop-color', 'stop-opacity',
    'gradientUnits', 'xmlns', 'preserveAspectRatio', 'fill-rule', 'clip-rule',
    'text-anchor',
];
/** Action hooks. DOMPurify runs with ALLOW_DATA_ATTR:false, so these must be
 *  named explicitly — without that the server-side rewrite survives nh3 and is
 *  then stripped here, and every hook silently stops working. */
const HOOK_ATTR = [
    'data-vacademy', 'data-route', 'data-target', 'data-href',
    'data-audience', 'data-course',
    // data-vacademy="video" placeholder → PlainVideoPlayer (see collectVideoMounts)
    'data-src', 'data-poster', 'data-aspect',
];
const MAX_PAGE_HTML = 200000;
const MAX_PAGE_CSS = 150000;

/** Hosts whose assets may be referenced from custom CSS (fonts, backgrounds).
 *  url() is otherwise stripped: an arbitrary host in a stylesheet leaks every
 *  visitor's IP to it and is a standard exfiltration channel.
 *
 *  Pinned to OUR buckets, not to the providers. A first cut allowed any
 *  *.amazonaws.com / *.cloudfront.net, which anyone can register a subdomain
 *  of — evil-bucket.s3.amazonaws.com passed. That reopened the exact channel
 *  the rule exists to close. */
const MEDIA_HOST_RE =
    /^https:\/\/(([a-z0-9-]+\.)*vacademy\.io|vacademy-media-storage-public\.s3\.amazonaws\.com|d1om4dxj9e7kkd\.cloudfront\.net)\//i;

/** True for an asset on our own media hosts (the same allowlist CSS url() uses). */
export const isOwnMediaUrl = (url: string): boolean => MEDIA_HOST_RE.test(url || '');

const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
// The WHOLE statement, not just the keyword. Removing only `@import` left
// ` "tailwindcss";` behind, and CSS error recovery treats that junk as the
// prelude of a rule — consuming everything up to the NEXT {...} block and
// dropping it. On a real imported page the next block was the :host variable
// palette, so one ghost token silently deleted every colour on the page.
// Found by reading the parsed CSSOM over CDP: the rule was in textContent
// and absent from sheet.cssRules.
const CSS_IMPORT_STMT_RE = /@import\b[^;]*(;|$)/gi;
const CSS_URL_RE = /url\s*\([^)]*\)/gi;
// `behavior:` targets the legacy IE binding property. Without a boundary it
// also matches INSIDE scroll-behavior, overscroll-behavior and
// transition-behavior, truncating them to `scroll- smooth` — caught by
// simulating a real page's CSS, where it silently killed smooth scrolling.
const CSS_BANNED_RE = /@import\b|expression\s*\(|(?<![\w-])behavior\s*:|-moz-binding|javascript\s*:/gi;
const MAX_HTML = 30000;
const MAX_CSS = 20000;

/**
 * Scrub a custom-CSS blob: no imports, no url() (assets belong in <img> tags
 * with vetted URLs), no legacy script vectors, and no `</` so the blob cannot
 * break out of the <style> tag it is injected into.
 */
export const scrubCss = (css: string, page = false): string =>
    css
        .slice(0, page ? MAX_PAGE_CSS : MAX_CSS)
        .replace(CSS_COMMENT_RE, '')
        .replace(CSS_IMPORT_STMT_RE, '')
        // :root, html and body cannot match inside a shadow root: the first two
        // select the document element and the third does not exist there at
        // all — the content sits directly under the root. A pasted page uses
        // all three for exactly the things you notice when they are missing.
        // The real bundle we imported put 17 custom properties on :root (read
        // by 257 rules) and its page background, text colour and base font on
        // `body`. Rewriting :root alone restored the VARIABLES while the rule
        // that USED them still matched nothing, so the page stayed grey.
        // :host is the shadow equivalent of all three.
        //
        // Page mode only — an existing htmlBlock carrying dead :root/body
        // rules should not suddenly start applying them to a published page.
        .replace(page ? /(^|[\s,{}])\:root\b/g : /(?!)/g, '$1:host')
        .replace(page ? /(^|[\s,{}>+~])(?:html|body)\b/g : /(?!)/g, '$1:host')
        // Keep url() when it points at our own media (an uploaded @font-face
        // or background); strip every other host. Blanket stripping meant a
        // pasted page always lost its custom fonts.
        .replace(CSS_URL_RE, (m) => {
            const inner = m.slice(m.indexOf('(') + 1, m.lastIndexOf(')')).trim().replace(/^['"]|['"]$/g, '');
            return MEDIA_HOST_RE.test(inner) ? `url('${inner}')` : 'none';
        })
        .replace(CSS_BANNED_RE, '')
        .replace(/<\//g, ' ');

export const sanitizeCustomHtml = (html: string, page = false): string =>
    DOMPurify.sanitize(html.slice(0, page ? MAX_PAGE_HTML : MAX_HTML), {
        ALLOWED_TAGS: page ? [...ALLOWED_TAGS, ...SVG_TAGS] : ALLOWED_TAGS,
        ALLOWED_ATTR: page ? [...ALLOWED_ATTR, ...SVG_ATTR, ...HOOK_ATTR] : [...ALLOWED_ATTR, ...HOOK_ATTR],
        ALLOW_DATA_ATTR: false,
    });

/**
 * Render a custom-HTML section into `host`'s shadow root (created on first
 * call). Both renderers call this from an effect keyed on html/css.
 */
export const renderHtmlSection = (host: HTMLElement, html: string, css: string): void => {
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    root.innerHTML =
        `<style>:host{display:block;font-family:inherit;color:inherit;}` +
        `${scrubCss(css || '')}</style>${sanitizeCustomHtml(html || '')}`;
};

/* ─── Action hooks ───────────────────────────────────────────────────────── */

export type HtmlAction =
    | { kind: 'route'; route: string }
    | { kind: 'scroll'; target: string }
    | { kind: 'lead-form'; audienceId?: string }
    | { kind: 'enrol'; courseId?: string }
    | { kind: 'link'; href: string };

export interface HtmlPageOptions {
    /** Site-wide CSS injected ahead of the page's own. Shadow roots inherit
     *  custom properties but NOT stylesheets, so a shared sheet has to be
     *  pushed into every root rather than linked once in <head>. */
    siteCss?: string;
    /** Called for every hook click. The host app owns navigation, so this
     *  module stays framework-free and byte-syncable across both apps. */
    onAction?: (action: HtmlAction) => void;
}

/**
 * Bind the action hooks inside a shadow root.
 *
 * Pasted markup cannot navigate on its own: scripts are stripped, a raw href
 * escapes the site's routing, and `#anchor` does nothing because fragment
 * navigation cannot resolve ids inside a shadow root. One delegated listener
 * on the root fixes all three — composedPath() sees through the boundary, so a
 * click on an icon inside a button still finds the hook.
 */
export const bindHtmlActions = (
    root: ShadowRoot,
    onAction?: (action: HtmlAction) => void
): (() => void) => {
    const handler = (event: Event) => {
        const path = (event as MouseEvent).composedPath?.() ?? [];
        let el: HTMLElement | null = null;
        for (const node of path) {
            if (node instanceof HTMLElement && node.hasAttribute?.('data-vacademy')) {
                el = node;
                break;
            }
        }
        if (!el) return;
        const verb = el.getAttribute('data-vacademy');
        // Scroll is handled here rather than by the host: only this module can
        // see inside the shadow root to find the target.
        if (verb === 'scroll') {
            event.preventDefault();
            const id = el.getAttribute('data-target') || '';
            const found = id ? root.getElementById(id) : null;
            found?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (found) onAction?.({ kind: 'scroll', target: id });
            return;
        }
        if (verb === 'route') {
            event.preventDefault();
            onAction?.({ kind: 'route', route: el.getAttribute('data-route') || '' });
            return;
        }
        if (verb === 'lead-form') {
            event.preventDefault();
            onAction?.({ kind: 'lead-form', audienceId: el.getAttribute('data-audience') || undefined });
            return;
        }
        if (verb === 'enrol') {
            event.preventDefault();
            onAction?.({ kind: 'enrol', courseId: el.getAttribute('data-course') || undefined });
            return;
        }
        if (verb === 'link') {
            const href = el.getAttribute('data-href') || '';
            if (/^https:\/\//i.test(href)) {
                event.preventDefault();
                onAction?.({ kind: 'link', href });
            }
        }
    };
    root.addEventListener('click', handler);
    return () => root.removeEventListener('click', handler);
};

/* ─── Video placeholders ─────────────────────────────────────────────────── */

/**
 * `<video>` is not in the allowlist (a raw tag gives the visitor the browser's
 * stock controls, download menu included, and lets markup pull media from any
 * host). Pasted pages instead mark a spot for the site's own play/pause-only
 * player:
 *
 *   <div data-vacademy="video" data-src="https://<our cdn>/clip.mp4"
 *        data-poster="https://<our cdn>/clip.jpg" data-aspect="9:16"
 *        aria-label="Aptitude session"></div>
 *
 * The host app mounts a player into each placeholder. Both URLs must be on
 * our media hosts (same rule as CSS url()); anything else is skipped, so the
 * placeholder simply stays empty. Children are left alone here — an author
 * can put a poster <img> inside as the preview/fallback and the host app
 * decides whether to clear it.
 */
export interface HtmlVideoMount {
    el: HTMLElement;
    src: string;
    poster?: string;
    /** padding-bottom percentage for the aspect box, e.g. "56.25%" */
    paddingBottom: string;
    title?: string;
}

const VIDEO_ASPECT_PADDING: Record<string, string> = {
    '16:9': '56.25%', '4:3': '75%', '1:1': '100%', '9:16': '177.78%',
};
const DEFAULT_VIDEO_PADDING = '56.25%'; // 16:9 — also the admin build's noUncheckedIndexedAccess fallback

export const collectVideoMounts = (root: ParentNode): HtmlVideoMount[] => {
    const out: HtmlVideoMount[] = [];
    root.querySelectorAll('[data-vacademy="video"]').forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const src = node.getAttribute('data-src') || '';
        if (!isOwnMediaUrl(src)) return;
        const poster = node.getAttribute('data-poster') || '';
        const aspect = node.getAttribute('data-aspect') || '16:9';
        out.push({
            el: node,
            src,
            poster: isOwnMediaUrl(poster) ? poster : undefined,
            paddingBottom: VIDEO_ASPECT_PADDING[aspect] ?? DEFAULT_VIDEO_PADDING,
            title: node.getAttribute('aria-label') || node.getAttribute('title') || undefined,
        });
    });
    return out;
};

/**
 * Render a whole pasted PAGE: page-level caps and tag set, the site stylesheet
 * ahead of the page's own, and the action hooks bound. Returns a teardown.
 */
export const renderHtmlPage = (
    host: HTMLElement,
    html: string,
    css: string,
    options: HtmlPageOptions = {}
): (() => void) => {
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    root.innerHTML =
        `<style>:host{display:block;font-family:inherit;color:inherit;}` +
        `${scrubCss(options.siteCss || '', true)}\n${scrubCss(css || '', true)}</style>` +
        `${sanitizeCustomHtml(html || '', true)}`;
    return bindHtmlActions(root, options.onAction);
};
