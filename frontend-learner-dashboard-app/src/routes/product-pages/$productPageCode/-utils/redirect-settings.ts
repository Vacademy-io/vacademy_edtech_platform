/**
 * "Redirect After Enrollment" — the two settings the checkout applies once an
 * enrolment is through.
 *
 * The admin settings screen resolves them the same way, in
 * `frontend-admin-dashboard/src/routes/manage-pages/product-pages/-utils/redirect-settings.ts`,
 * and says on screen what will happen. Keep the two in step, or that screen
 * promises a redirect this app refuses to make.
 */

// The default leaves the buyer long enough to register that the enrolment
// landed (and the PAYMENT_SUCCESS postMessage and any analytics tag long enough
// to fire); the ceiling keeps a mis-typed value from parking them on a page
// that looks like it has stopped.
export const DEFAULT_REDIRECT_DELAY_SECONDS = 3;
export const MAX_REDIRECT_DELAY_SECONDS = 30;

export const clampRedirectDelay = (value: number | undefined | null): number => {
  if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_REDIRECT_DELAY_SECONDS;
  return Math.min(MAX_REDIRECT_DELAY_SECONDS, Math.max(0, Math.round(value)));
};

/**
 * The configured path as a destination the browser may safely be sent to: an
 * absolute http(s) URL, or a same-site path. Anything else — a `javascript:`
 * URL, or a bare "example.com" that the browser would resolve as a relative
 * path off /product-pages/ — is treated as unset, so a typo in the institute's
 * settings leaves the normal receipt standing instead of dropping the buyer on
 * a dead page.
 */
export const resolveRedirectTarget = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // "//host" is an absolute URL, not a path — fall through to the URL parse.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};
