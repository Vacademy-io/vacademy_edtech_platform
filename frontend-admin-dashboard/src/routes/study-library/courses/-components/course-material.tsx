import { getInstituteId } from '@/constants/helper';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AddCourseButton } from '@/components/common/study-library/add-course/add-course-button';
import { MyButton } from '@/components/design-system/button';
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import { Sparkles } from 'lucide-react';
// import useIntroJsTour from '@/hooks/use-intro';
// import { StudyLibraryIntroKey } from '@/constants/storage/introKey';
// import { studyLibrarySteps } from '@/constants/intro/steps';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { LevelType } from '@/schemas/student/student-list/institute-schema';
// import { handleGetInstituteUsersForAccessControl } from '@/routes/dashboard/-services/dashboard-services';
import { useQuery } from '@tanstack/react-query';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { compareByNameNatural } from '@/lib/utils';
import { useFacultyCreatorsList } from '@/routes/dashboard/-hooks/useTeacherList';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getAllCoursesWithFilters } from '../-services/courses-services';
import {
    hasFacultyAssignedPermission,
    fetchUserAccessDetails,
    processAccessMappings,
    saveFacultyAccessData,
    getAccessiblePackageFilters,
    hasFacultyPermission,
    getFacultyAccessData,
} from '@/lib/auth/facultyAccessUtils';
import { useCourseListStateStore } from '../-stores/course-list-state-store';

import { useDeleteCourse } from '@/services/study-library/course-operations/delete-course';
import { toast } from 'sonner';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import CourseListPage from './course-list-page';
import { AdminApprovalDashboard } from './admin-approval-dashboard';
import { AuthoredCoursesTab } from './authored-courses-tab';
import { CourseInReviewTab } from './course-in-review-tab';
import { useNavigate } from '@tanstack/react-router';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY, CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
    type CourseListTabId,
} from '@/types/display-settings';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';
import { useImageCache } from '@/hooks/use-image-cache';
import { fetchMultipleImagesWithCache } from '@/utils/image-cache-utils';
import { useCourseSettings } from '@/hooks/useCourseSettings';

export interface AllCourseFilters {
    status: string[];
    level_ids: string[];
    tag: string[];
    faculty_ids: string[];
    search_by_name: string;
    min_percentage_completed: number;
    max_percentage_completed: number;
    sort_columns: Record<string, 'ASC' | 'DESC'>;
    package_ids?: string[];
    package_session_ids?: string[];
    package_session_filter?: 'PARENTS_ONLY' | 'CHILDREN_ONLY' | null;
    session_ids: string[];
    package_view: boolean;
}

// Add types for API response and course item
export interface CourseInstructor {
    id: string;
    username: string;
    email: string;
    full_name: string;
    address_line: string;
    city: string;
    region: string;
    pin_code: string;
    mobile_number: string;
    date_of_birth: string;
    gender: string;
    password: string;
    profile_pic_file_id: string;
    roles: string[];
    root_user: boolean;
}

export interface CourseItem {
    id: string;
    package_name: string;
    /**
     * Optional human-friendly name for the specific package session
     * (e.g. "Morning Batch A"). When present, the UI concatenates
     * this with `package_name` for display on the All Courses page.
     */
    package_session_name?: string | null;
    thumbnail_file_id: string;
    is_course_published_to_catalaouge: boolean;
    course_preview_image_media_id: string;
    course_banner_media_id: string;
    course_media_id: string;
    why_learn_html: string;
    who_should_learn_html: string;
    about_the_course_html: string;
    comma_separeted_tags: string;
    course_depth: number;
    course_html_description_html: string;
    percentage_completed: number;
    rating: number;
    package_session_id: string;
    level_id: string;
    level_name: string;
    instructors: CourseInstructor[];
    session_id?: string;
    session_name?: string;
    /** Count of ACTIVE student enrollments for this package_session. */
    enrolled_student_count?: number | null;
}

/** Courses per page on the All / Authored courses tabs. */
const COURSES_PAGE_SIZE = 20;

export interface AllCoursesApiResponse {
    totalPages: number;
    totalElements: number;
    pageable: unknown;
    numberOfElements: number;
    size: number;
    content: CourseItem[];
    number: number;
    sort: unknown;
    first: boolean;
    last: boolean;
    empty: boolean;
}

interface CourseMaterialProps {
    initialSelectedTab?: 'AuthoredCourses' | 'AllCourses' | 'CourseInReview' | 'CourseApproval';
    initialAction?: string;
}

export const CourseMaterial = ({ initialSelectedTab, initialAction }: CourseMaterialProps = {}) => {
    const { t } = useTranslation('courseMaterial');
    const [isAddCourseOpen, setIsAddCourseOpen] = useState(false);

    // Sync initialAction with dialog state
    useEffect(() => {
        if (initialAction === 'create') {
            setIsAddCourseOpen(true);
        }
    }, [initialAction]);

    const handleAddCourseOpenChange = (open: boolean) => {
        setIsAddCourseOpen(open);
        if (!open && initialAction === 'create') {
            navigate({
                to: '/study-library/courses',
                search: (prev: any) => ({ ...prev, action: undefined }),
                replace: true,
            });
        }
    };
    const deleteCourseMutation = useDeleteCourse();
    const { permissions } = useCourseSettings();
    const { instituteDetails } = useInstituteDetailsStore();
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const navigate = useNavigate();
    const [roles, setRoles] = useState<string[] | undefined>([]);
    const [allCoursesData, setAllCoursesData] = useState<AllCoursesApiResponse | null>(null);
    const [authoredCoursesData, setAuthoredCoursesData] = useState<AllCoursesApiResponse | null>(
        null
    );

    // Browsing state (page / filters / search / sort) is kept in a module-level
    // store instead of component state: opening a course unmounts this component,
    // so `useState` used to reset the applied filters and drop the user back on
    // page 1 when they navigated back. See course-list-state-store.ts.
    const page = useCourseListStateStore((s) => s.page);
    const setPage = useCourseListStateStore((s) => s.setPage);
    const [loading, setLoading] = useState({
        allCourses: true,
        authoredCourses: true,
    });
    const [deletingCourseId, setDeletingCourseId] = useState<string | null>(null);
    const [instructorProfilePicUrls, setInstructorProfilePicUrls] = useState<
        Record<string, string>
    >({});
    const [isLoadingImages, setIsLoadingImages] = useState(false);

    // Image cache hook
    const imageCache = useImageCache();

    // Use faculty creators API instead of old user roles API
    const {
        data: facultyCreators,
        isLoading: isFacultyLoading,
        error: facultyError,
    } = useFacultyCreatorsList(instituteDetails?.id || '', Boolean(instituteDetails?.id));

    // Determine if we should use fallback API
    const shouldUseFallback =
        facultyCreators && Array.isArray(facultyCreators) && facultyCreators.length === 0;

    // Fallback to old API only when faculty creators is empty
    // const { data: fallbackUsers } = useQuery({
    //     queryKey: ['fallbackUsers', instituteDetails?.id],
    //     queryFn: () => handleGetInstituteUsersForAccessControl(instituteDetails?.id, {
    //         roles: [
    //             { id: '1', name: 'ADMIN' },
    //             { id: '5', name: 'TEACHER' },
    //         ],
    //         status: [{ id: '1', name: 'ACTIVE' }],
    //     }),
    //     enabled: Boolean(shouldUseFallback && instituteDetails?.id),
    // });

    // Use faculty creators or fallback data
    const accessControlUsers = facultyCreators || [];
    const isUsersLoading = isFacultyLoading;

    // Debug logging
    console.log('Faculty Creators Debug:', {
        facultyCreators,
        facultyCreatorsLength: facultyCreators?.length,
        isFacultyLoading,
        facultyError,
        shouldUseFallback,
        instituteId: instituteDetails?.id,
        accessControlUsers: accessControlUsers?.length > 0 ? accessControlUsers : 'not loaded',
    });

    const { setNavHeading } = useNavHeadingStore();
    const [selectedTab, setSelectedTab] = useState<
        'AuthoredCourses' | 'AllCourses' | 'CourseInReview' | 'CourseApproval'
    >(initialSelectedTab || 'AuthoredCourses');

    // Role Display Settings (course list tabs)
    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(null);
    useEffect(() => {
        const roleKey = getActiveRoleDisplaySettingsKey();
        // Seed from cache for an instant first paint...
        const cached = getDisplaySettingsFromCache(roleKey);
        if (cached) {
            setRoleDisplay(cached);
        }
        // ...but always force-refresh on mount so admin policy changes (e.g.
        // showCreateCourse / showCreateCourseWithAI) take effect on the next page
        // load instead of being masked by the 24h localStorage cache. Mirrors the
        // course-details page, which force-refreshes for the same reason.
        getDisplaySettings(roleKey, true)
            .then(setRoleDisplay)
            .catch(() => {
                if (!cached) setRoleDisplay(null);
            });
    }, [roles]);

    const authoredSearchValue = useCourseListStateStore((s) => s.authoredSearchValue);
    const setAuthoredSearchValue = useCourseListStateStore((s) => s.setAuthoredSearchValue);
    const selectedFilters = useCourseListStateStore((s) => s.filters);
    const setSelectedFilters = useCourseListStateStore((s) => s.setFilters);
    const sortBy = useCourseListStateStore((s) => s.sortBy);
    const setSortBy = useCourseListStateStore((s) => s.setSortBy);
    const searchValue = useCourseListStateStore((s) => s.searchValue);
    const setSearchValue = useCourseListStateStore((s) => s.setSearchValue);
    const clearAllCoursesFilters = useCourseListStateStore((s) => s.clearAllCoursesFilters);
    const resetCourseListState = useCourseListStateStore((s) => s.resetCourseListState);

    // Handle tab change with URL sync
    const handleTabChange = (
        newTab: 'AuthoredCourses' | 'AllCourses' | 'CourseInReview' | 'CourseApproval'
    ) => {
        if (newTab === selectedTab) return;
        setSelectedTab(newTab);
        // Deliberately switching tabs is the one navigation that starts a fresh
        // browse: drop filters, search and page for every tab. Coming back from a
        // course keeps them (the store outlives this component).
        resetCourseListState();
        // Update URL with new tab
        navigate({
            to: '/study-library/courses',
            search: { selectedTab: newTab },
            replace: true, // Replace current history entry instead of adding new one
        });
    };

    // Removed getAllCoursesMutation - now using React Query directly

    // useIntroJsTour({
    //     key: StudyLibraryIntroKey.createCourseStep,
    //     steps: studyLibrarySteps.createCourseStep,
    //     partial: true,
    // });

    const levels = useMemo(() => {
        return (
            instituteDetails?.levels
                ?.map((level: LevelType) => ({
                    id: level.id,
                    name: level.level_name,
                }))
                // Natural sort so levels read as Class 6, 7, 8 … then
                // non-numeric names, instead of the store's arbitrary order.
                .sort(compareByNameNatural) || []
        );
    }, [instituteDetails]);

    const tags = useMemo(() => {
        return instituteDetails?.tags || [];
    }, [instituteDetails]);

    const handlePageChange = (newPage: number = 0) => {
        setPage(newPage);
        // React Query will automatically refetch when page changes
    };

    const handleLevelChange = (levelId: string) => {
        setSelectedFilters((prev) => {
            const level_ids = prev.level_ids ?? [];
            const alreadySelected = level_ids.includes(levelId);
            return {
                ...prev,
                level_ids: alreadySelected
                    ? level_ids.filter((id) => id !== levelId)
                    : [...level_ids, levelId],
            };
        });
    };

    const handleSessionChange = (sessionId: string) => {
        setSelectedFilters((prev) => {
            const session_ids = prev.session_ids ?? [];
            const alreadySelected = session_ids.includes(sessionId);
            return {
                ...prev,
                session_ids: alreadySelected
                    ? session_ids.filter((id) => id !== sessionId)
                    : [...session_ids, sessionId],
            };
        });
    };

    const handleTagChange = (tagValue: string) => {
        setSelectedFilters((prev) => {
            const tag = prev.tag ?? [];
            const alreadySelected = tag.includes(tagValue);
            return {
                ...prev,
                tag: alreadySelected ? tag.filter((t) => t !== tagValue) : [...tag, tagValue],
            };
        });
    };

    const handleUserChange = (userId: string) => {
        setSelectedFilters((prev) => {
            const faculty_ids = prev.faculty_ids ?? [];
            const alreadySelected = faculty_ids.includes(userId);
            return {
                ...prev,
                faculty_ids: alreadySelected
                    ? faculty_ids.filter((id) => id !== userId)
                    : [...faculty_ids, userId],
            };
        });
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e?.target?.value ?? '';
        setSearchValue(value);
        // Do NOT update selectedFilters here to avoid triggering API on every keystroke
    };

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if ((e?.key ?? '') === 'Enter') {
            // Only update selectedFilters (which triggers API) when Enter is pressed
            setSelectedFilters((prev) => ({ ...prev, search_by_name: searchValue }));
        }
    };

    // Only the explicit "Clear" button wipes the filters (and with them the
    // search box and the page index) — nothing else resets them implicitly.
    const handleClearAll = () => {
        clearAllCoursesFilters();
    };

    const handleApply = () => {
        // No need to manually fetch, just update filters
        setSelectedFilters((prev) => ({ ...prev }));
    };

    const handleCourseDelete = (courseId: string) => {
        if (deleteCourseMutation && toast) {
            setDeletingCourseId(courseId);
            deleteCourseMutation.mutate(courseId, {
                onSuccess: () => {
                    toast.success(t('deletedSuccess'));
                    handlePageChange(page);
                    setDeletingCourseId(null);
                },
                onError: (error: unknown) => {
                    const errMsg =
                        error && typeof error === 'object' && 'message' in error
                            ? (error as { message?: string }).message
                            : undefined;
                    toast.error(errMsg || t('deleteFailed'));
                    setDeletingCourseId(null);
                },
            });
        }
    };

    useEffect(() => {
        setNavHeading(t('exploreTerm', { term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) }));
    }, []);

    // Update sort_columns in selectedFilters when sortBy changes and call handleGetCourses after update
    useEffect(() => {
        setSelectedFilters((prev) => {
            const newSortColumns =
                sortBy === 'newest'
                    ? { created_at: 'ASC' as const }
                    : { created_at: 'DESC' as const };
            if (JSON.stringify(prev.sort_columns) !== JSON.stringify(newSortColumns)) {
                return { ...prev, sort_columns: newSortColumns };
            }
            return prev;
        });
    }, [sortBy]);

    // Apply default course session filter from course settings permissions
    useEffect(() => {
        const defaultFilter = permissions?.courseFilterType;
        if (defaultFilter === 'PARENTS_ONLY' || defaultFilter === 'CHILDREN_ONLY') {
            setSelectedFilters((prev) => {
                if (prev.package_session_filter === defaultFilter) {
                    return prev;
                }
                return {
                    ...prev,
                    package_session_filter: defaultFilter,
                };
            });
        } else {
            // No default filter configured – remove any previously applied default
            setSelectedFilters((prev) => {
                if (!prev.package_session_filter) {
                    return prev;
                }
                return {
                    ...prev,
                    package_session_filter: null,
                };
            });
        }
    }, [permissions?.courseFilterType]);

    useEffect(() => {
        if (tokenData && tokenData.authorities && instituteDetails?.id) {
            setRoles(tokenData.authorities[instituteDetails.id]?.roles ?? []);
        } else {
            setRoles([]);
        }
    }, [instituteDetails?.id]);

    // Faculty Access Control - Check permission and fetch access details
    useEffect(() => {
        const initializeFacultyAccess = async () => {
            if (!instituteDetails?.id || !tokenData?.user) {
                return;
            }

            // Check if user has faculty assigned permission
            const hasFacultyPermission = hasFacultyAssignedPermission(instituteDetails.id);
            if (!hasFacultyPermission) {
                return;
            }

            try {
                // Fetch user access details
                const accessDetails = await fetchUserAccessDetails(
                    tokenData.user,
                    instituteDetails.id
                );

                // Process access mappings to extract sub-org data
                const processed = processAccessMappings(accessDetails.accessMappings);

                // Save to localStorage
                saveFacultyAccessData({
                    subOrgs: processed.subOrgs,
                    selectedSubOrgId: processed.subOrgs?.[0]?.subOrgId || null,
                    globalPackageIds: processed.globalPackageIds,
                    globalPackageSessionIds: processed.globalPackageSessionIds,
                    permissions: processed.permissions,
                });

                // Apply filters if we have access data
                const filters = getAccessiblePackageFilters();
                if (filters) {
                    setSelectedFilters((prev) => ({
                        ...prev,
                        package_ids: filters.package_ids,
                        package_session_ids: filters.package_session_ids,
                    }));
                }
            } catch (error) {
                console.error('Error initializing faculty access:', error);
            }
        };

        initializeFacultyAccess();
    }, [instituteDetails?.id, tokenData?.user]);

    const [courseImageUrls, setCourseImageUrls] = useState<Record<string, string>>({});

    // Role helpers
    const isAdmin = useMemo(() => {
        const safeRoles = Array.isArray(roles) ? roles : [];
        return safeRoles.includes('ADMIN');
    }, [roles]);
    const isTeacherNonAdmin = useMemo(() => {
        const safeRoles = Array.isArray(roles) ? roles : [];
        return safeRoles.includes('TEACHER') && !isAdmin;
    }, [roles, isAdmin]);

    const filtersKey = useMemo(() => {
        return {
            status: selectedFilters.status,
            level_ids: selectedFilters.level_ids,
            tag: selectedFilters.tag,
            faculty_ids: selectedFilters.faculty_ids,
            search_by_name: selectedFilters.search_by_name,
            min_percentage_completed: selectedFilters.min_percentage_completed,
            max_percentage_completed: selectedFilters.max_percentage_completed,
            sort_columns: selectedFilters.sort_columns,
            package_ids: selectedFilters.package_ids,
            package_session_ids: selectedFilters.package_session_ids,
            package_session_filter: selectedFilters.package_session_filter,
            session_ids: selectedFilters.session_ids,
            package_view: selectedFilters.package_view,
        };
    }, [selectedFilters]);

    // Only fetch data for the active tab to prevent unnecessary API calls
    const { data: fetchedAllCoursesData, isLoading: isLoadingAllCourses } = useQuery({
        queryKey: ['allCourses', instituteDetails?.id, page, filtersKey],
        queryFn: () => getAllCoursesWithFilters(page, COURSES_PAGE_SIZE, instituteDetails?.id, filtersKey),
        enabled: !!instituteDetails?.id && selectedTab === 'AllCourses',
        staleTime: 30000, // Data is fresh for 30 seconds
        gcTime: 300000, // Cache for 5 minutes
    });

    const { data: fetchedAuthoredCoursesData, isLoading: isLoadingAuthoredCourses } = useQuery({
        queryKey: ['authoredCourses', instituteDetails?.id, page, filtersKey, tokenData?.user],
        queryFn: () => {
            const authoredFilters = {
                ...filtersKey,
                faculty_ids: tokenData?.user ? [tokenData.user] : [],
            };
            return getAllCoursesWithFilters(page, COURSES_PAGE_SIZE, instituteDetails?.id, authoredFilters);
        },
        enabled: !!instituteDetails?.id && !!tokenData?.user && selectedTab === 'AuthoredCourses',
        staleTime: 30000,
        gcTime: 300000,
    });

    // Update local state when React Query data changes
    useEffect(() => {
        if (fetchedAllCoursesData) {
            setAllCoursesData(fetchedAllCoursesData);
            setLoading((l) => ({ ...l, allCourses: false }));
        }
    }, [fetchedAllCoursesData]);

    // The page index is intentionally kept when filters/search change, but a
    // narrower result set can leave it past the last page — which renders an
    // empty grid instead of the matches. Snap back to the last real page only
    // in that out-of-range case.
    useEffect(() => {
        const totalPages = fetchedAllCoursesData?.totalPages ?? 0;
        if (selectedTab === 'AllCourses' && totalPages > 0 && page >= totalPages) {
            setPage(totalPages - 1);
        }
    }, [fetchedAllCoursesData, page, selectedTab, setPage]);

    useEffect(() => {
        if (fetchedAuthoredCoursesData) {
            setAuthoredCoursesData(fetchedAuthoredCoursesData);
            setLoading((l) => ({ ...l, authoredCourses: false }));
        }
    }, [fetchedAuthoredCoursesData]);

    // Update loading states - only consider active tab
    useEffect(() => {
        setLoading({
            allCourses: selectedTab === 'AllCourses' ? isLoadingAllCourses : false,
            authoredCourses: selectedTab === 'AuthoredCourses' ? isLoadingAuthoredCourses : false,
        });
    }, [isLoadingAllCourses, isLoadingAuthoredCourses, selectedTab]);

    // Helper to get available tabs
    const availableTabs = useMemo(() => {
        const labelFor = (id: CourseListTabId): string => {
            switch (id) {
                case 'AuthoredCourses':
                    return t('tabs.authoredTerm', { term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) });
                case 'AllCourses':
                    return t('tabs.allTerm', { term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) });
                case 'CourseInReview':
                    return t('tabs.termInReview', { term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) });
                case 'CourseApproval':
                    return t('tabs.termApproval', { term: getTerminology(ContentTerms.Course, SystemTerms.Course) });
                default:
                    return String(id);
            }
        };

        // "Courses In Review" only makes sense when the role's drafts go
        // through admin approval. When the admin turns that off for the role
        // the teacher publishes directly and the tab would never populate,
        // so hide it.
        // Decided only once settings are loaded — deciding on the null
        // first paint would bounce a deep link to ?selectedTab=CourseInReview
        // before the (possibly on) toggle arrives.
        const safeRoles = Array.isArray(roles) ? roles : [];
        const isAdmin = safeRoles.includes('ADMIN');
        const hideInReviewTab =
            !isAdmin && !!roleDisplay && roleDisplay.coursePage?.requireCourseApproval === false;
        // Role guard on top of the saved visibility. The Course Approval
        // dashboard is admin-only and Courses In Review is for non-admins;
        // the Settings page shows the other role's tab as locked-off, but an
        // older save / copy-to-roles can still leave `visible: true` in the
        // stored blob (Oui Académie teacher settings, 2026-09-20), so the
        // stored flag alone must never surface the wrong role's tab.
        const isTabAllowedForRole = (id: string) => {
            if (id === 'CourseApproval') return isAdmin;
            if (id === 'CourseInReview') return !isAdmin && !hideInReviewTab;
            return true;
        };

        if (roleDisplay?.courseList?.tabs && roleDisplay.courseList.tabs.length > 0) {
            return roleDisplay.courseList.tabs
                .filter((t) => t.visible !== false)
                .filter((t) => isTabAllowedForRole(t.id))
                .sort((a, b) => (a.order || 0) - (b.order || 0))
                .map((t) => ({ key: t.id, label: labelFor(t.id as CourseListTabId), show: true }));
        }

        // Fallback to original role-based defaults
        const tabs: { key: string; label: string; show: boolean }[] = [
            {
                key: 'AuthoredCourses',
                label: t('tabs.authoredTerm', { term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) }),
                show: true,
            },
            {
                key: 'AllCourses',
                label: t('tabs.allTerm', { term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) }),
                show: true,
            },
            {
                key: 'CourseInReview',
                label: t('tabs.termInReview', { term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) }),
                show: isTabAllowedForRole('CourseInReview'),
            },
            {
                key: 'CourseApproval',
                label: t('tabs.termApproval', { term: getTerminology(ContentTerms.Course, SystemTerms.Course) }),
                show: isTabAllowedForRole('CourseApproval'),
            },
        ];
        return tabs.filter((t) => t.show);
    }, [roles, roleDisplay?.courseList, roleDisplay?.coursePage?.requireCourseApproval, instituteDetails?.id, t]);

    // Apply default tab from role settings when appropriate
    useEffect(() => {
        const visibleKeys = new Set(availableTabs.map((t) => t.key));
        // Ensure current tab is valid
        if (!visibleKeys.has(selectedTab) && availableTabs.length > 0) {
            // Prefer role-defined default if present and visible
            type CourseListTabKey =
                | 'AuthoredCourses'
                | 'AllCourses'
                | 'CourseInReview'
                | 'CourseApproval';
            const defaultKey = roleDisplay?.courseList?.defaultTab as CourseListTabKey | undefined;
            const fallbackKey = availableTabs[0]?.key as CourseListTabKey;
            const next: CourseListTabKey =
                defaultKey && visibleKeys.has(defaultKey) ? defaultKey : fallbackKey;
            setSelectedTab(next);
        }
    }, [availableTabs, selectedTab, roleDisplay?.courseList?.defaultTab]);

    // Use correct data for CourseListPage
    const getCurrentTabData = () => {
        if (selectedTab === 'AllCourses') return allCoursesData;
        if (selectedTab === 'AuthoredCourses') return authoredCoursesData;
        return null;
    };

    // Fetch public URLs for course images and instructor profile pictures when current tab data changes
    useEffect(() => {
        const fetchImages = async () => {
            setIsLoadingImages(true);
            try {
                const data = getCurrentTabData();
                const contentArr: CourseItem[] = Array.isArray(data?.content)
                    ? data?.content?.filter((course): course is CourseItem => !!course) ?? []
                    : [];

                // Prepare course images for caching
                const courseImages = contentArr
                    .filter((course) => course.course_preview_image_media_id)
                    .map((course) => ({
                        id: course.id,
                        fileId: course.course_preview_image_media_id,
                    }));

                // Prepare instructor images for caching
                const instructorImages: Array<{ id: string; fileId: string }> = [];
                contentArr.forEach((course) => {
                    course.instructors?.forEach((instructor) => {
                        if (instructor.profile_pic_file_id && instructor.id) {
                            instructorImages.push({
                                id: instructor.id,
                                fileId: instructor.profile_pic_file_id,
                            });
                        }
                    });
                });

                // Fetch all images with caching
                const [courseResults, instructorResults] = await Promise.all([
                    fetchMultipleImagesWithCache(courseImages, imageCache),
                    fetchMultipleImagesWithCache(instructorImages, imageCache),
                ]);

                // Build course image URL map
                const courseUrlMap: Record<string, string> = {};
                courseResults.forEach(({ id, url }) => {
                    if (id) courseUrlMap[id] = url || '';
                });

                // Build instructor profile URL map
                const instructorUrlMap: Record<string, string> = {};
                instructorResults.forEach(({ id, url }) => {
                    if (id) instructorUrlMap[id] = url || '';
                });

                setCourseImageUrls(courseUrlMap);
                setInstructorProfilePicUrls(instructorUrlMap);
            } catch (error) {
                console.error('Error fetching images:', error);
            } finally {
                setIsLoadingImages(false);
            }
        };
        fetchImages();
    }, [allCoursesData, authoredCoursesData, selectedTab]);

    if (isUsersLoading || loading.allCourses || loading.authoredCourses || !instituteDetails?.id) {
        return <DashboardLoader />;
    }

    const isFacultyUser = hasFacultyAssignedPermission(instituteDetails?.id);
    // Anyone with FSPSSM rows (sub-org admins included) is gated by their
    // access_permission CSV — NOT just users carrying the HAS_FACULTY_ASSIGNED JWT
    // flag. Sub-org admins typically don't get HAS_FACULTY_ASSIGNED, so relying on
    // `isFacultyUser` alone leaked the Create Course button to every sub-org admin
    // regardless of their stored permission set.
    const facultyAccessData = getFacultyAccessData();
    const hasAnyFacultyMapping = !!facultyAccessData && (
        (facultyAccessData.subOrgs?.length ?? 0) > 0
        || (facultyAccessData.permissions?.length ?? 0) > 0
        || (facultyAccessData.globalPackageIds?.length ?? 0) > 0
        || (facultyAccessData.globalPackageSessionIds?.length ?? 0) > 0
    );
    const isPermissionGated = isFacultyUser || hasAnyFacultyMapping;
    // Create-course is allowed when:
    //   - the caller is a pure institute admin (no FSPSSM at all → not gated), OR
    //   - the gated caller has the explicit CREATE_COURSE permission.
    // NOTE: FULL is deliberately NOT a shortcut. The institute admin must pick
    // CREATE_COURSE explicitly at sub-org creation (or via the Edit Sub-Org modal)
    // for a sub-org admin to see this button.
    const canCreateCourse =
        !isPermissionGated
        || hasFacultyPermission('CREATE_COURSE');
    // Per-role override (Display Settings → Course Creation → "Allow creating
    // courses"). It is AUTHORITATIVE when set: `true` always shows the button,
    // `false` always hides it (even for admins / CREATE_COURSE holders). Only
    // when the role never configured it (undefined) do we fall back to the
    // default permission gating above.
    const createCourseOverride = roleDisplay?.courseCreation?.showCreateCourse;
    const canShowCreateCourse =
        typeof createCourseOverride === 'boolean' ? createCourseOverride : canCreateCourse;

    if (availableTabs.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center py-20">
                <div className="mb-2 text-2xl font-semibold">
                    {t('noTermFound', { term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) })}
                </div>
                <div className="mb-4 text-gray-500">
                    {t('tryAddingNewTerm', { term: getTerminology(ContentTerms.Course, SystemTerms.Course) })}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                    <SettingsQuickAccessButton
                        settingsKey={SettingsTabs.Course}
                        label={t('courseSettings')}
                    />
                    {canShowCreateCourse && <AddCourseButton />}
                    {canShowCreateCourse && roleDisplay?.courseCreation?.showCreateCourseWithAI && (
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="secondary"
                            className="font-medium"
                            onClick={() => navigate({ to: '/study-library/ai-copilot' })}
                        >
                            <Sparkles className="h-4 w-4 mr-1" />
                            {t('createTermWithAI', { term: getTerminology(ContentTerms.Course, SystemTerms.Course) })}
                        </MyButton>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex w-full flex-col gap-2 text-neutral-600">
            {/* Header section - responsive layout */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                    <div className="sm:text-h5 text-lg font-semibold">
                        {t('exploreTerm', { term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course) })}
                    </div>
                    <div className="text-xs text-neutral-500 sm:text-sm">
                        {t('exploreSubtitle')}
                    </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                    <SettingsQuickAccessButton
                        settingsKey={SettingsTabs.Course}
                        label={t('courseSettings')}
                    />
                    {canShowCreateCourse && <AddCourseButton />}
                    {canShowCreateCourse && roleDisplay?.courseCreation?.showCreateCourseWithAI && (
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="secondary"
                            className="font-medium"
                            onClick={() => navigate({ to: '/study-library/ai-copilot' })}
                        >
                            <Sparkles className="h-4 w-4 mr-1" />
                            {t('createTermWithAI', { term: getTerminology(ContentTerms.Course, SystemTerms.Course) })}
                        </MyButton>
                    )}
                </div>
            </div>

            {/* Add Tabs Section Here */}
            <Tabs
                value={selectedTab}
                onValueChange={(value) =>
                    handleTabChange(
                        value as
                        | 'AuthoredCourses'
                        | 'AllCourses'
                        | 'CourseInReview'
                        | 'CourseApproval'
                    )
                }
            >
                {/* Scrollable tabs for mobile */}
                <TabsList className="no-scrollbar -mx-4 inline-flex h-auto w-[calc(100%+2rem)] justify-start gap-2 overflow-x-auto rounded-none border-b !bg-transparent px-4 py-0 sm:mx-0 sm:w-full sm:gap-4 sm:px-0">
                    {availableTabs.map((tab) => (
                        <TabsTrigger
                            key={tab.key}
                            value={tab.key}
                            className={`-mb-px shrink-0 whitespace-nowrap rounded-none border-b-2 p-2 text-xs font-semibold !shadow-none sm:px-0 sm:text-sm
                                ${selectedTab === tab.key ? 'border-primary-500 !text-primary-500' : 'border-transparent text-gray-500'}`}
                        >
                            <span className={selectedTab === tab.key ? 'text-primary-500' : ''}>
                                {tab.label}
                            </span>
                        </TabsTrigger>
                    ))}
                </TabsList>
                {availableTabs.map((tab) => (
                    <TabsContent key={tab.key} value={tab.key}>
                        {(() => {
                            // Handle new tab components
                            if (tab.key === 'AuthoredCourses') {
                                return (
                                    <AuthoredCoursesTab
                                        searchValue={authoredSearchValue}
                                        setSearchValue={setAuthoredSearchValue}
                                    />
                                );
                            }

                            if (tab.key === 'CourseInReview') {
                                return <CourseInReviewTab />;
                            }

                            if (tab.key === 'CourseApproval') {
                                return <AdminApprovalDashboard />;
                            }

                            // Handle existing All Courses tab
                            const data = tab.key === 'AllCourses' ? allCoursesData : null;

                            // Check if any filters are applied
                            const hasActiveFilters =
                                selectedFilters.level_ids.length > 0 ||
                                selectedFilters.session_ids.length > 0 ||
                                selectedFilters.tag.length > 0 ||
                                selectedFilters.faculty_ids.length > 0 ||
                                selectedFilters.search_by_name ||
                                selectedFilters.min_percentage_completed > 0 ||
                                selectedFilters.max_percentage_completed > 0;

                            // If no data and no filters applied, show "no courses" message
                            if (!data || !data.content || data.content.length === 0) {
                                if (!hasActiveFilters) {
                                    return (
                                        <div className="flex h-40 flex-col items-center justify-center text-gray-500">
                                            {t('noTermFoundForTab', {
                                                term: getTerminologyPlural(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                ).toLocaleLowerCase(),
                                            })}
                                        </div>
                                    );
                                } else {
                                    // Filters are applied but no data - show filters with "no results" message
                                    return (
                                        <>
                                            <CourseListPage
                                                selectedFilters={selectedFilters}
                                                setSelectedFilters={setSelectedFilters}
                                                handleClearAll={handleClearAll}
                                                handleApply={handleApply}
                                                levels={levels}
                                                handleLevelChange={handleLevelChange}
                                                handleSessionChange={handleSessionChange}
                                                tags={tags}
                                                accessControlUsers={accessControlUsers}
                                                handleUserChange={handleUserChange}
                                                handleTagChange={handleTagChange}
                                                searchValue={searchValue}
                                                setSearchValue={setSearchValue}
                                                handleSearchChange={handleSearchChange}
                                                handleSearchKeyDown={handleSearchKeyDown}
                                                sortBy={sortBy}
                                                setSortBy={setSortBy}
                                                allCourses={data}
                                                courseImageUrls={courseImageUrls}
                                                instructorProfilePicUrls={instructorProfilePicUrls}
                                                isLoadingImages={isLoadingImages}
                                                handleCourseDelete={handleCourseDelete}
                                                page={page}
                                                handlePageChange={handlePageChange}
                                                deletingCourseId={deletingCourseId}
                                                showDeleteButton={!isTeacherNonAdmin}
                                                hideFilters={isFacultyUser}
                                                showEnrolledStudentCount={
                                                    roleDisplay?.courseListCard
                                                        ?.showEnrolledStudentCount === true
                                                }
                                            />
                                            <div className="mt-4 flex h-20 flex-col items-center justify-center text-gray-500">
                                                {t('noTermFoundForFilters', {
                                                    term: getTerminologyPlural(
                                                        ContentTerms.Course,
                                                        SystemTerms.Course
                                                    ).toLocaleLowerCase(),
                                                })}
                                            </div>
                                        </>
                                    );
                                }
                            }
                            return (
                                <CourseListPage
                                    selectedFilters={selectedFilters}
                                    setSelectedFilters={setSelectedFilters}
                                    handleClearAll={handleClearAll}
                                    handleApply={handleApply}
                                    levels={levels}
                                    handleLevelChange={handleLevelChange}
                                    handleSessionChange={handleSessionChange}
                                    tags={tags}
                                    accessControlUsers={accessControlUsers}
                                    handleUserChange={handleUserChange}
                                    handleTagChange={handleTagChange}
                                    searchValue={searchValue}
                                    setSearchValue={setSearchValue}
                                    handleSearchChange={handleSearchChange}
                                    handleSearchKeyDown={handleSearchKeyDown}
                                    sortBy={sortBy}
                                    setSortBy={setSortBy}
                                    allCourses={data}
                                    courseImageUrls={courseImageUrls}
                                    instructorProfilePicUrls={instructorProfilePicUrls}
                                    isLoadingImages={isLoadingImages}
                                    handleCourseDelete={handleCourseDelete}
                                    page={page}
                                    handlePageChange={handlePageChange}
                                    deletingCourseId={deletingCourseId}
                                    showDeleteButton={!isTeacherNonAdmin}
                                    hideFilters={isFacultyUser}
                                    showEnrolledStudentCount={
                                        roleDisplay?.courseListCard?.showEnrolledStudentCount ===
                                        true
                                    }
                                />
                            );
                        })()}
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
};
