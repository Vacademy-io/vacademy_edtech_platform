import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowClockwise, CheckCircle, Clock, XCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { ChipToggleGroup, type ChipToggleOption } from '@/components/design-system/chips';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import {
    getPendingReattemptRequestCount,
    getReattemptRequests,
    reviewReattemptRequest,
    type ReattemptRequest,
    type ReattemptRequestStatus,
    type ReattemptRequestType,
} from '@/services/reattempt-requests';
import { Route } from '..';

type StatusFilter = ReattemptRequestStatus | 'ALL';
type TypeFilter = ReattemptRequestType | 'ALL';

/** Same bound the server enforces on one time grant. */
const MAX_EXTRA_MINUTES = 300;
const DEFAULT_EXTRA_MINUTES = '10';

/**
 * While this tab is open, check the pending count this often (one COUNT query) and reload the
 * list only when it changes. Learners raise requests mid-exam, and a report about a broken
 * question is only useful if the admin sees it while the exam is on; reloading the full list on
 * a timer would repeat its per-row lookups for nothing.
 */
const PENDING_COUNT_REFRESH_MS = 30_000;

const buildStatusFilters = (t: TFunction): ChipToggleOption<StatusFilter>[] => [
    { label: t('filters.pending'), value: 'PENDING' },
    { label: t('filters.approved'), value: 'APPROVED' },
    { label: t('filters.resolved'), value: 'RESOLVED' },
    { label: t('filters.rejected'), value: 'REJECTED' },
    { label: t('filters.all'), value: 'ALL' },
];

const buildTypeFilters = (t: TFunction): ChipToggleOption<TypeFilter>[] => [
    { label: t('typeFilters.all'), value: 'ALL' },
    { label: t('typeFilters.problemReport'), value: 'PROBLEM_REPORT' },
    { label: t('typeFilters.timeIncrease'), value: 'TIME_INCREASE' },
    { label: t('typeFilters.reattempt'), value: 'REATTEMPT' },
];

/**
 * A small state badge. StatusChips is the canonical chip but its `status` union covers
 * activity/payment states only — PENDING/APPROVED/REJECTED would have to be cast through it,
 * which would silently break the moment that union changes.
 */
const Badge = ({ tone, children }: { tone: 'neutral' | 'success' | 'danger' | 'warning'; children: string }) => (
    <span
        className={cn(
            'whitespace-nowrap rounded-full px-2.5 py-1 text-caption font-semibold',
            tone === 'success' && 'bg-success-50 text-success-600',
            tone === 'danger' && 'bg-danger-50 text-danger-600',
            tone === 'warning' && 'bg-warning-50 text-warning-600',
            tone === 'neutral' && 'bg-primary-50 text-primary-500'
        )}
    >
        {children}
    </span>
);

const statusChip = (status: ReattemptRequestStatus) => {
    if (status === 'APPROVED')
        return (
            <Badge tone="success">
                {i18next.t('assessmentReattemptRequestsTab:status.approved')}
            </Badge>
        );
    if (status === 'RESOLVED')
        return (
            <Badge tone="success">
                {i18next.t('assessmentReattemptRequestsTab:status.resolved')}
            </Badge>
        );
    if (status === 'REJECTED')
        return (
            <Badge tone="danger">
                {i18next.t('assessmentReattemptRequestsTab:status.rejected')}
            </Badge>
        );
    return (
        <Badge tone="warning">{i18next.t('assessmentReattemptRequestsTab:status.pending')}</Badge>
    );
};

const typeLabel = (type: ReattemptRequestType, t: TFunction) => {
    if (type === 'PROBLEM_REPORT') return t('requestType.problemReport');
    if (type === 'TIME_INCREASE') return t('requestType.timeIncrease');
    return t('requestType.reattempt');
};

const parseWhole = (value: string) => Number.parseInt(value, 10);

/**
 * The question a learner reported: where it sits in the paper and how it starts. The number
 * is the paper order (what the Questions tab shows); a learner on a shuffled paper may have
 * seen another number, which is why the text is shown too.
 */
const ReportedQuestion = ({ request }: { request: ReattemptRequest }) => {
    const { t } = useTranslation('assessmentReattemptRequestsTab');

    if (!request.question_id) {
        return <p className="text-caption text-neutral-500">{t('question.notLinked')}</p>;
    }

    const heading =
        request.question_number != null
            ? request.question_section_name
                ? t('question.labelInSection', {
                      section: request.question_section_name,
                      number: request.question_number,
                  })
                : t('question.label', { number: request.question_number })
            : t('question.notInPaper');

    return (
        <div className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3">
            <p className="text-caption font-semibold text-neutral-700">{heading}</p>
            <p className="line-clamp-3 text-body text-neutral-600">
                {request.question_text ?? t('question.noText')}
            </p>
        </div>
    );
};

/**
 * One learner's request, with the decision inline.
 *
 * The count sits on the row rather than behind a confirm dialog because the decision an admin
 * is actually making is "how many tries does this person get" — asking that in a second step
 * is what made the old flow a one-attempt-at-a-time affair. Time requests ask "how many
 * minutes" the same way, and a problem report takes an optional reply.
 */
const RequestRow = ({
    request,
    instituteId,
    onReviewed,
}: {
    request: ReattemptRequest;
    instituteId: string;
    onReviewed: () => void;
}) => {
    const { t, i18n } = useTranslation('assessmentReattemptRequestsTab');
    const [grantedCount, setGrantedCount] = useState('1');
    const [extraMinutes, setExtraMinutes] = useState(DEFAULT_EXTRA_MINUTES);
    const [reply, setReply] = useState('');

    const isReattempt = request.request_type === 'REATTEMPT';
    const isTime = request.request_type === 'TIME_INCREASE';
    const isReport = request.request_type === 'PROBLEM_REPORT';

    const parsedCount = parseWhole(grantedCount);
    const isCountValid = Number.isFinite(parsedCount) && parsedCount >= 1 && parsedCount <= 20;
    const parsedMinutes = parseWhole(extraMinutes);
    const isMinutesValid =
        Number.isFinite(parsedMinutes) && parsedMinutes >= 1 && parsedMinutes <= MAX_EXTRA_MINUTES;
    const canApprove = (!isReattempt || isCountValid) && (!isTime || isMinutesValid);
    const learnerName = request.participant_name ?? t('toasts.theLearner');

    const reviewMutation = useMutation({
        mutationFn: (status: 'APPROVED' | 'REJECTED' | 'RESOLVED') =>
            reviewReattemptRequest({
                requestId: request.id,
                instituteId,
                status,
                grantedCount: status === 'APPROVED' && isReattempt ? parsedCount : undefined,
                grantedMinutes: status === 'APPROVED' && isTime ? parsedMinutes : undefined,
                reviewNote: status === 'RESOLVED' && reply.trim() ? reply.trim() : undefined,
            }),
        onSuccess: (data, status) => {
            if (status === 'APPROVED' && isTime && data?.granted_minutes == null) {
                // Approved, but the test had already ended (or has no time limit): say so, so
                // nobody believes the learner got extra time.
                toast.warning(t('toasts.timeNotAdded', { name: learnerName }), { duration: 7000 });
                onReviewed();
                return;
            }
            let message = t('toasts.rejected');
            if (status === 'RESOLVED') message = t('toasts.resolved');
            else if (status === 'APPROVED' && isTime)
                message = t('toasts.timeGranted', {
                    count: data?.granted_minutes ?? parsedMinutes,
                    name: learnerName,
                });
            else if (status === 'APPROVED')
                message = t('toasts.granted', { count: parsedCount, name: learnerName });
            toast.success(message, { className: 'success-toast', duration: 4000 });
            onReviewed();
        },
        onError: (error: unknown) => {
            const message =
                (error as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message ?? t('toasts.updateFailed');
            toast.error(message, { className: 'error-toast', duration: 5000 });
        },
    });

    const isPending = request.status === 'PENDING';
    const requestedOn = request.created_at
        ? t('summary.requested', {
              date: new Date(request.created_at).toLocaleString(i18n.language),
          })
        : null;
    const reviewedOn = request.reviewed_at
        ? ` ${t('summary.reviewedOn', {
              date: new Date(request.reviewed_at).toLocaleString(i18n.language),
          })}`
        : '';

    const outcome = () => {
        if (request.status === 'RESOLVED') return t('summary.resolved');
        if (request.status === 'REJECTED') return t('status.rejected');
        if (isTime)
            return request.granted_minutes != null
                ? t('summary.grantedMinutes', { count: request.granted_minutes })
                : t('summary.approvedNoTime');
        return t('summary.grantedCount', { count: request.granted_count ?? 1 });
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-subtitle font-semibold text-neutral-700">
                        {request.participant_name ?? request.user_id}
                    </p>
                    <p className="text-caption text-neutral-500">
                        {request.user_email ?? '—'}
                        {request.phone_number ? ` · ${request.phone_number}` : ''}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge tone="neutral">{typeLabel(request.request_type, t)}</Badge>
                    {statusChip(request.status)}
                </div>
            </div>

            {isReport && <ReportedQuestion request={request} />}

            {request.reason && (
                <p className="rounded-md bg-neutral-50 p-3 text-body italic text-neutral-600">
                    &ldquo;{request.reason}&rdquo;
                </p>
            )}

            <p className="text-caption text-neutral-500">
                {isReattempt && (
                    <>
                        {t('summary.currentlyAllowed', { value: request.attempts_allowed ?? '—' })}
                        {' · '}
                        {t('summary.used', { value: request.attempts_used ?? '—' })}
                        {requestedOn ? ' · ' : ''}
                    </>
                )}
                {requestedOn}
            </p>

            {isPending ? (
                <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-end gap-3">
                        {isReattempt && (
                            <MyInput
                                inputType="number"
                                inputPlaceholder="1"
                                input={grantedCount}
                                onChangeFunction={(e) => setGrantedCount(e.target.value)}
                                label={t('form.attemptsToGrantLabel')}
                                size="medium"
                                error={isCountValid ? undefined : t('form.attemptsRangeError')}
                            />
                        )}
                        {isTime && (
                            <MyInput
                                inputType="number"
                                inputPlaceholder={DEFAULT_EXTRA_MINUTES}
                                input={extraMinutes}
                                onChangeFunction={(e) => setExtraMinutes(e.target.value)}
                                label={t('form.extraMinutesLabel')}
                                size="medium"
                                error={isMinutesValid ? undefined : t('form.minutesRangeError')}
                            />
                        )}
                        {isReport && (
                            <MyInput
                                inputType="text"
                                inputPlaceholder={t('form.replyPlaceholder')}
                                input={reply}
                                onChangeFunction={(e) => setReply(e.target.value)}
                                label={t('form.replyLabel')}
                                size="large"
                            />
                        )}
                        {isReport ? (
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                layoutVariant="default"
                                disable={reviewMutation.isPending}
                                onClick={() => reviewMutation.mutate('RESOLVED')}
                            >
                                <CheckCircle size={16} /> {t('actions.markResolved')}
                            </MyButton>
                        ) : (
                            <>
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    layoutVariant="default"
                                    disable={reviewMutation.isPending || !canApprove}
                                    onClick={() => reviewMutation.mutate('APPROVED')}
                                >
                                    <CheckCircle size={16} /> {t('actions.approve')}
                                </MyButton>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    layoutVariant="default"
                                    disable={reviewMutation.isPending}
                                    onClick={() => reviewMutation.mutate('REJECTED')}
                                >
                                    <XCircle size={16} /> {t('actions.reject')}
                                </MyButton>
                            </>
                        )}
                    </div>
                    {isTime && <p className="text-caption text-neutral-500">{t('form.timeHint')}</p>}
                    {isReport && <p className="text-caption text-neutral-500">{t('form.replyHint')}</p>}
                </div>
            ) : (
                <div className="flex flex-col gap-1">
                    <p className="text-caption text-neutral-500">
                        {outcome()}
                        {reviewedOn}
                    </p>
                    {request.review_note && (
                        <p className="text-caption text-neutral-600">
                            {t('summary.replyNote', { note: request.review_note })}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export const ReattemptRequestsTab = () => {
    const { t } = useTranslation('assessmentReattemptRequestsTab');
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId() ?? '';
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
    const statusFilters = buildStatusFilters(t);
    const typeFilters = buildTypeFilters(t);

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ['reattempt-requests', instituteId, assessmentId, statusFilter, typeFilter],
        queryFn: () =>
            getReattemptRequests({
                instituteId,
                assessmentId,
                status: statusFilter === 'ALL' ? undefined : [statusFilter],
                type: typeFilter === 'ALL' ? undefined : [typeFilter],
            }),
        enabled: Boolean(instituteId),
    });

    // Same query key as the tab badge, so both share one cached COUNT request.
    const { data: pendingCount } = useQuery({
        queryKey: ['reattempt-requests-pending-count', instituteId, assessmentId],
        queryFn: () => getPendingReattemptRequestCount(instituteId, assessmentId),
        enabled: Boolean(instituteId),
        refetchInterval: PENDING_COUNT_REFRESH_MS,
    });
    const lastPendingCount = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (pendingCount === undefined) return;
        if (lastPendingCount.current !== undefined && lastPendingCount.current !== pendingCount) {
            refetch();
        }
        lastPendingCount.current = pendingCount;
    }, [pendingCount, refetch]);

    const handleReviewed = () => {
        refetch();
        // The nav badge counts pending requests across the institute, so it goes stale too.
        queryClient.invalidateQueries({ queryKey: ['reattempt-requests-pending-count'] });
    };

    if (isLoading) return <DashboardLoader />;

    if (isError) {
        // Name the actual failure. A bare "Could not load requests" is indistinguishable
        // between a dead endpoint, a rejected request line and an auth problem, and the
        // pending-count badge keeps ticking either way — so the tab looks merely empty.
        const status = (error as unknown as { response?: { status?: number } })?.response?.status;
        const reason = status !== undefined ? `HTTP ${status}` : error?.message ?? '';

        return (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-subtitle font-semibold text-neutral-700">
                    {t('error.title')}
                </p>
                {reason && <p className="text-caption text-neutral-500">{reason}</p>}
                <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                    <ArrowClockwise size={16} /> {t('error.tryAgain')}
                </MyButton>
            </div>
        );
    }

    const requests = data?.content ?? [];

    return (
        <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
                <ChipToggleGroup
                    value={typeFilter}
                    onChange={setTypeFilter}
                    options={typeFilters}
                    size="md"
                    ariaLabel={t('typeFilters.ariaLabel')}
                />
                <ChipToggleGroup
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={statusFilters}
                    size="md"
                    variant="outline"
                    ariaLabel={t('filters.ariaLabel')}
                />
            </div>

            {requests.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <Clock size={40} className="text-neutral-300" />
                    <p className="text-subtitle font-semibold text-neutral-700">
                        {statusFilter === 'ALL'
                            ? t('empty.titleAll')
                            : t('empty.titleFiltered', {
                                  status: statusFilter.toLowerCase(),
                              })}
                    </p>
                    <p className="max-w-sm text-body text-neutral-500">{t('empty.description')}</p>
                </div>
            ) : (
                requests.map((request) => (
                    <RequestRow
                        key={request.id}
                        request={request}
                        instituteId={instituteId}
                        onReviewed={handleReviewed}
                    />
                ))
            )}
        </div>
    );
};
