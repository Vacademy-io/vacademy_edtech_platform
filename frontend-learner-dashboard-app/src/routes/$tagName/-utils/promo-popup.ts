/**
 * Promo popup (page-builder block "promoPopup"): the rules that decide whether
 * a visitor sees it — the schedule window, how often it may come back, and the
 * countdown to the offer's end. Pure, so they are unit tested without a DOM;
 * PromoPopup.tsx wires them to timers, scroll and storage.
 *
 * Dates are the editor's `datetime-local` strings ("2026-10-31T23:59"), read
 * in the visitor's own clock — the same convention as the countdownTimer block.
 */

export const PROMO_TEMPLATES = ["spotlight", "split", "poster", "ticket", "corner", "bar", "custom"] as const;
export type PromoTemplate = (typeof PROMO_TEMPLATES)[number];

/** Centred dialogs that dim the page; corner and bar sit at the edge and leave it usable. */
export const MODAL_TEMPLATES: ReadonlySet<PromoTemplate> = new Set(["spotlight", "split", "poster", "ticket", "custom"]);

export const PROMO_FREQUENCIES = ["always", "session", "daily", "weekly", "once"] as const;
export type PromoFrequency = (typeof PROMO_FREQUENCIES)[number];

export const PROMO_TRIGGERS = ["delay", "scroll", "exit"] as const;
export type PromoTrigger = (typeof PROMO_TRIGGERS)[number];

export type PromoDevices = "all" | "desktop" | "mobile";

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

export const normalizeTemplate = (value: unknown): PromoTemplate => pick(value, PROMO_TEMPLATES, "spotlight");
export const normalizeFrequency = (value: unknown): PromoFrequency => pick(value, PROMO_FREQUENCIES, "session");
export const normalizeTrigger = (value: unknown): PromoTrigger => pick(value, PROMO_TRIGGERS, "delay");
export const normalizeDevices = (value: unknown): PromoDevices =>
  pick(value, ["all", "desktop", "mobile"] as const, "all");

/** A whole number of seconds in [min, max]; anything unreadable is the fallback. */
export const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** Epoch ms of an editor date, or null when it is empty or not a date. */
export const parsePromoDate = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** Inside the start / end window. An unset bound is open; a bad date is ignored. */
export const isWithinSchedule = (startDate: unknown, endDate: unknown, now: number): boolean => {
  const start = parsePromoDate(startDate);
  const end = parsePromoDate(endDate);
  if (start !== null && now < start) return false;
  if (end !== null && now >= end) return false;
  return true;
};

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Time left until `end`, or null once it has passed. */
export const countdownParts = (end: number, now: number): CountdownParts | null => {
  const diff = end - now;
  if (diff <= 0) return null;
  const total = Math.floor(diff / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
};

/* ── how often it comes back ─────────────────────────────────────────── */

type KeyStore = Pick<Storage, "getItem" | "setItem">;

const DAY_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS: Partial<Record<PromoFrequency, number>> = { daily: DAY_MS, weekly: 7 * DAY_MS };

/** One key per site and block, so two popups (or two institutes on one
 *  browser) never silence each other. */
export const promoStorageKey = (instituteId: string, componentId: string): string =>
  `vacademy:promo:${instituteId || "site"}:${componentId}`;

interface SeenRecord {
  at: number;
  converted?: boolean;
}

const readRecord = (store: KeyStore | null, key: string): SeenRecord | null => {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SeenRecord>;
    return typeof parsed?.at === "number" ? { at: parsed.at, converted: parsed.converted === true } : null;
  } catch {
    return null;
  }
};

/**
 * May the popup show again? `session` is remembered in sessionStorage (a new
 * tab or a closed browser starts over); the rest in localStorage. A visitor
 * who clicked the offer never sees it again unless it is set to every visit.
 * Storage that throws (private mode, blocked cookies) never hides the offer.
 */
export const canShowAgain = (
  frequency: PromoFrequency,
  key: string,
  now: number,
  stores: { local: KeyStore | null; session: KeyStore | null },
): boolean => {
  if (frequency === "always") return true;
  if (frequency === "session") {
    const record = readRecord(stores.session, key);
    return !record && !readRecord(stores.local, key)?.converted;
  }
  const record = readRecord(stores.local, key);
  if (!record) return true;
  if (record.converted || frequency === "once") return false;
  return now - record.at >= (COOLDOWN_MS[frequency] ?? 0);
};

/** Remember that the visitor closed the popup, or (converted) clicked its button. */
export const rememberSeen = (
  frequency: PromoFrequency,
  key: string,
  now: number,
  stores: { local: KeyStore | null; session: KeyStore | null },
  converted = false,
): void => {
  if (frequency === "always") return;
  const value = JSON.stringify({ at: now, ...(converted ? { converted: true } : {}) });
  try {
    stores.session?.setItem(key, value);
    if (frequency !== "session" || converted) stores.local?.setItem(key, value);
  } catch {
    /* storage full or blocked: the popup simply may show again */
  }
};

/** The browser's stores, or null where touching them throws (sandboxed frames). */
export const browserStores = (): { local: KeyStore | null; session: KeyStore | null } => {
  const get = (name: "localStorage" | "sessionStorage"): KeyStore | null => {
    try {
      return typeof window !== "undefined" ? window[name] : null;
    } catch {
      return null;
    }
  };
  return { local: get("localStorage"), session: get("sessionStorage") };
};

/** How far down the page the visitor has scrolled, 0–100. A page too short to
 *  scroll counts as fully read. */
export const scrollPercent = (scrollY: number, viewportHeight: number, documentHeight: number): number => {
  const room = documentHeight - viewportHeight;
  if (room <= 0) return 100;
  return Math.min(100, Math.max(0, (scrollY / room) * 100));
};

/** Digits only, for a wa.me link. */
export const whatsappDigits = (phone: unknown): string => (typeof phone === "string" ? phone.replace(/\D/g, "") : "");

/* ── custom HTML template ────────────────────────────────────────────── */

const STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi;

/**
 * The custom template takes ONE box: markup with its own <style> blocks, as an
 * admin pastes it from a design tool or an AI. Split it into the markup and the
 * CSS so each goes through its own scrubber (catalogue-html) — the sanitizer
 * would otherwise drop the <style> tags and every rule with them.
 */
export const splitHtmlAndCss = (source: unknown): { html: string; css: string } => {
  if (typeof source !== "string" || !source.trim()) return { html: "", css: "" };
  const css: string[] = [];
  const html = source.replace(STYLE_RE, (_m, rules: string) => {
    css.push(rules);
    return "";
  });
  return { html: html.trim(), css: css.join("\n").trim() };
};

/** "2d 05:42:17", or "05:42:17" on the last day — for data-vacademy="countdown". */
export const formatCountdown = (parts: CountdownParts): string => {
  const two = (n: number) => String(n).padStart(2, "0");
  const clock = `${two(parts.hours)}:${two(parts.minutes)}:${two(parts.seconds)}`;
  return parts.days > 0 ? `${parts.days}d ${clock}` : clock;
};
