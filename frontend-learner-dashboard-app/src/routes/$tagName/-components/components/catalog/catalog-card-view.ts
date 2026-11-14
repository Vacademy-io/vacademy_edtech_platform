/**
 * The EDITORIAL course card (feature 'cards', Figma "Course Card"): config
 * resolution and the card's view model. Pure — no React.
 *
 * Everything is opt-in through courseCatalog.render (types in
 * -types/catalog-cards-types.ts):
 *   render.cardStyle = "editorial"   → resolveCardDesign() is non-null
 *   render.pagination.mode = "loadMore" → resolveLoadMore() is non-null
 *   render.gridHeading = {…}          → resolveGridHeading() is non-null
 * A section without them resolves to null everywhere and keeps its original
 * card, pagination and (absent) heading.
 *
 * `render` is opaque to the site translation, so authored labels stay
 * BASE-language text here and are passed through siteT where shown. Logic
 * keys on raw values only (format keys, package ids, language codes).
 */

import { resolveInviteAvailability } from "@/lib/invite-availability";
import type {
  CatalogCardColors,
  CatalogCardCtaKind,
} from "../../../-types/catalog-cards-types";
import { readComingSoon, type ComingSoonInfo } from "../../../-utils/coming-soon";
import {
  cardFormatKeys,
  type ResolvedCourseFormats,
} from "../../../-utils/course-format";
import { languageOfRow, type CourseLanguageOption } from "../../../-utils/course-variants";
import { isBuyableNowRow, type CardPriceView, type CatalogCard, type CatalogRowLike } from "./catalog-cards";
import type { CatalogStream } from "./catalog-streams";

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CTA_KINDS: readonly CatalogCardCtaKind[] = ["start", "watch", "read", "listen"];

/** A string→string map with non-empty keys and values (keys lower-cased when asked). */
const stringMap = (raw: unknown, lowerKeys = false): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = lowerKeys ? k.trim().toLowerCase() : k.trim();
    const value = text(v);
    if (key && value) out[key] = value;
  }
  return out;
};

export interface ResolvedCardDesign {
  streamLabel: "subtitle" | "title" | "none";
  showStreamIcon: boolean;
  showFormatPill: boolean;
  showFreePill: boolean;
  showLanguageChips: boolean;
  showOtherLanguageTitle: boolean;
  /** format key (lower-case) → short pill text (base language). */
  formatLabels: Record<string, string>;
  /** format key (lower-case) → CTA kind of a free card. */
  freeCtaByFormat: Record<string, CatalogCardCtaKind>;
  /** Authored CTA texts ('' = the translated default). */
  ctaLabels: Record<"paid" | CatalogCardCtaKind | "comingSoon", string>;
  /** '' = the translated "Free". */
  freeLabel: string;
  /** package id → description (base language). */
  descriptions: Record<string, string>;
  colors: CatalogCardColors;
}

/** Validated hex overrides (anything that is not #rgb/#rgba/#rrggbb/#rrggbbaa is dropped). */
export const resolveCardColors = (raw: unknown): CatalogCardColors => {
  const out: CatalogCardColors = {};
  if (!isObject(raw)) return out;
  for (const key of ["divider", "freePrice", "loadMoreBorder"] as const) {
    const value = text(raw[key]);
    if (HEX.test(value)) out[key] = value;
  }
  return out;
};

/** The editorial card config, or null unless render.cardStyle === "editorial". */
export const resolveCardDesign = (render: unknown): ResolvedCardDesign | null => {
  if (!isObject(render) || render.cardStyle !== "editorial") return null;
  const card = isObject(render.card) ? render.card : {};
  const streamLabel =
    card.streamLabel === "title" || card.streamLabel === "none" ? card.streamLabel : "subtitle";
  const freeCtaByFormat: Record<string, CatalogCardCtaKind> = {};
  for (const [key, kind] of Object.entries(stringMap(card.freeCtaByFormat, true))) {
    const k = kind.toLowerCase() as CatalogCardCtaKind;
    if (CTA_KINDS.includes(k)) freeCtaByFormat[key] = k;
  }
  const ctaRaw = isObject(card.ctaLabels) ? card.ctaLabels : {};
  return {
    streamLabel,
    showStreamIcon: card.showStreamIcon !== false,
    showFormatPill: card.showFormatPill !== false,
    showFreePill: card.showFreePill !== false,
    showLanguageChips: card.showLanguageChips !== false,
    showOtherLanguageTitle: card.showOtherLanguageTitle === true,
    formatLabels: stringMap(card.formatLabels, true),
    freeCtaByFormat,
    ctaLabels: {
      paid: text(ctaRaw.paid),
      start: text(ctaRaw.start),
      watch: text(ctaRaw.watch),
      read: text(ctaRaw.read),
      listen: text(ctaRaw.listen),
      comingSoon: text(ctaRaw.comingSoon),
    },
    freeLabel: text(card.freeLabel),
    descriptions: stringMap(card.descriptions),
    colors: resolveCardColors(card.colors),
  };
};

export const DEFAULT_LOAD_MORE_SIZE = 9;

export interface ResolvedLoadMore {
  pageSize: number;
  /** '' = the translated default. */
  loadMoreLabel: string;
  /** '' = the translated default; else base-language text with {{shown}} / {{total}}. */
  countLabel: string;
}

/** Load-more paging, or null unless render.pagination.mode === "loadMore". */
export const resolveLoadMore = (render: unknown): ResolvedLoadMore | null => {
  if (!isObject(render) || !isObject(render.pagination)) return null;
  const p = render.pagination;
  if (p.mode !== "loadMore") return null;
  const n = typeof p.pageSize === "number" ? p.pageSize : Number(p.pageSize);
  const pageSize = Number.isFinite(n) && n >= 1 ? Math.min(60, Math.floor(n)) : DEFAULT_LOAD_MORE_SIZE;
  return { pageSize, loadMoreLabel: text(p.loadMoreLabel), countLabel: text(p.countLabel) };
};

export interface ResolvedGridHeading {
  /** '' = the translated "All courses". */
  title: string;
  showSort: boolean;
  /** sort option value → note (base language). */
  sortLabels: Record<string, string>;
}

/** The "All courses · Sorted by …" row, or null unless render.gridHeading is an object. */
export const resolveGridHeading = (render: unknown): ResolvedGridHeading | null => {
  if (!isObject(render) || !isObject(render.gridHeading)) return null;
  const g = render.gridHeading;
  return { title: text(g.title), showSort: g.showSort !== false, sortLabels: stringMap(g.sortLabels) };
};

/** Fill {{shown}} / {{total}} (and any other {{name}}) in an authored template. */
export const fillTemplate = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );

/* ── Per-card helpers ─────────────────────────────────────────────────── */

/** The first stream (folder order) whose tags the card carries — category-level tags count. */
export const streamOfCard = (
  tagSet: Set<string>,
  streams: readonly CatalogStream[],
): CatalogStream | null => streams.find((s) => s.tags.some((tag) => tagSet.has(tag))) ?? null;

export type CardCtaKind = "paid" | CatalogCardCtaKind | "comingSoon";

/** What the CTA says: coming soon, paid, or the free kind of the card's first format that names one. */
export const ctaKindOf = (
  state: { comingSoon: boolean; free: boolean },
  formatKeys: string[],
  design: Pick<ResolvedCardDesign, "freeCtaByFormat">,
): CardCtaKind => {
  if (state.comingSoon) return "comingSoon";
  if (!state.free) return "paid";
  for (const key of formatKeys) {
    const kind = design.freeCtaByFormat[key];
    if (kind) return kind;
  }
  return "start";
};

export type CardPriceState =
  | { kind: "free" }
  | { kind: "amount"; amount: number; currency?: string }
  | { kind: "comingSoon"; launchDate?: string }
  | { kind: "notStarted" }
  | { kind: "closed" }
  | { kind: "hidden" };

/** The DISPLAYED version's price (no "from", no MRP), or its status. */
export const priceStateOf = (
  row: Pick<CatalogRowLike, "price" | "currency" | "coming_soon" | "enroll_invite_availability">,
  opts: { paymentEnabled: boolean },
): CardPriceState => {
  const comingSoon = readComingSoon(row.coming_soon);
  if (comingSoon) return { kind: "comingSoon", launchDate: comingSoon.launchDate };
  const availability = resolveInviteAvailability(row.enroll_invite_availability);
  if (availability === "NOT_STARTED") return { kind: "notStarted" };
  if (availability !== "AVAILABLE") return { kind: "closed" };
  const amount = typeof row.price === "number" ? row.price : Number(row.price) || 0;
  if (amount === 0) return { kind: "free" };
  if (!opts.paymentEnabled) return { kind: "hidden" };
  return { kind: "amount", amount, currency: row.currency };
};

/**
 * Which version a MERGED card prices by (its Free pill and CTA follow it), so
 * the card never contradicts the grid's price sorts and filters
 * (ctx.priceViews: the cheapest version that matches the filters and can be
 * bought now, which the price sorts order by):
 *  - a price sort is active → that version (the card shows the price it sorts at);
 *  - else the DISPLAYED version (primary) when it matches the filters and can
 *    be bought now — the decision "price of the displayed version" (Figma
 *    shows the EN price and names "Hindi ₹201" in the copy);
 *  - else the matched version (a Free filter shows "Free", not the EN ₹551).
 * Null (single-version card, or nothing on offer) = price the primary as before.
 */
export const editorialPriceRow = <R extends CatalogRowLike>(
  card: Pick<CatalogCard<R>, "primary">,
  view: CardPriceView<R> | null | undefined,
  matchingRows: readonly R[],
  priceSort: boolean,
): R | null => {
  if (!view) return null;
  if (priceSort) return view.row;
  if (matchingRows.includes(card.primary) && isBuyableNowRow(card.primary)) return card.primary;
  return view.row;
};

/**
 * Raw description: the authored one for any of the card's packages, else the
 * course's. The row mapping writes the "no description" placeholder in the
 * language active at FETCH time, so every loaded language's placeholder is
 * dropped (a Hindi/English switch does not refetch).
 */
export const descriptionOf = (
  rows: Array<Pick<CatalogRowLike, "id" | "package_id" | "description">>,
  primary: Pick<CatalogRowLike, "id" | "package_id" | "description">,
  descriptions: Record<string, string>,
  placeholder: string | readonly string[],
): { text: string; authored: boolean } => {
  const idOf = (r: Pick<CatalogRowLike, "id" | "package_id">) => String(r.package_id || r.id || "");
  const own = descriptions[idOf(primary)];
  if (own) return { text: own, authored: true };
  for (const r of rows) {
    const d = descriptions[idOf(r)];
    if (d) return { text: d, authored: true };
  }
  const live = (primary.description || "").trim();
  const placeholders: readonly string[] = typeof placeholder === "string" ? [placeholder] : placeholder;
  return { text: live && !placeholders.includes(live) ? live : "", authored: false };
};

/** The minimal i18next surface descriptionPlaceholders reads (all optional: mocks and SSR lack them). */
interface PlaceholderI18n {
  languages?: readonly string[];
  store?: { data?: Record<string, unknown> };
  getFixedT?: (lng: string, ns: string) => (key: string) => unknown;
}

const NO_DESCRIPTION_KEY = "courseCatalog.noDescriptionAvailable";

/**
 * The "no description" placeholder in the current language AND every loaded
 * one (the row mapping wrote it in whichever language was active at fetch).
 */
export const descriptionPlaceholders = (
  current: string,
  i18n: PlaceholderI18n | null | undefined,
): string[] => {
  const out = new Set<string>([current, NO_DESCRIPTION_KEY]);
  try {
    const langs = new Set<string>([...(i18n?.languages ?? []), ...Object.keys(i18n?.store?.data ?? {})]);
    if (typeof i18n?.getFixedT === "function") {
      for (const lng of langs) {
        const value = i18n.getFixedT(lng, "coursePlayerB")(NO_DESCRIPTION_KEY);
        if (typeof value === "string" && value.trim()) out.add(value.trim());
      }
    }
  } catch {
    // Best effort: the current language's placeholder is still dropped.
  }
  return [...out].filter(Boolean);
};

/** The title of another-language version (first row in a different language with a different title). */
export const otherLanguageTitleOf = <R extends CatalogRowLike>(
  card: Pick<CatalogCard<R>, "rows" | "primary">,
  languages: CourseLanguageOption[],
): string | null => {
  const own = languageOfRow(card.primary, languages)?.code ?? null;
  for (const row of card.rows) {
    if (row === card.primary) continue;
    const lang = languageOfRow(row, languages)?.code ?? null;
    if (lang && lang !== own && row.title && row.title !== card.primary.title) return row.title;
  }
  return null;
};

/** Base-language pill texts of the card's formats (short label when authored). At most two, "E-Learning · Live". */
export const formatPillParts = (
  rows: CatalogRowLike[],
  formats: ResolvedCourseFormats | null,
  formatLabels: Record<string, string>,
): { keys: string[]; labels: string[] } => {
  const keys = cardFormatKeys(rows, formats);
  const labels = keys
    .slice(0, 2)
    .map((key) => formatLabels[key] || formats?.byKey.get(key)?.label || "")
    .filter(Boolean);
  return { keys, labels };
};

/* ── The view model the card renders ──────────────────────────────────── */

export interface EditorialCardView {
  title: string;
  description: string;
  /** Media id or URL; null = the placeholder band. */
  image: string | null;
  imageFit: "cover" | "contain";
  /** Olive pill top-start ("Free"), null = none. */
  freePill: string | null;
  /** White pill top-end ("E-book"), null = none. Replaced by the ribbon when coming soon. */
  formatPill: string | null;
  comingSoon: ComingSoonInfo | null;
  stream: { label: string; imageUrl: string | null; accentColor: string | null } | null;
  languages: { code: string; label: string; active: boolean }[];
  otherTitle: string | null;
  price: { text: string; tone: "price" | "free" | "status" } | null;
  ctaLabel: string;
  colors: CatalogCardColors;
}

export interface EditorialCardDeps {
  design: ResolvedCardDesign;
  formats: ResolvedCourseFormats | null;
  streams: readonly CatalogStream[];
  /** Site course languages (chip labels). */
  languages: CourseLanguageOption[];
  /** The language whose chip is bold (site locale / single language filter). */
  activeLanguage: string | null;
  paymentEnabled: boolean;
  imageFit: "cover" | "contain";
  /** Site dictionary (authored + live text → visitor language). */
  siteT: (s: string) => string;
  /** UI strings (react-i18next, coursePlayerB). */
  t: (key: string, opts?: Record<string, unknown> | string) => string;
  /** Money in the visitor's locale (₹551, no decimals for whole amounts). */
  formatAmount: (amount: number, currency?: string) => string;
  /** Launch date label of a coming-soon course, or null. */
  formatLaunch: (date?: string) => string | null;
  /** The "no description" placeholder(s) the row mapping writes (see descriptionPlaceholders). */
  descriptionPlaceholder: string | readonly string[];
}

const isRealImage = (value: unknown): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  !value.includes("/api/placeholder/") &&
  value !== "null" &&
  value !== "undefined";

/**
 * A catalogue card → what the editorial card shows. `opts` = renderCourseCard's
 * options (sections' free strip) plus `priceRow`: the version whose price the
 * grid sorts and filters by (a merged card's CardPriceView row). The price,
 * the Free pill and the CTA kind come from it — still no "from" — while the
 * title, image, stream and description stay the displayed (primary) version's.
 */
export const buildEditorialCardView = <R extends CatalogRowLike & { thumbnail?: string }>(
  card: Pick<CatalogCard<R>, "rows" | "primary" | "languages" | "tagSet">,
  deps: EditorialCardDeps,
  opts?: { ctaLabel?: string; imageBadge?: string; priceRow?: R | null },
): EditorialCardView => {
  const { design, siteT, t } = deps;
  const course = card.primary;
  const comingSoon = readComingSoon(course.coming_soon);
  const priceState = comingSoon
    ? priceStateOf(course, { paymentEnabled: deps.paymentEnabled })
    : priceStateOf(opts?.priceRow ?? course, { paymentEnabled: deps.paymentEnabled });
  const free = priceState.kind === "free";
  const freeText = design.freeLabel ? siteT(design.freeLabel) : t("catalogCards.free", "Free");

  const { keys: formatKeys, labels: formatLabels } = formatPillParts(card.rows, deps.formats, design.formatLabels);
  const formatPill =
    design.showFormatPill && formatLabels.length ? formatLabels.map((l) => siteT(l)).join(" · ") : null;

  const stream = design.streamLabel === "none" ? null : streamOfCard(card.tagSet, deps.streams);
  const streamText = stream
    ? design.streamLabel === "title"
      ? stream.title || stream.subtitle
      : stream.subtitle || stream.title
    : "";

  const description = descriptionOf(card.rows, course, design.descriptions, deps.descriptionPlaceholder);

  let price: EditorialCardView["price"] = null;
  switch (priceState.kind) {
    case "free":
      price = { text: freeText, tone: "free" };
      break;
    case "amount":
      price = { text: deps.formatAmount(priceState.amount, priceState.currency), tone: "price" };
      break;
    case "comingSoon": {
      const launch = deps.formatLaunch(priceState.launchDate);
      price = {
        text: launch ? t("comingSoon.launchingOn", { date: launch }) : t("comingSoon.ribbon"),
        tone: "status",
      };
      break;
    }
    case "notStarted":
      price = { text: t("courseCatalog.openSoon"), tone: "status" };
      break;
    case "closed":
      price = { text: t("courseCatalog.enrollmentClosed"), tone: "status" };
      break;
    case "hidden":
      price = null;
      break;
  }

  const kind = ctaKindOf({ comingSoon: !!comingSoon, free }, formatKeys, design);
  const CTA_DEFAULTS: Record<CardCtaKind, [string, string]> = {
    paid: ["catalogCards.ctaPaid", "View course"],
    start: ["catalogCards.ctaStart", "Start free"],
    watch: ["catalogCards.ctaWatch", "Watch free"],
    read: ["catalogCards.ctaRead", "Read free"],
    listen: ["catalogCards.ctaListen", "Listen free"],
    comingSoon: ["comingSoon.notifyMe", "Notify me"],
  };
  const authoredCta =
    kind === "comingSoon" ? comingSoon?.buttonText || design.ctaLabels.comingSoon : design.ctaLabels[kind];
  const ctaLabel = opts?.ctaLabel
    ? opts.ctaLabel
    : authoredCta
      ? siteT(authoredCta)
      : t(CTA_DEFAULTS[kind][0], CTA_DEFAULTS[kind][1]);

  const freePill = comingSoon
    ? null
    : opts?.imageBadge
      ? opts.imageBadge
      : design.showFreePill && free
        ? freeText
        : null;

  return {
    title: siteT(course.title),
    description: description.text ? siteT(description.text) : "",
    image: isRealImage(course.thumbnail) ? course.thumbnail : null,
    imageFit: deps.imageFit,
    freePill,
    formatPill: comingSoon ? null : formatPill,
    comingSoon,
    stream: stream
      ? {
          label: streamText ? siteT(streamText) : "",
          imageUrl: design.showStreamIcon ? stream.imageUrl ?? null : null,
          accentColor: stream.accentColor ?? null,
        }
      : null,
    languages: design.showLanguageChips
      ? card.languages.map((l) => ({
          code: l.code,
          label: siteT(l.label || l.code.toUpperCase()),
          active: !!deps.activeLanguage && l.code === deps.activeLanguage,
        }))
      : [],
    otherTitle: design.showOtherLanguageTitle ? otherLanguageTitleOf(card, deps.languages) : null,
    price,
    ctaLabel,
    colors: design.colors,
  };
};
