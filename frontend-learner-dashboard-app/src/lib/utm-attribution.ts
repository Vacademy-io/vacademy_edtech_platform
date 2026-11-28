import { BASE_URL } from "@/constants/urls";

/**
 * First-touch UTM capture, and reporting it against the person it produced.
 *
 * WHY BOTH HALVES LIVE HERE: the UTM parameters are on the URL the learner
 * LANDS on, and the identity is only known on the page they SUBMIT from —
 * often several navigations later, sometimes a different route entirely
 * (catalogue → course → enrol). Capturing on landing and reading at submit is
 * the only ordering that works, so the store and the beacon have to agree on
 * one key. They did not use to: the catalogue tracker had its own copy, and
 * every other surface had none, which is why an admin could generate a tagged
 * link for an audience form and then find nothing recorded against the lead.
 *
 * STORAGE LIFETIME: sessionStorage alone was too short. It dies with the tab,
 * so a learner who opened the ad link, closed it, and came back an hour later
 * to actually enrol arrived with no campaign — the enrolment recorded nothing
 * and the report showed the ad producing zero. It also dies if they finish in
 * a different tab. So the touch is ALSO persisted in localStorage with an
 * explicit expiry: long enough to survive a realistic
 * think-about-it-and-come-back, short enough that a click three weeks ago is
 * not credited with today's organic signup.
 */

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmValues = Partial<Record<UtmKey, string>>;

/** Must match every reader — including the catalogue tracker, which delegates here. */
const UTM_STORE = "vac_utm_first_touch";
const LANDING_STORE = "vac_utm_landing";

/**
 * How long a first touch stays creditable, in days. Thirty is the common
 * default for paid-campaign attribution windows.
 */
const PERSIST_DAYS = 30;
const PERSIST_MS = PERSIST_DAYS * 24 * 60 * 60 * 1000;

/** Never throws: any storage call can fail outright in a locked-down browser. */
const readStore = (store: "session" | "local", key: string): string | null => {
  try {
    return (store === "session" ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
};

const writeStore = (store: "session" | "local", key: string, value: string): void => {
  try {
    (store === "session" ? sessionStorage : localStorage).setItem(key, value);
  } catch {
    /* private mode, quota, or storage disabled — attribution is best-effort */
  }
};

/** UTM parameters on the CURRENT url, if any. */
const utmFromCurrentUrl = (): UtmValues => {
  const utm: UtmValues = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) utm[key] = value.slice(0, 120);
    }
  } catch {
    /* no window (non-browser context) */
  }
  return utm;
};

/** Mirrors the backend's allow-list; anything else is dropped server-side. */
export type UtmSourceType =
  | "AUDIENCE"
  | "LIVE_SESSION"
  | "ASSESSMENT"
  | "ENROLL_INVITE"
  | "PRODUCT_PAGE"
  | "CATALOGUE";

/**
 * Record the UTM parameters on the current URL, once per browsing session.
 *
 * FIRST touch wins: a learner who arrives from an Instagram ad, wanders the
 * catalogue and then reaches a form through an untagged internal link should
 * still be credited to Instagram. Re-capturing on every page would instead
 * overwrite the campaign with nothing, which is the classic way self-built
 * attribution reports come out empty.
 */
export const captureUtmOnce = (): void => {
  // Already banked for this tab: first touch wins, nothing to do.
  if (readStore("session", UTM_STORE)) return;

  const utm = utmFromCurrentUrl();
  if (Object.keys(utm).length === 0) return;

  const payload = JSON.stringify(utm);
  // Path only — the query string is where any PII would be.
  const landing = (() => {
    try {
      return window.location.pathname.slice(0, 512);
    } catch {
      return "";
    }
  })();

  writeStore("session", UTM_STORE, payload);
  writeStore("session", LANDING_STORE, landing);
  // Stamped so it can expire; sessionStorage cannot outlive the tab, and a
  // learner who comes back later must still carry their campaign.
  writeStore("local", UTM_STORE, JSON.stringify({ utm, landing, at: nowMs() }));
};

/** Extracted so tests can control it; Date.now is otherwise inlined. */
const nowMs = (): number => new Date().getTime();

/**
 * The campaign to credit, in priority order:
 *   1. parameters on the URL right now — a tagged link opened in a brand-new
 *      context, before any capture has run
 *   2. this tab's first touch
 *   3. a persisted first touch from an earlier tab, if still inside the window
 *
 * Reading the live URL first matters because the router strips utm_* from the
 * address bar shortly after load; without this, a submit that happens before
 * capture has been reached would find nothing.
 */
export const getStoredUtm = (): UtmValues => {
  const live = utmFromCurrentUrl();
  if (Object.keys(live).length > 0) return live;

  try {
    const session = JSON.parse(readStore("session", UTM_STORE) || "{}") as UtmValues;
    if (Object.keys(session).length > 0) return session;
  } catch {
    /* fall through to the persisted copy */
  }

  try {
    const raw = readStore("local", UTM_STORE);
    if (!raw) return {};
    const saved = JSON.parse(raw) as { utm?: UtmValues; at?: number };
    if (!saved?.utm || typeof saved.at !== "number") return {};
    if (nowMs() - saved.at > PERSIST_MS) return {};
    return saved.utm;
  } catch {
    return {};
  }
};

export const hasStoredUtm = (): boolean => Object.keys(getStoredUtm()).length > 0;

const getLandingPath = (): string | undefined => {
  const session = readStore("session", LANDING_STORE);
  if (session) return session;
  // Same fallback as the campaign itself: a learner returning in a new tab
  // still carries the page they originally landed on.
  try {
    const raw = readStore("local", UTM_STORE);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as { landing?: string; at?: number };
    if (typeof saved?.at !== "number" || nowMs() - saved.at > PERSIST_MS) return undefined;
    return saved.landing || undefined;
  } catch {
    return undefined;
  }
};

export interface TrackUtmInput {
  instituteId?: string | null;
  /** Known for most surfaces; the server matches on contact details otherwise. */
  userId?: string | null;
  email?: string | null;
  mobileNumber?: string | null;
  sourceType: UtmSourceType;
  /** The campaign / session / assessment / invite / page the link pointed at. */
  sourceId?: string | null;
}

/**
 * Report one campaign touch after a SUCCESSFUL submission.
 *
 * Fire-and-forget by design, and it never throws: by the time this runs the
 * learner has already done the thing they came to do, so a telemetry failure
 * must not surface as an error on a form that in fact succeeded.
 *
 * Sends nothing when this session carries no UTM parameters — an untagged
 * arrival is the absence of attribution, and storing it would bury the real
 * campaigns under blank rows.
 */
export const trackUtmAttribution = (input: TrackUtmInput): void => {
  try {
    const utm = getStoredUtm();
    if (!input?.instituteId || Object.keys(utm).length === 0) return;
    if (!input.userId && !input.email && !input.mobileNumber) return;

    const body = JSON.stringify({
      institute_id: input.instituteId,
      user_id: input.userId ?? undefined,
      email: input.email ?? undefined,
      mobile_number: input.mobileNumber ?? undefined,
      source_type: input.sourceType,
      source_id: input.sourceId ?? undefined,
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      utm_content: utm.utm_content,
      utm_term: utm.utm_term,
      referrer: document.referrer || undefined,
      landing_url: getLandingPath(),
    });

    const url = `${BASE_URL}/admin-core-service/open/v1/utm/track`;
    // keepalive so the report survives the navigation that usually follows a
    // successful submit (a thank-you redirect, or a payment gateway hop).
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* attribution is best-effort */
    });

    // The touch has been credited, so retire the PERSISTED copy. Without this
    // a shared device — a school lab, a family phone, a cyber cafe, all normal
    // here — would keep crediting the next person's signup to whoever clicked
    // the ad up to 30 days earlier. The per-tab copy stays, so a learner
    // enrolling in a second course during the same visit is still attributed.
    try {
      localStorage.removeItem(UTM_STORE);
    } catch {
      /* storage disabled — nothing to retire */
    }
  } catch {
    /* never let telemetry break a submission */
  }
};
