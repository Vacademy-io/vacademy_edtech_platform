/**
 * "Redirect After Enrollment" — the rules the checkout actually applies.
 *
 * The learner app resolves the same two settings in
 * `frontend-learner-dashboard-app/src/routes/product-pages/$productPageCode/-components/ProductPageSuccess.tsx`;
 * both sides must agree, or the settings screen promises a redirect the
 * checkout quietly refuses to make. Keep the two in step.
 */

/** Offered as one-click chips; any whole number up to the max is allowed too. */
export const REDIRECT_DELAY_PRESETS = [0, 2, 3, 5];

export const DEFAULT_REDIRECT_DELAY_SECONDS = 3;

/** A wait longer than this reads as a page that has stopped working. */
export const MAX_REDIRECT_DELAY_SECONDS = 30;

export const clampRedirectDelay = (value: number | undefined | null): number => {
    if (value === undefined || value === null || Number.isNaN(value)) {
        return DEFAULT_REDIRECT_DELAY_SECONDS;
    }
    return Math.min(MAX_REDIRECT_DELAY_SECONDS, Math.max(0, Math.round(value)));
};

/**
 * The configured path as a destination a browser can actually be sent to: an
 * absolute http(s) URL, or a same-site path. Anything else — a `javascript:`
 * URL, or a bare "example.com" the browser would resolve as a relative path
 * off /product-pages/ — is treated as unset, so a typo leaves the normal
 * success page standing instead of dropping the learner on a dead page.
 */
export const resolveRedirectTarget = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // "//host" is an absolute URL, not a path — fall through to the URL parse.
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
    try {
        const url = new URL(trimmed);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
        return null;
    }
};

/** "3 seconds" / "1 second" — for the sentence describing what will happen. */
export const redirectDelayLabel = (seconds: number): string =>
    `${seconds} second${seconds === 1 ? '' : 's'}`;
