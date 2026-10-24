import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, Receipt } from '@phosphor-icons/react';
import { fetchPaymentLogs } from '@/services/payment-logs';
import type { PaymentLogEntry } from '@/types/payment-logs';
import { formatMoney, resolveEntryCurrency } from '@/utils/payment-currency';

interface RecentTransactionsWidgetProps {
    instituteId: string;
}

/**
 * Each row is shown in the currency it was actually charged in — this list mixes institutes and
 * plans, so a hardcoded ₹ printed genuine USD/AUD/GBP charges as rupees. See
 * `resolveEntryCurrency` for why `payment_log.currency` alone isn't enough.
 */
const formatAmount = (entry: PaymentLogEntry): string => {
    const amount = entry.payment_log?.payment_amount;
    if (!amount && amount !== 0) return '—';
    return formatMoney(amount, resolveEntryCurrency(entry), { maximumFractionDigits: 0 });
};

/**
 * `created_at` is a UTC instant, so `toLocaleString` renders it in the viewer's own zone — the same
 * local clock the Manage Payments table shows. `hasTime` is false only for the `date` fallback,
 * which is a DATE column at UTC midnight: it has no real time, and must be pinned to UTC or it
 * renders as the previous day west of UTC.
 */
const formatDate = (iso: string | null | undefined, hasTime: boolean): string => {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            ...(hasTime ? { hour: 'numeric', minute: '2-digit' } : { timeZone: 'UTC' }),
        });
    } catch {
        return '';
    }
};

const statusTone = (status: string | null | undefined): string => {
    const s = (status || '').toUpperCase();
    if (s === 'PAID') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (s === 'PAYMENT_PENDING' || s === 'NOT_INITIATED' || s === 'PENDING')
        return 'bg-amber-50 text-amber-700 border-amber-200';
    if (s === 'FAILED' || s === 'CANCELLED') return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-neutral-100 text-neutral-700 border-neutral-200';
};

const buildStatusLabel =
    (t: TFunction) =>
    (status: string | null | undefined): string => {
        const s = (status || '').toUpperCase();
        if (s === 'PAID') return t('status.success');
        if (s === 'PAYMENT_PENDING' || s === 'NOT_INITIATED') return t('status.pending');
        // A stale, unfinished checkout — neither pending nor failed. Neutral tone, plain label.
        if (s === 'ABANDONED') return 'Abandoned';
        if (s === 'FAILED') return t('status.failed');
        if (s === 'CANCELLED') return t('status.cancelled');
        return status || '—';
    };

const initials = (name: string | null | undefined): string => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
};

export default function RecentTransactionsWidget({ instituteId }: RecentTransactionsWidgetProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('dashboardRecentTransactionsWidget');
    const statusLabel = buildStatusLabel(t);
    const { data, isLoading, isError } = useQuery({
        queryKey: ['DASHBOARD_RECENT_PAYMENTS', instituteId],
        queryFn: () => fetchPaymentLogs(0, 5, {}),
        staleTime: 60_000,
        retry: false,
        enabled: !!instituteId,
    });

    if (isError) return null;

    const rows = data?.content || [];

    return (
        <Card className="grow bg-white shadow-sm">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                            <Receipt size={14} weight="duotone" />
                        </span>
                        <CardTitle className="text-sm font-semibold">{t('heading')}</CardTitle>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate({ to: '/manage-payments' })}
                        className="flex items-center gap-1 text-2xs font-medium text-primary-600 hover:text-primary-700"
                    >
                        {t('viewAll')}
                        <ArrowRight size={12} weight="bold" />
                    </button>
                </div>
                <CardDescription className="text-2xs text-neutral-500 sm:text-xs">
                    {t('description')}
                </CardDescription>
            </CardHeader>
            <div className="px-2 pb-3">
                {isLoading ? (
                    <ul className="space-y-1">
                        {[0, 1, 2, 3, 4].map((i) => (
                            <li key={i} className="flex items-center gap-3 rounded p-2">
                                <Skeleton className="size-8 rounded-full" />
                                <div className="flex-1 space-y-1">
                                    <Skeleton className="h-3 w-2/3" />
                                    <Skeleton className="h-2.5 w-1/3" />
                                </div>
                                <Skeleton className="h-3 w-14" />
                                <Skeleton className="h-5 w-16 rounded-full" />
                            </li>
                        ))}
                    </ul>
                ) : rows.length === 0 ? (
                    <div className="py-6 text-center text-xs text-neutral-500">
                        {t('emptyState')}
                    </div>
                ) : (
                    <ul className="space-y-0.5">
                        {rows.map((entry) => {
                            const log = entry.payment_log;
                            const user = entry.user;
                            const status = entry.current_payment_status || log.payment_status;
                            const fullName =
                                user?.full_name || user?.username || t('fallback.unknownUser');
                            return (
                                <li key={log.id}>
                                    <button
                                        type="button"
                                        onClick={() => navigate({ to: '/manage-payments' })}
                                        className="group flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-neutral-50"
                                    >
                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-2xs font-semibold text-primary-700">
                                            {initials(fullName)}
                                        </span>
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="line-clamp-1 text-xs font-medium text-neutral-800">
                                                {fullName}
                                            </span>
                                            <span className="line-clamp-1 text-2xs text-neutral-500">
                                                {(log.vendor || t('fallback.manualVendor')).replace(
                                                    /_/g,
                                                    ' '
                                                )}
                                                {/* created_at is a real instant and carries the
                                                    payment's clock time; `date` is a DATE column
                                                    (UTC midnight) with no usable time. */}
                                                {log.created_at
                                                    ? ` · ${formatDate(log.created_at, true)}`
                                                    : log.date
                                                      ? ` · ${formatDate(log.date, false)}`
                                                      : ''}
                                            </span>
                                        </span>
                                        <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-900">
                                            {formatAmount(entry)}
                                        </span>
                                        <span
                                            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-2xs font-medium ${statusTone(status)}`}
                                        >
                                            {statusLabel(status)}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </Card>
    );
}
