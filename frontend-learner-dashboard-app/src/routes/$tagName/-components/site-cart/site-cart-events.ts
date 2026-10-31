/**
 * Opening the site cart drawer from anywhere on the page.
 *
 * The drawer belongs to the header's cart button. Other sections (a learning
 * path's "Add whole path to cart", a course card) open it with
 * `window.dispatchEvent(new CustomEvent('siteCartOpen'))` or openSiteCartDrawer().
 *
 * Exactly one drawer opens per request even when the header renders more than
 * one cart button (desktop + mobile bars): a single window listener hands the
 * request to the most recently mounted button.
 */

export const SITE_CART_OPEN_EVENT = "siteCartOpen";

/** What an open request asks for: just show the cart, or go on to checkout ("Buy now"). */
export interface SiteCartOpenRequest {
  intent?: "view" | "checkout";
}

type Opener = (request?: SiteCartOpenRequest) => void;

const openers: Opener[] = [];
let listening = false;
const watchers = new Set<() => void>();

// Called by the window event, and directly (no event) for a reopen request.
const handleOpenRequest = (event?: Event) => {
  const detail = (event as CustomEvent<SiteCartOpenRequest | undefined> | undefined)?.detail;
  openers[openers.length - 1]?.(detail && typeof detail === "object" ? detail : undefined);
};

const notifyWatchers = () => {
  for (const watcher of [...watchers]) watcher();
};

// ─── reopen after the store checkout's Back ─────────────────────────────────
// The store checkout is another route, so the drawer that sent the visitor
// there is gone. Its Back asks for the drawer again; the next cart button (or
// a section's own drawer) to mount takes the request. Kept in memory and
// short-lived: a request nobody takes in time is dropped, never replayed later.

export const SITE_CART_REOPEN_WINDOW_MS = 10_000;
let reopenRequestedAt = 0;

/** Asks the next cart UI to mount on this page load to open the drawer. */
export const requestSiteCartReopen = (now: number = Date.now()): void => {
  reopenRequestedAt = now;
};

/** Takes a pending reopen request (at most once): true when one was made in the last few seconds. */
export const takeSiteCartReopenRequest = (now: number = Date.now()): boolean => {
  const fresh = reopenRequestedAt > 0 && now - reopenRequestedAt >= 0 && now - reopenRequestedAt <= SITE_CART_REOPEN_WINDOW_MS;
  reopenRequestedAt = 0;
  return fresh;
};

/** A cart button registers how to open its drawer; returns the unregister function. */
export const registerSiteCartOpener = (open: Opener): (() => void) => {
  openers.push(open);
  if (!listening && typeof window !== "undefined") {
    window.addEventListener(SITE_CART_OPEN_EVENT, handleOpenRequest);
    listening = true;
  }
  notifyWatchers();
  if (takeSiteCartReopenRequest()) {
    // After the current commit, so the last of several buttons mounting
    // together is the one that opens (as for any other open request).
    queueMicrotask(handleOpenRequest);
  }
  return () => {
    const index = openers.lastIndexOf(open);
    if (index >= 0) openers.splice(index, 1);
    if (!openers.length && listening && typeof window !== "undefined") {
      window.removeEventListener(SITE_CART_OPEN_EVENT, handleOpenRequest);
      listening = false;
    }
    notifyWatchers();
  };
};

/** True when some cart button on the page can open the drawer. */
export const hasSiteCartOpener = (): boolean => openers.length > 0;

/**
 * Subscribes to cart buttons mounting and unmounting (for
 * useSyncExternalStore with hasSiteCartOpener). Returns the unsubscribe.
 */
export const subscribeSiteCartOpeners = (watcher: () => void): (() => void) => {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
};

/**
 * Opens the header's cart drawer. Returns false when no cart button is
 * mounted (a page without the site header), so the caller can show its own.
 */
export const openSiteCartDrawer = (request?: SiteCartOpenRequest): boolean => {
  if (!openers.length || typeof window === "undefined") return false;
  window.dispatchEvent(new CustomEvent(SITE_CART_OPEN_EVENT, { detail: request }));
  return true;
};
