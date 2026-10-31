/**
 * Reload-resume (SPEC §4.1 "same visitor_id + resume_session_id within 12 h").
 * localStorage can be absent or throw (Safari private mode, blocked storage,
 * sandboxed frames), so every access is wrapped: without storage the visitor
 * simply starts a fresh conversation.
 */

const VISITOR_KEY = "vsa:visitor";
const sessionKey = (site: string) => `vsa:session:${site}`;
export const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: resume just won't survive a reload.
  }
};

export const randomId = (): string => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Insecure context: fall through.
  }
  const rnd = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  return `${rnd()}-${rnd().slice(0, 4)}-4${rnd().slice(0, 3)}-a${rnd().slice(0, 3)}-${rnd()}${rnd().slice(0, 4)}`;
};

const VISITOR_ID = /^[A-Za-z0-9-]{8,64}$/;

/** A stable anonymous id for this browser (never PII). */
export const getVisitorId = (): string => {
  const existing = read(VISITOR_KEY);
  if (existing && VISITOR_ID.test(existing)) return existing;
  const id = randomId();
  write(VISITOR_KEY, id);
  return id;
};

/** The conversation to resume on this site, if it is still inside the resume window. */
export const getStoredSessionId = (site: string, now: number = Date.now()): string | null => {
  const raw = read(sessionKey(site));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof parsed.id !== "string" || typeof parsed.at !== "number") return null;
    if (now - parsed.at > RESUME_WINDOW_MS) {
      write(sessionKey(site), null);
      return null;
    }
    return parsed.id;
  } catch {
    return null;
  }
};

export const storeSessionId = (site: string, id: string | null, now: number = Date.now()) =>
  write(sessionKey(site), id ? JSON.stringify({ id, at: now }) : null);
