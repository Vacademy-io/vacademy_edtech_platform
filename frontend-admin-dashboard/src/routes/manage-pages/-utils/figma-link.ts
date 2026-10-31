/**
 * Figma links in the AI page wizard.
 *
 * Nothing in the product opens a Figma file (product decision 2026-10-10: no
 * server-side Figma, no stored Figma tokens). A figma.com link opened without
 * the owner's session is Figma's sign-in page, so the wizard used to send it
 * as a "reference site" and the server screenshotted a login form. The wizard
 * now spots the link, keeps it out of the request and says what works instead
 * (the same rule as ai_service/app/services/figma_links.py).
 *
 * A published Figma Sites page (*.figma.site) is a normal website and is not
 * a Figma link.
 */

const hostOf = (raw: string): string => {
    const value = raw.trim();
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    try {
        return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
        return '';
    }
};

/** True for a link to figma.com or a subdomain of it, with or without a scheme. */
export const isFigmaUrl = (raw: string | null | undefined): boolean => {
    if (!raw || !raw.trim()) return false;
    const host = hostOf(raw);
    return host === 'figma.com' || host.endsWith('.figma.com');
};

// Either with a scheme, or scheme-less with a Figma file path
// (figma.com/design/…): a bare "figma.com" in prose is not a shared design.
// The host must not continue into a longer domain (figma.com.evil.io), and the
// link must not sit inside another URL (path or query string) or an email.
const FIGMA_HOST = String.raw`(?:[a-z0-9-]+\.)*figma\.com(?![a-z0-9-]|\.[a-z0-9])(?::\d+)?`;
const URL_TAIL = String.raw`[^\s<>"')\]]*`;
const FIGMA_IN_TEXT = new RegExp(
    String.raw`(?<![\w./@=&?%#+-])(?:https?://${FIGMA_HOST}(?:[/?#]${URL_TAIL})?` +
        String.raw`|${FIGMA_HOST}/(?:design|file|proto|board|make|slides)/${URL_TAIL})`,
    'gi'
);

/** The first figma.com link in free text (a chat message), or null. */
export const findFigmaUrl = (text: string | null | undefined): string | null => {
    if (!text || !/figma/i.test(text)) return null;
    for (const match of text.matchAll(FIGMA_IN_TEXT)) {
        if (isFigmaUrl(match[0])) return match[0];
    }
    return null;
};
