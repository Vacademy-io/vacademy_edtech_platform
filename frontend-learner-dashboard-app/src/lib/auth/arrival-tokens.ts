// Sign-in hand-off tokens. An inline script at the top of index.html moves
// ?accessToken=&refreshToken= out of the address before the app starts and hands
// them over here. Every reader goes through this file so they keep working the
// same whether or not that script ran (a cached older index.html).
//
// The script also keeps a copy in this tab's sessionStorage until the sign-in
// finishes, so a reload or a chunk-recovery reload can still complete it, as it
// could when the values stayed in the address.

export type ArrivalTokens = {
  accessToken: string | null;
  refreshToken: string | null;
};
type Carried = ArrivalTokens & { path: string; at?: number };

const HELD_KEY = "arrivalTokens";
// Long enough for a slow first load, short enough that a later visit to the same
// path in this tab does not pick up values from a sign-in that never finished.
const HELD_FOR_MS = 5 * 60 * 1000;

const NONE: ArrivalTokens = { accessToken: null, refreshToken: null };

// The router trims a trailing slash and may decode the path; the browser does neither.
const normalise = (path: string) => {
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    // Malformed escape: compare it as written.
  }
  return decoded.replace(/\/+$/, "") || "/";
};
const samePath = (a: string, b: string) => normalise(a) === normalise(b);

function forgetHeld(): void {
  try {
    window.sessionStorage.removeItem(HELD_KEY);
  } catch {
    // Nothing to forget.
  }
}

function readHeld(): Carried | null {
  try {
    const raw = window.sessionStorage.getItem(HELD_KEY);
    if (!raw) return null;
    const held = JSON.parse(raw) as Carried;
    if (typeof held.at === "number" && Date.now() - held.at < HELD_FOR_MS) {
      return held;
    }
  } catch {
    // Unavailable or unreadable: the same as nothing held.
  }
  forgetHeld();
  return null;
}

let carried: Carried | null = null;
if (typeof window !== "undefined") {
  const w = window as unknown as { __arrivalTokens?: Carried };
  carried = w.__arrivalTokens ?? readHeld();
  try {
    delete w.__arrivalTokens;
  } catch {
    // Not deletable: the values stay readable there until the page unloads.
  }
}

/**
 * The tokens this page arrived with, for as long as it stays on the arrival path.
 * Moving to another path drops them for good, the way moving used to drop them
 * from the address.
 *
 * Pass the router's destination from beforeLoad: window.location still holds the
 * previous address during a client-side move.
 */
export function readArrivalTokens(destination?: string): ArrivalTokens {
  if (typeof window === "undefined") return NONE;
  const live = new URLSearchParams(window.location.search);
  const accessToken = live.get("accessToken");
  const refreshToken = live.get("refreshToken");
  if (accessToken || refreshToken) return { accessToken, refreshToken };
  if (
    carried &&
    samePath(carried.path, destination ?? window.location.pathname)
  ) {
    return { accessToken: carried.accessToken, refreshToken: carried.refreshToken };
  }
  clearArrivalTokens();
  return NONE;
}

/** Call once the tokens are used, before leaving the page. */
export function clearArrivalTokens(): void {
  carried = null;
  if (typeof window !== "undefined") forgetHeld();
}

export function hasArrivalTokens(): boolean {
  const { accessToken, refreshToken } = readArrivalTokens();
  return !!(accessToken || refreshToken);
}
