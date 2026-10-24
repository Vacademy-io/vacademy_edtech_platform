/**
 * StudentProfileOverlay — the "full profile" surface.
 *
 * A large centered dialog (~90vw × 90vh) launched from either the side drawer's
 * "Expand" button OR a row-level expand button. Gives the same data far more
 * room to breathe than the ~400px drawer can — hero band on top, vertical
 * section nav on the left, scrollable content panel on the right.
 *
 * Renders the exact same tab body components as the drawer (StudentOverview,
 * StudentCourses, etc.) so there is one source of truth for what each section
 * shows; only the layout differs.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { X, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { StatusChips } from '@/components/design-system/chips';
import { cn } from '@/lib/utils';
import DummyProfile from '@/assets/svgs/dummy_profile_photo.svg';
import { getPublicUrl } from '@/services/upload_file';
import {
    getDisplaySettingsWithFallback,
    getDisplaySettingsFromCache,
} from '@/services/display-settings';
import { type StudentSideViewSettings, type StudentSideViewTabId } from '@/types/display-settings';
import { TAB_ID_TO_VISIBILITY_KEY } from '@/constants/display-settings/student-side-view-tabs';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { useParentSettings } from '@/hooks/use-parent-settings';
import { useOnboardingSettings } from '@/hooks/use-onboarding-settings';
import { useLeadProfiles } from '@/hooks/use-lead-profiles';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { ProfileQuickContact, ProfileContextStrip, type ContextStripItem } from './profile-ui';

/** Two-letter initials from a full name, ALL CAPS. */
function initialsOf(name: string | null | undefined): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return ((parts[0]![0] ?? '') + (parts[parts.length - 1]![0] ?? '')).toUpperCase();
}

import { GroupedNavRail } from './grouped-nav-rail';
import { normalizeTierKey, tierChipStyle, useLeadTiers } from '@/hooks/use-lead-tiers';
import { SECTION_REGISTRY } from './nav-groups';

// Tab body components — same source of truth used by the drawer.
import { StudentOverview } from './student-overview/student-overview';
import { StudentCourses } from './student-courses/student-courses';
import { StudentLearningProgress } from './student-learning-progress/student-learning-progress';
import { StudentTestRecord } from './student-test-records/student-test-record';
import { StudentCommunicationTimeline } from './student-email-notifications/student-communication-timeline';
import { StudentMembership } from './student-membership/student-membership';
import { StudentUserTagging } from './student-user-tagging/student-user-tagging';
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
import { StudentParentProfile } from './student-parent/student-parent-profile';
import { StudentOnboardingProfile } from './student-onboarding/student-onboarding-profile';

type SectionId = StudentSideViewTabId | 'subOrg';

// Per-section icon + label resolution lives inside the shared GroupedNavRail
// + SECTION_REGISTRY (see ./nav-groups) so the overlay nav stays in lockstep
// with the side-drawer's grouped nav and tenant tab-renaming settings.

// Stable section order — mirrors the drawer's orderedVisibleTabIds but kept
// local so the overlay nav order is predictable.
const DEFAULT_ORDER: StudentSideViewTabId[] = [
    'overview',
    'courses',
    'learningProgress',
    'testRecord',
    'notifications',
    'membership',
    'paymentHistory',
    'userTagging',
    'files',
    'portalAccess',
    'reports',
    'enrollDeroll',
    'enquiry',
    'application',
    'lead',
    'fullHistory',
    'parent',
    'onboarding',
];

function orderedVisibleSectionIds(settings: StudentSideViewSettings): StudentSideViewTabId[] {
    const orders = settings.tabOrders ?? {};
    return DEFAULT_ORDER.filter((id) => {
        const flag = settings[TAB_ID_TO_VISIBILITY_KEY[id]];
        return flag === true;
    }).sort((a, b) => {
        const oa = orders[a] ?? Number.MAX_SAFE_INTEGER;
        const ob = orders[b] ?? Number.MAX_SAFE_INTEGER;
        return oa - ob;
    });
}

function resolveInitialSection(settings: StudentSideViewSettings): StudentSideViewTabId {
    const visible = orderedVisibleSectionIds(settings);
    if (settings.defaultTab && visible.includes(settings.defaultTab)) {
        return settings.defaultTab;
    }
    return visible[0] ?? 'overview';
}

export const StudentProfileOverlay = () => {
    const { t } = useTranslation('manageStudentsProfileOverlay');
    const {
        selectedStudent,
        isOverlayOpen,
        closeOverlay,
        learnerListPosition,
        goPrevLearner,
        goNextLearner,
        isSubmissionTab,
    } = useStudentSidebar();
    const hasPrev = !!learnerListPosition && learnerListPosition.index > 0;
    const hasNext =
        !!learnerListPosition && learnerListPosition.index < learnerListPosition.total - 1;
    const leadSettings = useLeadSettings();
    const parentSettings = useParentSettings();
    const onboardingSettings = useOnboardingSettings();
    const [tabSettings, setTabSettings] = useState<StudentSideViewSettings | null>(null);
    const [activeSection, setActiveSection] = useState<SectionId>('overview');
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [faceLoader, setFaceLoader] = useState(false);
    const contentScrollRef = useRef<HTMLDivElement>(null);

    // Lead profile for the header tier pill. Reuses the batch hook so this
    // request is deduped against any list-level fetch already in flight.
    const headerUserId = selectedStudent?.user_id || selectedStudent?.id || '';
    const { profiles: leadProfilesMap } = useLeadProfiles(
        headerUserId ? [headerUserId] : [],
        !!leadSettings.enabled
    );
    const leadHeaderProfile = headerUserId ? leadProfilesMap[headerUserId] : undefined;
    // Header pill only for an EXPLICIT tier override (unchanged rule) — label/colour
    // now come from the institute catalog so custom tiers render correctly.
    const tierCatalog = useLeadTiers();
    const tier = leadHeaderProfile?.lead_tier
        ? normalizeTierKey(leadHeaderProfile.lead_tier) || undefined
        : undefined;
    const isActive = (selectedStudent?.status || '').toUpperCase() === 'ACTIVE';
    const tierLabel = tier ? tierCatalog.labelFor(tier) : undefined;

    // Load display settings (which sections are visible + order) when the overlay opens.
    useEffect(() => {
        if (!isOverlayOpen) return;
        let cancelled = false;
        (async () => {
            const roleKey = getActiveRoleDisplaySettingsKey();
            const cached = getDisplaySettingsFromCache(roleKey);
            const settings =
                cached?.studentSideView ||
                (await getDisplaySettingsWithFallback(roleKey)).studentSideView;
            if (!cancelled && settings) {
                setTabSettings(settings);
                setActiveSection(resolveInitialSection(settings));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isOverlayOpen]);

    // Face image loading — mirrors the drawer's behavior.
    useEffect(() => {
        if (!isOverlayOpen) return;
        const fileId = selectedStudent?.face_file_id;
        if (!fileId) {
            setImageUrl(null);
            return;
        }
        let cancelled = false;
        setFaceLoader(true);
        getPublicUrl(fileId)
            .then((url) => {
                if (!cancelled) setImageUrl(url);
            })
            .finally(() => {
                if (!cancelled) setFaceLoader(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isOverlayOpen, selectedStudent?.face_file_id]);

    // Reset scroll to top whenever the user picks a new section.
    useEffect(() => {
        if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
    }, [activeSection]);

    // Keyboard nav: ← / → walk through the surrounding learner list without
    // closing the overlay. Ignored when focus is inside a text-entry control
    // (input / textarea / contenteditable) so the arrow keys still move the
    // caret. Esc is handled by the Dialog primitive.
    useEffect(() => {
        if (!isOverlayOpen) return;
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const tag = (target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
            if (e.key === 'ArrowLeft' && hasPrev) {
                e.preventDefault();
                goPrevLearner();
            } else if (e.key === 'ArrowRight' && hasNext) {
                e.preventDefault();
                goNextLearner();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOverlayOpen, hasPrev, hasNext, goPrevLearner, goNextLearner]);

    if (!selectedStudent) return null;

    const visibleIds = tabSettings ? orderedVisibleSectionIds(tabSettings) : [];

    const renderSection = (id: SectionId) => {
        switch (id) {
            case 'overview':
                return <StudentOverview isSubmissionTab={isSubmissionTab} />;
            case 'courses':
                return <StudentCourses isSubmissionTab={isSubmissionTab} />;
            case 'learningProgress':
                return <StudentLearningProgress isSubmissionTab={isSubmissionTab} />;
            case 'testRecord':
                return <StudentTestRecord selectedTab={undefined} examType={undefined} />;
            case 'notifications':
                return <StudentCommunicationTimeline />;
            case 'membership':
                return <StudentMembership isSubmissionTab={isSubmissionTab} />;
            case 'paymentHistory':
                return <StudentPaymentHistory />;
            case 'userTagging':
                return <StudentUserTagging isSubmissionTab={isSubmissionTab} />;
            case 'files':
                return <StudentFiles />;
            case 'portalAccess':
                return <StudentPortalAccess isSubmissionTab={isSubmissionTab} />;
            case 'reports':
                return <StudentReports />;
            case 'enrollDeroll':
                return <StudentEnrollDeroll />;
            case 'enquiry':
                return <StudentEnquiry />;
            case 'application':
                return <StudentApplication />;
            case 'lead':
                return (
                    <StudentLeadProfile userId={selectedStudent.user_id || selectedStudent.id} />
                );
            case 'fullHistory':
                return (
                    <StudentFullHistory
                        studentUserId={selectedStudent.user_id || selectedStudent.id}
                    />
                );
            case 'parent':
                return (
                    <StudentParentProfile userId={selectedStudent.user_id || selectedStudent.id} />
                );
            case 'onboarding':
                return (
                    <StudentOnboardingProfile
                        userId={selectedStudent.user_id || selectedStudent.id}
                        subjectFullName={selectedStudent.full_name}
                        subjectEmail={selectedStudent.email}
                        subjectMobileNumber={selectedStudent.mobile_number}
                    />
                );
            case 'subOrg':
                return <StudentSubOrg isSubmissionTab={isSubmissionTab} />;
            default:
                return null;
        }
    };

    return (
        <Dialog open={isOverlayOpen} onOpenChange={(open) => !open && closeOverlay()}>
            <DialogContent
                /* `dialog-no-close-icon` suppresses the primitive's built-in X
                   (we render our own in the hero band). All corners rounded
                   per the design handoff fullscreen card (--r-2xl ≈
                   rounded-2xl). The dim background is owned by the Dialog
                   primitive (DialogOverlay). */
                className="dialog-no-close-icon flex flex-col gap-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white p-0 font-app shadow-2xl sm:max-w-none"
                /* Viewport-relative sizing isn't tokenizable. Handoff spec:
                   100% width / height with a 22px gutter around the card,
                   capped at 1240px wide so the layout stays readable on
                   ultrawide displays. Isolated inline style with comment. */
                style={{
                    width: 'calc(100vw - 44px)',
                    maxWidth: '1240px',
                    height: 'calc(100vh - 44px)',
                }}
            >
                {/* HERO BAND — handoff identity row + meta strip pattern.
                    No leading accent gradient (the eyebrow + name carry the
                    brand voice on their own per LearnerProfile.jsx). */}
                <header className="pt-safe-native relative shrink-0 border-b border-neutral-200 bg-white">
                    <div className="flex flex-col gap-3 px-6 pt-5">
                        <div className="flex items-start gap-4">
                            {/* Avatar — handoff calls for ~52px initials circle
                                with --accent-soft bg + --accent-text initials
                                and a status dot bottom-right. We render a
                                photo when face_file_id resolves, falling back
                                to initials (handoff: "avatars are initial
                                circles"). size-14 (56px) is the closest
                                design-token to the spec's 52px and reads
                                noticeably more prominent than size-12 (48px).
                                The status dot is a 12px green dot with a
                                2.5px white border for ACTIVE learners. */}
                            <div className="relative shrink-0">
                                <div className="flex size-14 items-center justify-center overflow-hidden rounded-full bg-primary-50 text-primary-700 ring-2 ring-primary-200">
                                    {faceLoader ? (
                                        <div className="size-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                                    ) : imageUrl ? (
                                        <img
                                            src={imageUrl}
                                            alt={selectedStudent.full_name || t('header.photoAlt')}
                                            className="size-full object-cover"
                                        />
                                    ) : selectedStudent.full_name ? (
                                        <span className="text-h4 font-bold">
                                            {initialsOf(selectedStudent.full_name)}
                                        </span>
                                    ) : (
                                        <DummyProfile className="size-9 text-neutral-400" />
                                    )}
                                </div>
                                {isActive && (
                                    <span
                                        aria-hidden
                                        className="absolute bottom-0 right-0 block size-3.5 rounded-full border-2 border-white bg-success-500"
                                    />
                                )}
                            </div>

                            {/* Identity — eyebrow + name + status / tier / sub-org
                                pills inline per handoff identity row. */}
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="text-xs font-bold uppercase tracking-widest text-primary-700">
                                    {t('header.title', {
                                        term: getTerminology(
                                            RoleTerms.Learner,
                                            SystemTerms.Learner
                                        ),
                                    })}
                                </span>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1
                                        className={cn(
                                            'min-w-0 max-w-full truncate text-h3 font-semibold leading-tight',
                                            selectedStudent.full_name
                                                ? 'text-neutral-900'
                                                : 'text-neutral-400'
                                        )}
                                        title={selectedStudent.full_name || undefined}
                                    >
                                        {selectedStudent.full_name || t('header.unknownName')}
                                    </h1>
                                    {selectedStudent.status && (
                                        <StatusChips status={selectedStudent.status} />
                                    )}
                                    {tier && (
                                        <span
                                            className="rounded-full border px-2 py-0.5 text-xs font-semibold"
                                            // Inline style: tier colour is admin-picked hex (no design token).
                                            style={tierChipStyle(tierCatalog.colorFor(tier))}
                                            title={
                                                typeof leadHeaderProfile?.best_score === 'number'
                                                    ? t('leadTier.titleWithScore', {
                                                          tier: tierLabel,
                                                          score: leadHeaderProfile.best_score,
                                                      })
                                                    : t('leadTier.titleSimple', { tier: tierLabel })
                                            }
                                        >
                                            {tierLabel}
                                            {typeof leadHeaderProfile?.best_score === 'number'
                                                ? ` · ${leadHeaderProfile.best_score}`
                                                : ''}
                                        </span>
                                    )}
                                    {selectedStudent.sub_org_name && (
                                        <span className="rounded-full bg-info-50 px-2 py-0.5 text-xs font-medium text-info-600">
                                            {selectedStudent.sub_org_name}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Right controls — Prev/Next learner group + quick
                                contact icons + divider + Close. Per handoff:
                                a single bordered group with chevron-left,
                                "{i+1}/{N}", chevron-right; then the email /
                                call / whatsapp buttons; then a vertical 1px
                                divider; then Close. The Prev/Next group only
                                renders when the surrounding table published
                                a learner list. ← / → also walk via keyboard. */}
                            <div className="flex shrink-0 items-center gap-2">
                                {learnerListPosition && (
                                    <div className="inline-flex items-center overflow-hidden rounded-md border border-neutral-200 bg-card">
                                        <button
                                            type="button"
                                            onClick={goPrevLearner}
                                            disabled={!hasPrev}
                                            aria-label={t('nav.prevLearner')}
                                            title={t('nav.prevLearner')}
                                            className="flex size-9 items-center justify-center text-neutral-600 transition-colors hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                                        >
                                            <CaretLeft className="size-4" weight="bold" />
                                        </button>
                                        <span className="select-none border-x border-neutral-200 px-3 py-1.5 text-caption font-semibold tabular-nums text-card-foreground">
                                            {learnerListPosition.index + 1} /{' '}
                                            {learnerListPosition.total}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={goNextLearner}
                                            disabled={!hasNext}
                                            aria-label={t('nav.nextLearner')}
                                            title={t('nav.nextLearner')}
                                            className="flex size-9 items-center justify-center text-neutral-600 transition-colors hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                                        >
                                            <CaretRight className="size-4" weight="bold" />
                                        </button>
                                    </div>
                                )}
                                <ProfileQuickContact
                                    email={selectedStudent.email}
                                    phone={selectedStudent.mobile_number}
                                />
                                <span className="mx-1 h-7 w-px bg-neutral-200" />
                                <button
                                    type="button"
                                    onClick={closeOverlay}
                                    className="flex size-9 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                    aria-label={t('nav.close')}
                                    title={t('nav.close')}
                                >
                                    <X className="size-5" />
                                </button>
                            </div>
                        </div>

                        {/* Context strip */}
                        <ProfileContextStrip
                            items={
                                [
                                    selectedStudent.institute_enrollment_number && {
                                        label: t('contextStrip.enrollmentNo'),
                                        value: selectedStudent.institute_enrollment_number,
                                    },
                                    selectedStudent.created_at && {
                                        label: t('contextStrip.joined'),
                                        value: new Date(
                                            selectedStudent.created_at
                                        ).toLocaleDateString(undefined, {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric',
                                        }),
                                    },
                                    selectedStudent.city && {
                                        label: t('contextStrip.city'),
                                        value: selectedStudent.city,
                                    },
                                    selectedStudent.email && {
                                        label: t('contextStrip.email'),
                                        value: selectedStudent.email,
                                    },
                                    selectedStudent.mobile_number && {
                                        label: t('contextStrip.phone'),
                                        value: selectedStudent.mobile_number,
                                    },
                                ] as Array<ContextStripItem | false | null | undefined>
                            }
                        />
                    </div>
                </header>

                {/* BODY — grouped left rail + scrollable content panel,
                    matching the handoff fullscreen LearnerProfile layout. */}
                <div className="flex min-h-0 flex-1 border-t border-neutral-200">
                    {/* LEFT RAIL — same primitive used by the side-drawer
                        navStyle === 'grouped' branch, so behavior + tenant
                        gating + visual style stay in lockstep. */}
                    <div className="hidden md:flex">
                        <GroupedNavRail
                            activeId={activeSection}
                            onSelect={(id) => setActiveSection(id as SectionId)}
                            visibleIds={
                                new Set<string>([
                                    ...visibleIds.filter((id) => {
                                        // lead/fullHistory require the lead system to be enabled
                                        if (
                                            (id === 'lead' || id === 'fullHistory') &&
                                            (leadSettings.isLoading || !leadSettings.enabled)
                                        ) {
                                            return false;
                                        }
                                        // Guardian requires its own feature toggle — kept
                                        // separate from the lead system on purpose.
                                        if (
                                            id === 'parent' &&
                                            (parentSettings.isLoading || !parentSettings.enabled)
                                        ) {
                                            return false;
                                        }
                                        // Onboarding requires its own feature toggle — kept
                                        // separate from the lead system on purpose.
                                        if (
                                            id === 'onboarding' &&
                                            (onboardingSettings.isLoading ||
                                                !onboardingSettings.enabled)
                                        ) {
                                            return false;
                                        }
                                        // Only registry-known IDs render in the rail.
                                        return SECTION_REGISTRY.some((s) => s.id === id);
                                    }),
                                    ...(selectedStudent.sub_org_name ? ['subOrg'] : []),
                                ])
                            }
                            enabledModules={{
                                learning: true,
                                finance: true,
                                crm: !!(leadSettings && leadSettings.enabled),
                                account: true,
                                records: true,
                            }}
                        />
                    </div>

                    {/* MAIN CONTENT — warm cream surface so the white cards
                        inside each section get visible elevation. */}
                    <main
                        ref={contentScrollRef}
                        className="min-w-0 flex-1 overflow-y-auto bg-neutral-50"
                    >
                        <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
                            {renderSection(activeSection)}
                        </div>
                    </main>
                </div>
            </DialogContent>
        </Dialog>
    );
};
