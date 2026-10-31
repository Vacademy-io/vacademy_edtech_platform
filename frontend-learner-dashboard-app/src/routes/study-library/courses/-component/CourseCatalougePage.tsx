import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn, toTitleCase, compareByNameNatural } from "@/lib/utils";
import CoursesPage from "./CoursesPage.tsx";
import CatalogueFilterWizard, {
  type CatalogueFilterWizardOption,
  type CatalogueFilterWizardSelection,
  type CatalogueFilterWizardStep,
} from "./CatalogueFilterWizard.tsx";
import { useCatalogStore } from "../-store/catalogStore.ts";
import { handleFetchInstituteDetails } from "../-services/institute-details.ts";
import axios from "axios";
import {
  STUDENT_DETAIL,
  urlCourseDetails,
  urlInstructor,
  urlPublicCourseDetails,
} from "@/constants/urls.ts";
import { getInstituteId } from "@/constants/helper.ts";
import { getUserId } from "@/constants/getUserId.ts";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance.ts";
import { toast } from "sonner";
import HeroSection from "../-component1/HeroSection.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  IconBooks,
  IconBroadcast,
  IconBuildingStore,
  IconChartBar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconGift,
  IconListCheck,
  IconTag,
} from "@tabler/icons-react";
import { CoursePackageResponse } from "@/types/course-catalog/course-catalog-list.ts";
import { ContentTerms, SystemTerms } from "@/types/naming-settings.ts";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils.ts";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Preferences } from "@capacitor/preferences";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import type {
  StudentAllCoursesCustomTab,
  StudentAllCoursesTabId,
} from "@/types/student-display-settings";
import { LoadingState } from "@/components/design-system/states";
import { CustomTabProductPages } from "./CustomTabProductPages";

// Only the "Live sessions" custom tab needs the live-class list; keep it out
// of the Courses page chunk until then.
const LiveClassView = lazy(() =>
  import("@/routes/study-library/live-class/index").then((m) => ({ default: m.LiveClassView }))
);

/** Whether the learner app can show a custom tab (the admin screen flags the rest). */
const isCustomTabUsable = (t: StudentAllCoursesCustomTab): boolean => {
  if (t.visible === false || !(t.label ?? "").trim()) return false;
  switch (t.type ?? "TAG") {
    case "TAG":
      return Array.isArray(t.tags) && t.tags.length > 0;
    case "COURSES":
      return (t.courseIds ?? []).length > 0;
    case "PRODUCT_PAGES":
      return (t.productPages ?? []).length > 0;
    case "FREE_COURSES":
    case "LIVE_SESSIONS":
      return true;
    default:
      return false;
  }
};

const CUSTOM_TAB_ICONS = {
  TAG: IconTag,
  COURSES: IconListCheck,
  FREE_COURSES: IconGift,
  LIVE_SESSIONS: IconBroadcast,
  PRODUCT_PAGES: IconBuildingStore,
} as const;

/** Most courses the catalogue V2 search returns in one call (and accepts as ids). */
const CATALOGUE_SUBSET_LIMIT = 500;
import { useDripConditionStore } from "@/stores/study-library/drip-conditions-store";
import { parseDripConditions } from "@/services/getIsDrippingEnable";
import { getChatbotSettings } from "@/services/chatbot-settings.ts";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";

/** Merge unique instructors from course list into existing list (by id). Ensures instructors attached to courses appear in the filter. */
function mergeInstructorsFromCourses(
  current: { id: string; full_name?: string; username?: string }[],
  courses: { instructors?: { id: string; full_name?: string; username?: string }[] }[]
): { id: string; full_name?: string; username?: string }[] {
  const byId = new Map(current.map((i) => [i.id, i]));
  for (const course of courses) {
    for (const inst of course.instructors || []) {
      if (inst?.id && typeof inst.id === "string" && !byId.has(inst.id)) {
        byId.set(inst.id, {
          id: inst.id,
          full_name: inst.full_name ?? inst.username,
          username: inst.username,
        });
      }
    }
  }
  return Array.from(byId.values());
}

const CourseCatalougePage: React.FC = () => {
  const { t } = useTranslation("study");
  const [allowLeanersToCreateCourses, setAllowLeanersToCreateCourses] =
    useState<boolean>(false);

  // Use selectors to prevent re-renders when store state changes
  const setInstituteData = useCatalogStore((state) => state.setInstituteData);
  const instituteData = useCatalogStore((state) => state.instituteData);
  const setInstructors = useCatalogStore((state) => state.setInstructors);

  const setDripCondition = useDripConditionStore(
    (state) => state.setDripCondition
  );
  const clearDripCondition = useDripConditionStore(
    (state) => state.clearDripCondition
  );
  const setIsDrippingEnable = useDripConditionStore(
    (state) => state.setIsDrippingEnable
  );

  const [selectedTab, setSelectedTab] = useState<string>("PROGRESS");
  // Admin-defined tag tabs (Display Settings → All Courses). Each is the ALL
  // catalogue narrowed to its tags; keyed by `custom:<id>` tab value.
  const [customTabs, setCustomTabs] = useState<
    Record<string, StudentAllCoursesCustomTab>
  >({});
  // Read by fetchCoursesForTab so loading the tabs doesn't re-create it
  // (and refetch the active tab).
  const customTabsRef = useRef<Record<string, StudentAllCoursesCustomTab>>({});
  const [customCourses, setCustomCourses] = useState<
    Record<string, CoursePackageResponse>
  >({});
  const [visibleTabs, setVisibleTabs] = useState<
    { value: string; label?: string }[]
  >(() => {
    // Labels intentionally omitted — the render falls back to translated
    // defaults so they stay in sync with the active language.
    const base: { value: "ALL" | "PROGRESS" | "COMPLETED"; label?: string }[] = [
      { value: "PROGRESS" },
      { value: "COMPLETED" },
      { value: "ALL" },
    ];
    // Reader mode: drop the "All Courses" (browse/marketplace) tab — only the
    // learner's own In-Progress / Completed courses remain (Apple 3.1.1).
    return shouldHidePaidPurchaseUI()
      ? base.filter((t) => t.value !== "ALL")
      : base;
  });
  // More than three tabs scroll sideways on phones; these arrows show there
  // is more to see and step through it (they hide at either end).
  const tabsListRef = useRef<HTMLDivElement>(null);
  const [tabScroll, setTabScroll] = useState({ start: false, end: false });
  const updateTabScroll = useCallback(() => {
    const el = tabsListRef.current;
    if (!el) return;
    const pos = Math.abs(el.scrollLeft); // negative in RTL
    const max = el.scrollWidth - el.clientWidth;
    setTabScroll((prev) => {
      const next = { start: pos > 4, end: max - pos > 4 };
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
  }, []);
  const scrollTabs = (towardsEnd: boolean) => {
    const el = tabsListRef.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    const step = el.clientWidth * 0.7 * (towardsEnd ? 1 : -1) * (rtl ? -1 : 1);
    el.scrollBy({ left: step, behavior: "smooth" });
  };

  const [allCourses, setAllCourses] = useState<CoursePackageResponse>({
    content: [],
    empty: false,
    first: false,
    last: false,
    number: 0,
    numberOfElements: 0,
    pageable: {
      pageNumber: 0,
      pageSize: 10,
      offset: 0,
      paged: true,
      unpaged: false,
      sort: {
        unsorted: true,
        sorted: false,
        empty: true,
      },
    },
    size: 10,
    sort: {
      unsorted: true,
      sorted: false,
      empty: true,
    },
    totalElements: 0,
    totalPages: 0,
  });
  const [progressCourses, setProgressCourses] = useState<CoursePackageResponse>(
    {
      ...allCourses,
    }
  );
  const [completedCourses, setCompletedCourses] =
    useState<CoursePackageResponse>({
      ...allCourses,
    });
  const [isLoadingByTab, setIsLoadingByTab] = useState<
    Record<string, boolean>
  >({
    ALL: false,
    PROGRESS: false,
    COMPLETED: false,
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState("Newest");

  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedInstructors, setSelectedInstructors] = useState<string[]>([]);

  // Admin-configured step-by-step filter wizard (Course Settings → Catalogue
  // & Publishing → Course Filter Wizard). null when disabled or unconfigured.
  const [filterWizardConfig, setFilterWizardConfig] = useState<{
    steps: CatalogueFilterWizardStep[];
    mandatory: boolean;
  } | null>(null);
  const [showFilterWizard, setShowFilterWizard] = useState(false);

  // Same query FilterPanel uses for its Level/Session/Tag options — shares
  // react-query's cache (queryKey ["FETCH_INSTITUTE_DETAILS"]) so this does
  // not trigger a second network request.
  const { data: publicInstituteDetails } = useQuery(handleFetchInstituteDetails());

  type WizardLevelItem = { id: string; level_name?: string };
  type WizardSessionItem = { id: string; session_name?: string };

  const wizardLevels = useMemo<CatalogueFilterWizardOption[]>(
    () =>
      ((publicInstituteDetails?.levels || []) as WizardLevelItem[])
        .map((level) => ({
          id: level.id,
          name: toTitleCase(level.level_name || getTerminology(ContentTerms.Level, SystemTerms.Level)),
        }))
        .sort(compareByNameNatural),
    [publicInstituteDetails?.levels]
  );

  const wizardSessions = useMemo<CatalogueFilterWizardOption[]>(
    () =>
      ((publicInstituteDetails?.sessions || []) as WizardSessionItem[])
        .map((session) => ({
          id: session.id,
          name: toTitleCase(
            session.session_name || getTerminology(ContentTerms.Session, SystemTerms.Session)
          ),
        }))
        .sort(compareByNameNatural),
    [publicInstituteDetails?.sessions]
  );

  const wizardTags = useMemo<CatalogueFilterWizardOption[]>(() => {
    const uniqueMap = new Map<string, string>();
    ((publicInstituteDetails?.tags || []) as string[]).forEach((tag) => {
      const normalized = tag.toLowerCase();
      if (!uniqueMap.has(normalized)) uniqueMap.set(normalized, toTitleCase(tag));
    });
    return Array.from(uniqueMap.entries()).map(([id, name]) => ({ id, name }));
  }, [publicInstituteDetails?.tags]);

  // Debounced search term to avoid multiple API calls during typing
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchTerm), 400);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  // Track pagination per tab
  const [pageByTab, setPageByTab] = useState<Record<string, number>>({
    ALL: 0,
    PROGRESS: 0,
    COMPLETED: 0,
  });
  // Student Display Settings → allCourses.pageSize (default 10; 1–100).
  const [pageSize, setPageSize] = useState(10);

  // Version key to trigger fetch only when filters are explicitly applied
  const [filtersVersion, setFiltersVersion] = useState(0);

  const getSortPayload = (sort: string) => {
    switch (sort) {
      case "Newest":
        return { createdAt: "DESC" };
      case "Oldest":
        return { createdAt: "ASC" };
      case "HighestRated":
        return { rating: "DESC" };
      case "Shortest":
        return { readTimeInMinutes: "ASC" };
      default:
        return { createdAt: "DESC" };
    }
  };

  /** Learner-packages API may expect snake_case in sort_columns; use this for the main request. */
  const getSortPayloadSnake = (sort: string) => {
    switch (sort) {
      case "Oldest":
        return { created_at: "ASC" };
      case "HighestRated":
        return { rating: "DESC" };
      case "Shortest":
        return { read_time_in_minutes: "ASC" };
      default:
        return { created_at: "DESC" };
    }
  };

  const abortControllerRef = useRef<AbortController | null>(null);

  // COURSES / FREE_COURSES tabs: the learner search carries no price and
  // ignores package ids, so these read the catalogue V2 search (price + id
  // filter) once per tab/sort and page/search the result here.
  const subsetCacheRef = useRef<Record<string, { key: string; list: CoursePackageResponse["content"] }>>({});
  const fetchCatalogueSubset = useCallback(
    async (tabValue: string, tab: StudentAllCoursesCustomTab) => {
      const ids = (tab.courseIds ?? []).slice(0, CATALOGUE_SUBSET_LIMIT);
      const cacheKey = JSON.stringify([tab.type, ids, sortOption]);
      setIsLoadingByTab((prev) => ({ ...prev, [tabValue]: true }));
      try {
        let list = subsetCacheRef.current[tabValue]?.key === cacheKey
          ? subsetCacheRef.current[tabValue]!.list
          : null;
        if (!list) {
          const instituteId = await getInstituteId();
          const response = await authenticatedAxiosInstance.post(
            urlCourseDetails,
            {
              status: [] as string[],
              level_ids: [],
              session_ids: [],
              faculty_ids: [],
              created_by_user_id: null,
              search_by_name: "",
              tag: [],
              ...(tab.type === "COURSES" ? { package_ids: ids } : {}),
              min_percentage_completed: 0,
              max_percentage_completed: 0,
              type: "ALL",
              sort_columns: getSortPayload(sortOption),
            },
            { params: { instituteId, page: 0, size: CATALOGUE_SUBSET_LIMIT } }
          );
          const all = ((response.data as CoursePackageResponse)?.content ?? []) as Array<
            CoursePackageResponse["content"][number] & { min_plan_actual_price?: number | null }
          >;
          // Same rule as the public catalogue's "Free" label: no price = free.
          list = tab.type === "FREE_COURSES"
            ? all.filter((c) => Number(c.min_plan_actual_price ?? 0) === 0)
            : all;
          subsetCacheRef.current[tabValue] = { key: cacheKey, list };
          list.forEach((course) => {
            if (!course.id) return;
            clearDripCondition(course.id);
            if (course.drip_condition_json) setDripCondition(course.id, course.drip_condition_json);
          });
        }
        const q = debouncedSearch.trim().toLowerCase();
        const filtered = q ? list.filter((c) => (c.package_name || "").toLowerCase().includes(q)) : list;
        const totalPages = Math.ceil(filtered.length / pageSize);
        const page = Math.min(pageByTab[tabValue] ?? 0, Math.max(totalPages - 1, 0));
        const content = filtered.slice(page * pageSize, page * pageSize + pageSize);
        setCustomCourses((prev) => ({
          ...prev,
          [tabValue]: {
            ...allCourses,
            content,
            number: page,
            size: pageSize,
            numberOfElements: content.length,
            totalElements: filtered.length,
            totalPages,
            first: page === 0,
            last: page >= totalPages - 1,
            empty: content.length === 0,
          },
        }));
      } catch (err) {
        if (import.meta.env.DEV) console.error("[Catalog] custom tab fetch failed", err);
        toast.error(
          i18n.t("study:catalog.toast.loadTabError", {
            courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase(),
          })
        );
      } finally {
        setIsLoadingByTab((prev) => ({ ...prev, [tabValue]: false }));
      }
    },
    // allCourses is only a shape template for the page envelope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortOption, debouncedSearch, pageByTab, pageSize, setDripCondition, clearDripCondition]
  );

  const fetchCoursesForTab = useCallback(
    async (tabType: string) => {
      const customTab = customTabsRef.current[tabType];
      // Built-in tab values are the API types; a custom tab browses ALL.
      if (!customTab && tabType !== "ALL" && tabType !== "PROGRESS" && tabType !== "COMPLETED") {
        return;
      }
      const customType = customTab?.type ?? "TAG";
      // These render their own content and fetch nothing here.
      if (customTab && (customType === "LIVE_SESSIONS" || customType === "PRODUCT_PAGES")) return;
      if (customTab && (customType === "COURSES" || customType === "FREE_COURSES")) {
        await fetchCatalogueSubset(tabType, customTab);
        return;
      }
      const apiType = customTab ? "ALL" : (tabType as "ALL" | "PROGRESS" | "COMPLETED");
      // The search endpoints drop the tag filter whenever search_by_name is
      // set, so a searched custom tab fetches one wide page and narrows it here.
      const narrowCustomClientSide = !!customTab && !!debouncedSearch;
      const requestPage = narrowCustomClientSide ? 0 : pageByTab[tabType] ?? 0;
      const requestSize = narrowCustomClientSide ? 200 : pageSize;
      const expandTags = (tags: string[]) => {
        const allTags = useCatalogStore.getState().instituteData?.tags || [];
        if (!allTags.length) return tags;
        const expanded = tags.flatMap((t) =>
          allTags.filter((at) => at.toLowerCase() === t.toLowerCase())
        );
        return expanded.length > 0 ? Array.from(new Set(expanded)) : tags;
      };
      const requestTags = expandTags(customTab ? customTab.tags : selectedTags ?? []);
      const applyCourses = (data: CoursePackageResponse) => {
        if (!customTab) {
          if (tabType === "ALL") setAllCourses(data);
          if (tabType === "PROGRESS") setProgressCourses(data);
          if (tabType === "COMPLETED") setCompletedCourses(data);
          return;
        }
        if (!narrowCustomClientSide) {
          setCustomCourses((prev) => ({ ...prev, [tabType]: data }));
          return;
        }
        const wanted = new Set(customTab.tags.map((t) => t.trim().toLowerCase()));
        const content = (data.content ?? []).filter((course) =>
          (course.comma_separeted_tags || "")
            .split(",")
            .some((t) => wanted.has(t.trim().toLowerCase()))
        );
        setCustomCourses((prev) => ({
          ...prev,
          [tabType]: {
            ...data,
            content,
            number: 0,
            numberOfElements: content.length,
            totalElements: content.length,
            totalPages: content.length > 0 ? 1 : 0,
            first: true,
            last: true,
            empty: content.length === 0,
          },
        }));
      };
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (import.meta.env.DEV) {
        console.debug("[Catalog] fetch start", {
          tabType,
          page: requestPage,
          sort: sortOption,
          search: debouncedSearch,
          levels: selectedLevels,
          sessions: selectedSessions,
          instructors: selectedInstructors,
          tags: selectedTags,
        });
      }
      setIsLoadingByTab((prev) => ({ ...prev, [tabType]: true }));
      try {
        const instituteId = await getInstituteId();
        // A custom tab is defined by its tags alone; the ALL tab's sidebar
        // filters are not shown there, so they must not leak into it.
        const body = {
          status: [] as string[],
          level_ids: customTab ? [] : selectedLevels ?? [],
          session_ids: customTab ? [] : selectedSessions ?? [],
          faculty_ids: customTab ? [] : selectedInstructors ?? [],
          search_by_name: debouncedSearch ?? "",
          tag: requestTags,
          min_percentage_completed: 0,
          max_percentage_completed: 0,
          type: apiType,
          sort_columns: getSortPayloadSnake(sortOption),
        };
        const response = await authenticatedAxiosInstance.post(
          urlPublicCourseDetails,
          body,
          {
            params: {
              instituteId,
              page: requestPage,
              size: requestSize,
            },
            headers: {
              accept: "*/*",
              "Content-Type": "application/json",
            },
            signal: controller.signal,
          }
        );

        if (controller.signal.aborted) return;

        const rawData = response.data as CoursePackageResponse;
        const data: CoursePackageResponse = {
          ...rawData,
          content: rawData.content ?? [],
        };
        applyCourses(data);

        if (data.content?.length) {
          const current = useCatalogStore.getState().instructor;
          const merged = mergeInstructorsFromCourses(current, data.content);
          setInstructors(merged);
        }

        if (data.content && Array.isArray(data.content)) {
          data.content.forEach((course) => {
            if (course.id && course.drip_condition_json) {
              clearDripCondition(course.id);
              setDripCondition(course.id, course.drip_condition_json);
            } else if (course.id && !course.drip_condition_json) {
              clearDripCondition(course.id);
            }
          });
        }
      } catch (err) {
        if (controller.signal.aborted || axios.isCancel(err)) return;

        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const message = axios.isAxiosError(err) ? err.response?.data : err;

        if (import.meta.env.DEV) {
          console.error("[Catalog] learner-packages search failed", { status, message, tabType });
        }
        if (status === 500) {
          toast.error(
            i18n.t("study:catalog.toast.loadError", {
              courses: getTerminologyPlural(
                ContentTerms.Course,
                SystemTerms.Course
              ).toLocaleLowerCase(),
            })
          );
        }

        // For non-ALL tabs there is no fallback, so a non-500 error
        // (e.g. backend's custom 511) would otherwise fail silently and the
        // user is left staring at an empty tab. Surface it.
        if (apiType !== "ALL" && status !== 500) {
          toast.error(
            i18n.t("study:catalog.toast.loadTabError", {
              courses: getTerminologyPlural(
                ContentTerms.Course,
                SystemTerms.Course
              ).toLocaleLowerCase(),
            })
          );
        }

        if (apiType === "ALL" && status !== 500) {
          let fallbackSucceeded = false;
          try {
            const instituteId = await getInstituteId();
            const body = {
              status: [] as string[],
              level_ids: customTab ? [] : selectedLevels ?? [],
              session_ids: customTab ? [] : selectedSessions ?? [],
              faculty_ids: customTab ? [] : selectedInstructors ?? [],
              created_by_user_id: null as string | null,
              search_by_name: debouncedSearch ?? "",
              tag: requestTags,
              min_percentage_completed: 0,
              max_percentage_completed: 0,
              type: "ALL" as const,
              sort_columns: getSortPayload(sortOption),
            };
            const response = await authenticatedAxiosInstance.post(
              urlCourseDetails,
              body,
              {
                params: {
                  instituteId,
                  page: requestPage,
                  size: requestSize,
                },
                headers: {
                  accept: "*/*",
                  "Content-Type": "application/json",
                },
                signal: controller.signal,
              }
            );
            if (controller.signal.aborted) return;
            const fallbackData = response.data as CoursePackageResponse;
            applyCourses({ ...fallbackData, content: fallbackData.content ?? [] });
            if (fallbackData.content?.length) {
              const current = useCatalogStore.getState().instructor;
              const merged = mergeInstructorsFromCourses(current, fallbackData.content);
              setInstructors(merged);
            }
            if (fallbackData.content && Array.isArray(fallbackData.content)) {
              fallbackData.content.forEach((course) => {
                if (course.id && course.drip_condition_json) {
                  clearDripCondition(course.id);
                  setDripCondition(course.id, course.drip_condition_json);
                } else if (course.id && !course.drip_condition_json) {
                  clearDripCondition(course.id);
                }
              });
            }
            fallbackSucceeded = true;
          } catch {
            // swallow fallback errors — toast below
          }

          if (!fallbackSucceeded && !controller.signal.aborted) {
            toast.error(
              i18n.t("study:catalog.toast.loadFallbackError", {
                courses: getTerminologyPlural(
                  ContentTerms.Course,
                  SystemTerms.Course
                ).toLocaleLowerCase(),
              })
            );
          }
        }
      } finally {
        setIsLoadingByTab((prev) => ({ ...prev, [tabType]: false }));
      }
    },
    [
      selectedLevels,
      selectedSessions,
      selectedInstructors,
      debouncedSearch,
      selectedTags,
      pageByTab,
      pageSize,
      sortOption,
      fetchCatalogueSubset,
      setDripCondition,
      clearDripCondition,
      setInstructors,
    ]
  );

  const handleApplyFilters = async () => {
    // reset pages and trigger a fetch via filtersVersion change
    setPageByTab({ ALL: 0, PROGRESS: 0, COMPLETED: 0 });
    setFiltersVersion((v) => v + 1);
  };

  const clearAllFilters = async () => {
    setSelectedLevels([]);
    setSelectedSessions([]);
    setSelectedTags([]);
    setSelectedInstructors([]);
    setSearchTerm("");
    setSortOption("Newest");
    setPageByTab({ ALL: 0, PROGRESS: 0, COMPLETED: 0 });
    setFiltersVersion((v) => v + 1);
  };

  const getFilterWizardCompletionKey = async () => {
    const instituteId = await getInstituteId();
    const userId = await getUserId();
    return `catalogue_filter_wizard_completed_${instituteId}_${userId}`;
  };

  const markFilterWizardDone = async () => {
    const key = await getFilterWizardCompletionKey();
    await Preferences.set({ key, value: "true" });
  };

  const handleFilterWizardComplete = async (selection: CatalogueFilterWizardSelection) => {
    setSelectedLevels(selection.levels);
    setSelectedSessions(selection.sessions);
    setSelectedTags(selection.tags);
    setShowFilterWizard(false);
    await markFilterWizardDone();
    await handleApplyFilters();
  };

  const handleFilterWizardSkip = async () => {
    setShowFilterWizard(false);
    await markFilterWizardDone();
  };

  // Show the wizard once — the first time it's ready and hasn't been
  // completed/skipped before by this learner at this institute.
  useEffect(() => {
    if (!filterWizardConfig || !publicInstituteDetails) return;
    let cancelled = false;
    (async () => {
      const key = await getFilterWizardCompletionKey();
      const { value } = await Preferences.get({ key });
      if (!cancelled && value !== "true") {
        setShowFilterWizard(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterWizardConfig, publicInstituteDetails]);

  // Single consolidated fetch: run when selected tab changes, or
  // when debounced search, sort, applied filters, or pagination for the active tab changes
  const currentPageForActiveTab = pageByTab[selectedTab] ?? 0;
  useEffect(() => {
    fetchCoursesForTab(selectedTab);
  }, [
    selectedTab,
    debouncedSearch,
    sortOption,
    filtersVersion,
    currentPageForActiveTab,
    fetchCoursesForTab,
  ]);

  // Reset current tab page to 0 when search or sort changes
  useEffect(() => {
    setPageByTab((prev) => ({ ...prev, [selectedTab]: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, sortOption]);

  // Pagination handlers per tab (MyPagination is zero-based)
  const handlePageChangeAll = (page: number) => {
    if (import.meta.env.DEV) {
      console.debug("[Catalog] change page ALL", { page });
    }
    setPageByTab((prev) => ({ ...prev, ALL: Math.max(0, page) }));
  };
  const handlePageChangeProgress = (page: number) => {
    if (import.meta.env.DEV) {
      console.debug("[Catalog] change page PROGRESS", { page });
    }
    setPageByTab((prev) => ({ ...prev, PROGRESS: Math.max(0, page) }));
  };
  const handlePageChangeCompleted = (page: number) => {
    if (import.meta.env.DEV) {
      console.debug("[Catalog] change page COMPLETED", { page });
    }
    setPageByTab((prev) => ({ ...prev, COMPLETED: Math.max(0, page) }));
  };
  const handlePageChangeCustom = (tabValue: string) => (page: number) => {
    setPageByTab((prev) => ({ ...prev, [tabValue]: Math.max(0, page) }));
  };

  useEffect(() => {
    const el = tabsListRef.current;
    if (!el) return;
    updateTabScroll();
    el.addEventListener("scroll", updateTabScroll, { passive: true });
    const observer = new ResizeObserver(updateTabScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", updateTabScroll);
      observer.disconnect();
    };
  }, [updateTabScroll, visibleTabs.length]);

  // Keep the selected tab in view inside the sideways-scrolling bar.
  useEffect(() => {
    const el = tabsListRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    el.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [selectedTab, visibleTabs.length]);

  // Enforce Student Display Settings: visible/order tabs and default tab
  useEffect(() => {
    const mapSettingIdToValue = (
      id: StudentAllCoursesTabId
    ): "ALL" | "PROGRESS" | "COMPLETED" => {
      switch (id) {
        case "AllCourses":
          return "ALL";
        case "InProgress":
          return "PROGRESS";
        case "Completed":
          return "COMPLETED";
        default:
          return "PROGRESS";
      }
    };

    getStudentDisplaySettings(false).then((settings) => {
      const size = Number(settings?.allCourses?.pageSize);
      if (Number.isInteger(size) && size >= 1 && size <= 100) setPageSize(size);
      const tabs = settings?.allCourses?.tabs || [];
      // A custom tab without a label or tags would be blank or list the
      // whole catalogue; the admin screen flags those as incomplete.
      const usableCustomTabs = (settings?.allCourses?.customTabs || []).filter(isCustomTabUsable);
      const customTabsByValue = Object.fromEntries(
        usableCustomTabs.map((t) => [`custom:${t.id}`, t])
      );
      customTabsRef.current = customTabsByValue;
      setCustomTabs(customTabsByValue);
      const orderedRaw = [
        ...tabs
          .filter((t) => t.visible !== false)
          .map((t) => ({
            order: t.order || 0,
            value: mapSettingIdToValue(t.id) as string,
            label: t.label,
          })),
        // Custom tabs browse the catalogue, so reader mode hides them like ALL
        // (a live-sessions tab too: paid webinars open the payment flow).
        ...(shouldHidePaidPurchaseUI() ? [] : usableCustomTabs).map((t) => ({
          order: t.order || 0,
          value: `custom:${t.id}`,
          label: (t.label ?? "").trim(),
        })),
      ]
        .sort((a, b) => a.order - b.order)
        .map(({ value, label }) => ({ value, label }));
      // Reader mode: never surface the "All Courses" (browse) tab, regardless
      // of admin display settings (Apple 3.1.1).
      const ordered = shouldHidePaidPurchaseUI()
        ? orderedRaw.filter((t) => t.value !== "ALL")
        : orderedRaw;
      if (ordered.length) setVisibleTabs(ordered);

      // Determine default tab from settings; ensure it's visible (and never ALL
      // in reader mode, which is excluded from `ordered` above).
      const defaultVal = mapSettingIdToValue(
        settings?.allCourses?.defaultTab || "InProgress"
      );
      const isDefaultVisible = ordered.some((t) => t.value === defaultVal);
      const firstVisible = ordered[0]?.value || "PROGRESS";
      const toSet = isDefaultVisible ? defaultVal : firstVisible;
      setSelectedTab(toSet);
    });
  }, []);

  // ✅ Fetch institute details
  useEffect(() => {
    const fetchInstituteDetails = async () => {
      try {
        const userId = await getUserId();
        const instituteId = await getInstituteId();
        const response = await authenticatedAxiosInstance.get(STUDENT_DETAIL, {
          params: { instituteId, userId },
        });
        setInstituteData(response.data);
        await getChatbotSettings();
      } catch {
        // Error handling
      }
    };

    fetchInstituteDetails();
  }, [setInstituteData]);

  // ✅ Fetch instructor
  useEffect(() => {
    const fetchInstructor = async () => {
      try {
        const instituteId = await getInstituteId();
        const response = await axios.get(`${urlInstructor}/${instituteId}`, {
          params: {
            instituteId,
          },
          headers: {
            accept: "*/*",
          },
        });
        setInstructors(response.data);
      } catch (error) {
        console.error(error);
      }
    };
    fetchInstructor();
  }, [setInstructors]);

  // Remove extra initial multi-tab fetching; rely on consolidated effect above

  useEffect(() => {
    const fetchInstituteDetails = async () => {
      const InstituteDetails = await Preferences.get({
        key: "InstituteDetails",
      });
      const rawInstituteDetails = InstituteDetails?.value;
      // Storage may hold an empty value or the literal string "undefined" for
      // institutes whose setup is incomplete; bail out instead of throwing.
      if (
        !rawInstituteDetails ||
        rawInstituteDetails === "undefined" ||
        rawInstituteDetails === "null"
      ) {
        return;
      }

      let parsedInstituteDetails: { institute_settings_json?: string };
      try {
        parsedInstituteDetails = JSON.parse(rawInstituteDetails);
      } catch (err) {
        console.warn("[Catalog] InstituteDetails JSON parse failed", err);
        return;
      }

      const rawSettingsJson = parsedInstituteDetails.institute_settings_json;
      if (
        rawSettingsJson &&
        rawSettingsJson !== "undefined" &&
        rawSettingsJson !== "null"
      ) {
        try {
          const settingsJsonData = JSON.parse(rawSettingsJson);
          setAllowLeanersToCreateCourses(
            settingsJsonData?.setting?.COURSE_SETTING?.data?.permissions
              ?.allowLearnersToCreateCourses
          );

          const filterWizard =
            settingsJsonData?.setting?.COURSE_SETTING?.data?.catalogueSettings
              ?.filterWizard;
          const wizardSteps: CatalogueFilterWizardStep[] = Array.isArray(
            filterWizard?.steps
          )
            ? filterWizard.steps.filter(
                (step: string): step is CatalogueFilterWizardStep =>
                  step === "level" || step === "session" || step === "tag"
              )
            : [];
          setFilterWizardConfig(
            filterWizard?.enabled && wizardSteps.length > 0
              ? { steps: wizardSteps, mandatory: Boolean(filterWizard.mandatory) }
              : null
          );
        } catch (err) {
          console.warn(
            "[Catalog] institute_settings_json JSON parse failed",
            err
          );
        }

        try {
          const { isDrippingEnable } = parseDripConditions(rawSettingsJson);
          setIsDrippingEnable(isDrippingEnable);
        } catch (err) {
          console.warn("[Catalog] parseDripConditions failed", err);
        }
      }
    };

    fetchInstituteDetails();
  }, [setIsDrippingEnable]);

  return (
    <div className="min-h-screen">
      <CatalogueFilterWizard
        open={showFilterWizard}
        steps={filterWizardConfig?.steps ?? []}
        mandatory={filterWizardConfig?.mandatory ?? false}
        levels={wizardLevels}
        sessions={wizardSessions}
        tags={wizardTags}
        onComplete={handleFilterWizardComplete}
        onSkip={handleFilterWizardSkip}
      />

      {/* Hero Section */}
      <HeroSection allowLeanersToCreateCourses={allowLeanersToCreateCourses} />

      {/* Main Content Container */}
      <div className="mx-auto">
        <Tabs
          value={selectedTab}
          onValueChange={setSelectedTab}
          className="w-full"
        >
          {/* Tab Navigation */}
          <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-md mb-3">
            <div className="relative p-2 sm:p-3">
              <TabsList
                ref={tabsListRef}
                className={cn(
                  "bg-muted/50 dark:bg-neutral-900 justify-start p-1 w-full gap-1 sm:w-auto sm:flex sm:flex-row rounded-full [.ui-play_&]:!bg-white [.ui-play_&]:border-2 [.ui-play_&]:border-primary-200 [.ui-play_&]:rounded-2xl [.ui-play_&]:p-1.5 [.ui-play_&]:gap-1.5 [.ui-play_&]:shadow-play-3-primary",
                  // More than three tabs don't fit a 3-column grid: phones scroll
                  // them sideways (arrows below), wider screens wrap them inside
                  // the bar so none overflows onto the content.
                  visibleTabs.length > 3
                    ? "flex flex-nowrap overflow-x-auto no-scrollbar sm:flex-wrap sm:overflow-visible sm:h-auto sm:rounded-2xl"
                    : "grid grid-cols-3"
                )}
              >
                {visibleTabs.map((tab) => {
                  const count =
                    tab.value === "ALL"
                      ? allCourses.totalElements
                      : tab.value === "PROGRESS"
                        ? progressCourses.totalElements
                        : tab.value === "COMPLETED"
                          ? completedCourses.totalElements
                          : customCourses[tab.value]?.totalElements ?? 0;
                  return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className={cn(
                      visibleTabs.length > 3 && "shrink-0 flex-none",
                      "flex-1 sm:flex-none px-2.5 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 data-[state=active]:bg-primary-100 data-[state=active]:text-primary-700 data-[state=active]:font-semibold data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary-900/40 dark:data-[state=active]:text-primary-200",
                      // Vibrant Styles - Flat Pastel
                      tab.value === "COMPLETED" &&
                      "[.ui-vibrant_&]:data-[state=active]:bg-emerald-100/50 [.ui-vibrant_&]:data-[state=active]:text-emerald-700 dark:[.ui-vibrant_&]:data-[state=active]:bg-emerald-900/30 dark:[.ui-vibrant_&]:data-[state=active]:text-emerald-300",
                      tab.value === "PROGRESS" &&
                      "[.ui-vibrant_&]:data-[state=active]:bg-indigo-100/50 [.ui-vibrant_&]:data-[state=active]:text-indigo-700 dark:[.ui-vibrant_&]:data-[state=active]:bg-indigo-900/30 dark:[.ui-vibrant_&]:data-[state=active]:text-indigo-300",
                      tab.value !== "COMPLETED" &&
                      tab.value !== "PROGRESS" &&
                      "[.ui-vibrant_&]:data-[state=active]:bg-slate-100/50 [.ui-vibrant_&]:data-[state=active]:text-slate-700 dark:[.ui-vibrant_&]:data-[state=active]:bg-slate-800/50 dark:[.ui-vibrant_&]:data-[state=active]:text-slate-300",
                      // Play Styles — solid, bold, Duolingo-style
                      "[.ui-play_&]:rounded-full [.ui-play_&]:font-bold [.ui-play_&]:uppercase [.ui-play_&]:tracking-wide [.ui-play_&]:text-xs",
                      tab.value === "COMPLETED" &&
                      "[.ui-play_&]:data-[state=active]:!bg-play-success-soft [.ui-play_&]:data-[state=active]:!text-play-success-soft-ink [.ui-play_&]:data-[state=active]:!shadow-none",
                      tab.value === "PROGRESS" &&
                      "[.ui-play_&]:data-[state=active]:!bg-play-info-soft [.ui-play_&]:data-[state=active]:!text-play-info-soft-ink [.ui-play_&]:data-[state=active]:!shadow-none",
                      tab.value !== "COMPLETED" &&
                      tab.value !== "PROGRESS" &&
                      "[.ui-play_&]:data-[state=active]:!bg-play-accent-soft [.ui-play_&]:data-[state=active]:!text-play-accent-soft-ink [.ui-play_&]:data-[state=active]:!shadow-none"
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-flex shrink-0">
                        {tab.value === "ALL" && <IconBooks size={14} />}
                        {tab.value === "PROGRESS" && <IconChartBar size={14} />}
                        {tab.value === "COMPLETED" && <IconCheck size={14} />}
                        {customTabs[tab.value] &&
                          React.createElement(CUSTOM_TAB_ICONS[customTabs[tab.value]!.type ?? "TAG"] ?? IconTag, { size: 14 })}
                      </span>
                      <span className="truncate">
                        {tab.label ||
                          (tab.value === "ALL"
                            ? t("catalog.tab.all", {
                                courses: getTerminologyPlural(
                                  ContentTerms.Course,
                                  SystemTerms.Course
                                ),
                              })
                            : tab.value === "PROGRESS"
                              ? t("catalog.tab.inProgress")
                              : t("catalog.tab.completed"))}
                      </span>
                      {count > 0 && (
                        <span className="ms-0.5 hidden sm:inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-neutral-200/80 text-caption font-semibold text-neutral-700 data-[state=active]:bg-primary-200 dark:bg-neutral-700 dark:text-neutral-200">
                          {count}
                        </span>
                      )}
                    </span>
                  </TabsTrigger>
                  );
                })}
              </TabsList>
              {visibleTabs.length > 3 && tabScroll.start && (
                <button
                  type="button"
                  aria-label={t("catalog.tab.scrollStart")}
                  onClick={() => scrollTabs(false)}
                  className="absolute start-1 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md sm:hidden"
                >
                  <IconChevronLeft size={16} className="rtl:rotate-180" />
                </button>
              )}
              {visibleTabs.length > 3 && tabScroll.end && (
                <button
                  type="button"
                  aria-label={t("catalog.tab.scrollEnd")}
                  onClick={() => scrollTabs(true)}
                  className="absolute end-1 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md sm:hidden"
                >
                  <IconChevronRight size={16} className="rtl:rotate-180" />
                </button>
              )}
            </div>
          </div>

          {/* Tab Content */}
          {visibleTabs.some((t) => t.value === "ALL") && (
            <TabsContent value="ALL" className="m-0">
              <CoursesPage
                courseData={allCourses}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                sortOption={sortOption}
                onSortChange={setSortOption}
                selectedLevels={selectedLevels}
                setSelectedLevels={setSelectedLevels}
                selectedSessions={selectedSessions}
                setSelectedSessions={setSelectedSessions}
                selectedTags={selectedTags}
                setSelectedTags={setSelectedTags}
                selectedInstructors={selectedInstructors}
                setSelectedInstructors={setSelectedInstructors}
                onApplyFilters={handleApplyFilters}
                clearAllFilters={clearAllFilters}
                handlePageChange={handlePageChangeAll}
                showFilters={selectedTab === "ALL"}
                selectedTab={selectedTab}
                isLoading={isLoadingByTab.ALL}
              />
            </TabsContent>
          )}
          {visibleTabs.some((t) => t.value === "PROGRESS") && (
            <TabsContent value="PROGRESS" className="m-0">
              <CoursesPage
                courseData={progressCourses}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                sortOption={sortOption}
                onSortChange={setSortOption}
                selectedLevels={selectedLevels}
                setSelectedLevels={setSelectedLevels}
                selectedSessions={selectedSessions}
                setSelectedSessions={setSelectedSessions}
                selectedTags={selectedTags}
                setSelectedTags={setSelectedTags}
                selectedInstructors={selectedInstructors}
                setSelectedInstructors={setSelectedInstructors}
                onApplyFilters={handleApplyFilters}
                clearAllFilters={clearAllFilters}
                handlePageChange={handlePageChangeProgress}
                showFilters={false}
                selectedTab={selectedTab}
                isLoading={isLoadingByTab.PROGRESS}
              />
            </TabsContent>
          )}
          {visibleTabs.some((t) => t.value === "COMPLETED") && (
            <TabsContent value="COMPLETED" className="m-0">
              <CoursesPage
                courseData={completedCourses}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                sortOption={sortOption}
                onSortChange={setSortOption}
                selectedLevels={selectedLevels}
                setSelectedLevels={setSelectedLevels}
                selectedSessions={selectedSessions}
                setSelectedSessions={setSelectedSessions}
                selectedTags={selectedTags}
                setSelectedTags={setSelectedTags}
                selectedInstructors={selectedInstructors}
                setSelectedInstructors={setSelectedInstructors}
                onApplyFilters={handleApplyFilters}
                clearAllFilters={clearAllFilters}
                handlePageChange={handlePageChangeCompleted}
                showFilters={false}
                selectedTab={selectedTab}
                isLoading={isLoadingByTab.COMPLETED}
              />
            </TabsContent>
          )}
          {visibleTabs
            .filter((tab) => customTabs[tab.value])
            .map((tab) => (
              <TabsContent key={tab.value} value={tab.value} className="m-0">
                {customTabs[tab.value]?.type === "LIVE_SESSIONS" ? (
                  <Suspense fallback={<LoadingState variant="list" count={3} />}>
                    <LiveClassView embedded />
                  </Suspense>
                ) : customTabs[tab.value]?.type === "PRODUCT_PAGES" ? (
                  <CustomTabProductPages pages={customTabs[tab.value]?.productPages ?? []} />
                ) : (
                /* Browses the catalogue like ALL, so course details must see
                    ALL (enrol CTA) rather than this tab's value. */
                <CoursesPage
                  courseData={customCourses[tab.value] ?? { ...allCourses, content: [], totalElements: 0, totalPages: 0 }}
                  searchTerm={searchTerm}
                  onSearchChange={setSearchTerm}
                  sortOption={sortOption}
                  onSortChange={setSortOption}
                  selectedLevels={selectedLevels}
                  setSelectedLevels={setSelectedLevels}
                  selectedSessions={selectedSessions}
                  setSelectedSessions={setSelectedSessions}
                  selectedTags={selectedTags}
                  setSelectedTags={setSelectedTags}
                  selectedInstructors={selectedInstructors}
                  setSelectedInstructors={setSelectedInstructors}
                  onApplyFilters={handleApplyFilters}
                  clearAllFilters={clearAllFilters}
                  handlePageChange={handlePageChangeCustom(tab.value)}
                  showFilters={false}
                  selectedTab="ALL"
                  isLoading={isLoadingByTab[tab.value] ?? false}
                />
                )}
              </TabsContent>
            ))}
        </Tabs>
      </div>
    </div>
  );
};

export default CourseCatalougePage;
