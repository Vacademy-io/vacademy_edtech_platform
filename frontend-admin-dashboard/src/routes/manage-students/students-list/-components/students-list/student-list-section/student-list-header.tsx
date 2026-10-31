import { MyButton } from '@/components/design-system/button';
import { EnrollStudentsButton } from '../../../../../../components/common/students/enroll-students-button';
import { useRouter } from '@tanstack/react-router';
import { BulkDialogProvider } from '../../../-providers/bulk-dialog-provider';
import { MyDialog } from '@/components/design-system/dialog';
import { useEffect, useState } from 'react';
import { DropdownItemType } from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { useGetBatchesQuery } from '@/routes/manage-institute/batches/-services/get-batches';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { SmartErrorPage } from '@/components/core/SmartErrorPage';
import { InviteLink } from '@/routes/manage-students/-components/InviteLink';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { NoCourseDialog } from '@/components/common/students/no-course-dialog';
import { cn } from '@/lib/utils';
import { UserPlus, ArrowRight, Users, GraduationCap, Calendar, LinkSimple } from '@phosphor-icons/react';
import { getDisplaySettingsFromCache, DISPLAY_SETTINGS_UPDATED_EVENT } from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import type { StudentHeaderCustomButton } from '@/types/display-settings';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { GET_INVITE_LINKS, GET_DEFAULT_INVITE } from '@/constants/urls';
import createInviteLink from '@/routes/manage-students/invite/-utils/createInviteLink';
import { isCallerSubOrgAdmin } from '@/lib/auth/facultyAccessUtils';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import CreateInvite from '@/routes/manage-students/invite/-components/create-invite/CreateInvite';
import { convertCapitalToTitleCase } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const InviteLinksDialog = ({
    currentSession,
    openInviteLinksDialog,
    handleOpenChange,
}: {
    currentSession?: DropdownItemType;
    openInviteLinksDialog: boolean;
    handleOpenChange: () => void;
}) => {
    const router = useRouter();
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const { t } = useTranslation('manageStudentsListHeader');

    const { data, isLoading, isError } = useGetBatchesQuery({
        sessionId: currentSession?.id || '',
    });

    const footer = (
        <div className="flex w-full items-center justify-between gap-2">
            <MyButton
                buttonType="secondary"
                scale="small"
                onClick={() => router.navigate({ to: '/manage-students/invite' })}
                className="hover:scale-102 flex items-center gap-1.5 text-xs transition-all duration-200"
            >
                <ArrowRight className="size-3.5" />
                {t('inviteLinksDialog.invitePage')}
            </MyButton>
            <CreateInvite />
        </div>
    );

    // Get session details for enhanced dialog title
    const sessionName = currentSession?.name || t('inviteLinksDialog.unknownSession');
    const dialogTitle = t('inviteLinksDialog.dialogTitle', { sessionName });

    return (
        <MyDialog
            heading={dialogTitle}
            open={openInviteLinksDialog}
            onOpenChange={handleOpenChange}
            footer={footer}
            dialogWidth="w-full max-w-3xl"
        >
            {isLoading ? (
                <DashboardLoader />
            ) : isError ? (
                <SmartErrorPage />
            ) : (
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto"> {/* design-lint-ignore: viewport-relative scroll body sized to 60vh, no fixed token matches (max-h-dialog-tall is 88vh, a different intent) */}
                    {currentSession?.id ? (
                        data?.flatMap((batch) =>
                            batch.batches.map((b, index) => {
                                // Get detailed information about this batch
                                const batchDetails = getDetailsFromPackageSessionId({
                                    packageSessionId: b.package_session_id,
                                });

                                const courseName = convertCapitalToTitleCase(
                                    batch.package_dto.package_name
                                );
                                const levelName =
                                    batchDetails?.level.level_name ||
                                    t('inviteLinksDialog.unknownLevel');
                                const sessionName =
                                    batchDetails?.session.session_name || currentSession.name;

                                return (
                                    <div
                                        className="animate-fadeIn group flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-2.5 transition-all duration-200 hover:border-primary-200 hover:shadow-md"
                                        key={index}
                                        style={{ animationDelay: `${index * 0.1}s` }}
                                    >
                                        {/* Enhanced header with course info */}
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1">
                                                <div className="mb-1.5 flex items-center gap-1.5">
                                                    <div className="rounded-md bg-primary-100 p-1 transition-colors duration-200 group-hover:bg-primary-200">
                                                        <Users className="size-3 text-primary-600" />
                                                    </div>
                                                    <h3 className="group-hover:text-primary-700 text-xs font-semibold text-primary-600 transition-colors duration-200">
                                                        {b.batch_name}
                                                    </h3>
                                                </div>

                                                {/* Course, Level, Session info */}
                                                <div className="ml-4 space-y-1 text-xs text-neutral-600">
                                                    <div className="flex items-center gap-1.5">
                                                        <GraduationCap className="size-3 text-neutral-400" />
                                                        <span className="font-medium">
                                                            {t('inviteLinksDialog.courseLabel')}
                                                        </span>
                                                        <span className="text-neutral-700">
                                                            {courseName}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="flex size-3 items-center justify-center rounded bg-blue-100">
                                                            <div className="size-1.5 rounded bg-blue-500"></div>
                                                        </div>
                                                        <span className="font-medium">
                                                            {t('inviteLinksDialog.levelLabel')}
                                                        </span>
                                                        <span className="text-neutral-700">
                                                            {levelName}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <Calendar className="size-3 text-neutral-400" />
                                                        <span className="font-medium">
                                                            {t('inviteLinksDialog.sessionLabel')}
                                                        </span>
                                                        <span className="text-neutral-700">
                                                            {sessionName}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Invite link section */}
                                        <div className="border-t border-neutral-100 pl-4 pt-1.5">
                                            <div className="mb-1 text-xs font-medium text-neutral-600">
                                                {t('inviteLinksDialog.inviteLinkLabel')}
                                            </div>
                                            <InviteLink inviteCode={b.invite_code} />
                                        </div>
                                    </div>
                                );
                            })
                        )
                    ) : (
                        <div className="py-4 text-center">
                            <div className="mx-auto mb-1.5 w-fit rounded-full bg-neutral-100 p-1.5">
                                <Users className="size-3 text-neutral-400" />
                            </div>
                            <p className="text-xs text-neutral-500">
                                {t('inviteLinksDialog.noBatchesFound')}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </MyDialog>
    );
};

import { useCompactMode } from '@/hooks/use-compact-mode';
import { CountBadge } from './count-badge';

export const StudentListHeader = ({
    currentSession,
    titleSize,
    packageSessionId,
    showCounts = true,
    total,
    active,
    inactive,
    invited,
    countsLoading,
}: {
    currentSession?: DropdownItemType;
    titleSize?: string;
    packageSessionId?: string;
    showCounts?: boolean;
    total?: number;
    active?: number;
    inactive?: number;
    invited?: number;
    countsLoading?: boolean;
}) => {
    const { t } = useTranslation('manageStudentsListHeader');
    const [openInviteLinksDialog, setOpenInviteLinksDialog] = useState(false);
    const { instituteDetails } = useInstituteDetailsStore();
    const [isOpen, setIsOpen] = useState(false);
    const { isCompact } = useCompactMode();

    // Re-read display settings live when they're saved from the Settings panel,
    // so hiding a built-in button / adding a custom button reflects here without
    // a page reload (saveDisplaySettings fires this after writing the cache).
    const [, bumpSettings] = useState(0);
    useEffect(() => {
        const onUpdate = () => bumpSettings((v) => v + 1);
        window.addEventListener(DISPLAY_SETTINGS_UPDATED_EVENT, onUpdate);
        return () => window.removeEventListener(DISPLAY_SETTINGS_UPDATED_EVENT, onUpdate);
    }, []);

    // Per-role Display Settings → "Learner Management Buttons": hide the built-in
    // Enroll / Invite buttons and surface custom link buttons (manual URL, the
    // sub-org learner invite link, or the course learner invite link) in this header.
    const actionSettings = getDisplaySettingsFromCache(
        getActiveRoleDisplaySettingsKey()
    )?.studentManagementActions;
    const showEnrollButton = actionSettings?.showEnrollButton !== false;
    const showInviteButton = actionSettings?.showInviteButton !== false;
    const rawButtons = actionSettings?.customButtons ?? [];

    const needsSubOrgInvite = rawButtons.some((b) => b.kind === 'suborg_learner_invite');
    const needsCourseInvite = rawButtons.some((b) => b.kind === 'course_invite');

    // Is the viewer a sub-org admin? Use the faculty-access signal (has any
    // sub-orgs) rather than the localStorage "selected sub-org" — that key is
    // cleared on login and only re-set when a sub-org is explicitly picked, so a
    // legitimately-logged-in sub-org admin often has it null, which wrongly hid
    // the sub-org invite button. False for the parent institute admin, so the
    // button stays hidden there. The get-enroll-invite query below is FSPSSM-
    // scoped to the caller, so it still resolves only THIS admin's own invite.
    const isSubOrgAdmin = isCallerSubOrgAdmin();
    const instituteId = getInstituteId();
    const learnerBase = instituteDetails?.learner_portal_base_url;

    // The sub-org's SUBORG_LEARNER invite for the viewed course. get-enroll-invite
    // is FSPSSM-scoped to the caller, so for a sub-org admin `tags:['SUBORG_LEARNER']`
    // returns only THEIR sub-org's learner invite for this package session — a
    // learner who enrolls through it lands in the sub-org admin's learner list.
    const { data: subOrgInviteCode } = useQuery({
        queryKey: ['suborg-learner-invite-code', packageSessionId, instituteId],
        queryFn: async (): Promise<string | null> => {
            const res = await authenticatedAxiosInstance.post(
                `${GET_INVITE_LINKS}?instituteId=${instituteId}&pageNo=0&pageSize=20`,
                {
                    search_name: '',
                    package_session_ids: [packageSessionId],
                    payment_option_ids: [],
                    sort_columns: {},
                    tags: ['SUBORG_LEARNER'],
                }
            );
            const row = (res.data?.content ?? [])[0] as
                | { invite_code?: string; inviteCode?: string }
                | undefined;
            return row?.invite_code ?? row?.inviteCode ?? null;
        },
        enabled: needsSubOrgInvite && !!packageSessionId && isSubOrgAdmin && !!instituteId,
        staleTime: 5 * 60 * 1000,
    });

    // The course's DEFAULT learner invite for the viewed package session.
    const { data: courseInviteCode } = useQuery({
        queryKey: ['course-default-invite-code', packageSessionId, instituteId],
        queryFn: async (): Promise<string | null> => {
            const res = await authenticatedAxiosInstance.get(
                GET_DEFAULT_INVITE(instituteId ?? '', packageSessionId ?? '')
            );
            const d = (res.data ?? {}) as { invite_code?: string; inviteCode?: string };
            return d.invite_code ?? d.inviteCode ?? null;
        },
        enabled: needsCourseInvite && !!packageSessionId && !!instituteId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });

    // Resolve each configured button to a concrete href; drop the ones that can't
    // resolve in this context (missing label/URL, or an auto invite that has no
    // sub-org / package session / matching invite here).
    const resolveHref = (button: StudentHeaderCustomButton): string | null => {
        const kind = button.kind ?? 'url';
        if (kind === 'url') return button.url?.trim() || null;
        if (kind === 'suborg_learner_invite') {
            if (!isSubOrgAdmin || !packageSessionId || !subOrgInviteCode) return null;
            return createInviteLink(subOrgInviteCode, learnerBase);
        }
        if (kind === 'course_invite') {
            if (!packageSessionId || !courseInviteCode) return null;
            return createInviteLink(courseInviteCode, learnerBase);
        }
        return null;
    };

    type ResolvedButton = { id: string; label: string; href: string; openInNewTab?: boolean };
    const resolvedButtons: ResolvedButton[] = rawButtons
        .map((button): ResolvedButton | null => {
            const label = button.label?.trim();
            const href = resolveHref(button);
            if (!label || !href) return null;
            return { id: button.id, label, href, openInNewTab: button.openInNewTab };
        })
        .filter((b): b is ResolvedButton => b !== null);

    const openCustomLink = (href: string, openInNewTab?: boolean) => {
        if (openInNewTab === false) {
            window.location.href = href;
        } else {
            window.open(href, '_blank', 'noopener,noreferrer');
        }
    };

    const handleOpenChange = () => {
        setOpenInviteLinksDialog(!openInviteLinksDialog);
    };

    return (
        <div className={cn(
            "animate-slideInRight flex flex-col justify-between gap-2 lg:flex-row lg:items-center",
            isCompact ? "mb-1" : "mb-2"
        )}>
            {/* Compact professional title */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className={cn(
                    "rounded-md bg-gradient-to-br from-primary-100 to-primary-200 shadow-sm",
                    isCompact ? "p-0.5" : "p-1"
                )}>
                    <Users className={cn("text-primary-500", isCompact ? "size-3" : "size-3.5")} />
                </div>
                <h1
                    className={cn(
                        'font-semibold text-neutral-700',
                        titleSize ? titleSize : (isCompact ? 'text-sm lg:text-base' : 'text-base lg:text-lg')
                    )}
                >
                    {t('header.title', {
                        term: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
                    })}
                </h1>
                {showCounts &&
                    (countsLoading ? (
                        <span className="h-4 w-28 animate-pulse rounded-full bg-neutral-100" />
                    ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <CountBadge
                                label={t('header.counts.total')}
                                value={total ?? 0}
                                tone="total"
                                isCompact={isCompact}
                            />
                            <CountBadge
                                label={t('header.counts.active')}
                                value={active ?? 0}
                                tone="active"
                                isCompact={isCompact}
                            />
                            <CountBadge
                                label={t('header.counts.inactive')}
                                value={inactive ?? 0}
                                tone="inactive"
                                isCompact={isCompact}
                            />
                            {invited !== undefined && (
                                <CountBadge
                                    label={t('header.counts.invited', { defaultValue: 'Invited' })}
                                    value={invited}
                                    tone="invited"
                                    isCompact={isCompact}
                                />
                            )}
                        </div>
                    ))}
            </div>

            {/* Compact professional action buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
                {resolvedButtons.map((button) => (
                    <button
                        key={button.id}
                        type="button"
                        onClick={() => openCustomLink(button.href, button.openInNewTab)}
                        title={button.label}
                        className={cn(
                            "hover:bg-primary-600 group inline-flex items-center gap-2 rounded-lg bg-primary-500 font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
                            isCompact ? "px-3 py-2 text-sm" : "px-5 py-2.5 text-sm"
                        )}
                    >
                        <LinkSimple
                            weight="bold"
                            className={cn("shrink-0", isCompact ? "size-4" : "size-5")}
                        />
                        <span>{button.label}</span>
                    </button>
                ))}

                {showInviteButton && (
                    <MyButton
                        onClick={() => setOpenInviteLinksDialog(true)}
                        scale="small"
                        buttonType="secondary"
                        className={cn(
                            "group flex items-center gap-1 border border-blue-200 bg-white text-blue-700 transition-all duration-200 hover:scale-100 hover:border-blue-300 hover:bg-blue-50",
                            isCompact ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs"
                        )}
                    >
                        <UserPlus className={cn("transition-transform duration-200 group-hover:scale-110", isCompact ? "size-2.5" : "size-3")} />
                        <span className="hidden sm:inline">{t('header.actions.invite')}</span>
                    </MyButton>
                )}

                {showEnrollButton && (
                <BulkDialogProvider>
                    {!instituteDetails?.batches_for_sessions.length ? (
                        <NoCourseDialog
                            isOpen={isOpen}
                            setIsOpen={setIsOpen}
                            type={t('header.actions.enrollType', {
                                term: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
                            })}
                            content={t('header.actions.noCourseContent')}
                            trigger={
                                <MyButton
                                    scale="small"
                                    className={cn(
                                        "hover:scale-102 hover:bg-primary-700 group flex items-center gap-1 border-0 bg-primary-600 text-white shadow-sm transition-all duration-200 hover:shadow-md",
                                        isCompact ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs"
                                    )}
                                >
                                    <Users className={cn("transition-transform duration-200 group-hover:scale-110", isCompact ? "size-2.5" : "size-3")} />
                                    <span className="hidden sm:inline">{t('header.actions.enroll')}</span>
                                </MyButton>
                            }
                        />
                    ) : (
                        <EnrollStudentsButton initialPackageSessionId={packageSessionId} />
                    )}
                </BulkDialogProvider>
                )}
            </div>

            <InviteLinksDialog
                currentSession={currentSession}
                openInviteLinksDialog={openInviteLinksDialog}
                handleOpenChange={handleOpenChange}
            />
        </div>
    );
};
