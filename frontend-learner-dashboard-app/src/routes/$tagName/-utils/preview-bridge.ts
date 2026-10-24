/**
 * The page editor's "Website" view frames this site with ?preview=true and
 * drives it over postMessage (CourseCataloguePage). These helpers keep that
 * channel to the real parent frame, so a page that merely opens the site in a
 * window of its own cannot paint a made-up site onto the institute's domain.
 * The one other sender is the page itself: ai_service's headless preview
 * (page_preview.py) opens `?preview=true` on its own and posts the draft to
 * the page from inside it.
 *
 *   editor → site  CATALOGUE_CONFIG_UPDATE {payload, previewPath?},
 *                  HIGHLIGHT_COMPONENT {componentId}, PREVIEW_INTERACT {on},
 *                  PREVIEW_HELLO (answered with PREVIEW_READY)
 *   site → editor  PREVIEW_READY, COMPONENT_SELECTED {componentId, pageId, parentId?},
 *                  PREVIEW_NAVIGATE {route: string | null, href}
 */
import DOMPurify from "dompurify";
import { RouteMatcher } from "../-services/route-matcher";

/** Admin dashboard origins allowed to drive the preview, comma separated.
 *  Unset = any parent frame, so a white-label admin domain keeps working
 *  until it is listed. */
export const parseAdminOrigins = (raw: unknown): string[] =>
  typeof raw === "string"
    ? raw
        .split(",")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean)
    : [];

export const PREVIEW_ADMIN_ORIGINS = parseAdminOrigins(import.meta.env.VITE_PREVIEW_ADMIN_ORIGINS);

type FrameWindow = Pick<Window, "parent"> & { location?: Pick<Location, "origin"> };

/** True when this document is inside another one (the editor's iframe). */
export const isFramed = (win: FrameWindow = window): boolean => win.parent !== win;

/** A message the site should obey: framed, one from the frame that embeds it
 *  and from an allowed admin origin; not framed (the headless preview), one
 *  the page posted to itself. Anything else (another window, a sibling frame,
 *  an unlisted origin) is ignored. */
export const isEditorMessage = (
  event: Pick<MessageEvent, "source" | "origin">,
  win: FrameWindow = window,
  allowedOrigins: string[] = PREVIEW_ADMIN_ORIGINS,
): boolean => {
  if (!isFramed(win)) {
    // Only script running in this page (or one of its own origin) can send
    // this; another site that opens the page in a window cannot.
    return event.source === (win as unknown) && !!win.location && event.origin === win.location.origin;
  }
  return event.source === win.parent && (allowedOrigins.length === 0 || allowedOrigins.includes(event.origin));
};

/** Where PREVIEW_READY may go before the editor has spoken: each listed
 *  origin (postMessage drops the ones that do not match), or any. */
export const readyTargets = (allowedOrigins: string[] = PREVIEW_ADMIN_ORIGINS): string[] =>
  allowedOrigins.length ? allowedOrigins : ["*"];

/** The page route a link inside the site points at ("" = home), or null when
 *  it leaves the site (another host, mailto:, tel:). */
export const previewRouteFromHref = (
  href: string,
  base: { origin: string; tagName: string },
): string | null => {
  let url: URL;
  try {
    url = new URL(href, base.origin);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  return RouteMatcher.segmentsAfterBase(url.pathname, base.tagName)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
};

/** True when `route` is the page the preview shows (`previewPath`, undefined
 *  or "" = home): a link to it only jumps within the page. */
export const isShownRoute = (route: string, previewPath: string | undefined): boolean => {
  const norm = (r: string) => RouteMatcher.normalizeRoute(r.split(/[?#]/)[0] ?? "") || "home";
  return norm(route) === norm(previewPath ?? "");
};

/** A navigation that would replace this document (location.href = …, a
 *  same-tab external link): the editor's frame would leave the preview. */
export const leavesDocument = (event: {
  cancelable: boolean;
  navigationType?: string;
  destination?: { sameDocument?: boolean; url?: string };
}): boolean =>
  event.cancelable && event.navigationType !== "reload" && event.destination?.sameDocument === false;

// Keys whose HTML its renderer already sanitizes with its own, wider rules
// (htmlBlock, HTML pages): a second pass here would change what they show.
const SELF_SANITIZED_KEYS = new Set(["html", "css"]);
const PREVIEW_HTML_OPTIONS = {
  ADD_TAGS: ["iframe"],
  // YouTube's standard embed code carries referrerpolicy and loading: left
  // whole, so the text (and its translation lookup) is unchanged.
  ADD_ATTR: ["target", "allow", "allowfullscreen", "frameborder", "referrerpolicy", "loading"],
  // DOMPurify's own list plus the payment / chat / app links sites use
  // (upi:, whatsapp:, intent:), which the live site keeps.
  ALLOWED_URI_REGEXP:
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|upi|whatsapp|intent):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

/** One text through the scrub: unchanged unless DOMPurify removed something. */
const scrubText = (text: string): string => {
  if (!text.includes("<") || !DOMPurify.isSupported) return text;
  const clean = DOMPurify.sanitize(text, PREVIEW_HTML_OPTIONS);
  return DOMPurify.removed.length ? clean : text;
};

/**
 * The posted draft, with script stripped from every text that carries HTML.
 * Several sections render their text as HTML (text blocks, tab panels, hero
 * descriptions), so a page able to post here could otherwise run script on
 * the institute's domain. A text DOMPurify leaves whole is kept exactly as
 * written, so the preview still matches the live site.
 *
 * Translations (globalSettings.i18n.strings[locale]) are keyed by the base
 * text itself, so a key is also entered under its scrubbed form: a text the
 * scrub changed still finds its translation (the preview in हिन्दी matches
 * the live site). Keys are only looked up, never shown.
 */
export const scrubPreviewConfig = <T>(value: T): T => {
  const walk = (node: unknown, key?: string): unknown => {
    if (typeof node === "string") {
      return key && SELF_SANITIZED_KEYS.has(key) ? node : scrubText(node);
    }
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    }
    return node;
  };
  const out = walk(value) as T;
  const strings = (out as { globalSettings?: { i18n?: { strings?: unknown } } } | null)?.globalSettings?.i18n
    ?.strings;
  if (strings && typeof strings === "object") {
    for (const [locale, dict] of Object.entries(strings as Record<string, unknown>)) {
      if (!dict || typeof dict !== "object" || Array.isArray(dict)) continue;
      const entries = Object.entries(dict as Record<string, unknown>);
      const rekeyed: Record<string, unknown> = Object.fromEntries(entries);
      for (const [source, translation] of entries) {
        const scrubbed = scrubText(source);
        if (scrubbed !== source && !(scrubbed in rekeyed)) rekeyed[scrubbed] = translation;
      }
      (strings as Record<string, unknown>)[locale] = rekeyed;
    }
  }
  return out;
};

/** Same page, whatever the trailing slash ("/acme" and "/acme/"). */
export const isSamePath = (a: string, b: string): boolean => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** "heroSection" → "Hero section": a readable name for a hidden block. */
export const blockTypeLabel = (type: unknown): string => {
  const words = String(type || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
};
