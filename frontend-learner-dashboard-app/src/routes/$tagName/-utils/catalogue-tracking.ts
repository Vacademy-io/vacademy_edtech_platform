import { useEffect } from "react";
import { BASE_URL } from "@/constants/urls";
import { captureUtmOnce, getStoredUtm } from "@/lib/utm-attribution";

/**
 * Tracking for institute catalogue sites — GA4 / Meta Pixel / GTM, configured
 * per-site in the page builder (Global Settings → Tracking & Analytics,
 * stored as globalSettings.tracking in the catalogue JSON).
 *
 * WHY THIS EXISTS: these sites had zero measurement — no pixel, no analytics,
 * no conversion events — so an institute buying Meta/Google ads could neither
 * optimise campaigns on enquiries nor answer "did the website work?". Scripts
 * inject only on catalogue routes (this hook lives in the two catalogue page
 * shells), never on the learner LMS surface.
 *
 * Every capture surface dispatches `vacademy:lead-captured` on success; this
 * hook forwards it as a GA4 `generate_lead` and a Meta `Lead` event.
 */

export interface TrackingSettings {
  ga4MeasurementId?: string;
  metaPixelId?: string;
  gtmId?: string;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean };
    _fbq?: unknown;
  }
}

/** The page editor's preview (`?preview=true`) is an admin looking at a
 *  draft, not a visitor: no analytics event and no GA4/GTM/Pixel from it.
 *  Checked here, at the lowest level, so every caller is covered. */
const isEditorPreview = (): boolean =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("preview") === "true";

const once = (id: string): boolean => {
  if (document.getElementById(id)) return false;
  return true;
};

const injectGa4 = (measurementId: string) => {
  if (!once("vac-ga4")) return;
  const s = document.createElement("script");
  s.id = "vac-ga4";
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  // gtag must push `arguments` (an Arguments object), not a spread array —
  // GA's snippet contract.
  // eslint-disable-next-line prefer-rest-params
  window.gtag = function gtag() { window.dataLayer!.push(arguments); } as never;
  window.gtag("js", new Date());
  window.gtag("config", measurementId);
};

const injectGtm = (gtmId: string) => {
  if (!once("vac-gtm")) return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const s = document.createElement("script");
  s.id = "vac-gtm";
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
  document.head.appendChild(s);
};

const injectMetaPixel = (pixelId: string) => {
  if (!once("vac-fbq")) return;
  const marker = document.createElement("meta");
  marker.id = "vac-fbq";
  document.head.appendChild(marker);
  // Standard Meta base code, minus the IIFE wrapper.
  const f = window as Window;
  if (!f.fbq) {
    const n: Window["fbq"] = function (...args: unknown[]) {
      (n as { callMethod?: (...a: unknown[]) => void }).callMethod
        ? (n as unknown as { callMethod: (...a: unknown[]) => void }).callMethod(...args)
        : n!.queue!.push(args);
    } as never;
    n!.queue = [];
    n!.loaded = true;
    f.fbq = n;
    f._fbq = n;
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
  }
  f.fbq!("init", pixelId);
  f.fbq!("track", "PageView");
};

export interface LeadCapturedDetail {
  audienceId?: string;
  sourceType?: string;
  sourceId?: string;
}

/** Fired by every capture surface after a successful submission. */
export const emitLeadCaptured = (detail: LeadCapturedDetail) => {
  try {
    window.dispatchEvent(new CustomEvent("vacademy:lead-captured", { detail }));
  } catch {
    /* never let telemetry break a submission */
  }
};

export const useCatalogueTracking = (tracking?: TrackingSettings | null) => {
  const ga4 = tracking?.ga4MeasurementId?.trim();
  const pixel = tracking?.metaPixelId?.trim();
  const gtm = tracking?.gtmId?.trim();

  useEffect(() => {
    if (isEditorPreview()) return;
    if (ga4) injectGa4(ga4);
    if (gtm) injectGtm(gtm);
    if (pixel) injectMetaPixel(pixel);
  }, [ga4, pixel, gtm]);

  useEffect(() => {
    if (!ga4 && !pixel && !gtm) return;
    const onLead = (e: Event) => {
      const d = (e as CustomEvent<LeadCapturedDetail>).detail || {};
      try {
        window.gtag?.("event", "generate_lead", {
          source_type: d.sourceType,
          source_id: d.sourceId,
          audience_id: d.audienceId,
        });
        window.fbq?.("track", "Lead", { content_name: d.sourceId });
        window.dataLayer?.push({ event: "lead_submitted", ...d });
      } catch {
        /* telemetry only */
      }
    };
    window.addEventListener("vacademy:lead-captured", onLead);
    return () => window.removeEventListener("vacademy:lead-captured", onLead);
  }, [ga4, pixel, gtm]);
};

/**
 * First-touch UTM capture.
 *
 * Re-exported from `@/lib/utm-attribution` rather than reimplemented: this file
 * used to own its own copy of the store, so a UTM captured on a catalogue page
 * was invisible to every other capture surface (and vice versa). One store, one
 * key — see the header comment there.
 */
export { captureUtmOnce, getStoredUtm };

/* ─── First-party page analytics ─────────────────────────────────────────
 * GA4 and Pixel above are the institute's OWN tools; most never connect one,
 * and even when they do the data lives somewhere we cannot join to the leads
 * in our database. This beacon is the first-party half: it lets the admin
 * dashboard answer "how many arrived, from where, and how many converted"
 * without any setup.
 *
 * Deliberately minimal on the wire — no identifiers are sent. The visitor
 * hash is derived server-side from IP + user-agent against a daily-rotating
 * salt, so this call carries nothing that identifies a person. */

const SESSION_KEY = "vacademy_cat_sid";

/** Per browsing session, not per person: cleared when the tab closes. */
const sessionId = (): string => {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return ""; // private mode — the view still counts, the session does not
  }
};

const deviceClass = (): string => {
  try {
    return window.matchMedia("(max-width: 767px)").matches
      ? "mobile"
      : window.matchMedia("(max-width: 1024px)").matches
        ? "tablet"
        : "desktop";
  } catch {
    return "desktop";
  }
};

export interface CatalogueEventInput {
  instituteId: string;
  catalogueId?: string;
  /** '' for the site root, otherwise the page's route slug. */
  pageRoute?: string;
  eventType?: "VIEW" | "CTA" | "LEAD";
}

/**
 * Send one analytics event. Uses sendBeacon so it survives the page being
 * navigated away from — a plain fetch is cancelled on unload, which loses
 * exactly the bounce views that matter most. Falls back to keepalive fetch.
 */
export const sendCatalogueEvent = (input: CatalogueEventInput): void => {
  try {
    if (!input?.instituteId || isEditorPreview()) return;
    const utm = getStoredUtm();
    const body = JSON.stringify({
      instituteId: input.instituteId,
      catalogueId: input.catalogueId,
      pageRoute: input.pageRoute ?? "",
      eventType: input.eventType ?? "VIEW",
      sessionId: sessionId(),
      referrer: document.referrer || undefined,
      utmSource: utm.utm_source,
      utmMedium: utm.utm_medium,
      utmCampaign: utm.utm_campaign,
      device: deviceClass(),
    });
    const url = `${BASE_URL}/admin-core-service/open/v1/catalogue-analytics/event`;
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
    /* analytics must never break a page */
  }
};

/** Record one page view. Re-fires when the route changes (SPA navigation). */
export const useCataloguePageView = (input: CatalogueEventInput | null): void => {
  const instituteId = input?.instituteId;
  const catalogueId = input?.catalogueId;
  const pageRoute = input?.pageRoute ?? "";
  useEffect(() => {
    if (!instituteId) return;
    sendCatalogueEvent({ instituteId, catalogueId, pageRoute, eventType: "VIEW" });
  }, [instituteId, catalogueId, pageRoute]);
};
