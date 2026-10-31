/**
 * Options channel between the course-grid block(s) and the page-level Course
 * Finder wizard. The two live in different trees (the wizard sits outside
 * JsonRenderer), so they can't pass props — see CourseCatalogComponent.
 *
 * Why this exists rather than a bare window event: React runs child effects
 * before parent effects, so whenever the grid already has its courses at mount
 * time (warm react-query cache, client-side navigation back to the catalogue)
 * it publishes *before* CourseCataloguePage has subscribed, and a plain
 * dispatch is lost with no second chance — the wizard then never opens. So the
 * last payload is retained here and a late subscriber gets it immediately.
 */

export interface CourseFinderOption {
  id: string;
  name: string;
}

export interface CourseFinderOptionsPayload {
  levels: CourseFinderOption[];
  sessions: CourseFinderOption[];
  tags: CourseFinderOption[];
}

const EVENT_NAME = "courseFinderOptionsReady";

/**
 * Last published payload, replayed to subscribers that arrive late. Cleared
 * when the publishing grid unmounts so a different catalogue page can never
 * inherit the previous one's levels.
 */
let latest: CourseFinderOptionsPayload | null = null;

export const publishCourseFinderOptions = (payload: CourseFinderOptionsPayload): void => {
  latest = payload;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
};

export const getLatestCourseFinderOptions = (): CourseFinderOptionsPayload | null => latest;

export const clearCourseFinderOptions = (): void => {
  latest = null;
};

/** Subscribes to later publishes. Returns the unsubscribe function. */
export const subscribeCourseFinderOptions = (
  onOptions: (payload: CourseFinderOptionsPayload) => void,
): (() => void) => {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail || {};
    onOptions({
      levels: Array.isArray(detail.levels) ? detail.levels : [],
      sessions: Array.isArray(detail.sessions) ? detail.sessions : [],
      tags: Array.isArray(detail.tags) ? detail.tags : [],
    });
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
};

// ─── The visitor's answer, travelling back the other way ─────────────────────

const APPLIED_EVENT_NAME = "courseFinderApplied";

export interface CourseFinderSelectionPayload {
  /** Raw level names, already expanded from any levelGroups label. */
  levels: string[];
  sessions: string[];
  tags: string[];
  /**
   * What the visitor actually SAW themselves pick — group labels ("Class 6"),
   * not the raw values those expand to ("Cyber AI- Class 6", "English - Class
   * 6", …). Course blocks echo these back as removable chips; showing the
   * expanded `levels` there would print five near-identical rows for one tap.
   * Optional so an older dispatcher (or a hand-fired event) still type-checks.
   */
  labels?: string[];
  /**
   * True when the picker was reopened by "Back to courses" from the checkout.
   * That visitor is returning to ADD to what they already chose, so the offer
   * block must NOT run its usual fresh-answer basket reset — doing so discards
   * every course they picked before, with no undo. See ProductPageOfferComponent.
   */
  keepBasket?: boolean;
}

/**
 * Subscribes to the wizard's picks. Unlike the options channel this is not
 * replayed: the wizard is rendered by the page and always mounts before the
 * visitor can answer, so no subscriber can miss the event.
 */
export const subscribeCourseFinderApplied = (
  onApplied: (selection: CourseFinderSelectionPayload) => void,
): (() => void) => {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail || {};
    onApplied({
      levels: Array.isArray(detail.levels) ? detail.levels : [],
      sessions: Array.isArray(detail.sessions) ? detail.sessions : [],
      tags: Array.isArray(detail.tags) ? detail.tags : [],
      // Fall back to the raw values so a dispatcher that never sets labels
      // still gives the chips something truthful to render.
      labels: Array.isArray(detail.labels)
        ? detail.labels
        : [
            ...(Array.isArray(detail.levels) ? detail.levels : []),
            ...(Array.isArray(detail.sessions) ? detail.sessions : []),
            ...(Array.isArray(detail.tags) ? detail.tags : []),
          ],
      keepBasket: detail.keepBasket === true,
    });
  };
  window.addEventListener(APPLIED_EVENT_NAME, handler);
  return () => window.removeEventListener(APPLIED_EVENT_NAME, handler);
};

// ─── Remembering the answer across a reload ──────────────────────────────────

/**
 * The wizard is shown ONCE per visitor — `courseFinderSeen_…` in localStorage —
 * but the answer used to live only in the course block's React state. So a
 * reload, or the round trip into a course details page and back, dropped the
 * filter while the "already asked" flag stayed set: the visitor was never asked
 * again and never got their class back, landing on the full catalogue with
 * every class's subjects mixed together. The basket survives that trip
 * (sessionStorage) which makes it worse, not better — their picks come back
 * scattered through a list twelve times longer than the one they chose from.
 *
 * So the answer is kept beside the flag it partners with, in localStorage for
 * the same reason the flag is: a session-scoped answer would still leave a
 * returning visitor un-asked AND unfiltered. Cleared whenever the visitor asks
 * to see everything, which is the one action that means "forget my class".
 */
/**
 * The key both sides must agree on. Deliberately the same shape as the seen
 * flag (`courseFinderSeen_<institute>_<tag>`): the two are one fact split in
 * half, and a scope drift between them is exactly the bug this fixes — the page
 * remembering that it asked, while the grid forgets what it was told. Returns
 * '' when either half is missing, which every helper treats as "don't persist".
 */
export const courseFinderScope = (
  instituteId?: string | null,
  tagName?: string | null,
): string => (instituteId && tagName ? `${instituteId}_${tagName}` : "");

const selectionStorageKey = (scope: string) => `courseFinderSelection_${scope}`;

export const saveCourseFinderSelection = (
  scope: string,
  selection: CourseFinderSelectionPayload,
): void => {
  if (!scope) return;
  try {
    // keepBasket describes THIS answer's effect on the cart ("Back to courses"),
    // not the filter, and the cart is gone by the next visit anyway — storing it
    // would only let a stale flag decide the fate of a future basket.
    const { levels, sessions, tags, labels } = selection;
    window.localStorage.setItem(
      selectionStorageKey(scope),
      JSON.stringify({ levels, sessions, tags, labels }),
    );
  } catch {
    // Private mode / storage disabled — the in-memory filter still works for
    // this page view, which is exactly the behaviour we had before.
  }
};

/** The stored answer, or null when there is none (or it cannot be read). */
export const loadCourseFinderSelection = (
  scope: string,
): CourseFinderSelectionPayload | null => {
  if (!scope) return null;
  try {
    const raw = window.localStorage.getItem(selectionStorageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) || {};
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    const restored: CourseFinderSelectionPayload = {
      levels: strings(parsed.levels),
      sessions: strings(parsed.sessions),
      tags: strings(parsed.tags),
      labels: strings(parsed.labels),
    };
    // An answer that filters nothing is indistinguishable from no answer, and
    // restoring it would print an empty "showing:" chip row.
    const empty =
      restored.levels.length === 0 &&
      restored.sessions.length === 0 &&
      restored.tags.length === 0;
    return empty ? null : restored;
  } catch {
    return null;
  }
};

export const clearCourseFinderSelection = (scope: string): void => {
  if (!scope) return;
  try {
    window.localStorage.removeItem(selectionStorageKey(scope));
  } catch {
    // Nothing to do: the caller has already cleared its own state.
  }
};
