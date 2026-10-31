/**
 * courseCatalog.columnSections (feature 'sections'): untrusted JSON → the
 * blocks the results column shows, plus the pure rules behind them. Pure;
 * never throws; malformed entries are dropped.
 *
 *  - free-courses: "New here? Start free" — free cards (picked ids first, then
 *    by popularity) rendered with the grid's own card renderer;
 *  - spotlight: a flagship programme panel (a carousel with > 1 slide);
 *  - coming-soon: folder-library categories flagged coming soon.
 */

import type {
  CatalogColumnSectionConfig,
  ColumnSectionPlacement,
  ColumnSectionShowWhen,
  SpotlightColors,
  SpotlightCtaConfig,
  SpotlightSlideConfig,
} from "../../../-types/catalog-sections-types";
import type { CatalogCard, CatalogRowLike } from "./catalog-cards";
import { rowMatchesPrice } from "./catalog-filters";
import { formatAmountLabel } from "./catalog-format";
import { sortCatalogCards } from "./catalog-sort";
import type { CatalogCategory, CatalogStream } from "./catalog-streams";

/* ── resolved shapes ─────────────────────────────────────────────────── */

interface ResolvedBase {
  id: string;
  placement: ColumnSectionPlacement;
  showWhen: ColumnSectionShowWhen;
  /** '' = none (or the translated default where the block has one). */
  title: string;
  subtitle: string;
}

export interface ResolvedCtaRule {
  formats: string[];
  tags: string[];
  label: string;
}

export interface ResolvedFreeSection extends ResolvedBase {
  kind: "free-courses";
  /** null = the translated default ("See all {count} free"); '' = no link. */
  seeAllLabel: string | null;
  courseIds: string[];
  limit: number;
  /** '' = the translated default ("Start free"). */
  ctaLabel: string;
  ctaRules: ResolvedCtaRule[];
  /** null = the translated default ("Free"); '' = no pill. */
  badgeText: string | null;
}

export interface ResolvedSpotlightSlide {
  id: string;
  eyebrow: string;
  streamSlug: string;
  eyebrowSuffix: string;
  title: string;
  titleNative: string;
  description: string;
  cta: SpotlightCtaConfig | null;
  steps: ResolvedSpotlightStep[];
}

export interface ResolvedSpotlightStep {
  title: string;
  meta: string;
  tone: "accent" | "default";
  route: string;
  audienceId: string;
}

export interface ResolvedSpotlightSection extends ResolvedBase {
  kind: "spotlight";
  slides: ResolvedSpotlightSlide[];
  autoplayMs: number;
  colors: SpotlightColors;
}

export interface ResolvedComingSoonSection extends ResolvedBase {
  kind: "coming-soon";
  /** '' = the translated "Notify me". */
  notifyLabel: string;
  scope: "all" | "active-stream";
  categorySlugs: string[];
  limit: number;
  iconColor: string | null;
}

export type ResolvedColumnSection = ResolvedFreeSection | ResolvedSpotlightSection | ResolvedComingSoonSection;

/* ── small readers ───────────────────────────────────────────────────── */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
/** null when absent / not a string; '' kept (an author's "hide this"). */
const optStr = (v: unknown): string | null => (typeof v === "string" ? v.trim() : null);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : [];
const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};
/** #rgb / #rrggbb / #rrggbbaa only — values go into inline styles. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const safeColor = (v: unknown): string | undefined => {
  const s = str(v);
  return HEX.test(s) ? s : undefined;
};

/** An authored id / code: no whitespace and no markup characters. */
const ID_LIKE = /^[^\s<>"'{}]+$/;

const PLACEMENTS: ColumnSectionPlacement[] = ["before-grid", "after-grid"];
const SHOW_WHEN: ColumnSectionShowWhen[] = ["unfiltered", "always", "unfiltered-or-own-stream"];
const CTA_ACTIONS: SpotlightCtaConfig["action"][] = ["course", "product-page", "navigate", "open-form"];

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const base = (
  raw: Obj,
  id: string,
  defaults: { placement: ColumnSectionPlacement; showWhen: ColumnSectionShowWhen },
): ResolvedBase => {
  let showWhen = pick(raw.showWhen, SHOW_WHEN, defaults.showWhen);
  // 'own stream' only means something for slides tied to a stream.
  if (showWhen === "unfiltered-or-own-stream" && raw.kind !== "spotlight") showWhen = "unfiltered";
  return {
    id,
    placement: pick(raw.placement, PLACEMENTS, defaults.placement),
    showWhen,
    title: str(raw.title),
    subtitle: str(raw.subtitle),
  };
};

const resolveCta = (raw: unknown): SpotlightCtaConfig | null => {
  if (!isObj(raw)) return null;
  const label = str(raw.label);
  const action = pick(raw.action, CTA_ACTIONS, "course");
  if (!label) return null;
  const cta: SpotlightCtaConfig = { label, action };
  for (const key of [
    "price",
    "courseId",
    "enrollInviteId",
    "packageSessionId",
    "productPageCode",
    "route",
    "audienceId",
    "formTitle",
  ] as const) {
    const value = str(raw[key]);
    if (value) cta[key] = value;
  }
  // An unfilled placeholder ("<package id>") or a pasted sentence is not an
  // id: treat it as absent rather than send visitors to a broken page.
  for (const key of ["courseId", "enrollInviteId", "packageSessionId", "productPageCode"] as const) {
    if (cta[key] && !ID_LIKE.test(cta[key]!)) delete cta[key];
  }
  // An action without its target does nothing: drop the button.
  if (action === "course" && !cta.courseId) return null;
  if (action === "product-page" && !cta.productPageCode) return null;
  if (action === "navigate" && !cta.route) return null;
  if (action === "open-form" && !cta.audienceId) return null;
  return cta;
};

const resolveSlide = (raw: unknown, index: number): ResolvedSpotlightSlide | null => {
  if (!isObj(raw)) return null;
  const title = str(raw.title);
  if (!title) return null;
  const steps: ResolvedSpotlightStep[] = (Array.isArray(raw.steps) ? raw.steps : [])
    .filter(isObj)
    .map((s) => ({
      title: str(s.title),
      meta: str(s.meta),
      tone: s.tone === "accent" ? ("accent" as const) : ("default" as const),
      route: str(s.route),
      audienceId: str(s.audienceId),
    }))
    .filter((s) => s.title)
    .slice(0, 4);
  return {
    id: str(raw.id) || `slide-${index + 1}`,
    eyebrow: str(raw.eyebrow),
    streamSlug: str(raw.streamSlug),
    eyebrowSuffix: str(raw.eyebrowSuffix),
    title,
    titleNative: str(raw.titleNative),
    description: str(raw.description),
    cta: resolveCta(raw.cta),
    steps,
  };
};

/** courseCatalog.columnSections → valid sections, in authoring order (unknown kinds, missing/duplicate ids dropped). */
export const resolveColumnSections = (raw: unknown): ResolvedColumnSection[] => {
  if (!Array.isArray(raw)) return [];
  const out: ResolvedColumnSection[] = [];
  const seen = new Set<string>();
  for (const entry of raw as unknown[]) {
    if (!isObj(entry)) continue;
    const id = str(entry.id);
    if (!id || seen.has(id)) continue;
    if (entry.kind === "free-courses") {
      const rules = (Array.isArray(entry.ctaRules) ? entry.ctaRules : [])
        .filter(isObj)
        .map((r) => ({
          formats: strList(r.formats).map((f) => f.toLowerCase()),
          tags: strList(r.tags).map((t) => t.toLowerCase()),
          label: str(r.label),
        }))
        .filter((r) => r.label && (r.formats.length || r.tags.length));
      out.push({
        ...base(entry, id, { placement: "before-grid", showWhen: "unfiltered" }),
        kind: "free-courses",
        seeAllLabel: optStr(entry.seeAllLabel),
        courseIds: strList(entry.courseIds),
        limit: clampInt(entry.limit, 1, 6, 3),
        ctaLabel: str(entry.ctaLabel),
        ctaRules: rules,
        badgeText: optStr(entry.badgeText),
      });
    } else if (entry.kind === "spotlight") {
      const slides = (Array.isArray(entry.slides) ? entry.slides : [])
        .map(resolveSlide)
        .filter((s): s is ResolvedSpotlightSlide => !!s)
        .slice(0, 6);
      if (!slides.length) continue;
      const rawColors = isObj(entry.colors) ? entry.colors : {};
      const colors: SpotlightColors = {};
      for (const key of ["panelColor", "ringColor", "dotColor", "accentInkColor", "accentColor"] as const) {
        const c = safeColor(rawColors[key]);
        if (c) colors[key] = c;
      }
      out.push({
        ...base(entry, id, { placement: "before-grid", showWhen: "unfiltered" }),
        kind: "spotlight",
        slides,
        // Below 2 s a slide cannot be read: treated as off.
        autoplayMs: ((ms) => (ms >= 2000 ? ms : 0))(clampInt(entry.autoplayMs, 0, 60000, 0)),
        colors,
      });
    } else if (entry.kind === "coming-soon") {
      const rawColors = isObj(entry.colors) ? entry.colors : {};
      out.push({
        ...base(entry, id, { placement: "after-grid", showWhen: "always" }),
        kind: "coming-soon",
        notifyLabel: str(entry.notifyLabel),
        scope: entry.scope === "all" ? "all" : "active-stream",
        categorySlugs: strList(entry.categorySlugs).map((s) => s.toLowerCase()),
        limit: clampInt(entry.limit, 1, 12, 4),
        iconColor: safeColor(rawColors.iconColor) ?? null,
      });
    } else {
      continue;
    }
    seen.add(id);
  }
  return out;
};

/** Re-export for callers that only know the authored type. */
export type { CatalogColumnSectionConfig };

/* ── when a section shows ────────────────────────────────────────────── */

export interface ColumnView {
  activeStreamSlug: string | null;
  searchTerm: string;
  filterBadgeCount: number;
  currentPage: number;
}

/** The plain "All" view: no stream tab, no search, no filter, first page (the sort does not count). */
export const isUnfilteredView = (v: ColumnView): boolean =>
  !v.activeStreamSlug && !v.searchTerm.trim() && v.filterBadgeCount === 0 && v.currentPage <= 1;

/** Only a stream tab narrows the view (no search, no filter, first page). */
const isOwnStreamView = (v: ColumnView): boolean =>
  !!v.activeStreamSlug && !v.searchTerm.trim() && v.filterBadgeCount === 0 && v.currentPage <= 1;

/** Does the section show at all in this view? */
export const sectionShown = (section: ResolvedColumnSection, view: ColumnView): boolean => {
  if (section.showWhen === "always") return true;
  if (isUnfilteredView(view)) return true;
  if (section.showWhen === "unfiltered-or-own-stream" && section.kind === "spotlight") {
    return spotlightSlidesFor(section, view).length > 0;
  }
  return false;
};

/** The slides a spotlight shows: all of them, or on a stream tab ('unfiltered-or-own-stream') only that stream's. */
export const spotlightSlidesFor = (section: ResolvedSpotlightSection, view: ColumnView): ResolvedSpotlightSlide[] => {
  if (section.showWhen === "always" || isUnfilteredView(view)) return section.slides;
  if (section.showWhen === "unfiltered-or-own-stream" && isOwnStreamView(view)) {
    const slug = (view.activeStreamSlug || "").toLowerCase();
    return section.slides.filter((s) => s.streamSlug.toLowerCase() === slug);
  }
  return [];
};

/* ── free courses ────────────────────────────────────────────────────── */

const isFreeCard = <R extends CatalogRowLike>(card: CatalogCard<R>): boolean =>
  card.rows.some((row) => rowMatchesPrice(row, { kind: "free" }));

const rowIds = (row: CatalogRowLike): string[] =>
  [row.id, row.package_id, row.packageSessionId, row.package_session_id]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

/**
 * The free cards: the picked ids first (a card matches when its course id or
 * any version's package / package-session id is listed), then the other free
 * cards by popularity. `total` counts every free card ("See all {count} free").
 */
export const pickFreeCards = <R extends CatalogRowLike>(
  cards: CatalogCard<R>[],
  cfg: Pick<ResolvedFreeSection, "courseIds" | "limit">,
  opts: { ranks: Map<string, number>; titleOf: (card: CatalogCard<R>) => string },
): { cards: CatalogCard<R>[]; total: number } => {
  const free = cards.filter(isFreeCard);
  const picked: CatalogCard<R>[] = [];
  for (const id of cfg.courseIds) {
    const card = free.find(
      (c) => !picked.includes(c) && (c.courseId === id || c.rows.some((row) => rowIds(row).includes(id))),
    );
    if (card) picked.push(card);
  }
  const rest = sortCatalogCards(
    free.filter((c) => !picked.includes(c)),
    "Popular",
    opts,
  );
  return { cards: [...picked, ...rest].slice(0, cfg.limit), total: free.length };
};

/** The CTA label of a free card: the first rule whose formats / tags match it, else the section's. '' = the default. */
export const freeCtaLabelFor = (
  cfg: Pick<ResolvedFreeSection, "ctaRules" | "ctaLabel">,
  card: { tagSet: Set<string> },
  formatKeys: string[],
): string => {
  const keys = new Set(formatKeys.map((k) => k.toLowerCase()));
  const rule = cfg.ctaRules.find(
    (r) => r.formats.some((f) => keys.has(f)) || r.tags.some((t) => card.tagSet.has(t)),
  );
  return rule?.label || cfg.ctaLabel;
};

/** "See all {count} free" → "See all 7 free" (the template is translated first, then filled). */
export const fillCount = (template: string, count: number): string =>
  template.replace(/\{count\}/g, String(count));

/* ── spotlight ───────────────────────────────────────────────────────── */

/** The catalogue row a spotlight CTA points at (same course, and the same session when one is given). */
export const spotlightRow = <R extends CatalogRowLike>(cta: SpotlightCtaConfig | null, rows: R[]): R | null => {
  if (!cta) return null;
  const sessionOf = (row: R) => row.packageSessionId || row.package_session_id || "";
  return (
    rows.find((row) => {
      if (cta.packageSessionId && sessionOf(row) === cta.packageSessionId) return true;
      return !cta.packageSessionId && !!cta.courseId && (row.id === cta.courseId || row.package_id === cta.courseId);
    }) ?? null
  );
};

/** A live amount (catalogue row or enroll-invite plan). 0 = free. */
export interface LiveAmount {
  amount: number;
  currency: string | null;
}

/** The live amount of a catalogue row: its price, 0 when the catalogue counts it free, else null. */
export const rowAmount = (row: CatalogRowLike | null): LiveAmount | null => {
  if (!row) return null;
  const currency = typeof row.currency === "string" && row.currency.trim() ? row.currency : null;
  const price = typeof row.price === "number" ? row.price : Number(row.price);
  if (Number.isFinite(price) && price > 0) return { amount: price, currency };
  if (rowMatchesPrice(row, { kind: "free" })) return { amount: 0, currency };
  return null;
};

/** The parts of an open enroll-invite (open/learner/enroll-invite) the spotlight reads. */
export interface SpotlightInviteLike {
  currency?: string | null;
  package_session_to_payment_options?: Array<{
    package_session_id?: string | null;
    status?: string | null;
    payment_option?: {
      type?: string | null;
      payment_plans?: Array<{ actual_price?: number | null; currency?: string | null }> | null;
    } | null;
  }> | null;
}

/**
 * The live amount an invite charges for a package session: the cheapest plan
 * of that session's entry (entry [0] when the session is not named or not
 * listed, as the course page does); a FREE payment option is 0. null = the
 * invite names no price.
 */
export const inviteAmount = (
  invite: SpotlightInviteLike | null | undefined,
  packageSessionId: string | null | undefined,
): LiveAmount | null => {
  const entries = Array.isArray(invite?.package_session_to_payment_options)
    ? invite!.package_session_to_payment_options!.filter(Boolean)
    : [];
  if (!entries.length) return null;
  const forSession = packageSessionId ? entries.filter((e) => e.package_session_id === packageSessionId) : [];
  const isActive = (status: unknown) => !status || String(status).toUpperCase() === "ACTIVE";
  const entry = forSession.find((e) => isActive(e.status)) ?? forSession[0] ?? entries[0];
  const option = entry?.payment_option;
  const inviteCurrency = typeof invite?.currency === "string" && invite.currency.trim() ? invite.currency : null;
  if (String(option?.type ?? "").toUpperCase() === "FREE") return { amount: 0, currency: inviteCurrency };
  const plans = (Array.isArray(option?.payment_plans) ? option!.payment_plans! : []).filter(
    (p) => p && typeof p.actual_price === "number" && Number.isFinite(p.actual_price) && p.actual_price >= 0,
  );
  if (!plans.length) return null;
  const cheapest = plans.reduce((a, b) => ((b.actual_price as number) < (a.actual_price as number) ? b : a));
  return {
    amount: cheapest.actual_price as number,
    currency: (typeof cheapest.currency === "string" && cheapest.currency.trim() ? cheapest.currency : null) ?? inviteCurrency,
  };
};

export interface SpotlightPriceText {
  /** What {price} becomes: the formatted amount, the free label, the authored price, or null (no price). */
  value: string | null;
  /** The live price is 0: the CTA drops its "for {price}", steps say the free label. */
  free: boolean;
}

/**
 * {price} of a spotlight: the live amount (catalogue row, else the CTA's
 * invite) when known — formatted, or the free label at 0 — else the authored
 * price, else null.
 */
export const spotlightPrice = (
  cta: SpotlightCtaConfig | null,
  live: LiveAmount | null,
  locale: string,
  freeLabel: string,
): SpotlightPriceText => {
  if (live && live.amount > 0) return { value: formatAmountLabel(live.amount, live.currency, locale), free: false };
  if (live && live.amount === 0) return { value: freeLabel, free: true };
  return { value: cta?.price || null, free: false };
};

/**
 * Fills {price}; without a price the token goes, with an English "for" before
 * it ("Enrol for {price}" → "Enrol").
 */
export const fillPrice = (template: string, price: string | null): string => {
  if (price !== null) return template.replace(/\{price\}/g, price);
  return template
    .replace(/\s*\bfor\s+\{price\}/gi, "")
    .replace(/\{price\}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

/** Next / previous slide, wrapping around. */
export const wrapIndex = (index: number, count: number): number =>
  count <= 0 ? 0 : ((index % count) + count) % count;

/* ── coming soon ─────────────────────────────────────────────────────── */

export interface ComingSoonItem {
  category: CatalogCategory;
  stream: CatalogStream;
}

/**
 * The coming-soon categories to show: categories flagged coming soon that
 * have a notify form, from every stream — or only the active stream's with
 * scope 'active-stream' on a stream tab. With categorySlugs, only those, in
 * that order.
 */
export const comingSoonItems = (
  streams: CatalogStream[],
  cfg: Pick<ResolvedComingSoonSection, "scope" | "categorySlugs" | "limit">,
  activeStreamSlug: string | null,
): ComingSoonItem[] => {
  const scoped =
    cfg.scope === "active-stream" && activeStreamSlug
      ? streams.filter((s) => s.slug.toLowerCase() === activeStreamSlug.toLowerCase())
      : streams;
  const all: ComingSoonItem[] = scoped.flatMap((stream) =>
    stream.categories
      .filter((category) => category.comingSoon && !!category.audienceId)
      .map((category) => ({ category, stream })),
  );
  const ordered = cfg.categorySlugs.length
    ? cfg.categorySlugs.flatMap((slug) => {
        const item = all.find((i) => i.category.slug.toLowerCase() === slug);
        return item ? [item] : [];
      })
    : all;
  return ordered.slice(0, cfg.limit);
};

/** Two labels as one line, the second dropped when it says the same thing (a Hindi view of "शिक्षा · Education"). */
export const distinctParts = (...parts: string[]): string[] => {
  const out: string[] = [];
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    if (!out.some((p) => p.toLowerCase() === part.toLowerCase())) out.push(part);
  }
  return out;
};

/** Spotlight eyebrow parts: the authored eyebrow, then the stream subtitle (or the authored suffix). */
export const spotlightEyebrowParts = (
  slide: Pick<SpotlightSlideConfig, "eyebrow" | "eyebrowSuffix">,
  stream: Pick<CatalogStream, "subtitle" | "title"> | null,
  siteT: (s: string) => string,
): string[] =>
  distinctParts(
    slide.eyebrow || "",
    stream ? siteT(stream.subtitle || stream.title) : slide.eyebrowSuffix || "",
  );
