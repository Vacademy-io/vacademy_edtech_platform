/**
 * A random id this browser keeps for the institute's public sites, sent with
 * blog likes and reviews so the server can count a browser once (likes) or
 * slow down repeat posting (reviews). Not an identity: clearing site storage
 * makes a new one.
 *
 * The storage key keeps the name it had when only blog likes used it, so
 * browsers that already liked posts keep their id.
 */
const VISITOR_KEY = "catalogue-blog-visitor";

const newVisitorId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

export const siteVisitorId = (): string => {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const created = newVisitorId();
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return newVisitorId();
  }
};
