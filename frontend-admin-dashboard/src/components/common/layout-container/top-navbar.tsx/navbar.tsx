import {
    getActiveRoleDisplaySettingsKey,
    getRolesForCurrentInstitute,
} from '@/lib/auth/instituteUtils';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { useEffect, useMemo, useState } from 'react';
import {
    BellSimple,
    CaretDown,
    CaretUp,
    List,
    SquaresFour,
    AndroidLogo,
    AppleLogo,
    WindowsLogo,
    Desktop,
    ChalkboardTeacher,
    Student,
    ArrowLeft,
    AddressBook,
    Buildings,
    EnvelopeSimple,
    Globe,
    MapPin,
    MapTrifold,
    IdentificationCard,
    PencilSimple,
    Phone,
    UserCircle,
} from '@phosphor-icons/react';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useSidebarStore } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/global-states';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { removeCookiesAndLogout } from '@/lib/auth/sessionUtility';
import { useNavigate } from '@tanstack/react-router';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import useInstituteLogoStore from '../sidebar/institutelogo-global-zustand';
import { getDisplaySettingsFromCache } from '@/services/display-settings';
import { ADMIN_DISPLAY_SETTINGS_KEY, TEACHER_DISPLAY_SETTINGS_KEY } from '@/types/display-settings';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { useModulesWithChaptersStore } from '@/stores/study-library/use-modules-with-chapters-store';
import { usePDFStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/temp-pdf-store';
import { useSelectedSessionStore } from '@/stores/study-library/selected-session-store';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { SidebarSimple } from '@phosphor-icons/react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useSuspenseQuery, useQueryClient, useQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { Separator } from '@/components/ui/separator';
import EditDashboardProfileComponent from '@/routes/dashboard/-components/EditDashboardProfileComponent';
import AdminProfile from '@/routes/dashboard/-components/AdminProfile';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { handleGetAdminDetails } from '@/services/student-list-section/getAdminDetails';
import useAdminLogoStore from '../sidebar/admin-logo-zustand';
import { useFileUpload } from '@/hooks/use-file-upload';
import { SSOSwitcher } from '../../auth/SSOSwitcher';
import {
    InstituteSwitcherDialog,
    InstituteSwitcherMenuSection,
    useCanSwitchInstitute,
} from '../../auth/InstituteSwitcher';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getUserId, getUserName } from '@/utils/userDetails';
import {
    getSystemAlertsQuery,
    stripHtml,
    fetchSystemAlerts,
    markSystemAlertsAsRead,
    formatAlertTimestamp,
} from '@/services/notifications/system-alerts';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import type { PagedResponse, SystemAlertItem } from '@/services/notifications/system-alerts';
import { useSystemAlertToasts } from '@/components/common/notifications/useSystemAlertToasts';
import { getDefaultAdminDisplaySettings } from '@/constants/display-settings/admin-defaults';
import { getDefaultTeacherDisplaySettings } from '@/constants/display-settings/teacher-defaults';
import { MyButton } from '@/components/design-system/button';
import { ClearAllAlertsButton } from '@/components/common/notifications/ClearAllAlertsButton';
import { DismissAlertButton } from '@/components/common/notifications/DismissAlertButton';
import AccountDetailsEdit from '@/routes/dashboard/-components/AccountDetailsEdit';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { useCompactMode } from '@/hooks/use-compact-mode';
import { useAiCreditsQuery } from '@/services/ai-credits/get-ai-credits';
import { AiCreditsPanel } from '@/components/common/ai-credits/AiCreditsPanel';
import {
    hasFacultyAssignedPermission,
    getEffectiveInstituteLogoFileId,
    getEffectiveInstituteName,
    getSelectedSubOrgId,
    getSelectedSubOrgLinkageType,
} from '@/lib/auth/facultyAccessUtils';
import { getSubOrgInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { LanguageDropdown } from '@/components/common/localization/language-dropdown';
import { useLanguageStore } from '@/stores/localization/useLanguageStore';
import { getEnabledLocales } from '@/services/language-settings';
import { dueLabel, useDueFollowupReminders } from '@/components/shared/leads/followup-reminders';
import { Alarm } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export function Navbar({ showMobileBackButton }: { showMobileBackButton?: boolean }) {
    const queryClient = useQueryClient();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { data: adminDetails } = useSuspenseQuery(handleGetAdminDetails());
    const { resetStore } = useInstituteDetailsStore();
    const { resetStudyLibraryStore } = useStudyLibraryStore();
    const { resetInstituteLogo } = useInstituteLogoStore();
    const { resetModulesWithChaptersStore } = useModulesWithChaptersStore();
    const { resetPdfStore } = usePDFStore();
    const { resetSelectedSessionStore } = useSelectedSessionStore();
    const { resetChapterSidebarStore } = useContentStore();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const { navHeading } = useNavHeadingStore();
    const { sidebarOpen, setSidebarOpen } = useSidebarStore();
    const { instituteLogo, setInstituteLogo } = useInstituteLogoStore();
    const { getPublicUrl } = useFileUpload();
    const { adminLogo, setAdminLogo, resetAdminLogo } = useAdminLogoStore();
    // Roles in the institute being viewed — not every institute in the token. An ADMIN
    // elsewhere who is a STUDENT here must get this institute's chrome (and vice versa).
    const roles = getRolesForCurrentInstitute();
    const userId = getUserId();
    const [showEditAccountDetails, setShowEditAccountDetails] = useState(false);
    // Institute switcher: offered only with ≥2 admin-eligible institutes in the token.
    const canSwitchInstitute = useCanSwitchInstitute();
    const [showInstituteSwitcher, setShowInstituteSwitcher] = useState(false);
    const isMobile = useIsMobile();
    const { setOpenMobile } = useSidebar();
    const { isCompact } = useCompactMode();

    // Subscribe to language changes so the navbar (a persistent, always-mounted
    // chrome component) re-renders immediately when the language switcher
    // changes locale, rather than waiting for some unrelated state update.
    const { t } = useTranslation('navbar');

    // Effective display settings (cached or defaults) for permission gating
    const isAdminRoleForDS = roles.includes('ADMIN');
    const roleKeyForDS = getActiveRoleDisplaySettingsKey();
    const cachedDS = getDisplaySettingsFromCache(roleKeyForDS);
    // Only the permission flags and `ui` are read from this fallback, and neither
    // depends on the sidebar labels the getters resolve through i18n — so the
    // role is the whole dependency. Memoized because the navbar is always
    // mounted and building the defaults walks every sidebar entry.
    const defaultDS = useMemo(
        () =>
            isAdminRoleForDS
                ? getDefaultAdminDisplaySettings()
                : getDefaultTeacherDisplaySettings(),
        [isAdminRoleForDS]
    );
    const effectiveDS = cachedDS || defaultDS;
    const canViewProfile = effectiveDS.permissions.canViewProfileDetails;
    const canEditProfile = effectiveDS.permissions.canEditProfileDetails;
    const canViewInstitute = effectiveDS.permissions.canViewInstituteDetails;
    const canEditInstitute = effectiveDS.permissions.canEditInstituteDetails;

    // Alerts: last 5. Polled while the tab is visible so a job finishing in
    // the background (a bulk AI check, say) reaches the bell - and a toast -
    // without a page change.
    const { data: alertsList, isLoading: isAlertsLoading } = useSuspenseQuery<
        PagedResponse<SystemAlertItem>
    >({ ...getSystemAlertsQuery(userId, 5), refetchInterval: 60_000 });
    useSystemAlertToasts(alertsList?.content);

    const [showAllDialog, setShowAllDialog] = useState(false);
    // Alerts: full list (infinite) — only once the "see all" dialog is open. The bell's
    // unread badge reads the 5-item query above, not this one.
    const infiniteAlerts = useInfiniteQuery<PagedResponse<SystemAlertItem>>({
        queryKey: ['SYSTEM_ALERTS_INFINITE', userId, 20] as const,
        queryFn: ({ pageParam = 0 }) =>
            fetchSystemAlerts({ userId, page: Number(pageParam) || 0, size: 20 }),
        getNextPageParam: (lastPage) => (lastPage.last ? undefined : lastPage.number + 1),
        initialPageParam: 0,
        staleTime: 30_000,
        enabled: showAllDialog,
    });

    const showAiCredits = effectiveDS.ui?.showAiCredits !== false;
    const { data: aiCredits, isError: isCreditsError } = useAiCreditsQuery(showAiCredits);

    // Language switcher: only when the institute offers more than one locale
    // (single-language institutes — all existing ones — see no change).
    const currentLocale = useLanguageStore((state) => state.locale);
    const showLanguageSwitcher = getEnabledLocales(currentLocale).length > 1;

    const unreadCount = useMemo(() => {
        return alertsList?.content?.reduce((acc, item) => acc + (item.isRead ? 0 : 1), 0) || 0;
    }, [alertsList]);

    // Due/overdue follow-ups (own only) — surfaced above the alerts and
    // counted in the bell badge so a due follow-up is impossible to miss.
    const { due: dueFollowups } = useDueFollowupReminders();
    const bellCount = unreadCount + dueFollowups.length;

    const markVisibleAlertsAsRead = async () => {
        if (!userId) return;
        const unreadIds =
            alertsList?.content
                ?.filter((item) => !item.isRead)
                .map((item) => item.messageId)
                .filter(Boolean) || [];
        if (!unreadIds.length) return;

        const unreadIdSet = new Set(unreadIds);
        const markPagedItemsRead = (page: PagedResponse<SystemAlertItem> | undefined) =>
            page
                ? {
                      ...page,
                      content: page.content.map((item) =>
                          unreadIdSet.has(item.messageId) ? { ...item, isRead: true } : item
                      ),
                  }
                : page;

        queryClient.setQueriesData<PagedResponse<SystemAlertItem>>(
            { queryKey: ['SYSTEM_ALERTS', userId] },
            (old) => markPagedItemsRead(old) ?? old
        );
        queryClient.setQueriesData<{
            pages: PagedResponse<SystemAlertItem>[];
            pageParams: unknown[];
        }>({ queryKey: ['SYSTEM_ALERTS_INFINITE', userId] }, (old) =>
            old
                ? {
                      ...old,
                      pages: old.pages.map(
                          (p) => markPagedItemsRead(p) as PagedResponse<SystemAlertItem>
                      ),
                  }
                : old
        );

        await markSystemAlertsAsRead(unreadIds, userId);
    };

    const handleNotificationsOpenChange = (open: boolean) => {
        if (open) {
            void markVisibleAlertsAsRead();
        }
    };

    const handleLogout = async (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        event.preventDefault(); // Prevents dropdown from closing immediately

        // Clear all React Query cache to prevent data persistence between users
        queryClient.clear();

        // Reset all Zustand stores
        resetStore();
        resetStudyLibraryStore();
        resetModulesWithChaptersStore();
        resetInstituteLogo();
        resetAdminLogo();
        resetPdfStore();
        resetSelectedSessionStore();
        resetChapterSidebarStore();

        removeCookiesAndLogout(); // Ensure logout completes
        navigate({
            to: '/login',
        });
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            const fetchPublicUrl = async () => {
                if (adminDetails?.profile_pic_file_id) {
                    const publicUrl = await getPublicUrl(adminDetails?.profile_pic_file_id);
                    setAdminLogo(publicUrl || '');
                }
            };

            fetchPublicUrl();
        }, 300); // Adjust the debounce time as needed

        return () => clearTimeout(timer); // Cleanup the timeout on component unmount
    }, [adminDetails?.profile_pic_file_id, getPublicUrl, setAdminLogo]);

    // Match layout logic: main sidebar visibility is determined by display settings
    const hasFacultyPermission = hasFacultyAssignedPermission(instituteDetails?.id);
    const showSidebarFromDS = cachedDS?.ui?.showSidebar !== false;
    const showMainSidebar = showSidebarFromDS;

    // For faculty users with selected sub-org: fetch sub-org institute details (suborgId = institute ID of sub-org)
    const selectedSubOrgId = getSelectedSubOrgId();
    const { data: subOrgInstituteDetails } = useQuery({
        ...getSubOrgInstituteQuery(selectedSubOrgId ?? null),
        enabled: !showMainSidebar && !!hasFacultyPermission && !!selectedSubOrgId,
    });

    // When sidebar is hidden, set institute logo: from sub-org details API if available, else from main/suborg mapping
    useEffect(() => {
        if (!showMainSidebar) {
            const logoId = subOrgInstituteDetails?.institute_logo_file_id
                ? subOrgInstituteDetails.institute_logo_file_id
                : getEffectiveInstituteLogoFileId(
                      instituteDetails?.institute_logo_file_id ?? undefined
                  );
            if (logoId && typeof logoId === 'string') {
                getPublicUrl(logoId).then((url) => {
                    setInstituteLogo(url || '');
                });
            } else {
                setInstituteLogo('');
            }
        }
    }, [
        showMainSidebar,
        subOrgInstituteDetails?.institute_logo_file_id,
        instituteDetails?.institute_logo_file_id,
        instituteDetails?.id,
        getPublicUrl,
        setInstituteLogo,
    ]);

    // Effective institute name: from sub-org details API when faculty with selected sub-org, else main institute
    const effectiveInstituteName = subOrgInstituteDetails?.institute_name
        ? subOrgInstituteDetails.institute_name
        : getEffectiveInstituteName(instituteDetails?.institute_name) ??
          instituteDetails?.institute_name;

    const isPartnershipLinkage = getSelectedSubOrgLinkageType() === 'PARTNERSHIP';
    const [mainInstituteLogoUrl, setMainInstituteLogoUrl] = useState<string>('');

    // When PARTNERSHIP, resolve main (original) institute logo for "Powered by" line
    useEffect(() => {
        if (isPartnershipLinkage && instituteDetails?.institute_logo_file_id) {
            getPublicUrl(instituteDetails.institute_logo_file_id).then((url) => {
                setMainInstituteLogoUrl(url || '');
            });
        } else {
            setMainInstituteLogoUrl('');
        }
    }, [isPartnershipLinkage, instituteDetails?.institute_logo_file_id, getPublicUrl]);

    const {
        playStoreAppLink,
        appStoreAppLink,
        windowsAppLink,
        macAppLink,
        learnerPortalUrl,
        instructorPortalUrl,
    } = instituteDetails || {};

    const showAppsIcon = [
        playStoreAppLink,
        appStoreAppLink,
        windowsAppLink,
        macAppLink,
        learnerPortalUrl,
        instructorPortalUrl,
    ].some((link) => {
        return !!link;
    });

    const ensureProtocol = (url: string | null | undefined) => {
        if (!url) return undefined;
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `https://${url}`;
    };

    const finalInstructorPortalUrl = ensureProtocol(instructorPortalUrl);
    const finalLearnerPortalUrl = ensureProtocol(learnerPortalUrl);

    return (
        <div
            className={cn(
                'sticky top-0 top-safe-native z-50 flex items-center justify-between border-b border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60',
                isCompact ? 'h-12 px-4 py-2' : 'h-14 px-4 py-2 md:h-[72px] md:px-8 md:py-4'
            )}
        >
            <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-4">
                {/* Mobile back button */}
                {isMobile && showMobileBackButton && (
                    <button
                        onClick={() => window.history.back()}
                        className="flex items-center justify-center rounded-md p-2 transition-colors hover:bg-neutral-100"
                        aria-label={t('aria.goBack')}
                    >
                        <ArrowLeft className="size-5 text-neutral-600" weight="bold" />
                    </button>
                )}

                {/* Mobile hamburger menu */}
                {isMobile && showMainSidebar && (
                    <button
                        onClick={() => setOpenMobile(true)}
                        className="flex items-center justify-center rounded-md p-2 transition-colors hover:bg-neutral-100"
                        aria-label={t('aria.openMenu')}
                    >
                        <List className="size-5 text-neutral-600" weight="bold" />
                    </button>
                )}

                {/* Institute logo and name when sidebar is hidden (e.g. faculty users or display setting) */}
                {!showMainSidebar && (
                    <div className="flex min-w-0 shrink flex-col justify-center gap-0.5">
                        <div className="flex min-w-0 shrink items-center gap-2">
                            {instituteLogo ? (
                                <div
                                    className={cn(
                                        'flex shrink-0 items-center justify-center overflow-hidden rounded',
                                        isCompact ? 'h-9 w-9' : 'h-10 w-10 md:h-12 md:w-12'
                                    )}
                                >
                                    <img
                                        src={instituteLogo}
                                        alt={t('profile.logo')}
                                        className="h-full w-full object-contain"
                                    />
                                </div>
                            ) : null}
                            {effectiveInstituteName ? (
                                <span
                                    className={cn(
                                        'line-clamp-2 min-w-0 break-words font-semibold text-neutral-800',
                                        isCompact
                                            ? 'max-w-[140px] text-sm'
                                            : 'max-w-[220px] text-sm md:max-w-[260px] md:text-base'
                                    )}
                                    title={effectiveInstituteName as string}
                                >
                                    {effectiveInstituteName as string}
                                </span>
                            ) : null}
                        </div>
                        {isPartnershipLinkage && instituteDetails?.institute_name && (
                            <div
                                className={cn(
                                    'flex items-center gap-1.5 text-neutral-500',
                                    instituteLogo && (isCompact ? 'ml-9' : 'ml-12')
                                )}
                            >
                                <span className="whitespace-nowrap text-[10px] font-medium text-neutral-500 md:text-xs">
                                    {t('poweredBy')}
                                </span>
                                {mainInstituteLogoUrl ? (
                                    <div className="flex shrink-0 items-center justify-center overflow-hidden rounded">
                                        <img
                                            src={mainInstituteLogoUrl}
                                            alt={instituteDetails.institute_name}
                                            className="h-5 w-auto max-w-[80px] object-contain"
                                            aria-hidden
                                        />
                                    </div>
                                ) : (
                                    <span className="max-w-[150px] truncate text-[10px] font-bold text-neutral-700 md:text-xs">
                                        {instituteDetails.institute_name}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Desktop sidebar trigger */}
                {!isMobile && showMainSidebar && (
                    <SidebarTrigger onClick={() => setSidebarOpen(!sidebarOpen)}>
                        <SidebarSimple className="text-neutral-600" />
                    </SidebarTrigger>
                )}

                {/* Nav heading */}
                <div
                    className={cn(
                        'truncate border-l border-neutral-500 font-semibold text-neutral-600',
                        isCompact ? 'px-2 text-sm' : 'px-2 text-sm md:px-4 md:text-h3'
                    )}
                >
                    {navHeading}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 text-neutral-600 md:gap-6">
                {/* Language switcher (multi-language institutes only) */}
                {showLanguageSwitcher && <LanguageDropdown className="relative" />}
                {/* AI Credits */}
                {showAiCredits && aiCredits && !isCreditsError && <AiCreditsPanel />}
                {/* Apps Menu */}
                {showAppsIcon && (
                    <DropdownMenu>
                        <DropdownMenuTrigger className="relative flex items-center justify-center outline-none">
                            <div className="relative rounded-full p-1.5 text-neutral-700 hover:bg-neutral-200 md:p-2">
                                <SquaresFour
                                    className={cn(isCompact ? 'size-4' : 'size-4 md:size-5')}
                                    weight="bold"
                                />
                            </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64 p-2">
                            {finalInstructorPortalUrl && (
                                <div className="mb-2">
                                    <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                                        {t('appsMenu.instructorSection')}
                                    </div>
                                    <div className="grid grid-cols-4 gap-2 px-2 py-1">
                                        <a
                                            href={finalInstructorPortalUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex flex-col items-center justify-center gap-1 rounded-md p-1 hover:bg-neutral-100"
                                            title={t('appsMenu.instructorPortal')}
                                        >
                                            <ChalkboardTeacher
                                                className="size-6 text-primary-500"
                                                weight="fill"
                                            />
                                            <span className="text-center text-[10px] leading-tight text-neutral-600">
                                                {t('appsMenu.portal')}
                                            </span>
                                        </a>
                                    </div>
                                </div>
                            )}

                            {(finalLearnerPortalUrl ||
                                playStoreAppLink ||
                                appStoreAppLink ||
                                windowsAppLink ||
                                macAppLink) && (
                                <div>
                                    {finalInstructorPortalUrl && <Separator className="my-1" />}
                                    <div className="my-1 px-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                                        {t('appsMenu.learnerSection')}
                                    </div>
                                    <div className="grid grid-cols-4 gap-2 px-2 py-1">
                                        {finalLearnerPortalUrl && (
                                            <a
                                                href={finalLearnerPortalUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex flex-col items-center justify-center gap-1 rounded-md p-1 hover:bg-neutral-100"
                                                title={t('appsMenu.learnerPortal')}
                                            >
                                                <Student
                                                    className="size-6 text-primary-500"
                                                    weight="fill"
                                                />
                                                <span className="text-center text-[10px] leading-tight text-neutral-600">
                                                    {t('appsMenu.portal')}
                                                </span>
                                            </a>
                                        )}
                                        {playStoreAppLink && (
                                            <a
                                                href={playStoreAppLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex flex-col items-center justify-center gap-1 rounded-md p-1 hover:bg-neutral-100"
                                                title={t('appsMenu.googlePlayStore')}
                                            >
                                                <AndroidLogo
                                                    className="size-6 text-green-600"
                                                    weight="fill"
                                                />
                                                <span className="text-[10px] text-neutral-600">
                                                    {t('appsMenu.android')}
                                                </span>
                                            </a>
                                        )}
                                        {appStoreAppLink && (
                                            <a
                                                href={appStoreAppLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex flex-col items-center justify-center gap-1 rounded-md p-1 hover:bg-neutral-100"
                                                title={t('appsMenu.appStore')}
                                            >
                                                <AppleLogo
                                                    className="size-6 text-black"
                                                    weight="fill"
                                                />
                                                <span className="text-[10px] text-neutral-600">
                                                    {t('appsMenu.ios')}
                                                </span>
                                            </a>
                                        )}
                                        {windowsAppLink && (
                                            <a
                                                href={windowsAppLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex flex-col items-center justify-center gap-1 rounded-md p-1 hover:bg-neutral-100"
                                                title={t('appsMenu.windowsApp')}
                                            >
                                                <WindowsLogo
                                                    className="size-6 text-blue-600"
                                                    weight="fill"
                                                />
                                                <span className="text-[10px] text-neutral-600">
                                                    {t('appsMenu.windows')}
                                                </span>
                                            </a>
                                        )}
                                        {macAppLink && (
                                            <a
                                                href={macAppLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex flex-col items-center justify-center gap-1 rounded-md p-1 hover:bg-neutral-100"
                                                title={t('appsMenu.macApp')}
                                            >
                                                <Desktop
                                                    className="size-6 text-neutral-600"
                                                    weight="fill"
                                                />
                                                <span className="text-[10px] text-neutral-600">
                                                    {t('appsMenu.mac')}
                                                </span>
                                            </a>
                                        )}
                                    </div>
                                </div>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

                {/* Notifications */}
                <DropdownMenu onOpenChange={handleNotificationsOpenChange}>
                    <DropdownMenuTrigger className="relative flex items-center justify-center">
                        <div className="relative rounded-full p-1.5 hover:bg-neutral-200 md:p-2">
                            <BellSimple
                                className={cn(
                                    'text-neutral-700',
                                    isCompact ? 'size-4' : 'size-4 md:size-5'
                                )}
                            />
                            {!!bellCount && (
                                <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                                    {bellCount}
                                </span>
                            )}
                        </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className={cn(
                            'p-0',
                            isMobile ? 'w-[calc(100vw-2rem)] max-w-[320px]' : 'w-80'
                        )}
                    >
                        {/* Due follow-up reminders — pinned above the alerts. */}
                        {dueFollowups.length > 0 && (
                            <>
                                <div className="flex items-center justify-between bg-warning-50 px-3 py-2">
                                    <span className="flex items-center gap-1.5 text-sm font-medium text-warning-700">
                                        <Alarm size={15} weight="bold" />
                                        {t('notifications.followUpsDue', {
                                            count: dueFollowups.length,
                                        })}
                                    </span>
                                    <button
                                        className="text-xs text-primary-500 hover:underline"
                                        onClick={() =>
                                            navigate({ to: '/audience-manager/follow-ups' })
                                        }
                                    >
                                        {t('notifications.viewAll')}
                                    </button>
                                </div>
                                <div className="max-h-40 overflow-y-auto p-2">
                                    {dueFollowups.slice(0, 4).map((f) => {
                                        const due = dueLabel(f.schedule_time);
                                        return (
                                            <button
                                                key={f.id}
                                                className="flex w-full items-center justify-between gap-2 rounded-md p-2 text-left hover:bg-neutral-100"
                                                onClick={() =>
                                                    navigate({ to: '/audience-manager/follow-ups' })
                                                }
                                            >
                                                <span className="min-w-0">
                                                    <span className="block truncate text-xs font-medium text-neutral-800">
                                                        {f.lead_name ?? t('notifications.lead')}
                                                    </span>
                                                    {f.lead_mobile && (
                                                        <span className="block text-caption text-neutral-500">
                                                            {f.lead_mobile}
                                                        </span>
                                                    )}
                                                </span>
                                                <span
                                                    className={cn(
                                                        'shrink-0 rounded px-1.5 py-0.5 text-caption font-medium',
                                                        due.tone === 'overdue'
                                                            ? 'bg-danger-100 text-danger-700'
                                                            : 'bg-warning-100 text-warning-700'
                                                    )}
                                                >
                                                    {due.text}
                                                </span>
                                            </button>
                                        );
                                    })}
                                    {dueFollowups.length > 4 && (
                                        <p className="p-1 text-center text-caption text-neutral-500">
                                            {t('notifications.moreDue', {
                                                count: dueFollowups.length - 4,
                                            })}
                                        </p>
                                    )}
                                </div>
                                <Separator />
                            </>
                        )}
                        <div className="flex items-center justify-between px-3 py-2">
                            <span className="text-sm font-medium">
                                {t('notifications.systemAlerts')}
                            </span>
                            <div className="flex items-center gap-2">
                                <ClearAllAlertsButton
                                    userId={userId}
                                    hasAlerts={!!alertsList?.content?.length}
                                    className="!min-w-0 !px-1"
                                />
                                <button
                                    className="text-xs text-primary-500 hover:underline"
                                    onClick={() => setShowAllDialog(true)}
                                >
                                    {t('notifications.seeAll')}
                                </button>
                            </div>
                        </div>
                        <Separator />
                        <div className="max-h-80 overflow-y-auto p-2">
                            {isAlertsLoading ? (
                                <div className="space-y-2">
                                    {[...Array(5)].map((_, i) => (
                                        <div key={i} className="space-y-1">
                                            <Skeleton className="h-3 w-3/4" />
                                            <Skeleton className="h-3 w-full" />
                                        </div>
                                    ))}
                                </div>
                            ) : alertsList?.content?.length ? (
                                alertsList.content.map((item: SystemAlertItem) => {
                                    const sentAt = item.deliveredAt || item.createdAt;
                                    const status = (item.status || '').toUpperCase();
                                    const isDelivered = status === 'DELIVERED';
                                    const isFailed = status === 'FAILED';
                                    return (
                                        <div
                                            key={item.messageId}
                                            className="rounded-md p-2 hover:bg-neutral-100"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="text-[13px] font-medium text-neutral-800">
                                                    {item.title}
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    {!!status && (
                                                        <span
                                                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                                                isDelivered
                                                                    ? 'bg-green-100 text-green-700'
                                                                    : isFailed
                                                                      ? 'bg-red-100 text-red-700'
                                                                      : 'bg-neutral-100 text-neutral-700'
                                                            }`}
                                                        >
                                                            {status}
                                                        </span>
                                                    )}
                                                    <DismissAlertButton
                                                        userId={userId}
                                                        messageId={item.messageId}
                                                    />
                                                </div>
                                            </div>
                                            <div className="line-clamp-2 text-[12px] text-neutral-600">
                                                {item.content?.type === 'html'
                                                    ? stripHtml(item.content?.content)
                                                    : item.content?.content}
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
                                                <span>
                                                    {t('notifications.sentBy', {
                                                        name:
                                                            item.createdByName ||
                                                            t('notifications.system'),
                                                    })}
                                                </span>
                                                <span>•</span>
                                                <span>{formatAlertTimestamp(sentAt)}</span>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="p-3 text-center text-xs text-neutral-500">
                                    {t('notifications.noAlerts')}
                                </div>
                            )}
                        </div>
                        <Separator />
                        <div className="flex justify-center p-2">
                            <button
                                className="text-xs font-medium text-primary-500 hover:underline"
                                onClick={() => setShowAllDialog(true)}
                            >
                                {t('notifications.seeAllNotifications')}
                            </button>
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* See all dialog */}
                <Dialog open={showAllDialog} onOpenChange={setShowAllDialog}>
                    <DialogContent
                        className={cn(
                            'p-0',
                            isMobile ? 'w-[calc(100vw-2rem)] max-w-lg' : 'max-w-2xl'
                        )}
                    >
                        <div className="flex items-center justify-between gap-2 px-5 py-4">
                            <DialogTitle className="text-base">
                                {t('notifications.systemAlerts')}
                            </DialogTitle>
                            <ClearAllAlertsButton
                                userId={userId}
                                hasAlerts={
                                    !!infiniteAlerts.data?.pages?.flatMap((p) => p.content).length
                                }
                                className="!min-w-0 !px-1"
                                onCleared={() => setShowAllDialog(false)}
                            />
                        </div>
                        <Separator />
                        <ScrollArea className="max-h-[70vh]">
                            <div className="p-4">
                                {infiniteAlerts.data?.pages?.flatMap((p) => p.content).length ? (
                                    <div className="space-y-3">
                                        {infiniteAlerts.data?.pages?.map((page) =>
                                            page.content.map((item: SystemAlertItem) => {
                                                const sentAt = item.deliveredAt || item.createdAt;
                                                const status = (item.status || '').toUpperCase();
                                                const isDelivered = status === 'DELIVERED';
                                                const isFailed = status === 'FAILED';
                                                return (
                                                    <div
                                                        key={item.messageId}
                                                        className="rounded-md border border-neutral-200 bg-white p-4"
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <div className="truncate text-sm font-semibold text-neutral-900">
                                                                    {item.title}
                                                                </div>
                                                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-500">
                                                                    <span>
                                                                        {t(
                                                                            'notifications.sentBy',
                                                                            {
                                                                                name:
                                                                                    item.createdByName ||
                                                                                    t(
                                                                                        'notifications.system'
                                                                                    ),
                                                                            }
                                                                        )}
                                                                    </span>
                                                                    <span>•</span>
                                                                    <span>
                                                                        {formatAlertTimestamp(
                                                                            sentAt
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="flex shrink-0 items-center gap-1.5">
                                                                {!!status && (
                                                                    <span
                                                                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                                                                            isDelivered
                                                                                ? 'bg-green-100 text-green-700'
                                                                                : isFailed
                                                                                  ? 'bg-red-100 text-red-700'
                                                                                  : 'bg-neutral-100 text-neutral-700'
                                                                        }`}
                                                                    >
                                                                        {status}
                                                                    </span>
                                                                )}
                                                                <DismissAlertButton
                                                                    userId={userId}
                                                                    messageId={item.messageId}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="mt-3 text-[13px] leading-relaxed text-neutral-800">
                                                            {item.content?.type === 'html' ? (
                                                                <div
                                                                    className="prose prose-sm max-w-none"
                                                                    dangerouslySetInnerHTML={{
                                                                        __html: item.content
                                                                            ?.content,
                                                                    }}
                                                                />
                                                            ) : (
                                                                <span>{item.content?.content}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                        {/* Load more */}
                                        {infiniteAlerts.hasNextPage && (
                                            <div className="flex justify-center pt-2">
                                                <button
                                                    disabled={infiniteAlerts.isFetchingNextPage}
                                                    className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                    onClick={() => infiniteAlerts.fetchNextPage()}
                                                >
                                                    {infiniteAlerts.isFetchingNextPage
                                                        ? t('notifications.loading')
                                                        : t('notifications.loadMore')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : infiniteAlerts.isLoading ? (
                                    <div className="space-y-2">
                                        {[...Array(6)].map((_, i) => (
                                            <div key={i} className="space-y-1">
                                                <Skeleton className="h-3 w-1/2" />
                                                <Skeleton className="h-3 w-5/6" />
                                                <Skeleton className="h-3 w-2/3" />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-8 text-center text-xs text-neutral-500">
                                        {t('notifications.noAlertsFound')}
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </DialogContent>
                </Dialog>

                {/* Header button is desktop-only — on mobile the same action lives
                    inside the profile dropdown (see SSOSwitcher variant="dropdown" below)
                    so the cramped mobile header doesn't have to fit a 5th item. */}
                {roles.includes('STUDENT') && (
                    <SSOSwitcher variant="button" className="hidden sm:block" />
                )}

                {/* User profile dropdown */}
                <div className="flex items-center gap-1">
                    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
                        <DropdownMenuTrigger
                            className="flex items-center gap-1 md:gap-2"
                            aria-label={t('aria.openProfileMenu')}
                        >
                            {adminLogo !== '' ? (
                                <img
                                    src={adminLogo}
                                    alt={t('profile.logo')}
                                    className={cn(
                                        'rounded-full object-cover',
                                        isCompact ? 'size-8' : 'size-8 md:size-10'
                                    )}
                                />
                            ) : (
                                // Initials fallback so the dropdown trigger always has a visible
                                // affordance — without this, mobile users with no profile pic
                                // saw nothing tappable and couldn't reach Logout / Switch to Learner.
                                <div
                                    className={cn(
                                        'flex shrink-0 items-center justify-center rounded-full bg-primary-500 font-semibold text-neutral-50',
                                        isCompact ? 'size-8 text-sm' : 'size-8 text-sm md:size-10 md:text-base'
                                    )}
                                >
                                    {(adminDetails?.full_name || getUserName() || '?')
                                        .trim()
                                        .charAt(0)
                                        .toUpperCase()}
                                </div>
                            )}
                            <span className="hidden md:inline">
                                {isOpen ? <CaretDown /> : <CaretUp />}
                            </span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="flex flex-col items-start">
                            <InstituteSwitcherMenuSection
                                instituteName={instituteDetails?.institute_name}
                                logoFileId={instituteDetails?.institute_logo_file_id}
                                canSwitch={canSwitchInstitute}
                                onSwitchClick={() => {
                                    setIsOpen(false);
                                    // Open after the menu has closed so its focus return
                                    // doesn't fight the dialog's focus trap.
                                    setTimeout(() => setShowInstituteSwitcher(true), 0);
                                }}
                            />
                            {canViewProfile && (
                                <Sheet>
                                    <SheetTrigger className="w-full p-2 text-left text-sm hover:rounded-sm hover:bg-accent hover:text-accent-foreground">
                                        {t('profile.viewProfileDetails')}
                                    </SheetTrigger>
                                    <SheetContent
                                        className={cn(
                                            'pt-safe-6 max-h-screen overflow-y-auto !border-l border-gray-200 bg-primary-50 p-4 shadow-none md:p-8 [&>button>svg]:size-6 [&>button>svg]:font-thin [&>button>svg]:text-neutral-600 [&>button]:mt-[19px]',
                                            isMobile ? '!w-full !min-w-full' : '!min-w-[565px]'
                                        )}
                                    >
                                        <SheetTitle className="text-primary-500">
                                            {t('profile.profileDetails')}
                                        </SheetTitle>
                                        <div className="mt-6 flex flex-col gap-4">
                                            <div className="flex flex-col items-center gap-4 rounded-lg border border-neutral-200 bg-white p-6 text-center">
                                                <Avatar className="size-24 border-4 border-primary-50 md:size-28">
                                                    {adminLogo !== '' && (
                                                        <AvatarImage
                                                            src={adminLogo}
                                                            alt={t('profile.logo')}
                                                            className="object-cover"
                                                        />
                                                    )}
                                                    <AvatarFallback className="bg-primary-100 text-h2 font-semibold text-primary-500">
                                                        {getInitials(adminDetails?.full_name)}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="flex flex-col items-center gap-2">
                                                    <h2 className="break-words text-h3 font-semibold text-neutral-700">
                                                        {adminDetails?.full_name}
                                                    </h2>
                                                    {adminDetails.roles?.length ? (
                                                        <div
                                                            className="flex flex-wrap items-center justify-center gap-2"
                                                            aria-label={t('profile.roleType')}
                                                        >
                                                            {adminDetails.roles.map((role, idx) => (
                                                                <span
                                                                    key={idx}
                                                                    className="whitespace-nowrap rounded-md border border-primary-200 bg-primary-50 px-2 py-0.5 text-caption font-semibold uppercase text-primary-500"
                                                                >
                                                                    {role.role_name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                </div>
                                                {canEditProfile ? (
                                                    <AdminProfile adminDetails={adminDetails} />
                                                ) : null}
                                            </div>
                                            <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <h3 className="flex items-center gap-2 text-subtitle font-semibold text-neutral-700">
                                                        <IdentificationCard className="size-5 text-primary-500" />
                                                        {t('profile.accountInformation')}
                                                    </h3>
                                                    <MyButton
                                                        buttonType="secondary"
                                                        scale="small"
                                                        onClick={() => {
                                                            setShowEditAccountDetails(true);
                                                        }}
                                                    >
                                                        <PencilSimple className="size-3.5" />
                                                        {t('profile.editDetails')}
                                                    </MyButton>
                                                </div>
                                                <ProfileDetailRow
                                                    icon={<UserCircle className="size-5" />}
                                                    label={t('profile.usernameLabel')}
                                                    value={getUserName()}
                                                    emptyText={t('profile.notProvided')}
                                                />
                                            </section>
                                            <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                                                <h3 className="flex items-center gap-2 text-subtitle font-semibold text-neutral-700">
                                                    <AddressBook className="size-5 text-primary-500" />
                                                    {t('profile.contactInformation')}
                                                </h3>
                                                <ProfileDetailRow
                                                    icon={<EnvelopeSimple className="size-5" />}
                                                    label={t('profile.emailLabel')}
                                                    value={adminDetails?.email}
                                                    emptyText={t('profile.notProvided')}
                                                />
                                                <ProfileDetailRow
                                                    icon={<Phone className="size-5" />}
                                                    label={t('profile.mobileLabel')}
                                                    value={
                                                        adminDetails?.mobile_number
                                                            ? `+${adminDetails.mobile_number}`
                                                            : ''
                                                    }
                                                    emptyText={t('profile.notProvided')}
                                                />
                                            </section>
                                        </div>
                                    </SheetContent>
                                </Sheet>
                            )}
                            {canViewInstitute && (
                                <Sheet>
                                    <SheetTrigger className="w-full p-2 text-left text-sm hover:rounded-sm hover:bg-accent hover:text-accent-foreground">
                                        {t('institute.viewInstituteDetails')}
                                    </SheetTrigger>
                                    <SheetContent
                                        className={cn(
                                            'pt-safe-6 max-h-screen overflow-y-auto !border-l border-gray-200 bg-primary-50 p-4 shadow-none md:p-8 [&>button>svg]:size-6 [&>button>svg]:font-thin [&>button>svg]:text-neutral-600 [&>button]:mt-[19px]',
                                            isMobile ? '!w-full !min-w-full' : '!min-w-[565px]'
                                        )}
                                    >
                                        <SheetTitle className="text-primary-500">
                                            {t('institute.instituteDetails')}
                                        </SheetTitle>
                                        <div className="mt-6 flex flex-col gap-4">
                                            <div className="flex flex-col items-center gap-4 rounded-lg border border-neutral-200 bg-white p-6 text-center">
                                                <div className="flex size-28 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-white p-2 md:size-32">
                                                    {instituteLogo !== '' ? (
                                                        <img
                                                            src={instituteLogo}
                                                            alt={t('profile.logo')}
                                                            className="size-full object-contain"
                                                        />
                                                    ) : (
                                                        <Buildings className="size-12 text-neutral-300" />
                                                    )}
                                                </div>
                                                <div className="flex flex-col items-center gap-2">
                                                    <h2 className="break-words text-h3 font-semibold text-neutral-700">
                                                        {instituteDetails?.institute_name}
                                                    </h2>
                                                    {instituteDetails?.type ? (
                                                        <span
                                                            className="rounded-md border border-primary-200 bg-primary-50 px-2 py-0.5 text-caption font-semibold text-primary-500"
                                                            title={t('institute.instituteType')}
                                                        >
                                                            {instituteDetails.type}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                {canEditInstitute ? (
                                                    <EditDashboardProfileComponent isEdit={true} />
                                                ) : null}
                                            </div>
                                            <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                                                <h3 className="flex items-center gap-2 text-subtitle font-semibold text-neutral-700">
                                                    <AddressBook className="size-5 text-primary-500" />
                                                    {t('institute.contactInformation')}
                                                </h3>
                                                <ProfileDetailRow
                                                    icon={<EnvelopeSimple className="size-5" />}
                                                    label={t('institute.emailLabel')}
                                                    value={instituteDetails?.email}
                                                    emptyText={t('profile.notProvided')}
                                                />
                                                <ProfileDetailRow
                                                    icon={<Phone className="size-5" />}
                                                    label={t('institute.mobileLabel')}
                                                    value={
                                                        instituteDetails?.phone
                                                            ? `+${instituteDetails.phone}`
                                                            : ''
                                                    }
                                                    emptyText={t('profile.notProvided')}
                                                />
                                                <ProfileDetailRow
                                                    icon={<Globe className="size-5" />}
                                                    label={t('institute.websiteLabel')}
                                                    value={instituteDetails?.website_url}
                                                    emptyText={t('profile.notProvided')}
                                                />
                                            </section>
                                            <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                                                <h3 className="flex items-center gap-2 text-subtitle font-semibold text-neutral-700">
                                                    <MapPin className="size-5 text-primary-500" />
                                                    {t('institute.locationDetails')}
                                                </h3>
                                                <ProfileDetailRow
                                                    icon={<MapTrifold className="size-5" />}
                                                    label={t('institute.addressLabel')}
                                                    value={instituteDetails?.address}
                                                    emptyText={t('profile.notProvided')}
                                                />
                                                <div className="grid grid-cols-2 gap-4 border-t border-neutral-100 pt-4">
                                                    <InstituteDetailCell
                                                        label={t('institute.cityLabel')}
                                                        value={instituteDetails?.city}
                                                        emptyText={t('profile.notProvided')}
                                                    />
                                                    <InstituteDetailCell
                                                        label={t('institute.stateLabel')}
                                                        value={instituteDetails?.state}
                                                        emptyText={t('profile.notProvided')}
                                                    />
                                                    <InstituteDetailCell
                                                        label={t('institute.countryLabel')}
                                                        value={instituteDetails?.country}
                                                        emptyText={t('profile.notProvided')}
                                                    />
                                                    <InstituteDetailCell
                                                        label={t('institute.pincodeLabel')}
                                                        value={instituteDetails?.pin_code}
                                                        emptyText={t('profile.notProvided')}
                                                    />
                                                </div>
                                            </section>
                                        </div>
                                    </SheetContent>
                                </Sheet>
                            )}
                            {roles.includes('STUDENT') && (
                                <DropdownMenuItem className="w-full cursor-pointer">
                                    <SSOSwitcher variant="dropdown" />
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                                onClick={handleLogout}
                                className="w-full cursor-pointer"
                            >
                                {t('logout')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            {showEditAccountDetails && (
                <AccountDetailsEdit
                    open={showEditAccountDetails}
                    setOpen={setShowEditAccountDetails}
                />
            )}
            {canSwitchInstitute && (
                <InstituteSwitcherDialog
                    open={showInstituteSwitcher}
                    onOpenChange={setShowInstituteSwitcher}
                />
            )}
        </div>
    );
}

function getInitials(name?: string | null) {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('');
}

function ProfileDetailRow({
    icon,
    label,
    value,
    emptyText,
}: {
    icon: React.ReactNode;
    label: string;
    value?: string | null;
    emptyText: string;
}) {
    return (
        <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                {icon}
            </span>
            <div className="flex min-w-0 flex-col">
                <span className="text-caption text-neutral-500">{label}</span>
                {value ? (
                    <span className="break-all text-body font-semibold text-neutral-700">
                        {value}
                    </span>
                ) : (
                    <span className="text-body italic text-neutral-400">{emptyText}</span>
                )}
            </div>
        </div>
    );
}

function InstituteDetailCell({
    label,
    value,
    emptyText,
}: {
    label: string;
    value?: string | null;
    emptyText: string;
}) {
    return (
        <div className="flex min-w-0 flex-col">
            <span className="text-caption text-neutral-500">{label}</span>
            {value ? (
                <span className="break-words text-body font-semibold text-neutral-700">
                    {value}
                </span>
            ) : (
                <span className="text-body italic text-neutral-400">{emptyText}</span>
            )}
        </div>
    );
}
