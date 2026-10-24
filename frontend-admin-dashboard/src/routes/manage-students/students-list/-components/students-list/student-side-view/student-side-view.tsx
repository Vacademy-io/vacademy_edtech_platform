import { useTranslation } from 'react-i18next';
import { getActiveRoleDisplaySettingsKey, getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { Sidebar, SidebarContent, SidebarHeader } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/sidebar';
import { useCompactMode } from '@/hooks/use-compact-mode';
import { X, ArrowsOutSimple, CaretLeft, CaretRight, Trash, GraduationCap } from '@phosphor-icons/react';
import { DeleteLeadsDialog } from '@/components/shared/leads/delete-leads-dialog';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { getUserPlans } from '@/services/user-plan';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import DummyProfile from '@/assets/svgs/dummy_profile_photo.svg';
import { StatusChips } from '@/components/design-system/chips';
import { StudentOverview } from './student-overview/student-overview';
import { StudentCourses } from './student-courses/student-courses';
import { StudentLearningProgress } from './student-learning-progress/student-learning-progress';
import { StudentTestRecord } from './student-test-records/student-test-record';
import { StudentCommunicationTimeline } from './student-email-notifications/student-communication-timeline';
import { StudentMembership } from './student-membership/student-membership';
import { StudentUserTagging } from './student-user-tagging/student-user-tagging';
import { StudentBadges } from './student-badges/student-badges';
import { StudentFiles } from './student-files/student-files';
import { StudentPortalAccess } from './student-portal-access/student-portal-access';
import { StudentSubOrg } from './student-sub-org/student-sub-org';
import { StudentReports } from './student-reports/student-reports';
import { StudentEnrollDeroll } from './student-enroll-deroll/student-enroll-deroll';
import { StudentPaymentHistory } from './student-payment-history/student-payment-history';
import { StudentEnquiry } from './student-enquiry/student-enquiry';
import { StudentApplication } from './student-application/student-application';
import { StudentLeadProfile } from './student-lead-profile/student-lead-profile';
import { StudentFullHistory } from './student-full-history/student-full-history';
import { StudentWorkflows } from './student-workflows/student-workflows';
import { StudentParentProfile } from './student-parent/student-parent-profile';
import { StudentOnboardingProfile } from './student-onboarding/student-onboarding-profile';
import { LeadFormResponseCard } from '@/routes/audience-manager/list/-components/campaign-users/lead-form-response-card';
import { StudentAttribution } from './student-attribution/student-attribution';
import { LeadMeetingsSection } from '@/components/shared/leads/lead-meetings-section';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { useParentSettings } from '@/hooks/use-parent-settings';
import { useOnboardingSettings } from '@/hooks/use-onboarding-settings';
import { getPublicUrl } from '@/services/upload_file';
import { ErrorBoundary } from '@/components/core/dashboard-loader';
import { useStudentSidebar } from '../../../-context/selected-student-sidebar-context';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, OtherTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn } from '@/lib/utils';
import { useAssistDockVisible } from '@/components/assist-dock/visibility';
import {
    getDisplaySettingsWithFallback,
    getDisplaySettingsFromCache,
} from '@/services/display-settings';
import { type StudentSideViewSettings, type StudentSideViewTabId } from '@/types/display-settings';
import {
    TAB_ID_TO_VISIBILITY_KEY,
    STUDENT_SIDE_VIEW_TAB_LABELS as TAB_LABELS,
} from '@/constants/display-settings/student-side-view-tabs';
import { ProfileQuickContact } from './profile-ui';
import { GroupedNavRail } from './grouped-nav-rail';
import { SECTION_REGISTRY } from './nav-groups';

// Resolve which tab should open when the side view first renders. Honours
// the saved default tab when it's still visible, otherwise falls back to
// the first visible tab in the configured render order.
function resolveInitialCategory(settings: StudentSideViewSettings): StudentSideViewTabId {
    const orderedVisible = orderedVisibleTabIds(settings);
    if (settings.defaultTab && orderedVisible.includes(settings.defaultTab)) {
        return settings.defaultTab;
    }
    return orderedVisible[0] ?? 'overview';
}

// Tabs filtered by visibility flags and sorted by `tabOrders`. Tabs without
// an explicit order land at the end (preserving their declaration order).
function orderedVisibleTabIds(settings: StudentSideViewSettings): StudentSideViewTabId[] {
    const all: StudentSideViewTabId[] = [
        'overview',
        'courses',
        'learningProgress',
        'testRecord',
        'notifications',
        'membership',
        'paymentHistory',
        'userTagging',
        'badges',
        'files',
        'portalAccess',
        'reports',
        'enrollDeroll',
        'enquiry',
        'application',
        'lead',
        'fullHistory',
        'workflows',
        'parent',
        'onboarding',
    ];
    const orders = settings.tabOrders ?? {};
    return all
        .filter((id) => {
            const flag = settings[TAB_ID_TO_VISIBILITY_KEY[id]];
            return flag === true;
        })
        .sort((a, b) => {
            const oa = orders[a] ?? Number.MAX_SAFE_INTEGER;
            const ob = orders[b] ?? Number.MAX_SAFE_INTEGER;
            return oa - ob;
        });
}

export const StudentSidebar = ({
    selectedTab,
    examType,
    isStudentList,
    isSubmissionTab,
    isEnrollRequestStudentList,
    enquiryId,
    applicantId,
    className,
    packageSessionId,
    defaultLeadProfile,
}: {
    selectedTab?: string;
    examType?: string;
    isStudentList?: boolean;
    isSubmissionTab?: boolean;
    isEnrollRequestStudentList?: boolean;
    enquiryId?: string;
    applicantId?: string;
    className?: string;
    packageSessionId?: string;
    /** Open the Lead Profile tab by default each time a lead is opened (lead lists). */
    defaultLeadProfile?: boolean;
}) => {
    const { t } = useTranslation('manageStudentsSideView');
    const { state, setOpen, setOpenMobile } = useSidebar();
    const { isCompact } = useCompactMode();
    const assistDockVisible = useAssistDockVisible();
    const [category, setCategory] = useState('overview');
    // Tab-bar scroll affordance: track whether more tabs sit off either edge so
    // we can show clickable chevrons — the plain fade wasn't a clear enough cue
    // that the tab row is horizontally scrollable.
    const [tabCanScrollLeft, setTabCanScrollLeft] = useState(false);
    const [tabCanScrollRight, setTabCanScrollRight] = useState(false);
    // Explicitly close both desktop + mobile sidebar state. Using `toggleSidebar`
    // hit a stale-closure case where `isMobile` could be wrong post-hydration,
    // so the X click flipped the wrong state on touch viewports.
    const closeSidebar = () => {
        setOpen(false);
        setOpenMobile(false);
    };
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [faceLoader, setFaceLoader] = useState(false);
    const { selectedStudent, setSelectedStudent, openOverlay, isOverlayOpen } = useStudentSidebar();
    const queryClient = useQueryClient();
    // `_response_id` marks a row that came from a lead surface (the lead lists map a lead into
    // StudentTable shape to reuse this sheet). Contacts never carry it, so it doubles as the
    // "is this a lead" test — and only a lead can be deleted here.
    const leadResponseId =
        ((selectedStudent as unknown as Record<string, unknown>)?._response_id as string | null) ??
        null;
    const currentInstituteId = getCurrentInstituteId();
    const canDeleteLead = isAdminForInstitute(currentInstituteId);

    // A soft-cancel (Remove from product) marks the learner's membership/plan
    // CANCELED while their enrollment stays ACTIVE (access continues to expiry).
    // Surface that as a "Cancelled Member" badge next to the status indicator so
    // the admin can tell an active learner apart from an active-but-cancelled one.
    const learnerUserId = selectedStudent?.user_id;
    const { data: learnerPlans } = useQuery({
        queryKey: ['learner-plans-for-cancel-badge', learnerUserId, currentInstituteId],
        queryFn: () =>
            getUserPlans(1, 50, ['CANCELED'], learnerUserId!, currentInstituteId || undefined),
        enabled: !!learnerUserId && !!currentInstituteId,
        staleTime: 60000,
    });
    // NOTE: the /user-plan/all endpoint ignores the requested status filter and
    // returns plans of every status, so we must match CANCELED client-side rather
    // than trust the response to be pre-filtered.
    //
    // A CANCELED plan only means "cancelled membership" when the learner has no
    // live plan for the SAME product (enroll invite). Failed/retried checkouts and
    // superseded duplicates are also parked as CANCELED (e.g. by
    // supersedeAbandonedSubOrgSiblings and the payment-data repair) while the
    // learner's real plan stays ACTIVE — those must not brand a paying learner as
    // a Cancelled Member.
    const isCancelledMember = (() => {
        const plans = learnerPlans?.content ?? [];
        const LIVE_STATUSES = new Set(['ACTIVE', 'PENDING', 'PENDING_FOR_PAYMENT']);
        return plans.some((p) => {
            if ((p.status || '').toUpperCase() !== 'CANCELED') return false;
            const supersededByLiveSibling = plans.some(
                (s) =>
                    s.id !== p.id &&
                    s.enroll_invite_id === p.enroll_invite_id &&
                    LIVE_STATUSES.has((s.status || '').toUpperCase())
            );
            return !supersededByLiveSibling;
        });
    })();

    // Membership courses this learner is enrolled in — resolved from the institute
    // details store (no extra network call) by matching each of their package
    // sessions to a package whose type is MEMBERSHIP. Shown as a line under the
    // status row so an admin sees the membership name at a glance.
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const membershipCourseNames = useMemo(() => {
        const psIds = selectedStudent?.all_package_session_ids?.length
            ? selectedStudent.all_package_session_ids
            : selectedStudent?.package_session_id
              ? [selectedStudent.package_session_id]
              : [];
        const batches = instituteDetails?.batches_for_sessions ?? [];
        const names = psIds
            .map((id) => batches.find((b) => b.id === id))
            .filter((b) => b?.package_dto?.package_type === 'MEMBERSHIP')
            .map((b) => b?.package_dto?.package_name)
            .filter((n): n is string => !!n);
        return Array.from(new Set(names));
    }, [selectedStudent, instituteDetails]);
    const [tabSettings, setTabSettings] = useState<StudentSideViewSettings | null>(null);
    /**
     * navStyle — selects between the horizontal tab bar (default) and the
     * grouped left-rail navigation per the Vacademy design handoff.
     * Now read directly from the typed StudentSideViewSettings.profileNavStyle
     * field. Defaults to 'tabs' for back-compat.
     */
    const navStyle: 'tabs' | 'grouped' = tabSettings?.profileNavStyle ?? 'tabs';
    /**
     * Per-tenant feature-module toggles per the handoff GROUP_TO_MODULE
     * mapping. Missing or undefined entries fall back to true so existing
     * clients see no change.
     */
    const enabledModules = {
        learning: tabSettings?.profileModules?.learning ?? true,
        finance: tabSettings?.profileModules?.finance ?? true,
        crm: tabSettings?.profileModules?.crm ?? true,
        account: tabSettings?.profileModules?.account ?? true,
        records: tabSettings?.profileModules?.records ?? true,
    };
    const tabContainerRef = useRef<HTMLDivElement>(null);
    const activeTabRef = useRef<HTMLButtonElement>(null);
    const leadSettings = useLeadSettings();
    const parentSettings = useParentSettings();
    const onboardingSettings = useOnboardingSettings();

    useEffect(() => {
        if (state == 'expanded') {
            document.body.classList.add('sidebar-open');
        } else {
            document.body.classList.remove('sidebar-open');
        }

        // Cleanup on unmount
        return () => {
            document.body.classList.remove('sidebar-open');
        };
    }, [state]);

    useEffect(() => {
        const fetchTabSettings = async () => {
            const roleKey = getActiveRoleDisplaySettingsKey();

            // Try cache first
            const cachedSettings = getDisplaySettingsFromCache(roleKey);
            const settings =
                cachedSettings?.studentSideView ||
                (await getDisplaySettingsWithFallback(roleKey)).studentSideView;

            if (settings) {
                setTabSettings(settings);
                setCategory(resolveInitialCategory(settings));
            }
        };

        fetchTabSettings();
    }, []);

    // Default to enquiry tab when an enquiryId is passed in (e.g. from /enquiries route)
    // or application tab when applicantId is passed in (e.g. from /application route)
    useEffect(() => {
        if (applicantId && tabSettings?.applicationTab) {
            setCategory('application');
        } else if (enquiryId && tabSettings?.enquiryTab) {
            setCategory('enquiry');
        }
    }, [applicantId, enquiryId, tabSettings]);

    // Lead lists (Lead List / Recent Leads): open the Lead Profile tab by default
    // each time a lead is opened — but only when the lead tab is actually available.
    useEffect(() => {
        if (
            defaultLeadProfile &&
            selectedStudent?.user_id &&
            tabSettings?.leadTab &&
            !leadSettings.isLoading &&
            leadSettings.enabled
        ) {
            setCategory('lead');
        }
    }, [
        defaultLeadProfile,
        selectedStudent?.user_id,
        tabSettings,
        leadSettings.isLoading,
        leadSettings.enabled,
    ]);

    useEffect(() => {
        const fetchImageUrl = async () => {
            if (selectedStudent?.face_file_id) {
                try {
                    setFaceLoader(true);
                    const url = await getPublicUrl(selectedStudent.face_file_id);
                    setImageUrl(url);
                    setFaceLoader(false);
                } catch (error) {
                    console.error('Failed to fetch image URL:', error);
                    setFaceLoader(false);
                }
            } else {
                setImageUrl(null);
            }
        };

        fetchImageUrl();
    }, [selectedStudent, selectedStudent?.face_file_id]);

    // Auto-scroll active tab into view
    useEffect(() => {
        if (activeTabRef.current && tabContainerRef.current) {
            activeTabRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center',
            });
        }
    }, [category]);

    // Track tab-bar overflow so the scroll chevrons appear only when there are
    // tabs hidden off an edge. Recomputes on scroll, resize, and tab changes.
    const updateTabScroll = useCallback(() => {
        const el = tabContainerRef.current;
        if (!el) return;
        setTabCanScrollLeft(el.scrollLeft > 4);
        setTabCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    }, []);

    useEffect(() => {
        updateTabScroll();
        const el = tabContainerRef.current;
        if (!el) return;
        el.addEventListener('scroll', updateTabScroll, { passive: true });
        window.addEventListener('resize', updateTabScroll);
        return () => {
            el.removeEventListener('scroll', updateTabScroll);
            window.removeEventListener('resize', updateTabScroll);
        };
    }, [updateTabScroll, tabSettings, category, selectedStudent?.sub_org_name]);

    const scrollTabs = (dir: 1 | -1) =>
        tabContainerRef.current?.scrollBy({ left: dir * 160, behavior: 'smooth' });

    // The Vacademy design handoff defines ONE primary surface for the learner
    // profile — the fullscreen overlay. The right-side drawer remains mounted
    // only for callers that still use it programmatically (refresh hooks,
    // legacy entry points); whenever the overlay is open we render null so
    // the drawer never visually competes with the overlay. Placed AFTER all
    // hooks per Rules of Hooks.
    if (isOverlayOpen) return null;

    return (
        <Sidebar
            side="right"
            preventOutsideClose
            // Align sidebar top to navbar bottom (compact 48px / default 56px mobile / 72px desktop, see top-navbar.tsx).
            className={cn(
                isCompact ? '!top-12' : '!top-14 md:!top-[72px]', // design-lint-ignore: mirrors navbar's md:h-[72px]
                className
            )}
        >
            {/* pr-14 keeps content clear of the fixed Assist Dock rail (w-14) that overlays this
                panel's right edge — only when the rail is visible for this role. */}
            <SidebarContent
                className={cn(
                    'sidebar-content flex flex-col !gap-0 border-l border-t border-neutral-200 bg-white font-app text-neutral-700',
                    assistDockVisible && 'pr-14'
                )}
            >
                <SidebarHeader className="sticky top-0 z-10 !mt-0 !gap-0 !p-0 border-b border-neutral-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-1.5 px-3 pb-2 pt-1.5">
                        {/* Identity row: avatar + name/status + actions */}
                        <div className="flex items-center gap-2">
                            <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-100 ring-1 ring-primary-100">
                                {faceLoader ? (
                                    <div className="size-4 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                                ) : imageUrl ? (
                                    <img
                                        src={imageUrl}
                                        alt={selectedStudent?.full_name || t('profile.avatarAlt')}
                                        className="size-full object-cover"
                                    />
                                ) : (
                                    <DummyProfile className="size-6 text-neutral-400" />
                                )}
                            </div>

                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                <h2
                                    className={cn(
                                        'min-w-0 truncate text-base font-semibold leading-tight',
                                        selectedStudent?.full_name
                                            ? 'text-neutral-900'
                                            : 'text-neutral-400'
                                    )}
                                    title={selectedStudent?.full_name}
                                >
                                    {selectedStudent?.full_name || t('profile.unknownName')}
                                </h2>
                                {selectedStudent?.status && (
                                    <div className="shrink-0">
                                        <StatusChips status={selectedStudent.status} />
                                    </div>
                                )}
                                {isCancelledMember && (
                                    <span
                                        className="shrink-0 whitespace-nowrap rounded-full bg-danger-50 px-2 py-0.5 text-xs font-medium text-danger-600 ring-1 ring-danger-200"
                                        title={t('status.cancelledMemberTooltip')}
                                    >
                                        {t('status.cancelledMember')}
                                    </span>
                                )}
                            </div>

                            {/* The full-screen profile overlay is mounted only by the
                                canonical StudentSidebarProvider (students list, contacts,
                                leads, admissions). Surfaces that reuse this sheet under a
                                lighter ad-hoc context — e.g. the assessment / homework /
                                evaluation submission tabs — don't supply `openOverlay`,
                                so we hide the expand affordance there instead of crashing
                                on click (TypeError: openOverlay is not a function). */}
                            {/* Delete is offered only for leads (rows carrying a `_response_id`)
                                and only to admins — a contact's row here is a real enrolled
                                learner, which this endpoint deliberately can't touch. */}
                            {leadResponseId && canDeleteLead && (
                                <button
                                    onClick={() => setDeleteOpen(true)}
                                    className="flex size-9 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-danger-50 hover:text-danger-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-400"
                                    aria-label={t('actions.deleteLead')}
                                    title={t('actions.deleteLead')}
                                >
                                    <Trash className="size-5" />
                                </button>
                            )}
                            {typeof openOverlay === 'function' && (
                                <button
                                    onClick={() => openOverlay()}
                                    className="flex size-9 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-primary-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                    aria-label={t('actions.openFullProfile')}
                                    title={t('actions.openFullProfile')}
                                >
                                    <ArrowsOutSimple className="size-5" />
                                </button>
                            )}
                            <button
                                onClick={closeSidebar}
                                className="flex size-9 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                aria-label={t('actions.closePanel')}
                            >
                                <X className="size-5" />
                            </button>
                        </div>

                        {/* Membership course name(s) — shown right under the status row
                            when the learner is enrolled in a MEMBERSHIP-type package. */}
                        {membershipCourseNames.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {membershipCourseNames.map((name) => (
                                    <span
                                        key={name}
                                        title={name}
                                        className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
                                    >
                                        <GraduationCap className="size-3 shrink-0" />
                                        <span className="truncate">{name}</span>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Quick contact — mailto / tel / wa.me. Renders nothing when no
                            usable contact data exists, so it stays out of the way for
                            unlinked entries (e.g. submission-only respondents). */}
                        <ProfileQuickContact
                            email={selectedStudent?.email}
                            phone={selectedStudent?.mobile_number}
                        />

                        {/* Sub Organization and Roles Badges */}
                        {(selectedStudent?.sub_org_name ||
                            selectedStudent?.comma_separated_org_roles) && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {selectedStudent?.sub_org_name && (
                                    <span className="rounded-full bg-info-50 px-2 py-0.5 text-xs font-medium text-info-600">
                                        {selectedStudent.sub_org_name}
                                    </span>
                                )}
                                {selectedStudent?.comma_separated_org_roles &&
                                    selectedStudent.comma_separated_org_roles
                                        .split(',')
                                        .map((role, index) => {
                                            const r = role.trim().toUpperCase();
                                            const label =
                                                r === 'ADMIN'
                                                    ? t('roles.admin')
                                                    : r === 'LEARNER'
                                                      ? t('roles.learner')
                                                      : role.trim().toLowerCase().replace(/_/g, ' ');
                                            // Role badges keep their normal amber look, and only
                                            // turn red once the member has gone inactive.
                                            const isInactive =
                                                selectedStudent?.status === 'INACTIVE';
                                            return (
                                                <span
                                                    key={index}
                                                    className={cn(
                                                        'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                                                        isInactive
                                                            ? 'bg-danger-50 text-danger-600 ring-1 ring-danger-200'
                                                            : 'bg-warning-50 text-warning-600'
                                                    )}
                                                >
                                                    {label}
                                                </span>
                                            );
                                        })}
                            </div>
                        )}

                        {/* Tab navigation — flat segmented, horizontally scrollable.
                            The right-edge fade hints that more tabs exist off-screen.
                            Hidden when navStyle === 'grouped' (the left-rail handles
                            navigation in that mode). */}
                        {navStyle === 'tabs' && !isEnrollRequestStudentList && tabSettings && (
                            <div className="relative">
                                <div
                                    ref={tabContainerRef}
                                    role="tablist"
                                    aria-label={t('tabBar.ariaLabel')}
                                    className="scrollbar-hide flex gap-1 overflow-x-auto scroll-smooth pr-6"
                                >
                                    {orderedVisibleTabIds(tabSettings).map((tabId) => {
                                        // lead/fullHistory require the lead system to be enabled
                                        if (
                                            (tabId === 'lead' || tabId === 'fullHistory') &&
                                            (leadSettings.isLoading || !leadSettings.enabled)
                                        ) {
                                            return null;
                                        }
                                        // parent (Guardian) requires the guardian-linking
                                        // feature to be enabled — a distinct toggle from
                                        // the lead system, gated separately.
                                        if (
                                            tabId === 'parent' &&
                                            (parentSettings.isLoading || !parentSettings.enabled)
                                        ) {
                                            return null;
                                        }
                                        // onboarding requires the Onboarding
                                        // Flows feature to be enabled — its
                                        // own toggle, independent of leads.
                                        if (
                                            tabId === 'onboarding' &&
                                            (onboardingSettings.isLoading || !onboardingSettings.enabled)
                                        ) {
                                            return null;
                                        }
                                        const label =
                                            tabId === 'courses'
                                                ? getTerminologyPlural(
                                                      ContentTerms.Course,
                                                      SystemTerms.Course
                                                  )
                                                : TAB_LABELS[tabId];
                                        const isActive = category === tabId;
                                        return (
                                            <button
                                                key={tabId}
                                                role="tab"
                                                aria-selected={isActive}
                                                ref={isActive ? activeTabRef : null}
                                                className={cn(
                                                    'shrink-0 whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                                                    isActive
                                                        ? 'bg-primary-500 text-white shadow-sm'
                                                        : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800'
                                                )}
                                                onClick={() => setCategory(tabId)}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}

                                    {/* SubOrg is shown alongside the configurable tabs whenever the
                                        student belongs to one — it has no settings flag of its own. */}
                                    {selectedStudent?.sub_org_name && (
                                        <button
                                            role="tab"
                                            aria-selected={category === 'subOrg'}
                                            ref={category === 'subOrg' ? activeTabRef : null}
                                            className={cn(
                                                'shrink-0 whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                                                category === 'subOrg'
                                                    ? 'bg-primary-500 text-white shadow-sm'
                                                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800'
                                            )}
                                            onClick={() => setCategory('subOrg')}
                                        >
                                            {getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg)}
                                        </button>
                                    )}
                                </div>
                                {/* Scroll chevrons — shown only when tabs overflow
                                    that edge, so it's clear the row scrolls. */}
                                {tabCanScrollLeft && (
                                    <button
                                        type="button"
                                        aria-label={t('tabBar.scrollLeft')}
                                        onClick={() => scrollTabs(-1)}
                                        className="absolute inset-y-0 left-0 flex items-center bg-gradient-to-r from-white via-white to-transparent pr-5 text-neutral-500 transition-colors hover:text-primary-600"
                                    >
                                        <CaretLeft className="size-4" weight="bold" />
                                    </button>
                                )}
                                {tabCanScrollRight && (
                                    <button
                                        type="button"
                                        aria-label={t('tabBar.scrollRight')}
                                        onClick={() => scrollTabs(1)}
                                        className="absolute inset-y-0 right-0 flex items-center bg-gradient-to-l from-white via-white to-transparent pl-5 text-neutral-500 transition-colors hover:text-primary-600"
                                    >
                                        <CaretRight className="size-4" weight="bold" />
                                    </button>
                                )}
                            </div>
                        )}

                    </div>
                </SidebarHeader>

                {/* Body wrapper — grouped mode renders the left-rail nav next
                    to the scrollable content; tabs mode keeps content full-width. */}
                <div
                    className={
                        navStyle === 'grouped'
                            ? 'flex min-h-0 min-w-0 flex-1'
                            : // Real bounded flex column (not display:contents): gives the
                              // scroll body below a definite height so it scrolls vertically
                              // instead of growing past the panel.
                              'flex min-h-0 min-w-0 flex-1 flex-col'
                    }
                >
                    {navStyle === 'grouped' && tabSettings && (
                        <GroupedNavRail
                            activeId={category}
                            onSelect={(id) => setCategory(id)}
                            visibleIds={
                                new Set(
                                    SECTION_REGISTRY.filter((s) => {
                                        const flag =
                                            s.id === 'subOrg'
                                                ? !!selectedStudent?.sub_org_name
                                                : tabSettings[
                                                      TAB_ID_TO_VISIBILITY_KEY[
                                                          s.id as keyof typeof TAB_ID_TO_VISIBILITY_KEY
                                                      ]
                                                  ] === true;
                                        const isLeadGated =
                                            s.id === 'lead' || s.id === 'fullHistory';
                                        if (
                                            isLeadGated &&
                                            (!leadSettings.enabled || leadSettings.isLoading)
                                        )
                                            return false;
                                        // Guardian section — gated on its own feature
                                        // toggle, separate from the lead system.
                                        const isParentGated = s.id === 'parent';
                                        if (
                                            isParentGated &&
                                            (!parentSettings.enabled || parentSettings.isLoading)
                                        )
                                            return false;
                                        // Onboarding section — gated on its own
                                        // feature toggle, separate from leads.
                                        const isOnboardingGated = s.id === 'onboarding';
                                        if (
                                            isOnboardingGated &&
                                            (!onboardingSettings.enabled || onboardingSettings.isLoading)
                                        )
                                            return false;
                                        return flag;
                                    }).map((s) => s.id)
                                )
                            }
                            enabledModules={enabledModules}
                        />
                    )}
                {/* The single scroll container for the tab body.
                    - min-h-0 : lets this flex child shrink below its content so
                      overflow-y-auto actually scrolls (vertical scroll fix).
                    - min-w-0 + overflow-x-hidden : hard guarantee the body never
                      scrolls horizontally — wide children (tables, long strings,
                      email HTML) are contained, not allowed to push the panel
                      wider. Each tab wraps/truncates its own content so nothing
                      is clipped. */}
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
                    {/* Audience-form responses card — only on the Lead tab.
                        Renders only when the side view was opened from a lead
                        row (campaign-users / recent-leads); manage-students
                        rows don't carry the attached metadata. */}
                    {category === 'lead' && <LeadFormResponseCard />}
                    {/* Where this lead came from. The campaign lives in utm_attribution,
                        not in the form answers, so the card above cannot show it — without
                        this the Lead tab has no campaign anywhere on it. Renders nothing
                        when the lead arrived untagged, same as on the learner Overview. */}
                    {category === 'lead' && (
                        <StudentAttribution
                            userId={selectedStudent?.user_id}
                            instituteId={instituteDetails?.id}
                            email={selectedStudent?.email}
                            mobileNumber={selectedStudent?.mobile_number}
                        />
                    )}
                    {/* Meetings linked to this lead (by response id / user id / email) —
                        renders alongside the form-response card on the Lead tab. */}
                    {category === 'lead' && <LeadMeetingsSection className="my-3" />}
                    <ErrorBoundary>
                        {category === 'courses' && tabSettings?.coursesTab && (
                            <StudentCourses
                                isSubmissionTab={isSubmissionTab}
                                packageSessionId={packageSessionId}
                            />
                        )}
                        {category === 'overview' && tabSettings?.overviewTab && (
                            <StudentOverview isSubmissionTab={isSubmissionTab} />
                        )}
                        {category === 'learningProgress' &&
                            tabSettings?.progressTab &&
                            !isEnrollRequestStudentList && (
                                <StudentLearningProgress isSubmissionTab={isSubmissionTab} />
                            )}
                        {category === 'testRecord' &&
                            tabSettings?.testTab &&
                            !isEnrollRequestStudentList && (
                                <StudentTestRecord
                                    selectedTab={selectedTab || ''}
                                    examType={examType || ''}
                                    isStudentList={isStudentList || false}
                                />
                            )}
                        {category === 'notifications' &&
                            tabSettings?.notificationTab &&
                            !isEnrollRequestStudentList && <StudentCommunicationTimeline />}
                        {category === 'membership' &&
                            tabSettings?.membershipTab &&
                            !isEnrollRequestStudentList && (
                                <StudentMembership isSubmissionTab={isSubmissionTab} />
                            )}
                        {category === 'paymentHistory' &&
                            tabSettings?.paymentHistoryTab &&
                            !isEnrollRequestStudentList && <StudentPaymentHistory />}
                        {category === 'userTagging' &&
                            tabSettings?.userTaggingTab &&
                            !isEnrollRequestStudentList && (
                                <StudentUserTagging isSubmissionTab={isSubmissionTab} />
                            )}
                        {category === 'badges' &&
                            tabSettings?.badgesTab &&
                            !isEnrollRequestStudentList && (
                                <StudentBadges isSubmissionTab={isSubmissionTab} />
                            )}
                        {category === 'files' &&
                            tabSettings?.fileTab &&
                            !isEnrollRequestStudentList && <StudentFiles />}
                        {category === 'portalAccess' &&
                            tabSettings?.portalAccessTab &&
                            !isEnrollRequestStudentList && (
                                <StudentPortalAccess isSubmissionTab={isSubmissionTab} />
                            )}
                        {category === 'subOrg' &&
                            selectedStudent?.sub_org_name &&
                            !isEnrollRequestStudentList && (
                                <StudentSubOrg isSubmissionTab={isSubmissionTab} />
                            )}
                        {category === 'reports' &&
                            tabSettings?.reportsTab &&
                            !isEnrollRequestStudentList && <StudentReports />}
                        {category === 'enrollDeroll' &&
                            tabSettings?.enrollDerollTab &&
                            !isEnrollRequestStudentList && <StudentEnrollDeroll />}
                        {category === 'enquiry' &&
                            tabSettings?.enquiryTab &&
                            !isEnrollRequestStudentList && <StudentEnquiry enquiryId={enquiryId} />}
                        {category === 'application' &&
                            tabSettings?.applicationTab &&
                            !isEnrollRequestStudentList && (
                                <StudentApplication applicantId={applicantId} />
                            )}
                        {category === 'lead' &&
                            tabSettings?.leadTab &&
                            !leadSettings.isLoading &&
                            leadSettings.enabled &&
                            !isEnrollRequestStudentList &&
                            selectedStudent?.user_id && (
                                <StudentLeadProfile userId={selectedStudent.user_id} />
                            )}
                        {category === 'fullHistory' &&
                            tabSettings?.fullHistoryTab &&
                            !leadSettings.isLoading &&
                            leadSettings.enabled &&
                            !isEnrollRequestStudentList &&
                            selectedStudent?.user_id && (
                                <StudentFullHistory studentUserId={selectedStudent.user_id} />
                            )}
                        {/* Workflows — the automations that ran for this person, each
                            with a Retry. Gated only on its own visibility flag: it has
                            nothing to do with the lead system, so an institute that
                            never turned leads on still gets it. */}
                        {category === 'workflows' &&
                            tabSettings?.workflowsTab &&
                            !isEnrollRequestStudentList &&
                            selectedStudent?.user_id &&
                            currentInstituteId && (
                                <StudentWorkflows
                                    userId={selectedStudent.user_id}
                                    instituteId={currentInstituteId}
                                />
                            )}
                        {category === 'parent' &&
                            tabSettings?.parentTab &&
                            !parentSettings.isLoading &&
                            parentSettings.enabled &&
                            !isEnrollRequestStudentList &&
                            selectedStudent?.user_id && (
                                <StudentParentProfile userId={selectedStudent.user_id} />
                            )}
                        {category === 'onboarding' &&
                            tabSettings?.onboardingTab &&
                            !onboardingSettings.isLoading &&
                            onboardingSettings.enabled &&
                            !isEnrollRequestStudentList &&
                            selectedStudent?.user_id && (
                                <StudentOnboardingProfile
                                    userId={selectedStudent.user_id}
                                    subjectFullName={selectedStudent.full_name}
                                    subjectEmail={selectedStudent.email}
                                    subjectMobileNumber={selectedStudent.mobile_number}
                                />
                            )}
                    </ErrorBoundary>
                </div>
                </div>
            </SidebarContent>

            {leadResponseId && currentInstituteId && (
                <DeleteLeadsDialog
                    open={deleteOpen}
                    onOpenChange={setDeleteOpen}
                    instituteId={currentInstituteId}
                    responseIds={[leadResponseId]}
                    userId={selectedStudent?.user_id}
                    leadName={selectedStudent?.full_name}
                    onSuccess={() => {
                        // The lead is gone from every list — close the sheet rather than leave
                        // it showing a row that no longer exists, and refetch the lists behind it.
                        // These keys must match the lists' own useQuery keys exactly (prefix
                        // matching only helps within a key, not across a different first element),
                        // so they mirror what the tables invalidate after a status change.
                        queryClient.invalidateQueries({ queryKey: ['recent-leads'] });
                        queryClient.invalidateQueries({ queryKey: ['campaignUsers'] });
                        queryClient.invalidateQueries({ queryKey: ['user-lead-profile'] });
                        queryClient.invalidateQueries({ queryKey: ['lead-profiles-batch'] });
                        setSelectedStudent(null);
                        closeSidebar();
                    }}
                />
            )}
        </Sidebar>
    );
};
