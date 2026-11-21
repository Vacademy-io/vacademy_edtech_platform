import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowClockwise, CheckCircle, Clock, XCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import {
    getReattemptRequests,
    reviewReattemptRequest,
    type ReattemptRequest,
    type ReattemptRequestStatus,
} from '@/services/reattempt-requests';
import { Route } from '..';

const buildStatusFilters = (
    t: TFunction
): Array<{ label: string; value: ReattemptRequestStatus | 'ALL' }> => [
    { label: t('filters.pending'), value: 'PENDING' },
    { label: t('filters.approved'), value: 'APPROVED' },
    { label: t('filters.rejected'), value: 'REJECTED' },
    { label: t('filters.all'), value: 'ALL' },
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

/**
 * One learner's request, with the grant inline.
 *
 * The count sits on the row rather than behind a confirm dialog because the decision an admin
 * is actually making is "how many tries does this person get" — asking that in a second step
 * is what made the old flow a one-attempt-at-a-time affair.
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
    const parsedCount = Number.parseInt(grantedCount, 10);
    const isCountValid = Number.isFinite(parsedCount) && parsedCount >= 1 && parsedCount <= 20;

    const reviewMutation = useMutation({
        mutationFn: (status: 'APPROVED' | 'REJECTED') =>
            reviewReattemptRequest({
                requestId: request.id,
                instituteId,
                status,
                grantedCount: status === 'APPROVED' ? parsedCount : undefined,
            }),
        onSuccess: (_data, status) => {
            toast.success(
                status === 'APPROVED'
                    ? t('toasts.granted', {
                          count: parsedCount,
                          name: request.participant_name ?? t('toasts.theLearner'),
                      })
                    : t('toasts.rejected'),
                { className: 'success-toast', duration: 4000 }
            );
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
                    <Badge tone="neutral">
                        {request.request_type === 'TIME_INCREASE'
                            ? t('requestType.timeIncrease')
                            : t('requestType.reattempt')}
                    </Badge>
                    {statusChip(request.status)}
                </div>
            </div>

            {request.reason && (
                <p className="rounded-md bg-neutral-50 p-3 text-body italic text-neutral-600">
                    &ldquo;{request.reason}&rdquo;
                </p>
            )}

            <p className="text-caption text-neutral-500">
                {t('summary.currentlyAllowed', { value: request.attempts_allowed ?? '—' })}
                {' · '}
                {t('summary.used', { value: request.attempts_used ?? '—' })}
                {request.created_at
                    ? ` · ${t('summary.requested', {
                          date: new Date(request.created_at).toLocaleString(i18n.language),
                      })}`
                    : ''}
            </p>

            {isPending ? (
                <div className="flex flex-wrap items-end gap-3">
                    {request.request_type === 'REATTEMPT' && (
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
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        disable={reviewMutation.isPending || !isCountValid}
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
                </div>
            ) : (
                <p className="text-caption text-neutral-500">
                    {request.status === 'APPROVED'
                        ? t('summary.grantedCount', { count: request.granted_count ?? 1 })
                        : t('status.rejected')}
                    {request.reviewed_at
                        ? ` ${t('summary.reviewedOn', {
                              date: new Date(request.reviewed_at).toLocaleString(i18n.language),
                          })}`
                        : ''}
                </p>
            )}
        </div>
    );
};

export const ReattemptRequestsTab = () => {
    const { t } = useTranslation('assessmentReattemptRequestsTab');
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId() ?? '';
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState<ReattemptRequestStatus | 'ALL'>('PENDING');
    const statusFilters = buildStatusFilters(t);

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ['reattempt-requests', instituteId, assessmentId, statusFilter],
        queryFn: () =>
            getReattemptRequests({
                instituteId,
                assessmentId,
                status: statusFilter === 'ALL' ? undefined : [statusFilter],
            }),
        enabled: Boolean(instituteId),
    });

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
            <div className="flex flex-wrap items-center gap-2">
                {statusFilters.map((flt) => (
                    <MyButton
                        key={flt.value}
                        buttonType={statusFilter === flt.value ? 'primary' : 'secondary'}
                        scale="medium"
                        layoutVariant="default"
                        onClick={() => setStatusFilter(flt.value)}
                    >
                        {flt.label}
                    </MyButton>
                ))}
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
