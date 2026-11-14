import { useEffect, useState } from "react";
import { BASE_URL } from "@/constants/urls";

/**
 * "Email once, download everything" for gated resource cards.
 *
 * A featureGrid in `resource` style can bind an Audience list
 * (`gateAudienceId`) and flag individual card links as `gated`. The first time
 * a visitor opens a gated link they get that list's form in the
 * AudienceFormModal; once it is submitted, the list id is remembered in
 * localStorage so every gated card bound to the same list opens directly —
 * on this page and on every other page of the site, in this browser.
 *
 * This is lead capture, not access control: the files themselves stay public.
 */

const STORAGE_PREFIX = "catalogue-resource-unlock:";
const UNLOCK_EVENT = "catalogueResourceUnlocked";

export const isResourceUnlocked = (audienceId: string): boolean => {
  if (!audienceId || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + audienceId) === "1";
  } catch {
    // Private mode / storage disabled — the visitor just sees the form again.
    return false;
  }
};

export const markResourceUnlocked = (audienceId: string): void => {
  if (!audienceId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + audienceId, "1");
  } catch {
    // Ignore — the unlock still holds for this modal session.
  }
  window.dispatchEvent(new CustomEvent(UNLOCK_EVENT, { detail: { audienceId } }));
};

/**
 * Live unlock state for one list. Starts locked on the server render and
 * resolves from storage after mount, then flips when any modal on the page
 * reports a submission for the same list.
 */
export const useResourceUnlocked = (audienceId: string): boolean => {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    if (!audienceId) return;
    setUnlocked(isResourceUnlocked(audienceId));
    const onUnlock = (e: Event) => {
      if ((e as CustomEvent).detail?.audienceId === audienceId) setUnlocked(true);
    };
    window.addEventListener(UNLOCK_EVENT, onUnlock);
    return () => window.removeEventListener(UNLOCK_EVENT, onUnlock);
  }, [audienceId]);
  return unlocked;
};

/* ─── Who downloaded what ────────────────────────────────────────────────
 * The unlock above only says "this browser filled the form". To show an
 * admin which freebies each lead took, the email/phone typed into that form
 * is kept for this browser and sent with every resource opened afterwards;
 * the server matches it to the lead. One identity per browser (not per list):
 * a lead who unlocked one section is still the same person on the next.
 */

const IDENTITY_KEY = "catalogue-resource-identity";

/**
 * Freebie links are pasted by hand — a Drive share link, a YouTube video or
 * playlist, a PDF — and often without the scheme ("drive.google.com/…",
 * "www.youtube.com/…", "youtu.be/…"). Without it the link is read as one of
 * the site's own pages and goes nowhere, so a bare domain gets https:// added.
 * Page routes ("about-us", "/blog/x") and anchors are left alone.
 */
export const normalizeResourceUrl = (raw: unknown): string => {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!url) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return url;
  if (url.startsWith("/") || url.startsWith("#")) return url;
  const host = (url.split(/[/?#]/)[0] ?? "").toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return url;
  // Only a real domain: "www." or a known top-level domain. A relative file
  // ("worksheet.pdf", "guide.html") also has a dot and must stay as it is.
  const tld = host.slice(host.lastIndexOf(".") + 1);
  return host.startsWith("www.") || KNOWN_TLDS.has(tld) ? `https://${url}` : url;
};

const KNOWN_TLDS = new Set([
  "com", "in", "org", "net", "io", "co", "be", "edu", "gov", "ac", "app", "dev", "me", "ly",
  "gl", "info", "ai", "us", "uk", "au", "ca", "xyz", "site", "online", "link", "page", "so",
  "tv", "to", "ae", "sg", "biz", "academy", "school", "education", "world",
]);

export interface ResourceIdentity {
  email?: string;
  mobileNumber?: string;
}

export const rememberResourceIdentity = (identity?: ResourceIdentity | null): void => {
  if (!identity || typeof window === "undefined") return;
  const email = (identity.email || "").trim();
  const mobileNumber = (identity.mobileNumber || "").trim();
  if (!email && !mobileNumber) return;
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ email, mobileNumber }));
  } catch {
    // Storage disabled — downloads still count, just not against this lead.
  }
};

const readIdentity = (): ResourceIdentity => {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as ResourceIdentity) : {};
  } catch {
    return {};
  }
};

interface ResourcePageContext {
  instituteId: string;
  catalogueId?: string;
  pageRoute?: string;
}

// Set by the page shell, which knows the institute and page; resource cards
// deep in the JSON tree do not.
let pageContext: ResourcePageContext | null = null;

export const useResourceTrackingContext = (ctx: ResourcePageContext | null): void => {
  const instituteId = ctx?.instituteId;
  const catalogueId = ctx?.catalogueId;
  const pageRoute = ctx?.pageRoute ?? "";
  useEffect(() => {
    pageContext = instituteId ? { instituteId, catalogueId, pageRoute } : null;
  }, [instituteId, catalogueId, pageRoute]);
};

/**
 * Record one opened freebie. Fire-and-forget via sendBeacon so it survives the
 * click navigating away or opening the file.
 */
export const trackResourceDownload = (resource: {
  url: string;
  title?: string;
  audienceId?: string;
}): void => {
  try {
    if (!pageContext?.instituteId || !resource?.url) return;
    const identity = readIdentity();
    const body = JSON.stringify({
      instituteId: pageContext.instituteId,
      catalogueId: pageContext.catalogueId,
      pageRoute: pageContext.pageRoute ?? "",
      audienceId: resource.audienceId || undefined,
      resourceTitle: resource.title || undefined,
      resourceUrl: resource.url,
      email: identity.email || undefined,
      mobileNumber: identity.mobileNumber || undefined,
    });
    const url = `${BASE_URL}/admin-core-service/open/v1/catalogue-resources/download`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    /* tracking must never block the file */
  }
};
