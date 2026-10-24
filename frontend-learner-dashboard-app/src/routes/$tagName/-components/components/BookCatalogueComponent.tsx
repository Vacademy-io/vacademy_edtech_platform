import React, { useState, useEffect, useRef, useMemo } from "react";
import { RouteMatcher } from "../../-services/route-matcher";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import {
  fetchBookCataloguePage,
  fetchCatalogueStores,
  BookCatalogueItem,
  CatalogueStore,
} from "../../-services/book-catalogue-service";
import {
  getOpenLevels,
  buildLevelNameToIdMap,
  LevelNameToIdMap,
} from "../../-services/level-service";
import { fetchInstituteCatalogueTags } from "../../-services/institute-tags-service";
import { Button } from "@/components/ui/button";
import {
  MagnifyingGlass,
  ShoppingCart,
  Funnel,
  CaretUp,
  CaretDown,
  X,
  Plus,
  Minus,
  ShoppingBag,
  Trash,
} from "@phosphor-icons/react";
import { toTitleCase, formatTagForDisplay } from "@/lib/utils";
import { useCartStore, CartItem } from "../../-stores/cart-store";
import { toast } from "sonner";
import { ShareButton } from "./ShareButton";
import { OfferBadge, PriceWithMrp } from "@/components/common/price-with-mrp";

interface BookCatalogueProps {
  title: string;
  showFilters: boolean;
  filtersConfig: any[];
  cartButtonConfig?: {
    enabled?: boolean;
    showAddToCartButton?: boolean;
    showQuantitySelector?: boolean;
    quantityMin?: number;
  };
  render: {
    layout: string;
    cardFields: string[];
    styles?: any;
  };
  instituteId: string;
  tagName: string;
  globalSettings?: any;
}

interface Course {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  price: number;
  elevatedPrice?: number;
  currency?: string;
  type: string;
  level: string;
  instructor: string;
  duration: string;
  rating: number;
  // normalized/search helpers
  package_name?: string;
  textContent?: string;
  comma_separeted_tags?: string;
  enrollInviteId?: string;
  packageSessionId?: string;
  available_slots?: number;
  /** The store/session this variant belongs to. Set on every Course; populated from the cheapest variant when no store is filtered. */
  sessionId?: string;
  sessionName?: string;
  /** Total number of distinct stores carrying this book (>=1). Used for the "Available at N stores" hint. */
  storeCount?: number;
  [key: string]: any;
}

// Reusing CourseImage components for consistency
const CourseImage: React.FC<{
  previewImageUrl: string;
  alt: string;
  className?: string;
}> = ({ previewImageUrl, alt, className }) => {
  const isPlaceholder =
    !previewImageUrl ||
    previewImageUrl.includes("/api/placeholder/") ||
    previewImageUrl === "null" ||
    previewImageUrl.trim() === "" ||
    previewImageUrl === "undefined";

  if (isPlaceholder) return null;
  return (
    <CourseImageWithState
      previewImageUrl={previewImageUrl}
      alt={alt}
      className={className}
    />
  );
};

const CourseImageWithState: React.FC<{
  previewImageUrl: string;
  alt: string;
  className?: string;
}> = ({ previewImageUrl, alt, className }) => {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const u = await getPublicUrlWithoutLogin(previewImageUrl);
        if (mounted && u) setUrl(u);
      } catch (err) {
        // ignore, show placeholder pulse
      }
    })();
    return () => {
      mounted = false;
    };
  }, [previewImageUrl]);
  if (!url) return <div className="w-full h-full catalogue-skeleton-shimmer" />;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
};

export const BookCatalogueComponent: React.FC<BookCatalogueProps> = ({
  title,
  showFilters,
  filtersConfig,
  cartButtonConfig,
  render,
  instituteId,
  tagName,
  globalSettings,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const navigate = useNavigate();
  const location = useLocation();
  const { addItem, getItemByEnrollInviteId, updateQuantity, getCartMode, syncCart } =
    useCartStore();

  // Get current cart mode
  const [cartMode, setCartMode] = useState<'buy' | 'rent'>(() => getCartMode());

  // Sync cart when levelFilter changes
  useEffect(() => {
    const checkLevelFilter = () => {
      const levelFilter = sessionStorage.getItem('levelFilter') || '';
      const newMode = levelFilter.toLowerCase().includes('rent') ? 'rent' : 'buy';
      if (newMode !== cartMode) {
        setCartMode(newMode);
        syncCart();
      }
    };

    checkLevelFilter();
    const interval = setInterval(checkLevelFilter, 500); // Check every 500ms

    // Listen for storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'levelFilter') {
        checkLevelFilter();
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Listen for custom events
    const handleLevelFilterChange = () => {
      checkLevelFilter();
    };
    window.addEventListener('levelFilterChanged', handleLevelFilterChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('levelFilterChanged', handleLevelFilterChange);
    };
  }, [cartMode, syncCart]);

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [togle, settogle] = useState(false);

  // Store / session filter — persisted in localStorage like levelFilter.
  // `null` = "all stores"; for buy mode that means show the cheapest variant per
  // book. For rent mode we refuse to render anything until a store is chosen
  // because rent is physical pickup.
  const [storeFilter, setStoreFilterState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("storeFilter") || null;
  });
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const setStoreFilter = (id: string | null) => {
    setStoreFilterState(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem("storeFilter", id);
      else localStorage.removeItem("storeFilter");
      window.dispatchEvent(new CustomEvent("storeFilterChanged"));
    }
  };
  useEffect(() => {
    const onStoreChange = (e: StorageEvent) => {
      if (e.key === "storeFilter") {
        setStoreFilterState(e.newValue || null);
      }
    };
    window.addEventListener("storage", onStoreChange);
    return () => window.removeEventListener("storage", onStoreChange);
  }, []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Debounce search term -> query key so every keystroke doesn't spawn a request
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearchTerm(searchTerm.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  // Auto-focus when search bar opens
  useEffect(() => {
    if (togle && searchInputRef.current) {
      // Small timeout to ensure the transition has started/element is visible
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [togle]);

  // Listen for search bar toggle events from HeaderComponent
  useEffect(() => {
    // Check sessionStorage on mount
    const storedState = sessionStorage.getItem('searchBarOpen');
    if (storedState === 'true') {
      settogle(true);
    }

    // Listen for custom event from HeaderComponent
    const handleToggleSearchBar = (event: CustomEvent) => {
      const isOpen = event.detail?.isOpen ?? false;
      settogle(isOpen);
    };

    window.addEventListener('toggleSearchBar', handleToggleSearchBar as EventListener);

    return () => {
      window.removeEventListener('toggleSearchBar', handleToggleSearchBar as EventListener);
    };
  }, []);

  // --- SEARCH SYNC WITH HEADER & OTHER TABS ---
  // We listen for:
  // 1) a custom "search-updated" event dispatched in same tab by Header component
  // 2) native "storage" events (other tabs)
  // On mount we'll also read sessionStorage if header placed a term there.
  useEffect(() => {
    const applySessionSearch = () => {
      const term = sessionStorage.getItem("searchTerm") || "";
      // do not remove it here — allow Header/back-navigation to keep it if needed
      if (term && term !== searchTerm) {
        setSearchTerm(term);
      }
    };

    // run once on mount (and when route changes)
    applySessionSearch();

    const onCustom = () => {
      applySessionSearch();
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === "searchTerm") {
        // e.newValue may be null if cleared
        const t = e.newValue || "";
        if (t !== searchTerm) setSearchTerm(t);
      }
    };

    window.addEventListener("search-updated", onCustom);
    window.addEventListener("storage", onStorage);
    // Also handle focus (user returns)
    const onFocus = () => applySessionSearch();
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("search-updated", onCustom);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]); // re-run when route changes so new searchTerms on route apply

  // Genre filter is enabled whenever catalogue_json has a "tag" filter entry.
  // The actual genre list is fetched live from the institute's distinct catalogue
  // tags, so admin-created tags show up automatically without editing catalogue_json.
  const genreConfig = useMemo(() => filtersConfig?.find((f) => f.id === "tag"), [filtersConfig]);
  const showGenreFilter = Boolean(genreConfig);

  const { data: genres = [] } = useQuery<string[]>({
    queryKey: ["institute-catalogue-tags", instituteId],
    queryFn: () => fetchInstituteCatalogueTags(instituteId),
    enabled: !!instituteId && showGenreFilter,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  // Resolve level_name ("buy" / "rent") -> level_id via the open levels endpoint.
  // Cached long-term; levels rarely change and this is shared across mode toggles.
  const { data: levelIdMap } = useQuery<LevelNameToIdMap>({
    queryKey: ["open-levels", instituteId],
    queryFn: async () => buildLevelNameToIdMap(await getOpenLevels(instituteId)),
    enabled: !!instituteId,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  const currentLevelId = levelIdMap?.[cartMode];
  const PAGE_SIZE = 30;

  // Discover stores for this institute / current level. The list is the union
  // of sessions seen in a wide, unfiltered fetch — so empty stores are hidden
  // naturally.
  const { data: storeList = [] } = useQuery<CatalogueStore[]>({
    queryKey: ["catalogue-stores", instituteId, currentLevelId ?? null],
    queryFn: () => fetchCatalogueStores(instituteId, currentLevelId ? [currentLevelId] : []),
    enabled: !!instituteId && !!currentLevelId,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  // If the persisted store filter doesn't exist in this institute (e.g. user
  // switched institutes, store was deleted), clear it.
  useEffect(() => {
    if (storeFilter && storeList.length > 0 && !storeList.some((s) => s.id === storeFilter)) {
      setStoreFilter(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeFilter, storeList]);

  const activeStoreName = useMemo(
    () => storeList.find((s) => s.id === storeFilter)?.name,
    [storeFilter, storeList]
  );

  // Rent mode without a store is an empty state — physical pickup means we
  // cannot show "any" inventory honestly.
  const rentRequiresStorePick = cartMode === "rent" && !storeFilter;

  // Paginated, server-filtered catalogue fetch.
  // Different (mode, search, genres) -> different cache entry, so mode toggles hit cache once warmed.
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: [
      "book-catalogue",
      instituteId,
      currentLevelId ?? null,
      storeFilter ?? null,
      debouncedSearchTerm,
      [...selectedGenres].sort(),
    ],
    queryFn: ({ pageParam }) =>
      fetchBookCataloguePage({
        instituteId,
        levelIds: currentLevelId ? [currentLevelId] : [],
        sessionIds: storeFilter ? [storeFilter] : [],
        searchByName: debouncedSearchTerm,
        tags: selectedGenres,
        page: pageParam as number,
        size: PAGE_SIZE,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.last ? undefined : lastPage.number + 1),
    enabled: !!instituteId && !!currentLevelId && !rentRequiresStorePick,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  // Flatten pages -> rendered Course[]. The catalogue API returns one row per
  // package_session, so a book sold at N stores returns N rows. We group by
  // package id and pick a "best" variant:
  //   * if a store is filtered, every group has exactly one row (the API
  //     already narrowed it)
  //   * otherwise, pick the cheapest variant so the customer sees the best deal
  // We also count distinct stores per book to surface "Available at N stores".
  const displayedCourses: Course[] = useMemo(() => {
    const raw: BookCatalogueItem[] = data?.pages.flatMap((p) => p.content) ?? [];
    const variantsByPackage = new Map<string, BookCatalogueItem[]>();
    for (const c of raw) {
      if (!c.id) continue;
      const arr = variantsByPackage.get(c.id);
      if (arr) arr.push(c);
      else variantsByPackage.set(c.id, [c]);
    }

    const result: Course[] = [];
    for (const [, variants] of variantsByPackage) {
      // Cheapest first; missing prices sort to the end.
      const sorted = [...variants].sort((a, b) => {
        const av = a.min_plan_actual_price ?? Number.POSITIVE_INFINITY;
        const bv = b.min_plan_actual_price ?? Number.POSITIVE_INFINITY;
        return av - bv;
      });
      const c = sorted[0];
      const storeCount = new Set(
        variants.map((v) => v.session_id).filter((id): id is string => Boolean(id))
      ).size;

      const htmlContent = c.course_html_description_html || "";
      const textContent = htmlContent
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim()
        .toLowerCase();

      result.push({
        ...c,
        title: c.package_name || t("bookCatalogue.untitledBook"),
        description: textContent,
        thumbnail: c.course_banner_media_id || "/api/placeholder/300/400",
        price: c.min_plan_actual_price || 0,
        elevatedPrice: c.min_plan_elevated_price ?? undefined,
        currency: c.currency,
        type: c.package_type || "Book",
        level: c.level_name || "General",
        instructor: c.instructors?.[0]?.full_name || "",
        duration: c.estimated_duration || "",
        rating: c.rating || 0,
        packageSessionId: c.package_session_id,
        enrollInviteId: c.enroll_invite_id,
        sessionId: c.session_id,
        sessionName: c.session_name,
        storeCount,
        package_name: (c.package_name || "").toLowerCase(),
        textContent,
        available_slots: c.availableSlots !== undefined ? c.availableSlots : c.available_slots,
      });
    }
    return result;
  }, [data, t]);

  const totalBooks = data?.pages[0]?.totalElements ?? 0;

  // Skeleton should stay up while either levels or the first page are still loading.
  const isInitialLoading = isLoading || (!!instituteId && !levelIdMap);

  // IntersectionObserver drives server-side pagination via fetchNextPage.
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { root: null, rootMargin: "300px", threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.unobserve(sentinel);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, displayedCourses.length]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]));
  };

  const handleBookClick = (book: Course) => {
    const searchParams = new URLSearchParams();
    if (book.enrollInviteId) searchParams.set("enrollInviteId", book.enrollInviteId);
    if (book.packageSessionId) searchParams.set("packageSessionId", book.packageSessionId);
    if (book.thumbnail) searchParams.set("bannerImage", book.thumbnail);
    if (book.level) searchParams.set("level", book.level);
    if (book.price !== undefined && book.price !== null) searchParams.set("price", book.price.toString());
    if (book.available_slots !== undefined) searchParams.set("available_slots", book.available_slots.toString());

    navigate({
      to: `${RouteMatcher.basePath(tagName)}/${book.id}`,
      search: searchParams.toString() ? Object.fromEntries(searchParams) : {},
    });
  };

  // Helper: clear search (also notify header)
  const clearSearch = () => {
    setSearchTerm("");
    try {
      sessionStorage.removeItem("searchTerm");
      window.dispatchEvent(new Event("search-updated"));
    } catch {
      // ignore
    }
  };

  // Render
  return (
    <div className="w-full bg-gray-50 min-h-screen pb-20 pt-14">
      {/* 1. Header Section with Title and Search */}
      {/* 1. Header Section with Title and Search */}
      <div className="p-0 leading-none sticky top-14 z-40 bg-gray-50/95 backdrop-blur-sm shadow-sm transition-all duration-300">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-0 pt-0 border-b  border-gray-200">
          <div className="flex flex-col md:flex-row justify-between items-center ">
            <div className="w-full md:w-auto">
              <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            </div>

            {/* SEARCH BAR (added) */}
            <div className={`w-full overflow-hidden transition-all duration-300 ease-in-out px-2 origin-top ${togle ? "max-h-20 opacity-100 py-2" : "max-h-0 opacity-0 py-0"}`}>
              <div className="relative border-gray-400">
                <MagnifyingGlass className="absolute start-3 top-1/2 transform -translate-y-1/2 text-catalogue-text-muted" size={18} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={t("bookCatalogue.searchPlaceholder")}
                  value={searchTerm}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSearchTerm(v);
                    try {
                      // keep sessionStorage in sync so Header/back-navigation can work
                      if (v && v.trim()) sessionStorage.setItem("searchTerm", v);
                      else sessionStorage.removeItem("searchTerm");
                      // notify other same-tab listeners (Header)
                      window.dispatchEvent(new Event("search-updated"));
                    } catch {
                      // ignore storage errors (private mode etc)
                    }
                  }}
                  className="w-full ps-10 pe-10 py-2 border border-catalogue-border rounded-catalogue-md focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 bg-catalogue-bg text-catalogue-text-primary shadow-md"
                />
                {searchTerm && (
                  <button
                    onClick={clearSearch}
                    aria-label={t("common.clearSearch")}
                    className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    type="button"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-catalogue-bg border-b border-catalogue-border-subtle z-10 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-0">

          {/* Store picker — single-select, persisted. Mandatory for rent mode. */}
          {storeList.length > 0 && (
            <div className="pt-3 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {t("bookCatalogue.store")}
                </span>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setStoreMenuOpen((o) => !o)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      storeFilter
                        ? "bg-primary-50 border-primary-300 text-primary-500"
                        : "bg-catalogue-bg border-catalogue-border text-catalogue-text-secondary hover:border-catalogue-border-strong"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                    {storeFilter ? activeStoreName || t("bookCatalogue.selectedStore") : t("bookCatalogue.allStores")}
                    <CaretDown className={`h-3.5 w-3.5 transition-transform ${storeMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {storeMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setStoreMenuOpen(false)} />
                      <div className="absolute start-0 z-50 mt-2 min-w-44 rounded-catalogue-md border border-catalogue-border bg-catalogue-bg py-1 shadow-md">
                        {cartMode !== "rent" && (
                          <button
                            onClick={() => {
                              setStoreFilter(null);
                              setStoreMenuOpen(false);
                            }}
                            className={`w-full text-start px-3 py-2 text-sm hover:bg-gray-50 ${
                              !storeFilter ? "bg-primary-50 text-primary-500 font-semibold" : "text-catalogue-text-secondary"
                            }`}
                          >
                            {t("bookCatalogue.allStores")}
                          </button>
                        )}
                        {storeList.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => {
                              setStoreFilter(s.id);
                              setStoreMenuOpen(false);
                            }}
                            className={`w-full text-start px-3 py-2 text-sm hover:bg-gray-50 ${
                              storeFilter === s.id ? "bg-primary-50 text-primary-500 font-semibold" : "text-catalogue-text-secondary"
                            }`}
                          >
                            {s.name || s.id}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {cartMode === "rent" && !storeFilter && (
                  <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    {t("bookCatalogue.pickStoreRentHint")}
                  </span>
                )}
                {cartMode !== "rent" && !storeFilter && (
                  <span className="text-xs text-gray-500">
                    {t("bookCatalogue.bestPriceHint")}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 2. Enhanced Genres UI - Horizontal Scrollable Chips */}
          {showGenreFilter && genres.length > 0 && (
            <div className="mt-0">
              <div className="flex font-bold flex-col gap-1">
                <div className="flex items-center justify-between ">
                  <h2 className="text-lg font-bold text-catalogue-text-primary tracking-tight flex items-center gap-2 flex-wrap">
                    <span>{t("bookCatalogue.browseByGenre")}</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary-50 text-primary-500 border border-primary-200 shadow-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
                      {cartMode === 'rent' ? t("bookCatalogue.rentMode") : t("bookCatalogue.buyMode")}
                    </span>
                  </h2>
                  {selectedGenres.length > 0 && (
                    <button
                      onClick={() => setSelectedGenres([])}
                      className="text-sm font-medium text-primary-500 hover:text-primary-400 transition-colors"
                    >
                      {t("bookCatalogue.clearAll")}
                    </button>
                  )}
                </div>
                <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 pb-2">
                  {genres.map((genre: string) => {
                    const isSelected = selectedGenres.includes(genre);
                    return (
                      <button
                        key={genre}
                        onClick={() => toggleGenre(genre)}
                        style={{ touchAction: "manipulation" }}
                        className={`
                          group relative flex items-center gap-2 whitespace-nowrap
                          px-3 py-2 rounded-catalogue-lg text-sm font-bold transition-all duration-300
                          border cursor-pointer
                          ${isSelected
                            ? "bg-primary-500 border-primary-500 shadow-md text-white active:bg-primary-400 active:scale-95"
                            : "bg-white text-gray-700 border-gray-200 hover:bg-primary-500 hover:text-white hover:border-primary-500 hover:shadow-md active:bg-primary-400 active:text-white active:border-primary-400 active:shadow-md active:scale-95"
                          }
                        `}
                      >
                        <span>{formatTagForDisplay(genre)}</span>
                        {isSelected && (
                          <span className="bg-white/20 rounded-full p-0.5 ms-1 hover:bg-white/30 active:bg-white/40 text-black transition-colors">
                            <X className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Book Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        {rentRequiresStorePick ? (
          <div className="flex flex-col items-center justify-center gap-stack py-16 text-center">
            <ShoppingBag className="h-10 w-10 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-700">{t("bookCatalogue.pickStoreTitle")}</h3>
            <p className="text-sm text-gray-500 max-w-md">
              {t("bookCatalogue.pickStoreDescription")}
            </p>
            {storeList.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center mt-1">
                {storeList.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStoreFilter(s.id)}
                    className="px-3 py-1.5 rounded-full text-sm font-medium border border-primary-300 bg-primary-50 text-primary-500 hover:bg-primary-100 transition-colors"
                  >
                    {s.name || s.id}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : isInitialLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="aspect-[9/16] catalogue-skeleton-shimmer rounded-catalogue-lg" />
            ))}
          </div>
        ) : displayedCourses.length === 0 ? (
          <div className="text-catalogue-text-muted text-xl font-medium mb-4">{t("bookCatalogue.noBooksFound")}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-y-4 gap-x-4">
              {displayedCourses.map((book) => {

                return (
                  <div
                    key={book.id}
                    className="group relative isolate flex flex-col cursor-pointer perspective-1000   rounded-catalogue-lg"

                    onClick={() => handleBookClick(book)}
                  >
                    {/* Book Cover */}
                    <div className="relative aspect-[9/16] rounded-catalogue-lg overflow-hidden shadow-lg transition-all duration-500 ease-out md:group-hover:-translate-y-2 ring-1 ring-black/5 bg-gradient-to-br from-warning-50 via-white to-warning-100">
                      {/* Decorative frame inner shadow - desktop only (mobile has no hover so shows expanded state) */}
                      <div className="absolute inset-0 shadow-card-inset opacity-0 md:opacity-100 md:group-hover:opacity-0 transition-opacity duration-500 ease-out pointer-events-none rounded-catalogue-lg" />

                      {/* Padded image wrapper - mobile always expanded; desktop: p-4 default, collapses to p-0 on hover */}
                      <div className="absolute inset-0 p-0 md:p-4 md:group-hover:p-0 transition-[padding] duration-500 ease-out">
                        <CourseImage previewImageUrl={book.thumbnail} alt={book.title} className="w-full h-full object-contain drop-shadow-lg" />
                      </div>

                      {/* Top-left badge stack: offer badge + stock / multi-store hint */}
                      <div className="absolute top-2 start-2 z-20 flex flex-col items-start gap-1">
                        <OfferBadge actual={book.price} elevated={book.elevatedPrice} />
                        {!storeFilter && (book.storeCount ?? 0) > 1 ? (
                          <div className="px-2 py-1 rounded-catalogue-md text-caption font-bold bg-white/90 backdrop-blur-sm shadow-sm flex items-center gap-1.5 border border-white/20">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <span className="text-blue-700 uppercase tracking-wider">{t("bookCatalogue.availableAtStores", { count: book.storeCount })}</span>
                          </div>
                        ) : book.available_slots !== undefined && (
                          <div className="px-2 py-1 rounded-catalogue-md text-caption font-bold bg-white/90 backdrop-blur-sm shadow-sm flex items-center gap-1.5 border border-white/20">
                            {book.available_slots > 5 ? (
                              <>
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-glow-live-green" />
                                <span className="text-green-700 uppercase tracking-wider">{t("common.inStock")}</span>
                              </>
                            ) : book.available_slots > 0 ? (
                              <>
                                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shadow-glow-live-orange" />
                                <span className="text-orange-700 uppercase tracking-wider">{t("common.onlyLeft", { count: book.available_slots })}</span>
                              </>
                            ) : (
                              <>
                                <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                                <span className="text-gray-600 uppercase tracking-wider">{t("common.outOfStock")}</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Share Button - top-right corner */}
                      {book.packageSessionId && (
                        <div className="absolute top-2 end-2 z-20">
                          <ShareButton
                            packageSessionId={book.packageSessionId}
                            destinationUrl={`${window.location.origin}/${tagName}/${book.id}?packageSessionId=${book.packageSessionId}${book.enrollInviteId ? `&enrollInviteId=${book.enrollInviteId}` : ""}${book.level ? `&level=${book.level}` : ""}`}
                            instituteId={instituteId}
                            title={book.title}
                            size="sm"
                          />
                        </div>
                      )}

                      {/* Bottom Gradient Overlay - visible on mobile always; desktop on hover */}
                      <div className="absolute bottom-0 start-0 end-0 h-32 bg-gradient-to-t from-black/70 via-black/40 to-transparent opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-500 ease-in-out pointer-events-none" />

                      {/* Quick Action Overlay - visible on mobile always; desktop slides up on hover */}
                      {cartButtonConfig?.enabled !== false && (
                        <div className="cart-button-overlay absolute bottom-0 start-0 end-0 p-2 sm:p-3 md:p-4 transform translate-y-0 md:translate-y-full md:group-hover:translate-y-0 transition-all duration-500 ease-out z-10">
                          {/* Add to Cart Logic */}
                          <div className="flex justify-center w-full min-w-0" onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              const existingItem = book.enrollInviteId ? getItemByEnrollInviteId(book.enrollInviteId) : null;
                              const isBuyMode = cartMode === 'buy';

                              // Show counter for Buy mode if item exists, or for Rent mode show "Go to Cart"
                              if (existingItem) {
                                // Buy mode: show quantity controls
                                if (isBuyMode) {
                                  return (
                                    <div className="flex items-center gap-1.5 w-full min-w-0 justify-center">
                                      <div className="flex items-center border border-gray-200 rounded-catalogue-md bg-white shadow-xl flex-shrink-0">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 hover:bg-catalogue-interactive-hover active:bg-catalogue-interactive-active rounded-s-catalogue-md transition-all duration-150"
                                          onClick={async () => {
                                            if (book.enrollInviteId) {
                                              await updateQuantity(book.enrollInviteId, existingItem.quantity - 1);
                                              window.dispatchEvent(new CustomEvent('cartUpdated'));
                                            }
                                          }}
                                          disabled={!book.enrollInviteId}
                                        >
                                          <Minus className="h-3.5 w-3.5" />
                                        </Button>
                                        <span className="w-6 text-center text-xs font-semibold text-gray-700">{existingItem.quantity}</span>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 hover:bg-catalogue-interactive-hover active:bg-catalogue-interactive-active rounded-e-catalogue-md transition-all duration-150"
                                          onClick={async () => {
                                            if (book.enrollInviteId) {
                                              await updateQuantity(book.enrollInviteId, existingItem.quantity + 1);
                                              window.dispatchEvent(new CustomEvent('cartUpdated'));
                                            }
                                          }}
                                          disabled={!book.enrollInviteId || book.available_slots === 0}
                                        >
                                          <Plus className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                      {/* Go to Cart button */}
                                      <Button
                                        className="h-7 px-2 bg-primary-400 hover:bg-primary-500 text-white text-caption font-semibold rounded-catalogue-md shadow-md flex items-center gap-1 flex-shrink-0 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                                        onClick={() => navigate({ to: `${RouteMatcher.basePath(tagName)}/cart` })}
                                      >
                                        <ShoppingBag className="h-3 w-3" />
                                        {t("bookCatalogue.cart")}
                                      </Button>
                                    </div>
                                  );
                                }

                                // Rent mode: show "Remove from Cart" + "Go to Cart"
                                return (
                                  <div className="flex items-center gap-1.5 w-full min-w-0">
                                    <Button
                                      className="flex-1 min-w-0 px-2 h-8 bg-red-50 hover:bg-red-100 text-red-600 text-caption font-semibold shadow-md rounded-catalogue-md border border-red-200 flex items-center justify-center gap-1 transition-all duration-200 active:scale-[0.98]"
                                      onClick={async () => {
                                        if (book.enrollInviteId) {
                                          await updateQuantity(book.enrollInviteId, 0);
                                          window.dispatchEvent(new CustomEvent('cartUpdated'));
                                          toast.success(t("bookCatalogue.toast.removedFromCart"), { duration: 2000 });
                                        }
                                      }}
                                    >
                                      <Trash className="h-3 w-3 flex-shrink-0" />
                                      <span className="truncate">{t("common.remove")}</span>
                                    </Button>
                                    <Button
                                      className="h-8 px-2 bg-primary-400 hover:bg-primary-500 text-white text-caption font-semibold rounded-catalogue-md shadow-md flex items-center gap-1 flex-shrink-0 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                                      onClick={() => navigate({ to: `${RouteMatcher.basePath(tagName)}/cart` })}
                                    >
                                      <ShoppingBag className="h-3 w-3" />
                                      Cart
                                    </Button>
                                  </div>
                                );
                              }

                              // Show Add to Cart button
                              return (
                                <Button
                                  className="px-6 w-full bg-white text-gray-900 text-sm font-medium shadow-xl hover:bg-primary-50 hover:text-primary-500 active:bg-primary-100 active:scale-95 transition-all duration-300 transform py-2 rounded-catalogue-md border border-gray-200"
                                  onClick={async () => {
                                    if (book.enrollInviteId) {
                                      await addItem({
                                        id: book.id,
                                        title: book.title,
                                        price: book.price,
                                        elevatedPrice: book.elevatedPrice,
                                        currency: book.currency,
                                        image: book.thumbnail,
                                        level: book.level,
                                        packageSessionId: book.packageSessionId,
                                        enrollInviteId: book.enrollInviteId,
                                        levelId: book.levelId,
                                        sessionId: book.sessionId,
                                        sessionName: book.sessionName,
                                        courseId: book.courseId,
                                      });
                                      // Dispatch event to update cart count in header
                                      window.dispatchEvent(new CustomEvent('cartUpdated'));
                                      toast.success(t("bookCatalogue.toast.addedToCart"), { duration: 2000 });
                                    }
                                  }}
                                  disabled={!book.enrollInviteId || book.available_slots === 0}
                                  style={{ touchAction: "manipulation" }}
                                >
                                  <ShoppingCart className="h-4 w-4 me-2" />
                                  {book.available_slots === 0 ? t("common.outOfStock") : t("common.addToCart")}
                                </Button>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Book Info */}
                    <div className="mt-5 space-y-2 px-1">
                      <h3 className="text-base font-bold text-gray-800 line-clamp-2 leading-tight group-hover:text-primary-500 transition-colors duration-300">
                        {book.title}
                      </h3>
                      {render.cardFields.includes("price") && cartMode === 'buy' && (
                        <div>
                          <PriceWithMrp
                            actual={book.price}
                            elevated={book.elevatedPrice}
                            currency={book.currency}
                            size="md"
                          />
                          {!storeFilter && book.sessionName && (
                            <p className="text-caption text-gray-500 mt-0.5">
                              {t("bookCatalogue.fromPrefix")} <span className="font-medium text-gray-700">{book.sessionName}</span>
                              {(book.storeCount ?? 0) > 1 ? ` ${t("bookCatalogue.lowestPriceSuffix")}` : ""}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-catalogue-xs text-xs font-medium bg-gray-100 text-gray-600 line-clamp-1">
                          {(() => {
                            const htmlContent = book.course_html_description_html || "";
                            if (!htmlContent) return "";
                            const textContent = htmlContent
                              .replace(/<[^>]*>/g, "")
                              .replace(/&nbsp;/g, " ")
                              .replace(/&amp;/g, "&")
                              .replace(/&lt;/g, "<")
                              .replace(/&gt;/g, ">")
                              .replace(/&quot;/g, '"')
                              .replace(/&#39;/g, "'")
                              .trim();
                            return textContent;
                          })()}
                        </span>
                        {render.cardFields.includes("price") && (
                          <div className="flex flex-col items-end gap-1">
                            {/* Tags display */}
                            {book.comma_separeted_tags && (
                              <div className="flex flex-wrap justify-end gap-1 max-w-32">
                                {book.comma_separeted_tags.split(',').filter(t => t.trim()).slice(0, 2).map((tag, i) => (
                                  <span key={i} className="text-caption font-medium text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-catalogue-xs border border-gray-100 line-clamp-1">
                                    {tag.trim()}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Infinite Scroll Loading Indicator */}
            <div ref={loadMoreRef} className="mt-8 flex justify-center items-center min-h-24">
              {isFetchingNextPage && (
                <div className="flex flex-col items-center gap-stack">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-3 h-3 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-3 h-3 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <p className="text-sm text-gray-500 font-medium">{t("bookCatalogue.loadingMoreBooks")}</p>
                </div>
              )}
              {!hasNextPage && !isFetching && displayedCourses.length > PAGE_SIZE && (
                <div className="text-center py-8">
                  <p className="text-gray-500 font-medium">{t("bookCatalogue.endOfCatalogue")}</p>
                  <p className="text-sm text-catalogue-text-muted mt-1">{t("bookCatalogue.showingAllBooks", { total: totalBooks })}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
