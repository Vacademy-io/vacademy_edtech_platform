import { useEffect, useMemo, useState } from 'react';
import {
    Check,
    ChatCenteredDots,
    Clock,
    HourglassMedium,
    Info,
    MagnifyingGlass,
    TrayArrowDown,
    UsersThree,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { ColumnDef } from '@tanstack/react-table';
import { StatStrip } from '@/components/shared/crm-enhance';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { cn } from '@/lib/utils';
import { relativeDay, timeOfDay } from '../-utils/format-session-time';
import { useDecideMentorRequest, useMentorRequests, useMentors } from '../-hooks/use-mentorship';
import { MentorshipPageHeader } from './MentorshipPageHeader';
import type { MentorDTO, MentorRequestDTO } from '../-types/mentorship-types';
import { MentorAvatar } from './MentorAvatar';
import { reportApiError } from '@/lib/report-api-error';

const PAGE_SIZE = 20;

const buildTabs = (t: TFunction) =>
    [
        { key: 'PENDING' as const, label: t('tabPending') },
        { key: 'APPROVED' as const, label: t('tabApproved') },
        { key: 'DECLINED' as const, label: t('tabDeclined') },
        { key: 'CANCELLED' as const, label: t('tabWithdrawn') },
    ];

function fmtDate(v?: number | null, locale?: string): string {
    if (!v) return '';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale);
}

/** Whole days since a timestamp, for "waiting 3d" on a pending request. */
function daysSince(v?: number | null): number {
    if (!v) return 0;
    return Math.max(0, Math.floor((Date.now() - v) / 86_400_000));
}

function initials(name?: string | null): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return (
        (parts[0]?.[0] ?? '').concat(parts.length > 1 ? parts[1]?.[0] ?? '' : '').toUpperCase() ||
        '?'
    );
}

/**
 * The admin review queue for learner-raised mentor requests. Approving pairs the
 * learner with a mentor (creating the same assignment an admin-made pairing would);
 * declining sends the learner a note back.
 *
 * Split out of the route so it can be rendered — and tested — without a router.
 */
export function MentorRequestsPanel({ instituteId }: { instituteId: string | undefined }) {
    const { t, i18n } = useTranslation('mentorshipMentorRequestsPanel');
    const { t: tFormat } = useTranslation('mentorshipFormatSessionTimeUtils');
    const TABS = useMemo(() => buildTabs(t), [t]);
    const [status, setStatus] = useState<string>('PENDING');
    const [page, setPage] = useState(0);
    const [decide, setDecide] = useState<{ request: MentorRequestDTO; approve: boolean } | null>(
        null
    );

    const [search, setSearch] = useState('');

    const { data, isLoading, isError, refetch } = useMentorRequests(
        instituteId,
        status,
        page,
        PAGE_SIZE
    );
    const allRequests = useMemo(() => data?.content ?? [], [data?.content]);

    // Search narrows the loaded page. The requests endpoint takes no query, and the
    // count line below always says which of the two numbers is which, so a match on
    // another page is never silently presented as "no results".
    const query = search.trim().toLowerCase();
    const requests = useMemo(
        () =>
            query
                ? allRequests.filter((r) =>
                      [r.student_name, r.student_email, r.mentor_name, r.message].some((f) =>
                          (f ?? '').toLowerCase().includes(query)
                      )
                  )
                : allRequests,
        [allRequests, query]
    );

    const switchTab = (next: string) => {
        setStatus(next);
        setPage(0);
        setSearch('');
    };

    const columns = useMemo<ColumnDef<MentorRequestDTO>[]>(
        () => [
            {
                id: 'learner',
                header: t('columnLearner'),
                size: 230,
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-caption font-semibold text-primary-600">
                                {initials(r.student_name)}
                            </span>
                            <div className="flex min-w-0 flex-col">
                                <span className="truncate text-body font-medium text-neutral-700">
                                    {r.student_name || r.student_user_id}
                                </span>
                                {r.student_email && (
                                    <span className="truncate text-caption text-neutral-400">
                                        {r.student_email}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                },
            },
            {
                id: 'mentor',
                header: t('columnRequestedMentor'),
                size: 200,
                cell: ({ row }) => {
                    const r = row.original;
                    if (!r.mentor_id) {
                        return (
                            <span className="flex w-fit items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-caption text-neutral-600">
                                <UsersThree size={13} /> {t('anyAvailableMentor')}
                            </span>
                        );
                    }
                    return (
                        <div className="flex min-w-0 items-center gap-2">
                            <MentorAvatar
                                fileId={r.mentor_profile_image_file_id}
                                name={r.mentor_name}
                                className="size-7 shrink-0 text-caption"
                            />
                            <div className="flex min-w-0 flex-col">
                                <span className="truncate text-body text-neutral-700">
                                    {r.mentor_name || t('aMentorFallback')}
                                </span>
                                {typeof r.mentor_available_slots === 'number' && (
                                    <span
                                        className={`text-caption ${
                                            r.mentor_available_slots === 0
                                                ? 'text-danger-600'
                                                : 'text-neutral-400'
                                        }`}
                                    >
                                        {r.mentor_available_slots === 0
                                            ? t('atTheirLimit')
                                            : t('placesLeft', {
                                                  count: r.mentor_available_slots,
                                              })}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                },
            },
            {
                id: 'message',
                header: t('columnMessage'),
                size: 240,
                cell: ({ row }) => {
                    const r = row.original;
                    const note = r.status !== 'PENDING' ? r.decision_note : null;
                    if (!r.message && !note) {
                        return <span className="text-caption text-neutral-300">—</span>;
                    }
                    return (
                        <div className="flex min-w-0 flex-col gap-1">
                            {r.message && (
                                <span
                                    className="line-clamp-2 flex items-start gap-1.5 text-caption text-neutral-600"
                                    title={r.message}
                                >
                                    <ChatCenteredDots
                                        size={13}
                                        className="mt-0.5 shrink-0 text-neutral-400"
                                    />
                                    {r.message}
                                </span>
                            )}
                            {note && (
                                <span
                                    className="line-clamp-2 text-caption text-neutral-400"
                                    title={note}
                                >
                                    {t('decisionNoteLabel', { note })}
                                </span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'requested',
                header: t('columnRequested'),
                size: 160,
                cell: ({ row }) => {
                    const r = row.original;
                    const waiting = r.status === 'PENDING' ? daysSince(r.created_at) : 0;
                    return (
                        <span
                            className="flex flex-col"
                            title={fmtDate(r.created_at, i18n.language)}
                        >
                            <span className="flex items-center gap-1 text-caption text-neutral-600">
                                <Clock size={12} />{' '}
                                {relativeDay(r.created_at, tFormat, i18n.language)}
                            </span>
                            <span className="text-caption text-neutral-400">
                                {timeOfDay(r.created_at, i18n.language)}
                                {waiting >= 2 && (
                                    <b className="font-semibold text-danger-600">
                                        {' · '}
                                        {t('waitingDays', { count: waiting })}
                                    </b>
                                )}
                            </span>
                        </span>
                    );
                },
            },
            {
                id: 'actions',
                header: t('columnDecision'),
                size: 190,
                cell: ({ row }) => {
                    const r = row.original;
                    if (r.status !== 'PENDING') {
                        return <StatusBadge status={r.status} decidedAt={r.decided_at} />;
                    }
                    return (
                        <div className="flex items-center gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setDecide({ request: r, approve: false })}
                                title={t('declineButtonTitle')}
                            >
                                <X size={16} /> {t('declineButton')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="small"
                                onClick={() => setDecide({ request: r, approve: true })}
                                title={t('approveButtonTitle')}
                            >
                                <Check size={16} /> {t('approveButton')}
                            </MyButton>
                        </div>
                    );
                },
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, i18n.language]
    );

    // Pending-queue figures, from the page already loaded (the endpoint has no
    // summary call). The total is the server's; the rest describe this page.
    const oldest = allRequests.reduce<number | null>(
        (min, r) => (r.created_at && (min == null || r.created_at < min) ? r.created_at : min),
        null
    );
    const oldestDays = daysSince(oldest);
    const oldestHours = oldest ? Math.max(0, Math.floor((Date.now() - oldest) / 3_600_000)) : 0;
    const openEnded = allRequests.filter((r) => !r.mentor_id).length;
    const learnerTerm = instituteTerms().learner.toLowerCase();

    return (
        <div className="flex flex-col gap-6 p-6">
            <MentorshipPageHeader
                title={t('pageTitle')}
                subtitle={t('pageSubtitle')}
                icon={TrayArrowDown}
            />

            {status === 'PENDING' && !isLoading && !isError && allRequests.length > 0 && (
                <StatStrip
                    items={[
                        {
                            key: 'waiting',
                            icon: TrayArrowDown,
                            tint: 'warning',
                            label: t('kpiWaitingLabel'),
                            value: data?.total_elements ?? allRequests.length,
                            detail: t('kpiWaitingDetail', { count: openEnded }),
                        },
                        {
                            key: 'oldest',
                            icon: HourglassMedium,
                            tint: oldestDays >= 2 ? 'danger' : 'info',
                            label: t('kpiOldestLabel'),
                            value:
                                oldestDays >= 1
                                    ? t('kpiOldestDays', { count: oldestDays })
                                    : t('kpiOldestHours', { count: oldestHours }),
                            detail: t('kpiOldestDetail'),
                        },
                        {
                            key: 'openEnded',
                            icon: UsersThree,
                            tint: 'primary',
                            label: t('kpiAnyMentorLabel'),
                            value: openEnded,
                            detail: t('kpiAnyMentorDetail'),
                        },
                    ]}
                />
            )}

            <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap gap-2 border-b border-neutral-200">
                    {TABS.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => switchTab(tab.key)}
                            className={`-mb-px border-b-2 px-3 py-2 text-body transition-colors ${
                                status === tab.key
                                    ? 'border-primary-500 font-medium text-primary-600'
                                    : 'border-transparent text-neutral-500 hover:text-neutral-700'
                            }`}
                        >
                            {tab.label}
                            {tab.key === status && (data?.total_elements ?? 0) > 0 && (
                                <span
                                    className={cn(
                                        'ml-1.5 rounded-full px-1.5 py-0.5 text-caption',
                                        tab.key === 'PENDING'
                                            ? 'bg-warning-50 text-warning-700'
                                            : 'bg-neutral-100 text-neutral-500'
                                    )}
                                >
                                    {data?.total_elements}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="relative w-full sm:w-80">
                        <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                        />
                        <MyInput
                            input={search}
                            onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                setSearch(e.target.value)
                            }
                            inputType="text"
                            inputPlaceholder={t('searchPlaceholder')}
                            className="pl-9 sm:w-full"
                        />
                    </div>
                    {query && (
                        <span className="text-caption text-neutral-500">
                            {t('pageMatchCount', {
                                visible: requests.length,
                                count: allRequests.length,
                            })}
                            {' · '}
                            <button
                                type="button"
                                className="font-medium text-primary-500 hover:text-primary-600"
                                onClick={() => setSearch('')}
                            >
                                {t('clearButton')}
                            </button>
                        </span>
                    )}
                </div>

                {isLoading ? (
                    <div className="flex flex-col gap-3">
                        {[1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4"
                            >
                                <div className="flex items-center gap-3">
                                    <Skeleton className="size-10 rounded-full" />
                                    <div className="flex flex-col gap-1.5">
                                        <Skeleton className="h-3.5 w-40" />
                                        <Skeleton className="h-3 w-56" />
                                    </div>
                                </div>
                                <Skeleton className="h-8 w-40" />
                            </div>
                        ))}
                    </div>
                ) : isError ? (
                    <div className="flex flex-col items-start gap-3 rounded-lg border border-danger-100 bg-danger-50 p-4">
                        <div className="flex items-center gap-2">
                            <WarningCircle size={18} weight="fill" className="text-danger-600" />
                            <p className="text-body text-danger-600">{t('errorLoadRequests')}</p>
                        </div>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => refetch()}
                        >
                            {t('retryButton')}
                        </MyButton>
                    </div>
                ) : allRequests.length === 0 ? (
                    <EmptyRequests status={status} />
                ) : requests.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
                        <MagnifyingGlass size={32} className="text-neutral-300" />
                        <p className="text-body font-medium text-neutral-700">
                            {t('noRequestsMatchSearch', { search: search.trim() })}
                        </p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setSearch('')}
                        >
                            {t('clearSearchButton')}
                        </MyButton>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                            <MyTable<MentorRequestDTO>
                                data={{
                                    content: requests,
                                    total_pages: data?.total_pages ?? 1,
                                    page_no: page,
                                    page_size: PAGE_SIZE,
                                    total_elements: data?.total_elements ?? requests.length,
                                    last: data?.last ?? true,
                                }}
                                columns={columns}
                                isLoading={false}
                                error={null}
                                currentPage={page}
                                scrollable
                            />
                        </div>
                        {!query && (data?.total_pages ?? 0) > 1 && (
                            <MyPagination
                                currentPage={page}
                                totalPages={data?.total_pages ?? 1}
                                onPageChange={setPage}
                            />
                        )}
                    </div>
                )}
            </div>

            <p className="flex items-start gap-2 rounded-lg border border-info-100 bg-info-50 px-3 py-2 text-caption text-neutral-600">
                <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                {t('queueNote', { learner: learnerTerm })}
            </p>

            <DecisionDialog
                instituteId={instituteId}
                decision={decide}
                onOpenChange={(open) => {
                    if (!open) setDecide(null);
                }}
            />
        </div>
    );
}

function StatusBadge({ status, decidedAt }: { status: string; decidedAt?: number | null }) {
    const { t, i18n } = useTranslation('mentorshipMentorRequestsPanel');
    const tone =
        status === 'APPROVED'
            ? 'bg-success-50 text-success-600'
            : status === 'DECLINED'
              ? 'bg-danger-50 text-danger-600'
              : 'bg-neutral-100 text-neutral-500';
    const label =
        status === 'APPROVED'
            ? t('statusApproved')
            : status === 'DECLINED'
              ? t('statusDeclined')
              : t('statusWithdrawn');
    return (
        <span className="flex flex-col items-end gap-1">
            <span className={`rounded-full px-2.5 py-1 text-caption ${tone}`}>{label}</span>
            {decidedAt && (
                <span className="text-caption text-neutral-400">
                    {fmtDate(decidedAt, i18n.language)}
                </span>
            )}
        </span>
    );
}

function EmptyRequests({ status }: { status: string }) {
    const { t } = useTranslation('mentorshipMentorRequestsPanel');
    const copy =
        status === 'PENDING'
            ? {
                  title: t('emptyPendingTitle'),
                  body: t('emptyPendingBody'),
              }
            : {
                  title: t('emptyOtherTitle'),
                  body: t('emptyOtherBody'),
              };
    return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
            <TrayArrowDown size={40} className="text-neutral-300" />
            <div className="flex flex-col gap-1">
                <p className="text-body font-medium text-neutral-700">{copy.title}</p>
                <p className="max-w-md text-caption text-neutral-500">{copy.body}</p>
            </div>
        </div>
    );
}

/**
 * Confirms a decision. Approving an open-ended ("any mentor") request needs a
 * mentor picked here — the server refuses one without it — and full mentors are
 * shown as unpickable rather than failing after the click.
 */
function DecisionDialog({
    instituteId,
    decision,
    onOpenChange,
}: {
    instituteId: string | undefined;
    decision: { request: MentorRequestDTO; approve: boolean } | null;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('mentorshipMentorRequestsPanel');
    const decide = useDecideMentorRequest();
    const mentorsQuery = useMentors(decision?.approve ? instituteId : undefined);
    const [note, setNote] = useState('');
    const [mentorId, setMentorId] = useState('');
    const [mentorSearch, setMentorSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const request = decision?.request;
    const approve = decision?.approve ?? false;
    // An open-ended request has no mentor on it, so the admin must choose one.
    const needsMentorPick = approve && !request?.mentor_id;

    useEffect(() => {
        setNote('');
        setMentorId('');
        setMentorSearch('');
    }, [decision]);

    const q = mentorSearch.trim().toLowerCase();
    const mentors = (mentorsQuery.data ?? []).filter(
        (m) =>
            !q ||
            [m.display_name, m.name, m.title, ...(m.expertise_tags ?? [])].some((f) =>
                (f ?? '').toLowerCase().includes(q)
            )
    );

    const submit = async () => {
        if (!request || !instituteId) return;
        if (needsMentorPick && !mentorId) {
            toast.error(t('toastPickMentorFirst'));
            return;
        }
        setSubmitting(true);
        try {
            await decide.mutateAsync({
                id: request.id,
                instituteId,
                approve,
                decision: {
                    mentor_id: mentorId || undefined,
                    note: note.trim() || undefined,
                },
            });
            toast.success(approve ? t('toastRequestApproved') : t('toastRequestDeclined'));
            onOpenChange(false);
        } catch (error) {
            // The server rejects capacity overflows and already-decided requests with a
            // readable reason; surfacing it beats a generic failure toast. Those are
            // expected 4xx, so they breadcrumb rather than burn Sentry quota.
            reportApiError(error, {
                feature: 'mentorship',
                tags: {
                    'mentorship.action': approve ? 'approve-request' : 'decline-request',
                },
                extra: { requestId: request.id, mentorId: mentorId || request.mentor_id },
                fallbackMessage: approve
                    ? t('errorApproveRequest')
                    : t('errorDeclineRequest'),
            });
        } finally {
            setSubmitting(false);
        }
    };

    if (!request) return null;

    return (
        <MyDialog
            heading={approve ? t('approveDialogHeading') : t('declineDialogHeading')}
            open={!!decision}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancelButton')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={submit}
                        disable={submitting || (needsMentorPick && !mentorId)}
                    >
                        {submitting
                            ? approve
                                ? t('approvingEllipsis')
                                : t('decliningEllipsis')
                            : approve
                              ? t('approveAndAssignButton')
                              : t('declineRequestButton')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-600">
                    {approve ? (
                        <>
                            <b>{request.student_name || t('thisLearnerFallback')}</b>{' '}
                            {t('approveBodyPairedWith')}{' '}
                            {request.mentor_id ? (
                                <b>{request.mentor_name || t('requestedMentorFallback')}</b>
                            ) : (
                                t('mentorYouPick')
                            )}
                            {t('approveBodySuffix')}
                        </>
                    ) : (
                        <>
                            <b>{request.student_name || t('thisLearnerFallback')}</b>{' '}
                            {t('declineBody')}
                        </>
                    )}
                </p>

                {needsMentorPick && (
                    <div className="flex flex-col gap-2">
                        <span className="text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('chooseMentorLabel')}
                        </span>
                        <div className="relative">
                            <MagnifyingGlass
                                size={16}
                                className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                            />
                            <MyInput
                                input={mentorSearch}
                                onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setMentorSearch(e.target.value)
                                }
                                inputType="text"
                                inputPlaceholder={t('mentorSearchPlaceholder')}
                                className="pl-9 sm:w-full"
                            />
                        </div>
                        <div className="max-h-56 overflow-y-auto rounded-md border border-neutral-200">
                            {mentorsQuery.isLoading ? (
                                <div className="p-4 text-body text-neutral-400">
                                    {t('loadingMentors')}
                                </div>
                            ) : mentors.length === 0 ? (
                                <div className="p-4 text-body text-neutral-400">
                                    {t('noMentorsMatch')}
                                </div>
                            ) : (
                                mentors.map((m) => (
                                    <MentorOption
                                        key={m.id}
                                        mentor={m}
                                        selected={mentorId === m.id}
                                        onSelect={() => setMentorId(m.id)}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                )}

                <MyInput
                    input={note}
                    onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setNote(e.target.value)
                    }
                    inputType="text"
                    inputPlaceholder={
                        approve ? t('noteApprovePlaceholder') : t('noteDeclinePlaceholder')
                    }
                    label={approve ? t('noteApproveLabel') : t('noteDeclineLabel')}
                    className="sm:w-full"
                />
            </div>
        </MyDialog>
    );
}

function MentorOption({
    mentor,
    selected,
    onSelect,
}: {
    mentor: MentorDTO;
    selected: boolean;
    onSelect: () => void;
}) {
    const { t } = useTranslation('mentorshipMentorRequestsPanel');
    const full = !!mentor.at_capacity;
    return (
        <button
            type="button"
            disabled={full}
            onClick={onSelect}
            title={full ? t('mentorAtCapacityTitle') : undefined}
            className={`flex w-full items-center justify-between gap-3 border-b border-neutral-100 px-3 py-2 text-left last:border-b-0 ${
                full
                    ? 'cursor-not-allowed opacity-50'
                    : selected
                      ? 'bg-primary-50'
                      : 'hover:bg-neutral-50'
            }`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <MentorAvatar
                    fileId={mentor.profile_image_file_id}
                    name={mentor.display_name || mentor.name}
                    className="size-7 text-caption"
                />
                <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body text-neutral-700">
                        {mentor.display_name || mentor.name || t('mentorFallback')}
                    </span>
                    <span className="truncate text-caption text-neutral-400">
                        {(mentor.expertise_tags ?? []).slice(0, 3).join(' · ') ||
                            mentor.title ||
                            ''}
                    </span>
                </span>
            </span>
            <span className="shrink-0 text-caption text-neutral-500">
                {full
                    ? t('fullLabel')
                    : mentor.max_mentees
                      ? `${mentor.assigned_student_count ?? 0}/${mentor.max_mentees}`
                      : t('studentsCount', { count: mentor.assigned_student_count ?? 0 })}
            </span>
        </button>
    );
}
