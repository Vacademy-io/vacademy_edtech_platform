import React, { useEffect, useRef, useState } from "react";
import { createPageChangeDetector } from "./page-change";
import FilterPanel from "./FilterPanel.tsx";
import SearchAndSortBar from "./SearchAndSortBar.tsx";
import CourseCard from "./CourseCards.tsx";
import Pagination from "./Pagination.tsx";
import { CoursePackageResponse } from "@/types/course-catalog/course-catalog-list.ts";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn, toTitleCase } from "@/lib/utils";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils.ts";
import { ContentTerms, SystemTerms } from "@/types/naming-settings.ts";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { LoadErrorState } from "@/components/design-system/states";
import { resolveListView, type RequestStatus } from "@/lib/list-status";

interface CoursesPageProps {
    courseData: CoursePackageResponse;
    searchTerm: string;
    onSearchChange: (value: string) => void;
    sortOption: string;
    onSortChange: (value: string) => void;
    selectedLevels: string[];
    setSelectedLevels: (levels: string[]) => void;
    selectedSessions: string[];
    setSelectedSessions: (sessions: string[]) => void;
    selectedTags: string[];
    setSelectedTags: (tags: string[]) => void;
    selectedInstructors: string[];
    setSelectedInstructors: (instructors: string[]) => void;
    clearAllFilters: () => void;
    onApplyFilters: () => void;

    handlePageChange: (page: number) => void;
    showFilters?: boolean;
    selectedTab: string;
    /** How the request for this tab ended; undefined until one has started. */
    status?: RequestStatus;
    onRetry: () => void;
}

const CoursesPage: React.FC<CoursesPageProps> = ({
    courseData,
    searchTerm,
    onSearchChange,
    sortOption,
    onSortChange,
    selectedLevels,
    setSelectedLevels,
    selectedSessions,
    setSelectedSessions,
    selectedTags,
    setSelectedTags,
    selectedInstructors,
    setSelectedInstructors,
    clearAllFilters,
    onApplyFilters,
    handlePageChange,
    showFilters = true,
    selectedTab,
    status,
    onRetry,
}) => {
    const { t } = useTranslation("study");
    // Lower-cased at the call site (not in the catalog) so the composed
    // terminology reads naturally mid-sentence in English; a no-op for
    // scripts without case, such as Arabic and Hindi.
    const coursesLower = getTerminologyPlural(
        ContentTerms.Course,
        SystemTerms.Course
    ).toLocaleLowerCase();

    const fallbackDescription =
        "";
    const fallbackTags: string = "";

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const filterPanelRef = useRef<HTMLDivElement | null>(null);
    const [isSticky, setIsSticky] = useState(false);
    const [filterPanelWidth, setFilterPanelWidth] = useState(0);
    const [filterPanelLeft, setFilterPanelLeft] = useState(0);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    // Institute setting: hide the instructor name block on each course card.
    const [hideInstructorName, setHideInstructorName] = useState(false);
    useEffect(() => {
        getStudentDisplaySettings(false)
            .then((s) => setHideInstructorName(s?.allCourses?.hideInstructorName ?? false))
            .catch(() => setHideInstructorName(false));
    }, []);

    const activeFiltersCount =
        selectedLevels.length + selectedSessions.length + selectedTags.length + selectedInstructors.length;

    const listView = resolveListView(status, (courseData.content ?? []).length);

    // "Matching your search" is only true when there is a search or a filter.
    const emptyCopyKey =
        searchTerm.trim() || activeFiltersCount > 0
            ? "catalog.empty"
            : selectedTab === "PROGRESS"
                ? "catalog.emptyProgress"
                : selectedTab === "COMPLETED"
                    ? "catalog.emptyCompleted"
                    : "catalog.emptyAll";

    // Smooth scroll on page change and dev log. Opening the screen and the first
    // page of results arriving are not page changes: both leave the learner where
    // they are.
    const [pageChanged] = useState(() => createPageChangeDetector(courseData.number));
    useEffect(() => {
        if (import.meta.env.DEV) {
            console.debug("[CoursesPage] page changed", {
                page: courseData.number,
                totalPages: courseData.totalPages,
                totalElements: courseData.totalElements,
            });
        }
        if (pageChanged(courseData.number) && scrollRef.current) {
            scrollRef.current.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        }
    }, [courseData.number, courseData.totalPages, courseData.totalElements, pageChanged]);

    // Helper function to toggle item in array
    const toggleItem = (
        itemId: string,
        list: string[],
        setter: (newList: string[]) => void
    ) => {
        if (list.includes(itemId)) {
            setter(list.filter((i) => i !== itemId));
        } else {
            setter([...list, itemId]);
        }
    };

    // Sticky filter panel logic
    useEffect(() => {
        if (!showFilters || !filterPanelRef.current) return;

        const handleScroll = () => {
            if (!filterPanelRef.current) return;

            const rect = filterPanelRef.current.getBoundingClientRect();
            const scrollTop = window.scrollY || document.documentElement.scrollTop;

            // Check if we're on desktop (lg breakpoint is 1024px)
            if (window.innerWidth < 1024) {
                setIsSticky(false);
                return;
            }

            // Navbar is approximately 80px, start sticking when scrolled past initial position
            if (scrollTop > 150) {
                if (!isSticky) {
                    setFilterPanelWidth(rect.width);
                    setFilterPanelLeft(rect.left);
                    setIsSticky(true);
                }
            } else {
                setIsSticky(false);
            }
        };

        const handleResize = () => {
            if (filterPanelRef.current && !isSticky) {
                const rect = filterPanelRef.current.getBoundingClientRect();
                setFilterPanelWidth(rect.width);
                setFilterPanelLeft(rect.left);
            }
        };

        // Initial calculation
        handleResize();
        handleScroll();

        window.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleResize);
        };
    }, [showFilters, isSticky]);

    return (
        <div
            ref={scrollRef}
            className="w-full scroll-mt-12 md:scroll-mt-14"
        >
            <div
                className={`flex flex-col lg:flex-row lg:items-start ${showFilters ? "gap-4 lg:gap-6" : ""} mx-auto relative`}
            >
                {/* Sidebar — always rendered so mobile Sheet trigger is accessible */}
                {showFilters && (
                    <>
                        {/* Spacer to maintain layout when filter panel becomes fixed */}
                        {isSticky && isFilterOpen && (
                            <div
                                className="hidden lg:block flex-shrink-0"
                                style={{ width: '20rem' }}
                            />
                        )}
                        <aside
                            ref={filterPanelRef}
                            className={cn(
                                "w-full flex-shrink-0",
                                // Hide the desktop column when filter is closed;
                                // mobile Sheet trigger inside is already lg:hidden so unaffected
                                !isFilterOpen && "lg:hidden"
                            )}
                            style={isFilterOpen ? {
                                position: isSticky ? 'fixed' : 'static',
                                top: isSticky ? '5rem' : 'auto',
                                left: isSticky ? `${filterPanelLeft}px` : 'auto',
                                width: isSticky ? `${filterPanelWidth}px` : '100%',
                                maxWidth: '20rem',
                                maxHeight: isSticky ? 'calc(100vh - 6rem)' : 'none',
                                overflowY: isSticky ? 'auto' : 'visible',
                                zIndex: isSticky ? 10 : 'auto'
                            } : {}}
                        >
                            <FilterPanel
                                isDesktopOpen={isFilterOpen}
                                onClose={() => setIsFilterOpen(false)}
                                selectedLevels={selectedLevels}
                                onLevelChange={(id) =>
                                    toggleItem(
                                        id,
                                        selectedLevels,
                                        setSelectedLevels
                                    )
                                }
                                selectedSessions={selectedSessions}
                                onSessionChange={(id) =>
                                    toggleItem(
                                        id,
                                        selectedSessions,
                                        setSelectedSessions
                                    )
                                }
                                selectedTags={selectedTags}
                                onTagChange={(id) =>
                                    toggleItem(id, selectedTags, setSelectedTags)
                                }
                                selectedInstructors={selectedInstructors}
                                onInstructorChange={(id) =>
                                    toggleItem(
                                        id,
                                        selectedInstructors,
                                        setSelectedInstructors
                                    )
                                }
                                clearAllFilters={clearAllFilters}
                                onApplyFilters={onApplyFilters}
                            />
                        </aside>
                    </>
                )}

                {/* Main Content Area */}
                <div className="flex-1 min-w-0">
                    <SearchAndSortBar
                        searchTerm={searchTerm}
                        onSearchChange={onSearchChange}
                        sortOption={sortOption}
                        onSortChange={onSortChange}
                        showFilterToggle={showFilters}
                        isFilterOpen={isFilterOpen}
                        onFilterToggle={() => setIsFilterOpen((prev) => !prev)}
                        activeFiltersCount={activeFiltersCount}
                    />

                    {listView === "loading" ? (
                        <div className={cn(
                            "bg-card border rounded-md shadow-sm p-5 sm:p-6",
                            // Vibrant Styles
                            "[.ui-vibrant_&]:shadow-sm [.ui-vibrant_&]:border-primary/20",
                            "[.ui-vibrant_&]:bg-gradient-to-br [.ui-vibrant_&]:from-card [.ui-vibrant_&]:to-primary/5",
                            // Play Styles — solid, bold, Duolingo-style
                            "[.ui-play_&]:!bg-primary-50 [.ui-play_&]:rounded-2xl"
                        )}>
                            <div className="animate-pulse space-y-3 sm:space-y-4">
                                <div className="h-4 bg-muted rounded w-1/3"></div>
                                <div className={cn(
                                    "grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4",
                                    isFilterOpen
                                        ? "lg:grid-cols-2 xl:grid-cols-3"
                                        : "lg:grid-cols-3 xl:grid-cols-4"
                                )}>
                                    {Array.from({ length: 4 }).map((_, i) => (
                                        <div key={i} className="bg-muted/10 border rounded-md p-3 sm:p-4">
                                            <div className="h-32 sm:h-36 bg-muted rounded mb-3"></div>
                                            <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                                            <div className="h-3 bg-muted rounded w-1/2"></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : listView === "error" ? (
                        <div className={cn(
                            "bg-card border rounded-lg shadow-sm px-6",
                            "[.ui-vibrant_&]:shadow-sm [.ui-vibrant_&]:border-primary/20",
                            "[.ui-play_&]:!bg-primary-50 [.ui-play_&]:rounded-2xl"
                        )}>
                            <LoadErrorState
                                title={t("catalog.loadError.title", { courses: coursesLower })}
                                onRetry={onRetry}
                            />
                        </div>
                    ) : listView === "empty" ? (
                        <div className={cn(
                            "relative overflow-hidden bg-card border rounded-lg shadow-sm px-6 py-12 sm:py-16 text-center",
                            "[.ui-vibrant_&]:shadow-sm [.ui-vibrant_&]:border-primary/20",
                            "[.ui-vibrant_&]:bg-gradient-to-br [.ui-vibrant_&]:from-card [.ui-vibrant_&]:to-primary/5",
                            "[.ui-play_&]:!bg-primary-50 [.ui-play_&]:rounded-2xl"
                        )}>
                            {/* Decorative background blobs */}
                            <div className="pointer-events-none absolute -top-16 -start-10 w-48 h-48 rounded-full bg-primary-100/50 blur-3xl" aria-hidden="true" />
                            <div className="pointer-events-none absolute -bottom-12 -end-8 w-40 h-40 rounded-full bg-primary-200/40 blur-3xl" aria-hidden="true" />

                            <div className="relative">
                                {/* Illustrated icon stack */}
                                <div className="relative w-24 h-24 sm:w-28 sm:h-28 mx-auto mb-5">
                                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary-100 to-primary-200 rotate-6 [.ui-play_&]:bg-play-success/30" aria-hidden="true" />
                                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white to-primary-50 -rotate-3 border border-primary-100 flex items-center justify-center shadow-sm">
                                        <MagnifyingGlass
                                            size={36}
                                            className="text-primary-500 [.ui-play_&]:text-play-success"
                                            strokeWidth={2.25}
                                        />
                                    </div>
                                </div>
                                <h3 className="text-lg sm:text-xl font-bold text-foreground mb-2">
                                    {t(`${emptyCopyKey}.title`, { courses: coursesLower })}
                                </h3>
                                <p className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed">
                                    {t(`${emptyCopyKey}.description`, { courses: coursesLower })}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3 sm:space-y-4">
                            {/* Compact Results Summary */}
                            <div className="text-caption sm:text-xs text-muted-foreground mb-1">
                                {t("catalog.results.summary", {
                                    total: courseData.totalElements,
                                    courses: coursesLower,
                                    page: courseData.number + 1,
                                    totalPages: courseData.totalPages,
                                    showing: courseData.numberOfElements,
                                })}
                            </div>

                            {/* Course Grid — extra column at xl so wide
                                viewports show one more card per row without
                                making the cards feel cramped on lg laptops. */}
                            <div className={cn(
                                "grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4",
                                isFilterOpen
                                    ? "lg:grid-cols-2 xl:grid-cols-3"
                                    : "lg:grid-cols-3 xl:grid-cols-4"
                            )}>
                                {courseData.content.map((course, index) => {
                                    return (
                                        <CourseCard
                                            key={`${course.id || "no-id"}-${index}`}
                                            courseId={course.id}
                                            package_name={
                                                course.package_name ||
                                                t("catalog.card.untitledPackage")
                                            }
                                            level_name={toTitleCase(
                                                course.level_name || "Beginner"
                                            )}
                                            instructors={
                                                course.instructors?.length > 0
                                                    ? course.instructors
                                                    : []
                                            }
                                            packageSessionId={course.package_session_id || undefined}
                                            description={
                                                course.course_html_description_html ||
                                                fallbackDescription
                                            }
                                            tags={
                                                course.comma_separeted_tags
                                                    ? course.comma_separeted_tags
                                                        .split(",")
                                                        .map((tag: string) => tag.trim())
                                                    : fallbackTags && fallbackTags.trim() !== ""
                                                        ? fallbackTags
                                                            .split(",")
                                                            .map((tag: string) => tag.trim())
                                                        : []
                                            }
                                            previewImageUrl={
                                                course.course_preview_image_media_id ||
                                                ""
                                            }
                                            rating={course.rating || 0}
                                            // studentCount intentionally omitted: the API does not
                                            // return a real count yet, and passing a hardcoded 0
                                            // rendered a fake zero. The card hides it when absent.
                                            percentageCompleted={
                                                course.percentage_completed || 0
                                            }
                                            selectedTab={selectedTab}
                                            hideInstructorName={hideInstructorName}
                                            readTimeInMinutes={
                                                course.read_time_in_minutes || 0
                                            }
                                        />
                                    );
                                })}
                            </div>

                            {/* Pagination: API uses 0-based page (0, 1, 2...), UI shows 1-based (1, 2, 3...) */}
                            {courseData.totalPages > 1 && (
                                <div className="flex justify-center mt-4 sm:mt-6">
                                    <Pagination
                                        currentPage={courseData.number + 1}
                                        totalPages={courseData.totalPages}
                                        onPageChange={(page) => handlePageChange(page - 1)}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CoursesPage;
