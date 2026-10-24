import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
// class-study-material.tsx
import { useRouter, useSearch } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SubjectType, useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useStudyLibraryContext } from '@/providers/study-library/init-study-library-provider';
import { getCourseSubjects } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getSubjects';
import { useGetPackageSessionId } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getPackageSessionId';
import { useGetPackageSessionIdFromCourseInit } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getPackageSessionIdFromCourseInit';
// import useIntroJsTour from '@/hooks/use-intro';
// import { StudyLibraryIntroKey } from '@/constants/storage/introKey';
// import { studyLibrarySteps } from '@/constants/intro/steps';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EngagementTab } from './engagement/EngagementTab';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY, CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    type CourseDetailsTabId,
    type DisplaySettingsData,
} from '@/types/display-settings';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { DropdownItemType } from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import {
    CaretDown,
    CaretRight,
    Plus,
    Folder,
    FileText,
    PresentationChart,
    Trash,
    ArrowsOut,
    ArrowsIn,
    PencilSimple,
    DotsThree,
    DotsSixVertical,
    Copy,
} from 'phosphor-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getCourseSettings, saveCourseSettings } from '@/services/course-settings';
import { MyButton } from '@/components/design-system/button';
import AddTeachers from '@/routes/dashboard/-components/AddTeachers';
import { AddSubjectButton } from '../subjects/-components/add-subject.tsx/add-subject-button';
import { useAddSubject } from '../subjects/-services/addSubject';
import { useUpdateSubject } from '../subjects/-services/updateSubject';
import { useDeleteSubject } from '../subjects/-services/deleteSubject';
import { useUpdateSubjectOrder } from '../subjects/-services/updateSubjectOrder';
import { useUpdateModule } from '../subjects/modules/-services/update-module';
import { useUpdateChapter } from '../subjects/modules/chapters/-services/update-chapter';
import { Chapter } from '@/stores/study-library/use-modules-with-chapters-store';
import { ChapterWithSlides as ChapterWithSlidesStore } from '@/stores/study-library/use-modules-with-chapters-store';
import { ChapterWithSlides } from '../../-services/getAllSlides';
import {
    TabType,
    buildTabs,
    DEFAULT_HIDDEN_COURSE_DETAILS_TABS,
} from '../subjects/-constants/constant';
import { useDeleteModule } from '../subjects/modules/-services/delete-module';
import { useDeleteChapter } from '../subjects/modules/chapters/-services/delete-chapter';
import { useUpdateModuleOrder } from '../subjects/modules/-services/update-modules-order';
import { useUpdateChapterOrder } from '../subjects/modules/chapters/-services/update-chapter-order';
import { fetchModulesWithChapters } from '../../-services/getModulesWithChapters';
import { Sortable, SortableItem, SortableDragHandle } from '@/components/ui/sortable';
import { rectSortingStrategy } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import {
    UseSlidesFromModulesInput,
    fetchChaptersWithSlides,
    Slide,
    fetchDirectSlides,
} from '../../-services/getAllSlides';
import { useAddModule } from '../subjects/modules/-services/add-module';
import { AddModulesButton } from '../subjects/modules/-components/add-modules.tsx/add-modules-button';
import { AddChapterButton } from '../subjects/modules/chapters/-components/chapter-material/add-chapters/add-chapter-button';
import Students from '../subjects/-components/student-list';
import Assessments from '../subjects/-components/assessment-list';
import LiveSessions from '../subjects/-components/live-sessions-list';
import BatchReports from '@/routes/study-library/reports/-components/batch/batchReports';
import { CertificatesTab } from './certificates/CertificatesTab';
import { getIcon } from '../subjects/modules/chapters/slides/-components/slides-sidebar/slides-sidebar-slides';
import { useContentStore } from '../subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { TeachersList } from '../subjects/-components/teacher-list';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useFileUpload } from '@/hooks/use-file-upload';
import { convertCapitalToTitleCase } from '@/lib/utils';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import { TokenKey, Authority } from '@/constants/auth/tokens';
import { hasFacultyAssignedPermission } from '@/lib/auth/facultyAccessUtils';
import { useCourseSettings } from '@/hooks/useCourseSettings';
import { ContentDripConditionDialog } from './ContentDripConditionDialog';
import { DripScheduleDialog } from './DripScheduleDialog';
import type {
    DripCondition,
    DripConditionContentLevel,
    DripScheduleDefaults,
} from '@/types/course-settings';
import { DEFAULT_DRIP_SCHEDULE } from '@/types/course-settings';
import { OfflineAvailabilityDialog } from './OfflineAvailabilityDialog';
import type { OfflineSourceType } from '@/types/offline-access';
import { OfflineTelemetryCard } from './OfflineTelemetryCard';
import { WifiSlash, LockSimple, CalendarBlank } from '@phosphor-icons/react';
import { AddSubjectForm } from '../subjects/-components/add-subject.tsx/add-subject-form';
import { AddModulesForm } from '../subjects/modules/-components/add-modules.tsx/add-modules-form';
import { AddChapterForm } from '../subjects/modules/chapters/-components/chapter-material/add-chapters/add-chapter-form';
import { getAuthoredChapterDescription } from '@/constants/study-library/content-description';
import { MyDialog } from '@/components/design-system/dialog';
import Planning from '../subjects/-components/planning';
import Activity from '../subjects/-components/activity';
import PulseTab from './pulse/PulseTab';
import QuizResultsTab from './quiz-results/QuizResultsTab';
import { PackageSettingsPanel } from './package-settings/PackageSettingsPanel';
import { TutorModeTab } from './tutor-mode/TutorModeTab';
import { AiKnowledgeTab } from './ai-knowledge/AiKnowledgeTab';
import {
    CopyContentDialog,
    type CopyContentSelection,
} from '@/components/common/study-library/add-course/add-course-steps/CopyContentDialog';
import { useCopyCourseContent } from '@/services/study-library/course-operations/copy-course-content';
import { handleGetSlideCountDetails } from '../-services/get-slides-count';
import { CopyContentLineageBadge } from './CopyContentLineageBadge';
import { BulkUploadDialogButton } from '@/components/common/study-library/bulk-content-uploading/bulk-upload-dialog-button';
import { BatchChatPanel } from '@/components/chat/BatchChatPanel';
import { getNotificationSettings } from '@/services/notification-settings';
import { useOfflineAccessEnabled } from '@/routes/settings/-hooks/use-offline-access-enabled';
import { useCourseKnowledgeStatus } from '@/services/course-knowledge-settings';

// Map between DisplaySettings ids and UI tab values
const mapDisplayIdToUiValue = (id: CourseDetailsTabId): string => {
    switch (id) {
        case 'LEARNER':
            return 'STUDENT';
        case 'TEACHER':
            return 'TEACHERS';
        default:
            return id;
    }
};

// Chapter Header Actions Component
const ChapterHeaderActions = ({
    submitFn,
    isPending,
}: {
    submitFn: (() => void) | null;
    isPending: boolean;
}) => {
    const { t } = useTranslation('courseStructure');
    return (
        <>
            <MyButton
                buttonType="primary"
                scale="medium"
                layoutVariant="default"
                onClick={() => submitFn?.()}
                disabled={isPending || !submitFn}
                className="min-w-[120px]"
            >
                {isPending
                    ? t('chapterHeader.updating')
                    : t('chapterHeader.saveChanges')}
            </MyButton>
        </>
    );
};

// Interfaces (assuming these are unchanged)
// Chapter interface imported from store
export interface ChapterMetadata {
    chapter: Chapter;
    slides_count: {
        video_count: number;
        pdf_count: number;
        doc_count: number;
        unknown_count: number;
    };
    chapter_in_package_sessions: string[];
}
export interface Module {
    id: string;
    module_name: string;
    status: string;
    description: string;
    thumbnail_id: string;
}
export interface ModuleWithChapters {
    module: Module;
    chapters: ChapterMetadata[];
}
export type SubjectModulesMap = { [subjectId: string]: ModuleWithChapters[] };

// Thumbnail Image Component
const ThumbnailImage = ({
    thumbnailId,
    fallbackIcon,
    fallbackColor,
}: {
    thumbnailId: string | null;
    fallbackIcon: React.ReactNode;
    fallbackColor: string;
}) => {
    const { getPublicUrl } = useFileUpload();
    const { t } = useTranslation('courseStructure');
    const [imageUrl, setImageUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!thumbnailId) {
            setImageUrl('');
            setIsLoading(false);
            return;
        }

        // If a full URL is provided, use it directly
        if (typeof thumbnailId === 'string' && /^(https?:)?\/\//.test(thumbnailId)) {
            setImageUrl(thumbnailId);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        getPublicUrl(thumbnailId)
            .then((url) => {
                setImageUrl(url || '');
            })
            .catch((error) => {
                console.error('Failed to get thumbnail URL:', error);
                setImageUrl('');
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [thumbnailId, getPublicUrl]);

    if (isLoading) {
        return (
            <div
                className={`mb-2 flex aspect-[16/9] items-center justify-center rounded-lg ${fallbackColor}`}
            >
                <div className="size-8 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
            </div>
        );
    }

    if (imageUrl && thumbnailId) {
        return (
            <div className="mb-2 flex aspect-[16/9] items-center justify-center overflow-hidden rounded-lg">
                <img src={imageUrl} alt={t('thumbnailAlt')} className="size-full object-cover" />
            </div>
        );
    }

    return (
        <div
            className={`mb-2 flex aspect-[16/9] items-center justify-center rounded-lg ${fallbackColor}`}
        >
            {fallbackIcon}
        </div>
    );
};

/**
 * Description line on a Content Structure folder card (module / chapter).
 * Renders nothing when the author never entered one.
 */
const FolderDescription = ({ description }: { description?: string | null }) => {
    const text = (description ?? '').trim();

    if (!text) return null;

    return (
        <p className="mt-1 line-clamp-2 break-words text-xs text-gray-600" title={text}>
            {text}
        </p>
    );
};

export const CourseStructureDetails = ({
    selectedSession,
    selectedLevel,
    courseStructure,
    isReadOnly,
    selectedBatchId,
}: {
    selectedSession: string;
    selectedLevel: string;
    courseStructure: number;
    isReadOnly?: boolean;
    /**
     * Selected Batch/Subgroup id (package_session_id). When provided, Outline and
     * Content Structure should load chapters/slides for this batch; otherwise
     * fall back to session+level mapped packageSessionId.
     */
    selectedBatchId?: string;
}) => {
    const router = useRouter();
    const { t } = useTranslation('courseStructure');
    const searchParams = router.state.location.search;
    // Reactive read of the content-structure drill position from the URL.
    // Drilling in pushes these params (creating history entries) and a sync
    // effect below mirrors them into local state, so the back button steps
    // Subject → Module → Chapter instead of jumping straight to the top.
    const navSearch = useSearch({
        from: '/study-library/courses/course-details/',
    }) as { navLevel?: 'modules' | 'chapters'; navSubjectId?: string; navModuleId?: string };
    const goToNavLevel = (
        next: { navLevel?: 'modules' | 'chapters'; navSubjectId?: string; navModuleId?: string },
        opts?: { replace?: boolean }
    ) => {
        router.navigate({
            to: '/study-library/courses/course-details',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            search: (prev: any) => ({
                ...prev,
                navLevel: next.navLevel,
                navSubjectId: next.navSubjectId,
                navModuleId: next.navModuleId,
            }),
            replace: opts?.replace,
        });
    };
    const { getSessionFromPackage, getPackageSessionId, instituteDetails } = useInstituteDetailsStore();
    const { studyLibraryData } = useStudyLibraryStore();
    const { setActiveItem } = useContentStore();
    const { isInitLoading } = useStudyLibraryContext();
    const {
        settings: courseSettings,
        loading: settingsLoading,
        error: settingsError,
    } = useCourseSettings();

    // Check user permissions for editing
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const isAdmin =
        tokenData?.authorities &&
        Object.values(tokenData.authorities).some(
            (auth: Authority) => Array.isArray(auth?.roles) && auth.roles.includes('ADMIN')
        );
    const currentUserId = tokenData?.user;

    // Get course status from study library data
    const courseData = studyLibraryData?.find((item) => item.course.id === searchParams.courseId);
    const courseStatus = courseData?.course?.status;
    const courseCreatedBy = courseData?.course?.createdByUserId;
    const isOwnCourse = courseCreatedBy === currentUserId;

    // Determine if user can edit structure
    // For draft courses, allow editing if:
    // 1. User is admin, OR
    // 2. User is the course creator and course is in DRAFT status, OR
    // 3. If createdByUserId is not available, allow editing for DRAFT status (fallback for authored courses)
    const canEditStructureBase =
        isAdmin ||
        (isOwnCourse && courseStatus === 'DRAFT') ||
        (!courseCreatedBy && courseStatus === 'DRAFT');
    const isPublishedCourse = courseStatus === 'ACTIVE';
    const isInReviewCourse = courseStatus === 'IN_REVIEW';

    const courseId: string = searchParams.courseId || '';
    const readOnly = Boolean(isReadOnly);
    // Role Display Settings (course details tabs)
    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(null);
    // When readOnly + this flag is true, slide/chapter clicks navigate into
    // the read-only NonAdminSlidesView so the user can preview content.
    // Defaults to true so behavior is correct before settings finish loading.
    const allowReadOnlyNavigation =
        roleDisplay?.coursePage?.allowViewSlidesInReadOnly !== false;
    const blockReadOnlyClick = readOnly && !allowReadOnlyNavigation;
    // `canEditAllowed` / `canDeleteAllowed` are the FINAL gates for the Edit
    // (rename) and Delete buttons on Subject / Module / Chapter rows.
    //
    //  Decision rules:
    //   - Admin / DRAFT owner (base permission) → always shown
    //   - Otherwise the action shows only if its explicit Display Settings
    //     toggle is ON:
    //        canEditCourseStructure   — controls Edit / rename
    //        canDeleteCourseStructure — controls Delete
    //
    //  Note: `directEditPublishedCourse` does NOT auto-enable these. The
    //  admin gets independent control over edit vs delete vs the slide-level
    //  direct-edit. The "Editing Restricted" banner / in-place editing of
    //  the course form are still tied to `directEditPublishedCourse` —
    //  these two structure toggles are surgical.
    const canEditAllowed =
        canEditStructureBase ||
        roleDisplay?.coursePage?.canEditCourseStructure === true;
    const canDeleteAllowed =
        canEditStructureBase ||
        roleDisplay?.coursePage?.canDeleteCourseStructure === true;
    // Used by the banner gate, Add buttons, and drag-reorder — these still
    // honour `directEditPublishedCourse` so direct-edit teachers can at least
    // navigate the structure even when the per-row toggles are off.
    const canEditStructure =
        canEditAllowed ||
        canDeleteAllowed ||
        roleDisplay?.coursePage?.directEditPublishedCourse === true;
    // Per-role visibility of the "Add" creation buttons in the Outline &
    // Content Structure tabs. Default (undefined/true) shows them; admin can
    // hide any of them for a role from Display Settings → Course Page. The
    // Add Subject/Module/Chapter buttons also self-gate inside their shared
    // components; these flags additionally hide the wrapping "add card" in the
    // Content Structure grid (and gate the inline Add Slide buttons, which
    // have no shared component).
    const showAddSubject = roleDisplay?.coursePage?.showAddSubject !== false;
    const showAddModule = roleDisplay?.coursePage?.showAddModule !== false;
    const showAddChapter = roleDisplay?.coursePage?.showAddChapter !== false;
    const showAddSlide = roleDisplay?.coursePage?.showAddSlide !== false;
    // Module / chapter descriptions on the Content Structure folder cards.
    // Visible unless Course Settings → Course View & Display turns them off.
    const showContentDescription =
        courseSettings?.courseViewSettings?.showContentDescriptions !== false;
    useEffect(() => {
        try {
            // Use getActiveRoleDisplaySettingsKey which handles ADMIN, TEACHER, and custom roles (faculty)
            const roleKeyInner = getActiveRoleDisplaySettingsKey();
            // Force-refresh on mount so admin policy changes (Course Permission
            // toggles) take effect on the next page load without waiting for
            // the 24h localStorage TTL.
            getDisplaySettings(roleKeyInner, true)
                .then(setRoleDisplay)
                .catch(() => {
                    const cached = getDisplaySettingsFromCache(roleKeyInner);
                    setRoleDisplay(cached ?? null);
                });
        } catch {
            setRoleDisplay(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const levelId: string = selectedLevel || '';

    const [sessionList, setSessionList] = useState<DropdownItemType[]>(
        searchParams.courseId ? getSessionFromPackage({ courseId: courseId, levelId: levelId }) : []
    );
    const initialSession: DropdownItemType | undefined = {
        id: selectedSession || '',
        name: sessionList[0]?.name || '',
    };

    const [currentSession, setCurrentSession] = useState<DropdownItemType | undefined>(
        () => initialSession
    );

    useEffect(() => {
        setSessionList(
            searchParams.courseId
                ? getSessionFromPackage({ courseId: courseId, levelId: searchParams.levelId })
                : []
        );
    }, [searchParams.courseId, searchParams.levelId, getSessionFromPackage]);

    useEffect(() => {
        if (selectedSession) {
            // Find the session name from sessionList based on selectedSession ID
            const foundSession = sessionList.find((session) => session.id === selectedSession);
            setCurrentSession({
                id: selectedSession,
                name: foundSession?.name || '',
            });
        } else {
            // Fallback to first session if no selectedSession
            setCurrentSession({ id: sessionList[0]?.id || '', name: sessionList[0]?.name || '' });
        }
    }, [sessionList, selectedSession]);

    // Use localStorage to persist selected tab across re-renders and page refreshes
    const getStorageKey = () => `course-structure-tab-${courseId}`;

    const [selectedTab, setSelectedTab] = useState<string>(() => {
        // Initialize from localStorage first
        const stored = localStorage.getItem(getStorageKey());
        if (stored) return stored;

        // If settings are still loading or failed, use safe default
        if (settingsLoading || settingsError) {
            return TabType.OUTLINE; // Safe default - always show Outline first when settings fail
        }

        // Use current institute's roles so we load the same display settings as in the effect above
        const roles = getRolesForCurrentInstitute();
        const isAdminRole = roles.includes('ADMIN');
        const hasFaculty = hasFacultyAssignedPermission(getInstituteId());
        const roleKey = getActiveRoleDisplaySettingsKey();
        const fromCache = getDisplaySettingsFromCache(roleKey);
        const defaultDetailsTab = fromCache?.courseDetails?.defaultTab as
            | CourseDetailsTabId
            | undefined;
        if (defaultDetailsTab) return defaultDetailsTab;

        // Fallback: course settings default view
        const defaultViewMode = courseSettings?.courseViewSettings?.defaultViewMode;
        if (defaultViewMode === 'structure') return TabType.CONTENT_STRUCTURE;
        return TabType.OUTLINE;
    });

    // Chat-enabled gate for the Discussion tab. Declared here (rather than next to the
    // tab strip) because the visibility effect below has to know whether Discussion is
    // actually on offer before it can fall back to it.
    const notificationSettingsQuery = useQuery({
        queryKey: ['notification-settings'],
        queryFn: getNotificationSettings,
        refetchOnWindowFocus: false,
    });
    // Chat is OFF by default — only show the Discussion tab when an institute has explicitly enabled it.
    const isChatEnabled = notificationSettingsQuery.data?.settings?.chat?.enabled === true;

    // Everything offline in this view follows the institute OFFLINE_ACCESS_SETTING:
    // the Downloads tab (enabling offline access surfaces it automatically, no
    // Display Settings trip needed; an explicit per-role hide there still wins via
    // the normal role-config filter) and every "Offline Availability" node action.
    // With the master switch off the resolver returns false for every node, so any
    // rule saved here would be dead config — hide the actions rather than let an
    // admin write settings that cannot take effect.
    //
    // Unknown (loading/error) counts as ENABLED so nothing flickers into a
    // locked-off state before the setting has actually loaded.
    const offlineAccessEnabled = useOfflineAccessEnabled();
    const isOfflineAccessDisabled = !offlineAccessEnabled;

    // The AI knowledge tab exists only once the platform has made course knowledge
    // available to the institute. Unknown (loading/error) counts as NOT available,
    // so the tab never flashes in for institutes that do not have the feature.
    const courseKnowledgeStatusQuery = useCourseKnowledgeStatus();
    const isAiKnowledgeAvailable = courseKnowledgeStatusQuery.data?.available === true;
    const isAiKnowledgeSettled = !courseKnowledgeStatusQuery.isLoading;

    // Ensure selected tab is visible per role display settings; otherwise, switch to default/first visible
    useEffect(() => {
        if (!roleDisplay?.courseDetails?.tabs) return;
        const details = roleDisplay.courseDetails;
        const visibilityMap = new Map(
            details.tabs.map((t) => [
                mapDisplayIdToUiValue(t.id as CourseDetailsTabId),
                t.visible !== false,
            ])
        );
        // Offline access off outranks the role config for Downloads (the tab
        // strip filters it out below), so this scan must not pick it — otherwise
        // it and the Downloads effect would flip selectedTab back and forth when
        // a role also has the fallback tab hidden.
        if (isOfflineAccessDisabled) visibilityMap.set(TabType.DOWNLOADS, false);
        // Same for AI knowledge: the tab strip drops it unless the feature is available.
        if (!isAiKnowledgeAvailable) visibilityMap.set(TabType.AI_KNOWLEDGE, false);
        // A hidden-by-default tab absent from the config counts as not visible,
        // so a stale localStorage selection of it redirects to a visible tab.
        const isCurrentVisible = visibilityMap.has(selectedTab)
            ? visibilityMap.get(selectedTab)
            : !DEFAULT_HIDDEN_COURSE_DETAILS_TABS.has(selectedTab);
        if (isCurrentVisible === false) {
            const preferred = mapDisplayIdToUiValue(details.defaultTab as CourseDetailsTabId);
            const preferredVisible = visibilityMap.get(preferred) !== false;
            // Discussion is not part of CourseDetailsTabId, so it is always absent from
            // visibilityMap and therefore reads as "visible" here. It is also the last
            // entry in `tabs`, so it wins this scan whenever a role hides every real tab.
            // Only fall back to it when chat is actually enabled — otherwise the
            // chat-enabled effect below bounces straight off it and the two effects flip
            // selectedTab forever.
            const firstVisible = buildTabs(t).find(
                (t) =>
                    (t.value !== TabType.DISCUSSION || isChatEnabled) &&
                    visibilityMap.get(t.value) !== false
            )?.value;
            const next = preferredVisible ? preferred : firstVisible || TabType.OUTLINE;
            // With every real tab hidden and chat off, `next` lands back on the tab we are
            // already showing. Re-setting it would re-run this effect and spin.
            if (next !== selectedTab) {
                setSelectedTab(next);
                localStorage.setItem(getStorageKey(), next);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roleDisplay, selectedTab, isChatEnabled, isOfflineAccessDisabled, isAiKnowledgeAvailable]);

    // Effect to update tab selection when settings load
    useEffect(() => {
        // Don't override if user has already selected a tab (localStorage exists)
        const stored = localStorage.getItem(getStorageKey());
        if (stored) return;

        // Only set default tab after settings have loaded successfully
        if (!settingsLoading && !settingsError) {
            const defaultViewMode = courseSettings?.courseViewSettings?.defaultViewMode;
            if (defaultViewMode === 'structure') {
                setSelectedTab(TabType.CONTENT_STRUCTURE);
            } else {
                setSelectedTab(TabType.OUTLINE);
            }
        }
    }, [
        settingsLoading,
        settingsError,
        courseSettings?.courseViewSettings?.defaultViewMode,
        courseId,
    ]);

    const handleTabChange = (value: string) => {
        setSelectedTab(value);
        // Save to localStorage
        localStorage.setItem(getStorageKey(), value);
        // Reset navigation when switching to Content Structure tab
        if (value === TabType.CONTENT_STRUCTURE) {
            resetNavigation();
        }
    };

    const [subjectModulesMap, setSubjectModulesMap] = useState<SubjectModulesMap>({});
    const [chapterSlidesMap, setChapterSlidesMap] = useState<{ [chapterId: string]: Slide[] }>({});
    const [directSlides, setDirectSlides] = useState<Slide[]>([]); // For 2-depth courses
    const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set());
    const [openModules, setOpenModules] = useState<Set<string>>(new Set());
    const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        isOpen: boolean;
        type: 'subject' | 'module' | 'chapter' | null;
        item: { id: string; name: string; subjectId?: string; moduleId?: string } | null;
    }>({ isOpen: false, type: null, item: null });

    // Edit dialog states
    const [editDialog, setEditDialog] = useState<{
        isOpen: boolean;
        type: 'subject' | 'module' | 'chapter' | null;
        item: (SubjectType | Module | (Chapter & { subjectId?: string; moduleId?: string; chapter_in_package_sessions?: string[] })) | null;
    }>({ isOpen: false, type: null, item: null });

    // Chapter form state for header button
    const [chapterFormState, setChapterFormState] = useState<{
        submitFn: (() => void) | null;
        isPending: boolean;
    }>({ submitFn: null, isPending: false });

    // Drip (unlock rule) state. One dialog serves subjects, modules and chapters
    // — the rule shape is identical at every level, only the label changes.
    const [contentDripDialog, setContentDripDialog] = useState<{
        open: boolean;
        level: DripConditionContentLevel;
        itemId: string | null;
        itemName: string | null;
    }>({ open: false, level: 'chapter', itemId: null, itemName: null });
    const [dripScheduleOpen, setDripScheduleOpen] = useState(false);
    const [dripConditionsEnabled, setDripConditionsEnabled] = useState(false);
    const [dripEnforcing, setDripEnforcing] = useState(false);
    const [dripConditions, setDripConditions] = useState<DripCondition[]>([]);
    const [dripScheduleDefaults, setDripScheduleDefaults] =
        useState<DripScheduleDefaults>(DEFAULT_DRIP_SCHEDULE);
    const [loadingDripConditions, setLoadingDripConditions] = useState(false);

    // Offline-availability dialog state. Rules resolve down the chain
    // PACKAGE -> PACKAGE_SESSION -> SUBJECT -> MODULE -> CHAPTER -> SLIDE, so the
    // dialog is keyed on the level it was opened from rather than assuming a
    // chapter — setting a whole subject or module offline in one action instead
    // of visiting each chapter under it.
    const [offlineDialog, setOfflineDialog] = useState<{
        open: boolean;
        sourceType: OfflineSourceType;
        sourceId: string | null;
        nodeName: string | null;
    }>({ open: false, sourceType: 'CHAPTER', sourceId: null, nodeName: null });
    const handleOpenOfflineDialog = (
        sourceType: OfflineSourceType,
        sourceId: string,
        nodeName: string
    ) => {
        setOfflineDialog({ open: true, sourceType, sourceId, nodeName });
    };
    const handleCloseOfflineDialog = () => {
        setOfflineDialog((prev) => ({ ...prev, open: false, sourceId: null, nodeName: null }));
    };
    const handleOpenChapterOfflineDialog = (chapterId: string, chapterName: string) =>
        handleOpenOfflineDialog('CHAPTER', chapterId, chapterName);

    // Navigation state for loose view
    const [currentNavigationLevel, setCurrentNavigationLevel] = useState<
        'subjects' | 'modules' | 'chapters' | 'slides'
    >('subjects');
    const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
    const [selectedModuleId, setSelectedModuleId] = useState<string>('');
    const [navigationBreadcrumb, setNavigationBreadcrumb] = useState<
        Array<{
            level: string;
            name: string;
            id: string;
        }>
    >([]);

    const addModuleMutation = useAddModule();
    const addSubjectMutation = useAddSubject();
    const updateSubjectMutation = useUpdateSubject();
    const deleteSubjectMutation = useDeleteSubject();
    const updateSubjectOrderMutation = useUpdateSubjectOrder();
    const updateModuleOrderMutation = useUpdateModuleOrder();
    const updateChapterOrderMutation = useUpdateChapterOrder();
    const updateModuleMutation = useUpdateModule();
    const updateChapterMutation = useUpdateChapter();
    const deleteModuleMutation = useDeleteModule();
    const deleteChapterMutation = useDeleteChapter();

    // useIntroJsTour({
    //     key: StudyLibraryIntroKey.addSubjectStep,
    //     steps: studyLibrarySteps.addSubjectStep,
    // });

    const initialSubjects = getCourseSubjects(courseId, selectedSession || '', levelId);
    const [subjects, setSubjects] = useState(initialSubjects);

    useEffect(() => {
        const newSubjects = getCourseSubjects(courseId, selectedSession || '', levelId);
        setSubjects(newSubjects);
    }, [selectedSession, studyLibraryData, courseId, levelId, selectedBatchId]);

    // Try to get packageSessionId from course-init API first (new approach)
    const packageSessionIdFromCourseInit = useGetPackageSessionIdFromCourseInit(
        courseId,
        selectedSession || '',
        levelId
    );
    // Fallback to institute details if course-init doesn't have it
    const packageSessionIdFromInstitute =
        useGetPackageSessionId(courseId, selectedSession || '', levelId) || '';

    // Canonical packageSessionId used across tabs.
    // If Batch/Subgroup is selected, use it; otherwise fall back to session+level mapping.
    const contentPackageSessionId =
        selectedBatchId || packageSessionIdFromCourseInit || packageSessionIdFromInstitute;

    // Outline + Content Structure fetches use this id.
    const packageSessionIds = contentPackageSessionId;
    // Batch-oriented tabs (Teacher/Learner/Assessment/Planning/Activity) also use the same id.
    const batchPackageSessionId = contentPackageSessionId;

    // ---- Import Content (per-batch) -----------------------------------------
    // Lets the admin seed the currently-viewed batch's content from any other
    // batch in the institute. Target = batchPackageSessionId. Mode (VALUE /
    // REFERENCE) is picked in the dialog. REFERENCE mode is locked off when the
    // target batch already has slides — see COPY_COURSE_CONTENT_IMPLEMENTATION.md.
    const [showCopyContentDialog, setShowCopyContentDialog] = useState(false);
    const copyCourseContentMutation = useCopyCourseContent();

    // Slide count for the current batch — drives the "has existing content?"
    // signal. Same query key as course-details-page's slideCountQuery, so we
    // hit React Query's cache without firing an extra request. Loaded eagerly
    // (not gated on dialog open) so the dialog has the answer the moment it
    // mounts; otherwise REFERENCE briefly shows enabled before flipping off.
    const slidesCountQuery = useQuery({
        ...handleGetSlideCountDetails(batchPackageSessionId ?? ''),
        enabled: !!batchPackageSessionId,
    });
    const targetBatchHasContent = useMemo(() => {
        // Backend projection uses @JsonNaming(SnakeCaseStrategy) so the JSON
        // payload is snake_case: { source_type, slide_count, total_read_time_minutes }.
        // Reading camelCase here previously made every row look like 0 slides
        // and REFERENCE mode was never locked off.
        const data = slidesCountQuery.data as
            | Array<{ slide_count?: number; source_type?: string }>
            | undefined;
        if (!Array.isArray(data) || data.length === 0) return false;
        return data.some((row) => (row?.slide_count ?? 0) > 0);
    }, [slidesCountQuery.data]);

    const handleCopyContentConfirm = async (selection: CopyContentSelection) => {
        setShowCopyContentDialog(false);
        if (!batchPackageSessionId) {
            toast.error(t('importContent.noBatchSelected'));
            return;
        }
        if (selection.sourcePackageSessionId === batchPackageSessionId) {
            toast.error(t('importContent.sameBatch'));
            return;
        }
        // Defense-in-depth: if the dialog let REFERENCE through despite the
        // target having content, refuse on the parent side too.
        if (selection.mode === 'REFERENCE' && targetBatchHasContent) {
            toast.error(t('importContent.targetHasContent'));
            return;
        }
        try {
            const result = await copyCourseContentMutation.mutateAsync({
                sourcePackageSessionId: selection.sourcePackageSessionId,
                targetPackageSessionIds: [batchPackageSessionId],
                mode: selection.mode,
            });
            const summary = t('importContent.summary', {
                subjects: result.copiedSubjects,
                modules: result.copiedModules,
                chapters: result.copiedChapters,
                slides: result.copiedSlides,
            });
            const modeLabel = t(
                selection.mode === 'REFERENCE'
                    ? 'importContent.modeLinked'
                    : 'importContent.modeCopied'
            );
            if (
                selection.mode === 'VALUE' &&
                result.warnings &&
                result.warnings.length > 0
            ) {
                toast.warning(
                    t('importContent.warningSuffix', {
                        summary: t('importContent.successMessage', {
                            mode: modeLabel,
                            summary,
                        }),
                        count: result.warnings.length,
                    })
                );
            } else {
                toast.success(t('importContent.successMessage', { mode: modeLabel, summary }));
            }
        } catch (err) {
            console.error('Import content failed:', err);
            toast.error(t('importContent.failed'));
        }
    };
    // Visibility rule for the "Import Content" button:
    //  1. user can edit structure (admin or own draft course)
    //  2. a target batch is actually selected
    //  3. slide-count query has returned (we don't flash the button before the
    //     count lands and then yank it away once we discover the batch is full)
    //  4. the batch is empty — populated batches hide the button entirely.
    //     Importing into a batch that already has content is an untested path
    //     that mixes auto-seeded structure with imported structure; keeping it
    //     out of the UI removes the foot-gun until that flow is hardened.
    const canCopyContent =
        canEditStructure &&
        !!batchPackageSessionId &&
        slidesCountQuery.isSuccess &&
        !targetBatchHasContent;

    const useSlidesByChapterMutation = () => {
        return useMutation({
            mutationFn: async ({ modules, packageSessionId }: UseSlidesFromModulesInput) => {
                const chapterSlidesMapUpdate: { [chapterId: string]: Slide[] } = {};
                await Promise.all(
                    modules.map(async (module) => {
                        const chaptersWithSlides = await fetchChaptersWithSlides(
                            module.id,
                            packageSessionId
                        );
                        chaptersWithSlides.forEach((chapterWithSlides: ChapterWithSlides) => {
                            chapterSlidesMapUpdate[chapterWithSlides.chapter.id] =
                                chapterWithSlides.slides;
                        });
                    })
                );
                return chapterSlidesMapUpdate;
            },
        });
    };
    const { mutateAsync: fetchSlides } = useSlidesByChapterMutation();

    const useModulesMutation = () => {
        return useMutation({
            mutationFn: async ({
                subjects: currentSubjects,
                packageSessionIds: currentPackageSessionIds,
            }: {
                subjects: SubjectType[];
                packageSessionIds: string;
            }) => {
                const results = await Promise.all(
                    currentSubjects.map(async (subject) => {
                        const res = await fetchModulesWithChapters(
                            subject.id,
                            currentPackageSessionIds
                        );
                        return { subjectId: subject.id, modules: res };
                    })
                );
                const modulesMap: SubjectModulesMap = {};
                results.forEach(({ subjectId, modules }) => {
                    modulesMap[subjectId] = modules;
                });
                return modulesMap;
            },
        });
    };
    const { mutateAsync: fetchModules } = useModulesMutation();

    const handleAddModule = (subjectId: string, module: Module) => {
        // Ensure we have a concrete package session id for this operation.
        if (!packageSessionIds) {
            console.error(
                'Cannot add module: missing packageSessionIds (no Batch/Subgroup or session+level mapping found).'
            );
            return;
        }

        addModuleMutation.mutate(
            {
                subjectId,
                // Always use the resolved packageSessionIds so modules/chapters
                // are created under the currently selected Batch/Subgroup (or
                // the legacy session+level mapping when no batch is selected).
                packageSessionIds,
                module,
            },
            {
                onSuccess: async () => {
                    const updatedSubjects = getCourseSubjects(
                        courseId,
                        selectedSession || '',
                        levelId
                    );
                    if (updatedSubjects.length > 0 && packageSessionIds) {
                        const updatedModulesMap = await fetchModules({
                            subjects: updatedSubjects,
                            packageSessionIds,
                        });
                        setSubjectModulesMap(updatedModulesMap);
                    }
                    setSubjects(updatedSubjects);
                },
            }
        );
    };

    useEffect(() => {
        const loadModules = async () => {
            if (subjects.length > 0 && packageSessionIds) {
                try {
                    // Clear previous data when packageSession changes to avoid showing stale structure.
                    setSubjectModulesMap({});
                    setChapterSlidesMap({});
                    const modulesMap = await fetchModules({ subjects, packageSessionIds });
                    setSubjectModulesMap(modulesMap);

                    // Expand all by default
                    const allSubjectIds = new Set(subjects.map((s) => s.id));
                    const allModuleIds = new Set<string>();
                    const allChapterIds = new Set<string>();

                    Object.values(modulesMap)
                        .flat()
                        .forEach((modWithChapters) => {
                            allModuleIds.add(modWithChapters.module.id);
                            modWithChapters.chapters.forEach((chapWithMeta) => {
                                allChapterIds.add(chapWithMeta.chapter.id);
                            });
                        });
                    setOpenSubjects(allSubjectIds);
                    setOpenModules(allModuleIds);
                    setOpenChapters(allChapterIds);
                } catch (error) {
                    console.error('Failed to fetch modules:', error);
                    setSubjectModulesMap({});
                }
            } else {
                setSubjectModulesMap({});
            }
        };
        loadModules();
    }, [subjects, packageSessionIds, fetchModules, selectedBatchId]);

    useEffect(() => {
        const loadSlides = async () => {
            const allModules: { id: string }[] = Object.values(subjectModulesMap)
                .flat()
                .map((m) => ({ id: m.module.id }));
            if (allModules.length > 0 && packageSessionIds) {
                try {
                    const slideMap = await fetchSlides({
                        modules: allModules,
                        packageSessionId: packageSessionIds,
                    });
                    setChapterSlidesMap(slideMap);
                } catch (error) {
                    console.error('Failed to fetch slides:', error);
                    setChapterSlidesMap({});
                }
            } else {
                setChapterSlidesMap({});
            }
        };
        if (Object.keys(subjectModulesMap).length > 0 && packageSessionIds) {
            loadSlides();
        } else {
            setChapterSlidesMap({});
        }
    }, [subjectModulesMap, packageSessionIds, fetchSlides, selectedBatchId]);

    // Auto-expand items based on course settings (only for outline tab)
    useEffect(() => {
        // Only proceed if settings have loaded successfully
        if (settingsLoading || settingsError) {
            return; // Use default collapsed state if settings fail - safer fallback
        }

        const defaultState = courseSettings?.outlineSettings?.defaultState;
        if (defaultState === 'expanded' && selectedTab === TabType.OUTLINE) {
            // Expand subjects (always applicable)
            if (subjects && subjects.length > 0) {
                const allSubjectIds = new Set(subjects.map((subject) => subject.id));
                setOpenSubjects(allSubjectIds);
            }

            // Expand modules and chapters if they exist
            if (Object.keys(subjectModulesMap).length > 0) {
                // Expand all modules
                const allModuleIds = new Set<string>();
                Object.values(subjectModulesMap).forEach((moduleList) => {
                    moduleList.forEach((moduleData) => {
                        allModuleIds.add(moduleData.module.id);
                    });
                });
                setOpenModules(allModuleIds);

                // Expand all chapters
                const allChapterIds = new Set<string>();
                Object.values(subjectModulesMap).forEach((moduleList) => {
                    moduleList.forEach((moduleData) => {
                        moduleData.chapters.forEach((chapterData) => {
                            allChapterIds.add(chapterData.chapter.id);
                        });
                    });
                });
                setOpenChapters(allChapterIds);
            }
        } else if (defaultState === 'collapsed') {
            // Ensure everything is collapsed
            setOpenSubjects(new Set());
            setOpenModules(new Set());
            setOpenChapters(new Set());
        }
    }, [
        settingsLoading,
        settingsError,
        courseSettings?.outlineSettings?.defaultState,
        subjectModulesMap,
        subjects,
        selectedTab,
    ]);

    // Load direct slides for 2-depth courses
    useEffect(() => {
        const loadDirectSlides = async () => {
            if (courseStructure === 2 && packageSessionIds) {
                try {
                    const slides = await fetchDirectSlides(packageSessionIds);
                    setDirectSlides(Array.isArray(slides) ? slides : []);
                } catch (error) {
                    console.error('Failed to fetch direct slides:', error);
                    setDirectSlides([]);
                }
            } else {
                setDirectSlides([]);
            }
        };
        loadDirectSlides();
    }, [courseStructure, packageSessionIds, selectedBatchId]);

    // Load drip conditions settings
    useEffect(() => {
        const loadDripSettings = async () => {
            setLoadingDripConditions(true);
            try {
                const settings = await getCourseSettings();
                setDripConditionsEnabled(settings.dripConditions.enabled || false);
                setDripConditions(settings.dripConditions.conditions || []);
                setDripEnforcing(settings.dripConditions.applyConfiguredRules === true);
                setDripScheduleDefaults({
                    ...DEFAULT_DRIP_SCHEDULE,
                    ...settings.dripConditions.scheduleDefaults,
                });
            } catch (error) {
                console.error('Failed to load drip conditions:', error);
            } finally {
                setLoadingDripConditions(false);
            }
        };
        loadDripSettings();
    }, []);

    const handleOpenDripDialog = (
        level: DripConditionContentLevel,
        itemId: string,
        itemName: string
    ) => {
        setContentDripDialog({ open: true, level, itemId, itemName });
    };

    const handleCloseDripDialog = () => {
        setContentDripDialog((prev) => ({ ...prev, open: false }));
    };

    const handleSaveChapterDripConditions = async (updatedConditions: DripCondition[]) => {
        try {
            const settings = await getCourseSettings();
            const newSettings = {
                ...settings,
                dripConditions: {
                    ...settings.dripConditions,
                    conditions: updatedConditions,
                },
            };
            await saveCourseSettings(newSettings);
            setDripConditions(updatedConditions);
        } catch (error) {
            console.error('Failed to save drip conditions:', error);
            alert(t('dripConditions.saveFailed'));
        }
    };

    const handleAddSubject = async (newSubject: SubjectType) => {
        if (!packageSessionIds) {
            console.error('No package session IDs found');
            return;
        }
        addSubjectMutation.mutate({ subject: newSubject, packageSessionIds });
    };

    const openDeleteConfirmation = (
        type: 'subject' | 'module' | 'chapter',
        item: { id: string; name: string; subjectId?: string; moduleId?: string }
    ) => {
        setDeleteConfirmation({ isOpen: true, type, item });
    };

    const openEditDialog = (
        type: 'subject' | 'module' | 'chapter',
        item: SubjectType | Module | (Chapter & { subjectId?: string; moduleId?: string; chapter_in_package_sessions?: string[] })
    ) => {
        setEditDialog({ isOpen: true, type, item });
    };

    const closeEditDialog = () => {
        setEditDialog({ isOpen: false, type: null, item: null });
        setChapterFormState({ submitFn: null, isPending: false });
    };

    const handleChapterFormReady = (submitFn: () => void, isPending: boolean) => {
        setChapterFormState({ submitFn, isPending });
    };

    const handleEditSubject = (updatedSubject: SubjectType) => {
        // Check permissions before allowing edit
        if (!canEditStructure) {
            console.warn('User does not have permission to edit this course structure');
            return;
        }

        updateSubjectMutation.mutate(
            {
                subjectId: updatedSubject.id,
                updatedSubject,
            },
            {
                onSuccess: () => {
                    closeEditDialog();
                    // Refresh data
                    const updatedSubjects = getCourseSubjects(
                        courseId,
                        selectedSession || '',
                        levelId
                    );
                    setSubjects(updatedSubjects);
                },
            }
        );
    };

    const handleEditModule = (updatedModule: Module) => {
        // Check permissions before allowing edit
        if (!canEditStructure) {
            console.warn('User does not have permission to edit this course structure');
            return;
        }

        if (!editDialog.item || editDialog.type !== 'module') return;
        const moduleItem = editDialog.item as Module & { subjectId?: string };
        if (!moduleItem.subjectId) return;

        updateModuleMutation.mutate(
            {
                moduleId: updatedModule.id,
                module: updatedModule,
            },
            {
                onSuccess: async () => {
                    closeEditDialog();
                    // Refresh data - same as add module
                    const updatedSubjects = getCourseSubjects(
                        courseId,
                        selectedSession || '',
                        levelId
                    );
                    if (updatedSubjects.length > 0 && packageSessionIds) {
                        const updatedModulesMap = await fetchModules({
                            subjects: updatedSubjects,
                            packageSessionIds,
                        });
                        setSubjectModulesMap(updatedModulesMap);
                    }
                    setSubjects(updatedSubjects);
                },
            }
        );
    };

    // Removed unused handleEditChapter to satisfy linter

    // ===== REORDER HANDLERS =====

    // Handle subject reordering
    const handleSubjectReorder = (reorderedSubjects: SubjectType[]) => {
        if (!canEditStructure || !packageSessionIds?.length) {
            console.warn('Cannot reorder: missing permissions or package session IDs');
            return;
        }

        // Save previous state for rollback
        const previousSubjects = [...subjects];

        // Optimistic update
        setSubjects(reorderedSubjects);

        // Build payload for API
        const orderedSubjects = reorderedSubjects.map((subject, index) => ({
            subject_id: subject.id,
            package_session_id: packageSessionIds || '',
            subject_order: index + 1, // 1-based index
        }));

        updateSubjectOrderMutation.mutate(
            { orderedSubjects },
            {
                onError: (error) => {
                    console.error('Failed to update subject order:', error);
                    setSubjects(previousSubjects);
                    toast.error(t('dripConditions.reorderSubjectsFailed'));
                },
            }
        );
    };

    // Handle module reordering (within a subject)
    const handleModuleReorder = (
        subjectId: string,
        reorderedModules: { module: Module; chapters: ChapterWithSlidesStore[] }[]
    ) => {
        if (!canEditStructure) {
            console.warn('Cannot reorder: missing permissions');
            return;
        }

        // Save previous state for rollback
        const previousModulesMap = { ...subjectModulesMap };

        // Optimistic update
        setSubjectModulesMap((prev) => ({
            ...prev,
            [subjectId]: reorderedModules,
        }));

        // Build payload for API
        const updatedModules = reorderedModules.map((mod, index) => ({
            subject_id: subjectId,
            module_id: mod.module.id,
            module_order: index + 1, // 1-based index
        }));

        updateModuleOrderMutation.mutate(
            { updatedModules },
            {
                onError: (error) => {
                    console.error('Failed to update module order:', error);
                    setSubjectModulesMap(previousModulesMap);
                    toast.error(t('dripConditions.reorderModulesFailed'));
                },
            }
        );
    };

    // Handle chapter reordering (within a module)
    const handleChapterReorder = (
        moduleId: string,
        reorderedChapters: ChapterWithSlidesStore[]
    ) => {
        if (!canEditStructure || !packageSessionIds?.length) {
            console.warn('Cannot reorder: missing permissions or package session IDs');
            return;
        }

        // Save previous state for rollback
        const previousModulesMap = { ...subjectModulesMap };

        // Optimistic update - find and update the correct module
        setSubjectModulesMap((prev) => {
            const updated = { ...prev };
            for (const subjectId of Object.keys(updated)) {
                const modules = updated[subjectId];
                if (modules) {
                    const moduleIndex = modules.findIndex((m) => m.module.id === moduleId);
                    if (moduleIndex !== -1) {
                        updated[subjectId] = [
                            ...modules.slice(0, moduleIndex),
                            { ...modules[moduleIndex], chapters: reorderedChapters } as any,
                            ...modules.slice(moduleIndex + 1),
                        ];
                        break;
                    }
                }
            }
            return updated;
        });

        // Build payload for API
        const orderPayload = reorderedChapters.map((ch, index) => ({
            chapter_id: ch.chapter.id,
            package_session_id: packageSessionIds || '',
            chapter_order: index + 1, // 1-based index
        }));

        updateChapterOrderMutation.mutate(orderPayload, {
            onError: (error) => {
                console.error('Failed to update chapter order:', error);
                setSubjectModulesMap(previousModulesMap);
                toast.error(t('dripConditions.reorderChaptersFailed'));
            },
        });
    };

    const handleConfirmDelete = () => {
        if (!deleteConfirmation.item || !packageSessionIds) {
            console.error('Missing confirmation item or package session IDs');
            return;
        }

        const { type, item } = deleteConfirmation;

        switch (type) {
            case 'subject':
                deleteSubjectMutation.mutate({
                    subjectId: item.id,
                    commaSeparatedPackageSessionIds: packageSessionIds,
                });
                break;
            case 'module':
                if (item.subjectId) {
                    deleteModuleMutation.mutate(
                        {
                            subjectId: item.subjectId,
                            moduleId: item.id,
                            commaSeparatedPackageSessionIds: packageSessionIds,
                        },
                        {
                            onSuccess: async () => {
                                // Update local state after successful deletion - same as add module
                                const updatedSubjects = getCourseSubjects(
                                    courseId,
                                    selectedSession || '',
                                    levelId
                                );
                                if (updatedSubjects.length > 0 && packageSessionIds) {
                                    const updatedModulesMap = await fetchModules({
                                        subjects: updatedSubjects,
                                        packageSessionIds,
                                    });
                                    setSubjectModulesMap(updatedModulesMap);
                                }
                                setSubjects(updatedSubjects);
                            },
                        }
                    );
                }
                break;
            case 'chapter':
                if (item.subjectId && item.moduleId) {
                    deleteChapterMutation.mutate(
                        {
                            moduleId: item.moduleId,
                            subjectId: item.subjectId,
                            packageSessionIds,
                            chapterIds: [item.id],
                        },
                        {
                            onSuccess: async () => {
                                // Update local state after successful chapter deletion
                                const updatedSubjects = getCourseSubjects(
                                    courseId,
                                    selectedSession || '',
                                    levelId
                                );
                                if (updatedSubjects.length > 0 && packageSessionIds) {
                                    const updatedModulesMap = await fetchModules({
                                        subjects: updatedSubjects,
                                        packageSessionIds,
                                    });
                                    setSubjectModulesMap(updatedModulesMap);
                                }
                                setSubjects(updatedSubjects);
                            },
                        }
                    );
                }
                break;
        }

        setDeleteConfirmation({ isOpen: false, type: null, item: null });
    };

    const handleChapterNavigation = (subjectId: string, moduleId: string, chapterId: string) => {
        if (blockReadOnlyClick) return;
        const navigationParams = {
            courseId: router.state.location.search.courseId ?? '',
            levelId: selectedLevel,
            subjectId,
            moduleId,
            chapterId,
            slideId: '', // Empty for new slide
            sessionId: selectedSession,
        };

        router.navigate({
            to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
            search: navigationParams,
        });
    };

    const handleSlideNavigation = (
        subjectId: string,
        moduleId: string,
        chapterId: string,
        slideId: string
    ) => {
        if (blockReadOnlyClick) return;
        const slide = chapterSlidesMap[chapterId]?.find((s) => s.id === slideId);
        if (slide) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            setActiveItem(slide);
        } else {
            // Fallback for safety, though this path should ideally not be taken
            setActiveItem({
                id: slideId,
                source_id: '',
                source_type: '',
                title: '',
                image_file_id: '',
                description: '',
                status: '',
                slide_order: 0,
                video_slide: null,
                document_slide: null,
                question_slide: null,
                assignment_slide: null,
                is_loaded: false,
                new_slide: false,
            });
        }

        const navigationParams = {
            courseId: router.state.location.search.courseId ?? '',
            levelId: selectedLevel,
            subjectId,
            moduleId,
            chapterId,
            slideId,
            sessionId: selectedSession,
        };

        router.navigate({
            to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
            search: navigationParams,
        });
    };

    // Navigation handler for direct slides (2-depth courses)
    const handleDirectSlideNavigation = (slideId?: string) => {
        if (blockReadOnlyClick) return;
        const slide = slideId ? directSlides.find((s) => s.id === slideId) : null;
        if (slide) {
            setActiveItem(slide);
        }

        // Get real subject, module, and chapter IDs for 2-depth
        const realSubjectId = subjects[0]?.id || '';
        const moduleWithChapters = subjectModulesMap[realSubjectId]?.[0];
        const realModuleId = moduleWithChapters?.module.id || '';
        const realChapterId = moduleWithChapters?.chapters?.[0]?.chapter.id || '';

        const navigationParams = {
            courseId: router.state.location.search.courseId ?? '',
            levelId: selectedLevel,
            subjectId: realSubjectId,
            moduleId: realModuleId,
            chapterId: realChapterId,
            slideId: slideId || '',
            sessionId: selectedSession,
        };

        router.navigate({
            to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
            search: navigationParams,
        });
    };

    const toggleOpenState = (
        id: string,
        setter: React.Dispatch<React.SetStateAction<Set<string>>>
    ) => {
        setter((prev) => {
            const u = new Set(prev);
            u.has(id) ? u.delete(id) : u.add(id);
            return u;
        });
    };
    const toggleSubject = (id: string) => toggleOpenState(id, setOpenSubjects);
    const toggleModule = (id: string) => toggleOpenState(id, setOpenModules);
    const toggleChapter = (id: string) => toggleOpenState(id, setOpenChapters);

    const expandAll = () => {
        const allSubjectIds = new Set(subjects.map((s) => s.id));
        const allModuleIds = new Set<string>();
        const allChapterIds = new Set<string>();

        Object.values(subjectModulesMap)
            .flat()
            .forEach((modWithChapters) => {
                allModuleIds.add(modWithChapters.module.id);
                modWithChapters.chapters.forEach((chapWithMeta) => {
                    allChapterIds.add(chapWithMeta.chapter.id);
                });
            });

        setOpenSubjects(allSubjectIds);
        setOpenModules(allModuleIds);
        setOpenChapters(allChapterIds);
    };

    const collapseAll = () => {
        setOpenSubjects(new Set());
        setOpenModules(new Set());
        setOpenChapters(new Set());
    };

    const totalModulesCount = Object.values(subjectModulesMap).flat().length;
    const totalChaptersCount = Object.values(subjectModulesMap)
        .flat()
        .reduce((sum, m) => sum + m.chapters.length, 0);
    /**
     * Everything the day-wise scheduler can drip, in course order.
     *
     * Slides are only offered once their chapters have actually been loaded —
     * scheduling half a course because the rest had not been fetched yet would
     * silently lock the missing half out of the schedule.
     */
    const dripScheduleItems = useMemo(() => {
        const modulesInOrder = subjects.flatMap((subject) =>
            (subjectModulesMap[subject.id] ?? []).map((m) => m)
        );
        const chaptersInOrder = modulesInOrder.flatMap((m) => m.chapters);
        return {
            subject: subjects.map((subject) => ({
                id: subject.id,
                name: subject.subject_name,
            })),
            module: modulesInOrder.map((m) => ({
                id: m.module.id,
                name: m.module.module_name,
            })),
            chapter: chaptersInOrder.map((ch) => ({
                id: ch.chapter.id,
                name: ch.chapter.chapter_name,
            })),
            slide: chaptersInOrder.flatMap((ch) =>
                (chapterSlidesMap[ch.chapter.id] ?? []).map((slide) => ({
                    id: slide.id,
                    name: slide.title || t('untitledSlide'),
                }))
            ),
        };
    }, [subjects, subjectModulesMap, chapterSlidesMap, t]);

    const totalExpandable = subjects.length + totalModulesCount + totalChaptersCount;
    const totalOpen = openSubjects.size + openModules.size + openChapters.size;
    const isAllExpanded = totalExpandable > 0 && totalOpen >= totalExpandable;

    // Navigation functions for loose view.
    // These push the drill position into the URL (a history entry); the sync
    // effect below mirrors the URL back into local state. This keeps the back
    // button stepping one level at a time (Subject → Module → Chapter) and
    // restores the level when returning from the slides view.
    const handleSubjectClick = (subjectId: string, _subjectName?: string) => {
        goToNavLevel({ navLevel: 'modules', navSubjectId: subjectId });
    };

    const handleModuleClick = (moduleId: string, _moduleName?: string) => {
        goToNavLevel({
            navLevel: 'chapters',
            navSubjectId: navSearch.navSubjectId,
            navModuleId: moduleId,
        });
    };

    const resetNavigation = () => {
        // Replace (not push) — used when switching to the Content Structure tab,
        // so it doesn't pollute the back stack.
        goToNavLevel({}, { replace: true });
    };

    const navigateToLevel = (levelIndex: number) => {
        if (levelIndex === -1) {
            // Breadcrumb "Course" → top level.
            goToNavLevel({});
        } else if (levelIndex === 0) {
            if (courseStructure === 4) {
                // Structure 4: level 0 is the module crumb → back to the modules grid.
                goToNavLevel({});
            } else {
                // Structure 5: level 0 is the subject crumb → modules grid.
                goToNavLevel({ navLevel: 'modules', navSubjectId: navSearch.navSubjectId });
            }
        } else if (levelIndex === 1) {
            // Structure 5: level 1 is the module crumb → chapters grid (no-op move).
            goToNavLevel({
                navLevel: 'chapters',
                navSubjectId: navSearch.navSubjectId,
                navModuleId: navSearch.navModuleId,
            });
        }
    };

    // Mirror the URL drill position (navSearch) into local navigation state.
    // Runs on mount, on back/forward, and as course data loads (so breadcrumb
    // names resolve once subjects/modules are available).
    useEffect(() => {
        const { navLevel, navSubjectId, navModuleId } = navSearch;

        if (courseStructure === 5) {
            if (navLevel === 'chapters' && navSubjectId && navModuleId) {
                const subj = subjects.find((s) => s.id === navSubjectId);
                // Data loaded but the target subject is gone (e.g. session/level
                // switched) → fall back to the top level.
                if (subjects.length > 0 && !subj) {
                    setCurrentNavigationLevel('subjects');
                    setSelectedSubjectId('');
                    setSelectedModuleId('');
                    setNavigationBreadcrumb([]);
                    return;
                }
                const modules = subjectModulesMap[navSubjectId] ?? [];
                const mod = modules.find((m) => m.module.id === navModuleId);
                // Module gone (deleted / session switched) but its list has loaded
                // → drop to the modules grid for this subject instead of stranding
                // the user on a blank, nameless chapters view.
                if (modules.length > 0 && !mod) {
                    setCurrentNavigationLevel('modules');
                    setSelectedSubjectId(navSubjectId);
                    setSelectedModuleId('');
                    setNavigationBreadcrumb([
                        { level: 'Subject', name: subj?.subject_name ?? '', id: navSubjectId },
                    ]);
                    return;
                }
                setCurrentNavigationLevel('chapters');
                setSelectedSubjectId(navSubjectId);
                setSelectedModuleId(navModuleId);
                setNavigationBreadcrumb([
                    { level: 'Subject', name: subj?.subject_name ?? '', id: navSubjectId },
                    { level: 'Module', name: mod?.module.module_name ?? '', id: navModuleId },
                ]);
            } else if (navLevel === 'modules' && navSubjectId) {
                const subj = subjects.find((s) => s.id === navSubjectId);
                if (subjects.length > 0 && !subj) {
                    setCurrentNavigationLevel('subjects');
                    setSelectedSubjectId('');
                    setSelectedModuleId('');
                    setNavigationBreadcrumb([]);
                    return;
                }
                setCurrentNavigationLevel('modules');
                setSelectedSubjectId(navSubjectId);
                setSelectedModuleId('');
                setNavigationBreadcrumb([
                    { level: 'Subject', name: subj?.subject_name ?? '', id: navSubjectId },
                ]);
            } else {
                setCurrentNavigationLevel('subjects');
                setSelectedSubjectId('');
                setSelectedModuleId('');
                setNavigationBreadcrumb([]);
            }
        } else if (courseStructure === 4) {
            if (navLevel === 'chapters' && navModuleId) {
                const firstSubjectId = subjects[0]?.id ?? '';
                const modules = subjectModulesMap[firstSubjectId] ?? [];
                const mod = modules.find((m) => m.module.id === navModuleId);
                // Module gone (deleted / batch or session switched) but its list
                // has loaded → fall back to the modules grid (the top level for
                // structure 4) instead of a blank, nameless chapters view.
                if (modules.length > 0 && !mod) {
                    setCurrentNavigationLevel('subjects');
                    setSelectedModuleId('');
                    setNavigationBreadcrumb([]);
                    return;
                }
                setCurrentNavigationLevel('chapters');
                setSelectedModuleId(navModuleId);
                setNavigationBreadcrumb([
                    { level: 'Module', name: mod?.module.module_name ?? '', id: navModuleId },
                ]);
            } else {
                setCurrentNavigationLevel('subjects');
                setSelectedModuleId('');
                setNavigationBreadcrumb([]);
            }
        }
        // Structures 2 & 3 have no intermediate drill levels — nothing to mirror.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        navSearch.navLevel,
        navSearch.navSubjectId,
        navSearch.navModuleId,
        subjects,
        subjectModulesMap,
        courseStructure,
    ]);
    const tabContent: Record<TabType, React.ReactNode> = {
        [TabType.OUTLINE]: (
            <div className="relative">
                {/* Sticky header with expand/collapse buttons */}
                <div className="sticky top-0 z-10 mb-3 border-b border-gray-200 bg-white px-6 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                            <h3 className="text-sm font-medium text-gray-700">
                                {t('courseStructureHeading')}
                            </h3>
                            <CopyContentLineageBadge packageSessionId={batchPackageSessionId} />
                        </div>
                        <div className="flex items-center gap-2">
                            {roleDisplay?.coursePage?.showBulkUpload === true &&
                                !readOnly &&
                                canEditStructure &&
                                !!packageSessionIds && (
                                <BulkUploadDialogButton
                                    context={{
                                        courseId,
                                        sessionId: selectedSession || '',
                                        levelId,
                                        packageSessionId: packageSessionIds,
                                        courseDepth: courseStructure,
                                        instituteId:
                                            (tokenData &&
                                                Object.keys(tokenData.authorities)[0]) ||
                                            '',
                                    }}
                                    onCompleted={async () => {
                                        const updatedSubjects = getCourseSubjects(
                                            courseId,
                                            selectedSession || '',
                                            levelId
                                        );
                                        setSubjects(updatedSubjects);
                                        if (updatedSubjects.length > 0 && packageSessionIds) {
                                            const updatedModulesMap = await fetchModules({
                                                subjects: updatedSubjects,
                                                packageSessionIds,
                                            });
                                            setSubjectModulesMap(updatedModulesMap);
                                        }
                                    }}
                                />
                            )}
                            {!readOnly && canCopyContent && (
                                <MyButton
                                    buttonType="secondary"
                                    onClick={() => setShowCopyContentDialog(true)}
                                    className="flex items-center gap-1.5 !px-3 !py-1 text-xs"
                                    disable={copyCourseContentMutation.isPending}
                                >
                                    <Copy size={14} weight="bold" />
                                    {copyCourseContentMutation.isPending
                                        ? 'Importing…'
                                        : 'Import Content'}
                                </MyButton>
                            )}
                            {!readOnly && canEditStructure && dripConditionsEnabled && (
                                <MyButton
                                    buttonType="secondary"
                                    onClick={() => setDripScheduleOpen(true)}
                                    className="flex items-center gap-1.5 !px-3 !py-1 text-xs"
                                    disable={loadingDripConditions}
                                >
                                    <CalendarBlank size={14} weight="bold" />
                                    {t('scheduleUnlock')}
                                </MyButton>
                            )}
                            {!readOnly && totalExpandable > 0 && (
                                <MyButton
                                    buttonType="secondary"
                                    onClick={isAllExpanded ? collapseAll : expandAll}
                                    className="flex items-center gap-1.5 !px-3 !py-1 text-xs"
                                >
                                    {isAllExpanded ? (
                                        <>
                                            <ArrowsIn size={14} weight="bold" />
                                            {t('collapseAll')}
                                        </>
                                    ) : (
                                        <>
                                            <ArrowsOut size={14} weight="bold" />
                                            {t('expandAll')}
                                        </>
                                    )}
                                </MyButton>
                            )}
                        </div>
                    </div>
                </div>

                {/* Scrollable content */}
                <div className="px-6 pb-2">
                    <div className="max-w-3xl space-y-1 rounded-lg border border-gray-200 px-2">
                        {courseStructure === 5 && canEditStructure && (
                            <AddSubjectButton isTextButton onAddSubject={handleAddSubject} />
                        )}
                        {courseStructure === 5 && (
                            <Sortable
                                value={subjects}
                                onValueChange={handleSubjectReorder}
                                orientation="vertical"
                            >
                                {subjects.map((subject, idx) => {
                                    const isSubjectOpen = openSubjects.has(subject.id);

                                    return (
                                        <SortableItem key={subject.id} value={subject.id} asChild>
                                            <div className="group/subject-item relative">
                                                <Collapsible
                                                    open={isSubjectOpen}
                                                    onOpenChange={
                                                        blockReadOnlyClick
                                                            ? undefined
                                                            : () => toggleSubject(subject.id)
                                                    }
                                                    className="group"
                                                >
                                                    <CollapsibleTrigger
                                                        className={`group/subject-trigger flex w-full items-center rounded-md p-2 text-left text-sm font-semibold text-gray-800 transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${blockReadOnlyClick ? 'pointer-events-none' : ''}`}
                                                    >
                                                        <div className="flex flex-1 items-center gap-2.5">
                                                            {isSubjectOpen ? (
                                                                <CaretDown
                                                                    size={18}
                                                                    weight="bold"
                                                                    className="shrink-0 text-gray-500"
                                                                />
                                                            ) : (
                                                                <CaretRight
                                                                    size={18}
                                                                    weight="bold"
                                                                    className="shrink-0 text-gray-500"
                                                                />
                                                            )}
                                                            <Folder
                                                                size={20}
                                                                weight="duotone"
                                                                className="shrink-0 text-primary-500"
                                                            />
                                                            {roleDisplay?.coursePage
                                                                ?.viewContentNumbering !==
                                                                false && (
                                                                    <span className="w-7 shrink-0 rounded-md bg-gray-100 py-0.5 text-center font-mono text-xs font-medium text-gray-600 group-hover:bg-white">
                                                                        S{idx + 1}
                                                                    </span>
                                                                )}
                                                            <span
                                                                className="min-w-0 flex-1 truncate"
                                                                title={subject.subject_name}
                                                            >
                                                                {convertCapitalToTitleCase(
                                                                    subject.subject_name
                                                                )}
                                                            </span>
                                                        </div>
                                                        {canEditStructure && (
                                                            <div className="flex gap-1">
                                                                <SortableDragHandle className="inline-flex size-6 cursor-grab items-center justify-center rounded-md border border-neutral-300 opacity-0 transition-opacity hover:bg-gray-100 group-hover/subject-trigger:opacity-100">
                                                                    <DotsSixVertical size={14} />
                                                                </SortableDragHandle>
                                                                {canEditAllowed && (
                                                                <MyButton
                                                                    buttonType="secondary"
                                                                    layoutVariant="icon"
                                                                    scale="small"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openEditDialog(
                                                                            'subject',
                                                                            subject
                                                                        );
                                                                    }}
                                                                    className="opacity-0 transition-opacity hover:bg-blue-100 hover:text-blue-600 group-hover/subject-trigger:opacity-100"
                                                                >
                                                                    <PencilSimple size={16} />
                                                                </MyButton>
                                                                )}
                                                                {canDeleteAllowed && (
                                                                <MyButton
                                                                    buttonType="secondary"
                                                                    layoutVariant="icon"
                                                                    scale="small"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openDeleteConfirmation(
                                                                            'subject',
                                                                            {
                                                                                id: subject.id,
                                                                                name: subject.subject_name,
                                                                            }
                                                                        );
                                                                    }}
                                                                    className="opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover/subject-trigger:opacity-100"
                                                                >
                                                                    <Trash size={16} />
                                                                </MyButton>
                                                                )}
                                                            </div>
                                                        )}
                                                    </CollapsibleTrigger>
                                                    <CollapsibleContent className="py-1 pl-4 sm:pl-11">
                                                        <div className="relative space-y-1.5 border-l-2 border-dashed border-gray-200 pl-2 sm:pl-6">
                                                            <div className="absolute -left-[13px] top-0 h-full">
                                                                <div className="sticky top-0 flex h-full flex-col items-center" />
                                                            </div>

                                                            {canEditStructure && (
                                                                <AddModulesButton
                                                                    isTextButton
                                                                    subjectId={subject.id}
                                                                    onAddModuleBySubjectId={
                                                                        handleAddModule
                                                                    }
                                                                />
                                                            )}
                                                            <Sortable
                                                                value={(
                                                                    subjectModulesMap[subject.id] ??
                                                                    []
                                                                ).map((m) => ({
                                                                    ...m,
                                                                    id: m.module.id,
                                                                }))}
                                                                onValueChange={(reorderedModules) =>
                                                                    handleModuleReorder(
                                                                        subject.id,
                                                                        reorderedModules as unknown as {
                                                                            module: Module;
                                                                            chapters: ChapterWithSlidesStore[];
                                                                        }[]
                                                                    )
                                                                }
                                                                orientation="vertical"
                                                            >
                                                                {(
                                                                    subjectModulesMap[subject.id] ??
                                                                    []
                                                                ).map((mod, modIdx) => {
                                                                    const isModuleOpen =
                                                                        openModules.has(
                                                                            mod.module.id
                                                                        );

                                                                    return (
                                                                        <SortableItem
                                                                            key={mod.module.id}
                                                                            value={mod.module.id}
                                                                            asChild
                                                                        >
                                                                            <div className="group/module-item relative">
                                                                                <Collapsible
                                                                                    open={
                                                                                        isModuleOpen
                                                                                    }
                                                                                    onOpenChange={
                                                                                        blockReadOnlyClick
                                                                                            ? undefined
                                                                                            : () =>
                                                                                                toggleModule(
                                                                                                    mod
                                                                                                        .module
                                                                                                        .id
                                                                                                )
                                                                                    }
                                                                                    className="group/module"
                                                                                >
                                                                                    <CollapsibleTrigger
                                                                                        className={`group/module-trigger flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${blockReadOnlyClick ? 'pointer-events-none' : ''}`}
                                                                                    >
                                                                                        <div className="flex flex-1 items-center gap-2.5">
                                                                                            {isModuleOpen ? (
                                                                                                <CaretDown
                                                                                                    size={
                                                                                                        16
                                                                                                    }
                                                                                                    className="shrink-0 text-gray-500"
                                                                                                />
                                                                                            ) : (
                                                                                                <CaretRight
                                                                                                    size={
                                                                                                        16
                                                                                                    }
                                                                                                    className="shrink-0 text-gray-500"
                                                                                                />
                                                                                            )}
                                                                                            <FileText
                                                                                                size={
                                                                                                    18
                                                                                                }
                                                                                                weight="duotone"
                                                                                                className="shrink-0 text-blue-600"
                                                                                            />
                                                                                            {roleDisplay
                                                                                                ?.coursePage
                                                                                                ?.viewContentNumbering !==
                                                                                                false && (
                                                                                                    <span className="w-7 shrink-0 rounded-md bg-gray-100 py-0.5 text-center font-mono text-xs font-medium text-gray-500 group-hover/module:bg-white">
                                                                                                        M
                                                                                                        {modIdx +
                                                                                                            1}
                                                                                                    </span>
                                                                                                )}
                                                                                            <span
                                                                                                className="min-w-0 flex-1 truncate"
                                                                                                title={
                                                                                                    mod
                                                                                                        .module
                                                                                                        .module_name
                                                                                                }
                                                                                            >
                                                                                                {convertCapitalToTitleCase(
                                                                                                    mod
                                                                                                        .module
                                                                                                        .module_name
                                                                                                )}
                                                                                            </span>
                                                                                        </div>
                                                                                        {canEditStructure && (
                                                                                            <div className="flex gap-1">
                                                                                                <SortableDragHandle className="inline-flex size-6 cursor-grab items-center justify-center rounded-md border border-neutral-300 opacity-0 transition-opacity hover:bg-gray-100 group-hover/module-trigger:opacity-100">
                                                                                                    <DotsSixVertical
                                                                                                        size={
                                                                                                            14
                                                                                                        }
                                                                                                    />
                                                                                                </SortableDragHandle>
                                                                                                {canEditAllowed && (
                                                                                                <MyButton
                                                                                                    buttonType="secondary"
                                                                                                    layoutVariant="icon"
                                                                                                    scale="small"
                                                                                                    onClick={(
                                                                                                        e
                                                                                                    ) => {
                                                                                                        e.stopPropagation();
                                                                                                        openEditDialog(
                                                                                                            'module',
                                                                                                            {
                                                                                                                ...mod.module,
                                                                                                                subjectId:
                                                                                                                    subject.id,
                                                                                                            }
                                                                                                        );
                                                                                                    }}
                                                                                                    className="opacity-0 transition-opacity hover:bg-blue-100 hover:text-blue-600 group-hover/module-trigger:opacity-100"
                                                                                                >
                                                                                                    <PencilSimple
                                                                                                        size={
                                                                                                            14
                                                                                                        }
                                                                                                    />
                                                                                                </MyButton>
                                                                                                )}
                                                                                                {canDeleteAllowed && (
                                                                                                <MyButton
                                                                                                    buttonType="secondary"
                                                                                                    layoutVariant="icon"
                                                                                                    scale="small"
                                                                                                    onClick={(
                                                                                                        e
                                                                                                    ) => {
                                                                                                        e.stopPropagation();
                                                                                                        openDeleteConfirmation(
                                                                                                            'module',
                                                                                                            {
                                                                                                                id: mod
                                                                                                                    .module
                                                                                                                    .id,
                                                                                                                name: mod
                                                                                                                    .module
                                                                                                                    .module_name,
                                                                                                                subjectId:
                                                                                                                    subject.id,
                                                                                                            }
                                                                                                        );
                                                                                                    }}
                                                                                                    className="opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover/module-trigger:opacity-100"
                                                                                                >
                                                                                                    <Trash
                                                                                                        size={
                                                                                                            14
                                                                                                        }
                                                                                                    />
                                                                                                </MyButton>
                                                                                                )}
                                                                                            </div>
                                                                                        )}
                                                                                    </CollapsibleTrigger>
                                                                                    <CollapsibleContent className="py-1 pl-3 sm:pl-10">
                                                                                        <div className="relative space-y-1.5 border-l-2 border-dashed border-gray-200 pl-2 sm:pl-6">
                                                                                            <AddChapterButton
                                                                                                moduleId={
                                                                                                    mod
                                                                                                        .module
                                                                                                        .id
                                                                                                }
                                                                                                sessionId={
                                                                                                    selectedSession
                                                                                                }
                                                                                                levelId={
                                                                                                    selectedLevel
                                                                                                }
                                                                                                subjectId={
                                                                                                    subject.id
                                                                                                }
                                                                                                packageSessionId={
                                                                                                    batchPackageSessionId ??
                                                                                                    ''
                                                                                                }
                                                                                                isTextButton
                                                                                            />
                                                                                            <Sortable
                                                                                                value={(
                                                                                                    mod.chapters ??
                                                                                                    []
                                                                                                ).map(
                                                                                                    (
                                                                                                        ch
                                                                                                    ) => ({
                                                                                                        ...ch,
                                                                                                        id: ch
                                                                                                            .chapter
                                                                                                            .id,
                                                                                                    })
                                                                                                )}
                                                                                                onValueChange={(
                                                                                                    reorderedChapters
                                                                                                ) =>
                                                                                                    handleChapterReorder(
                                                                                                        mod
                                                                                                            .module
                                                                                                            .id,
                                                                                                        reorderedChapters as unknown as ChapterWithSlidesStore[]
                                                                                                    )
                                                                                                }
                                                                                                orientation="vertical"
                                                                                            >
                                                                                                {(
                                                                                                    mod.chapters ??
                                                                                                    []
                                                                                                ).map(
                                                                                                    (
                                                                                                        ch,
                                                                                                        chIdx
                                                                                                    ) => {
                                                                                                        const isChapterOpen =
                                                                                                            openChapters.has(
                                                                                                                ch
                                                                                                                    .chapter
                                                                                                                    .id
                                                                                                            );
                                                                                                        return (
                                                                                                            <SortableItem
                                                                                                                key={
                                                                                                                    ch
                                                                                                                        .chapter
                                                                                                                        .id
                                                                                                                }
                                                                                                                value={
                                                                                                                    ch
                                                                                                                        .chapter
                                                                                                                        .id
                                                                                                                }
                                                                                                                asChild
                                                                                                            >
                                                                                                                <div className="group/chapter-item relative">
                                                                                                                    <Collapsible
                                                                                                                        key={
                                                                                                                            ch
                                                                                                                                .chapter
                                                                                                                                .id
                                                                                                                        }
                                                                                                                        open={
                                                                                                                            isChapterOpen
                                                                                                                        }
                                                                                                                        onOpenChange={() =>
                                                                                                                            toggleChapter(
                                                                                                                                ch
                                                                                                                                    .chapter
                                                                                                                                    .id
                                                                                                                            )
                                                                                                                        }
                                                                                                                        className="group/chapter"
                                                                                                                    >
                                                                                                                        <CollapsibleTrigger className="group/chapter-trigger flex w-full items-center rounded-md px-2 py-1 text-left text-sm font-semibold text-gray-700 transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                                                                                                                            <div className="flex flex-1 items-center gap-2">
                                                                                                                                {isChapterOpen ? (
                                                                                                                                    <CaretDown
                                                                                                                                        size={
                                                                                                                                            14
                                                                                                                                        }
                                                                                                                                        className="shrink-0 text-gray-500"
                                                                                                                                    />
                                                                                                                                ) : (
                                                                                                                                    <CaretRight
                                                                                                                                        size={
                                                                                                                                            14
                                                                                                                                        }
                                                                                                                                        className="shrink-0 text-gray-500"
                                                                                                                                    />
                                                                                                                                )}
                                                                                                                                <PresentationChart
                                                                                                                                    size={
                                                                                                                                        16
                                                                                                                                    }
                                                                                                                                    weight="duotone"
                                                                                                                                    className="shrink-0 text-green-600"
                                                                                                                                />
                                                                                                                                {roleDisplay
                                                                                                                                    ?.coursePage
                                                                                                                                    ?.viewContentNumbering !==
                                                                                                                                    false && (
                                                                                                                                        <span className="w-7 shrink-0 rounded-md bg-gray-100 py-0.5 text-center font-mono text-xs text-gray-500 group-hover/chapter:bg-white">
                                                                                                                                            C
                                                                                                                                            {chIdx +
                                                                                                                                                1}
                                                                                                                                        </span>
                                                                                                                                    )}
                                                                                                                                <span
                                                                                                                                    className="min-w-0 flex-1 truncate"
                                                                                                                                    title={
                                                                                                                                        ch
                                                                                                                                            .chapter
                                                                                                                                            .chapter_name
                                                                                                                                    }
                                                                                                                                >
                                                                                                                                    {convertCapitalToTitleCase(
                                                                                                                                        ch
                                                                                                                                            .chapter
                                                                                                                                            .chapter_name
                                                                                                                                    )}
                                                                                                                                </span>
                                                                                                                            </div>
                                                                                                                            {!readOnly && (
                                                                                                                                <div className="flex items-center gap-1">
                                                                                                                                    {canEditStructure && (
                                                                                                                                        <SortableDragHandle className="inline-flex size-6 cursor-grab items-center justify-center rounded-md border border-neutral-300 opacity-0 transition-opacity hover:bg-gray-100 group-hover/chapter-trigger:opacity-100">
                                                                                                                                            <DotsSixVertical
                                                                                                                                                size={
                                                                                                                                                    14
                                                                                                                                                }
                                                                                                                                            />
                                                                                                                                        </SortableDragHandle>
                                                                                                                                    )}
                                                                                {(canEditAllowed || canDeleteAllowed || dripConditionsEnabled) && (
                                                                                                                                    <DropdownMenu>
                                                                                                                                        <DropdownMenuTrigger
                                                                                                                                            asChild
                                                                                                                                        >
                                                                                                                                            <MyButton
                                                                                                                                                buttonType="secondary"
                                                                                                                                                layoutVariant="icon"
                                                                                                                                                scale="small"
                                                                                                                                                onClick={(
                                                                                                                                                    e
                                                                                                                                                ) => {
                                                                                                                                                    e.stopPropagation();
                                                                                                                                                }}
                                                                                                                                                className="opacity-0 transition-opacity group-hover/chapter-trigger:opacity-100"
                                                                                                                                            >
                                                                                                                                                <DotsThree
                                                                                                                                                    size={
                                                                                                                                                        16
                                                                                                                                                    }
                                                                                                                                                    weight="bold"
                                                                                                                                                />
                                                                                                                                            </MyButton>
                                                                                                                                        </DropdownMenuTrigger>
                                                                                                                                        <DropdownMenuContent
                                                                                                                                            align="end"
                                                                                                                                            onClick={(
                                                                                                                                                e
                                                                                                                                            ) =>
                                                                                                                                                e.stopPropagation()
                                                                                                                                            }
                                                                                                                                        >
                                                                                                                                            {canEditAllowed && (
                                                                                                                                            <DropdownMenuItem
                                                                                                                                                onClick={(
                                                                                                                                                    e
                                                                                                                                                ) => {
                                                                                                                                                    e.stopPropagation();
                                                                                                                                                    openEditDialog(
                                                                                                                                                        'chapter',
                                                                                                                                                        {
                                                                                                                                                            ...ch.chapter,
                                                                                                                                                            subjectId:
                                                                                                                                                                subject.id,
                                                                                                                                                            moduleId:
                                                                                                                                                                mod
                                                                                                                                                                    .module
                                                                                                                                                                    .id,
                                                                                                                                                            chapter_in_package_sessions: ch.chapter_in_package_sessions,
                                                                                                                                                        }
                                                                                                                                                    );
                                                                                                                                                }}
                                                                                                                                            >
                                                                                                                                                <PencilSimple
                                                                                                                                                    size={
                                                                                                                                                        16
                                                                                                                                                    }
                                                                                                                                                    className="mr-2"
                                                                                                                                                />
                                                                                                                                                {t('actions.edit')}
                                                                                                                                            </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                            {canDeleteAllowed && (
                                                                                                                                            <DropdownMenuItem
                                                                                                                                                onClick={(
                                                                                                                                                    e
                                                                                                                                                ) => {
                                                                                                                                                    e.stopPropagation();
                                                                                                                                                    openDeleteConfirmation(
                                                                                                                                                        'chapter',
                                                                                                                                                        {
                                                                                                                                                            id: ch
                                                                                                                                                                .chapter
                                                                                                                                                                .id,
                                                                                                                                                            name: ch
                                                                                                                                                                .chapter
                                                                                                                                                                .chapter_name,
                                                                                                                                                            subjectId:
                                                                                                                                                                subject.id,
                                                                                                                                                            moduleId:
                                                                                                                                                                mod
                                                                                                                                                                    .module
                                                                                                                                                                    .id,
                                                                                                                                                        }
                                                                                                                                                    );
                                                                                                                                                }}
                                                                                                                                                className="text-red-600 focus:text-red-600"
                                                                                                                                            >
                                                                                                                                                <Trash
                                                                                                                                                    size={
                                                                                                                                                        16
                                                                                                                                                    }
                                                                                                                                                    className="mr-2"
                                                                                                                                                />
                                                                                                                                                {t('actions.delete')}
                                                                                                                                            </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                            {dripConditionsEnabled && (
                                                                                                                                                <DropdownMenuItem
                                                                                                                                                    onClick={(
                                                                                                                                                        e
                                                                                                                                                    ) => {
                                                                                                                                                        e.stopPropagation();
                                                                                                                                                        handleOpenDripDialog(
                                                                                                                                                            'chapter',
                                                                                                                                                            ch
                                                                                                                                                                .chapter
                                                                                                                                                                .id,
                                                                                                                                                            ch
                                                                                                                                                                .chapter
                                                                                                                                                                .chapter_name
                                                                                                                                                        );
                                                                                                                                                    }}
                                                                                                                                                >
                                                                                                                                                    <LockSimple
                                                                                                                                                        size={
                                                                                                                                                            16
                                                                                                                                                        }
                                                                                                                                                        className="mr-2 text-purple-600"
                                                                                                                                                    />
                                                                                                                                                    {t('actions.unlockRule')}
                                                                                                                                                </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                            {offlineAccessEnabled && (
                                                                                                                                                <DropdownMenuItem
                                                                                                                                                    onClick={(e) => {
                                                                                                                                                        e.stopPropagation();
                                                                                                                                                        handleOpenChapterOfflineDialog(
                                                                                                                                                            ch.chapter.id,
                                                                                                                                                            ch.chapter.chapter_name
                                                                                                                                                        );
                                                                                                                                                    }}
                                                                                                                                                >
                                                                                                                                                    <WifiSlash size={14} className="mr-2 text-primary-500" />
                                                                                                                                                    {t('actions.offlineAvailability')}
                                                                                                                                                </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                        </DropdownMenuContent>
                                                                                                                                    </DropdownMenu>
                                                                                )}
                                                                                                                                </div>
                                                                                                                            )}
                                                                                                                        </CollapsibleTrigger>
                                                                                                                        <CollapsibleContent className="py-1 pl-2 sm:pl-9">
                                                                                                                            <div className="relative space-y-1.5 border-l-2 border-dashed border-gray-200 pl-2 sm:pl-6">
                                                                                                                                {!readOnly && showAddSlide && (
                                                                                                                                    <MyButton
                                                                                                                                        buttonType="text"
                                                                                                                                        onClick={(
                                                                                                                                            e
                                                                                                                                        ) => {
                                                                                                                                            e.stopPropagation();
                                                                                                                                            handleChapterNavigation(
                                                                                                                                                subject.id,
                                                                                                                                                mod
                                                                                                                                                    .module
                                                                                                                                                    .id,
                                                                                                                                                ch
                                                                                                                                                    .chapter
                                                                                                                                                    .id
                                                                                                                                            );
                                                                                                                                        }}
                                                                                                                                        className="!m-0 flex w-fit cursor-pointer flex-row items-center justify-start gap-2 px-0 pl-2 text-primary-500"
                                                                                                                                    >
                                                                                                                                        <Plus
                                                                                                                                            size={
                                                                                                                                                14
                                                                                                                                            }
                                                                                                                                            weight="bold"
                                                                                                                                            className="text-primary-400 group-hover:text-primary-500"
                                                                                                                                        />
                                                                                                                                        <span className="font-medium">
                                                                                                                                            {t('add')}{' '}
                                                                                                                                            {getTerminology(ContentTerms.Slides, SystemTerms.Slides)}
                                                                                                                                        </span>
                                                                                                                                    </MyButton>
                                                                                                                                )}

                                                                                                                                {(
                                                                                                                                    chapterSlidesMap[
                                                                                                                                    ch
                                                                                                                                        .chapter
                                                                                                                                        .id
                                                                                                                                    ] ??
                                                                                                                                    []
                                                                                                                                )
                                                                                                                                    .length ===
                                                                                                                                    0 ? (
                                                                                                                                    <div className="px-2 py-1 text-xs text-gray-400">
                                                                                                                                        {t('noSlidesInChapter', {
                                                                                                                                            term: getTerminology(ContentTerms.Slides, SystemTerms.Slides),
                                                                                                                                        })}
                                                                                                                                    </div>
                                                                                                                                ) : (
                                                                                                                                    (
                                                                                                                                        chapterSlidesMap[
                                                                                                                                        ch
                                                                                                                                            .chapter
                                                                                                                                            .id
                                                                                                                                        ] ??
                                                                                                                                        []
                                                                                                                                    ).map(
                                                                                                                                        (
                                                                                                                                            slide,
                                                                                                                                            sIdx
                                                                                                                                        ) => (
                                                                                                                                            <div
                                                                                                                                                key={
                                                                                                                                                    slide.id
                                                                                                                                                }
                                                                                                                                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                                                                                                                                                onClick={() => {
                                                                                                                                                    if (
                                                                                                                                                        blockReadOnlyClick
                                                                                                                                                    )
                                                                                                                                                        return;
                                                                                                                                                    handleSlideNavigation(
                                                                                                                                                        subject.id,
                                                                                                                                                        mod
                                                                                                                                                            .module
                                                                                                                                                            .id,
                                                                                                                                                        ch
                                                                                                                                                            .chapter
                                                                                                                                                            .id,
                                                                                                                                                        slide.id
                                                                                                                                                    );
                                                                                                                                                }}
                                                                                                                                            >
                                                                                                                                                {roleDisplay
                                                                                                                                                    ?.coursePage
                                                                                                                                                    ?.viewContentNumbering !==
                                                                                                                                                    false && (
                                                                                                                                                        <span className="w-7 shrink-0 text-center font-mono text-xs text-gray-400">
                                                                                                                                                            S
                                                                                                                                                            {sIdx +
                                                                                                                                                                1}
                                                                                                                                                        </span>
                                                                                                                                                    )}
                                                                                                                                                {getIcon(
                                                                                                                                                    (
                                                                                                                                                        slide as any
                                                                                                                                                    )
                                                                                                                                                        .html_video_slide
                                                                                                                                                        ? 'HTML_VIDEO'
                                                                                                                                                        : slide.source_type,
                                                                                                                                                    slide
                                                                                                                                                        .document_slide
                                                                                                                                                        ?.type,
                                                                                                                                                    '3'
                                                                                                                                                )}
                                                                                                                                                <span
                                                                                                                                                    className="min-w-0 flex-1 truncate"
                                                                                                                                                    title={
                                                                                                                                                        slide.title
                                                                                                                                                    }
                                                                                                                                                >
                                                                                                                                                    {
                                                                                                                                                        slide.title
                                                                                                                                                    }
                                                                                                                                                </span>
                                                                                                                                            </div>
                                                                                                                                        )
                                                                                                                                    )
                                                                                                                                )}
                                                                                                                            </div>
                                                                                                                        </CollapsibleContent>
                                                                                                                    </Collapsible>
                                                                                                                </div>
                                                                                                            </SortableItem>
                                                                                                        );
                                                                                                    }
                                                                                                )}
                                                                                            </Sortable>
                                                                                        </div>
                                                                                    </CollapsibleContent>
                                                                                </Collapsible>
                                                                            </div>
                                                                        </SortableItem>
                                                                    );
                                                                })}
                                                            </Sortable>
                                                        </div>
                                                    </CollapsibleContent>
                                                </Collapsible>
                                            </div>
                                        </SortableItem>
                                    );
                                })}
                            </Sortable>
                        )}
                        {courseStructure === 4 && (
                            <Sortable
                                value={subjects}
                                onValueChange={handleSubjectReorder}
                                orientation="vertical"
                            >
                                {subjects.map((subject) => {
                                    const isSubjectOpen = openSubjects.has(subject.id);

                                    return (
                                        <SortableItem key={subject.id} value={subject.id} asChild>
                                            <div className="group/subject-item relative">
                                                <Collapsible
                                                    open={isSubjectOpen}
                                                    onOpenChange={
                                                        blockReadOnlyClick
                                                            ? undefined
                                                            : () => toggleSubject(subject.id)
                                                    }
                                                    className="group"
                                                >
                                                    <CollapsibleContent className="py-1">
                                                        <div className="relative space-y-1.5 border-gray-200">
                                                            <div className="absolute -left-[13px] top-0 h-full">
                                                                <div className="sticky top-0 flex h-full flex-col items-center" />
                                                            </div>

                                                            {canEditStructure && (
                                                                <AddModulesButton
                                                                    isTextButton
                                                                    subjectId={subject.id}
                                                                    onAddModuleBySubjectId={
                                                                        handleAddModule
                                                                    }
                                                                />
                                                            )}
                                                            <Sortable
                                                                value={(
                                                                    subjectModulesMap[subject.id] ??
                                                                    []
                                                                ).map((m) => ({
                                                                    ...m,
                                                                    id: m.module.id,
                                                                }))}
                                                                onValueChange={(reorderedModules) =>
                                                                    handleModuleReorder(
                                                                        subject.id,
                                                                        reorderedModules as unknown as {
                                                                            module: Module;
                                                                            chapters: ChapterWithSlidesStore[];
                                                                        }[]
                                                                    )
                                                                }
                                                                orientation="vertical"
                                                            >
                                                                {(
                                                                    subjectModulesMap[subject.id] ??
                                                                    []
                                                                ).map((mod, modIdx) => {
                                                                    const isModuleOpen =
                                                                        openModules.has(
                                                                            mod.module.id
                                                                        );

                                                                    return (
                                                                        <SortableItem
                                                                            key={mod.module.id}
                                                                            value={mod.module.id}
                                                                            asChild
                                                                        >
                                                                            <div className="group/module-item relative">
                                                                                <Collapsible
                                                                                    open={
                                                                                        isModuleOpen
                                                                                    }
                                                                                    onOpenChange={() =>
                                                                                        toggleModule(
                                                                                            mod
                                                                                                .module
                                                                                                .id
                                                                                        )
                                                                                    }
                                                                                    className="group/module"
                                                                                >
                                                                                    <CollapsibleTrigger className="group/module-trigger flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                                                                                        <div className="flex flex-1 items-center gap-2.5">
                                                                                            {isModuleOpen ? (
                                                                                                <CaretDown
                                                                                                    size={
                                                                                                        16
                                                                                                    }
                                                                                                    className="shrink-0 text-gray-500"
                                                                                                />
                                                                                            ) : (
                                                                                                <CaretRight
                                                                                                    size={
                                                                                                        16
                                                                                                    }
                                                                                                    className="shrink-0 text-gray-500"
                                                                                                />
                                                                                            )}
                                                                                            <FileText
                                                                                                size={
                                                                                                    18
                                                                                                }
                                                                                                weight="duotone"
                                                                                                className="shrink-0 text-blue-600"
                                                                                            />
                                                                                            {roleDisplay
                                                                                                ?.coursePage
                                                                                                ?.viewContentNumbering !==
                                                                                                false && (
                                                                                                    <span className="w-7 shrink-0 rounded-md bg-gray-100 py-0.5 text-center font-mono text-xs font-medium text-gray-500 group-hover/module:bg-white">
                                                                                                        M
                                                                                                        {modIdx +
                                                                                                            1}
                                                                                                    </span>
                                                                                                )}
                                                                                            <span
                                                                                                className="min-w-0 flex-1 truncate"
                                                                                                title={
                                                                                                    mod
                                                                                                        .module
                                                                                                        .module_name
                                                                                                }
                                                                                            >
                                                                                                {convertCapitalToTitleCase(
                                                                                                    mod
                                                                                                        .module
                                                                                                        .module_name
                                                                                                )}
                                                                                            </span>
                                                                                        </div>
                                                                                        {canEditStructure && (
                                                                                            <div className="flex gap-1">
                                                                                                <SortableDragHandle className="inline-flex size-6 cursor-grab items-center justify-center rounded-md border border-neutral-300 opacity-0 transition-opacity hover:bg-gray-100 group-hover/module-trigger:opacity-100">
                                                                                                    <DotsSixVertical
                                                                                                        size={
                                                                                                            14
                                                                                                        }
                                                                                                    />
                                                                                                </SortableDragHandle>
                                                                                                {canEditAllowed && (
                                                                                                <MyButton
                                                                                                    buttonType="secondary"
                                                                                                    layoutVariant="icon"
                                                                                                    scale="small"
                                                                                                    onClick={(
                                                                                                        e
                                                                                                    ) => {
                                                                                                        e.stopPropagation();
                                                                                                        openEditDialog(
                                                                                                            'module',
                                                                                                            {
                                                                                                                ...mod.module,
                                                                                                                subjectId:
                                                                                                                    subject.id,
                                                                                                            }
                                                                                                        );
                                                                                                    }}
                                                                                                    className="opacity-0 transition-opacity hover:bg-blue-100 hover:text-blue-600 group-hover/module-trigger:opacity-100"
                                                                                                >
                                                                                                    <PencilSimple
                                                                                                        size={
                                                                                                            14
                                                                                                        }
                                                                                                    />
                                                                                                </MyButton>
                                                                                                )}
                                                                                                {canDeleteAllowed && (
                                                                                                <MyButton
                                                                                                    buttonType="secondary"
                                                                                                    layoutVariant="icon"
                                                                                                    scale="small"
                                                                                                    onClick={(
                                                                                                        e
                                                                                                    ) => {
                                                                                                        e.stopPropagation();
                                                                                                        openDeleteConfirmation(
                                                                                                            'module',
                                                                                                            {
                                                                                                                id: mod
                                                                                                                    .module
                                                                                                                    .id,
                                                                                                                name: mod
                                                                                                                    .module
                                                                                                                    .module_name,
                                                                                                                subjectId:
                                                                                                                    subject.id,
                                                                                                            }
                                                                                                        );
                                                                                                    }}
                                                                                                    className="opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover/module-trigger:opacity-100"
                                                                                                >
                                                                                                    <Trash
                                                                                                        size={
                                                                                                            14
                                                                                                        }
                                                                                                    />
                                                                                                </MyButton>
                                                                                                )}
                                                                                            </div>
                                                                                        )}
                                                                                    </CollapsibleTrigger>
                                                                                    <CollapsibleContent className="py-1 pl-3 sm:pl-10">
                                                                                        <div className="relative space-y-1.5 border-l-2 border-dashed border-gray-200 pl-2 sm:pl-6">
                                                                                            <AddChapterButton
                                                                                                moduleId={
                                                                                                    mod
                                                                                                        .module
                                                                                                        .id
                                                                                                }
                                                                                                sessionId={
                                                                                                    selectedSession
                                                                                                }
                                                                                                levelId={
                                                                                                    selectedLevel
                                                                                                }
                                                                                                subjectId={
                                                                                                    subject.id
                                                                                                }
                                                                                                packageSessionId={
                                                                                                    batchPackageSessionId ??
                                                                                                    ''
                                                                                                }
                                                                                                isTextButton
                                                                                            />
                                                                                            <Sortable
                                                                                                value={(
                                                                                                    mod.chapters ??
                                                                                                    []
                                                                                                ).map(
                                                                                                    (
                                                                                                        ch
                                                                                                    ) => ({
                                                                                                        ...ch,
                                                                                                        id: ch
                                                                                                            .chapter
                                                                                                            .id,
                                                                                                    })
                                                                                                )}
                                                                                                onValueChange={(
                                                                                                    reorderedChapters
                                                                                                ) =>
                                                                                                    handleChapterReorder(
                                                                                                        mod
                                                                                                            .module
                                                                                                            .id,
                                                                                                        reorderedChapters as unknown as ChapterWithSlidesStore[]
                                                                                                    )
                                                                                                }
                                                                                                orientation="vertical"
                                                                                            >
                                                                                                {(
                                                                                                    mod.chapters ??
                                                                                                    []
                                                                                                ).map(
                                                                                                    (
                                                                                                        ch,
                                                                                                        chIdx
                                                                                                    ) => {
                                                                                                        const isChapterOpen =
                                                                                                            openChapters.has(
                                                                                                                ch
                                                                                                                    .chapter
                                                                                                                    .id
                                                                                                            );
                                                                                                        return (
                                                                                                            <SortableItem
                                                                                                                key={
                                                                                                                    ch
                                                                                                                        .chapter
                                                                                                                        .id
                                                                                                                }
                                                                                                                value={
                                                                                                                    ch
                                                                                                                        .chapter
                                                                                                                        .id
                                                                                                                }
                                                                                                                asChild
                                                                                                            >
                                                                                                                <div className="group/chapter-item relative">
                                                                                                                    <Collapsible
                                                                                                                        key={
                                                                                                                            ch
                                                                                                                                .chapter
                                                                                                                                .id
                                                                                                                        }
                                                                                                                        open={
                                                                                                                            isChapterOpen
                                                                                                                        }
                                                                                                                        onOpenChange={() =>
                                                                                                                            toggleChapter(
                                                                                                                                ch
                                                                                                                                    .chapter
                                                                                                                                    .id
                                                                                                                            )
                                                                                                                        }
                                                                                                                        className="group/chapter"
                                                                                                                    >
                                                                                                                        <CollapsibleTrigger className="group/chapter-trigger flex w-full items-center rounded-md px-2 py-1 text-left text-sm font-semibold text-gray-700 transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                                                                                                                            <div className="flex flex-1 items-center gap-2">
                                                                                                                                {isChapterOpen ? (
                                                                                                                                    <CaretDown
                                                                                                                                        size={
                                                                                                                                            14
                                                                                                                                        }
                                                                                                                                        className="shrink-0 text-gray-500"
                                                                                                                                    />
                                                                                                                                ) : (
                                                                                                                                    <CaretRight
                                                                                                                                        size={
                                                                                                                                            14
                                                                                                                                        }
                                                                                                                                        className="shrink-0 text-gray-500"
                                                                                                                                    />
                                                                                                                                )}
                                                                                                                                <PresentationChart
                                                                                                                                    size={
                                                                                                                                        16
                                                                                                                                    }
                                                                                                                                    weight="duotone"
                                                                                                                                    className="shrink-0 text-green-600"
                                                                                                                                />
                                                                                                                                {roleDisplay
                                                                                                                                    ?.coursePage
                                                                                                                                    ?.viewContentNumbering !==
                                                                                                                                    false && (
                                                                                                                                        <span className="w-7 shrink-0 rounded-md bg-gray-100 py-0.5 text-center font-mono text-xs text-gray-500 group-hover/chapter:bg-white">
                                                                                                                                            C
                                                                                                                                            {chIdx +
                                                                                                                                                1}
                                                                                                                                        </span>
                                                                                                                                    )}
                                                                                                                                <span
                                                                                                                                    className="min-w-0 flex-1 truncate"
                                                                                                                                    title={
                                                                                                                                        ch
                                                                                                                                            .chapter
                                                                                                                                            .chapter_name
                                                                                                                                    }
                                                                                                                                >
                                                                                                                                    {convertCapitalToTitleCase(
                                                                                                                                        ch
                                                                                                                                            .chapter
                                                                                                                                            .chapter_name
                                                                                                                                    )}
                                                                                                                                </span>
                                                                                                                            </div>
                                                                                                                            {canEditStructure && (
                                                                                                                                <div className="flex items-center gap-1">
                                                                                                                                    <SortableDragHandle className="inline-flex size-6 cursor-grab items-center justify-center rounded-md border border-neutral-300 opacity-0 transition-opacity hover:bg-gray-100 group-hover/chapter-trigger:opacity-100">
                                                                                                                                        <DotsSixVertical
                                                                                                                                            size={
                                                                                                                                                14
                                                                                                                                            }
                                                                                                                                        />
                                                                                                                                    </SortableDragHandle>
                                                                                {(canEditAllowed || canDeleteAllowed || dripConditionsEnabled) && (
                                                                                                                                    <DropdownMenu>
                                                                                                                                        <DropdownMenuTrigger
                                                                                                                                            asChild
                                                                                                                                        >
                                                                                                                                            <MyButton
                                                                                                                                                buttonType="secondary"
                                                                                                                                                layoutVariant="icon"
                                                                                                                                                scale="small"
                                                                                                                                                onClick={(
                                                                                                                                                    e
                                                                                                                                                ) => {
                                                                                                                                                    e.stopPropagation();
                                                                                                                                                }}
                                                                                                                                                className="opacity-0 transition-opacity group-hover/chapter-trigger:opacity-100"
                                                                                                                                            >
                                                                                                                                                <DotsThree
                                                                                                                                                    size={
                                                                                                                                                        16
                                                                                                                                                    }
                                                                                                                                                    weight="bold"
                                                                                                                                                />
                                                                                                                                            </MyButton>
                                                                                                                                        </DropdownMenuTrigger>
                                                                                                                                        <DropdownMenuContent
                                                                                                                                            align="end"
                                                                                                                                            onClick={(
                                                                                                                                                e
                                                                                                                                            ) =>
                                                                                                                                                e.stopPropagation()
                                                                                                                                            }
                                                                                                                                        >
                                                                                                                                            {canEditAllowed && (
                                                                                                                                            <DropdownMenuItem
                                                                                                                                                onClick={(
                                                                                                                                                    e
                                                                                                                                                ) => {
                                                                                                                                                    e.stopPropagation();
                                                                                                                                                    openEditDialog(
                                                                                                                                                        'chapter',
                                                                                                                                                        {
                                                                                                                                                            ...ch.chapter,
                                                                                                                                                            subjectId:
                                                                                                                                                                subject.id,
                                                                                                                                                            moduleId:
                                                                                                                                                                mod
                                                                                                                                                                    .module
                                                                                                                                                                    .id,
                                                                                                                                                            chapter_in_package_sessions: ch.chapter_in_package_sessions,
                                                                                                                                                        }
                                                                                                                                                    );
                                                                                                                                                }}
                                                                                                                                            >
                                                                                                                                                <PencilSimple
                                                                                                                                                    size={
                                                                                                                                                        16
                                                                                                                                                    }
                                                                                                                                                    className="mr-2"
                                                                                                                                                />
                                                                                                                                                {t('actions.edit')}
                                                                                                                                            </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                            {canDeleteAllowed && (
                                                                                                                                            <DropdownMenuItem
                                                                                                                                                onClick={(
                                                                                                                                                    e
                                                                                                                                                ) => {
                                                                                                                                                    e.stopPropagation();
                                                                                                                                                    openDeleteConfirmation(
                                                                                                                                                        'chapter',
                                                                                                                                                        {
                                                                                                                                                            id: ch
                                                                                                                                                                .chapter
                                                                                                                                                                .id,
                                                                                                                                                            name: ch
                                                                                                                                                                .chapter
                                                                                                                                                                .chapter_name,
                                                                                                                                                            subjectId:
                                                                                                                                                                subject.id,
                                                                                                                                                            moduleId:
                                                                                                                                                                mod
                                                                                                                                                                    .module
                                                                                                                                                                    .id,
                                                                                                                                                        }
                                                                                                                                                    );
                                                                                                                                                }}
                                                                                                                                                className="text-red-600 focus:text-red-600"
                                                                                                                                            >
                                                                                                                                                <Trash
                                                                                                                                                    size={
                                                                                                                                                        16
                                                                                                                                                    }
                                                                                                                                                    className="mr-2"
                                                                                                                                                />
                                                                                                                                                {t('actions.delete')}
                                                                                                                                            </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                            {dripConditionsEnabled && (
                                                                                                                                                <DropdownMenuItem
                                                                                                                                                    onClick={(
                                                                                                                                                        e
                                                                                                                                                    ) => {
                                                                                                                                                        e.stopPropagation();
                                                                                                                                                        handleOpenDripDialog(
                                                                                                                                                            'chapter',
                                                                                                                                                            ch
                                                                                                                                                                .chapter
                                                                                                                                                                .id,
                                                                                                                                                            ch
                                                                                                                                                                .chapter
                                                                                                                                                                .chapter_name
                                                                                                                                                        );
                                                                                                                                                    }}
                                                                                                                                                >
                                                                                                                                                    <LockSimple
                                                                                                                                                        size={
                                                                                                                                                            16
                                                                                                                                                        }
                                                                                                                                                        className="mr-2 text-purple-600"
                                                                                                                                                    />
                                                                                                                                                    {t('actions.unlockRule')}
                                                                                                                                                </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                            {offlineAccessEnabled && (
                                                                                                                                                <DropdownMenuItem
                                                                                                                                                    onClick={(e) => {
                                                                                                                                                        e.stopPropagation();
                                                                                                                                                        handleOpenChapterOfflineDialog(
                                                                                                                                                            ch.chapter.id,
                                                                                                                                                            ch.chapter.chapter_name
                                                                                                                                                        );
                                                                                                                                                    }}
                                                                                                                                                >
                                                                                                                                                    <WifiSlash size={14} className="mr-2 text-primary-500" />
                                                                                                                                                    {t('actions.offlineAvailability')}
                                                                                                                                                </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                        </DropdownMenuContent>
                                                                                                                                    </DropdownMenu>
                                                                                )}
                                                                                                                                </div>
                                                                                                                            )}
                                                                                                                        </CollapsibleTrigger>
                                                                                                                        <CollapsibleContent className="py-1 pl-2 sm:pl-9">
                                                                                                                            <div className="relative space-y-1.5 border-l-2 border-dashed border-gray-200 pl-2 sm:pl-6">
                                                                                                                                {!readOnly && showAddSlide && (
                                                                                                                                    <MyButton
                                                                                                                                        buttonType="text"
                                                                                                                                        onClick={(
                                                                                                                                            e
                                                                                                                                        ) => {
                                                                                                                                            e.stopPropagation();
                                                                                                                                            handleChapterNavigation(
                                                                                                                                                subject.id,
                                                                                                                                                mod
                                                                                                                                                    .module
                                                                                                                                                    .id,
                                                                                                                                                ch
                                                                                                                                                    .chapter
                                                                                                                                                    .id
                                                                                                                                            );
                                                                                                                                        }}
                                                                                                                                        className="!m-0 flex w-fit cursor-pointer flex-row items-center justify-start gap-2 px-0 pl-2 text-primary-500"
                                                                                                                                    >
                                                                                                                                        <Plus
                                                                                                                                            size={
                                                                                                                                                14
                                                                                                                                            }
                                                                                                                                            weight="bold"
                                                                                                                                            className="text-primary-400 group-hover:text-primary-500"
                                                                                                                                        />
                                                                                                                                        <span className="font-medium">
                                                                                                                                            {t('add')}{' '}
                                                                                                                                            {getTerminology(ContentTerms.Slides, SystemTerms.Slides)}
                                                                                                                                        </span>
                                                                                                                                    </MyButton>
                                                                                                                                )}

                                                                                                                                {(
                                                                                                                                    chapterSlidesMap[
                                                                                                                                    ch
                                                                                                                                        .chapter
                                                                                                                                        .id
                                                                                                                                    ] ??
                                                                                                                                    []
                                                                                                                                )
                                                                                                                                    .length ===
                                                                                                                                    0 ? (
                                                                                                                                    <div className="px-2 py-1 text-xs text-gray-400">
                                                                                                                                        {t('noSlidesInChapter', {
                                                                                                                                            term: getTerminology(ContentTerms.Slides, SystemTerms.Slides),
                                                                                                                                        })}
                                                                                                                                    </div>
                                                                                                                                ) : (
                                                                                                                                    (
                                                                                                                                        chapterSlidesMap[
                                                                                                                                        ch
                                                                                                                                            .chapter
                                                                                                                                            .id
                                                                                                                                        ] ??
                                                                                                                                        []
                                                                                                                                    ).map(
                                                                                                                                        (
                                                                                                                                            slide,
                                                                                                                                            sIdx
                                                                                                                                        ) => (
                                                                                                                                            <div
                                                                                                                                                key={
                                                                                                                                                    slide.id
                                                                                                                                                }
                                                                                                                                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                                                                                                                                                onClick={() => {
                                                                                                                                                    if (
                                                                                                                                                        blockReadOnlyClick
                                                                                                                                                    )
                                                                                                                                                        return;
                                                                                                                                                    handleSlideNavigation(
                                                                                                                                                        subject.id,
                                                                                                                                                        mod
                                                                                                                                                            .module
                                                                                                                                                            .id,
                                                                                                                                                        ch
                                                                                                                                                            .chapter
                                                                                                                                                            .id,
                                                                                                                                                        slide.id
                                                                                                                                                    );
                                                                                                                                                }}
                                                                                                                                            >
                                                                                                                                                {roleDisplay
                                                                                                                                                    ?.coursePage
                                                                                                                                                    ?.viewContentNumbering !==
                                                                                                                                                    false && (
                                                                                                                                                        <span className="w-7 shrink-0 text-center font-mono text-xs text-gray-400">
                                                                                                                                                            S
                                                                                                                                                            {sIdx +
                                                                                                                                                                1}
                                                                                                                                                        </span>
                                                                                                                                                    )}
                                                                                                                                                {getIcon(
                                                                                                                                                    (
                                                                                                                                                        slide as any
                                                                                                                                                    )
                                                                                                                                                        .html_video_slide
                                                                                                                                                        ? 'HTML_VIDEO'
                                                                                                                                                        : slide.source_type,
                                                                                                                                                    slide
                                                                                                                                                        .document_slide
                                                                                                                                                        ?.type,
                                                                                                                                                    '3'
                                                                                                                                                )}
                                                                                                                                                <span
                                                                                                                                                    className="min-w-0 flex-1 truncate"
                                                                                                                                                    title={
                                                                                                                                                        slide.title
                                                                                                                                                    }
                                                                                                                                                >
                                                                                                                                                    {
                                                                                                                                                        slide.title
                                                                                                                                                    }
                                                                                                                                                </span>
                                                                                                                                            </div>
                                                                                                                                        )
                                                                                                                                    )
                                                                                                                                )}
                                                                                                                            </div>
                                                                                                                        </CollapsibleContent>
                                                                                                                    </Collapsible>
                                                                                                                </div>
                                                                                                            </SortableItem>
                                                                                                        );
                                                                                                    }
                                                                                                )}
                                                                                            </Sortable>
                                                                                        </div>
                                                                                    </CollapsibleContent>
                                                                                </Collapsible>
                                                                            </div>
                                                                        </SortableItem>
                                                                    );
                                                                })}
                                                            </Sortable>
                                                        </div>
                                                    </CollapsibleContent>
                                                </Collapsible>
                                            </div>
                                        </SortableItem>
                                    );
                                })}
                            </Sortable>
                        )}
                        {courseStructure === 3 && (
                            <Sortable
                                value={subjects}
                                onValueChange={handleSubjectReorder}
                                orientation="vertical"
                            >
                                {subjects.map((subject) => {
                                    const isSubjectOpen = openSubjects.has(subject.id);

                                    return (
                                        <SortableItem key={subject.id} value={subject.id} asChild>
                                            <div className="group/subject-item">
                                                <Collapsible
                                                    open={isSubjectOpen}
                                                    onOpenChange={
                                                        blockReadOnlyClick
                                                            ? undefined
                                                            : () => toggleSubject(subject.id)
                                                    }
                                                    className="group"
                                                >
                                                    <CollapsibleContent className="py-1">
                                                        <div className="relative space-y-1.5 border-gray-200">
                                                            <div className="absolute -left-[13px] top-0 h-full">
                                                                <div className="sticky top-0 flex h-full flex-col items-center" />
                                                            </div>

                                                            <Sortable
                                                                value={(
                                                                    subjectModulesMap[subject.id] ??
                                                                    []
                                                                ).map((m) => ({
                                                                    ...m,
                                                                    id: m.module.id,
                                                                }))}
                                                                onValueChange={(reorderedModules) =>
                                                                    handleModuleReorder(
                                                                        subject.id,
                                                                        reorderedModules as unknown as {
                                                                            module: Module;
                                                                            chapters: ChapterWithSlidesStore[];
                                                                        }[]
                                                                    )
                                                                }
                                                                orientation="vertical"
                                                            >
                                                                {(
                                                                    subjectModulesMap[subject.id] ??
                                                                    []
                                                                ).map((mod, modIdx) => {
                                                                    const isModuleOpen =
                                                                        openModules.has(
                                                                            mod.module.id
                                                                        );

                                                                    return (
                                                                        <SortableItem
                                                                            key={mod.module.id}
                                                                            value={mod.module.id}
                                                                            asChild
                                                                        >
                                                                            <div className="group/module-item relative">
                                                                                <Collapsible
                                                                                    open={
                                                                                        isModuleOpen
                                                                                    }
                                                                                    onOpenChange={() =>
                                                                                        toggleModule(
                                                                                            mod
                                                                                                .module
                                                                                                .id
                                                                                        )
                                                                                    }
                                                                                    className="group/module"
                                                                                >
                                                                                    <CollapsibleContent className="py-1">
                                                                                        <div className="relative space-y-1.5  border-gray-200">
                                                                                            <AddChapterButton
                                                                                                moduleId={
                                                                                                    mod
                                                                                                        .module
                                                                                                        .id
                                                                                                }
                                                                                                sessionId={
                                                                                                    selectedSession
                                                                                                }
                                                                                                levelId={
                                                                                                    selectedLevel
                                                                                                }
                                                                                                subjectId={
                                                                                                    subject.id
                                                                                                }
                                                                                                packageSessionId={
                                                                                                    batchPackageSessionId ??
                                                                                                    ''
                                                                                                }
                                                                                                isTextButton
                                                                                            />
                                                                                            <Sortable
                                                                                                value={(
                                                                                                    mod.chapters ??
                                                                                                    []
                                                                                                ).map(
                                                                                                    (
                                                                                                        ch
                                                                                                    ) => ({
                                                                                                        ...ch,
                                                                                                        id: ch
                                                                                                            .chapter
                                                                                                            .id,
                                                                                                    })
                                                                                                )}
                                                                                                onValueChange={(
                                                                                                    reorderedChapters
                                                                                                ) =>
                                                                                                    handleChapterReorder(
                                                                                                        mod
                                                                                                            .module
                                                                                                            .id,
                                                                                                        reorderedChapters as unknown as ChapterWithSlidesStore[]
                                                                                                    )
                                                                                                }
                                                                                                orientation="vertical"
                                                                                            >
                                                                                                {(
                                                                                                    mod.chapters ??
                                                                                                    []
                                                                                                ).map(
                                                                                                    (
                                                                                                        ch,
                                                                                                        chIdx
                                                                                                    ) => {
                                                                                                        const isChapterOpen =
                                                                                                            openChapters.has(
                                                                                                                ch
                                                                                                                    .chapter
                                                                                                                    .id
                                                                                                            );
                                                                                                        return (
                                                                                                            <SortableItem
                                                                                                                key={
                                                                                                                    ch
                                                                                                                        .chapter
                                                                                                                        .id
                                                                                                                }
                                                                                                                value={
                                                                                                                    ch
                                                                                                                        .chapter
                                                                                                                        .id
                                                                                                                }
                                                                                                                asChild
                                                                                                            >
                                                                                                                <div className="group/chapter-item relative">
                                                                                                                    <Collapsible
                                                                                                                        key={
                                                                                                                            ch
                                                                                                                                .chapter
                                                                                                                                .id
                                                                                                                        }
                                                                                                                        open={
                                                                                                                            isChapterOpen
                                                                                                                        }
                                                                                                                        onOpenChange={() =>
                                                                                                                            toggleChapter(
                                                                                                                                ch
                                                                                                                                    .chapter
                                                                                                                                    .id
                                                                                                                            )
                                                                                                                        }
                                                                                                                        className="group/chapter"
                                                                                                                    >
                                                                                                                        <CollapsibleTrigger className="group/chapter-trigger flex w-full items-center rounded-md px-2 py-1 text-left text-sm font-semibold text-gray-700 transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                                                                                                                            <div className="flex flex-1 items-center gap-2">
                                                                                                                                {isChapterOpen ? (
                                                                                                                                    <CaretDown
                                                                                                                                        size={
                                                                                                                                            14
                                                                                                                                        }
                                                                                                                                        className="shrink-0 text-gray-500"
                                                                                                                                    />
                                                                                                                                ) : (
                                                                                                                                    <CaretRight
                                                                                                                                        size={
                                                                                                                                            14
                                                                                                                                        }
                                                                                                                                        className="shrink-0 text-gray-500"
                                                                                                                                    />
                                                                                                                                )}
                                                                                                                                <PresentationChart
                                                                                                                                    size={
                                                                                                                                        16
                                                                                                                                    }
                                                                                                                                    weight="duotone"
                                                                                                                                    className="shrink-0 text-green-600"
                                                                                                                                />
                                                                                                                                {roleDisplay
                                                                                                                                    ?.coursePage
                                                                                                                                    ?.viewContentNumbering !==
                                                                                                                                    false && (
                                                                                                                                        <span className="w-7 shrink-0 rounded-md bg-gray-100 py-0.5 text-center font-mono text-xs text-gray-500 group-hover/chapter:bg-white">
                                                                                                                                            C
                                                                                                                                            {chIdx +
                                                                                                                                                1}
                                                                                                                                        </span>
                                                                                                                                    )}
                                                                                                                                <span
                                                                                                                                    className="min-w-0 flex-1 truncate"
                                                                                                                                    title={
                                                                                                                                        ch
                                                                                                                                            .chapter
                                                                                                                                            .chapter_name
                                                                                                                                    }
                                                                                                                                >
                                                                                                                                    {convertCapitalToTitleCase(
                                                                                                                                        ch
                                                                                                                                            .chapter
                                                                                                                                            .chapter_name
                                                                                                                                    )}
                                                                                                                                </span>
                                                                                                                            </div>
                                                                                                                            {canEditStructure && (
                                                                                                                                <div className="flex items-center gap-1">
                                                                                                                                    <SortableDragHandle className="inline-flex size-6 cursor-grab items-center justify-center rounded-md border border-neutral-300 opacity-0 transition-opacity hover:bg-gray-100 group-hover/chapter-trigger:opacity-100">
                                                                                                                                        <DotsSixVertical
                                                                                                                                            size={
                                                                                                                                                14
                                                                                                                                            }
                                                                                                                                        />
                                                                                                                                    </SortableDragHandle>
                                                                                {(canEditAllowed || canDeleteAllowed || dripConditionsEnabled) && (
                                                                                                                                    <DropdownMenu>
                                                                                                                                        <DropdownMenuTrigger
                                                                                                                                            asChild
                                                                                                                                        >
                                                                                                                                            <MyButton
                                                                                                                                                buttonType="secondary"
                                                                                                                                                layoutVariant="icon"
                                                                                                                                                scale="small"
                                                                                                                                                onClick={(
                                                                                                                                                    e
                                                                                                                                                ) => {
                                                                                                                                                    e.stopPropagation();
                                                                                                                                                }}
                                                                                                                                                className="opacity-0 transition-opacity group-hover/chapter-trigger:opacity-100"
                                                                                                                                            >
                                                                                                                                                <DotsThree
                                                                                                                                                    size={
                                                                                                                                                        16
                                                                                                                                                    }
                                                                                                                                                    weight="bold"
                                                                                                                                                />
                                                                                                                                            </MyButton>
                                                                                                                                        </DropdownMenuTrigger>
                                                                                                                                        <DropdownMenuContent
                                                                                                                                            align="end"
                                                                                                                                            onClick={(
                                                                                                                                                e
                                                                                                                                            ) =>
                                                                                                                                                e.stopPropagation()
                                                                                                                                            }
                                                                                                                                        >
                                                                                                                                            {canEditAllowed && (
                                                                                                                                            <DropdownMenuItem
                                                                                                                                                onClick={(
                                                                                                                                                    e
                                                                                                                                                ) => {
                                                                                                                                                    e.stopPropagation();
                                                                                                                                                    openEditDialog(
                                                                                                                                                        'chapter',
                                                                                                                                                        {
                                                                                                                                                            ...ch.chapter,
                                                                                                                                                            subjectId:
                                                                                                                                                                subject.id,
                                                                                                                                                            moduleId:
                                                                                                                                                                mod
                                                                                                                                                                    .module
                                                                                                                                                                    .id,
                                                                                                                                                            chapter_in_package_sessions: ch.chapter_in_package_sessions,
                                                                                                                                                        }
                                                                                                                                                    );
                                                                                                                                                }}
                                                                                                                                            >
                                                                                                                                                <PencilSimple
                                                                                                                                                    size={
                                                                                                                                                        16
                                                                                                                                                    }
                                                                                                                                                    className="mr-2"
                                                                                                                                                />
                                                                                                                                                {t('actions.edit')}
                                                                                                                                            </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                            {canDeleteAllowed && (
                                                                                                                                            <DropdownMenuItem
                                                                                                                                                onClick={(
                                                                                                                                                    e
                                                                                                                                                ) => {
                                                                                                                                                    e.stopPropagation();
                                                                                                                                                    openDeleteConfirmation(
                                                                                                                                                        'chapter',
                                                                                                                                                        {
                                                                                                                                                            id: ch
                                                                                                                                                                .chapter
                                                                                                                                                                .id,
                                                                                                                                                            name: ch
                                                                                                                                                                .chapter
                                                                                                                                                                .chapter_name,
                                                                                                                                                            subjectId:
                                                                                                                                                                subject.id,
                                                                                                                                                            moduleId:
                                                                                                                                                                mod
                                                                                                                                                                    .module
                                                                                                                                                                    .id,
                                                                                                                                                        }
                                                                                                                                                    );
                                                                                                                                                }}
                                                                                                                                                className="text-red-600 focus:text-red-600"
                                                                                                                                            >
                                                                                                                                                <Trash
                                                                                                                                                    size={
                                                                                                                                                        16
                                                                                                                                                    }
                                                                                                                                                    className="mr-2"
                                                                                                                                                />
                                                                                                                                                {t('actions.delete')}
                                                                                                                                            </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                            {dripConditionsEnabled && (
                                                                                                                                                <DropdownMenuItem
                                                                                                                                                    onClick={(
                                                                                                                                                        e
                                                                                                                                                    ) => {
                                                                                                                                                        e.stopPropagation();
                                                                                                                                                        handleOpenDripDialog(
                                                                                                                                                            'chapter',
                                                                                                                                                            ch
                                                                                                                                                                .chapter
                                                                                                                                                                .id,
                                                                                                                                                            ch
                                                                                                                                                                .chapter
                                                                                                                                                                .chapter_name
                                                                                                                                                        );
                                                                                                                                                    }}
                                                                                                                                                >
                                                                                                                                                    <LockSimple
                                                                                                                                                        size={
                                                                                                                                                            16
                                                                                                                                                        }
                                                                                                                                                        className="mr-2 text-purple-600"
                                                                                                                                                    />
                                                                                                                                                    {t('actions.unlockRule')}
                                                                                                                                                </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                            {offlineAccessEnabled && (
                                                                                                                                                <DropdownMenuItem
                                                                                                                                                    onClick={(e) => {
                                                                                                                                                        e.stopPropagation();
                                                                                                                                                        handleOpenChapterOfflineDialog(
                                                                                                                                                            ch.chapter.id,
                                                                                                                                                            ch.chapter.chapter_name
                                                                                                                                                        );
                                                                                                                                                    }}
                                                                                                                                                >
                                                                                                                                                    <WifiSlash size={14} className="mr-2 text-primary-500" />
                                                                                                                                                    {t('actions.offlineAvailability')}
                                                                                                                                                </DropdownMenuItem>
                                                                                                                                            )}
                                                                                                                                        </DropdownMenuContent>
                                                                                                                                    </DropdownMenu>
                                                                                )}
                                                                                                                                </div>
                                                                                                                            )}
                                                                                                                        </CollapsibleTrigger>
                                                                                                                        <CollapsibleContent className="py-1 pl-2 sm:pl-9">
                                                                                                                            <div className="relative space-y-1.5 border-l-2 border-dashed border-gray-200 pl-2 sm:pl-6">
                                                                                                                                {showAddSlide && (
                                                                                                                                <MyButton
                                                                                                                                    buttonType="text"
                                                                                                                                    onClick={(
                                                                                                                                        e
                                                                                                                                    ) => {
                                                                                                                                        e.stopPropagation();
                                                                                                                                        handleChapterNavigation(
                                                                                                                                            subject.id,
                                                                                                                                            mod
                                                                                                                                                .module
                                                                                                                                                .id,
                                                                                                                                            ch
                                                                                                                                                .chapter
                                                                                                                                                .id
                                                                                                                                        );
                                                                                                                                    }}
                                                                                                                                    className="!m-0 flex w-fit cursor-pointer flex-row items-center justify-start gap-2 px-0 pl-2 text-primary-500"
                                                                                                                                >
                                                                                                                                    <Plus
                                                                                                                                        size={
                                                                                                                                            14
                                                                                                                                        }
                                                                                                                                        weight="bold"
                                                                                                                                        className="text-primary-400 group-hover:text-primary-500"
                                                                                                                                    />
                                                                                                                                    <span className="font-medium">
                                                                                                                                        {t('add')}{' '}
                                                                                                                                        {getTerminology(ContentTerms.Slides, SystemTerms.Slides)}
                                                                                                                                    </span>
                                                                                                                                </MyButton>
                                                                                                                                )}

                                                                                                                                {(
                                                                                                                                    chapterSlidesMap[
                                                                                                                                    ch
                                                                                                                                        .chapter
                                                                                                                                        .id
                                                                                                                                    ] ??
                                                                                                                                    []
                                                                                                                                )
                                                                                                                                    .length ===
                                                                                                                                    0 ? (
                                                                                                                                    <div className="px-2 py-1 text-xs text-gray-400">
                                                                                                                                        {t('noSlidesInChapter', {
                                                                                                                                            term: getTerminology(ContentTerms.Slides, SystemTerms.Slides),
                                                                                                                                        })}
                                                                                                                                    </div>
                                                                                                                                ) : (
                                                                                                                                    (
                                                                                                                                        chapterSlidesMap[
                                                                                                                                        ch
                                                                                                                                            .chapter
                                                                                                                                            .id
                                                                                                                                        ] ??
                                                                                                                                        []
                                                                                                                                    ).map(
                                                                                                                                        (
                                                                                                                                            slide,
                                                                                                                                            sIdx
                                                                                                                                        ) => (
                                                                                                                                            <div
                                                                                                                                                key={
                                                                                                                                                    slide.id
                                                                                                                                                }
                                                                                                                                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                                                                                                                                                onClick={() => {
                                                                                                                                                    if (
                                                                                                                                                        blockReadOnlyClick
                                                                                                                                                    )
                                                                                                                                                        return;
                                                                                                                                                    handleSlideNavigation(
                                                                                                                                                        subject.id,
                                                                                                                                                        mod
                                                                                                                                                            .module
                                                                                                                                                            .id,
                                                                                                                                                        ch
                                                                                                                                                            .chapter
                                                                                                                                                            .id,
                                                                                                                                                        slide.id
                                                                                                                                                    );
                                                                                                                                                }}
                                                                                                                                            >
                                                                                                                                                {roleDisplay
                                                                                                                                                    ?.coursePage
                                                                                                                                                    ?.viewContentNumbering !==
                                                                                                                                                    false && (
                                                                                                                                                        <span className="w-7 shrink-0 text-center font-mono text-xs text-gray-400">
                                                                                                                                                            S
                                                                                                                                                            {sIdx +
                                                                                                                                                                1}
                                                                                                                                                        </span>
                                                                                                                                                    )}
                                                                                                                                                {getIcon(
                                                                                                                                                    (
                                                                                                                                                        slide as any
                                                                                                                                                    )
                                                                                                                                                        .html_video_slide
                                                                                                                                                        ? 'HTML_VIDEO'
                                                                                                                                                        : slide.source_type,
                                                                                                                                                    slide
                                                                                                                                                        .document_slide
                                                                                                                                                        ?.type,
                                                                                                                                                    '3'
                                                                                                                                                )}
                                                                                                                                                <span
                                                                                                                                                    className="min-w-0 flex-1 truncate"
                                                                                                                                                    title={
                                                                                                                                                        slide.title
                                                                                                                                                    }
                                                                                                                                                >
                                                                                                                                                    {
                                                                                                                                                        slide.title
                                                                                                                                                    }
                                                                                                                                                </span>
                                                                                                                                            </div>
                                                                                                                                        )
                                                                                                                                    )
                                                                                                                                )}
                                                                                                                            </div>
                                                                                                                        </CollapsibleContent>
                                                                                                                    </Collapsible>
                                                                                                                </div>
                                                                                                            </SortableItem>
                                                                                                        );
                                                                                                    }
                                                                                                )}
                                                                                            </Sortable>
                                                                                        </div>
                                                                                    </CollapsibleContent>
                                                                                </Collapsible>
                                                                            </div>
                                                                        </SortableItem>
                                                                    );
                                                                })}
                                                            </Sortable>
                                                        </div>
                                                    </CollapsibleContent>
                                                </Collapsible>
                                            </div>
                                        </SortableItem>
                                    );
                                })}
                            </Sortable>
                        )}

                        {courseStructure === 2 && (
                            <div className="space-y-1.5">
                                {Object.entries(subjectModulesMap).flatMap(([subjectId, modules]) =>
                                    modules.flatMap((mod) =>
                                        mod.chapters.flatMap((ch) => [
                                            // Add Slide button for this chapter (now before slides)
                                            ...(showAddSlide ? [
                                            <MyButton
                                                key={`add-slide-${ch.chapter.id}`}
                                                buttonType="text"
                                                onClick={() =>
                                                    readOnly
                                                        ? undefined
                                                        : handleSlideNavigation(
                                                            subjectId,
                                                            mod.module.id,
                                                            ch.chapter.id,
                                                            '' // Empty slideId for new slide
                                                        )
                                                }
                                                className="!m-0 flex w-fit cursor-pointer flex-row items-center justify-start gap-2 px-0 pl-2 text-primary-500"
                                            >
                                                <Plus
                                                    size={14}
                                                    weight="bold"
                                                    className="text-primary-400 group-hover:text-primary-500"
                                                />
                                                <span className="font-medium">
                                                    {t('add')}{' '}
                                                    {getTerminology(ContentTerms.Slides, SystemTerms.Slides)}
                                                </span>
                                            </MyButton>,
                                            ] : []),
                                            // Slides for this chapter
                                            ...(chapterSlidesMap[ch.chapter.id] ?? []).map(
                                                (slide, sIdx) => (
                                                    <div
                                                        key={slide.id}
                                                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                                                        onClick={() => {
                                                            handleSlideNavigation(
                                                                subjectId,
                                                                mod.module.id,
                                                                ch.chapter.id,
                                                                slide.id
                                                            );
                                                        }}
                                                    >
                                                        {roleDisplay?.coursePage
                                                            ?.viewContentNumbering !== false && (
                                                                <span className="w-7 shrink-0 text-center font-mono text-xs text-gray-400">
                                                                    S{sIdx + 1}
                                                                </span>
                                                            )}
                                                        {getIcon(
                                                            (slide as any).html_video_slide
                                                                ? 'HTML_VIDEO'
                                                                : slide.source_type,
                                                            slide.document_slide?.type,
                                                            '3',
                                                            slide
                                                        )}
                                                        <span
                                                            className="min-w-0 flex-1 truncate"
                                                            title={slide.title}
                                                        >
                                                            {slide.title || t('numbering.slide', { number: sIdx + 1 })}
                                                        </span>
                                                    </div>
                                                )
                                            ),
                                        ])
                                    )
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        ),
        [TabType.STUDENT]: (
            <div className="rounded-md bg-white p-6 py-2 text-sm text-gray-600 shadow-sm">
                {currentSession && (
                    <Students
                        packageSessionId={batchPackageSessionId ?? ''}
                        currentSession={currentSession}
                    />
                )}
            </div>
        ),
        [TabType.TEACHERS]: (
            <div className="p-6 py-2">
                <div className="flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
                    <div className="flex-1">
                        <h2 className="text-base font-semibold text-gray-800">
                            {t('manageTeachers', {
                                teacher: getTerminologyPlural(
                                    RoleTerms.Teacher,
                                    SystemTerms.Teacher
                                ),
                            })}
                        </h2>
                        <p className="mt-0.5 text-xs text-gray-500">
                            {t('viewAndManageTeachers', {
                                teacher: getTerminologyPlural(
                                    RoleTerms.Teacher,
                                    SystemTerms.Teacher
                                ).toLocaleLowerCase(),
                            })}
                        </p>
                    </div>
                    <AddTeachers packageSessionId={batchPackageSessionId ?? ''} courseId={courseId} />
                </div>
                <TeachersList packageSessionId={batchPackageSessionId ?? ''} />
            </div>
        ),
        [TabType.ASSESSMENT]: (
            <div className="rounded-md bg-white p-6 py-2 text-sm text-gray-600 shadow-sm">
                <Assessments packageSessionId={batchPackageSessionId ?? ''} />
            </div>
        ),
        [TabType.QUIZ_RESULTS]: (
            <div className="rounded-md bg-white p-4 shadow-sm">
                <QuizResultsTab packageSessionId={batchPackageSessionId ?? ''} />
            </div>
        ),
        [TabType.LIVE_SESSION]: batchPackageSessionId ? (
            <div className="rounded-md bg-white text-sm text-gray-600 shadow-sm">
                <LiveSessions packageSessionId={batchPackageSessionId} />
            </div>
        ) : (
            <div className="rounded-md bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
                {t('selectBatchFor.liveSessions')}
            </div>
        ),
        [TabType.REPORTS]: batchPackageSessionId ? (
            <div className="space-y-4 rounded-md bg-white p-4 text-sm text-gray-600 shadow-sm">
                <BatchReports packageSessionId={batchPackageSessionId} courseId={courseId} />
            </div>
        ) : (
            <div className="rounded-md bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
                {t('selectBatchFor.reports')}
            </div>
        ),
        // courseName is intentionally omitted — the backend falls back to the
        // package name, which is the authoritative course title.
        [TabType.CERTIFICATES]: (
            <CertificatesTab
                packageId={courseId}
                packageSessionId={batchPackageSessionId ?? ''}
            />
        ),
        [TabType.DOWNLOADS]: batchPackageSessionId ? (
            <div className="space-y-4 rounded-md bg-white p-4 text-sm text-gray-600 shadow-sm">
                <OfflineTelemetryCard packageSessionId={batchPackageSessionId} />
            </div>
        ) : (
            <div className="rounded-md bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
                {t('selectBatchFor.offlineDownloads')}
            </div>
        ),
        [TabType.CONTENT_STRUCTURE]: (
            <div className="p-6 py-2">
                <div className="mb-4">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-1">
                                <h3 className="mb-2 text-lg font-semibold text-gray-800">
                                    {t('contentStructureHeading')}
                                </h3>
                                <CopyContentLineageBadge
                                    packageSessionId={batchPackageSessionId}
                                />
                            </div>
                            <p className="text-sm text-gray-600">
                                {t('navigateFolders')}
                            </p>
                        </div>
                        {canCopyContent && (
                            <MyButton
                                buttonType="secondary"
                                onClick={() => setShowCopyContentDialog(true)}
                                className="flex items-center gap-1.5 !px-3 !py-1 text-xs"
                                disable={copyCourseContentMutation.isPending}
                            >
                                <Copy size={14} weight="bold" />
                                {copyCourseContentMutation.isPending
                                    ? t('importContent.importing')
                                    : t('importContent.importButton')}
                            </MyButton>
                        )}
                    </div>

                    {/* Breadcrumb Navigation */}
                    {navigationBreadcrumb.length > 0 && (
                        <div className="mt-3 flex items-center space-x-2 text-sm">
                            <button
                                onClick={() => navigateToLevel(-1)}
                                className="text-blue-600 hover:text-blue-800"
                            >
                                {getTerminology(ContentTerms.Course, SystemTerms.Course)}
                            </button>
                            {navigationBreadcrumb.map((crumb, index) => (
                                <div key={crumb.id} className="flex items-center space-x-2">
                                    <span className="text-gray-400">/</span>
                                    <button
                                        onClick={() => navigateToLevel(index)}
                                        className="text-blue-600 hover:text-blue-800"
                                    >
                                        {crumb.name}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Folder Grid View */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-1 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2">
                    {/* Show Subjects (Course Structure 5 or when at subjects level) */}
                    {courseStructure === 5 && currentNavigationLevel === 'subjects' && (
                        <Sortable
                            value={subjects}
                            strategy={rectSortingStrategy}
                            onValueChange={handleSubjectReorder}
                        >
                            {subjects.map((subject, idx) => (
                                <SortableItem
                                    key={subject.id}
                                    value={subject.id}
                                    className="group relative"
                                >
                                    <div
                                        onClick={() =>
                                            handleSubjectClick(subject.id, subject.subject_name)
                                        }
                                        className="cursor-pointer rounded-lg border border-gray-200 bg-white p-2 transition-shadow duration-200 hover:shadow-md"
                                    >
                                        {/* Folder Icon/Image */}
                                        <ThumbnailImage
                                            thumbnailId={subject.thumbnail_id}
                                            fallbackIcon={
                                                <Folder
                                                    size={96}
                                                    weight="duotone"
                                                    className="text-blue-600"
                                                />
                                            }
                                            fallbackColor="bg-gradient-to-br from-blue-50 to-blue-100"
                                        />

                                        {/* Folder Title */}
                                        <h4
                                            className="mb-1 truncate text-sm font-medium text-gray-800"
                                            title={subject.subject_name}
                                        >
                                            {convertCapitalToTitleCase(subject.subject_name)}
                                        </h4>

                                        {/* Subject Number */}
                                        {roleDisplay?.coursePage?.viewContentNumbering !==
                                            false && (
                                                <p className="text-xs text-gray-500">
                                                    {t('numbering.subject', { number: idx + 1 })}
                                                </p>
                                            )}

                                        {/* Edit and Delete Buttons */}
                                        {canEditStructure && (
                                            <div className="absolute right-2 top-2 flex gap-1">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <button className="rounded-full p-1 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100">
                                                            <DotsThree size={16} weight="bold" />
                                                        </button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        {canEditAllowed && (
                                                        <DropdownMenuItem
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openEditDialog('subject', subject);
                                                            }}
                                                        >
                                                            <PencilSimple
                                                                size={14}
                                                                className="mr-2 text-blue-600"
                                                            />
                                                            {t('actions.edit')}
                                                        </DropdownMenuItem>
                                                        )}
                                                        {canDeleteAllowed && (
                                                        <DropdownMenuItem
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openDeleteConfirmation('subject', {
                                                                    id: subject.id,
                                                                    name: subject.subject_name,
                                                                });
                                                            }}
                                                            className="text-red-600"
                                                        >
                                                            <Trash size={14} className="mr-2" />
                                                            {t('actions.delete')}
                                                        </DropdownMenuItem>
                                                        )}
                                                        {dripConditionsEnabled && (
                                                            <DropdownMenuItem
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleOpenDripDialog(
                                                                        'subject',
                                                                        subject.id,
                                                                        subject.subject_name
                                                                    );
                                                                }}
                                                            >
                                                                <LockSimple
                                                                    size={14}
                                                                    className="mr-2 text-purple-600"
                                                                />
                                                                {t('actions.unlockRule')}
                                                            </DropdownMenuItem>
                                                        )}
                                                        {/* Sets the rule for every chapter under
                                                            this subject at once — the resolver
                                                            walks SUBJECT -> MODULE -> CHAPTER, so
                                                            anything below still overrides it. */}
                                                        {offlineAccessEnabled && (
                                                            <DropdownMenuItem
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleOpenOfflineDialog(
                                                                        'SUBJECT',
                                                                        subject.id,
                                                                        subject.subject_name
                                                                    );
                                                                }}
                                                            >
                                                                <WifiSlash
                                                                    size={14}
                                                                    className="mr-2 text-primary-500"
                                                                />
                                                                {t('actions.offlineAvailability')}
                                                            </DropdownMenuItem>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        )}
                                    </div>
                                </SortableItem>
                            ))}
                        </Sortable>
                    )}

                    {/* Show Modules for Course Structure 5 when at modules level */}
                    {courseStructure === 5 &&
                        currentNavigationLevel === 'modules' &&
                        selectedSubjectId && (
                            <Sortable
                                value={(subjectModulesMap[selectedSubjectId] ?? []).map((m) => ({
                                    ...m,
                                    id: m.module.id,
                                }))}
                                strategy={rectSortingStrategy}
                                onValueChange={(reordered) =>
                                    handleModuleReorder(
                                        selectedSubjectId,
                                        reordered as unknown as ModuleWithChapters[]
                                    )
                                }
                            >
                                {(subjectModulesMap[selectedSubjectId] ?? []).map(
                                    (mod: ModuleWithChapters, modIdx: number) => (
                                        <SortableItem
                                            key={mod.module.id}
                                            value={mod.module.id}
                                            asChild
                                            className="group relative"
                                        >
                                            <div
                                                onClick={() =>
                                                    handleModuleClick(
                                                        mod.module.id,
                                                        mod.module.module_name
                                                    )
                                                }
                                                className="rounded-lg border border-gray-200 bg-white p-2 transition-shadow duration-200 hover:shadow-md"
                                            >
                                                {/* Folder Icon/Image */}
                                                <ThumbnailImage
                                                    thumbnailId={mod.module.thumbnail_id}
                                                    fallbackIcon={
                                                        <FileText
                                                            size={96}
                                                            weight="duotone"
                                                            className="text-green-600"
                                                        />
                                                    }
                                                    fallbackColor="bg-gradient-to-br from-green-50 to-green-100"
                                                />

                                                {/* Folder Title */}
                                                <h4
                                                    className="mb-1 truncate text-sm font-medium text-gray-800"
                                                    title={mod.module.module_name}
                                                >
                                                    {convertCapitalToTitleCase(
                                                        mod.module.module_name
                                                    )}
                                                </h4>

                                                {/* Module Number */}
                                                {roleDisplay?.coursePage?.viewContentNumbering !==
                                                    false && (
                                                        <p className="text-xs text-gray-500">
                                                            {t('numbering.module', { number: modIdx + 1 })}
                                                        </p>
                                                    )}

                                                {/* Module Description */}
                                                {showContentDescription && (
                                                    <FolderDescription
                                                        description={mod.module.description}
                                                    />
                                                )}

                                                {/* Edit and Delete Buttons */}
                                                {canEditStructure && (
                                                    <div className="absolute right-2 top-2 flex gap-1">
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <button className="rounded-full p-1 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100">
                                                                    <DotsThree
                                                                        size={16}
                                                                        weight="bold"
                                                                    />
                                                                </button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end">
                                                                {canEditAllowed && (
                                                                <DropdownMenuItem
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openEditDialog('module', {
                                                                            ...mod.module,
                                                                            subjectId:
                                                                                selectedSubjectId,
                                                                        });
                                                                    }}
                                                                >
                                                                    <PencilSimple
                                                                        size={14}
                                                                        className="mr-2 text-blue-600"
                                                                    />
                                                                    {t('actions.edit')}
                                                                </DropdownMenuItem>
                                                                )}
                                                                {canDeleteAllowed && (
                                                                <DropdownMenuItem
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openDeleteConfirmation(
                                                                            'module',
                                                                            {
                                                                                id: mod.module.id,
                                                                                name: mod.module
                                                                                    .module_name,
                                                                                subjectId:
                                                                                    selectedSubjectId,
                                                                            }
                                                                        );
                                                                    }}
                                                                    className="text-red-600"
                                                                >
                                                                    <Trash
                                                                        size={14}
                                                                        className="mr-2"
                                                                    />
                                                                    {t('actions.delete')}
                                                                </DropdownMenuItem>
                                                                )}
                                                                {dripConditionsEnabled && (
                                                                    <DropdownMenuItem
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleOpenDripDialog(
                                                                                'module',
                                                                                mod.module.id,
                                                                                mod.module.module_name
                                                                            );
                                                                        }}
                                                                    >
                                                                        <LockSimple
                                                                            size={14}
                                                                            className="mr-2 text-purple-600"
                                                                        />
                                                                        {t('actions.unlockRule')}
                                                                    </DropdownMenuItem>
                                                                )}
                                                                {/* Same rule, one level down: covers every chapter in this
                                                                    module while leaving per-chapter overrides intact. */}
                                                                {offlineAccessEnabled && (
                                                                    <DropdownMenuItem
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleOpenOfflineDialog(
                                                                                'MODULE',
                                                                                mod.module.id,
                                                                                mod.module.module_name
                                                                            );
                                                                        }}
                                                                    >
                                                                        <WifiSlash
                                                                            size={14}
                                                                            className="mr-2 text-primary-500"
                                                                        />
                                                                        {t('actions.offlineAvailability')}
                                                                    </DropdownMenuItem>
                                                                )}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                )}
                                            </div>
                                        </SortableItem>
                                    )
                                )}
                            </Sortable>
                        )}

                    {/* Show Modules for Course Structure 4 */}
                    {courseStructure === 4 &&
                        currentNavigationLevel === 'subjects' &&
                        subjects[0] && (
                            <Sortable
                                value={(subjectModulesMap[subjects[0].id] ?? []).map((m) => ({
                                    ...m,
                                    id: m.module.id,
                                }))}
                                strategy={rectSortingStrategy}
                                onValueChange={(reordered) =>
                                    handleModuleReorder(
                                        subjects[0]?.id || '',
                                        reordered as unknown as ModuleWithChapters[]
                                    )
                                }
                            >
                                {(subjectModulesMap[subjects[0].id] ?? []).map(
                                    (mod: ModuleWithChapters, modIdx: number) => (
                                        <SortableItem
                                            key={mod.module.id}
                                            value={mod.module.id}
                                            asChild
                                            className="group relative"
                                        >
                                            <div
                                                onClick={() => {
                                                    // For courseStructure 4, navigate to show chapters
                                                    goToNavLevel({
                                                        navLevel: 'chapters',
                                                        navModuleId: mod.module.id,
                                                    });
                                                }}
                                                className="cursor-pointer rounded-lg border border-gray-200 bg-white p-2 transition-shadow duration-200 hover:shadow-md"
                                            >
                                                {/* Folder Icon/Image */}
                                                <ThumbnailImage
                                                    thumbnailId={mod.module.thumbnail_id}
                                                    fallbackIcon={
                                                        <FileText
                                                            size={96}
                                                            weight="duotone"
                                                            className="text-green-600"
                                                        />
                                                    }
                                                    fallbackColor="bg-gradient-to-br from-green-50 to-green-100"
                                                />

                                                {/* Folder Title */}
                                                <h4
                                                    className="mb-1 truncate text-sm font-medium text-gray-800"
                                                    title={mod.module.module_name}
                                                >
                                                    {convertCapitalToTitleCase(
                                                        mod.module.module_name
                                                    )}
                                                </h4>

                                                {/* Module Number */}
                                                {roleDisplay?.coursePage?.viewContentNumbering !==
                                                    false && (
                                                        <p className="text-xs text-gray-500">
                                                            {t('numbering.module', { number: modIdx + 1 })}
                                                        </p>
                                                    )}

                                                {/* Module Description */}
                                                {showContentDescription && (
                                                    <FolderDescription
                                                        description={mod.module.description}
                                                    />
                                                )}

                                                {/* Edit and Delete Buttons */}
                                                {canEditStructure && (
                                                    <div className="absolute right-2 top-2 flex gap-1">
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <button className="rounded-full p-1 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100">
                                                                    <DotsThree
                                                                        size={16}
                                                                        weight="bold"
                                                                    />
                                                                </button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end">
                                                                {canEditAllowed && (
                                                                <DropdownMenuItem
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openEditDialog('module', {
                                                                            ...mod.module,
                                                                            subjectId:
                                                                                subjects[0]?.id,
                                                                        });
                                                                    }}
                                                                >
                                                                    <PencilSimple
                                                                        size={14}
                                                                        className="mr-2 text-blue-600"
                                                                    />
                                                                    {t('actions.edit')}
                                                                </DropdownMenuItem>
                                                                )}
                                                                {canDeleteAllowed && (
                                                                <DropdownMenuItem
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openDeleteConfirmation(
                                                                            'module',
                                                                            {
                                                                                id: mod.module.id,
                                                                                name: mod.module
                                                                                    .module_name,
                                                                                subjectId:
                                                                                    subjects[0]?.id,
                                                                            }
                                                                        );
                                                                    }}
                                                                    className="text-red-600"
                                                                >
                                                                    <Trash
                                                                        size={14}
                                                                        className="mr-2"
                                                                    />
                                                                    {t('actions.delete')}
                                                                </DropdownMenuItem>
                                                                )}
                                                                {dripConditionsEnabled && (
                                                                    <DropdownMenuItem
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleOpenDripDialog(
                                                                                'module',
                                                                                mod.module.id,
                                                                                mod.module.module_name
                                                                            );
                                                                        }}
                                                                    >
                                                                        <LockSimple
                                                                            size={14}
                                                                            className="mr-2 text-purple-600"
                                                                        />
                                                                        {t('actions.unlockRule')}
                                                                    </DropdownMenuItem>
                                                                )}
                                                                {/* Same rule, one level down: covers every chapter in this
                                                                    module while leaving per-chapter overrides intact. */}
                                                                {offlineAccessEnabled && (
                                                                    <DropdownMenuItem
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleOpenOfflineDialog(
                                                                                'MODULE',
                                                                                mod.module.id,
                                                                                mod.module.module_name
                                                                            );
                                                                        }}
                                                                    >
                                                                        <WifiSlash
                                                                            size={14}
                                                                            className="mr-2 text-primary-500"
                                                                        />
                                                                        {t('actions.offlineAvailability')}
                                                                    </DropdownMenuItem>
                                                                )}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                )}
                                            </div>
                                        </SortableItem>
                                    )
                                )}
                            </Sortable>
                        )}

                    {/* Show Chapters for Course Structure 5 when at chapters level */}
                    {courseStructure === 5 &&
                        currentNavigationLevel === 'chapters' &&
                        selectedSubjectId &&
                        selectedModuleId && (
                            <Sortable
                                value={(
                                    subjectModulesMap[selectedSubjectId]?.find(
                                        (mod) => mod.module.id === selectedModuleId
                                    )?.chapters ?? []
                                ).map((c) => ({ ...c, id: c.chapter.id }))}
                                strategy={rectSortingStrategy}
                                onValueChange={(reordered) =>
                                    handleChapterReorder(
                                        selectedModuleId,
                                        reordered as unknown as ChapterWithSlidesStore[]
                                    )
                                }
                            >
                                {(
                                    subjectModulesMap[selectedSubjectId]?.find(
                                        (mod) => mod.module.id === selectedModuleId
                                    )?.chapters ?? []
                                ).map((ch: ChapterMetadata, chIdx: number) => (
                                    <SortableItem
                                        key={ch.chapter.id}
                                        value={ch.chapter.id}
                                        asChild
                                        className="group relative"
                                    >
                                        <div
                                            onClick={() => {
                                                if (blockReadOnlyClick) return;
                                                // Navigate to chapter slides
                                                handleChapterNavigation(
                                                    selectedSubjectId,
                                                    selectedModuleId,
                                                    ch.chapter.id
                                                );
                                            }}
                                            className="rounded-lg border border-gray-200 bg-white p-2 transition-shadow duration-200 hover:shadow-md"
                                        >
                                            {/* Folder Icon/Image */}
                                            <ThumbnailImage
                                                thumbnailId={ch.chapter.file_id}
                                                fallbackIcon={
                                                    <PresentationChart
                                                        size={96}
                                                        weight="duotone"
                                                        className="text-purple-600"
                                                    />
                                                }
                                                fallbackColor="bg-gradient-to-br from-purple-50 to-purple-100"
                                            />

                                            {/* Folder Title */}
                                            <h4
                                                className="mb-1 truncate text-sm font-medium text-gray-800"
                                                title={ch.chapter.chapter_name}
                                            >
                                                {convertCapitalToTitleCase(ch.chapter.chapter_name)}
                                            </h4>

                                            {/* Chapter Number */}
                                            {roleDisplay?.coursePage?.viewContentNumbering !==
                                                false && (
                                                    <p className="text-xs text-gray-500">
                                                        {t('numbering.chapter', { number: chIdx + 1 })}
                                                    </p>
                                                )}

                                            {/* Chapter Description */}
                                            {showContentDescription && (
                                                <FolderDescription
                                                    description={getAuthoredChapterDescription(
                                                        ch.chapter.description
                                                    )}
                                                />
                                            )}

                                            {/* Edit and Delete Buttons */}
                                            {canEditStructure && (
                                                <div className="absolute right-2 top-2 flex gap-1">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <button className="rounded-full p-1 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100">
                                                                <DotsThree
                                                                    size={16}
                                                                    weight="bold"
                                                                />
                                                            </button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            {canEditAllowed && (
                                                            <DropdownMenuItem
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    openEditDialog('chapter', {
                                                                        ...ch.chapter,
                                                                        subjectId:
                                                                            selectedSubjectId,
                                                                        moduleId: selectedModuleId,
                                                                        chapter_in_package_sessions: ch.chapter_in_package_sessions,
                                                                    });
                                                                }}
                                                            >
                                                                <PencilSimple
                                                                    size={14}
                                                                    className="mr-2 text-blue-600"
                                                                />
                                                                {t('actions.edit')}
                                                            </DropdownMenuItem>
                                                            )}
                                                            {dripConditionsEnabled && (
                                                                <DropdownMenuItem
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleOpenDripDialog(
                                                                            'chapter',
                                                                            ch.chapter.id,
                                                                            ch.chapter.chapter_name
                                                                        );
                                                                    }}
                                                                >
                                                                    <LockSimple
                                                                        size={14}
                                                                        className="mr-2 text-purple-600"
                                                                    />
                                                                    {t('actions.unlockRule')}
                                                                </DropdownMenuItem>
                                                            )}
                                                            {offlineAccessEnabled && (
                                                                <DropdownMenuItem
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleOpenChapterOfflineDialog(
                                                                            ch.chapter.id,
                                                                            ch.chapter.chapter_name
                                                                        );
                                                                    }}
                                                                >
                                                                    <WifiSlash size={14} className="mr-2 text-primary-500" />
                                                                    {t('actions.offlineAvailability')}
                                                                </DropdownMenuItem>
                                                            )}
                                                            {canDeleteAllowed && (
                                                            <DropdownMenuItem
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    openDeleteConfirmation(
                                                                        'chapter',
                                                                        {
                                                                            id: ch.chapter.id,
                                                                            name: ch.chapter
                                                                                .chapter_name,
                                                                            subjectId:
                                                                                selectedSubjectId,
                                                                            moduleId:
                                                                                selectedModuleId,
                                                                        }
                                                                    );
                                                                }}
                                                                className="text-red-600"
                                                            >
                                                                <Trash size={14} className="mr-2" />
                                                                {t('actions.delete')}
                                                            </DropdownMenuItem>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            )}
                                        </div>
                                    </SortableItem>
                                ))}
                            </Sortable>
                        )}

                    {/* Show Chapters for Course Structure 4 when at chapters level */}
                    {courseStructure === 4 &&
                        currentNavigationLevel === 'chapters' &&
                        selectedModuleId &&
                        subjects[0] && (
                            <Sortable
                                value={(
                                    subjectModulesMap[subjects[0].id]?.find(
                                        (mod) => mod.module.id === selectedModuleId
                                    )?.chapters ?? []
                                ).map((c) => ({ ...c, id: c.chapter.id }))}
                                strategy={rectSortingStrategy}
                                onValueChange={(reordered) =>
                                    handleChapterReorder(
                                        selectedModuleId,
                                        reordered as unknown as ChapterWithSlidesStore[]
                                    )
                                }
                            >
                                {(
                                    subjectModulesMap[subjects[0].id]?.find(
                                        (mod) => mod.module.id === selectedModuleId
                                    )?.chapters ?? []
                                ).map((ch: ChapterMetadata, chIdx: number) => (
                                    <SortableItem
                                        key={ch.chapter.id}
                                        value={ch.chapter.id}
                                        asChild
                                        className="group relative"
                                    >
                                        <div
                                            onClick={() => {
                                                if (blockReadOnlyClick) return;
                                                // Navigate to chapter slides
                                                handleChapterNavigation(
                                                    subjects[0]?.id || '',
                                                    selectedModuleId,
                                                    ch.chapter.id
                                                );
                                            }}
                                            className="rounded-lg border border-gray-200 bg-white p-2 transition-shadow duration-200 hover:shadow-md"
                                        >
                                            {/* Folder Icon/Image */}
                                            <ThumbnailImage
                                                thumbnailId={ch.chapter.file_id}
                                                fallbackIcon={
                                                    <PresentationChart
                                                        size={96}
                                                        weight="duotone"
                                                        className="text-purple-600"
                                                    />
                                                }
                                                fallbackColor="bg-gradient-to-br from-purple-50 to-purple-100"
                                            />

                                            {/* Folder Title */}
                                            <h4
                                                className="mb-1 truncate text-sm font-medium text-gray-800"
                                                title={ch.chapter.chapter_name}
                                            >
                                                {convertCapitalToTitleCase(ch.chapter.chapter_name)}
                                            </h4>

                                            {/* Chapter Number */}
                                            {roleDisplay?.coursePage?.viewContentNumbering !==
                                                false && (
                                                    <p className="text-xs text-gray-500">
                                                        {t('numbering.chapter', { number: chIdx + 1 })}
                                                    </p>
                                                )}

                                            {/* Chapter Description */}
                                            {showContentDescription && (
                                                <FolderDescription
                                                    description={getAuthoredChapterDescription(
                                                        ch.chapter.description
                                                    )}
                                                />
                                            )}

                                            {/* Edit and Delete Buttons */}
                                            {canEditStructure && (
                                                <div className="absolute right-2 top-2 flex gap-1">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <button className="rounded-full p-1 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100">
                                                                <DotsThree
                                                                    size={16}
                                                                    weight="bold"
                                                                />
                                                            </button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            {canEditAllowed && (
                                                            <DropdownMenuItem
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    openEditDialog('chapter', {
                                                                        ...ch.chapter,
                                                                        subjectId:
                                                                            subjects[0]?.id || '',
                                                                        moduleId: selectedModuleId,
                                                                        chapter_in_package_sessions: ch.chapter_in_package_sessions,
                                                                    });
                                                                }}
                                                            >
                                                                <PencilSimple
                                                                    size={14}
                                                                    className="mr-2 text-blue-600"
                                                                />
                                                                {t('actions.edit')}
                                                            </DropdownMenuItem>
                                                            )}
                                                            {dripConditionsEnabled && (
                                                                <DropdownMenuItem
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleOpenDripDialog(
                                                                            'chapter',
                                                                            ch.chapter.id,
                                                                            ch.chapter.chapter_name
                                                                        );
                                                                    }}
                                                                >
                                                                    <LockSimple
                                                                        size={14}
                                                                        className="mr-2 text-purple-600"
                                                                    />
                                                                    {t('actions.unlockRule')}
                                                                </DropdownMenuItem>
                                                            )}
                                                            {offlineAccessEnabled && (
                                                                <DropdownMenuItem
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleOpenChapterOfflineDialog(
                                                                            ch.chapter.id,
                                                                            ch.chapter.chapter_name
                                                                        );
                                                                    }}
                                                                >
                                                                    <WifiSlash size={14} className="mr-2 text-primary-500" />
                                                                    {t('actions.offlineAvailability')}
                                                                </DropdownMenuItem>
                                                            )}
                                                            {canDeleteAllowed && (
                                                            <DropdownMenuItem
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    openDeleteConfirmation(
                                                                        'chapter',
                                                                        {
                                                                            id: ch.chapter.id,
                                                                            name: ch.chapter
                                                                                .chapter_name,
                                                                            subjectId:
                                                                                subjects[0]?.id ||
                                                                                '',
                                                                            moduleId:
                                                                                selectedModuleId,
                                                                        }
                                                                    );
                                                                }}
                                                                className="text-red-600"
                                                            >
                                                                <Trash size={14} className="mr-2" />
                                                                {t('actions.delete')}
                                                            </DropdownMenuItem>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            )}
                                        </div>
                                    </SortableItem>
                                ))}
                            </Sortable>
                        )}

                    {/* Show Chapters for Course Structure 3 */}
                    {courseStructure === 3 &&
                        currentNavigationLevel === 'subjects' &&
                        subjects[0] && (
                            <Sortable
                                value={(subjectModulesMap[subjects[0].id]?.[0]?.chapters ?? []).map(
                                    (c) => ({ ...c, id: c.chapter.id })
                                )}
                                strategy={rectSortingStrategy}
                                onValueChange={(reordered) =>
                                    handleChapterReorder(
                                        subjectModulesMap[subjects[0]?.id || '']?.[0]?.module.id ||
                                        '',
                                        reordered as unknown as ChapterWithSlidesStore[]
                                    )
                                }
                            >
                                {(subjectModulesMap[subjects[0].id]?.[0]?.chapters ?? []).map(
                                    (ch: ChapterMetadata, chIdx: number) => (
                                        <SortableItem
                                            key={ch.chapter.id}
                                            value={ch.chapter.id}
                                            asChild
                                            className="group relative"
                                        >
                                            <div
                                                onClick={() => {
                                                    if (blockReadOnlyClick) return;
                                                    // Navigate to chapter slides
                                                    handleChapterNavigation(
                                                        subjects[0]?.id || '',
                                                        subjects[0]
                                                            ? subjectModulesMap[subjects[0].id]?.[0]
                                                                ?.module.id || ''
                                                            : '',
                                                        ch.chapter.id
                                                    );
                                                }}
                                                className="rounded-lg border border-gray-200 bg-white p-2 transition-shadow duration-200 hover:shadow-md"
                                            >
                                                {/* Folder Icon/Image */}
                                                <ThumbnailImage
                                                    thumbnailId={ch.chapter.file_id}
                                                    fallbackIcon={
                                                        <PresentationChart
                                                            size={96}
                                                            weight="duotone"
                                                            className="text-purple-600"
                                                        />
                                                    }
                                                    fallbackColor="bg-gradient-to-br from-purple-50 to-purple-100"
                                                />

                                                {/* Folder Title */}
                                                <h4
                                                    className="mb-1 truncate text-sm font-medium text-gray-800"
                                                    title={ch.chapter.chapter_name}
                                                >
                                                    {convertCapitalToTitleCase(
                                                        ch.chapter.chapter_name
                                                    )}
                                                </h4>

                                                {/* Chapter Number */}
                                                {roleDisplay?.coursePage?.viewContentNumbering !==
                                                    false && (
                                                        <p className="text-xs text-gray-500">
                                                            {t('numbering.chapter', { number: chIdx + 1 })}
                                                        </p>
                                                    )}

                                                {/* Chapter Description */}
                                                <FolderDescription
                                                    description={getAuthoredChapterDescription(
                                                        ch.chapter.description
                                                    )}
                                                />

                                                {/* Edit and Delete Buttons */}
                                                {canEditStructure && (
                                                    <div className="absolute right-2 top-2 flex gap-1">
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <button className="rounded-full p-1 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100">
                                                                    <DotsThree
                                                                        size={16}
                                                                        weight="bold"
                                                                    />
                                                                </button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end">
                                                                {canEditAllowed && (
                                                                <DropdownMenuItem
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openEditDialog('chapter', {
                                                                            ...ch.chapter,
                                                                            subjectId:
                                                                                subjects[0]?.id ||
                                                                                '',
                                                                            moduleId: subjects[0]
                                                                                ? subjectModulesMap[
                                                                                    subjects[0].id
                                                                                ]?.[0]?.module.id
                                                                                : undefined,
                                                                            chapter_in_package_sessions: ch.chapter_in_package_sessions,
                                                                        });
                                                                    }}
                                                                >
                                                                    <PencilSimple
                                                                        size={14}
                                                                        className="mr-2 text-blue-600"
                                                                    />
                                                                    {t('actions.edit')}
                                                                </DropdownMenuItem>
                                                                )}
                                                                {dripConditionsEnabled && (
                                                                    <DropdownMenuItem
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleOpenDripDialog(
                                                                                'chapter',
                                                                                ch.chapter.id,
                                                                                ch.chapter
                                                                                    .chapter_name
                                                                            );
                                                                        }}
                                                                    >
                                                                        <LockSimple
                                                                            size={14}
                                                                            className="mr-2 text-purple-600"
                                                                        />
                                                                        {t('actions.unlockRule')}
                                                                    </DropdownMenuItem>
                                                                )}
                                                                {offlineAccessEnabled && (
                                                                    <DropdownMenuItem
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleOpenChapterOfflineDialog(
                                                                                ch.chapter.id,
                                                                                ch.chapter.chapter_name
                                                                            );
                                                                        }}
                                                                    >
                                                                        <WifiSlash size={14} className="mr-2 text-primary-500" />
                                                                        {t('actions.offlineAvailability')}
                                                                    </DropdownMenuItem>
                                                                )}
                                                                {canDeleteAllowed && (
                                                                <DropdownMenuItem
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openDeleteConfirmation(
                                                                            'chapter',
                                                                            {
                                                                                id: ch.chapter.id,
                                                                                name: ch.chapter
                                                                                    .chapter_name,
                                                                                subjectId:
                                                                                    subjects[0]
                                                                                        ?.id || '',
                                                                                moduleId:
                                                                                    subjects[0]
                                                                                        ? subjectModulesMap[
                                                                                            subjects[0]
                                                                                                .id
                                                                                        ]?.[0]
                                                                                            ?.module
                                                                                            .id
                                                                                        : undefined,
                                                                            }
                                                                        );
                                                                    }}
                                                                    className="text-red-600"
                                                                >
                                                                    <Trash
                                                                        size={14}
                                                                        className="mr-2"
                                                                    />
                                                                    {t('actions.delete')}
                                                                </DropdownMenuItem>
                                                                )}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                )}
                                            </div>
                                        </SortableItem>
                                    )
                                )}
                            </Sortable>
                        )}

                    {/* Show Slides for Course Structure 2 */}
                    {courseStructure === 2 &&
                        currentNavigationLevel === 'subjects' &&
                        directSlides.map((slide: Slide, sIdx: number) => (
                            <div key={slide.id} className="group relative">
                                <div
                                    onClick={() => {
                                        handleDirectSlideNavigation(slide.id);
                                    }}
                                    className="cursor-pointer rounded-lg border border-gray-200 bg-white p-2 transition-shadow duration-200 hover:shadow-md"
                                >
                                    {/* Slide Icon */}
                                    <div className="mb-3 flex aspect-square items-center justify-center rounded-lg bg-gradient-to-br from-blue-50 to-blue-100">
                                        {getIcon(
                                            (slide as any).html_video_slide
                                                ? 'HTML_VIDEO'
                                                : slide.source_type,
                                            slide.document_slide?.type,
                                            '8',
                                            slide
                                        )}
                                    </div>

                                    {/* Slide Title */}
                                    <h4
                                        className="mb-1 truncate text-sm font-medium text-gray-800"
                                        title={slide.title}
                                    >
                                        {slide.title || t('numbering.slide', { number: sIdx + 1 })}
                                    </h4>

                                    {/* Slide Number */}
                                    {roleDisplay?.coursePage?.viewContentNumbering !== false && (
                                        <p className="text-xs text-gray-500">{t('numbering.slide', { number: sIdx + 1 })}</p>
                                    )}
                                </div>
                            </div>
                        ))}

                    {/* Add New Folder Buttons */}
                    {courseStructure === 5 &&
                        currentNavigationLevel === 'subjects' &&
                        showAddSubject && (
                        <div className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 transition-colors duration-200 hover:border-primary-400 hover:bg-primary-50">
                            <AddSubjectButton
                                isTextButton={false}
                                onAddSubject={handleAddSubject}
                            />
                        </div>
                    )}

                    {courseStructure === 5 &&
                        currentNavigationLevel === 'modules' &&
                        selectedSubjectId &&
                        showAddModule && (
                            <div className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 transition-colors duration-200 hover:border-primary-400 hover:bg-primary-50">
                                <AddModulesButton
                                    isTextButton={false}
                                    subjectId={selectedSubjectId}
                                    onAddModuleBySubjectId={(subjectId, module) =>
                                        handleAddModule(subjectId, module)
                                    }
                                />
                            </div>
                        )}

                    {/* Add Module button for course structure 4 at root level */}
                    {courseStructure === 4 &&
                        currentNavigationLevel === 'subjects' &&
                        subjects[0] &&
                        showAddModule && (
                            <div className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 transition-colors duration-200 hover:border-primary-400 hover:bg-primary-50">
                                <AddModulesButton
                                    isTextButton={false}
                                    subjectId={subjects[0].id}
                                    onAddModuleBySubjectId={(subjectId, module) =>
                                        handleAddModule(subjectId, module)
                                    }
                                />
                            </div>
                        )}

                    {/* Add Chapter buttons for various scenarios */}
                    {((courseStructure === 5 &&
                        currentNavigationLevel === 'chapters' &&
                        selectedSubjectId &&
                        selectedModuleId) ||
                        (courseStructure === 4 &&
                            currentNavigationLevel === 'chapters' &&
                            selectedModuleId &&
                            subjects[0]) ||
                        (courseStructure === 3 &&
                            currentNavigationLevel === 'subjects' &&
                            subjects[0])) &&
                        showAddChapter && (
                        <div className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 transition-colors duration-200 hover:border-primary-400 hover:bg-primary-50">
                            <AddChapterButton
                                moduleId={
                                    courseStructure === 5
                                        ? selectedModuleId
                                        : courseStructure === 4
                                          ? selectedModuleId
                                          : subjects[0]
                                            ? subjectModulesMap[subjects[0].id]?.[0]?.module.id ||
                                              ''
                                            : ''
                                }
                                sessionId={selectedSession}
                                levelId={selectedLevel}
                                subjectId={
                                    courseStructure === 5
                                        ? selectedSubjectId
                                        : subjects[0]?.id || ''
                                }
                                packageSessionId={batchPackageSessionId ?? ''}
                                isTextButton={false}
                            />
                        </div>
                    )}

                    {/* Add Slide button for Course Structure 2 */}
                    {courseStructure === 2 &&
                        currentNavigationLevel === 'subjects' &&
                        !readOnly &&
                        showAddSlide && (
                            <div className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 transition-colors duration-200 hover:border-primary-400 hover:bg-primary-50">
                                <div
                                    onClick={() => handleDirectSlideNavigation()}
                                    className="flex flex-col items-center gap-2 text-center"
                                >
                                    <Plus size={24} className="text-primary-500" />
                                    <span className="text-sm font-medium text-primary-700">
                                        {t('add')}{' '}
                                        {getTerminology(ContentTerms.Slides, SystemTerms.Slides)}
                                    </span>
                                </div>
                            </div>
                        )}
                </div>
            </div>
        ),
        [TabType.PLANNING]: (
            <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">
                <Planning packageSessionId={batchPackageSessionId ?? ''} />
            </div>
        ),
        [TabType.ACTIVITY]: (
            <div className="rounded-md bg-white p-3 text-sm text-gray-600 shadow-sm">
                <Activity packageSessionId={batchPackageSessionId ?? ''} />
            </div>
        ),
        [TabType.ENGAGEMENT]: (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <EngagementTab packageSessionId={batchPackageSessionId ?? ''} />
            </div>
        ),
        [TabType.PULSE]: (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <PulseTab packageSessionId={batchPackageSessionId ?? ''} />
            </div>
        ),
        [TabType.SETTINGS]: (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <PackageSettingsPanel packageId={courseId} />
            </div>
        ),
        [TabType.TUTOR_MODE]: (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <TutorModeTab key={courseId} packageId={courseId} />
            </div>
        ),
        [TabType.AI_KNOWLEDGE]: (
            <div className="rounded-md bg-white p-3 shadow-sm">
                <AiKnowledgeTab key={courseId} packageId={courseId} />
            </div>
        ),
        [TabType.DISCUSSION]: batchPackageSessionId ? (
            <BatchChatPanel packageSessionId={batchPackageSessionId} />
        ) : (
            <div className="rounded-md bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
                {t('selectBatchFor.discussion')}
            </div>
        ),
    };

    const isLoading =
        addSubjectMutation.isPending ||
        deleteSubjectMutation.isPending ||
        updateSubjectMutation.isPending ||
        updateSubjectOrderMutation.isPending ||
        updateModuleMutation.isPending ||
        updateChapterMutation.isPending;

    // If chat gets disabled while the Discussion tab is open, move off it so we don't leave an
    // orphaned panel whose trigger has vanished from the tab strip.
    useEffect(() => {
        if (selectedTab === TabType.DISCUSSION && !isChatEnabled) {
            setSelectedTab(TabType.OUTLINE);
            localStorage.setItem(getStorageKey(), TabType.OUTLINE);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isChatEnabled, selectedTab]);

    // Same for Downloads: if offline access is (or becomes) disabled while the
    // Downloads tab is open — including a stale localStorage selection — move off it.
    useEffect(() => {
        if (selectedTab === TabType.DOWNLOADS && isOfflineAccessDisabled) {
            setSelectedTab(TabType.OUTLINE);
            localStorage.setItem(getStorageKey(), TabType.OUTLINE);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOfflineAccessDisabled, selectedTab]);

    // And for AI knowledge: once the status has settled as not available (or the
    // feature is switched off for the institute), move off a stale selection of it.
    useEffect(() => {
        if (
            selectedTab === TabType.AI_KNOWLEDGE &&
            isAiKnowledgeSettled &&
            !isAiKnowledgeAvailable
        ) {
            setSelectedTab(TabType.OUTLINE);
            localStorage.setItem(getStorageKey(), TabType.OUTLINE);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAiKnowledgeAvailable, isAiKnowledgeSettled, selectedTab]);

    // Compute final visible/reordered tabs once for rendering below.
    // Discussion is handled separately (gated on chat-enabled) and conditionally
    // appended after the role/settings reorder pipeline below.
    const finalTabs = (() => {
        let reorderedTabs = buildTabs(t).filter((tab) => tab.value !== TabType.DISCUSSION);

        // Offline access off (confirmed) → the Downloads tab is meaningless; hide it
        // regardless of role config. When on, it stays in the pipeline and the
        // role-config visibility below applies as usual.
        if (isOfflineAccessDisabled) {
            reorderedTabs = reorderedTabs.filter((tab) => tab.value !== TabType.DOWNLOADS);
        }

        // Course knowledge not available to the institute → no AI knowledge tab,
        // whatever the role config says.
        if (!isAiKnowledgeAvailable) {
            reorderedTabs = reorderedTabs.filter((tab) => tab.value !== TabType.AI_KNOWLEDGE);
        }

        const details = roleDisplay?.courseDetails;
        if (details?.tabs && details.tabs.length > 0) {
            const vis = new Map(
                details.tabs.map((t) => [mapDisplayIdToUiValue(t.id as CourseDetailsTabId), t])
            );
            reorderedTabs = reorderedTabs
                .filter((tab) => {
                    const cfg = vis.get(tab.value as CourseDetailsTabId);
                    // Not listed in this role's saved config: hidden-by-default
                    // tabs stay hidden; everything else stays visible.
                    if (!cfg) return !DEFAULT_HIDDEN_COURSE_DETAILS_TABS.has(tab.value);
                    return cfg.visible !== false;
                })
                .sort((a, b) => {
                    const ao = vis.get(a.value as CourseDetailsTabId)?.order ?? 999;
                    const bo = vis.get(b.value as CourseDetailsTabId)?.order ?? 999;
                    return ao - bo;
                });
        } else {
            // No role display settings at all: hidden-by-default tabs stay hidden.
            reorderedTabs = reorderedTabs.filter(
                (tab) => !DEFAULT_HIDDEN_COURSE_DETAILS_TABS.has(tab.value)
            );
            // Fallbacks based on course settings/defaults
            if (settingsLoading || settingsError) {
                const outlineTab = reorderedTabs.find((tab) => tab.value === 'OUTLINE');
                const otherTabs = reorderedTabs.filter((tab) => tab.value !== 'OUTLINE');
                if (outlineTab) {
                    reorderedTabs = [outlineTab, ...otherTabs];
                }
            } else {
                const defaultViewMode = courseSettings?.courseViewSettings?.defaultViewMode;
                if (defaultViewMode === 'structure') {
                    const structureTab = reorderedTabs.find(
                        (tab) => tab.value === 'CONTENT_STRUCTURE'
                    );
                    const otherTabs = reorderedTabs.filter(
                        (tab) => tab.value !== 'CONTENT_STRUCTURE'
                    );
                    if (structureTab) {
                        reorderedTabs = [structureTab, ...otherTabs];
                    }
                } else {
                    const outlineTab = reorderedTabs.find((tab) => tab.value === 'OUTLINE');
                    const otherTabs = reorderedTabs.filter((tab) => tab.value !== 'OUTLINE');
                    if (outlineTab) {
                        reorderedTabs = [outlineTab, ...otherTabs];
                    }
                }
            }
        }

        // Append the Discussion tab last, only when chat is enabled for the institute.
        if (isChatEnabled) {
            const discussionTab = buildTabs(t).find((tab) => tab.value === TabType.DISCUSSION);
            if (discussionTab) reorderedTabs = [...reorderedTabs, discussionTab];
        }

        return reorderedTabs;
    })();

    return isLoading ? (
        <DashboardLoader />
    ) : (
        <div className="flex w-full flex-col gap-3 rounded-lg bg-white py-4 text-neutral-700">
            {/* Restriction Message */}
            {!canEditStructure && (
                <div className="mx-4 rounded-md border border-orange-200 bg-orange-50 p-3">
                    <div className="flex items-center gap-2">
                        <div className="font-medium text-orange-600">
                            {t('restriction.banner', {
                                status: isPublishedCourse
                                    ? t('restriction.statusPublished')
                                    : isInReviewCourse
                                        ? t('restriction.statusUnderReview')
                                        : t('restriction.statusRestricted'),
                            })}
                        </div>
                        <div className="text-sm text-orange-600">
                            {isPublishedCourse
                                ? t('restriction.publishedHint')
                                : isInReviewCourse
                                    ? t('restriction.reviewHint')
                                    : t('restriction.restrictedHint')}
                        </div>
                    </div>
                </div>
            )}

            <Tabs value={selectedTab} onValueChange={handleTabChange} className="w-full">
                {finalTabs.length > 1 && (
                    <div className="overflow-x-auto border-b border-gray-200">
                        <TabsList
                            className="h-auto min-w-max flex-nowrap bg-transparent p-0"
                            style={{ display: 'flex', justifyContent: 'left' }}
                        >
                            {finalTabs.map((tab) => (
                                <TabsTrigger
                                    key={tab.value}
                                    value={tab.value}
                                    className={`relative flex rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium !shadow-none transition-colors duration-200 hover:bg-gray-100 data-[state=active]:border-primary-500 data-[state=active]:bg-primary-50 data-[state=active]:text-primary-600`}
                                >
                                    {tab.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </div>
                )}
                <TabsContent
                    key={selectedTab}
                    value={selectedTab}
                    className="mt-4 overflow-hidden rounded-r-md"
                >
                    <div className="relative">
                        {/* Loading overlay */}
                        {isInitLoading && (
                            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                                <div className="flex flex-col items-center gap-3">
                                    <DashboardLoader size={24} />
                                    <div className="text-sm font-medium text-gray-600">
                                        {t('updatingStructure')}
                                    </div>
                                </div>
                            </div>
                        )}
                        {tabContent[selectedTab as TabType]}
                    </div>
                </TabsContent>
            </Tabs>

            {/* Import Content from another batch (mode picker + source picker).
                When the target batch already has slides, REFERENCE is locked off
                (would mix shared and existing content); only VALUE is allowed. */}
            <CopyContentDialog
                open={showCopyContentDialog}
                onOpenChange={setShowCopyContentDialog}
                targetCourseDepth={courseStructure}
                targetBatchHasContent={targetBatchHasContent}
                onConfirm={handleCopyContentConfirm}
            />

            {/* Edit Dialogs */}
            {/* Subject Edit Dialog */}
            <MyDialog
                heading={t('editSubjectHeading')}
                dialogWidth="w-[400px]"
                open={editDialog.isOpen && editDialog.type === 'subject'}
                onOpenChange={(open) => !open && closeEditDialog()}
            >
                {editDialog.item && editDialog.type === 'subject' && (
                    <AddSubjectForm
                        initialValues={editDialog.item as SubjectType}
                        onSubmitSuccess={handleEditSubject}
                    />
                )}
            </MyDialog>

            {/* Module Edit Dialog */}
            <MyDialog
                heading={t('editModuleHeading')}
                dialogWidth="w-[400px]"
                open={editDialog.isOpen && editDialog.type === 'module'}
                onOpenChange={(open) => !open && closeEditDialog()}
            >
                {editDialog.item && editDialog.type === 'module' && (
                    <AddModulesForm
                        initialValues={editDialog.item as Module}
                        onSubmitSuccess={handleEditModule}
                    />
                )}
            </MyDialog>

            {/* Chapter Edit Dialog */}
            <MyDialog
                heading={t('editChapterHeading')}
                dialogWidth="min-w-[800px]"
                open={editDialog.isOpen && editDialog.type === 'chapter'}
                onOpenChange={(open) => !open && closeEditDialog()}
                headerActions={
                    editDialog.isOpen && editDialog.type === 'chapter' ? (
                        <ChapterHeaderActions
                            submitFn={chapterFormState.submitFn}
                            isPending={chapterFormState.isPending}
                        />
                    ) : undefined
                }
            >
                {editDialog.item &&
                    editDialog.type === 'chapter' &&
                    (() => {
                        const chapterItem = editDialog.item as Chapter & {
                            subjectId?: string;
                            moduleId?: string;
                            chapter_in_package_sessions?: string[];
                        };
                        // Convert Chapter to ChapterWithSlides format expected by AddChapterForm
                        const chapterWithSlides: ChapterWithSlidesStore = {
                            chapter: chapterItem,
                            slides_count: {
                                video_count: 0,
                                pdf_count: 0,
                                doc_count: 0,
                                unknown_count: 0,
                            },
                            chapter_in_package_sessions: chapterItem.chapter_in_package_sessions || [],
                        };
                        return (
                            <AddChapterForm
                                mode="edit"
                                initialValues={chapterWithSlides}
                                onSubmitSuccess={async () => {
                                    // Close dialog and refresh data after successful edit
                                    closeEditDialog();
                                    // Refresh the local state data
                                    const updatedSubjects = getCourseSubjects(
                                        courseId,
                                        selectedSession || '',
                                        levelId
                                    );
                                    if (updatedSubjects.length > 0 && packageSessionIds) {
                                        const updatedModulesMap = await fetchModules({
                                            subjects: updatedSubjects,
                                            packageSessionIds,
                                        });
                                        setSubjectModulesMap(updatedModulesMap);
                                    }
                                    setSubjects(updatedSubjects);
                                }}
                                module_id={chapterItem.moduleId}
                                session_id={selectedSession}
                                level_id={selectedLevel}
                                subject_id={chapterItem.subjectId}
                                hideSubmitButton={true}
                                onFormReady={handleChapterFormReady}
                            />
                        );
                    })()}
            </MyDialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog
                open={deleteConfirmation.isOpen}
                onOpenChange={() =>
                    setDeleteConfirmation({ isOpen: false, type: null, item: null })
                }
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('confirmDeletion.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('confirmDeletion.body', {
                                name: deleteConfirmation.item?.name ?? '',
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('confirmDeletion.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmDelete}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            {t('actions.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Unlock rule for one subject / module / chapter */}
            <ContentDripConditionDialog
                open={contentDripDialog.open}
                onClose={handleCloseDripDialog}
                level={contentDripDialog.level}
                itemId={contentDripDialog.itemId}
                itemName={contentDripDialog.itemName}
                packageId={searchParams?.courseId ?? ''}
                dripConditions={dripConditions}
                onSave={handleSaveChapterDripConditions}
                dripEnabled={dripConditionsEnabled}
                enforcing={dripEnforcing}
                siblings={dripScheduleItems[contentDripDialog.level] ?? []}
            />

            {/* Bulk day-wise release schedule for the whole course */}
            <DripScheduleDialog
                open={dripScheduleOpen}
                onClose={() => setDripScheduleOpen(false)}
                itemsByLevel={dripScheduleItems}
                dripConditions={dripConditions}
                onSave={handleSaveChapterDripConditions}
                defaults={dripScheduleDefaults}
                dripEnabled={dripConditionsEnabled}
            />

            {/* Offline Availability Dialog (subject / module / chapter) */}
            {offlineDialog.open && batchPackageSessionId && (
                <OfflineAvailabilityDialog
                    open={offlineDialog.open}
                    onClose={handleCloseOfflineDialog}
                    sourceType={offlineDialog.sourceType}
                    sourceId={offlineDialog.sourceId ?? ''}
                    packageSessionId={batchPackageSessionId}
                    nodeName={offlineDialog.nodeName ?? t('defaultNodeName')}
                />
            )}
        </div>
    );
};
