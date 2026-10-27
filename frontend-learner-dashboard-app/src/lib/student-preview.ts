/**
 * Admin live preview of the learner app.
 *
 * Settings → Student Display in the admin dashboard embeds this app in an
 * iframe (`?vx_preview=1`) and streams the UNSAVED draft of
 * STUDENT_DISPLAY_SETTINGS and THEME_SETTING to it over postMessage, so an
 * admin sees what a learner will see before pressing Save.
 *
 * Safety rules this file keeps:
 * - Preview mode only exists inside the admin's named preview iframe
 *   (PREVIEW_FRAME_NAME). A normal tab, the native app and any other frame of
 *   this origin never read a draft.
 * - Drafts live in sessionStorage (scoped to the admin's tab), never in the
 *   localStorage caches the real learner app reads — so a learner session in
 *   another tab of the same browser is never affected.
 * - Only messages from the parent window on an admin origin are accepted
 *   (see isAllowedPreviewOrigin). A draft can only change how this frame
 *   renders; it carries no data and grants no access.
 */

import { THEME_ROLE_SETTINGS_KEY } from "@/types/theme-role-settings";

export const PREVIEW_MESSAGE_SOURCE = "vx-student-preview";
export const PREVIEW_QUERY_PARAM = "vx_preview";
/**
 * The admin's preview <iframe name>. window.name belongs to that one frame and
 * survives its reloads and in-frame navigation, so it marks the preview frame
 * without leaking into other frames of this origin in the same tab (Manage
 * Pages previews share this origin's sessionStorage).
 */
export const PREVIEW_FRAME_NAME = "vx-student-preview";

const DRAFT_KEY = "vx_preview_draft";
// The admin origin that drove this frame, validated when its first message
// arrived. Kept because the frame reloads itself to apply a draft, and after
// that reload document.referrer is gone.
const PARENT_ORIGIN_KEY = "vx_preview_parent";

export interface StudentPreviewDraft {
  /** STUDENT_DISPLAY_SETTINGS data (unsaved). */
  display?: Record<string, unknown> | null;
  /** THEME_SETTING data (unsaved) — same shape as the themeRoleSettings cache. */
  theme?: Record<string, unknown> | null;
  /** Brand colour: a preset theme code or a "#rrggbb" hex. */
  brand?: string | null;
}

const isFramed = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin parent: accessing window.top throws, which still means framed.
    return true;
  }
};

/** True when this window is the admin's live-preview frame. */
export function isStudentPreviewMode(): boolean {
  if (typeof window === "undefined" || !isFramed()) return false;
  try {
    return window.name === PREVIEW_FRAME_NAME;
  } catch {
    return false;
  }
}

/** The current unsaved draft, or null outside preview mode. */
export function readStudentPreviewDraft(): StudentPreviewDraft | null {
  if (!isStudentPreviewMode()) return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as StudentPreviewDraft) : null;
  } catch {
    return null;
  }
}

const SECOND_LEVEL = new Set(["co", "com", "ac", "org", "net", "edu", "gov"]);

/** Approximate registrable domain: "learner.myschool.com" → "myschool.com". */
export function siteOf(host: string): string {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const tld = parts[parts.length - 1]!;
  const sld = parts[parts.length - 2]!;
  const take = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return parts.slice(-take).join(".");
}

/** Admin dashboards that may drive the preview, besides the institute's own. */
const VACADEMY_ADMIN_HOSTS = ["dash.vacademy.io"];

/**
 * Only an admin dashboard may drive the preview:
 * - the shared Vacademy admin (dash.vacademy.io) and white-label admins on
 *   vacademy.io, whose subdomain says so (acme-admin, admin-acme…);
 * - the institute's own admin host (admin_portal_base_url, e.g.
 *   admin.myschool.com), passed in as `adminHosts`;
 * - on a custom domain, any host of the same site (learner.x.com ↔ admin.x.com).
 *   On vacademy.io that rule is skipped — every institute's learner site is
 *   *.vacademy.io, so "same site" would let one institute's pages drive another's.
 * - localhost only in a dev build.
 */
export function isAllowedPreviewOrigin(
  origin: string,
  selfHost: string,
  options: { adminHosts?: string[]; dev?: boolean } = {}
): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1") return !!options.dev;
  if (VACADEMY_ADMIN_HOSTS.includes(host)) return true;
  if (options.adminHosts?.some((h) => h.toLowerCase() === host)) return true;
  if (host.endsWith(".vacademy.io")) {
    return /(^|-)admin(-|$)/.test(host.slice(0, -".vacademy.io".length));
  }
  const site = siteOf(host);
  return site !== "vacademy.io" && site === siteOf(selfHost);
}

/** The institute's admin host from the cached institute details, if known. */
function cachedAdminHosts(): string[] {
  try {
    const raw = localStorage.getItem("CapacitorStorage.InstituteDetails");
    const details = raw ? JSON.parse(raw) : null;
    const url: unknown = details?.admin_portal_base_url ?? details?.adminPortalBaseUrl;
    if (typeof url !== "string" || !url.trim()) return [];
    const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return [new URL(withProtocol).hostname];
  } catch {
    return [];
  }
}

// Replies go to the admin that drove us, never "*": the first accepted
// message fixes it; before that only the referrer's origin (the page that
// framed us) gets the "ready" announcement.
let parentOrigin: string | null = null;
const storedParentOrigin = (): string | null => {
  try {
    return sessionStorage.getItem(PARENT_ORIGIN_KEY);
  } catch {
    return null;
  }
};
const referrerOrigin = (): string | null => {
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
};

const postToParent = (payload: Record<string, unknown>) => {
  const target = parentOrigin ?? storedParentOrigin() ?? referrerOrigin();
  if (!target) return;
  try {
    window.parent.postMessage({ source: PREVIEW_MESSAGE_SOURCE, ...payload }, target);
  } catch {
    // noop
  }
};

let installed = false;

/**
 * Wire the preview frame: accept drafts from the admin, reload to apply them
 * (every settings reader re-runs on boot, so a reload is the one way that
 * reaches all of them) and announce readiness so the admin sends the draft.
 * No-op outside preview mode.
 */
export function installStudentPreviewBridge(): void {
  if (installed || !isStudentPreviewMode()) return;
  installed = true;

  let reloadTimer: number | undefined;
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { source?: string; type?: string } & StudentPreviewDraft;
    if (!data || data.source !== PREVIEW_MESSAGE_SOURCE) return;
    if (event.source !== window.parent) return;
    if (
      !isAllowedPreviewOrigin(event.origin, window.location.hostname, {
        adminHosts: cachedAdminHosts(),
        dev: import.meta.env.DEV,
      })
    ) {
      return;
    }
    parentOrigin = event.origin;
    try {
      sessionStorage.setItem(PARENT_ORIGIN_KEY, event.origin);
    } catch {
      // noop
    }

    if (data.type === "draft") {
      const next = JSON.stringify({
        display: data.display ?? null,
        theme: data.theme ?? null,
        brand: data.brand ?? null,
      });
      let prev: string | null = null;
      try {
        prev = sessionStorage.getItem(DRAFT_KEY);
        if (prev === next) return; // already applied — no reload loop
        sessionStorage.setItem(DRAFT_KEY, next);
      } catch {
        return;
      }
      window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => window.location.reload(), 120);
    } else if (data.type === "clear") {
      try {
        if (sessionStorage.getItem(DRAFT_KEY) === null) return;
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        return;
      }
      window.location.reload();
    }
  });

  postToParent({ type: "ready", path: window.location.pathname });
}

/** Tell the admin which page the preview is on. No-op outside preview mode. */
export function notifyStudentPreviewRoute(path: string): void {
  if (!installed) return;
  postToParent({ type: "route", path });
}

/**
 * Raw THEME_SETTING JSON as every theme reader expects it: the preview draft's
 * theme inside the admin's preview frame, the cached institute theme otherwise.
 */
export function readThemeRoleSettingsRaw(): string | null {
  const theme = readStudentPreviewDraft()?.theme;
  if (theme) return JSON.stringify(theme);
  try {
    return localStorage.getItem(THEME_ROLE_SETTINGS_KEY);
  } catch {
    return null;
  }
}
