import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Gift,
  ArrowRight,
  BookOpen,
  CaretLeft,
  CaretRight,
  Check,
  Clock,
  Funnel,
  MagnifyingGlass,
  ShoppingCartSimple,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { PriceWithMrp, formatPriceAmount } from "@/components/common/price-with-mrp";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import {
  accentFromTheme,
  celebrateSavingOnce,
} from "@/routes/product-pages/$productPageCode/-utils/celebrate-saving";
import { handleGetProductPage } from "@/routes/product-pages/$productPageCode/-services/product-page-service";
import { useCourseTerms } from "@/routes/$tagName/-utils/catalogue-naming";
import {
  parseBasketPricing,
  nextTier,
  quoteBasket,
} from "@/routes/product-pages/$productPageCode/-utils/basket-pricing";
import {
  clearCourseFinderOptions,
  clearCourseFinderSelection,
  courseFinderScope,
  loadCourseFinderSelection,
  publishCourseFinderOptions,
  subscribeCourseFinderApplied,
  type CourseFinderSelectionPayload,
} from "../../-utils/course-finder-bus";
import type { GlobalSettings } from "../../-types/course-catalogue-types";
import { useCatalogueLocale, useSiteT } from "../../-utils/catalogue-locale";
import { courseLanguagesOf } from "../../-utils/course-variants";
import { isSiteCartEnabled } from "../../-utils/site-cart";
import { SiteCartDrawer } from "../site-cart/SiteCartDrawer";
import { openSiteCartDrawer } from "../site-cart/site-cart-events";
import { cartItemFromMapping } from "../site-cart/site-cart-items";
import { pageSells, storeCartRoute } from "../site-cart/store-sale";
import { useStoreSale } from "../site-cart/use-store-sale";
import {
  useFallbackCartReopen,
  useHasSiteCartOpener,
  useSiteCart,
  useSiteCartNotifier,
} from "../site-cart/use-site-cart";
import { RAIL_CLONE_PROPS, useAutoScrollRail } from "../../-utils/use-auto-scroll-rail";

/**
 * Product Page Offer — surfaces a Product Page's sellable courses on a
 * catalogue (marketing) page, with a direct route into checkout.
 *
 * WHY IT READS LIVE: a Product Page `update` soft-deletes and re-inserts ALL
 * of its invite mappings (no diffing), so any course list cached in this
 * component's props would silently go stale the moment an admin re-saves the
 * page. We only persist the page CODE and fetch the courses at render time.
 *
 * The endpoint is the anonymous `open/v1/product-page/by-code`, so this works
 * for logged-out visitors — which is the whole point of a marketing page.
 *
 * WHY NOT CatalogueLink: that component is for catalogue *page slugs* — it
 * lowercases the route and prefixes the current `$tagName`, which turned
 * `/product-pages/x?instituteId=…` into `/book-store/product-pages/x?instituteid=…`
 * (404, plus search params the product-page route could no longer read). Product
 * pages are a top-level app route, so we link to them with the typed router
 * Link and let it serialise the search params with their exact casing.
 */

interface ProductPageMapping {
  id: string;
  ps_invite_payment_option_id: string;
  package_session_id: string;
  /** Package (course) id — the details page's route param. */
  package_id?: string;
  enroll_invite_id?: string;
  package_name?: string;
  level_name?: string;
  session_name?: string;
  course_preview_image_media_id?: string;
  about_the_course_html?: string;
  /** Comma-separated course tags (CBSE, ICSE, …). */
  tags?: string;
  display_order?: number;
  status?: string;
  payment_plan?: {
    actual_price?: number;
    elevated_price?: number;
    currency?: string;
    validity_in_days?: number;
  } | null;
}

interface ProductPageOfferProps {
  productPageCode?: string;
  title?: string;
  subtitle?: string;
  columns?: number;
  /** 'grid' wraps onto rows; 'carousel' is a single swipeable horizontal row. */
  layout?: "grid" | "carousel";
  /** Section header alignment. 'left' reads as an app-style rail heading. */
  align?: "center" | "left";
  /** 'md' is the compact app-style header; 'lg' the full marketing header. */
  headerScale?: "md" | "lg";
  /** "See all" link in the header, straight to the product page itself. */
  showViewAll?: boolean;
  viewAllLabel?: string;
  ctaLabel?: string;
  /**
   * Turns the per-card CTA into an add-to-cart toggle so several subjects can
   * be collected here and taken to checkout together, instead of each card
   * jumping straight into checkout with one course. Off by default — existing
   * catalogues keep the single-course "Enrol now" behaviour.
   */
  enableCart?: boolean;
  /** Label for the add-to-cart CTA when enableCart is on. */
  cartCtaLabel?: string;
  /** Label on the basket bar's primary button when enableCart is on. */
  checkoutCtaLabel?: string;
  /**
   * Second CTA that opens the course's catalogue details page instead of
   * dropping straight into checkout. Needs the mapping's package id, so it
   * silently degrades to the single enrol CTA when the backend has none.
   */
  showViewCourse?: boolean;
  viewCourseLabel?: string;
  showImage?: boolean;
  showChips?: boolean;
  showDescription?: boolean;
  showValidity?: boolean;
  showPrice?: boolean;
  /** Courses per page. 0 (or unset) renders every course with no pager. */
  pageSize?: number;
  /** Search box — auto-hidden when the page has only a handful of courses. */
  showSearch?: boolean;
  /**
   * Cards rendered in a 'carousel' rail before it hands off to the product
   * page. 0 renders every course in one row. Ignored when pageSize is set —
   * that is already an explicit per-page count.
   */
  railMaxCards?: number;
  /** Cap the grid's height and scroll inside it instead of growing the page. */
  scrollable?: boolean;
  /** 'carousel' only: advance the rail one card every autoScrollIntervalMs (min 1.5s), pausing while in use. */
  autoScroll?: boolean;
  autoScrollIntervalMs?: number;
  /** With autoScroll: an endless ring instead of rewinding to the first card at the end. */
  autoScrollLoop?: boolean;
  scrollMaxHeight?: number;
  backgroundColor?: string;
  /**
   * Rendered inside another section (a folder of the Folder Browser) rather
   * than as a page section of its own: no section padding or background, so it
   * flows in its host's band instead of opening a second one.
   */
  embedded?: boolean;
  instituteId?: string;
  /** Catalogue slug — the details page lives at /{tagName}/{courseId}. */
  tagName?: string;
  /** Admin canvas passes this so the section always renders something. */
  isPreviewMode?: boolean;
  /**
   * The site's settings, from the renderer. With a site cart
   * (globalSettings.siteCart) the add-to-cart CTA fills the SITE's cart — for
   * the courses its store page sells; the others link to this product page's
   * checkout — and this section shows no basket bar of its own. Without one —
   * or without this prop — the section keeps its own basket exactly as before.
   */
  globalSettings?: Partial<GlobalSettings>;
}

/** Below this a search box is noise rather than help. */
const SEARCH_MIN_COURSES = 8;

/**
 * Default length of a horizontal rail, overridable per section via the
 * `railMaxCards` prop (0 = no cap). A rail is a browse teaser, not a
 * catalogue: pageSize 0 ("show everything") on a 127-course product page
 * produced a single row of 127 cards.
 */
const DEFAULT_RAIL_MAX_CARDS = 12;

// Backend stores sentinel level/session names ("default", "DEFAULT") on
// packages the admin never levelled — they are placeholders, not information,
// and rendering them as chips reads as broken data. Same rule as the main
// course catalog: hide sentinels, title-case genuine values.
const SENTINEL_CHIP_VALUES = new Set(["default", "none", "null", "undefined", ""]);

const toChipCase = (raw: string): string =>
  raw
    .trim()
    .split(/\s+/)
    .map((w) => (w === w.toUpperCase() && w.length > 3 ? w.charAt(0) + w.slice(1).toLowerCase() : w))
    .join(" ");

const displayChips = (values: (string | undefined)[]): string[] => {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const trimmed = v.trim();
    if (SENTINEL_CHIP_VALUES.has(trimmed.toLowerCase())) continue;
    const label = toChipCase(trimmed);
    if (!out.some((c) => c.toLowerCase() === label.toLowerCase())) out.push(label);
  }
  return out;
};

/** Tags arrive as one comma-separated string ("cbse, ncert"). */
const splitTags = (raw?: string): string[] =>
  (raw || "").split(",").map((t) => t.trim()).filter(Boolean);

/**
 * Course tags render exactly as the admin authored them — toChipCase is for
 * level/session names (it rewrites "CBSE" to "Cbse", which is wrong for a tag
 * the institute deliberately spelled that way). Level/session keep their
 * existing sentinel + casing treatment; both are deduped case-insensitively.
 */
const mergeChips = (tags: string[], rest: string[]): string[] => {
  const out: string[] = [];
  for (const v of [...tags, ...rest]) {
    const trimmed = (v || "").trim();
    if (!trimmed || SENTINEL_CHIP_VALUES.has(trimmed.toLowerCase())) continue;
    if (!out.some((c) => c.toLowerCase() === trimmed.toLowerCase())) out.push(trimmed);
  }
  return out;
};

/** A card has room for a couple of chips before the row rhythm breaks. */
const CARD_CHIP_LIMIT = 3;

/** "Summer Sprint 2.0 - Class 6" → "SS" — the monogram for imageless tiles. */
const initialsOf = (title: string): string =>
  title
    .trim()
    .split(/\s+/)
    .filter((w) => /^[a-z0-9]/i.test(w))
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("") || "•";

/** Strips HTML and clamps the course blurb to a card-sized teaser. */
const toPlainText = (html?: string, max = 160): string => {
  if (!html) return "";
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
};

/** "12 months access" / "90 days access" from the plan's validity. */
const formatValidity = (days?: number): string => {
  if (!days || days <= 0) return "";
  if (days % 365 === 0) {
    const y = days / 365;
    return `${y} year${y > 1 ? "s" : ""} access`;
  }
  if (days >= 60 && days % 30 === 0) {
    const m = days / 30;
    return `${m} month${m > 1 ? "s" : ""} access`;
  }
  return `${days} days access`;
};

/**
 * Branded fallback tile. Most catalogues have no preview image on most
 * courses, and a grid of empty grey rectangles reads as broken — a titled
 * brand-tinted tile reads as designed.
 */
const CoursePlaceholder: React.FC<{ title: string }> = ({ title }) => (
  // Committed brand tint with a MONOGRAM, not the course title: the real title
  // renders directly under the tile, so printing it inside the tile too made
  // every imageless card read its own name twice. A big two-letter monogram
  // gives each tile identity without the echo.
  <div className="relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-catalogue-lg bg-gradient-to-br from-primary-200 via-primary-100 to-primary-50">
    <span className="catalogue-h2 select-none font-bold tracking-wide-08 text-catalogue-brand-ink opacity-90" aria-hidden="true">
      {initialsOf(title)}
    </span>
    <BookOpen
      weight="duotone"
      className="absolute bottom-2.5 right-3 size-4 text-catalogue-brand-ink opacity-60"
      aria-hidden="true"
    />
  </div>
);

const CourseImage: React.FC<{ mediaId?: string; alt: string }> = ({ mediaId, alt }) => {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setUrl("");
    if (!mediaId) return;
    if (mediaId.startsWith("http")) {
      setUrl(mediaId);
      return;
    }
    getPublicUrlWithoutLogin(mediaId)
      .then((u) => { if (alive && u) setUrl(u); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [mediaId]);

  if (!mediaId || failed) return <CoursePlaceholder title={alt} />;

  // Reserve the band either way so cards don't reflow when images resolve.
  return (
    // No zoom on hover: course covers carry their title and text to the edges,
    // and scaling the image inside this clipped band cut them off.
    <div className="aspect-[16/9] w-full overflow-hidden rounded-catalogue-lg bg-catalogue-bg-muted">
      {url && (
        <FitImage
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="size-full"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
};

/** Compact windowed pager: ‹ 1 … 4 5 6 … 20 › */
const buildPageWindow = (current: number, total: number): (number | "gap")[] => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push("gap");
    out.push(p);
  });
  return out;
};

export const ProductPageOfferComponent: React.FC<ProductPageOfferProps> = ({
  productPageCode,
  title,
  subtitle,
  columns,
  layout = "grid",
  align,
  headerScale,
  showViewAll = false,
  viewAllLabel,
  ctaLabel,
  enableCart = false,
  cartCtaLabel,
  checkoutCtaLabel,
  showViewCourse = true,
  viewCourseLabel,
  showImage = true,
  showChips = true,
  showDescription = true,
  showValidity = true,
  showPrice = true,
  pageSize = 9,
  railMaxCards,
  showSearch = true,
  scrollable = false,
  autoScroll = false,
  autoScrollIntervalMs,
  autoScrollLoop = false,
  scrollMaxHeight = 640,
  backgroundColor,
  embedded = false,
  instituteId,
  tagName,
  isPreviewMode = false,
  globalSettings,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const terms = useCourseTerms();
  const courseTerm = terms.course;
  const coursesTerm = terms.courses;
  // Course names (live data) in the visitor's language — display only.
  const siteT = useSiteT();
  const { data, isLoading, isError } = useQuery({
    ...handleGetProductPage(productPageCode || "", instituteId || ""),
  });

  // ─── Site-wide cart ────────────────────────────────────────────────────────
  // When the site has one, "Add to cart" puts the course in the SITE's cart
  // (one version per course — adding the Hindi version swaps out the English
  // one) and the header's cart is the basket, so this section renders no
  // basket bar and keeps no basket of its own. Otherwise nothing changes.
  const siteCartOn = enableCart && isSiteCartEnabled(globalSettings?.siteCart) && !!instituteId;
  const localCartOn = enableCart && !siteCartOn;
  const siteCart = useSiteCart(instituteId, siteCartOn);
  const notifySiteCart = useSiteCartNotifier();
  // The site cart checks out through the store page, so only a course the
  // store sells goes in; any other keeps a link to THIS page's checkout (its
  // own prices and coupons) instead of an add that could never be paid for —
  // unless this page would charge it twice too (see storeCartRoute).
  const storeSale = useStoreSale(instituteId, globalSettings?.siteCart, siteCartOn);
  const ownPageSells = useMemo(() => pageSells(data?.mappings), [data]);
  const { enabled: languagesEnabled, locale, baseLocale } = useCatalogueLocale();
  const siteLang = languagesEnabled && locale !== baseLocale ? locale : undefined;
  const cartLanguages = useMemo(
    () => courseLanguagesOf(globalSettings?.courseLanguages),
    [globalSettings?.courseLanguages],
  );
  // A page with no header cart button (header switched off, or the site
  // chrome hidden) would leave the visitor no way to the cart this section
  // fills: the section then offers "View cart" and its own drawer.
  const hasHeaderCart = useHasSiteCartOpener();
  const [fallbackCartOpen, setFallbackCartOpen] = useState(false);
  const openSiteCart = useCallback(() => {
    if (!openSiteCartDrawer()) setFallbackCartOpen(true);
  }, []);
  const openFallbackCart = useCallback(() => setFallbackCartOpen(true), []);
  useFallbackCartReopen(siteCartOn, openFallbackCart);

  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const isCarousel = layout === "carousel";
  // A rail wants denser cards than a grid: default 4-up so a fifth card peeks
  // in from the edge (the browse cue), 3-up for the grid. Explicit props win.
  const cols = Math.min(Math.max(Number(columns) || (isCarousel ? 4 : 3), 1), 4);
  const gridCols =
    `grid gap-6 grid-cols-1 sm:grid-cols-2 ${cols >= 3 ? "lg:grid-cols-3" : ""} ${cols >= 4 ? "xl:grid-cols-4" : ""}`;

  const mappings: ProductPageMapping[] = useMemo(
    () =>
      ((data?.mappings as unknown as ProductPageMapping[]) || [])
        .filter((m) => (m.status ?? "ACTIVE") === "ACTIVE")
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    [data]
  );

  const searchEnabled = showSearch !== false && mappings.length >= SEARCH_MIN_COURSES;

  // ─── Course Finder wiring ──────────────────────────────────────────────────
  // On a catalogue whose only course block is this one, the page-level Course
  // Finder wizard has nowhere else to source its levels/sessions/tags from, so
  // this block publishes them (see course-finder-bus) and applies whatever the
  // visitor picks. Sourcing the options from the courses actually on sale here
  // means a pick can never select a level with zero matching courses.
  //
  // Seeded from storage, because the wizard only ever opens ONCE per visitor:
  // holding the answer in state alone meant a reload — or the trip into a
  // course details page and back — showed every class's subjects again, with
  // no way to be re-asked. See course-finder-bus.
  const finderScope = courseFinderScope(instituteId, tagName);
  const [finderSelection, setFinderSelection] =
    useState<CourseFinderSelectionPayload | null>(() =>
      isPreviewMode ? null : loadCourseFinderSelection(finderScope),
    );
  // True only for an answer that came from the wizard just now, as opposed to
  // the one restored above. The basket reset below keys off it — see there.
  const finderIsFreshAnswer = useRef(false);

  // "Show all courses" has to forget the answer for good, not just for this
  // render: the wizard opens once per visitor and will not reopen to ask again,
  // so a selection left in storage comes straight back on the next reload.
  const clearFinderSelection = useCallback(() => {
    clearCourseFinderSelection(finderScope);
    setFinderSelection(null);
  }, [finderScope]);

  const finderOptions = useMemo(() => {
    const uniq = (vals: (string | undefined)[]) =>
      [...new Set(vals.filter((v): v is string => !!v && v.trim() !== ""))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((v) => ({ id: v, name: v }));
    return {
      levels: uniq(mappings.map((m) => m.level_name)),
      sessions: uniq(mappings.map((m) => m.session_name)),
      tags: uniq(mappings.flatMap((m) => splitTags(m.tags))),
    };
  }, [mappings]);

  useEffect(() => {
    if (isPreviewMode) return;
    if (mappings.length === 0) return;
    publishCourseFinderOptions(finderOptions);
  }, [isPreviewMode, mappings.length, finderOptions]);

  // Retract the options when this block unmounts, so a catalogue page without
  // one never opens the wizard on a previous page's levels.
  useEffect(() => clearCourseFinderOptions, []);

  useEffect(
    () =>
      subscribeCourseFinderApplied((selection) => {
        finderIsFreshAnswer.current = true;
        setFinderSelection(selection);
      }),
    [],
  );

  // ─── Multi-subject cart ────────────────────────────────────────────────────
  // Collected here rather than in the catalogue's cart-store: that store is
  // built around the book/course catalogue's own checkout (enrollInviteId keys,
  // buy/rent modes, /{tagName}/cart), whereas these courses check out through
  // the product page. Package-session ids are exactly what ?courseIds= expects.
  //
  // Kept in sessionStorage, keyed per product page: "View course" navigates
  // away from the catalogue entirely, and a basket that silently empties on the
  // way back reads as the site losing the visitor's work. sessionStorage, not
  // local — a basket must not outlive the visit that built it.
  const cartStorageKey = productPageCode ? `catalogue-offer-cart:${productPageCode}` : null;

  const [cart, setCart] = useState<string[]>(() => {
    if (!localCartOn || !cartStorageKey) return [];
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(cartStorageKey) || "null");
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      // Private mode / storage disabled — an in-memory basket still works.
      return [];
    }
  });

  useEffect(() => {
    if (!localCartOn || !cartStorageKey) return;
    try {
      window.sessionStorage.setItem(cartStorageKey, JSON.stringify(cart));
    } catch {
      // Nothing to do: the basket lives in state either way.
    }
  }, [localCartOn, cartStorageKey, cart]);

  const toggleCart = (packageSessionId: string) =>
    setCart((prev) =>
      prev.includes(packageSessionId)
        ? prev.filter((id) => id !== packageSessionId)
        : [...prev, packageSessionId],
    );

  // The same toggle against the site-wide cart.
  const toggleSiteCart = async (m: ProductPageMapping) => {
    if (siteCart.has(m.package_session_id)) {
      siteCart.remove(m.package_session_id);
      return;
    }
    const previous = siteCart.items;
    const result = await siteCart.add([
      cartItemFromMapping(m, { languages: cartLanguages, source: { kind: "catalog" } }),
    ]);
    notifySiteCart(result, { previous, onViewCart: openSiteCart });
  };

  // A fresh Course Finder answer means a fresh basket — keeping Class 2 picks
  // after the visitor switches to Class 5 would check them out for a class
  // they are no longer shopping for, with the evidence scrolled out of view.
  //
  // The exception is keepBasket: the picker reopened from the checkout's "Back
  // to courses", where the visitor already has courses selected and came back
  // to ADD another. Resetting there deletes their whole basket the moment they
  // answer, which reads as the site throwing their order away.
  //
  // The RESTORED selection is the same exception by another route. It is not a
  // fresh answer — it is the answer this visitor already gave, replayed after a
  // reload — and the basket beside it was restored from the same visit. Letting
  // this effect fire on the first render would empty the cart every time the
  // page loaded, which is the one thing worse than losing the filter.
  useEffect(() => {
    if (!finderIsFreshAnswer.current) return;
    if (finderSelection && !finderSelection.keepBasket) setCart([]);
  }, [finderSelection]);

  // Resolve the basket against what this page still sells. A restored id whose
  // course has since been retired (a product-page re-save replaces every
  // mapping) would otherwise inflate the count and the total past anything the
  // visitor can see highlighted on screen.
  const selectedMappings = useMemo(
    () => (localCartOn ? mappings.filter((m) => cart.includes(m.package_session_id)) : []),
    [localCartOn, mappings, cart],
  );

  // Prices are hidden wholesale inside Apple's reader-app builds, so the basket
  // shows a count there and no money. See ios-iap-compliance.
  const hidePrices = shouldHidePaidPurchaseUI();

  const cartTotal = useMemo(() => {
    if (selectedMappings.length === 0) return null;
    const currency = selectedMappings.find((m) => m.payment_plan?.currency)?.payment_plan?.currency;
    // Mixed currencies in one basket cannot be summed into one honest number —
    // the product page's own cart is the place that reconciles them.
    const mixed = selectedMappings.some(
      (m) => m.payment_plan?.currency && m.payment_plan.currency !== currency,
    );
    if (mixed) return null;

    // The SAME engine the checkout uses. A product page can price its basket as
    // a whole ("any 3 for ₹799"), and on such a page the courses cost nothing
    // individually — so summing item prices here would quote a total the next
    // screen contradicts. Falls back to the sum when the page prices per course.
    // The plan price rides along: a page priced on the DISCOUNT basis reduces
    // what the courses cost on their enroll invites rather than replacing it,
    // so omitting it left the engine falling back to the ladder's first rung —
    // right only for as long as a ladder happens to still be configured.
    const basket = parseBasketPricing(data?.settings_json);
    const quote = quoteBasket(
      basket,
      selectedMappings.map((m) => ({
        levelName: m.level_name,
        packageName: m.package_name,
        price: m.payment_plan?.actual_price ?? 0,
      })),
    );
    const itemsSum = selectedMappings.reduce(
      (sum, m) => sum + (m.payment_plan?.actual_price || 0),
      0,
    );
    if (quote) {
      return {
        amount: quote.total,
        currency,
        // What the same courses cost bought separately, so the bar can show the
        // saving instead of a bare discounted figure the visitor cannot judge.
        itemTotal: quote.itemTotal,
        saved: Math.max(0, Math.round(quote.itemTotal - quote.total)),
      };
    }
    return { amount: itemsSum, currency, itemTotal: itemsSum, saved: 0 };
  }, [selectedMappings, data?.settings_json]);

  const savedPercent =
    cartTotal && cartTotal.itemTotal > 0
      ? Math.round((cartTotal.saved / cartTotal.itemTotal) * 100)
      : 0;

  // What one more subject would unlock, on a page that prices by tier.
  const tierAhead = useMemo(
    () =>
      nextTier(
        parseBasketPricing(data?.settings_json),
        selectedMappings.length,
        cartTotal?.itemTotal ?? 0,
      ),
    [data?.settings_json, selectedMappings.length, cartTotal?.itemTotal],
  );


  // No bar in site-cart mode: the header's cart is the basket.
  const checkoutBarOpen = localCartOn && selectedMappings.length > 0 && !!productPageCode;

  // The basket bar is position:fixed, but every block on a catalogue page is
  // wrapped by ComponentStyleWrapper, whose entrance animation puts a
  // `transform` on that wrapper — and a transformed ancestor re-anchors
  // position:fixed to itself, which would strand the bar mid-page. So the bar
  // is portalled out of the section.
  //
  // The host is the catalogue's OWN theme wrapper, not document.body: the
  // palette lives in [data-catalogue-theme] plus the inline --primary-* vars
  // on that div (and `dark` for dark mode), so a bar sent to body would paint
  // in the app chrome's colours instead of the institute's.
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const setSectionNode = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    setPortalHost((node.closest("[data-catalogue-theme]") as HTMLElement) || document.body);
  }, []);

  // Celebrate a saving this basket has never reached before.
  //
  // Gated on `data`: the cart rehydrates from sessionStorage synchronously but
  // the page data arrives async, so until it lands the basket reads as empty —
  // and the moment prices arrive would look like a saving just earned. Skipped
  // where prices are hidden: there is nothing on screen to celebrate.
  //
  // The accent is read off the catalogue's own theme wrapper (the portal host),
  // so the burst is the institute's colour rather than ours.
  useEffect(() => {
    if (!data || hidePrices || !productPageCode) return;
    celebrateSavingOnce(
      productPageCode,
      cartTotal?.saved ?? 0,
      accentFromTheme(portalHost),
    );
  }, [data, cartTotal?.saved, hidePrices, portalHost, productPageCode]);

  // Two bars pinned to the bottom of a phone screen would sit on top of each
  // other, and a half-filled basket is the more urgent of the two — so while it
  // is open the catalogue's mobile action bar stands down and the WhatsApp
  // bubble lifts clear. A body class, so neither of them needs to know this
  // component exists.
  useEffect(() => {
    if (!checkoutBarOpen) return;
    document.body.classList.add("catalogue-has-checkout-bar");
    return () => document.body.classList.remove("catalogue-has-checkout-bar");
  }, [checkoutBarOpen]);

  const filtered = useMemo(() => {
    let out = mappings;

    // Case-insensitive on purpose: the wizard's levelGroups are hand-authored
    // in catalogue JSON and drift from the real level names ("Cyber Ai- Class 6"
    // vs "Cyber AI- Class 6"), which under exact matching silently drops every
    // course in that subject.
    if (finderSelection) {
      const norm = (v?: string) => (v || "").trim().toLowerCase();
      const levelSet = new Set(finderSelection.levels.map(norm));
      const sessionSet = new Set(finderSelection.sessions.map(norm));
      const tagSet = new Set(finderSelection.tags.map(norm));

      if (levelSet.size > 0) out = out.filter((m) => levelSet.has(norm(m.level_name)));
      if (sessionSet.size > 0) out = out.filter((m) => sessionSet.has(norm(m.session_name)));
      if (tagSet.size > 0) {
        out = out.filter((m) => splitTags(m.tags).some((t) => tagSet.has(norm(t))));
      }
    }

    const q = query.trim().toLowerCase();
    if (!q || !searchEnabled) return out;
    // The name as shown (translated) matches too; the stored name always does.
    return out.filter((m) =>
      [m.package_name, siteT(m.package_name), m.level_name, m.session_name, ...splitTags(m.tags)]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [mappings, query, searchEnabled, finderSelection, siteT]);

  // 0/unset means "no pager" — render everything.
  const perPage = Number(pageSize) > 0 ? Math.floor(Number(pageSize)) : filtered.length || 1;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  // Derive rather than sync via an effect: a shrinking result set (search)
  // must not leave the pager parked on a page that no longer exists.
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * perPage;
  const paged = filtered.slice(start, start + perPage);
  // An explicit pageSize is an admin decision — respect it. The cap only
  // applies to an uncapped rail, and the admin can raise it or switch it off
  // (0) per section via railMaxCards.
  const railCap = railMaxCards === undefined ? DEFAULT_RAIL_MAX_CARDS : Math.max(Number(railMaxCards) || 0, 0);
  const railCapped = isCarousel && !(Number(pageSize) > 0) && railCap > 0;
  const visible = railCapped ? paged.slice(0, railCap) : paged;
  const railHidden = paged.length - visible.length;

  const goToPage = (p: number) => {
    setPage(Math.min(Math.max(p, 1), totalPages));
    // Keep the viewer at the start of the list they just paged.
    if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    if (trackRef.current) trackRef.current.scrollTo({ left: 0, behavior: "smooth" });
  };

  /** Enable each arrow only when there is actually room to travel that way. */
  const syncArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  const scrollByPage = (dir: number) => {
    const el = trackRef.current;
    if (!el) return;
    // Just under a full viewport keeps a sliver of the previous card visible,
    // which is what tells the visitor the row continues.
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" });
  };

  useEffect(() => {
    if (!isCarousel) return;
    syncArrows();
    window.addEventListener("resize", syncArrows);
    return () => window.removeEventListener("resize", syncArrows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCarousel, visible.length, cols]);

  const { looping } = useAutoScrollRail(trackRef, {
    enabled: isCarousel && !!autoScroll,
    intervalMs: autoScrollIntervalMs,
    itemCount: visible.length,
    loop: !!autoScrollLoop,
  });

  // A horizontal rail IS the app pattern, so unless the admin chose otherwise
  // it gets the app-style header (left, compact) — a big centered heading over
  // an edge-bleeding rail is two design languages in one section.
  const isLeft = align ? align === "left" : isCarousel;
  const compact = headerScale ? headerScale === "md" : isCarousel;

  // Straight to the product page itself — the "there's more here" affordance
  // an app-style rail heading is expected to carry.
  // Carry the Course Finder's pick across. Without this the visitor who just
  // chose "Class 6" here lands on the product page showing every level again.
  // `levels` narrows what is VISIBLE only — unlike courseIds it selects
  // nothing into the cart.
  const seeAllSearch = {
    ...(instituteId ? { instituteId } : {}),
    ...(tagName ? { tagName } : {}),
    // Say which step this link means. Without it the shell falls back to the
    // page's own defaultStep, and a page configured to open on CART turned
    // "see everything" into an empty cart — no courses are passed either, so
    // the visitor landed on "Nothing in your cart yet".
    defaultTab: "CATALOG" as const,
    ...(finderSelection && finderSelection.levels.length > 0
      ? { levels: finderSelection.levels.join(",") }
      : {}),
  };

  const seeAll =
    showViewAll && productPageCode ? (
      <Link
        to="/product-pages/$productPageCode"
        params={{ productPageCode }}
        search={seeAllSearch}
        className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-catalogue-brand-ink no-underline hover:underline"
      >
        {viewAllLabel || t("productPageOffer.seeAll")}
        <ArrowRight className="size-3.5" weight="bold" aria-hidden="true" />
      </Link>
    ) : null;

  const titleClass = compact
    ? "catalogue-h3 text-catalogue-text-primary"
    : "catalogue-h2 text-catalogue-text-primary";
  const subtitleClass = compact
    ? "mt-1 text-sm text-catalogue-text-muted"
    : "catalogue-lead text-catalogue-text-muted";

  // A running count beside the heading. On a four-across rail the basket bar at
  // the foot of the viewport can otherwise be the ONLY evidence that anything
  // is selected, and it is nowhere near the cards being tapped.
  // In site-cart mode: how many of THIS section's courses are in the site cart.
  const selectedCount = siteCartOn
    ? mappings.filter((m) => siteCart.has(m.package_session_id)).length
    : selectedMappings.length;
  const selectedBadge =
    enableCart && selectedCount > 0 ? (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-500 ring-1 ring-primary-100">
        <Check className="size-3.5" weight="bold" aria-hidden="true" />
        {t("productPageOffer.selectedCount", { count: selectedCount })}
      </span>
    ) : null;

  // Site-cart mode on a page without a header cart button: the way to the
  // cart (and its checkout) sits beside the count. Absent everywhere else.
  const siteCartCount = siteCartOn && siteCart.hydrated ? siteCart.items.length : 0;
  const viewCartButton =
    siteCartOn && !hasHeaderCart && siteCartCount > 0 ? (
      <button
        type="button"
        onClick={openSiteCart}
        aria-haspopup="dialog"
        className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm"
      >
        <ShoppingCartSimple className="size-3.5" weight="bold" aria-hidden="true" />
        {t("siteCart.viewCartCount", { count: siteCartCount, defaultValue: "View cart ({{count}})" })}
      </button>
    ) : null;
  const cartStatus =
    selectedBadge || viewCartButton ? (
      <>
        {selectedBadge}
        {viewCartButton}
      </>
    ) : null;

  const header =
    title || subtitle || seeAll || cartStatus ? (
      isLeft ? (
        <div className="catalogue-section-header flex items-end justify-between gap-4 text-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {title && <h2 className={titleClass}>{title}</h2>}
              {cartStatus}
            </div>
            {subtitle && (
              <p className={`${subtitleClass} catalogue-measure-start`}>{subtitle}</p>
            )}
          </div>
          {seeAll}
        </div>
      ) : (
        <div className="catalogue-section-header text-center">
          {title && <h2 className={titleClass}>{title}</h2>}
          {subtitle && <p className={`${subtitleClass} catalogue-measure`}>{subtitle}</p>}
          {(seeAll || cartStatus) && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              {cartStatus}
              {seeAll}
            </div>
          )}
        </div>
      )
    ) : null;

  // What the Course Finder narrowed the list down to, and the way back out of
  // it. Without this the grid shows a fraction of the catalogue with no on-page
  // evidence why — the wizard that caused it closed several scrolls ago, and on
  // a page with search switched off there is no result count either.
  const finderLabels = finderSelection?.labels ?? [];
  const finderChips =
    finderLabels.length > 0 ? (
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-catalogue-text-muted">
          <Funnel className="size-3.5" weight="bold" aria-hidden="true" />
          {t("productPageOffer.finderShowing")}
        </span>
        {finderLabels.map((label) => (
          <span
            key={label}
            className="inline-flex items-center rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-catalogue-brand-ink ring-1 ring-primary-100"
          >
            {label}
          </span>
        ))}
        <button
          type="button"
          onClick={clearFinderSelection}
          className="inline-flex items-center gap-1 text-xs font-semibold text-catalogue-text-muted underline-offset-2 hover:underline"
        >
          <X className="size-3" weight="bold" aria-hidden="true" />
          {t("productPageOffer.finderShowAll", {
            courses: coursesTerm.toLocaleLowerCase(),
          })}
        </button>
      </div>
    ) : null;

  const sectionClass = embedded ? undefined : "catalogue-section bg-catalogue-bg";
  const sectionStyle = backgroundColor && !embedded ? { backgroundColor } : undefined;

  const section = (children: React.ReactNode) => (
    <section className={sectionClass} style={sectionStyle}>
      <div className="catalogue-shell">
        {header}
        {children}
      </div>
    </section>
  );

  const emptyState = (message: string) =>
    section(
      <div className="catalogue-card rounded-catalogue-lg border border-dashed border-catalogue-border p-8 text-center text-sm text-catalogue-text-muted">
        {message}
      </div>
    );

  // ── Not configured yet: guide the admin, stay invisible to visitors ──
  if (!productPageCode) {
    if (!isPreviewMode) return null;
    return emptyState(t("productPageOffer.emptyConfig", { courses: coursesTerm }));
  }

  if (isLoading) {
    return section(
      <div className={gridCols} aria-busy="true">
        {Array.from({ length: cols }, (_, i) => (
          <div key={i} className="catalogue-card-elevated p-5">
            {showImage && <div className="catalogue-skeleton-shimmer mb-4 aspect-[16/9] w-full rounded-catalogue-lg" />}
            <div className="catalogue-skeleton-shimmer mb-2 h-5 w-3/4 rounded-catalogue-xs" />
            <div className="catalogue-skeleton-shimmer mb-4 h-4 w-full rounded-catalogue-xs" />
            <div className="catalogue-skeleton-shimmer h-9 w-full rounded-catalogue-md" />
          </div>
        ))}
      </div>
    );
  }

  // A marketing page should never show a broken or empty band to a visitor.
  if (isError || mappings.length === 0) {
    if (!isPreviewMode) return null;
    return emptyState(
      isError
        ? t("productPageOffer.errorLoad")
        : t("productPageOffer.emptyCourses", { courses: coursesTerm })
    );
  }

  const renderCard = (m: ProductPageMapping, i: number) => {
        const name = siteT(m.package_name) || courseTerm;
        const inCart = siteCartOn
          ? siteCart.has(m.package_session_id)
          : localCartOn && cart.includes(m.package_session_id);
        // Course tags (CBSE / ICSE …) read first — they are what a visitor
        // scans for — then the level/session the batch belongs to.
        const chips = showChips
          ? mergeChips(
              splitTags(m.tags),
              displayChips([m.level_name, m.session_name]),
            )
              .slice(0, CARD_CHIP_LIMIT)
              .map((chip) => siteT(chip))
          : [];
        const blurb = showDescription ? toPlainText(m.about_the_course_html) : "";
        const validity = showValidity ? formatValidity(m.payment_plan?.validity_in_days) : "";

        // package_session_id is the canonical form the funnel matches first;
        // defaultTab=CART drops the visitor straight into checkout with this
        // course already selected.
        const enrolSearch = {
          ...(instituteId ? { instituteId } : {}),
          ...(tagName ? { tagName } : {}),
          courseIds: m.package_session_id,
          defaultTab: "CART" as const,
        };
        const enrolLink = (search: typeof enrolSearch & { lang?: string }) => (
          <Link
            to="/product-pages/$productPageCode"
            params={{ productPageCode }}
            search={search}
            className="catalogue-btn catalogue-btn-primary catalogue-btn-sm flex-1 justify-center whitespace-nowrap no-underline"
            aria-label={`${ctaLabel || t("productPageOffer.enrolNow")} — ${name}`}
          >
            {ctaLabel || t("productPageOffer.enrolNow")}
            <ArrowRight className="size-3.5" weight="bold" aria-hidden="true" />
          </Link>
        );
        // Site-cart mode: into the site cart only when the store sells it.
        const cartRoute = siteCartOn ? storeCartRoute(storeSale, [m.package_session_id], ownPageSells) : null;

        // The details page carries productPageCode so ITS enrol CTA re-enters
        // this exact checkout instead of the standalone enroll-invite dialog.
        const detailsLink =
          showViewCourse && tagName && m.package_id
            ? {
                to: "/$tagName/$courseId" as const,
                params: { tagName, courseId: m.package_id },
                // Every key the details route validates — its validateSearch
                // returns them all, so a partial object would not typecheck.
                search: {
                  enrollInviteId: m.enroll_invite_id,
                  packageSessionId: m.package_session_id,
                  productPageCode,
                  bannerImage: undefined,
                  level: m.level_name,
                  price: m.payment_plan?.actual_price?.toString(),
                  available_slots: undefined,
                },
              }
            : null;

        return (
          <article
            key={m.id || `${start}-${i}`}
            data-stagger-item
            style={{
              ["--stagger-i" as string]: i,
              // Carousel cards size to show exactly `columns` per view (minus
              // the gap-5 gaps); the min-width below takes over on narrow
              // screens so the row overflows into a swipe instead of crushing
              // the cards.
              ...(isCarousel
                ? { flexBasis: `calc((100% - ${(cols - 1) * 1.25}rem) / ${cols})` }
                : {}),
            } as React.CSSProperties}
            data-selected={inCart || undefined}
            className={
              "catalogue-card-elevated group flex flex-col p-4 text-start" +
              (isCarousel ? " min-w-reg-250 shrink-0 snap-start" : "") +
              (inCart ? " catalogue-card-selected" : "")
            }
          >
            {/* Image + title are the "browse" affordance: they open the course
                page. The enrol CTA below is the "buy" affordance. Keeping them
                separate is why the card is no longer one big link. */}
            {showImage && (
              <div className="relative">
                {detailsLink ? (
                  <Link {...detailsLink} className="no-underline" tabIndex={-1} aria-hidden="true">
                    <CourseImage mediaId={m.course_preview_image_media_id} alt={name} />
                  </Link>
                ) : (
                  <CourseImage mediaId={m.course_preview_image_media_id} alt={name} />
                )}
                {/* A tick on the artwork, not only on the button: in a
                    four-across rail the buttons sit below the fold of the card
                    the eye is actually scanning. */}
                {inCart && (
                  <span
                    className="absolute end-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-primary-500 text-white shadow-md"
                    aria-hidden="true"
                  >
                    <Check className="size-4" weight="bold" />
                  </span>
                )}
              </div>
            )}
            <div className={showImage ? "mt-3 flex flex-1 flex-col" : "flex flex-1 flex-col"}>
              {showChips && chips.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {chips.map((c, j) => (
                    <span
                      key={j}
                      className="inline-flex items-center rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-catalogue-brand-ink ring-1 ring-primary-100"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
              {/* Card-scale type, not a section heading: catalogue-h3 here made
                  every card title read like a page title (the field complaint).
                  Clamped because course names run long ("Chapter 10 | Living
                  Creatures…") and an unclamped title ruins the row rhythm. */}
              <h3 className="mb-1.5 line-clamp-2 text-base font-semibold leading-snug text-catalogue-text-primary">
                {detailsLink ? (
                  <Link
                    {...detailsLink}
                    className="text-catalogue-text-primary no-underline hover:underline"
                  >
                    {name}
                  </Link>
                ) : (
                  name
                )}
              </h3>
              {blurb && (
                <p className="mb-2 line-clamp-2 text-sm leading-relaxed text-catalogue-text-secondary">
                  {blurb}
                </p>
              )}
              {validity && (
                <p className="mb-2 inline-flex items-center gap-1.5 text-xs text-catalogue-text-muted">
                  <Clock className="size-3.5" aria-hidden="true" /> {validity}
                </p>
              )}
              {/* Price and CTAs pinned to the bottom so ragged card bodies
                  still line up across the row. */}
              <div className="mt-auto space-y-2.5 pt-1">
                {showPrice && (
                  <PriceWithMrp
                    actual={m.payment_plan?.actual_price}
                    elevated={m.payment_plan?.elevated_price}
                    currency={m.payment_plan?.currency}
                    size="sm"
                  />
                )}
                {/* No min-width: each button keeps its own text width (they
                    never wrap mid-label), so when both no longer fit — a narrow
                    phone, or a long custom label — the row wraps and they stack
                    full-width instead of squashing. */}
                <div className={detailsLink ? "flex flex-wrap gap-2" : ""}>
                  {detailsLink && (
                    <Link
                      {...detailsLink}
                      className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm flex-1 justify-center whitespace-nowrap no-underline"
                    >
                      {viewCourseLabel || t("productPageOffer.viewCourse", { course: courseTerm })}
                    </Link>
                  )}
                  {siteCartOn && cartRoute === "pending" ? (
                    // The store page is still loading: no action until it is
                    // known whether this course goes to the cart or its page.
                    <button
                      type="button"
                      disabled
                      aria-busy="true"
                      aria-label={t("siteCart.checking", "Checking availability…")}
                      className="catalogue-btn catalogue-btn-primary catalogue-btn-sm flex-1 justify-center whitespace-nowrap disabled:opacity-60"
                    >
                      <SpinnerGap className="size-3.5 animate-spin" aria-hidden="true" />
                    </button>
                  ) : siteCartOn && cartRoute === "page" ? (
                    enrolLink({ ...enrolSearch, ...(siteLang ? { lang: siteLang } : {}) })
                  ) : enableCart ? (
                    <button
                      type="button"
                      onClick={() =>
                        siteCartOn ? void toggleSiteCart(m) : toggleCart(m.package_session_id)
                      }
                      aria-pressed={inCart}
                      aria-label={
                        inCart
                          ? t("productPageOffer.removeFromCartAriaLabel", { course: name })
                          : t("productPageOffer.addToCartAriaLabel", { course: name })
                      }
                      className={cn(
                        "catalogue-btn catalogue-btn-sm flex-1 justify-center whitespace-nowrap",
                        inCart ? "catalogue-btn-secondary" : "catalogue-btn-primary",
                      )}
                    >
                      {inCart ? (
                        <>
                          <Check className="size-3.5" weight="bold" aria-hidden="true" />
                          {t("productPageOffer.added")}
                        </>
                      ) : (
                        <>
                          <ShoppingCartSimple className="size-3.5" weight="bold" aria-hidden="true" />
                          {cartCtaLabel || t("common.addToCart")}
                        </>
                      )}
                    </button>
                  ) : (
                    enrolLink(enrolSearch)
                  )}
                </div>
              </div>
            </div>
          </article>
        );
  };

  const cards = visible.map((m, i) => renderCard(m, i));

  const grid = <div className={gridCols}>{cards}</div>;

  // The rail renders OUTSIDE the shell so cards scroll edge-to-edge across the
  // viewport (a card visibly continuing past the screen edge IS the swipe
  // affordance); catalogue-carousel-bleed re-creates the shell's gutter as
  // padding so the first card still lines up with the heading above it.
  const carousel = (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={syncArrows}
        className="catalogue-carousel-bleed catalogue-no-scrollbar flex snap-x snap-mandatory gap-5 overflow-x-auto py-2"
        role="group"
        aria-label={title || coursesTerm}
      >
        {cards}
        {/* Endless ring: a second lap of the same cards (see useAutoScrollRail). */}
        {looping &&
          cards.map((card, i) =>
            React.isValidElement(card) ? React.cloneElement(card, { key: `loop-${i}`, ...RAIL_CLONE_PROPS }) : null,
          )}
        {/* Tail card — states plainly how many courses the rail is not
            showing, rather than silently truncating the list. A looping rail
            has no end for it to sit at. */}
        {!looping && railHidden > 0 && productPageCode && (
          <Link
            to="/product-pages/$productPageCode"
            params={{ productPageCode }}
            search={{ ...(instituteId ? { instituteId } : {}), ...(tagName ? { tagName } : {}) }}
            style={
              {
                flexBasis: `calc((100% - ${(cols - 1) * 1.25}rem) / ${cols})`,
              } as React.CSSProperties
            }
            data-rail-tail=""
            className="catalogue-card group flex min-w-reg-250 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-catalogue-lg border border-dashed border-catalogue-border p-6 text-center no-underline"
          >
            <span className="catalogue-h3 text-catalogue-brand-ink">+{railHidden}</span>
            <span className="text-sm font-semibold text-catalogue-text-primary">
              {viewAllLabel || t("productPageOffer.seeAllCourses", { courses: coursesTerm })}
            </span>
            <span className="text-xs text-catalogue-text-muted">
              {t("productPageOffer.searchAndFilter")}
            </span>
            <ArrowRight className="size-4 text-catalogue-brand-ink" weight="bold" aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* Arrows are an affordance on top of native scroll/swipe, not the only
          way to move — they stay hidden until there is somewhere to go. */}
      {canPrev && (
        <button
          type="button"
          onClick={() => scrollByPage(-1)}
          aria-label={t("productPageOffer.scrollPrevious", { courses: coursesTerm })}
          className="catalogue-btn catalogue-btn-secondary absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 justify-center rounded-full border-catalogue-border bg-catalogue-bg catalogue-btn-icon shadow-lg md:inline-flex"
        >
          <CaretLeft className="size-5" weight="bold" aria-hidden="true" />
        </button>
      )}
      {canNext && (
        <button
          type="button"
          onClick={() => scrollByPage(1)}
          aria-label={t("productPageOffer.scrollNext", { courses: coursesTerm })}
          className="catalogue-btn catalogue-btn-secondary absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 justify-center rounded-full border-catalogue-border bg-catalogue-bg catalogue-btn-icon shadow-lg md:inline-flex"
        >
          <CaretRight className="size-5" weight="bold" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  const searchRow = searchEnabled && (
    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-xs">
        <MagnifyingGlass
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-catalogue-text-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder={t("productPageOffer.searchPlaceholder", { courses: coursesTerm })}
          aria-label={t("productPageOffer.searchAriaLabel", { courses: coursesTerm })}
          className={`catalogue-input catalogue-input-icon-start w-full ${query ? "catalogue-input-icon-end" : ""}`}
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); setPage(1); }}
            aria-label={t("common.clearSearch")}
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-catalogue-text-muted transition-colors hover:bg-catalogue-interactive-hover hover:text-catalogue-text-primary"
          >
            <X className="size-3.5" weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="text-xs text-catalogue-text-muted" role="status" aria-live="polite">
        {filtered.length === 0
          ? t("productPageOffer.noMatches")
          : t("productPageOffer.showingRange", {
              from: start + 1,
              to: Math.min(start + visible.length, filtered.length),
              total: filtered.length,
            })}
      </p>
    </div>
  );

  /* Basket bar — pinned to the foot of the viewport for as long as anything is
     selected, so the visitor can keep browsing (or scroll into the FAQ) without
     losing sight of what they have picked or the way to pay for it. It used to
     be `sticky` inside this section, which meant it scrolled away with the
     section and, on a phone, sat underneath the fixed mobile action bar.
     courseIds is the same contract the single-course CTA uses, so checkout
     needs no special case for a multi-subject basket. */
  const checkoutBar =
    checkoutBarOpen && portalHost
      ? createPortal(
          <div className="catalogue-checkout-bar fixed inset-x-0 bottom-0 z-60 border-t border-catalogue-border bg-catalogue-bg-elevated/95 backdrop-blur-sm">
            {/* What one more subject unlocks. A threshold rather than a rupee
                figure, because the next course's price is not known until it
                is picked. */}
            {!hidePrices && tierAhead && (
              <div className="border-b border-catalogue-border bg-primary-50">
                <p className="catalogue-shell flex items-center gap-2 py-1.5 text-xs font-semibold text-primary-500">
                  <Gift className="size-4 shrink-0" aria-hidden="true" />
                  {/* Phrased from the offer DATA. tierAhead.label is English
                      built in JS ("₹149 more off"), so using it here would
                      strand ar / fr / hi on an English fragment. */}
                  {/* Whichever gap is real: a tier gated on spend cannot be
                      reached by adding one more course, so promising that
                      would be a promise the basket cannot keep. */}
                  {tierAhead.coursesAway > 0
                    ? t(
                        tierAhead.offer.type === "PERCENT"
                          ? "productPageOffer.addMoreForTierPercent"
                          : tierAhead.offer.incremental
                            ? "productPageOffer.addMoreForTierAmountMore"
                            : "productPageOffer.addMoreForTierAmount",
                        {
                          count: tierAhead.coursesAway,
                          course: (tierAhead.coursesAway === 1
                            ? courseTerm
                            : coursesTerm
                          ).toLocaleLowerCase(),
                          amount: formatPriceAmount(tierAhead.offer.value, cartTotal?.currency),
                          percent: tierAhead.offer.value,
                        },
                      )
                    : t(
                        tierAhead.offer.type === "PERCENT"
                          ? "productPageOffer.spendMoreForTierPercent"
                          : "productPageOffer.spendMoreForTierAmount",
                        {
                          spend: formatPriceAmount(tierAhead.amountAway, cartTotal?.currency),
                          amount: formatPriceAmount(tierAhead.offer.value, cartTotal?.currency),
                          percent: tierAhead.offer.value,
                        },
                      )}
                </p>
              </div>
            )}
            <div className="catalogue-shell flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                  <ShoppingCartSimple className="size-5" weight="bold" aria-hidden="true" />
                  <span className="absolute -end-1 -top-1 flex min-w-5 justify-center rounded-full bg-primary-500 px-1 text-3xs font-bold leading-5 text-white">
                    {selectedMappings.length}
                  </span>
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-catalogue-text-primary">
                    {t("productPageOffer.itemsSelected", {
                      count: selectedMappings.length,
                      course: courseTerm,
                      courses: coursesTerm,
                    })}
                  </p>
                  {/* Name them: by checkout time the cards that were tapped are
                      several screens up, and "3 selected" alone is not enough
                      to pay against. */}
                  <p className="truncate text-xs text-catalogue-text-muted">
                    {selectedMappings.map((m) => siteT(m.package_name) || courseTerm).join(" · ")}
                  </p>
                </div>
              </div>

              <div className="flex w-full shrink-0 items-center justify-end gap-3 sm:w-auto">
                {!hidePrices && cartTotal && (
                  <div className="text-end leading-tight">
                    <p className="text-3xs font-medium uppercase tracking-wide text-catalogue-text-muted">
                      {t("productPageOffer.total")}
                    </p>
                    <p className="flex items-baseline justify-end gap-1.5">
                      {/* Struck price is what these same courses cost bought
                          separately — never an invented MRP. */}
                      {cartTotal.saved > 0 && (
                        <span className="text-xs text-catalogue-text-muted line-through">
                          {formatPriceAmount(cartTotal.itemTotal, cartTotal.currency)}
                        </span>
                      )}
                      <span className="text-base font-bold text-catalogue-text-primary">
                        {/* A basket of free courses reads better as "Free" than
                            as a formatted zero — same rule PriceWithMrp applies
                            to a single card. */}
                        {cartTotal.amount === 0
                          ? t("productPageOffer.free")
                          : formatPriceAmount(cartTotal.amount, cartTotal.currency)}
                      </span>
                    </p>
                    {cartTotal.saved > 0 && (
                      <p className="text-3xs font-bold text-success-600">
                        {t("productPageOffer.savedAmount", {
                          amount: formatPriceAmount(cartTotal.saved, cartTotal.currency),
                          percent: savedPercent,
                        })}
                      </p>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="shrink-0 text-xs font-semibold text-catalogue-text-muted underline-offset-2 hover:underline"
                >
                  {t("productPageOffer.clearCart")}
                </button>
                <Link
                  to="/product-pages/$productPageCode"
                  params={{ productPageCode: productPageCode! }}
                  search={{
                    ...(instituteId ? { instituteId } : {}),
                    ...(tagName ? { tagName } : {}),
                    courseIds: selectedMappings.map((m) => m.package_session_id).join(","),
                    defaultTab: "CART" as const,
                  }}
                  className="catalogue-btn catalogue-btn-primary shrink-0 justify-center whitespace-nowrap no-underline"
                >
                  {checkoutCtaLabel || t("productPageOffer.proceedToCheckout")}
                  <ArrowRight className="size-4" weight="bold" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>,
          portalHost,
        )
      : null;

  // Hand-rolled shell layout (instead of section()) because the carousel track
  // must be a DIRECT child of the full-width section to bleed to the viewport
  // edge — everything else stays inside the shell column.
  return (
    <section ref={setSectionNode} className={sectionClass} style={sectionStyle}>
      <div className="catalogue-shell">
        {header}
        {finderChips}
        {searchRow}
        {filtered.length === 0 && (
          <div className="catalogue-card rounded-catalogue-lg border border-dashed border-catalogue-border p-8 text-center">
            <p className="text-sm text-catalogue-text-muted">
              {query.trim()
                ? t("productPageOffer.noCoursesMatch", { courses: coursesTerm, query: query.trim() })
                : t("productPageOffer.nothingForSelection")}
            </p>
            {/* Always leave a way back to the full list. An empty grid with no
                escape is where a filtered visitor stops browsing. */}
            {(query.trim() || finderSelection) && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {query.trim() && (
                  <button
                    type="button"
                    onClick={() => { setQuery(""); setPage(1); }}
                    className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm"
                  >
                    {t("common.clearSearch")}
                  </button>
                )}
                {finderSelection && (
                  <button
                    type="button"
                    onClick={clearFinderSelection}
                    className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm"
                  >
                    {t("productPageOffer.showAllCourses", { courses: coursesTerm })}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {filtered.length > 0 &&
        (isCarousel ? (
          carousel
        ) : (
          <div className="catalogue-shell">
            {scrollable ? (
              <div
                ref={scrollRef}
                className="overflow-y-auto overscroll-contain pr-1"
                // Admin-authored height — a free-form px value, so it cannot be a token.
                style={{ maxHeight: `${Math.max(Number(scrollMaxHeight) || 640, 240)}px` }}
              >
                {grid}
              </div>
            ) : (
              grid
            )}
          </div>
        ))}

      <div className="catalogue-shell">
      {totalPages > 1 && (
        <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label={t("productPageOffer.coursePagesAriaLabel", { course: courseTerm })}>
          <button
            type="button"
            onClick={() => goToPage(safePage - 1)}
            disabled={safePage === 1}
            aria-label={t("common.previousPage")}
            className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CaretLeft className="size-3.5" weight="bold" aria-hidden="true" />
          </button>

          {buildPageWindow(safePage, totalPages).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-catalogue-text-muted" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => goToPage(p)}
                aria-label={t("productPageOffer.page", { number: p })}
                aria-current={p === safePage ? "page" : undefined}
                className={
                  p === safePage
                    ? "catalogue-btn catalogue-btn-primary catalogue-btn-sm min-w-9 justify-center"
                    : "catalogue-btn catalogue-btn-secondary catalogue-btn-sm min-w-9 justify-center"
                }
              >
                {p}
              </button>
            )
          )}

          <button
            type="button"
            onClick={() => goToPage(safePage + 1)}
            disabled={safePage === totalPages}
            aria-label={t("common.nextPage")}
            className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CaretRight className="size-3.5" weight="bold" aria-hidden="true" />
          </button>
        </nav>
      )}

      </div>

      {checkoutBar}

      {/* The section's own cart drawer, only on a page without a header cart
          button (kept mounted while open so it can animate closed). */}
      {siteCartOn && instituteId && globalSettings?.siteCart && (!hasHeaderCart || fallbackCartOpen) && (
        <SiteCartDrawer
          open={fallbackCartOpen}
          onOpenChange={setFallbackCartOpen}
          instituteId={instituteId}
          tagName={tagName}
          settings={globalSettings.siteCart}
          languages={cartLanguages}
          themeAnchor={portalHost}
        />
      )}
    </section>
  );
};

export default ProductPageOfferComponent;
