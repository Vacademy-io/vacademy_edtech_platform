import type { AllCourseFilters, AllCoursesApiResponse, CourseInstructor } from './course-material';
import type { CourseItem } from './course-material';
import type { UserRolesDataEntry } from '@/types/dashboard/user-roles';
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from '@/components/ui/select';
import { StarRatingComponent } from '@/components/common/star-rating-component';
import { MyButton } from '@/components/design-system/button';
import {
    TrashSimple,
    Funnel,
    X,
    Package,
    ListBullets,
    BookOpen,
    UsersThree,
} from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { MyPagination } from '@/components/design-system/pagination';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { compareByNameNatural, convertCapitalToTitleCase } from '@/lib/utils';
import { CourseImageShimmer, InstructorAvatarShimmer } from '@/components/ui/shimmer';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

const MAX_VISIBLE_TAGS = 5;

interface CourseListPageProps {
    selectedFilters: AllCourseFilters;
    setSelectedFilters: React.Dispatch<React.SetStateAction<AllCourseFilters>>;
    handleClearAll: () => void;
    handleApply: () => void;
    levels: Array<{ id: string; name: string }>;
    handleLevelChange: (levelId: string) => void;
    handleSessionChange: (sessionId: string) => void;
    tags: string[];
    accessControlUsers: UserRolesDataEntry[];
    handleUserChange: (userId: string) => void;
    handleTagChange: (tagValue: string) => void;
    searchValue: string;
    setSearchValue: React.Dispatch<React.SetStateAction<string>>;
    handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    sortBy: string;
    setSortBy: React.Dispatch<React.SetStateAction<string>>;
    allCourses: AllCoursesApiResponse | null;
    courseImageUrls: Record<string, string>;
    instructorProfilePicUrls: Record<string, string>;
    isLoadingImages: boolean;
    handleCourseDelete: (courseId: string) => void;
    page: number;
    handlePageChange: (newPage: number) => void;
    deletingCourseId: string | null;
    showDeleteButton?: boolean;
    /** When true, hide the filters section (e.g. for faculty users with restricted access) */
    hideFilters?: boolean;
    /** When true, render the ACTIVE enrolled-student count on each course card. */
    showEnrolledStudentCount?: boolean;
}

const CourseListPage = ({
    selectedFilters,
    setSelectedFilters,
    handleClearAll,
    handleApply,
    levels,
    handleLevelChange,
    handleSessionChange,
    tags,
    accessControlUsers,
    handleUserChange,
    handleTagChange,
    searchValue,
    setSearchValue,
    handleSearchChange,
    handleSearchKeyDown,
    sortBy,
    setSortBy,
    allCourses,
    courseImageUrls,
    instructorProfilePicUrls,
    isLoadingImages,
    handleCourseDelete,
    page,
    handlePageChange,
    deletingCourseId,
    showDeleteButton = true,
    hideFilters = false,
    showEnrolledStudentCount = false,
}: CourseListPageProps) => {
    const { t } = useTranslation('courseList');
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [isDesktopFilterOpen, setIsDesktopFilterOpen] = useState(false);
    const { instituteDetails } = useInstituteDetailsStore();

    const sessions = useMemo(
        () =>
            (instituteDetails?.sessions ?? [])
                .filter((s) => s.status !== 'DELETED')
                .map((s) => ({ id: s.id, name: s.session_name }))
                // Natural sort so "2024-25" precedes "2025-26" and numeric
                // batch names read in order, like the Levels filter.
                .sort(compareByNameNatural),
        [instituteDetails]
    );

    const isDefaultName = (name?: string | null) => !name || name.toLowerCase() === 'default';

    const packageView = selectedFilters.package_view;

    // Group courses by package ID when in package view
    const groupedCourses = useMemo(() => {
        if (!packageView || !allCourses?.content) return null;
        const groups = new Map<string, CourseItem[]>();
        allCourses.content.forEach((course) => {
            const existing = groups.get(course.id) || [];
            existing.push(course);
            groups.set(course.id, existing);
        });
        return groups;
    }, [allCourses, packageView]);

    // Count active filters
    const activeFilterCount =
        selectedFilters.level_ids.length +
        selectedFilters.tag.length +
        selectedFilters.faculty_ids.length +
        selectedFilters.session_ids.length;

    // Filter sidebar content - reused between mobile sheet and desktop sidebar
    const FilterContent = ({ onClose }: { onClose?: () => void } = {}) => (
        <div className="flex h-full flex-col gap-2">
            <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Funnel size={16} className="text-neutral-500" />
                    <div className="text-base font-semibold">{t('filters')}</div>
                    {activeFilterCount > 0 && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                            {activeFilterCount}
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {activeFilterCount > 0 && (
                        <button
                            className="rounded px-2 py-1 text-xs font-medium text-neutral-500 transition-colors hover:text-primary-500"
                            onClick={handleClearAll}
                            type="button"
                        >
                            {t('clear')}
                        </button>
                    )}
                    {onClose && (
                        <button
                            className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                            onClick={onClose}
                            type="button"
                            aria-label={t('closeFilters')}
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>
            <Accordion type="multiple" defaultValue={[]} className="w-full">
                {/* Session filter. The heading comes from Naming Settings
                    (ContentTerms.Session) so an institute that calls sessions
                    "Batches" / "Academic Years" sees its own word here, exactly
                    like the Levels / Teachers headings below. Multi-select —
                    the catalog API takes `session_ids: string[]`. */}
                {sessions.length > 0 && (
                    <AccordionItem value="sessions" className="border-b-0">
                        <AccordionTrigger className="py-2 hover:no-underline">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">
                                    {getTerminologyPlural(ContentTerms.Session, SystemTerms.Session)}
                                </span>
                                {selectedFilters.session_ids.length > 0 && (
                                    <Badge variant="secondary" className="h-5 px-1.5 text-2xs">
                                        {selectedFilters.session_ids.length}
                                    </Badge>
                                )}
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-2">
                            <div className="flex flex-col gap-2">
                                {sessions.map((session) => (
                                    <label
                                        key={session.id}
                                        className="group flex cursor-pointer items-center gap-2"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedFilters.session_ids.includes(
                                                session.id
                                            )}
                                            onChange={() => handleSessionChange(session.id)}
                                            className="scale-110 accent-primary-500 transition-transform"
                                        />
                                        <span className="text-sm transition-colors group-hover:text-primary-500">
                                            {session.name}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                )}

                <AccordionItem value="levels" className="border-b-0">
                    <AccordionTrigger className="py-2 hover:no-underline">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">
                                {getTerminologyPlural(ContentTerms.Level, SystemTerms.Level)}
                            </span>
                            {selectedFilters.level_ids.length > 0 && (
                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                    {selectedFilters.level_ids.length}
                                </Badge>
                            )}
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-2">
                        <div className="flex flex-col gap-2">
                            {levels.map((level: { id: string; name: string }) => (
                                <label
                                    key={level.id}
                                    className="group flex cursor-pointer items-center gap-2"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedFilters.level_ids.includes(level.id)}
                                        onChange={() => handleLevelChange(level.id)}
                                        className="scale-110 accent-primary-500 transition-transform"
                                    />
                                    <span className="text-sm transition-colors group-hover:text-primary-500">
                                        {convertCapitalToTitleCase(level.name)}
                                    </span>
                                </label>
                            ))}
                            {levels.length === 0 && (
                                <div className="py-1 text-xs italic text-neutral-400">
                                    {t('noOptionsAvailable')}
                                </div>
                            )}
                        </div>
                    </AccordionContent>
                </AccordionItem>

                {tags.length > 0 && (
                    <AccordionItem value="tags" className="border-b-0">
                        <AccordionTrigger className="py-2 hover:no-underline">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">
                                    {getTerminology(
                                        ContentTerms.PopularTag,
                                        SystemTerms.PopularTag
                                    )}
                                </span>
                                {selectedFilters.tag.length > 0 && (
                                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                        {selectedFilters.tag.length}
                                    </Badge>
                                )}
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-2">
                            <div className="flex flex-col gap-2">
                                {tags.map((tagValue: string) => (
                                    <label
                                        key={tagValue}
                                        className="group flex cursor-pointer items-center gap-2"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedFilters.tag.includes(tagValue)}
                                            onChange={() => handleTagChange(tagValue)}
                                            className="scale-110 accent-primary-500 transition-transform"
                                        />
                                        <span className="text-sm transition-colors group-hover:text-primary-500">
                                            {convertCapitalToTitleCase(tagValue)}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                )}

                {Array.isArray(accessControlUsers) && accessControlUsers.length > 0 && (
                    <AccordionItem value="teachers" className="border-b-0">
                        <AccordionTrigger className="py-2 hover:no-underline">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">
                                    {getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher)}
                                </span>
                                {selectedFilters.faculty_ids.length > 0 && (
                                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                        {selectedFilters.faculty_ids.length}
                                    </Badge>
                                )}
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-2">
                            <div className="flex flex-col gap-2">
                                {(accessControlUsers as UserRolesDataEntry[]).map(
                                    (user: UserRolesDataEntry) => (
                                        <label
                                            key={user.id}
                                            className="group flex cursor-pointer items-center gap-2"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedFilters.faculty_ids.includes(
                                                    user.id
                                                )}
                                                onChange={() => handleUserChange(user.id)}
                                                className="scale-110 accent-primary-500 transition-transform"
                                            />
                                            <span className="text-sm transition-colors group-hover:text-primary-500">
                                                {user.full_name}
                                            </span>
                                        </label>
                                    )
                                )}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                )}
            </Accordion>
            {activeFilterCount > 0 && (
                <div className="mt-auto border-t border-neutral-200 pt-3">
                    <button
                        className="w-full rounded bg-primary-500 px-3 py-2 text-sm font-medium text-white transition-transform hover:bg-primary-600 active:scale-95"
                        onClick={() => {
                            handleApply();
                            if (isMobile) setIsFilterOpen(false);
                        }}
                        type="button"
                    >
                        {t('applyFilters')}
                    </button>
                </div>
            )}
        </div>
    );

    return (
        <>
            <div className="mt-4 flex w-full flex-col gap-4 lg:mt-6 lg:flex-row lg:gap-6">
                {/* Mobile Filter Button - hidden for faculty users */}
                {!hideFilters && (
                    <div className="flex items-center gap-2 lg:hidden">
                        <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
                            <SheetTrigger asChild>
                                <MyButton
                                    buttonType="secondary"
                                    className="flex items-center gap-2"
                                >
                                    <Funnel size={18} />
                                    {t('filters')}
                                    {activeFilterCount > 0 && (
                                        <span className="ml-1 flex size-5 items-center justify-center rounded-full bg-primary-500 text-xs text-white">
                                            {activeFilterCount}
                                        </span>
                                    )}
                                </MyButton>
                            </SheetTrigger>
                            <SheetContent side="left" className="w-[280px] overflow-y-auto p-4">
                                <SheetHeader className="mb-4">
                                    <SheetTitle>{t('filterCourses', { courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) })}</SheetTitle>
                                </SheetHeader>
                                <FilterContent onClose={() => setIsFilterOpen(false)} />
                            </SheetContent>
                        </Sheet>
                    </div>
                )}

                {/* Desktop Filter Section - hidden for faculty users, togglable */}
                {!hideFilters && isDesktopFilterOpen && (
                    <div className="animate-fade-in sticky top-4 hidden h-fit min-w-[240px] max-w-[260px] flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm lg:flex">
                        <FilterContent onClose={() => setIsDesktopFilterOpen(false)} />
                    </div>
                )}

                {/* Courses Section */}
                <div className="animate-fade-in flex flex-1 flex-col gap-4">
                    {/* Search and Sort Row */}
                    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        {/* Desktop Filter Toggle - only shown when filter panel is closed */}
                        {!hideFilters && !isDesktopFilterOpen && (
                            <button
                                type="button"
                                onClick={() => setIsDesktopFilterOpen(true)}
                                className="hidden items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50 lg:flex"
                            >
                                <Funnel size={16} />
                                {t('filters')}
                                {activeFilterCount > 0 && (
                                    <Badge
                                        variant="secondary"
                                        className="ml-1 h-5 px-1.5 text-[10px]"
                                    >
                                        {activeFilterCount}
                                    </Badge>
                                )}
                            </button>
                        )}
                        {/* Search Bar */}
                        <div className="relative flex-1 sm:max-w-xs">
                            {/* Search Icon */}
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
                                <svg
                                    width="18"
                                    height="18"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
                                        d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z"
                                    />
                                </svg>
                            </span>
                            <input
                                type="text"
                                value={searchValue}
                                onChange={handleSearchChange}
                                onKeyDown={handleSearchKeyDown}
                                placeholder={t('searchCourses', { courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) })}
                                className="w-full rounded-md border border-neutral-200 px-9 py-2 text-sm shadow-sm transition-all focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                            />
                            {/* Cross Button (visible only if searchValue) */}
                            {searchValue && (
                                <button
                                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 transition-transform active:scale-95"
                                    aria-label={t('clearSearch')}
                                    onClick={() => {
                                        setSearchValue('');
                                        setSelectedFilters((prev) => ({
                                            ...prev,
                                            search_by_name: '',
                                        }));
                                    }}
                                    type="button"
                                >
                                    <svg
                                        width="18"
                                        height="18"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth="2"
                                            d="M6 18L18 6M6 6l12 12"
                                        />
                                    </svg>
                                </button>
                            )}
                        </div>
                        {/* View Toggle + Sort By */}
                        <div className="flex items-center justify-between gap-4 sm:justify-end">
                            <div className="flex items-center gap-1">
                                <ListBullets
                                    size={20}
                                    weight={!packageView ? 'bold' : 'regular'}
                                    className={`cursor-pointer rounded p-0.5 transition-colors ${!packageView ? 'bg-primary-50 text-primary-600' : 'text-neutral-400 hover:text-neutral-600'}`}
                                    onClick={() =>
                                        setSelectedFilters((prev) => ({
                                            ...prev,
                                            package_view: false,
                                        }))
                                    }
                                />
                                <Switch
                                    checked={packageView}
                                    onCheckedChange={(checked) =>
                                        setSelectedFilters((prev) => ({
                                            ...prev,
                                            package_view: checked,
                                        }))
                                    }
                                />
                                <Package
                                    size={20}
                                    weight={packageView ? 'bold' : 'regular'}
                                    className={`cursor-pointer rounded p-0.5 transition-colors ${packageView ? 'bg-primary-50 text-primary-600' : 'text-neutral-400 hover:text-neutral-600'}`}
                                    onClick={() =>
                                        setSelectedFilters((prev) => ({
                                            ...prev,
                                            package_view: true,
                                        }))
                                    }
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-neutral-600">
                                    {t('sortBy')}
                                </span>
                                <Select value={sortBy} onValueChange={setSortBy}>
                                    <SelectTrigger className="w-[110px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="oldest">{t('oldest')}</SelectItem>
                                        <SelectItem value="newest">{t('newest')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    {/* Course Grid - Responsive columns */}
                    <div
                        className={`grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 ${
                            isDesktopFilterOpen
                                ? 'lg:grid-cols-2 xl:grid-cols-3'
                                : 'lg:grid-cols-3 xl:grid-cols-4'
                        }`}
                    >
                        {packageView && groupedCourses && groupedCourses.size > 0 ? (
                            Array.from(groupedCourses.entries()).map(([packageId, courseRows]) => {
                                const course = courseRows[0]!;
                                const instructors: CourseInstructor[] = course.instructors || [];
                                const tags: string[] = course.comma_separeted_tags
                                    ? course.comma_separeted_tags
                                          .split(',')
                                          .map((t: string) => t.trim())
                                    : [];
                                const displayName = convertCapitalToTitleCase(course.package_name);

                                // Collect unique non-default level names
                                const levelNames = [
                                    ...new Set(
                                        courseRows
                                            .map((r) => r.level_name)
                                            .filter((n): n is string => !isDefaultName(n))
                                    ),
                                ];
                                // Collect unique non-default session names
                                const sessionNames = [
                                    ...new Set(
                                        courseRows
                                            .map((r) => r.session_name)
                                            .filter((n): n is string => !isDefaultName(n))
                                    ),
                                ];
                                // Sum ACTIVE enrolled students across all sessions of the package
                                const enrolledStudentCount = courseRows.reduce(
                                    (sum, r) => sum + (r.enrolled_student_count ?? 0),
                                    0
                                );

                                return (
                                    <div
                                        key={packageId}
                                        className="animate-fade-in group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white p-0 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                                        onClick={() =>
                                            navigate({
                                                to: '/study-library/courses/course-details',
                                                search: {
                                                    courseId: packageId,
                                                    sessionId: course.session_id,
                                                    levelId: course.level_id,
                                                },
                                            })
                                        }
                                    >
                                        <div className="relative flex aspect-[2/1] w-full flex-shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-primary-50 via-primary-100/50 to-white">
                                            {isLoadingImages ? (
                                                <CourseImageShimmer />
                                            ) : courseImageUrls[course.id] ? (
                                                <img
                                                    src={
                                                        courseImageUrls[course.id] ||
                                                        course.thumbnail_file_id
                                                    }
                                                    alt={course.package_name}
                                                    className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                />
                                            ) : (
                                                <div className="flex flex-col items-center justify-center gap-1.5 p-3 text-center">
                                                    <BookOpen
                                                        size={32}
                                                        weight="duotone"
                                                        className="text-primary-400"
                                                    />
                                                    <span className="line-clamp-2 text-xs font-medium text-primary-600/80">
                                                        {displayName}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-1 flex-col gap-1 p-3">
                                            <div className="line-clamp-2 min-w-0 text-sm font-bold text-neutral-800">
                                                {displayName}
                                            </div>
                                            {/* Level & Session badges */}
                                            {(() => {
                                                const visibleLevels = levelNames.slice(
                                                    0,
                                                    MAX_VISIBLE_TAGS
                                                );
                                                const levelOverflow =
                                                    levelNames.length - visibleLevels.length;
                                                const remainingSlots =
                                                    MAX_VISIBLE_TAGS - visibleLevels.length;
                                                const visibleSessions = sessionNames.slice(
                                                    0,
                                                    Math.max(remainingSlots, 0)
                                                );
                                                const sessionOverflow =
                                                    sessionNames.length - visibleSessions.length;
                                                const totalOverflow =
                                                    levelOverflow + sessionOverflow;
                                                const overflowTitle = [
                                                    ...levelNames
                                                        .slice(visibleLevels.length)
                                                        .map((n) => convertCapitalToTitleCase(n)),
                                                    ...sessionNames.slice(visibleSessions.length),
                                                ].join(', ');
                                                if (
                                                    levelNames.length === 0 &&
                                                    sessionNames.length === 0
                                                )
                                                    return null;
                                                return (
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {visibleLevels.map((name) => (
                                                            <span
                                                                key={name}
                                                                className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
                                                            >
                                                                {convertCapitalToTitleCase(name)}
                                                            </span>
                                                        ))}
                                                        {visibleSessions.map((name) => (
                                                            <span
                                                                key={name}
                                                                className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700"
                                                            >
                                                                {name}
                                                            </span>
                                                        ))}
                                                        {totalOverflow > 0 && (
                                                            <span
                                                                className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700"
                                                                title={overflowTitle}
                                                            >
                                                                {t('moreCount', { count: totalOverflow })}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                            <div
                                                className={
                                                    (course.course_html_description_html || '')
                                                        .replace(/<[^>]*>/g, '')
                                                        .slice(0, 120).length > 0
                                                        ? 'mt-1 line-clamp-2 text-xs text-neutral-600 sm:mt-2 sm:text-sm'
                                                        : 'text-xs text-neutral-600 sm:text-sm'
                                                }
                                            >
                                                {(course.course_html_description_html || '')
                                                    .replace(/<[^>]*>/g, '')
                                                    .slice(0, 120)}
                                            </div>
                                            {instructors.length > 0 && (
                                                <div className="mt-2 flex items-center gap-2">
                                                    {instructors.map((inst) =>
                                                        isLoadingImages ? (
                                                            <InstructorAvatarShimmer
                                                                key={inst.id}
                                                            />
                                                        ) : (
                                                            <img
                                                                key={inst.id}
                                                                src={
                                                                    instructorProfilePicUrls[
                                                                        inst.id
                                                                    ] ||
                                                                    'https://randomuser.me/api/portraits/lego/1.jpg'
                                                                }
                                                                alt={inst.full_name}
                                                                className="-ml-2 size-6 rounded-full border border-neutral-200 object-cover first:ml-0 sm:size-7"
                                                            />
                                                        )
                                                    )}
                                                    <span className="ml-1 truncate text-xs text-neutral-600 sm:ml-2">
                                                        {instructors
                                                            .map((inst) => inst.full_name)
                                                            .join(', ')}
                                                    </span>
                                                </div>
                                            )}
                                            {tags.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
                                                        <span
                                                            key={tag}
                                                            className="flex-shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                    {tags.length > MAX_VISIBLE_TAGS && (
                                                        <span
                                                            className="flex-shrink-0 rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700"
                                                            title={tags
                                                                .slice(MAX_VISIBLE_TAGS)
                                                                .join(', ')}
                                                        >
                                                            {t('moreCount', { count: tags.length - MAX_VISIBLE_TAGS })}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            <div className="my-2 -mb-2 flex items-center gap-2">
                                                <StarRatingComponent
                                                    score={course.rating * 20}
                                                    maxScore={100}
                                                />
                                                <span className="text-neutral-500">
                                                    {(course.rating || 0).toFixed(1)}
                                                </span>
                                            </div>
                                            <span className="-mb-3 mt-2 flex items-center gap-1 rounded py-1 text-xs font-medium text-gray-500">
                                                {course.is_course_published_to_catalaouge ? (
                                                    <>
                                                        <Eye className="size-4" /> {t('inCatalog')}
                                                    </>
                                                ) : (
                                                    <>
                                                        <EyeSlash className="size-4" /> {t('private')}
                                                    </>
                                                )}
                                            </span>
                                            {showEnrolledStudentCount && (
                                                <span className="mt-2 flex items-center gap-1 rounded py-1 text-xs font-medium text-gray-500">
                                                    <UsersThree className="size-4" />
                                                    {t('enrolledCount', {
                                                        count: enrolledStudentCount,
                                                        term:
                                                            enrolledStudentCount === 1
                                                                ? getTerminology(
                                                                      RoleTerms.Learner,
                                                                      SystemTerms.Learner
                                                                  )
                                                                : getTerminologyPlural(
                                                                      RoleTerms.Learner,
                                                                      SystemTerms.Learner
                                                                  ),
                                                    })}
                                                </span>
                                            )}
                                            <div className="mt-auto flex gap-2 pt-3">
                                                <MyButton
                                                    className="flex-1 text-sm"
                                                    buttonType="primary"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigate({
                                                            to: '/study-library/courses/course-details',
                                                            search: {
                                                                courseId: packageId,
                                                                sessionId: course.session_id,
                                                                levelId: course.level_id,
                                                            },
                                                        });
                                                    }}
                                                >
                                                    {t('viewCourse', {
                                                        course: getTerminology(
                                                            ContentTerms.Course,
                                                            SystemTerms.Course
                                                        ),
                                                    })}
                                                </MyButton>
                                                {showDeleteButton && (
                                                    <div onClick={(e) => e.stopPropagation()}>
                                                        <AlertDialog
                                                            open={
                                                                deletingCourseId === course.id ||
                                                                undefined
                                                            }
                                                            onOpenChange={() => {}}
                                                        >
                                                            <AlertDialogTrigger className="flex size-9 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-500 transition-colors hover:border-red-300 hover:bg-red-100 active:scale-95">
                                                                <TrashSimple size={18} />
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md">
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>
                                                                        {t('deleteConfirmTitle', {
                                                                            course: getTerminology(
                                                                                ContentTerms.Course,
                                                                                SystemTerms.Course
                                                                            ),
                                                                        })}
                                                                    </AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        {t('deleteConfirmBody')}
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
                                                                    <AlertDialogCancel
                                                                        disabled={
                                                                            deletingCourseId ===
                                                                            course.id
                                                                        }
                                                                        className="w-full sm:w-auto"
                                                                    >
                                                                        {t('cancel')}
                                                                    </AlertDialogCancel>
                                                                    <AlertDialogAction
                                                                        onClick={() =>
                                                                            handleCourseDelete(
                                                                                course.id
                                                                            )
                                                                        }
                                                                        disabled={
                                                                            deletingCourseId ===
                                                                            course.id
                                                                        }
                                                                        className="w-full bg-primary-500 text-white sm:w-auto"
                                                                    >
                                                                        {deletingCourseId ===
                                                                        course.id
                                                                            ? t('deleting')
                                                                            : t('confirm')}
                                                                    </AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : Array.isArray(allCourses?.content) &&
                          (allCourses?.content?.length ?? 0) > 0 ? (
                            allCourses?.content?.map((course: CourseItem) => {
                                const instructors: CourseInstructor[] = course.instructors || [];
                                const tags: string[] = course.comma_separeted_tags
                                    ? course.comma_separeted_tags
                                          .split(',')
                                          .map((t: string) => t.trim())
                                    : [];
                                const displayName = course.package_session_name
                                    ? `${convertCapitalToTitleCase(course.package_name)} ${convertCapitalToTitleCase(course.package_session_name)}`
                                    : convertCapitalToTitleCase(course.package_name);

                                return (
                                    <div
                                        key={`${course.id}-${course.package_session_id}`}
                                        className="animate-fade-in group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white p-0 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                                        onClick={() =>
                                            navigate({
                                                to: '/study-library/courses/course-details',
                                                search: {
                                                    courseId: course.id,
                                                    sessionId: course.session_id,
                                                    levelId: course.level_id,
                                                },
                                            })
                                        }
                                    >
                                        <div className="relative flex aspect-[2/1] w-full flex-shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-primary-50 via-primary-100/50 to-white">
                                            {isLoadingImages ? (
                                                <CourseImageShimmer />
                                            ) : courseImageUrls[course.id] ? (
                                                <img
                                                    src={
                                                        courseImageUrls[course.id] ||
                                                        course.thumbnail_file_id
                                                    }
                                                    alt={course.package_name}
                                                    className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                />
                                            ) : (
                                                <div className="flex flex-col items-center justify-center gap-1.5 p-3 text-center">
                                                    <BookOpen
                                                        size={32}
                                                        weight="duotone"
                                                        className="text-primary-400"
                                                    />
                                                    <span className="line-clamp-2 text-xs font-medium text-primary-600/80">
                                                        {displayName}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-1 flex-col gap-1 p-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="line-clamp-2 min-w-0 flex-1 text-sm font-bold text-neutral-800">
                                                    {displayName}
                                                </div>
                                                {!isDefaultName(course.level_name) && (
                                                    <div className="flex-shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                                                        {convertCapitalToTitleCase(
                                                            course.level_name
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            {!isDefaultName(course.session_name) && (
                                                <span className="w-fit rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                                                    {course.session_name}
                                                </span>
                                            )}
                                            <div
                                                className={
                                                    (course.course_html_description_html || '')
                                                        .replace(/<[^>]*>/g, '')
                                                        .slice(0, 120).length > 0
                                                        ? 'mt-1 line-clamp-2 text-xs text-neutral-600 sm:mt-2 sm:text-sm'
                                                        : 'text-xs text-neutral-600 sm:text-sm'
                                                }
                                            >
                                                {(course.course_html_description_html || '')
                                                    .replace(/<[^>]*>/g, '')
                                                    .slice(0, 120)}
                                            </div>
                                            {instructors.length > 0 && (
                                                <div className="mt-2 flex items-center gap-2">
                                                    {instructors.map((inst) =>
                                                        isLoadingImages ? (
                                                            <InstructorAvatarShimmer
                                                                key={inst.id}
                                                            />
                                                        ) : (
                                                            <img
                                                                key={inst.id}
                                                                src={
                                                                    instructorProfilePicUrls[
                                                                        inst.id
                                                                    ] ||
                                                                    'https://randomuser.me/api/portraits/lego/1.jpg'
                                                                }
                                                                alt={inst.full_name}
                                                                className="-ml-2 size-6 rounded-full border border-neutral-200 object-cover first:ml-0 sm:size-7"
                                                            />
                                                        )
                                                    )}
                                                    <span className="ml-1 truncate text-xs text-neutral-600 sm:ml-2">
                                                        {instructors
                                                            .map((inst) => inst.full_name)
                                                            .join(', ')}
                                                    </span>
                                                </div>
                                            )}
                                            {tags.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
                                                        <span
                                                            key={tag}
                                                            className="flex-shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                    {tags.length > MAX_VISIBLE_TAGS && (
                                                        <span
                                                            className="flex-shrink-0 rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700"
                                                            title={tags
                                                                .slice(MAX_VISIBLE_TAGS)
                                                                .join(', ')}
                                                        >
                                                            {t('moreCount', { count: tags.length - MAX_VISIBLE_TAGS })}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            <div className="my-2 -mb-2 flex items-center gap-2">
                                                <StarRatingComponent
                                                    score={course.rating * 20}
                                                    maxScore={100}
                                                />
                                                <span className="text-neutral-500">
                                                    {(course.rating || 0).toFixed(1)}
                                                </span>
                                            </div>
                                            <span className="-mb-3 mt-2 flex items-center gap-1 rounded py-1 text-xs font-medium text-gray-500">
                                                {course.is_course_published_to_catalaouge ? (
                                                    <>
                                                        <Eye className="size-4" /> {t('inCatalog')}
                                                    </>
                                                ) : (
                                                    <>
                                                        <EyeSlash className="size-4" /> {t('private')}
                                                    </>
                                                )}
                                            </span>
                                            {showEnrolledStudentCount && (
                                                <span className="mt-2 flex items-center gap-1 rounded py-1 text-xs font-medium text-gray-500">
                                                    <UsersThree className="size-4" />
                                                    {t('enrolledCount', {
                                                        count: course.enrolled_student_count ?? 0,
                                                        term:
                                                            (course.enrolled_student_count ?? 0) === 1
                                                                ? getTerminology(
                                                                      RoleTerms.Learner,
                                                                      SystemTerms.Learner
                                                                  )
                                                                : getTerminologyPlural(
                                                                      RoleTerms.Learner,
                                                                      SystemTerms.Learner
                                                                  ),
                                                    })}
                                                </span>
                                            )}
                                            <div className="mt-auto flex gap-2 pt-3">
                                                <MyButton
                                                    className="flex-1 text-sm"
                                                    buttonType="primary"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigate({
                                                            to: '/study-library/courses/course-details',
                                                            search: {
                                                                courseId: course.id,
                                                                sessionId: course.session_id,
                                                                levelId: course.level_id,
                                                            },
                                                        });
                                                    }}
                                                >
                                                    {t('viewCourse', {
                                                        course: getTerminology(
                                                            ContentTerms.Course,
                                                            SystemTerms.Course
                                                        ),
                                                    })}
                                                </MyButton>
                                                {showDeleteButton && (
                                                    <div onClick={(e) => e.stopPropagation()}>
                                                        <AlertDialog
                                                            open={
                                                                deletingCourseId === course.id ||
                                                                undefined
                                                            }
                                                            onOpenChange={() => {}}
                                                        >
                                                            <AlertDialogTrigger className="flex size-9 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-500 transition-colors hover:border-red-300 hover:bg-red-100 active:scale-95">
                                                                <TrashSimple size={18} />
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md">
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>
                                                                        {t('deleteConfirmTitle', {
                                                                            course: getTerminology(
                                                                                ContentTerms.Course,
                                                                                SystemTerms.Course
                                                                            ),
                                                                        })}
                                                                    </AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        {t('deleteConfirmBody')}
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
                                                                    <AlertDialogCancel
                                                                        disabled={
                                                                            deletingCourseId ===
                                                                            course.id
                                                                        }
                                                                        className="w-full sm:w-auto"
                                                                    >
                                                                        {t('cancel')}
                                                                    </AlertDialogCancel>
                                                                    <AlertDialogAction
                                                                        onClick={() =>
                                                                            handleCourseDelete(
                                                                                course.id
                                                                            )
                                                                        }
                                                                        disabled={
                                                                            deletingCourseId ===
                                                                            course.id
                                                                        }
                                                                        className="w-full bg-primary-500 text-white sm:w-auto"
                                                                    >
                                                                        {deletingCourseId ===
                                                                        course.id
                                                                            ? t('deleting')
                                                                            : t('confirm')}
                                                                    </AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="col-span-full py-8 text-center text-neutral-400">
                                {t('noCoursesFound', { courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) })}
                            </div>
                        )}
                    </div>
                    <MyPagination
                        currentPage={page}
                        totalPages={allCourses?.totalPages || 0}
                        onPageChange={handlePageChange}
                    />
                </div>
            </div>
        </>
    );
};

export default CourseListPage;
