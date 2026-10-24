import { Preferences } from "@capacitor/preferences";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { THEME_ROLE_SETTINGS_KEY } from "@/types/theme-role-settings";

export interface TabBrandingResult {
  iconUrl: string | null;
  tabText: string | null;
}

/* ============================================================================
 * Font stacks (i18n Phase 1 — Arabic-first).
 *
 * SINGLE SOURCE OF TRUTH for every runtime `--app-font-family` / body font
 * write. White-label branding used to REPLACE the whole stack, which dropped
 * the 'Noto Naskh Arabic' fallback that src/index.css puts in the default
 * chain — so a branded institute rendered Arabic in whatever the OS happened
 * to pick (often a face with no Arabic glyphs at all). Every setter now routes
 * through resolveFontStack()/buildFontStack() so the Arabic face can never be
 * dropped again.
 *
 * Latin rendering is unchanged: the Noto Naskh Arabic @font-face in index.css
 * is unicode-range-scoped to Arabic-script codepoints, so Latin text can never
 * match it and simply continues down to the next family in the list. Brand
 * fonts that DO carry Arabic glyphs (e.g. Cairo) still win, because they sit
 * ahead of the fallback.
 * ========================================================================== */

/** Arabic-script face. @font-face + unicode-range live in src/index.css. */
const ARABIC_FALLBACK = "'Noto Naskh Arabic'";

/** Emoji tail shared by the branded stacks below. Kept verbatim. */
const EMOJI_TAIL =
  '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

/** System tail shared by the sans-serif branded stacks below. Kept verbatim. */
const SYSTEM_TAIL = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", ${EMOJI_TAIL}`;

/**
 * Builds a full font stack: brand font → Arabic fallback → system fallbacks.
 * The Arabic face is injected here and nowhere else, so no caller can omit it.
 */
export function buildFontStack(brandFont?: string, tail: string = SYSTEM_TAIL): string {
  return [brandFont, ARABIC_FALLBACK, tail].filter(Boolean).join(", ");
}

/** True when `stack` already names the Arabic face (avoids double-insertion). */
const hasArabicFallback = (stack: string): boolean =>
  /noto\s+naskh\s+arabic/i.test(stack);

/**
 * Injects the Arabic fallback into a caller-supplied CSS font stack (e.g. a
 * catalogue's `fonts.family` JSON blob) directly after the first family.
 *
 * It must go after the brand font (so branding still wins for Latin, and for
 * Arabic when the brand font has Arabic glyphs) but BEFORE any generic family
 * such as `sans-serif`/`cursive` — a generic matches every codepoint, so an
 * Arabic face appended after one would never be reached.
 */
export function withArabicFallback(stack: string): string {
  const trimmed = stack.trim();
  if (!trimmed) return buildFontStack();
  if (hasArabicFallback(trimmed)) return trimmed;

  const [first, ...rest] = trimmed.split(",");
  return [first!.trim(), ARABIC_FALLBACK, ...rest.map((part) => part.trim())].join(", ");
}

/**
 * Devanagari face for multi-language catalogue sites that offer हिन्दी /
 * मराठी. Loaded on demand from Google Fonts by the catalogue shells (it is in
 * the catalogue font registry), and only for those sites.
 */
export const DEVANAGARI_FALLBACK_FAMILY = "Noto Sans Devanagari";

const DEVANAGARI_FALLBACK = `'${DEVANAGARI_FALLBACK_FAMILY}'`;

/**
 * Adds the Devanagari face to a font stack, the same way withArabicFallback
 * adds the Arabic one: after the brand font (and after the Arabic face when
 * the stack has it), before any generic family — a generic such as
 * `sans-serif` matches every codepoint, so a face placed after it would never
 * be reached. Latin text keeps rendering in the brand font, which comes first.
 * A stack that already names the face is returned unchanged.
 */
export function withDevanagariFallback(stack: string): string {
  const trimmed = stack.trim();
  if (!trimmed) return withDevanagariFallback(buildFontStack());
  if (/noto\s+sans\s+devanagari/i.test(trimmed)) return trimmed;

  const parts = trimmed.split(",").map((part) => part.trim());
  const arabicAt = parts.findIndex((part) => /noto\s+naskh\s+arabic/i.test(part));
  const insertAt = arabicAt >= 0 ? arabicAt + 1 : 1;
  return [...parts.slice(0, insertAt), DEVANAGARI_FALLBACK, ...parts.slice(insertAt)].join(", ");
}

/** Default stack when an institute has no branded font (e.g. /resolve 404). */
const DEFAULT_STACK = buildFontStack("Inter");

/**
 * Maps an institute's configured font to its full stack, Arabic fallback
 * included. Known brand keys expand to their curated stack; anything else is
 * treated as a literal CSS stack and only gains the Arabic fallback.
 *
 * This replaces the `mapFamily` helper that was copy-pasted verbatim across
 * branding.ts, login-form, forgot-password-form and the two Modular*Container
 * files — every one of which dropped the Arabic face.
 */
export function resolveFontStack(fontFamily?: string | null): string {
  if (!fontFamily) return DEFAULT_STACK;

  switch (String(fontFamily).toUpperCase()) {
    case "INTER":
      return DEFAULT_STACK;
    case "CAIRO":
      return buildFontStack("Cairo");
    case "PLAYPEN SANS":
      return buildFontStack("Playpen Sans", `cursive, ${EMOJI_TAIL}`);
    case "WORK SANS":
      return buildFontStack("Work Sans");
    case "LEXEND":
      return buildFontStack("Lexend");
    case "POPPINS":
      return buildFontStack("Poppins");
    case "PLUS JAKARTA SANS":
      return buildFontStack("Plus Jakarta Sans");
    case "OPEN SANS":
      return buildFontStack("Open Sans");
    default:
      // An unrecognised value is a literal CSS family, but it MUST still get the
      // system tail. Without it the stack was just `<font>, 'Noto Naskh Arabic'`
      // — and the Arabic face is unicode-range-scoped to Arabic codepoints, so
      // Latin text can't match it. If the literal font isn't loaded, nothing in
      // the stack can render Latin and the browser falls back to its own
      // default, which in Chrome is a SERIF. That is how an institute
      // configured with an unloaded font ended up rendering in Times New Roman.
      return `${withArabicFallback(String(fontFamily))}, ${SYSTEM_TAIL}`;
  }
}

// Global state to track current favicon and prevent unnecessary resets
let currentFaviconUrl: string | null = null;
let faviconMonitorInterval: NodeJS.Timeout | null = null;
let lastFaviconRefreshMs = 0;
const FAVICON_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const FALLBACK_FAVICON_URL = "/icons/icon-48.webp"; // Static Vacademy fallback (Vacademy hosts only)

// A 1x1 transparent SVG. Used as the favicon fallback on white-labelled
// (non-Vacademy) hosts so a failed/absent institute icon never flashes the
// Vacademy "V" in the tab. Mirrors the cold-cache behaviour of the inline
// bootstrap script in index.html.
const BLANK_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>'
  );

// Vacademy-owned hosts may legitimately show the Vacademy mark; every other
// (white-labelled) host must not.
const isVacademyHost = (): boolean => {
  const h = typeof location !== "undefined" ? location.hostname : "";
  return /(^|\.)vacademy\.io$/.test(h) || h === "localhost" || h === "127.0.0.1";
};

// The favicon to show when no institute icon is available: the Vacademy mark on
// Vacademy hosts, a blank icon everywhere else.
const getFallbackFavicon = (): string =>
  isVacademyHost() ? FALLBACK_FAVICON_URL : BLANK_FAVICON;

// Helper: create favicon link elements
const createFaviconLink = (href: string, rel: string, sizes?: string, type?: string) => {
  const el = document.createElement('link');
  el.rel = rel;
  if (sizes) el.setAttribute('sizes', sizes);
  if (type) el.type = type;
  el.href = href;
  el.setAttribute('data-custom-favicon', 'true');
  document.head.appendChild(el);
  return el;
};

// Helper: remove all favicon links
const removeAllFaviconLinks = () => {
  const existingLinks = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
  existingLinks.forEach((link) => link.remove());
};

// Helper: apply favicon links for a given URL (creates common sizes and apple touch)
const applyFaviconLinks = (iconUrl: string) => {
  // Use the URL as-is — do NOT append a `?v=Date.now()` cache-buster. The icon
  // is a stable asset (a public S3 object, the local fallback, or a signed URL
  // whose signature must be preserved). A per-load cache-buster gives the
  // browser a brand-new URL every load, defeating its cache and forcing a
  // network re-fetch each time; whenever that fetch is slow or fails the
  // browser falls back to /favicon.ico (the Vacademy mark) until the next
  // refresh. Keeping the URL stable lets the browser reuse the cached icon.
  const hrefToUse = iconUrl;

  removeAllFaviconLinks();
  createFaviconLink(hrefToUse, 'icon', '16x16');
  createFaviconLink(hrefToUse, 'icon', '32x32');
  createFaviconLink(hrefToUse, 'icon');
  createFaviconLink(hrefToUse, 'shortcut icon');
  createFaviconLink(hrefToUse, 'apple-touch-icon', '180x180');
};

// Apply tab title and favicon from stored Preferences. Optional fallbackTitle used if no tabText stored.
export const applyTabBranding = async (
  fallbackTitle?: string
): Promise<TabBrandingResult> => {
  try {
    const instituteId = (await Preferences.get({ key: "InstituteId" })).value || "";
    let tabText: string | null = null;
    let iconUrl: string | null = null;
    let fontFamily: string | null = null;

    if (instituteId) {
      const learner = await Preferences.get({ key: `LEARNER_${instituteId}` });
      if (learner?.value) {
        const parsed = JSON.parse(learner.value);
        tabText = parsed?.tabText || null;
        fontFamily = parsed?.fontFamily || null;
        if (parsed?.tabIconFileId) {
          try {
            iconUrl = await getPublicUrlWithoutLogin(parsed.tabIconFileId);
          } catch {
            iconUrl = null;
          }
        }
      }
    }

    // Institute-authored font (Settings > Appearance -> roles.fontFamily) is a
    // SECOND font source, distinct from the domain-level white-label font above.
    // Because applyTabBranding is the single writer of --app-font-family and runs
    // on every route (see __root.tsx), it must honour the Appearance-tab font too
    // — otherwise it resets the body font to the default on the next route and
    // the institute's chosen font (e.g. Lexend) silently never sticks. The
    // domain-level white-label font, when set, still wins; the Appearance-tab
    // font fills in only when there's no white-label override.
    if (!fontFamily) {
      try {
        const raw = localStorage.getItem(THEME_ROLE_SETTINGS_KEY);
        const roleSettings = raw ? JSON.parse(raw) : null;
        fontFamily = roleSettings?.roles?.fontFamily || null;
      } catch {
        // ignore malformed cached theme role settings
      }
    }

    // Update document title
    if (tabText || fallbackTitle) {
      document.title = tabText ?? (fallbackTitle as string);
    }

    // Apply font family if provided, else fall back to default Inter stack.
    // resolveFontStack keeps the Arabic fallback in the chain either way.
    try {
      const resolved = resolveFontStack(fontFamily);
      document.documentElement.style.setProperty("--app-font-family", resolved);
      document.body.style.fontFamily = resolved;
    } catch {
      // Ignore font family errors
    }

    // Ensure we always have some icon to show. On a white-labelled host fall
    // back to a blank icon rather than the Vacademy mark, so a missing/failed
    // institute icon never flashes a competitor's "V".
    if (!iconUrl) {
      iconUrl = getFallbackFavicon();
    }

    // Update favicon via DOM - but only if it's different from current
    const shouldUpdateFavicon = iconUrl !== currentFaviconUrl;
    
    if (shouldUpdateFavicon) {
      console.log('[Branding] Favicon change detected:', currentFaviconUrl, '->', iconUrl);
      currentFaviconUrl = iconUrl;
      
      try {
        applyFaviconLinks(iconUrl);
      } catch (e) {
        console.warn('[Branding] Failed to update favicon links', e);
      }
      
      // Start monitoring to prevent favicon resets
      startFaviconMonitoring();
    } else {
      console.log('[Branding] Favicon unchanged, skipping update');
    }

    lastFaviconRefreshMs = Date.now();
    return { iconUrl, tabText };
  } catch {
    return { iconUrl: null, tabText: null };
  }
};

// Function to monitor and maintain favicon
const startFaviconMonitoring = () => {
  // Clear any existing monitor
  if (faviconMonitorInterval) {
    clearInterval(faviconMonitorInterval);
  }
  
  // Only monitor if we have a custom favicon
  if (!currentFaviconUrl) {
    return;
  }
  
  faviconMonitorInterval = setInterval(async () => {
    try {
      const customFaviconLinks = document.querySelectorAll<HTMLLinkElement>('link[data-custom-favicon="true"]');
      const allFaviconLinks = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
      
      // Check if our custom favicon links are missing or if unwanted favicon links appeared
      const hasCustomFavicons = customFaviconLinks.length > 0;
      const hasUnwantedFavicons = Array.from(allFaviconLinks).some(link => 
        !link.hasAttribute('data-custom-favicon') && 
        (link.href.includes('favicon.ico') || link.href.includes('/favicon'))
      );
      
      // Also refresh periodically to handle expiring signed URLs
      const now = Date.now();
      const isTimeToRefresh = now - lastFaviconRefreshMs > FAVICON_REFRESH_INTERVAL_MS;

      if (!hasCustomFavicons || hasUnwantedFavicons) {
        console.log('[Branding] Favicon reset detected, reapplying custom favicon');
        
        // Remove all favicon links
        allFaviconLinks.forEach(link => link.remove());
        
        // Reapply favicon using the last known URL or fallback
        applyFaviconLinks(currentFaviconUrl || getFallbackFavicon());
        lastFaviconRefreshMs = Date.now();
      } else if (isTimeToRefresh) {
        console.log('[Branding] Periodic favicon refresh');
        try {
          const instituteId = (await Preferences.get({ key: 'InstituteId' })).value || "";
          let nextUrl: string | null = null;
          if (instituteId) {
            const learner = await Preferences.get({ key: `LEARNER_${instituteId}` });
            const parsed = learner?.value ? JSON.parse(learner.value) : null;
            const fileId = parsed?.tabIconFileId || null;
            if (fileId) {
              try {
                nextUrl = await getPublicUrlWithoutLogin(fileId);
              } catch {
                nextUrl = null;
              }
            }
          }
          if (!nextUrl) {
            nextUrl = getFallbackFavicon();
          }
          // Only touch the DOM when the URL actually changed (e.g. a rotated
          // signed URL). Reapplying an identical, stable URL would needlessly
          // re-request the icon — the very churn this fix removes.
          if (nextUrl !== currentFaviconUrl) {
            currentFaviconUrl = nextUrl;
            applyFaviconLinks(nextUrl);
          }
        } catch (e) {
          console.warn('[Branding] Error refreshing favicon URL:', e);
          // Apply fallback on error
          currentFaviconUrl = getFallbackFavicon();
          applyFaviconLinks(currentFaviconUrl);
        }
        lastFaviconRefreshMs = Date.now();
      }
    } catch (e) {
      console.warn('[Branding] Error in favicon monitoring:', e);
    }
  }, 5000); // Check every 5 seconds
};

// Function to stop favicon monitoring (useful for cleanup)
export const stopFaviconMonitoring = () => {
  if (faviconMonitorInterval) {
    clearInterval(faviconMonitorInterval);
    faviconMonitorInterval = null;
  }
};


