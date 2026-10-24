import React, { useState, useEffect, useRef, useMemo, useCallback, useId } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import type { ImageFit } from "@/components/common/fit-image/fit-mode";
import { RouteMatcher } from "../../-services/route-matcher";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  COURSE_CATALOG_SORT_OPTIONS,
  CourseCatalogProps,
  CourseCatalogSortOption,
  DEFAULT_COURSE_CATALOG_SORT,
} from "../../-types/course-catalogue-types";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import {
  clearCourseFinderOptions,
  clearCourseFinderSelection,
  courseFinderScope,
  loadCourseFinderSelection,
  publishCourseFinderOptions,
} from "../../-utils/course-finder-bus";
import { urlCourseDetails } from "@/constants/urls";
import axios from "axios";
import { Button } from "@/components/ui/button";
import {
  Funnel,
  CaretDown,
  CaretUp,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  SortAscending,
  ShoppingCart,
  Plus,
  Minus,
  BookOpen,
  X,
  Clock,
  ChartBarHorizontal,
} from "@phosphor-icons/react";
import { cn, toTitleCase, compareByNameNatural } from "@/lib/utils";
import { useCartStore, CartItem } from "../../-stores/cart-store";
import { toast } from "sonner";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { OfferBadge, PriceWithMrp } from "@/components/common/price-with-mrp";
import { resolveInviteAvailability } from "@/lib/invite-availability";
import { resolveCoursePageRoute } from "../../-utils/course-page-routing";
import {
  formatLaunchDate,
  openComingSoonForm,
  readComingSoon,
} from "../../-utils/coming-soon";
import { ComingSoonRibbon } from "./ComingSoonRibbon";
import { useCatalogueLocale, useSiteT } from "../../-utils/catalogue-locale";
import { useCatalogueFilterHeadings } from "../../-utils/catalogue-naming";
import {
  URL_PARAMS,
  readSearchParam,
  useCatalogueSearchParams,
} from "../../-utils/catalogue-url-state";
import { ALL_BADGES, computeCourseBadges, type CourseBadge } from "../../-utils/course-badges";
import { preferredCourseLanguage } from "../../-utils/course-variants";
import { isSiteCartEnabled } from "../../-utils/site-cart";
import { useSiteCartStore } from "../../-stores/site-cart-store";
import { usePopularityRanks } from "../../-services/popularity-service";
import { badgesNeedRanks, resolveCatalogDiscovery, type ResolvedQuickFilter } from "./catalog/catalog-config";
import {
  buildCatalogCards,
  cardPriceView,
  courseMatchKeysOf,
  isBuyableNowRow,
  isPureLanguageLevel,
  type CardPriceView,
  type CatalogCard,
} from "./catalog/catalog-cards";
import {
  GROUP_IDS,
  applyFacetGroups,
  buildAppliedChips,
  buildFacetGroups,
  categoryOptions,
  countFacetOptions,
  instructorOptions,
  languageOptions,
  levelOptions,
  presentLanguageCodes,
  priceOptions,
  rowsMatchingGroups,
  sessionOptions,
  tagOptions,
  type AppliedChip,
  type CatalogCriteria,
  type CriteriaContext,
  type FacetOption,
} from "./catalog/catalog-filters";
import { formatAmountLabel, formatRangeLabel } from "./catalog/catalog-format";
import { sortCatalogCards, sortOptionLabel, withCreatedAt } from "./catalog/catalog-sort";
import {
  countDiscoveryFilters,
  discoveryLinkScope,
  discoveryPatchToParams,
  formatPriceParam,
  parsePriceParam,
  samePrice,
  searchToParam,
  sortFromToken,
  sortToToken,
  type DiscoveryValidation,
  type PriceChoice,
} from "./catalog/catalog-url";
import { isQuickFilterActive, toggleQuickFilter } from "./catalog/catalog-quick-filters";
import { findStream, streamTabId } from "./catalog/catalog-streams";
import { cardCartOffer } from "./catalog/catalog-site-cart";
import { useStoreSale } from "../site-cart/use-store-sale";
import { useCatalogStreams, useDiscoveryState } from "./catalog/use-catalog-discovery";
import { StreamTabs } from "./catalog/StreamTabs";
import { DiscoveryFilterGroup } from "./catalog/DiscoveryFilterGroup";
// Feature 'sidebar': category scope + authored option groups (customFilters).
import { categoriesInScope } from "./catalog/catalog-sidebar-config";
import {
  clearedCustomState,
  resolveCustomFilters,
  selectedCustomOptions,
  withTagOptions,
} from "./catalog/catalog-custom-filters";
import { tagKey, withTagFormats } from "../../-utils/course-format";
import { AppliedFilterChips } from "./catalog/AppliedFilterChips";
import { QuickFilterBar } from "./catalog/QuickFilterBar";
import { CourseBadgePills, LanguageChips } from "./catalog/CardDiscoveryMeta";
import { badgeLabel } from "./catalog/catalog-labels";
import { SiteCartCta, SiteCartCtaPending } from "./catalog/SiteCartCta";
import { MobileFilterSheet, MobileFiltersButton } from "./catalog/MobileFilterSheet";
import { buildContentWidthVars, buildPaletteVars, resolveContentMaxWidth } from "../../-utils/catalogue-palette";
import { useCatalogSlots } from "./catalog/slots/use-catalog-slots";
import type {
  CatalogSlotContext,
  CourseCardRenderOptions,
  StreamTabsProps,
} from "./catalog/slots/catalog-slot-types";

// The catalogue JSON is authored by hand and by the AI page builder, so treat
// defaultSort as untrusted: anything outside the known sort modes would leave
// the dropdown showing a value the sort switch never matches, silently
// disabling sorting. Unknown values fall back to the historic default.
const resolveDefaultSort = (value?: string): CourseCatalogSortOption =>
  COURSE_CATALOG_SORT_OPTIONS.includes(value as CourseCatalogSortOption)
    ? (value as CourseCatalogSortOption)
    : DEFAULT_COURSE_CATALOG_SORT;

// Compact, scaling page list with ellipsis. Always keeps a consistent number
// of controls (~6-7) no matter how many pages there are — so the catalogue can
// grow to hundreds of pages without the pagination ever overflowing.
//   near start:  [1, 2, 3, 4, …, 50]
//   middle:      [1, …, 24, 25, 26, …, 50]
//   near end:    [1, …, 47, 48, 49, 50]
const getPageNumbers = (current: number, total: number): (number | "...")[] => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 3) return [1, 2, 3, 4, "...", total];
  if (current >= total - 2)
    return [1, "...", total - 3, total - 2, total - 1, total];
  return [1, "...", current - 1, current, current + 1, "...", total];
};
// EnrollmentPaymentDialog import removed - not used in catalog

type PriceRangeState = { min?: number; max?: number } | null;

// Backend sometimes stores sentinel level names (e.g. "default") that must not
// surface as a UI badge. Hide sentinels; title-case genuine values.
const SENTINEL_LEVEL_NAMES = new Set([
  "default",
  "none",
  "null",
  "undefined",
  "",
]);
const displayLevelName = (raw?: string | null): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (SENTINEL_LEVEL_NAMES.has(trimmed.toLowerCase())) return "";
  return toTitleCase(trimmed);
};

// CourseImage component that handles image resolution like study library
interface CourseImageProps {
  previewImageUrl: string;
  alt: string;
  className?: string;
  /** Unset: FitImage's automatic fill-or-fit (the site's default). */
  fit?: ImageFit;
}

const CoursePlaceholder: React.FC<{ title: string }> = ({ title }) => (
  <div className="aspect-video w-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
    <BookOpen size={40} className="text-primary/60" />
    <span className="text-xs font-medium text-primary/70 px-3 text-center line-clamp-1">
      {title}
    </span>
  </div>
);

const CourseImage: React.FC<CourseImageProps> = ({
  previewImageUrl,
  alt,
  className,
  fit,
}) => {
  const isPlaceholder =
    !previewImageUrl ||
    previewImageUrl.includes("/api/placeholder/") ||
    previewImageUrl.trim() === "" ||
    previewImageUrl === "null" ||
    previewImageUrl === "undefined";

  if (isPlaceholder) {
    return <CoursePlaceholder title={alt} />;
  }

  return (
    <CourseImageWithState
      previewImageUrl={previewImageUrl}
      alt={alt}
      className={className}
      fit={fit}
    />
  );
};

// Separate component for handling actual image loading
const CourseImageWithState: React.FC<CourseImageProps> = ({
  previewImageUrl,
  alt,
  className,
  fit,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const [courseImageUrl, setCourseImageUrl] = useState<string>("");
  const [loadingImage, setLoadingImage] = useState(true);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoadingImage(true);
      setImageError(false);

      try {
        // console.log("[CourseImage] Calling getPublicUrlWithoutLogin with:", previewImageUrl);
        const url = await getPublicUrlWithoutLogin(previewImageUrl);
        // console.log("[CourseImage] Got URL from API:", url);
        if (isMounted) {
          if (url) {
            setCourseImageUrl(url);
            setImageError(false);
          } else {
            setImageError(true);
            setCourseImageUrl("");
          }
        }
      } catch (error) {
        console.error("[CourseImage] Error getting public URL:", error);
        if (isMounted) {
          setImageError(true);
          setCourseImageUrl("");
        }
      } finally {
        if (isMounted) {
          setLoadingImage(false);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [previewImageUrl]);

  if (imageError || (!loadingImage && !courseImageUrl)) {
    return <CoursePlaceholder title={alt} />;
  }

  // Show loading placeholder while loading
  if (loadingImage && !courseImageUrl) {
    return (
      <div className="aspect-video">
        <div className="w-full h-full bg-catalogue-bg-muted animate-pulse rounded-catalogue-sm flex items-center justify-center">
          <div className="text-catalogue-text-muted text-xs">
            {t("courseCatalog.loadingImage")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="aspect-video">
      <FitImage
        src={courseImageUrl}
        alt={alt}
        className={className}
        fit={fit}
        loading="lazy"
        onError={() => {
          setImageError(true);
          setCourseImageUrl("");
        }}
        onLoad={(e) => {
          e.currentTarget.style.opacity = "1";
        }}
        style={{
          opacity: 1,
          transition: "opacity 0.2s ease",
        }}
      />
    </div>
  );
};

export interface CourseCatalogComponentProps extends CourseCatalogProps {
  instituteId: string;
  tagName: string;
  globalSettings?: any;
  cartButtonConfig?: {
    enabled?: boolean;
    showAddToCartButton?: boolean;
    showQuantitySelector?: boolean;
    quantityMin?: number;
  };
}

interface Course {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  price: number;
  elevatedPrice?: number;
  type: string;
  level: string;
  instructor: string;
  duration: string;
  rating: number;
  // Allow any additional fields from API response
  currency?: string;
  /** v2 search fields read by the discovery helpers. */
  comma_separeted_tags?: string | null;
  coming_soon?: unknown;
  createdAt?: string;
  [key: string]: any;
}

/** A row of the grid (exported for the render-slot types). */
export type CatalogCourseRow = Course;

interface FilterSectionProps {
  title: string;
  items: { id: string; name: string }[];
  selectedItems: string[];
  handleChange: (itemId: string) => void;
  disabled?: boolean;
  /** Live result count per item id (showFilterCounts). Absent = the original list. */
  counts?: Record<string, number>;
}

const FilterSection: React.FC<FilterSectionProps> = ({
  title,
  items,
  selectedItems,
  handleChange,
  disabled,
  counts,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const [isExpanded, setIsExpanded] = useState(false);
  const initialDisplayCount = 3;
  const canExpand = items.length > initialDisplayCount;
  const itemsToDisplay =
    canExpand && !isExpanded ? items.slice(0, initialDisplayCount) : items;

  return (
    <div className="mb-5">
      <h3 className="text-sm font-semibold text-catalogue-text-primary mb-2.5">{title}</h3>
      <div className="space-y-1.5">
        {items.length === 0 && !disabled && (
          <p className="text-xs text-catalogue-text-muted">
            {t("courseCatalog.noItemsAvailable", { title: title.toLowerCase() })}
          </p>
        )}
        {disabled && (
          <p className="text-xs text-catalogue-text-muted">
            {t("courseCatalog.filtersUnavailable", { title })}
          </p>
        )}
        {itemsToDisplay.map((item) => {
          const count = counts?.[item.id];
          // With counts on, an option that would empty the grid is disabled
          // unless already ticked (so it can still be switched off).
          const empty = count === 0 && !selectedItems.includes(item.id);
          return (
            <label
              key={item.id}
              className={`flex items-center text-catalogue-text-secondary hover:text-catalogue-text-primary transition-colors ${disabled || empty ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              <input
                type="checkbox"
                className="form-checkbox h-3.5 w-3.5 text-primary-500 border-catalogue-border rounded-catalogue-xs focus:ring-primary-400 me-2"
                checked={selectedItems.includes(item.id)}
                onChange={() => handleChange(item.id)}
                disabled={disabled || empty}
              />
              <span className="text-sm">{item.name}</span>
              {count !== undefined && (
                <span className="ms-auto ps-2 text-xs tabular-nums text-catalogue-text-muted">
                  {count}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {canExpand && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          disabled={disabled}
          className={`text-xs mt-2 flex items-center gap-1 font-medium ${
            disabled
              ? "text-catalogue-text-muted cursor-not-allowed"
              : "text-primary-500 hover:text-primary-400"
          }`}
        >
          {isExpanded ? (
            <>
              {t("courseCatalog.showLess")}
              <CaretUp size={12} />
            </>
          ) : (
            <>
              {t("courseCatalog.showMore")}
              <CaretDown size={12} />
            </>
          )}
        </button>
      )}
    </div>
  );
};

// Helper component for cart button/quantity controls
const CartControls: React.FC<{
  course: Course;
  globalSettings?: any;
  cartButtonConfig?: {
    enabled?: boolean;
    showAddToCartButton?: boolean;
    showQuantitySelector?: boolean;
    quantityMin?: number;
  };
  addItem: (item: Omit<CartItem, "quantity">) => void;
  getItemByEnrollInviteId: (enrollInviteId: string) => CartItem | undefined;
  updateQuantity: (enrollInviteId: string, quantity: number) => void;
  removeItem: (enrollInviteId: string) => void;
}> = ({
  course,
  globalSettings,
  cartButtonConfig,
  addItem,
  getItemByEnrollInviteId,
  updateQuantity,
  removeItem,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const cartItem = course.enrollInviteId
    ? getItemByEnrollInviteId(course.enrollInviteId)
    : undefined;
  const quantityMin = cartButtonConfig?.quantityMin ?? 1;
  const showAddToCartButton = cartButtonConfig?.showAddToCartButton !== false;
  const showQuantitySelector = cartButtonConfig?.showQuantitySelector !== false;

  // Only hide if payment is explicitly disabled AND cartButtonConfig is not provided
  // If cartButtonConfig is provided, always show the button (even for free courses)
  if (
    !cartButtonConfig &&
    (globalSettings?.payment?.enabled === false || course.price <= 0)
  ) {
    return null;
  }

  if (cartItem && showQuantitySelector) {
    return (
      <div className="flex items-center gap-1 border border-catalogue-border rounded-catalogue-sm px-1 py-0.5 bg-catalogue-bg-elevated">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-catalogue-interactive-hover"
          onClick={(e) => {
            e.stopPropagation();
            if (cartItem && course.enrollInviteId) {
              if (cartItem.quantity > quantityMin) {
                updateQuantity(course.enrollInviteId, cartItem.quantity - 1);
              } else {
                removeItem(course.enrollInviteId);
                toast.success(t("courseCatalog.removedFromCart", { title: course.title }));
              }
            }
          }}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <span className="min-w-6 text-center font-medium text-catalogue-text-primary text-xs">
          {cartItem.quantity}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-catalogue-interactive-hover"
          onClick={(e) => {
            e.stopPropagation();
            if (cartItem && course.enrollInviteId) {
              updateQuantity(course.enrollInviteId, cartItem.quantity + 1);
            }
          }}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    );
  } else if (!cartItem && showAddToCartButton) {
    return (
      <Button
        onClick={(e) => {
          e.stopPropagation();
          if (!course.enrollInviteId) {
            toast.error(t("courseCatalog.missingEnrollInvite"));
            return;
          }
          addItem({
            id: course.id,
            title: course.title,
            price: course.price,
            elevatedPrice: course.elevatedPrice,
            currency: course.currency,
            image: course.thumbnail,
            level: course.level,
            packageSessionId: course.packageSessionId,
            enrollInviteId: course.enrollInviteId,
            levelId: course.levelId,
            sessionId: course.sessionId,
            sessionName: course.sessionName,
            courseId: course.courseId,
          });
          toast.success(t("courseCatalog.addedToCart", { title: course.title }));
        }}
        className="bg-primary-500 hover:bg-primary-400 text-white text-xs font-medium rounded-catalogue-sm px-2.5 py-1 flex items-center justify-center gap-1.5"
        size="sm"
      >
        <ShoppingCart className="h-3.5 w-3.5" />
        <span>{t("courseCatalog.add")}</span>
      </Button>
    );
  }

  // Don't render anything if both are disabled
  return null;
};

// ─── Category color palette (deterministic, JIT-safe literal strings) ────────
const CATEGORY_PALETTE = [
  { band: "from-violet-100 to-violet-50", text: "text-violet-600", icon: "text-violet-400" },
  { band: "from-teal-100 to-teal-50",    text: "text-teal-600",   icon: "text-teal-400"   },
  { band: "from-warning-100 to-warning-50",  text: "text-amber-600",  icon: "text-amber-400"  },
  { band: "from-pink-100 to-pink-50",    text: "text-pink-600",   icon: "text-pink-400"   },
  { band: "from-info-100 to-info-50",    text: "text-blue-600",   icon: "text-blue-400"   },
  { band: "from-success-100 to-success-50", text: "text-emerald-600", icon: "text-emerald-400" },
  { band: "from-primary-100 to-primary-50", text: "text-orange-600", icon: "text-orange-400" },
  { band: "from-indigo-100 to-indigo-50", text: "text-indigo-600", icon: "text-indigo-400" },
] as const;

function getCategoryStyle(key: string) {
  if (!key) return CATEGORY_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}
// ─────────────────────────────────────────────────────────────────────────────

const NO_BADGES = new Map<string, CourseBadge[]>();

/** "Popular", "New"… — a quick filter without an authored label uses the visitor-language default. */
const quickFilterDefaultLabel = (
  t: ReturnType<typeof useTranslation>["t"],
  qf: ResolvedQuickFilter,
  priceLabel: (amount: number) => string,
  languageLabel: (code: string) => string,
): string => {
  switch (qf.kind) {
    case "popular":
      return t("courseCatalog.quickPopular", "Popular");
    case "new":
      return t("courseCatalog.badgeNew", "New");
    case "free":
      return t("courseCatalog.badgeFree", "Free");
    case "bestseller":
      return t("courseCatalog.quickBestsellers", "Bestsellers");
    case "language":
      return languageLabel(String(qf.value || ""));
    case "priceMax":
      return priceLabel(Number(qf.value) || 0);
    default:
      return "";
  }
};

/** Comparator for filter options: names listed in `order` (matched
 *  case-insensitively) come first in that order; the rest follow in natural
 *  order. An empty or missing list is plain natural order. */
const byAuthoredOrder = (order?: string[]) => {
  const rank = new Map(
    (Array.isArray(order) ? order : []).map((name, i) => [String(name).trim().toLowerCase(), i] as const),
  );
  return (a: { name: string }, b: { name: string }) => {
    const ra = rank.get(a.name.trim().toLowerCase()) ?? Infinity;
    const rb = rank.get(b.name.trim().toLowerCase()) ?? Infinity;
    return ra === rb ? compareByNameNatural(a, b) : ra - rb;
  };
};

export const CourseCatalogComponent: React.FC<CourseCatalogComponentProps> = (componentProps) => {
  const {
    title,
    showFilters,
    filtersConfig,
    levelOrder,
    tagOrder,
    cartButtonConfig,
    render,
    defaultSort,
    instituteId,
    tagName,
    globalSettings,
    streams,
    syncUrl,
    showFilterCounts,
    showAppliedChips,
    quickFilters,
    languageFilter,
    priceFilter,
    categoryFilter,
    groupLanguageVersions,
    badges,
    mobileFilterSheet,
    contentMaxWidth,
    palette,
  } = componentProps;
  const { t, i18n } = useTranslation("coursePlayerB");
  const navigate = useNavigate();
  const {
    addItem,
    getItemByEnrollInviteId,
    updateQuantity,
    removeItem,
    getItemCount,
  } = useCartStore();

  // ── Courses-page discovery (stream tabs, filters, badges…) ─────────────
  // Every feature is opt-in through the section's own props; a section that
  // carries none resolves to `discovery.active === false` and renders the
  // original grid (same markup, same requests).
  const siteT = useSiteT();
  const filterHeadings = useCatalogueFilterHeadings();
  const { locale: siteLocale } = useCatalogueLocale();
  // Resolved from the section props alone; `discovery` below adds what the
  // courses' tags bring (source 'tags' groups, courseFormatsFromTags).
  const baseDiscovery = useMemo(
    () =>
      resolveCatalogDiscovery(
        {
          // [sidebar] authored option groups (FORMAT, FOR…).
          customFilters: componentProps.customFilters,
          streams,
          syncUrl,
          showFilterCounts,
          showAppliedChips,
          quickFilters,
          languageFilter,
          priceFilter,
          categoryFilter,
          groupLanguageVersions,
          badges,
          mobileFilterSheet,
        },
        globalSettings,
      ),
    [
      componentProps.customFilters,
      streams,
      syncUrl,
      showFilterCounts,
      showAppliedChips,
      quickFilters,
      languageFilter,
      priceFilter,
      categoryFilter,
      groupLanguageVersions,
      badges,
      mobileFilterSheet,
      globalSettings,
    ],
  );
  const { searchStr, update: updateSearchParams } = useCatalogueSearchParams();

  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // With syncUrl the search box starts from ?q= (a shared link reproduces the view).
  const [searchTerm, setSearchTerm] = useState(() =>
    baseDiscovery.syncUrl ? readSearchParam(searchStr, URL_PARAMS.query) ?? "" : "",
  );
  // Opening sort comes from the catalogue JSON so each institute picks its own
  // (e.g. "Price: Low to High" leads with free courses, since price 0 sorts
  // first). Sorting runs before pagination, so the choice holds across the
  // whole catalogue rather than just the visible page.
  const [sortOption, setSortOption] = useState<CourseCatalogSortOption>(() =>
    resolveDefaultSort(defaultSort),
  );

  // The page-builder preview pushes config updates into a mounted tree, so the
  // initial state above would never see a newly picked default. Re-seed only
  // when the configured value itself changes — a learner's own dropdown choice
  // is never clobbered, since re-renders carry the same string.
  useEffect(() => {
    setSortOption(resolveDefaultSort(defaultSort));
  }, [defaultSort]);

  // Filter states
  // Seeded from the Course Finder's stored answer. The wizard only opens once
  // per visitor, so holding its picks in state alone meant a reload — or the
  // trip into a course details page and back — silently widened the grid to
  // every level again with no way to be re-asked. See course-finder-bus.
  const finderRestored = useMemo(
    () => loadCourseFinderSelection(courseFinderScope(instituteId, tagName)),
    [instituteId, tagName],
  );
  const [selectedLevels, setSelectedLevels] = useState<string[]>(
    () => finderRestored?.levels ?? [],
  );
  const [selectedSessions, setSelectedSessions] = useState<string[]>(
    () => finderRestored?.sessions ?? [],
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(
    () => finderRestored?.tags ?? [],
  );
  const [selectedInstructors, setSelectedInstructors] = useState<string[]>([]);

  // Mobile filter state
  const [isMobileFilterExpanded, setIsMobileFilterExpanded] = useState(false);

  // Pagination (the current page is derived further down, once the result set is known)
  const itemsPerPage = 12;

  // Derive filter options from loaded courses (before shouldShow* checks).
  // Sentinel level names ("DEFAULT") are dropped here as well as on the card
  // badge: a public "Level: Default" checkbox is noise. An institute that
  // wants its single level filterable renames it in Admin > Levels.
  const levels = useMemo(
    () =>
      [...new Set(courses.map((c) => c.level).filter(Boolean))]
        .filter((level) => displayLevelName(level))
        // With language versions merged into one card, a level that is only
        // a language ("Hindi") is what the EN / हिं chips already say.
        .filter(
          (level) =>
            !baseDiscovery.grouping || !isPureLanguageLevel(level, baseDiscovery.languages),
        )
        .map((level) => ({ id: level, name: displayLevelName(level) }))
        // Admin-set order first (levelOrder); the rest sort naturally so the
        // list is stable and reads sensibly (Class 6, 7, 8 … 12, then
        // non-numeric levels) regardless of the order courses arrive from the API.
        .sort(byAuthoredOrder(levelOrder)),
    [courses, baseDiscovery.grouping, baseDiscovery.languages, levelOrder],
  );
  // Same sentinel rule as levels: the placeholder "DEFAULT" session must not
  // surface as a "Default" checkbox next to real streams, and an institute
  // whose only session is the placeholder gets no Session filter at all.
  const sessions = useMemo(() => {
    const byId = new Map<string, string>();
    courses.forEach((c) => {
      if (c.sessionId && !byId.has(c.sessionId)) {
        const name = displayLevelName(c.sessionName || c.sessionId);
        if (name) byId.set(c.sessionId, name);
      }
    });
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort(compareByNameNatural);
  }, [courses]);
  const tags = useMemo(() => {
    const list = [
      ...new Set(
        courses
          .flatMap(
            (c) =>
              c.comma_separeted_tags
                ?.split(",")
                .map((t: string) => t.trim()) || [],
          )
          .filter(Boolean),
      ),
    ].map((tag) => ({ id: tag, name: tag }));
    // Admin-set order (tagOrder) first, the rest natural (1, 2, 3 …).
    // Without one, the first-seen order stays exactly as it was.
    return Array.isArray(tagOrder) && tagOrder.length ? list.sort(byAuthoredOrder(tagOrder)) : list;
  }, [courses, tagOrder]);
  // Courses with no instructor carry the "Unknown Teacher" placeholder as
  // their instructor (see the fetch mapping). Keep it off the filter list so a
  // catalogue of author-less courses does not offer an "Unknown" checkbox.
  const unknownInstructorLabel = t("courseCatalog.unknownInstructor", {
    teacher: getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
  });
  const instructors = useMemo(
    () =>
      [...new Set(courses.map((c) => c.instructor).filter(Boolean))]
        .filter((instructor) => instructor !== unknownInstructorLabel)
        .map((instructor) => ({ id: instructor, name: instructor })),
    [courses, unknownInstructorLabel],
  );

  // Broadcast this block's own filter options up to the page-level Course
  // Finder wizard (CourseCataloguePage), and apply whatever the wizard picks
  // back into local filter state. Cross-tree communication uses the same
  // window-event pattern as openLeadCollection/openAudienceForm elsewhere in
  // this route — the wizard lives outside the JsonRenderer tree, so props
  // can't reach it directly. Sourcing options from THIS component's own
  // levels/sessions/tags (rather than a separate institute-wide fetch) keeps
  // the wizard's picks guaranteed compatible with this component's own id/name
  // conventions (levels match by name, tags are raw case-sensitive strings).
  useEffect(() => {
    if (courses.length === 0) return;
    publishCourseFinderOptions({ levels, sessions, tags });
  }, [courses.length, levels, sessions, tags]);

  // Drop the retained payload when this grid goes away, so a different
  // catalogue page never opens its wizard on this one's levels.
  useEffect(() => clearCourseFinderOptions, []);

  useEffect(() => {
    const handleApplied = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setSelectedLevels(Array.isArray(detail.levels) ? detail.levels : []);
      setSelectedSessions(Array.isArray(detail.sessions) ? detail.sessions : []);
      setSelectedTags(Array.isArray(detail.tags) ? detail.tags : []);
    };
    window.addEventListener("courseFinderApplied", handleApplied);
    return () => window.removeEventListener("courseFinderApplied", handleApplied);
  }, []);

  // Enrollment dialog state
  // Removed enrollment dialog state - all enrollment happens on details page

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Render-slot anchors (catalog/slots): the results column and the card grid.
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const cardFieldsSet = useMemo(
    () =>
      new Set((render?.cardFields ?? []).map((field) => field.toLowerCase())),
    [render?.cardFields],
  );

  const isCardFieldEnabled = (field: string) =>
    cardFieldsSet.size === 0 || cardFieldsSet.has(field.toLowerCase());

  const displayTitle = isCardFieldEnabled("package_name");
  const displayDescription = isCardFieldEnabled("course_html_description_html");
  const displayImage = isCardFieldEnabled("course_preview_image_media_id");
  const displayLevel = isCardFieldEnabled("level_name");
  const displayPrice = isCardFieldEnabled("price");
  const displayQuantity = isCardFieldEnabled("quantity");
  const displayCartActions = isCardFieldEnabled("cart_actions");

  // Determine if cart controls should be shown
  const shouldShowCartControls = useMemo(() => {
    // Priority 1: If cartButtonConfig is explicitly disabled, don't show
    if (cartButtonConfig?.enabled === false) {
      return false;
    }

    // Priority 2: If "cart_actions" is in cardFields, always show (highest priority)
    if (displayCartActions) {
      return true;
    }

    // Priority 3: If cartButtonConfig exists (even if enabled is not explicitly set), show it
    if (cartButtonConfig) {
      return true;
    }

    // Priority 4: If "quantity" is in cardFields (backward compatibility), show it
    if (displayQuantity) {
      return true;
    }

    // Default: don't show if nothing is configured
    return false;
  }, [cartButtonConfig, displayCartActions, displayQuantity]);

  const filtersEnabled = showFilters !== false;
  const filterIds = useMemo(
    () => new Set((filtersConfig ?? []).map((filter) => filter.id)),
    [filtersConfig],
  );
  // Pages created before filter configuration existed have no value at all and
  // retain the historic "show every useful filter" behaviour. An explicit
  // empty array, however, is an admin decision to show none.
  const defaultToAllFilters = !Array.isArray(filtersConfig);

  // How a course preview image sits in the card's image band. `cover` (default)
  // fills it but crops — fine for photos, destructive for wide marketing
  // banners whose edges carry the logo and headline. `contain` shows the whole
  // artwork. Authored per catalogue so institutes with banner-style artwork can
  // opt in without changing anyone else's grid.
  const imageFit: "cover" | "contain" =
    (render?.styles as { imageFit?: "cover" | "contain" } | undefined)
      ?.imageFit === "contain"
      ? "contain"
      : "cover";
  // Level and Session render as soon as there is one real option to pick,
  // the same rule the admin All Courses panel uses. They used to need two,
  // which hid both on the many institutes that run a single level or session.
  const shouldShowLevelFilter =
    filtersEnabled &&
    (defaultToAllFilters || filterIds.has("level")) &&
    levels.length > 0;
  const shouldShowSessionFilter =
    filtersEnabled &&
    (defaultToAllFilters || filterIds.has("session")) &&
    sessions.length > 0;
  const shouldShowTagsFilter =
    filtersEnabled &&
    (defaultToAllFilters || filterIds.has("tags") || filterIds.has("tag")) &&
    tags.length > 0;
  // Same one-option rule as Level/Session, now that the placeholder author is
  // excluded above. It used to need two distinct authors, so an institute with
  // a single author never saw the section it had enabled.
  const shouldShowInstructorFilter =
    filtersEnabled &&
    (defaultToAllFilters ||
      filterIds.has("instructors") ||
      filterIds.has("authors")) &&
    instructors.length > 0;
  const priceFilterConfig = useMemo(
    () =>
      filtersEnabled
        ? (filtersConfig ?? []).find(
            (filter) => filter.type === "range" && filter.field === "price",
          )
        : undefined,
    [filtersConfig, filtersEnabled],
  );
  const shouldShowPriceFilter = filtersEnabled && Boolean(priceFilterConfig);
  const hasFiltersToShow =
    shouldShowLevelFilter ||
    shouldShowSessionFilter ||
    shouldShowTagsFilter ||
    shouldShowInstructorFilter ||
    shouldShowPriceFilter;
  const shouldRenderFiltersPanel = filtersEnabled && hasFiltersToShow;

  const defaultPriceRange = useMemo<PriceRangeState>(() => {
    if (!priceFilterConfig?.default) {
      return null;
    }
    const { min, max } = priceFilterConfig.default;
    const normalized: PriceRangeState = {};
    if (typeof min === "number") {
      normalized.min = min;
    }
    if (typeof max === "number") {
      normalized.max = max;
    }
    return normalized.min !== undefined || normalized.max !== undefined
      ? normalized
      : null;
  }, [priceFilterConfig]);

  const [priceRange, setPriceRange] =
    useState<PriceRangeState>(defaultPriceRange);

  useEffect(() => {
    setPriceRange(defaultPriceRange);
  }, [defaultPriceRange]);

  const handlePriceInputChange = (key: "min" | "max", value: string) => {
    setPriceRange((prev) => {
      const numericValue = value === "" ? undefined : Number(value);
      const updated: { min?: number; max?: number } = { ...(prev || {}) };
      if (numericValue === undefined || Number.isNaN(numericValue)) {
        delete updated[key];
      } else {
        updated[key] = numericValue;
      }
      return updated.min === undefined && updated.max === undefined
        ? null
        : updated;
    });
  };

  const isPriceFilterActive = useMemo(() => {
    if (!priceRange) {
      return false;
    }
    if (!defaultPriceRange) {
      return priceRange.min !== undefined || priceRange.max !== undefined;
    }
    return (
      priceRange.min !== defaultPriceRange.min ||
      priceRange.max !== defaultPriceRange.max
    );
  }, [priceRange, defaultPriceRange]);

  // Check for level filter from sessionStorage on mount
  useEffect(() => {
    const levelFilter = sessionStorage.getItem("levelFilter");
    if (levelFilter) {
      // Set the level filter and clear it from sessionStorage after use
      console.log(
        "[CourseCatalogComponent] Applying level filter from sessionStorage:",
        levelFilter,
      );
      // Normalize the filter value to match the case in course data
      // We'll find the actual case from the courses once they load
      setSelectedLevels([levelFilter]);
      sessionStorage.removeItem("levelFilter");
    }
  }, []);

  // Normalize selectedLevels to match actual level values from courses (case-insensitive matching)
  useEffect(() => {
    if (courses.length > 0 && selectedLevels.length > 0) {
      const actualLevels = [...new Set(courses.map((course) => course.level))];
      const normalizedLevels = selectedLevels.map((selected) => {
        // Find the actual level value that matches (case-insensitive)
        const matched = actualLevels.find(
          (actual) => actual?.toLowerCase() === selected?.toLowerCase(),
        );
        return matched || selected; // Use matched value or keep original
      });

      // Only update if there's a difference (to avoid infinite loop)
      if (
        normalizedLevels.some((level, idx) => level !== selectedLevels[idx])
      ) {
        setSelectedLevels(normalizedLevels);
      }
    }
  }, [courses, selectedLevels.length]); // Only run when courses load or selectedLevels count changes

  // Fetch courses from API
  useEffect(() => {
    const fetchCourses = async () => {
      setIsLoading(true);
      try {
        const response = await axios.post(
          urlCourseDetails,
          {
            status: [],
            level_ids: [],
            faculty_ids: [],
            search_by_name: "",
            tag: [],
            min_percentage_completed: 0,
            max_percentage_completed: 0,
          },
          {
            params: {
              instituteId: instituteId,
              page: 0,
              // Load the full catalogue so client-side filters, search and
              // pagination span every course. The API is server-paginated;
              // fetching a single 50-item page previously capped the UI at ~6
              // pages even when the institute had many more courses.
              // TODO: move to true server-side pagination + facets.
              size: 1000,
              sort: "createdAt,desc",
            },
            headers: {
              "Content-Type": "application/json",
            },
          },
        );

        // Transform API response to Course interface
        const apiCourses = response.data?.content || response.data || [];

        if (apiCourses.length > 0) {
          // Check for enroll_invite_id in the first course
        }
        const transformedCourses: Course[] = apiCourses.map((course: any) => {
          // Get the raw media ID (same priority as study library)
          const thumbnailField =
            course.course_preview_image_media_id ||
            course.course_banner_media_id ||
            course.thumbnail_file_id;
          const thumbnailUrl = thumbnailField || "/api/placeholder/300/200";

          // Parse HTML content safely
          const parseHtmlContent = (htmlString: string) => {
            if (!htmlString) return "";
            return htmlString
              .replace(/<[^>]*>/g, "")
              .replace(/&nbsp;/g, " ")
              .trim();
          };

          // Get pricing from search API response
          // For course catalog, we use min_plan_actual_price from search API
          // This should already be the minimum price from all available plans
          const finalPrice = course.min_plan_actual_price || 0;
          const elevatedPrice =
            typeof course.min_plan_elevated_price === "number"
              ? course.min_plan_elevated_price
              : undefined;
          const isFree = finalPrice === 0;

          return {
            id: course.id || course.packageId,
            title:
              course.package_name ||
              t("courseCatalog.untitledCourse", {
                course: getTerminology(ContentTerms.Course, SystemTerms.Course),
              }),
            description:
              parseHtmlContent(course.course_html_description_html) ||
              t("courseCatalog.noDescriptionAvailable"),
            thumbnail: thumbnailUrl,
            bannerImage: thumbnailUrl, // Use the same image as banner for details page
            price: finalPrice,
            elevatedPrice,
            currency: course.currency,
            type: course.package_type || course.type || "General",
            level: course.level_name || "Beginner",
            instructor:
              course.instructors?.[0]?.full_name ||
              t("courseCatalog.unknownInstructor", {
                teacher: getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
              }),
            duration:
              course.estimated_duration || course.duration || "",
            rating: course.rating || 0,
            packageSessionId: course.package_session_id,
            enrollInviteId: course.enroll_invite_id, // Use real enroll_invite_id from API
            sessionId: course.session_id,
            sessionName: course.session_name,
            // Add all other fields from the API response for dynamic filtering
            ...course,
          };
        });

        if (
          typeof response.data?.totalElements === "number" &&
          response.data.totalElements > transformedCourses.length
        ) {
          console.warn(
            `[CourseCatalogComponent] Loaded ${transformedCourses.length} of ${response.data.totalElements} courses — raise the fetch size for full pagination.`,
          );
        }
        setCourses(transformedCourses);
      } catch (error) {
        console.error(
          "[CourseCatalogComponent] Error fetching courses:",
          error,
        );
        setCourses([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCourses();
  }, [instituteId]);

  // ── Stream tabs + filter state (URL-synced or local) ───────────────────
  const { streams: streamList, isLoading: streamsLoading } = useCatalogStreams(
    instituteId,
    baseDiscovery.streams,
  );
  // [sidebar] What follows the courses' tags, so a tag added to a course shows
  // with no site edit: globalSettings.courseFormatsFromTags turns unclaimed
  // tags into formats (FORMAT options + card pills), and source 'tags' groups
  // ("for parents" → For: Parents) list the tags carrying their prefix.
  // Stream, language and other filter tags are never formats; while the
  // streams load (or when they could not be read) nothing is added, so a
  // stream tag never shows up as a format.
  const effectiveGlobalSettings = useMemo(() => {
    if (baseDiscovery.streams && (streamsLoading || !streamList.length)) return globalSettings;
    const claimed = new Set<string>();
    streamList.forEach((st) => st.tags.forEach((tag) => claimed.add(tagKey(tag))));
    const prefixes: string[] = [];
    baseDiscovery.customFilters.forEach((f) => {
      if (f.labelFromSite) return;
      f.options.forEach((o) => o.tags.forEach((tag) => claimed.add(tag)));
      if (f.fromTags) prefixes.push(f.fromTags.prefix);
    });
    return withTagFormats(
      globalSettings,
      courses,
      (key) => claimed.has(key) || prefixes.some((p) => key.startsWith(`${p}-`)),
    );
  }, [globalSettings, courses, streamList, streamsLoading, baseDiscovery.streams, baseDiscovery.customFilters]);
  const discovery = useMemo(() => {
    if (effectiveGlobalSettings === globalSettings && !baseDiscovery.customFilters.some((f) => f.fromTags)) {
      return baseDiscovery;
    }
    const customFilters = withTagOptions(
      resolveCustomFilters(componentProps.customFilters, effectiveGlobalSettings),
      courses,
    );
    return { ...baseDiscovery, customFilters };
  }, [baseDiscovery, effectiveGlobalSettings, globalSettings, componentProps.customFilters, courses]);
  // The languages the sidebar language filter lists: the ones some course is in.
  const presentLanguages = useMemo(
    () =>
      discovery.languageFilter.enabled
        ? presentLanguageCodes(courses, discovery.languages)
        : [],
    [discovery.languageFilter.enabled, courses, discovery.languages],
  );
  // A link's filter values apply only where this section shows a control for
  // them (or lists applied filters as chips) — see discoveryLinkScope.
  const validation = useMemo<DiscoveryValidation>(
    () =>
      discoveryLinkScope(discovery, {
        streams: streamList,
        filtersShown: filtersEnabled,
        presentLanguages,
      }),
    [discovery, streamList, filtersEnabled, presentLanguages],
  );
  const { state: discoveryState, setState: setDiscoveryState } = useDiscoveryState({
    syncUrl: discovery.syncUrl,
    streamsEnabled: !!discovery.streams,
    ready: !streamsLoading,
    validation,
  });
  const activeStream = findStream(streamList, discoveryState.stream);
  // discoveryState only holds categories this section can show and clear.
  const activeCategories = useMemo(
    () =>
      activeStream
        ? activeStream.categories.filter((c) => discoveryState.categories.includes(c.slug))
        : [],
    [activeStream, discoveryState.categories],
  );

  // Sort: the dropdown's own state, or ?sort= when the section syncs its URL.
  const resolvedDefaultSort = resolveDefaultSort(defaultSort);
  const urlSort = discovery.syncUrl
    ? sortFromToken(readSearchParam(searchStr, URL_PARAMS.sort))
    : null;
  const effectiveSort: CourseCatalogSortOption = discovery.syncUrl
    ? urlSort ?? resolvedDefaultSort
    : sortOption;
  const changeSort = (next: CourseCatalogSortOption) => {
    if (discovery.syncUrl) {
      updateSearchParams({ [URL_PARAMS.sort]: sortToToken(next, resolvedDefaultSort) });
    } else {
      setSortOption(next);
    }
  };
  // "Popular" (enrolment rank) is listed only where the section opted into
  // discovery or pins it as its default — older grids keep their exact menu.
  const sortOptions =
    discovery.active || resolvedDefaultSort === "Popular"
      ? COURSE_CATALOG_SORT_OPTIONS
      : COURSE_CATALOG_SORT_OPTIONS.filter((option) => option !== "Popular");

  // ?q= follows the search box (debounced, replace history); Back/Forward and
  // links that change ?q= flow back into the box.
  const updateParamsRef = useRef(updateSearchParams);
  useEffect(() => {
    updateParamsRef.current = updateSearchParams;
  });
  const lastWrittenQuery = useRef<string | null>(
    discovery.syncUrl ? readSearchParam(searchStr, URL_PARAMS.query) : null,
  );
  useEffect(() => {
    if (!discovery.syncUrl) return;
    const next = searchToParam(searchTerm);
    if (next === lastWrittenQuery.current) return;
    const timer = window.setTimeout(() => {
      lastWrittenQuery.current = next;
      updateParamsRef.current({ [URL_PARAMS.query]: next });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchTerm, discovery.syncUrl]);
  const urlQuery = discovery.syncUrl ? readSearchParam(searchStr, URL_PARAMS.query) : null;
  useEffect(() => {
    if (!discovery.syncUrl || urlQuery === lastWrittenQuery.current) return;
    lastWrittenQuery.current = urlQuery;
    setSearchTerm(urlQuery ?? "");
  }, [urlQuery, discovery.syncUrl]);
  // A submitted search (render slots: hero search button / Enter): the term
  // now, and ?q= now too instead of after the typing debounce.
  const commitSearch = (term: string) => {
    setSearchTerm(term);
    if (!discovery.syncUrl) return;
    const next = searchToParam(term);
    lastWrittenQuery.current = next;
    updateSearchParams({ [URL_PARAMS.query]: next });
  };

  // Course dates (created_at) for the Newest / Oldest sorts and the "New"
  // badge, on a discovery section only: an older grid keeps the order it has
  // always shown under "Newest" — the search's own (see withCreatedAt).
  const datedCourses = useMemo(
    () => withCreatedAt(courses, discovery.active),
    [courses, discovery.active],
  );

  // ── Cards, filters, sort ────────────────────────────────────────────────
  // One card per row (the original grid) or, with groupLanguageVersions, one
  // per course opening the visitor's language: a single language filter
  // wins, else the site language.
  const preferredLanguage = discovery.grouping
    ? (discoveryState.languages.length === 1 ? discoveryState.languages[0] : null) ??
      preferredCourseLanguage(siteLocale, discovery.languages)
    : null;
  const allCards = useMemo(
    () =>
      buildCatalogCards(datedCourses, {
        grouping: discovery.grouping,
        languages: discovery.languages,
        preferredLanguage,
        versionGroups: discovery.versionGroups,
      }),
    [datedCourses, discovery.grouping, discovery.languages, preferredLanguage, discovery.versionGroups],
  );
  // ── Badges: enrolment ranks are fetched only when something uses them ──
  const badgeRules = discovery.badges;
  const needsRanks =
    (!!badgeRules && badgesNeedRanks(badgeRules.types)) ||
    effectiveSort === "Popular" ||
    badgesNeedRanks(discoveryState.badges);
  const { ranks } = usePopularityRanks(instituteId, needsRanks);
  const wantsBadges = !!badgeRules || discoveryState.badges.length > 0;
  const badgeNow = useMemo(() => Date.now(), []);
  const streamTags = useMemo(
    () => streamList.map((s) => s.tag).filter(Boolean),
    [streamList],
  );
  // Package id → its card's id, for cards folding several packages only.
  const versionAlias = useMemo(() => {
    const alias = new Map<string, string>();
    for (const card of allCards) {
      if (!card.courseIds) continue;
      for (const id of card.courseIds) if (id !== card.courseId) alias.set(id, card.courseId);
    }
    return alias;
  }, [allCards]);
  // A folded card ranks as its best-ranked version (as the Popular sort does).
  const badgeRanks = useMemo(() => {
    if (!versionAlias.size) return ranks;
    const merged = new Map(ranks);
    ranks.forEach((rank, id) => {
      const key = versionAlias.get(id);
      if (key === undefined) return;
      const current = merged.get(key);
      if (current === undefined || rank < current) merged.set(key, rank);
    });
    return merged;
  }, [ranks, versionAlias]);
  const badgeInputs = useMemo(() => {
    if (!wantsBadges) return [];
    // One input per course: its versions share created_at and tags; the
    // price is the cheapest version that can be bought now (coming soon,
    // closed or not-yet-open versions count for none) — the same versions
    // the card's price shows, so "Free" never sits on a paid card.
    const byCourse = new Map<
      string,
      { courseId: string; createdAt: string | null; price: number | null; tags: Set<string> }
    >();
    for (const c of datedCourses) {
      const courseId = String(c.id || "");
      if (!courseId) continue;
      const entry = byCourse.get(courseId) ?? {
        courseId,
        createdAt: null,
        price: null,
        tags: new Set<string>(),
      };
      if (!entry.createdAt && typeof c.createdAt === "string") entry.createdAt = c.createdAt;
      if (isBuyableNowRow(c)) {
        const price = Number(c.price) || 0;
        entry.price = entry.price === null ? price : Math.min(entry.price, price);
      }
      courseMatchKeysOf(c).forEach((tag) => entry.tags.add(tag));
      byCourse.set(courseId, entry);
    }
    // A card folding several packages (courseLanguages.versionGroups) gets ONE
    // input under its card id — cheapest buyable version, newest date, every
    // tag — so the filters and pills (keyed by card.courseId) see the badges
    // of all its versions. Without version groups nothing is folded.
    if (versionAlias.size) {
      const folded: typeof byCourse = new Map();
      for (const e of byCourse.values()) {
        const key = versionAlias.get(e.courseId) ?? e.courseId;
        const into = folded.get(key);
        if (!into) {
          folded.set(key, { ...e, courseId: key, tags: new Set(e.tags) });
          continue;
        }
        if (e.createdAt && (!into.createdAt || Date.parse(e.createdAt) > Date.parse(into.createdAt))) {
          into.createdAt = e.createdAt;
        }
        if (e.price !== null) into.price = into.price === null ? e.price : Math.min(into.price, e.price);
        e.tags.forEach((tag) => into.tags.add(tag));
      }
      byCourse.clear();
      folded.forEach((v, k) => byCourse.set(k, v));
    }
    // A course tagged at the category level still counts for its stream.
    return [...byCourse.values()].map((e) => {
      const tags = new Set(e.tags);
      for (const s of streamList) if (s.tags.some((tag) => e.tags.has(tag))) tags.add(s.tag);
      return { courseId: e.courseId, createdAt: e.createdAt, price: e.price, tags: [...tags] };
    });
  }, [wantsBadges, datedCourses, streamList, versionAlias]);
  const displayBadges = useMemo(
    () =>
      badgeRules
        ? computeCourseBadges(badgeInputs, { ranks: badgeRanks, streamTags, now: badgeNow, rules: badgeRules })
        : NO_BADGES,
    [badgeRules, badgeInputs, badgeRanks, streamTags, badgeNow],
  );
  // Filtering by a badge uses every badge a course earned, not the capped display list.
  const earnedBadges = useMemo(
    () =>
      wantsBadges
        ? computeCourseBadges(badgeInputs, {
            ranks: badgeRanks,
            streamTags,
            now: badgeNow,
            rules: { ...badgeRules, types: ALL_BADGES, max: ALL_BADGES.length },
          })
        : NO_BADGES,
    [wantsBadges, badgeRules, badgeInputs, badgeRanks, streamTags, badgeNow],
  );

  const criteria = useMemo<CatalogCriteria>(
    () => ({
      search: searchTerm,
      stream: activeStream,
      // [sidebar] categoryFilter.scope 'all': categories picked on "All courses" filter too.
      categories:
        activeStream || discovery.categoryFilter.scope !== "all"
          ? activeCategories
          : categoriesInScope(discovery.categoryFilter, streamList, null).filter((c) =>
              discoveryState.categories.includes(c.slug),
            ),
      languages: discoveryState.languages,
      price: discoveryState.price,
      badges: discoveryState.badges,
      levels: selectedLevels,
      sessions: selectedSessions,
      tags: selectedTags,
      instructors: selectedInstructors,
      priceRange,
      priceRangeOn: shouldShowPriceFilter,
      // [sidebar] authored option groups — only on a section that has them.
      ...(discovery.customFilters.length
        ? { custom: selectedCustomOptions(discovery.customFilters, discoveryState.custom) }
        : {}),
    }),
    [
      searchTerm,
      activeStream,
      activeCategories,
      discovery.categoryFilter,
      discovery.customFilters,
      streamList,
      discoveryState.categories,
      discoveryState.custom,
      discoveryState.languages,
      discoveryState.price,
      discoveryState.badges,
      selectedLevels,
      selectedSessions,
      selectedTags,
      selectedInstructors,
      priceRange,
      shouldShowPriceFilter,
    ],
  );
  const criteriaContext = useMemo<CriteriaContext>(
    () => ({ languages: discovery.languages, earnedBadges, translate: siteT }),
    [discovery.languages, earnedBadges, siteT],
  );
  const facetGroups = useMemo(
    () => buildFacetGroups<Course>(criteria, criteriaContext),
    [criteria, criteriaContext],
  );
  const titleOf = useCallback(
    (card: CatalogCard<Course>) => siteT(card.primary.title),
    [siteT],
  );
  const matchedCards = useMemo(
    () => applyFacetGroups(allCards, facetGroups),
    [allCards, facetGroups],
  );
  // A merged card's price speaks for the versions that match the active
  // filters and can be bought now ("from ₹X" when they differ); the price
  // sorts follow the same number. Single-version cards keep the original
  // price display and sort.
  const priceViews = useMemo(() => {
    const views = new Map<CatalogCard<Course>, CardPriceView<Course> | null>();
    if (!discovery.grouping) return views;
    for (const card of matchedCards) {
      if (card.rows.length > 1) {
        views.set(card, cardPriceView(card, rowsMatchingGroups(card, facetGroups)));
      }
    }
    return views;
  }, [discovery.grouping, matchedCards, facetGroups]);
  const filteredCards = useMemo(
    () =>
      sortCatalogCards(matchedCards, effectiveSort, {
        ranks,
        titleOf,
        priceOf: (card) => priceViews.get(card)?.minPrice ?? card.sortPrice,
      }),
    [matchedCards, effectiveSort, ranks, titleOf, priceViews],
  );

  // ── Discovery filter groups (sidebar / bottom sheet) ───────────────────
  const priceChoices = useMemo(() => {
    if (!discovery.priceFilter.enabled) return [];
    const list: { value: string; choice: PriceChoice }[] = [];
    if (discovery.priceFilter.showFree) list.push({ value: "free", choice: { kind: "free" } });
    list.push({ value: "paid", choice: { kind: "paid" } });
    for (const max of discovery.priceFilter.maxOptions) {
      list.push({ value: `max:${max}`, choice: { kind: "max", max } });
    }
    // A link may carry an amount the section does not list: show it so it
    // stays visible and can be cleared.
    const current = formatPriceParam(discoveryState.price);
    if (current && discoveryState.price && !list.some((c) => c.value === current)) {
      list.push({ value: current, choice: discoveryState.price });
    }
    return list;
  }, [discovery.priceFilter, discoveryState.price]);
  // The categories the category group lists: the active stream's (scope 'all': every stream's on "All").
  const categoryScope = useMemo(
    () => categoriesInScope(discovery.categoryFilter, streamList, activeStream),
    [discovery.categoryFilter, streamList, activeStream],
  );
  const showCategoryFilter =
    filtersEnabled &&
    discovery.categoryFilter.enabled &&
    categoryScope.length > 0;
  const showLanguageFilter = filtersEnabled && presentLanguages.length > 0;
  const showPriceChoiceFilter = filtersEnabled && priceChoices.length > 0;
  const showFiltersPanel =
    shouldRenderFiltersPanel ||
    (filtersEnabled && (showCategoryFilter || showLanguageFilter || showPriceChoiceFilter)) ||
    (filtersEnabled && discovery.customFilters.length > 0);

  // Live counts: each option counted against every OTHER active filter.
  const facetCounts = useMemo(() => {
    if (!discovery.showFilterCounts) return null;
    const count = (groupId: string, options: FacetOption<CatalogCard<Course>, Course>[]) =>
      countFacetOptions(allCards, facetGroups, groupId, options);
    return {
      category: categoryScope.length
        ? count(GROUP_IDS.category, categoryOptions<Course>(categoryScope))
        : {},
      language: count(GROUP_IDS.language, languageOptions<Course>(presentLanguages, discovery.languages)),
      price: count(GROUP_IDS.price, priceOptions<Course>(priceChoices)),
      level: count(GROUP_IDS.level, levelOptions<Course>(levels.map((l) => l.id))),
      session: count(GROUP_IDS.session, sessionOptions<Course>(sessions.map((s) => s.id))),
      tags: count(GROUP_IDS.tags, tagOptions<Course>(tags.map((tag) => tag.id))),
      instructor: count(
        GROUP_IDS.instructor,
        instructorOptions<Course>(instructors.map((i) => i.id)),
      ),
    };
  }, [
    discovery.showFilterCounts,
    discovery.languages,
    allCards,
    facetGroups,
    categoryScope,
    presentLanguages,
    priceChoices,
    levels,
    sessions,
    tags,
    instructors,
  ]);

  // Display labels (live data through the site dictionary; logic stays on raw values).
  const priceCurrency = useMemo(
    () => courses.find((c) => typeof c.currency === "string" && c.currency)?.currency,
    [courses],
  );
  const priceUnderLabel = (amount: number) =>
    t("courseCatalog.priceUnder", {
      amount: formatAmountLabel(amount, priceCurrency, siteLocale),
      defaultValue: "Under {{amount}}",
    });
  const priceChoiceLabel = (choice: PriceChoice) =>
    choice.kind === "free"
      ? t("courseCatalog.priceFree", "Free")
      : choice.kind === "paid"
        ? t("courseCatalog.pricePaid", "Paid")
        : priceUnderLabel(choice.max);
  const languageName = (code: string) =>
    siteT(discovery.languages.find((l) => l.code === code)?.label || code.toUpperCase());

  const toggleIn = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const selectStream = (slug: string | null) => {
    if (slug === discoveryState.stream) {
      // The active tab again: back to the whole stream (a filter tweak, so
      // the URL entry is replaced). In the URL this also drops a category the
      // section ignores; an unchanged URL is never rewritten.
      if (discovery.syncUrl || discoveryState.categories.length) {
        setDiscoveryState({ categories: [] });
      }
      return;
    }
    // A tab is navigation (pushes history); its categories belong to it.
    setDiscoveryState({ stream: slug, categories: [] }, { push: true });
    // Switched from the stuck tab bar: bring the top of the grid back.
    const top = scrollRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) {
      scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const toggleCategory = (slug: string) =>
    setDiscoveryState({ categories: toggleIn(discoveryState.categories, slug) });
  const toggleLanguage = (code: string) =>
    setDiscoveryState({ languages: toggleIn(discoveryState.languages, code) });
  const selectPrice = (value: string) => {
    const choice = parsePriceParam(value);
    setDiscoveryState({
      price: !choice || samePrice(choice, discoveryState.price) ? null : choice,
    });
  };

  // Quick filters: shortcuts onto the very same state.
  const quickState = {
    languages: discoveryState.languages,
    price: discoveryState.price,
    badges: discoveryState.badges,
    sort: effectiveSort,
  };
  const quickChips = discovery.quickFilters.map((qf) => ({
    id: qf.id,
    label: qf.label || quickFilterDefaultLabel(t, qf, priceUnderLabel, languageName),
    active: isQuickFilterActive(qf, quickState),
  }));
  const toggleQuick = (id: string) => {
    const qf = discovery.quickFilters.find((q) => q.id === id);
    if (!qf) return;
    // A quick filter touches either the sort or the filters, never both.
    const { sort, ...filters } = toggleQuickFilter(qf, quickState, resolvedDefaultSort);
    if (sort) changeSort(sort);
    else if (Object.keys(filters).length) setDiscoveryState(filters);
  };

  // Site-wide cart (globalSettings.siteCart): the card CTA adds to it.
  const siteCartOn =
    isSiteCartEnabled(globalSettings?.siteCart) && globalSettings?.payment?.enabled !== false;
  const hydrateSiteCart = useSiteCartStore((s) => s.hydrate);
  useEffect(() => {
    if (siteCartOn && instituteId) void hydrateSiteCart(instituteId);
  }, [siteCartOn, instituteId, hydrateSiteCart]);
  // The cart checks out through the store page, so a card puts in only the
  // versions the store sells (cardCartOffer). Reads nothing without a site cart.
  const storeSale = useStoreSale(instituteId, globalSettings?.siteCart, siteCartOn);

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const gridId = useId();

  // Pagination: back to page 1 whenever the result set changes, decided
  // during render so a stale page never flashes.
  const filterKey = JSON.stringify([
    courses.length,
    searchTerm,
    selectedLevels,
    selectedSessions,
    selectedTags,
    selectedInstructors,
    effectiveSort,
    priceRange,
    shouldShowPriceFilter,
    discoveryState,
    discovery.grouping,
  ]);
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  if (pageState.key !== filterKey) setPageState({ key: filterKey, page: 1 });
  const currentPage = pageState.key === filterKey ? pageState.page : 1;
  const setCurrentPage = (next: number | ((prev: number) => number)) =>
    setPageState({
      key: filterKey,
      page: typeof next === "function" ? next(currentPage) : next,
    });
  const paginatedCards = filteredCards.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );
  const totalPages = Math.ceil(filteredCards.length / itemsPerPage);

  // Smooth scroll on page change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [currentPage]);

  // Helper function to toggle item in array
  const toggleItem = (
    itemId: string,
    list: string[],
    setter: (newList: string[]) => void,
  ) => {
    if (list.includes(itemId)) {
      setter(list.filter((i) => i !== itemId));
    } else {
      setter([...list, itemId]);
    }
  };

  const clearAllFilters = () => {
    // Forget the Course Finder's answer too, or the levels it chose come
    // straight back on the next reload — the wizard opens once per visitor and
    // will not reopen to ask again, so "clear" has to mean cleared for good.
    clearCourseFinderSelection(courseFinderScope(instituteId, tagName));
    setSelectedLevels([]);
    setSelectedSessions([]);
    setSelectedTags([]);
    setSelectedInstructors([]);
    setSearchTerm("");
    setPriceRange(defaultPriceRange);
    // Discovery filters too — but not the stream: a tab is navigation, not a filter.
    if (discovery.syncUrl) {
      lastWrittenQuery.current = null;
      updateSearchParams({
        ...discoveryPatchToParams({
          categories: [],
          languages: [],
          price: null,
          badges: [],
          ...(discovery.customFilters.length ? { custom: clearedCustomState(discovery.customFilters) } : {}),
        }),
        [URL_PARAMS.query]: null,
      });
    } else if (countDiscoveryFilters(discoveryState) > 0) {
      setDiscoveryState({
        categories: [],
        languages: [],
        price: null,
        badges: [],
        ...(discovery.customFilters.length ? { custom: clearedCustomState(discovery.customFilters) } : {}),
      });
    }
  };

  // Removing one applied-filter chip clears exactly that value.
  const removeChip = (chip: AppliedChip) => {
    switch (chip.group) {
      case "category":
        toggleCategory(chip.value);
        break;
      case "language":
        toggleLanguage(chip.value);
        break;
      case "price":
        setDiscoveryState({ price: null });
        break;
      case "badge":
        setDiscoveryState({ badges: discoveryState.badges.filter((b) => b !== chip.value) });
        break;
      case "level":
        setSelectedLevels((prev) => prev.filter((v) => v !== chip.value));
        break;
      case "session":
        setSelectedSessions((prev) => prev.filter((v) => v !== chip.value));
        break;
      case "tags":
        setSelectedTags((prev) => prev.filter((v) => v !== chip.value));
        break;
      case "instructor":
        setSelectedInstructors((prev) => prev.filter((v) => v !== chip.value));
        break;
      case "priceRange":
        setPriceRange(defaultPriceRange);
        break;
      case "search":
        setSearchTerm("");
        break;
      case "custom": {
        // value = "<groupId>:<optionId>"
        const [groupId, optionId] = chip.value.split(":");
        setDiscoveryState({
          custom: {
            ...discoveryState.custom,
            [groupId]: (discoveryState.custom?.[groupId] ?? []).filter((o) => o !== optionId),
          },
        });
        break;
      }
    }
  };

  const onApplyFilters = () => {
    // Filters are applied automatically via useEffect
    setIsMobileFilterExpanded(false);
  };

  const handleCourseClick = (course: Course) => {
    // All courses navigate to details page with enroll_invite_id
    // Pass enroll_invite_id, banner image, and level as search params so details page can use them
    // ...unless this catalogue gives the course its own authored page, in which
    // case that page replaces the details page entirely. The course params ride
    // along so a checkout CTA placed on that page still knows what to sell.
    const customPageRoute = resolveCoursePageRoute(globalSettings, {
      courseId: course.id,
      packageSessionId: course.packageSessionId,
    });

    const searchParams = new URLSearchParams();
    if (course.enrollInviteId) {
      searchParams.set("enrollInviteId", course.enrollInviteId);
    }
    if (course.packageSessionId) {
      searchParams.set("packageSessionId", course.packageSessionId);
    }
    if (course.bannerImage) {
      searchParams.set("bannerImage", course.bannerImage);
    }
    if (course.level) {
      searchParams.set("level", course.level);
    }

    navigate({
      to: `${RouteMatcher.basePath(tagName)}/${customPageRoute ?? course.id}`,
      search: searchParams.toString()
        ? {
            enrollInviteId: course.enrollInviteId,
            packageSessionId: course.packageSessionId,
            bannerImage: course.bannerImage,
            level: course.level,
          }
        : {},
    });
  };

  const filterBadgeCount =
    selectedLevels.length +
    selectedSessions.length +
    selectedTags.length +
    selectedInstructors.length +
    (shouldShowPriceFilter && isPriceFilterActive ? 1 : 0) +
    countDiscoveryFilters(discoveryState);
  const hasActiveFilters = filterBadgeCount > 0;

  const appliedChips = discovery.showAppliedChips
    ? buildAppliedChips(
        { ...criteria, priceRangeOn: shouldShowPriceFilter && isPriceFilterActive },
        {
          category: (slug) =>
            siteT(categoryScope.find((c) => c.slug === slug)?.title || slug),
          language: languageName,
          price: priceChoiceLabel,
          badge: (badge) => badgeLabel(t, badge),
          level: (level) => siteT(displayLevelName(level) || level),
          session: (id) => siteT(sessions.find((s) => s.id === id)?.name || id),
          instructor: (name) => name,
          priceRange: (range) => formatRangeLabel(range, priceCurrency, siteLocale),
          search: (term) => `“${term}”`,
          custom: (groupId, option) =>
            discovery.customFilters.find((g) => g.id === groupId)?.labelFromSite ? siteT(option.label) : option.label,
        },
      )
    : [];

  // Sidebar groups — rendered in the desktop sidebar and, with
  // mobileFilterSheet, in the phone bottom sheet (same groups, same state).
  const discoveryFilterGroups = (
    <>
      {showCategoryFilter && (
        <DiscoveryFilterGroup
          title={discovery.categoryFilter.label || t("courseCatalog.categories", "Categories")}
          mode="multi"
          options={categoryScope.map((c) => ({
            value: c.slug,
            label: siteT(c.title || c.subtitle || c.slug),
            count: facetCounts?.category[c.slug],
            note: c.comingSoon ? t("courseCatalog.streamSoon", "Soon") : undefined,
          }))}
          selected={discoveryState.categories}
          onToggle={toggleCategory}
        />
      )}
      {showLanguageFilter && (
        <DiscoveryFilterGroup
          title={discovery.languageFilter.label || t("courseCatalog.language", "Language")}
          mode="multi"
          options={presentLanguages.map((code) => ({
            value: code,
            label: languageName(code),
            count: facetCounts?.language[code],
          }))}
          selected={discoveryState.languages}
          onToggle={toggleLanguage}
        />
      )}
      {showPriceChoiceFilter && (
        <DiscoveryFilterGroup
          title={discovery.priceFilter.label || t("courseCatalog.price", "Price")}
          mode="single"
          anyLabel={t("courseCatalog.priceAny", "Any price")}
          options={priceChoices.map(({ value, choice }) => ({
            value,
            label: priceChoiceLabel(choice),
            count: facetCounts?.price[value],
          }))}
          selected={discoveryState.price ? [formatPriceParam(discoveryState.price) || ""] : []}
          onToggle={selectPrice}
          onClear={() => setDiscoveryState({ price: null })}
        />
      )}
    </>
  );

  // Option names are live data: shown through the site dictionary, matched raw.
  const shownName = <T extends { id: string; name: string }>(items: T[]) =>
    items.map((item) => ({ ...item, name: siteT(item.name) }));

  // The min / max inputs of the legacy price-range group (also the editorial
  // sidebar's 'priceRange' section, feature 'sidebar').
  const priceRangeInputs = (
    <div className="flex items-end gap-2 rounded-catalogue-md bg-catalogue-bg-subtle p-3">
      <div className="flex-1 space-y-1">
        <label className="block text-xs text-catalogue-text-secondary">
          {t("courseCatalog.min")}
        </label>
        <input
          type="number"
          min={0}
          value={priceRange?.min ?? ""}
          onChange={(e) =>
            handlePriceInputChange("min", e.target.value)
          }
          className="w-full border border-catalogue-border rounded-catalogue-sm bg-catalogue-bg px-3 py-2 text-sm text-catalogue-text-primary focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      </div>
      <span className="pb-2 text-catalogue-text-muted">–</span>
      <div className="flex-1 space-y-1">
        <label className="block text-xs text-catalogue-text-secondary">
          {t("courseCatalog.max")}
        </label>
        <input
          type="number"
          min={0}
          value={priceRange?.max ?? ""}
          onChange={(e) =>
            handlePriceInputChange("max", e.target.value)
          }
          className="w-full border border-catalogue-border rounded-catalogue-sm bg-catalogue-bg px-3 py-2 text-sm text-catalogue-text-primary focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      </div>
    </div>
  );

  // The original filter groups, shared by the sidebar and the bottom sheet.
  const legacyFilterGroups = (
    <>
      {/* Plural headings, as on the admin All Courses panel
          ("Categories" / "Streams" for an institute that renamed
          Level / Session). Resolved from Naming Settings, which
          institute-naming-seed.ts guarantees are loaded first, unless
          the site's own naming block names them (e.g. "Format"). */}
      {shouldShowLevelFilter && (
        <FilterSection
          title={
            filterHeadings.levels ??
            getTerminologyPlural(ContentTerms.Level, SystemTerms.Level)
          }
          items={shownName(levels)}
          selectedItems={selectedLevels}
          handleChange={(id) =>
            toggleItem(id, selectedLevels, setSelectedLevels)
          }
          disabled={levels.length === 0}
          counts={facetCounts?.level}
        />
      )}

      {shouldShowSessionFilter && (
        <FilterSection
          title={
            filterHeadings.sessions ??
            getTerminologyPlural(ContentTerms.Session, SystemTerms.Session)
          }
          items={shownName(sessions)}
          selectedItems={selectedSessions}
          handleChange={(id) =>
            toggleItem(id, selectedSessions, setSelectedSessions)
          }
          disabled={sessions.length === 0}
          counts={facetCounts?.session}
        />
      )}

      {shouldShowTagsFilter && (
        <FilterSection
          title={
            getTerminologyPlural(
              ContentTerms.PopularTag,
              SystemTerms.PopularTag,
            )
          }
          items={shownName(tags)}
          selectedItems={selectedTags}
          handleChange={(id) =>
            toggleItem(id, selectedTags, setSelectedTags)
          }
          disabled={tags.length === 0}
          counts={facetCounts?.tags}
        />
      )}

      {shouldShowInstructorFilter && (
        <FilterSection
          title={
            filtersConfig?.find(
              (filter) =>
                filter.id === "instructors" ||
                filter.id === "authors",
            )?.label ?? t("courseCatalog.authors")
          }
          items={instructors}
          selectedItems={selectedInstructors}
          handleChange={(id) =>
            toggleItem(
              id,
              selectedInstructors,
              setSelectedInstructors,
            )
          }
          disabled={instructors.length === 0}
          counts={facetCounts?.instructor}
        />
      )}

      {shouldShowPriceFilter && (
        <div className="mb-5 space-y-2.5">
          <h3 className="text-sm font-semibold text-catalogue-text-primary">
            {priceFilterConfig?.label ?? t("courseCatalog.priceRange")}
          </h3>
          {priceRangeInputs}
        </div>
      )}
    </>
  );

  // ── Render slots (catalog/slots) ────────────────────────────────────────
  // Opt-in features render through these; a section without their props gets
  // NO_SLOTS from every hook and the markup below is exactly the original.
  // Content width: the section's own prop, else the site theme's.
  const contentMax = resolveContentMaxWidth(contentMaxWidth ?? globalSettings?.theme?.contentMaxWidth);
  const shellStyle = contentMax === null
    ? undefined
    : (buildContentWidthVars(contentMax) as React.CSSProperties);
  // A section-level palette: CSS vars on this section's root only.
  const sectionPaletteVars = buildPaletteVars(palette, { mode: globalSettings?.mode });
  const sectionStyle = Object.keys(sectionPaletteVars).length
    ? (sectionPaletteVars as React.CSSProperties)
    : undefined;
  const legacyGroupTitle = (key: "level" | "session" | "tags" | "instructor") =>
    key === "level"
      ? filterHeadings.levels ?? getTerminologyPlural(ContentTerms.Level, SystemTerms.Level)
      : key === "session"
        ? filterHeadings.sessions ?? getTerminologyPlural(ContentTerms.Session, SystemTerms.Session)
        : key === "tags"
          ? getTerminologyPlural(ContentTerms.PopularTag, SystemTerms.PopularTag)
          : filtersConfig?.find((filter) => filter.id === "instructors" || filter.id === "authors")?.label ??
            t("courseCatalog.authors");
  const slotContext: CatalogSlotContext = {
    props: componentProps,
    globalSettings: effectiveGlobalSettings,
    instituteId,
    tagName,
    t,
    siteT,
    siteLocale,
    isLoading: isLoading || streamsLoading,
    scrollRef,
    resultsRef,
    gridRef,
    contentMaxWidth: contentMax,
    shellStyle,
    discovery,
    courses,
    streamList,
    activeStream,
    activeCategories,
    discoveryState,
    setDiscoveryState,
    selectStream,
    allCards,
    matchedCards,
    filteredCards,
    paginatedCards,
    criteria,
    facetGroups,
    facetCounts,
    filterKey,
    currentPage,
    totalPages,
    itemsPerPage,
    setCurrentPage,
    searchTerm,
    setSearchTerm,
    commitSearch,
    effectiveSort,
    sortOptions,
    changeSort,
    sortLabel: (option) => sortOptionLabel(t, option),
    quickChips,
    toggleQuick,
    appliedChips,
    removeChip,
    clearAllFilters,
    hasActiveFilters,
    filterBadgeCount,
    filtersEnabled,
    showFiltersPanel,
    mobileFilterSheet: discovery.mobileFilterSheet,
    openFilterSheet: () => setFilterSheetOpen(true),
    defaultFilterGroups: { discovery: discoveryFilterGroups, legacy: legacyFilterGroups },
    filterData: {
      showCategoryFilter,
      showLanguageFilter,
      showPriceChoiceFilter,
      presentLanguages,
      priceChoices,
      priceChoiceLabel,
      languageName,
      toggleCategory,
      toggleLanguage,
      selectPrice,
      legacy: {
        level: {
          shown: shouldShowLevelFilter,
          title: legacyGroupTitle("level"),
          items: shownName(levels),
          selected: selectedLevels,
          toggle: (id) => toggleItem(id, selectedLevels, setSelectedLevels),
        },
        session: {
          shown: shouldShowSessionFilter,
          title: legacyGroupTitle("session"),
          items: shownName(sessions),
          selected: selectedSessions,
          toggle: (id) => toggleItem(id, selectedSessions, setSelectedSessions),
        },
        tags: {
          shown: shouldShowTagsFilter,
          title: legacyGroupTitle("tags"),
          items: shownName(tags),
          selected: selectedTags,
          toggle: (id) => toggleItem(id, selectedTags, setSelectedTags),
        },
        instructor: {
          shown: shouldShowInstructorFilter,
          title: legacyGroupTitle("instructor"),
          items: instructors,
          selected: selectedInstructors,
          toggle: (id) => toggleItem(id, selectedInstructors, setSelectedInstructors),
        },
        priceRange: {
          shown: shouldShowPriceFilter,
          title: priceFilterConfig?.label ?? t("courseCatalog.priceRange"),
          inputs: priceRangeInputs,
        },
      },
    },
    renderCourseCard: (card, index, opts) => renderCourseCard(card, index, opts),
    handleCourseClick,
    priceViews,
    ranks,
    badgeRules,
    displayBadges,
    preferredLanguage,
    siteCartOn,
    storeSale,
  };
  const slots = useCatalogSlots(slotContext);

  // ── One grid card (render slots: renderCourseCard) ─────────────────────
  // The original card markup, unchanged. The 'cards' feature's renderCard
  // (catalog/slots/use-cards-slots.tsx) is asked first and may return an
  // editorial card; undefined keeps this one. Called only while rendering.
  const renderCourseCard = (
    card: CatalogCard<Course>,
    index: number,
    opts?: CourseCardRenderOptions,
  ): React.ReactNode => {
    if (slots.renderCard) {
      const custom = slots.renderCard(card, index, opts);
      if (custom !== undefined) return custom;
    }
    // The card's version on show (the card itself without grouping).
    const course = card.primary;
    // With versions merged, a language-only level ("Hindi") is
    // already said by the language chips.
    const levelLabel =
      discovery.grouping &&
      isPureLanguageLevel(course.level, discovery.languages)
        ? ""
        : displayLevelName(course.level);
    // Compute category label: first tag > non-General type > level
    // (level goes through displayLevelName so backend sentinels
    // like "default" never surface as a category chip)
    const category =
      course.tags?.[0] ||
      (course.type && course.type !== "General" ? course.type : "") ||
      levelLabel ||
      "";
    const categoryStyle = getCategoryStyle(category);
    const courseTerm = getTerminology(
      ContentTerms.Course,
      SystemTerms.Course,
    );
    const courseTitle = siteT(course.title);
    const cartOffer = siteCartOn ? cardCartOffer(card.rows, storeSale) : null;
    // Merged versions: the price speaks for the versions that match
    // the filters and can be bought now (null: none can — show this
    // version's own status). Single-version cards: always null.
    const priceView = priceViews.get(card) ?? null;
    // The version whose price and MRP are shown when they all cost the same.
    const priceRow = priceView && !priceView.from ? priceView.row : course;
    // Coming Soon: ribbon, launch date in place of the price, no
    // cart, and the CTA opens the course's notify form. The card
    // itself still opens the details page.
    const comingSoon = readComingSoon(course.coming_soon);
    const launchLabel = formatLaunchDate(
      comingSoon?.launchDate,
      i18n.language,
    );

    // Determine whether the course has a real image to display
    const hasRealImage =
      displayImage &&
      course.thumbnail &&
      !course.thumbnail.includes("/api/placeholder/") &&
      course.thumbnail.trim() !== "" &&
      course.thumbnail !== "null" &&
      course.thumbnail !== "undefined";

    const cardKey =
      discovery.grouping
        ? `course-${card.courseId}`
        : course.enrollInviteId ??
          `${course.id}-${course.packageSessionId ?? ""}-${index}`;

    return (
      <div
        key={opts?.keyPrefix ? `${opts.keyPrefix}${cardKey}` : cardKey}
        className={cn(
          "bg-catalogue-bg-elevated flex flex-col cursor-pointer border border-catalogue-border-subtle",
          "transition-all duration-300 hover:-translate-y-1 hover:shadow-lg",
          render?.styles?.roundedEdges !== false
            ? "rounded-catalogue-lg overflow-hidden"
            : "rounded-none overflow-hidden",
        )}
        onClick={() => handleCourseClick(course)}
      >
        {/* ── Header band (image or gradient fallback) ── */}
        {displayImage && (
          <div
            className={cn(
              "relative h-44 overflow-hidden flex-shrink-0",
              // `contain` letterboxes, so give the band a surface
              // rather than leaving a bare gap beside the artwork.
              imageFit === "contain" && "bg-catalogue-bg-subtle",
            )}
          >
            {hasRealImage ? (
              /* Real image: fill the band */
              <div className="w-full h-full">
                <CourseImage
                  previewImageUrl={course.thumbnail}
                  alt={courseTitle}
                  className="w-full h-full"
                  // The authored "contain" stays a plain fit; the default fills
                  // the band, or fits an image that filling would cut too much.
                  fit={imageFit === "contain" ? "contain" : undefined}
                />
              </div>
            ) : (
              /* No image: pastel gradient + centered icon */
              <div
                className={cn(
                  "w-full h-full flex items-center justify-center",
                  "bg-gradient-to-br",
                  categoryStyle.band,
                )}
              >
                <BookOpen
                  size={56}
                  weight="duotone"
                  className={categoryStyle.icon}
                />
              </div>
            )}
            {/* Offer badge: top-left overlay */}
            <div className="absolute top-3 start-3">
              <OfferBadge
                actual={priceRow.price}
                elevated={priceRow.elevatedPrice}
              />
            </div>
            {/* End corner, so it never collides with the offer badge */}
            {comingSoon && (
              <div className="absolute top-3 end-3">
                <ComingSoonRibbon info={comingSoon} />
              </div>
            )}
          </div>
        )}

        {/* ── Card body ── */}
        <div className="flex flex-col flex-1 p-5 gap-2">
          {comingSoon && !displayImage && (
            <ComingSoonRibbon info={comingSoon} className="self-start" />
          )}
          {/* Bestseller / Popular / New / Free (badges prop) */}
          {badgeRules && (
            <CourseBadgePills badges={displayBadges.get(card.courseId)} />
          )}
          {/* Category label */}
          {category && (
            <span
              className={cn(
                "text-xs font-bold uppercase tracking-wide",
                categoryStyle.text,
              )}
            >
              {siteT(category)}
            </span>
          )}

          {/* Title */}
          {displayTitle && (
            <h3 className="font-bold text-lg text-gray-900 line-clamp-2 leading-snug">
              {courseTitle}
            </h3>
          )}

          {/* EN / हिं — the languages this course comes in */}
          {discovery.grouping && (
            <LanguageChips languages={card.languages} translate={siteT} />
          )}

          {/* Description — guard against placeholder text */}
          {displayDescription &&
            course.description &&
            course.description !== t("courseCatalog.noDescriptionAvailable") && (
              <p className="text-sm text-gray-500 line-clamp-2 leading-relaxed">
                {siteT(course.description)}
              </p>
            )}

          {/* Spacer pushes meta row to the bottom */}
          <div className="flex-1" />

          {/* ── Meta footer row ── */}
          <div className="border-t border-gray-100 pt-3 flex items-center justify-between gap-2">
            {/* Left: duration + level */}
            <div className="flex items-center gap-3 text-xs text-gray-500 min-w-0">
              {course.duration && (
                <span className="flex items-center gap-1 shrink-0">
                  <Clock size={13} weight="bold" aria-hidden="true" />
                  {course.duration}
                </span>
              )}
              {displayLevel && levelLabel && (
                <span className="flex items-center gap-1 truncate">
                  <ChartBarHorizontal size={13} weight="bold" aria-hidden="true" />
                  {siteT(levelLabel)}
                </span>
              )}
            </div>

            {/* Right: price (or closed/opens-soon when the invite window is not open) */}
            {comingSoon ? (
              <span className="shrink-0 text-xs font-semibold text-primary-500">
                {launchLabel
                  ? t("comingSoon.launchingOn", { date: launchLabel })
                  : t("comingSoon.ribbon")}
              </span>
            ) : displayPrice &&
              globalSettings?.payment?.enabled !== false &&
              (() => {
                // Merged versions at different prices: "from" the
                // cheapest on offer ("from Free" when it costs nothing).
                if (priceView?.from) {
                  return (
                    <div className="shrink-0">
                      <span className="flex items-baseline gap-1">
                        <span className="text-xs text-catalogue-text-muted">
                          {t("courseCatalog.priceFrom", "from")}
                        </span>
                        {priceView.minPrice === 0 ? (
                          <span className="text-xs font-bold text-success-600">
                            {t("courseCatalog.priceFree", "Free")}
                          </span>
                        ) : (
                          <PriceWithMrp
                            actual={priceView.minPrice}
                            currency={priceView.row.currency}
                            size="sm"
                            layout="inline"
                            hideBadge
                          />
                        )}
                      </span>
                    </div>
                  );
                }
                // Merged versions at one price: that version's price.
                if (priceView) {
                  return (
                    <div className="shrink-0">
                      {priceRow.price === 0 ? (
                        <span className="text-xs font-bold text-success-600">
                          {t("courseCatalog.freeLabel")}
                        </span>
                      ) : (
                        <PriceWithMrp
                          actual={priceRow.price}
                          elevated={priceRow.elevatedPrice}
                          currency={priceRow.currency}
                          size="sm"
                          layout="inline"
                          hideBadge
                        />
                      )}
                    </div>
                  );
                }
                const availability = resolveInviteAvailability(
                  course.enroll_invite_availability,
                );
                if (availability !== "AVAILABLE") {
                  return (
                    <div className="shrink-0">
                      <span className="text-xs font-semibold text-orange-600">
                        {availability === "NOT_STARTED"
                          ? t("courseCatalog.openSoon")
                          : t("courseCatalog.enrollmentClosed")}
                      </span>
                    </div>
                  );
                }
                return (
                  <div className="shrink-0">
                    {course.price === 0 ? (
                      <span className="text-xs font-bold text-green-600">
                        {t("courseCatalog.freeLabel")}
                      </span>
                    ) : (
                      <PriceWithMrp
                        actual={course.price}
                        elevated={course.elevatedPrice}
                        currency={course.currency}
                        size="sm"
                        layout="inline"
                        hideBadge
                      />
                    )}
                  </div>
                );
              })()}
          </div>

          {/* Cart controls (the original catalogue cart; the site-wide cart replaces it) */}
          {shouldShowCartControls && !comingSoon && !siteCartOn && (
            <div
              className="mt-1"
              onClick={(e) => e.stopPropagation()}
            >
              <CartControls
                course={course}
                globalSettings={globalSettings}
                cartButtonConfig={cartButtonConfig}
                addItem={addItem}
                getItemByEnrollInviteId={getItemByEnrollInviteId}
                updateQuantity={updateQuantity}
                removeItem={removeItem}
              />
            </div>
          )}

          {siteCartOn && !comingSoon && cartOffer && cartOffer.route !== "page" ? (
            <>
              {/* Site-wide cart: add this course (choosing its
                  language when it has several versions) — the
                  versions the store sells; nothing to press
                  while the store page loads. */}
              {cartOffer.route === "cart" ? (
                <SiteCartCta
                  instituteId={instituteId}
                  courseId={card.courseId}
                  versions={cartOffer.versions}
                  purchasable={cartOffer.purchasable}
                  title={course.title}
                  languages={discovery.languages}
                  translate={siteT}
                  themeAnchor={scrollRef}
                />
              ) : (
                <SiteCartCtaPending />
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCourseClick(course);
                }}
                className="catalogue-btn catalogue-btn-secondary w-full"
              >
                {t("courseCatalog.viewCourse", { course: courseTerm })}
              </button>
            </>
          ) : (
            /* Keyboard-focusable CTA — also the accessible action for
               the whole-card mouse click above. */
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (
                  comingSoon &&
                  openComingSoonForm(
                    comingSoon,
                    t("comingSoon.notifyTitle", { title: courseTitle }),
                  )
                ) {
                  return;
                }
                handleCourseClick(course);
              }}
              className="catalogue-btn catalogue-btn-primary mt-2 w-full"
            >
              {comingSoon
                ? (comingSoon.buttonText && siteT(comingSoon.buttonText)) ||
                  t("comingSoon.notifyMe")
                : t("courseCatalog.viewCourse", { course: courseTerm })}
            </button>
          )}
          {/* The primary CTA opens the form, so keep a keyboard
              path to the details page the card click leads to. */}
          {comingSoon && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCourseClick(course);
              }}
              className="catalogue-btn catalogue-btn-secondary w-full"
            >
              {t("comingSoon.viewDetails")}
            </button>
          )}
        </div>
      </div>
    );
  };

  if (isLoading || streamsLoading) {
    // [slots: rootClassName, loadingStreamTabs — feature 'tabs'] the same root
    // (and a placeholder band) as the loaded section, so nothing shifts.
    const skeleton = (
      <div className={slots.rootClassName ?? "py-8 sm:py-10 w-full bg-catalogue-bg-subtle"}>
        {slots.streamTabsPlacement === "band" && slots.loadingStreamTabs?.()}
        <div
          className={contentMax === null ? "w-full px-4 sm:px-6 lg:px-8 space-y-section" : "catalogue-shell space-y-section"}
          style={shellStyle}
        >
          <div className="catalogue-skeleton-shimmer h-8 w-48"></div>
          {/* [slot: loadingGrid — feature 'cards'] */}
          {slots.loadingGrid ? slots.loadingGrid() : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="catalogue-card-elevated overflow-hidden"
              >
                <div className="catalogue-skeleton-shimmer h-44 w-full rounded-none"></div>
                <div className="flex flex-col gap-2.5 p-4">
                  <div className="catalogue-skeleton-shimmer h-4 w-3/4"></div>
                  <div className="catalogue-skeleton-shimmer h-3 w-full"></div>
                  <div className="catalogue-skeleton-shimmer h-5 w-1/3 mt-1"></div>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
    );
    // [slot: catalogHero — feature 'hero'] stays visible while the grid loads.
    return slots.catalogHero ? (
      <>
        {slots.catalogHero()}
        {skeleton}
      </>
    ) : (
      skeleton
    );
  }

  // StreamTabs renders only with at least one stream; everything below the
  // tabs (filters, toolbar, grid) is then their tab panel.
  const tabsShown = !!discovery.streams && streamList.length > 0;
  // [slot: streamTabsSticky — feature 'tabs'] whether the tabs actually stick (sidebar offset).
  const stickyTabs = tabsShown && (slots.streamTabsSticky ?? !!discovery.streams?.sticky);

  // [slots: streamTabs, streamTabsPlacement — feature 'tabs'] The tabs are
  // rendered through one call; 'band' places them full-bleed at the top of
  // the section root instead of inside the content container.
  const streamTabsProps: StreamTabsProps | null = discovery.streams
    ? {
        streams: streamList,
        active: activeStream?.slug ?? null,
        allLabel: discovery.streams.allLabel,
        labelMode: discovery.streams.labelMode,
        sticky: discovery.streams.sticky,
        onSelect: selectStream,
        controlsId: gridId,
      }
    : null;
  const streamTabsNode =
    streamTabsProps && (slots.streamTabs ? slots.streamTabs(streamTabsProps) : <StreamTabs {...streamTabsProps} />);
  const tabsInBand = slots.streamTabsPlacement === "band";
  // [slot: filterGroups — feature 'sidebar'] one entry point for the sidebar card and the phone sheet.
  const filterGroupsNode = slots.filterGroups ? (
    slots.filterGroups()
  ) : (
    <>
      {discoveryFilterGroups}
      {legacyFilterGroups}
    </>
  );

  const section = (
    <div
      ref={scrollRef}
      className={slots.rootClassName ?? "py-8 sm:py-10 bg-catalogue-bg-subtle w-full"}
      style={sectionStyle}
    >
      {tabsInBand && streamTabsNode}
      <div
        className={contentMax === null ? "w-full px-4 sm:px-6 lg:px-8" : "catalogue-shell"}
        style={shellStyle}
      >
        {/* [slot: hideTitleBlock — feature 'hero'] */}
        {!slots.hideTitleBlock && (
        <div className="mb-6">
          <div className="mb-3 h-1 w-12 rounded-full bg-primary-400" />
          <h2 className="catalogue-h2 text-catalogue-text-primary">
            {title}
          </h2>
          {(render as { subtitle?: string } | undefined)?.subtitle && (
            <p className="mt-2 max-w-2xl text-sm sm:text-base text-catalogue-text-secondary">
              {(render as { subtitle?: string }).subtitle}
            </p>
          )}
        </div>
        )}

        {!tabsInBand && streamTabsNode}

        {/* [slots: columnsClassName … mainColumnClassName — feature 'sidebar'] */}
        <div
          className={slots.columnsClassName ?? `flex flex-col ${showFiltersPanel ? "lg:flex-row" : ""} gap-4 lg:gap-6`}
          id={tabsShown ? gridId : undefined}
          role={tabsShown ? "tabpanel" : undefined}
          aria-labelledby={
            tabsShown ? streamTabId(gridId, activeStream?.slug ?? null) : undefined
          }
        >
          {showFiltersPanel && (
            <div
              className={slots.sidebarColumnClassName ?? `${discovery.mobileFilterSheet ? "hidden lg:block " : ""}w-full lg:w-64 lg:flex-shrink-0 order-1`}
              style={slots.sidebarColumnStyle}
            >
              {/* Below a sticky tab bar the sidebar sticks lower, clear of it. */}
              <div className={slots.sidebarStickyClassName ?? (stickyTabs ? "lg:sticky lg:top-40" : "lg:sticky lg:top-20")}>
                {/* [slot: sidebarTop — feature 'sidebar'] */}
                {slots.sidebarTop?.()}
                {/* [slot: sidebarPanel — feature 'sidebar'] replaces the whole filter card */}
                {slots.sidebarPanel ? slots.sidebarPanel() : (
                <div className="catalogue-surface p-4 sm:p-5 rounded-catalogue-lg border border-catalogue-border-subtle shadow-sm">
                  {/* Mobile Header */}
                  <div className="lg:hidden mb-3">
                    <button
                      onClick={() =>
                        setIsMobileFilterExpanded(!isMobileFilterExpanded)
                      }
                      className="w-full flex items-center justify-between p-2 bg-catalogue-bg-subtle rounded-catalogue-sm hover:bg-catalogue-interactive-hover transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Funnel
                          size={16}
                          className="text-catalogue-text-secondary"
                        />
                        <span className="text-sm font-medium text-catalogue-text-primary">
                          {t("courseCatalog.filters")}
                        </span>
                        {hasActiveFilters && (
                          <span className="catalogue-badge catalogue-badge-primary rounded-full">
                            {filterBadgeCount}
                          </span>
                        )}
                      </div>
                      <CaretDown
                        size={14}
                        className={`text-catalogue-text-muted transition-transform ${isMobileFilterExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>

                  {/* Filter Content - Hidden on mobile when collapsed */}
                  <div
                    className={`lg:block ${isMobileFilterExpanded ? "block" : "hidden"}`}
                  >
                    {/* Desktop Header */}
                    <div className="hidden lg:flex justify-between items-center mb-6">
                      <h2 className="text-lg font-semibold text-catalogue-text-primary">
                        {t("courseCatalog.filters")}
                      </h2>
                      <div className="flex gap-1">
                        {/* Filters apply live on desktop, so no "Apply" button is needed. */}
                        <Button
                          onClick={clearAllFilters}
                          disabled={!hasActiveFilters}
                          className="px-2 py-1 h-fit transition text-xs mt-px"
                        >
                          {t("courseCatalog.clearAll")}
                        </Button>
                      </div>
                    </div>

                    {/* Mobile Header */}
                    <div className="lg:hidden flex justify-between items-center mb-4">
                      <h2 className="text-lg font-semibold text-catalogue-text-primary">
                        {t("courseCatalog.filters")}
                      </h2>
                      <div className="flex gap-1">
                        <Button
                          onClick={clearAllFilters}
                          disabled={!hasActiveFilters}
                          className="px-2 py-1 h-fit transition text-xs mt-px"
                        >
                          {t("courseCatalog.clearAll")}
                        </Button>
                        <Button
                          onClick={onApplyFilters}
                          className="px-2 py-1 h-fit transition text-xs mt-px"
                        >
                          {t("courseCatalog.showResults")}
                        </Button>
                      </div>
                    </div>

                    {filterGroupsNode}
                  </div>
                </div>
                )}
                {/* [slot: sidebarBottom — feature 'sidebar'] promo card */}
                {slots.sidebarBottom?.()}
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div
            ref={resultsRef}
            className={
              slots.mainColumnClassName ?? (showFiltersPanel ? "w-full lg:w-3/4 order-2" : "w-full")
            }
          >
            {/* Search and Sort Bar [slot: resultsHeader — feature 'hero'] */}
            {slots.resultsHeader ? slots.resultsHeader() : (
            <div className="catalogue-toolbar p-3 sm:p-4 mb-6">
              <div className="flex flex-col sm:flex-row gap-stack">
                {/* Search */}
                <div className="flex-1">
                  <div className="relative">
                    <MagnifyingGlass
                      className="absolute start-3 top-1/2 transform -translate-y-1/2 text-catalogue-text-muted"
                      size={20}
                    />
                    <input
                      type="text"
                      placeholder={t("courseCatalog.searchPlaceholder", {
                        courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase(),
                      })}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      aria-label={t("courseCatalog.searchAriaLabel", {
                        courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase(),
                      })}
                      className="w-full ps-10 pe-9 py-2.5 border border-catalogue-border rounded-catalogue-md bg-catalogue-bg text-catalogue-text-primary focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm("")}
                        aria-label={t("common.clearSearch")}
                        className="absolute end-3 top-1/2 -translate-y-1/2 text-catalogue-text-muted hover:text-catalogue-text-primary"
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Sort */}
                <div className="sm:w-48">
                  <div className="relative">
                    <SortAscending
                      className="absolute start-3 top-1/2 transform -translate-y-1/2 text-catalogue-text-muted"
                      size={20}
                    />
                    <select
                      value={effectiveSort}
                      onChange={(e) =>
                        changeSort(
                          e.target.value as CourseCatalogSortOption,
                        )
                      }
                      className="w-full ps-10 pe-4 py-2.5 border border-catalogue-border rounded-catalogue-md bg-catalogue-bg text-catalogue-text-primary focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent appearance-none"
                    >
                      {sortOptions.map((option) => (
                        <option key={option} value={option}>
                          {sortOptionLabel(t, option)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {discovery.mobileFilterSheet && showFiltersPanel && (
                  <MobileFiltersButton
                    count={filterBadgeCount}
                    onClick={() => setFilterSheetOpen(true)}
                  />
                )}
              </div>
            </div>
            )}

            {/* [slot: quickFilterBar — feature 'hero'] */}
            {slots.quickFilterBar ? slots.quickFilterBar() : <QuickFilterBar chips={quickChips} onToggle={toggleQuick} />}
            <AppliedFilterChips
              chips={appliedChips}
              onRemove={removeChip}
              onClearAll={clearAllFilters}
            />

            {/* [slot: beforeGrid — feature 'sections'] */}
            {slots.beforeGrid?.()}

            {/* [slot: gridHeading — feature 'cards'] */}
            {slots.gridHeading?.()}

            {/* Course Grid [slots: gridClassName, visibleCards, renderCard — feature 'cards'] */}
            <div ref={gridRef} className={slots.gridClassName ?? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6"}>
              {(slots.visibleCards ?? paginatedCards).map((card, index) => renderCourseCard(card, index))}
            </div>

            {/* A coming-soon stream: nothing to list yet, collect interest instead */}
            {filteredCards.length === 0 && activeStream?.comingSoon && (
              <div className="catalogue-card flex flex-col items-center gap-stack py-12 px-6 text-center">
                <p className="text-base font-semibold text-catalogue-text-primary">
                  {t("comingSoon.ribbon")}
                </p>
                <p className="max-w-sm text-sm text-catalogue-text-secondary">
                  {t("comingSoon.notifyHint")}
                </p>
                {activeStream.audienceId && (
                  <button
                    type="button"
                    onClick={() =>
                      openComingSoonForm(
                        { enabled: true, audienceId: activeStream.audienceId || undefined },
                        t("comingSoon.notifyTitle", { title: siteT(activeStream.title) }),
                      )
                    }
                    className="catalogue-btn catalogue-btn-primary catalogue-btn-sm mt-1"
                  >
                    {t("comingSoon.notifyMe")}
                  </button>
                )}
              </div>
            )}

            {/* No Results */}
            {filteredCards.length === 0 && !activeStream?.comingSoon && (
              <div className="catalogue-card flex flex-col items-center gap-stack py-12 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                  <MagnifyingGlass size={26} />
                </div>
                <p className="text-base font-semibold text-catalogue-text-primary">
                  {t("courseCatalog.noResultsFound", {
                    courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase(),
                  })}
                </p>
                <p className="max-w-sm text-sm text-catalogue-text-secondary">
                  {t("courseCatalog.noResultsHint")}
                </p>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm mt-1"
                  >
                    {t("courseCatalog.clearAllFilters")}
                  </button>
                )}
              </div>
            )}

            {/* Pagination [slot: pagination — feature 'cards'] */}
            {slots.pagination ? slots.pagination() : totalPages > 1 && (
              <div className="mt-8 flex flex-col items-center gap-4">
                <nav
                  aria-label={t("courseCatalog.paginationAriaLabel")}
                  className="flex flex-wrap items-center justify-center gap-1.5"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentPage((prev) => Math.max(prev - 1, 1))
                    }
                    disabled={currentPage === 1}
                    aria-label={t("common.previousPage")}
                    className="inline-flex h-9 items-center gap-1 rounded-catalogue-md border border-catalogue-border bg-catalogue-bg-elevated px-3 text-sm font-medium text-catalogue-text-secondary transition-colors hover:border-catalogue-border-strong hover:bg-catalogue-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <CaretLeft size={15} weight="bold" />
                    <span className="hidden sm:inline">{t("courseCatalog.previous")}</span>
                  </button>

                  {getPageNumbers(currentPage, totalPages).map((p, i) =>
                    p === "..." ? (
                      <span
                        key={`dots-${i}`}
                        className="select-none px-1.5 text-gray-400"
                      >
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCurrentPage(p as number)}
                        aria-current={currentPage === p ? "page" : undefined}
                        className={cn(
                          "inline-flex h-9 min-w-9 items-center justify-center rounded-catalogue-md border px-2.5 text-sm font-medium transition-colors",
                          currentPage === p
                            ? "border-primary-500 bg-primary-500 text-white shadow-sm"
                            : "border-catalogue-border bg-catalogue-bg-elevated text-catalogue-text-primary hover:border-catalogue-border-strong hover:bg-catalogue-bg-subtle",
                        )}
                      >
                        {p}
                      </button>
                    ),
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                    }
                    disabled={currentPage === totalPages}
                    aria-label={t("common.nextPage")}
                    className="inline-flex h-9 items-center gap-1 rounded-catalogue-md border border-catalogue-border bg-catalogue-bg-elevated px-3 text-sm font-medium text-catalogue-text-secondary transition-colors hover:border-catalogue-border-strong hover:bg-catalogue-bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="hidden sm:inline">{t("courseCatalog.next")}</span>
                    <CaretRight size={15} weight="bold" />
                  </button>
                </nav>

                <p className="text-sm text-catalogue-text-secondary">
                  {t("courseCatalog.showingRange", {
                    from: (currentPage - 1) * itemsPerPage + 1,
                    to: Math.min(currentPage * itemsPerPage, filteredCards.length),
                    total: filteredCards.length,
                    courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase(),
                  })}
                </p>
              </div>
            )}

            {/* [slot: afterGrid — feature 'sections'] */}
            {slots.afterGrid?.()}
          </div>
        </div>
      </div>

      {/* Floating Cart Button - Fixed at bottom right */}
      {/* {cartButtonConfig?.enabled && <div className="fixed bottom-14 right-3 z-50">
        <Button
          onClick={() => navigate({ to: `${RouteMatcher.basePath(tagName)}/cart` })}
          className="h-12 w-12 rounded-full bg-primary hover:bg-primary-700 text-white shadow-lg flex items-center justify-center relative"
          size="sm"
        >
          <ShoppingCart className="h-5 w-5" />
          {getItemCount() > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center text-caption">
              {getItemCount()}
            </span>
          )}
        </Button>
      </div>} */}

      {/* Enrollment dialog removed - all enrollment happens on course details page */}

      {/* Phones: the same filter groups in a bottom sheet (mobileFilterSheet) */}
      {discovery.mobileFilterSheet && showFiltersPanel && (
        <MobileFilterSheet
          open={filterSheetOpen}
          onOpenChange={setFilterSheetOpen}
          themeAnchor={scrollRef}
          resultCount={filteredCards.length}
          canClear={hasActiveFilters}
          onClearAll={clearAllFilters}
        >
          {filterGroupsNode}
        </MobileFilterSheet>
      )}
    </div>
  );

  // [slot: catalogHero — feature 'hero'] above the section root, outside scrollRef.
  return slots.catalogHero ? (
    <>
      {slots.catalogHero()}
      {section}
    </>
  ) : (
    section
  );
};
