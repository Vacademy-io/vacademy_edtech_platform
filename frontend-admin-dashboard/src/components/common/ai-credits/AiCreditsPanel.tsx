import { useState, useMemo, useEffect } from 'react';
import {
    useAiCreditsQuery,
    useAiTransactionsQuery,
    useAiUsageAnalyticsQuery,
    useAiUsageForecastQuery,
    useUserAiUsageQuery,
} from '@/services/ai-credits/get-ai-credits';
import { getUserId } from '@/utils/userDetails';
import { parseUtcDate } from '@/utils/dateUtils';
import { isIOS } from '@/native';
import { toast } from 'sonner';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { TopUpModal } from './TopUpModal';
import { UsageHistoryV2 } from './UsageHistoryV2';
import { UsageAnalyticsV2 } from './UsageAnalyticsV2';
import { PlanSummaryCard } from './PlanSummaryCard';
import {
    LowCreditPlansNudge,
    goToPlans,
    shouldNudgePlans,
    useStorefrontVisible,
} from './PlanEntryPoints';
import { BillingDocumentRow, sortDocuments } from './PlanBillingDocuments';
import { useBillingDocumentsQuery } from '@/services/ai-plans/storefront';
import { useTranslation } from 'react-i18next';
import { useUsageConfigQuery } from '@/services/ai-credits/usage-v2';
import {
    usePlatformInvoicesQuery,
    downloadInvoicePdf,
    type PlatformInvoiceSummary,
} from '@/services/ai-credits/credit-pack-services';
import type {
    CreditTransaction,
    UsageByRequestType,
    TopModel,
} from '@/services/ai-credits/get-ai-credits';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
    Lightning,
    ArrowDown,
    ArrowUp,
    Clock,
    ChartBar,
    CurrencyCircleDollar,
    CalendarBlank,
    Warning,
    CaretDown,
    Sparkle,
    TrendUp,
    Receipt,
    DownloadSimple,
    FileText,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

type TabId = 'overview' | 'transactions' | 'analytics' | 'billing';

// ─── Badge (Trigger) ───────────────────────────────
interface AiCreditsBadgeProps {
    currentBalance: string;
    isLowBalance: boolean;
    className?: string;
}

function AiCreditsBadge({ currentBalance, isLowBalance, className }: AiCreditsBadgeProps) {
    const balance = parseFloat(currentBalance || '0');
    return (
        <div
            className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all hover:shadow-md',
                isLowBalance
                    ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 text-purple-700 hover:from-purple-100 hover:to-indigo-100',
                className
            )}
        >
            <Sparkle className="size-3.5" weight="fill" />
            <span className="hidden sm:inline">AI Credits:</span>
            <span className="font-bold">{balance.toFixed(1)}</span>
            {isLowBalance && <Warning className="size-3 text-amber-600" weight="fill" />}
            <CaretDown className="size-3 opacity-60" />
        </div>
    );
}

// ─── Transaction Type Config ─────────────────────────
const txTypeConfig: Record<
    string,
    { label: string; color: string; bgColor: string; icon: typeof ArrowDown }
> = {
    USAGE_DEDUCTION: {
        label: 'Usage',
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        icon: ArrowDown,
    },
    INITIAL_GRANT: {
        label: 'Grant',
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-50',
        icon: ArrowUp,
    },
    ADMIN_GRANT: {
        label: 'Admin Grant',
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        icon: ArrowUp,
    },
    REFUND: {
        label: 'Refund',
        color: 'text-teal-600',
        bgColor: 'bg-teal-50',
        icon: ArrowUp,
    },
};

// ─── Overview Tab ──────────────────────────────────
function OverviewTab({ storefrontVisible = false }: { storefrontVisible?: boolean }) {
    const { data: credits, isLoading: isCreditsLoading } = useAiCreditsQuery(true);
    const { data: forecast, isLoading: isForecastLoading } = useAiUsageForecastQuery(true);
    const { data: analytics, isLoading: isAnalyticsLoading } = useAiUsageAnalyticsQuery(7, true);
    const selfUserId = getUserId();
    const { data: selfUsage, isLoading: isSelfUsageLoading } = useUserAiUsageQuery(
        selfUserId,
        7,
        true
    );

    const totalCredits = parseFloat(credits?.total_credits || '0');
    const usedCredits = parseFloat(credits?.used_credits || '0');
    const currentBalance = parseFloat(credits?.current_balance || '0');
    const usagePercent = totalCredits > 0 ? (usedCredits / totalCredits) * 100 : 0;
    const nudgePlans =
        storefrontVisible &&
        shouldNudgePlans(!!credits?.is_low_balance, forecast?.estimated_days_remaining);

    const getBarColor = () => {
        if (usagePercent > 80) return 'bg-red-500';
        if (usagePercent > 60) return 'bg-amber-500';
        return 'bg-gradient-to-r from-purple-500 to-indigo-500';
    };

    if (isCreditsLoading) {
        return (
            <div className="space-y-4 p-1">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Credit Balance Card */}
            <div className="rounded-xl border border-purple-100 bg-gradient-to-br from-purple-50/80 via-indigo-50/50 to-white p-3">
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-neutral-500">Total Balance</span>
                    <span className="flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-purple-600 shadow-sm">
                        <CurrencyCircleDollar className="size-3" weight="fill" />
                        Credits
                    </span>
                </div>
                <div className="mb-3 flex items-end gap-2">
                    <span className="text-2xl font-bold text-neutral-900">
                        {currentBalance.toFixed(2)}
                    </span>
                    <span className="mb-0.5 text-xs text-neutral-400">
                        / {totalCredits.toFixed(0)}
                    </span>
                </div>
                {/* Progress bar */}
                <div className="mb-1.5 h-2 overflow-hidden rounded-full bg-neutral-100">
                    <div
                        className={cn(
                            'h-full rounded-full transition-all duration-500',
                            getBarColor()
                        )}
                        style={{ width: `${Math.min(usagePercent, 100)}%` }}
                    />
                </div>
                <div className="flex justify-between text-[10px] text-neutral-400">
                    <span>{usedCredits.toFixed(1)} used</span>
                    <span>{usagePercent.toFixed(0)}% consumed</span>
                </div>
            </div>

            {/* AI plan (renders nothing unless the institute has a plan in effect,
                or — storefront on — a small "Plans from …" card) */}
            <PlanSummaryCard storefrontAllowed={storefrontVisible} />

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2">
                {/* Forecast */}
                <div className="rounded-xl border bg-white p-2.5">
                    <div className="mb-1 flex items-center gap-1.5">
                        <div className="rounded-md bg-blue-50 p-1">
                            <CalendarBlank className="size-3 text-blue-500" weight="fill" />
                        </div>
                        <span className="text-[10px] font-medium text-neutral-500">Days Left</span>
                    </div>
                    {isForecastLoading ? (
                        <Skeleton className="h-6 w-12" />
                    ) : (
                        <div className="text-lg font-bold text-neutral-800">
                            {forecast?.estimated_days_remaining ?? '—'}
                        </div>
                    )}
                </div>

                {/* Avg daily */}
                <div className="rounded-xl border bg-white p-2.5">
                    <div className="mb-1 flex items-center gap-1.5">
                        <div className="rounded-md bg-amber-50 p-1">
                            <TrendUp className="size-3 text-amber-500" weight="fill" />
                        </div>
                        <span className="text-[10px] font-medium text-neutral-500">Daily Avg</span>
                    </div>
                    {isForecastLoading ? (
                        <Skeleton className="h-6 w-12" />
                    ) : (
                        <div className="text-lg font-bold text-neutral-800">
                            {forecast?.average_daily_usage != null
                                ? Number(forecast.average_daily_usage).toFixed(2)
                                : '—'}
                        </div>
                    )}
                </div>

                {/* Total requests (7d) */}
                <div className="rounded-xl border bg-white p-2.5">
                    <div className="mb-1 flex items-center gap-1.5">
                        <div className="rounded-md bg-emerald-50 p-1">
                            <Lightning className="size-3 text-emerald-500" weight="fill" />
                        </div>
                        <span className="text-[10px] font-medium text-neutral-500">
                            Requests (7d)
                        </span>
                    </div>
                    {isAnalyticsLoading ? (
                        <Skeleton className="h-6 w-12" />
                    ) : (
                        <div className="text-lg font-bold text-neutral-800">
                            {analytics?.total_requests ?? '—'}
                        </div>
                    )}
                </div>

                {/* Credits used (7d) */}
                <div className="rounded-xl border bg-white p-2.5">
                    <div className="mb-1 flex items-center gap-1.5">
                        <div className="rounded-md bg-purple-50 p-1">
                            <ChartBar className="size-3 text-purple-500" weight="fill" />
                        </div>
                        <span className="text-[10px] font-medium text-neutral-500">Used (7d)</span>
                    </div>
                    {isAnalyticsLoading ? (
                        <Skeleton className="h-6 w-12" />
                    ) : (
                        <div className="text-lg font-bold text-neutral-800">
                            {analytics?.total_credits_used != null
                                ? Number(analytics.total_credits_used).toFixed(1)
                                : '—'}
                        </div>
                    )}
                </div>
            </div>

            {/* Your usage (self) */}
            <div className="flex items-center justify-between rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 p-2.5">
                <div className="flex items-center gap-1.5">
                    <div className="rounded-md bg-white/70 p-1">
                        <Sparkle className="size-3 text-purple-500" weight="fill" />
                    </div>
                    <span className="text-caption font-medium text-purple-700">
                        Your usage (7d)
                    </span>
                </div>
                {isSelfUsageLoading ? (
                    <Skeleton className="h-5 w-16" />
                ) : (
                    <span className="text-body font-bold text-purple-800">
                        {(selfUsage?.total_credits ?? 0).toFixed(1)} credits
                        <span className="ml-1 text-caption font-medium text-purple-500">
                            · {selfUsage?.request_count ?? 0} req
                        </span>
                    </span>
                )}
            </div>

            {/* Running low and plans are on offer: suggest a plan (replaces the tip) */}
            {nudgePlans && <LowCreditPlansNudge />}

            {/* Forecast recommendation */}
            {!nudgePlans && forecast?.recommendation && (
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2">
                    <p className="text-[11px] leading-relaxed text-blue-700">
                        💡 {forecast.recommendation}
                    </p>
                </div>
            )}
        </div>
    );
}

// ─── Transactions Tab ──────────────────────────────
function TransactionsTab() {
    const [page, setPage] = useState(1);
    const { data, isLoading } = useAiTransactionsQuery(page, 8, undefined, true);

    if (isLoading) {
        return (
            <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
            </div>
        );
    }

    const transactions = data?.transactions || [];

    if (transactions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-neutral-400">
                <Receipt className="mb-2 size-8 text-neutral-300" />
                No transactions yet
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            {transactions.map((tx: CreditTransaction) => {
                const cfg = txTypeConfig[tx.transaction_type] ?? {
                    label: 'Transaction',
                    color: 'text-neutral-600',
                    bgColor: 'bg-neutral-50',
                    icon: ArrowDown,
                };
                const Icon = cfg.icon;
                const isPositive = tx.amount > 0;
                return (
                    <div
                        key={tx.id}
                        className="flex items-center gap-2.5 rounded-lg border bg-white px-2.5 py-2 transition-colors hover:bg-neutral-50"
                    >
                        <div className={cn('rounded-lg p-1.5', cfg.bgColor)}>
                            <Icon className={cn('size-3', cfg.color)} weight="bold" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-medium text-neutral-800">
                                    {tx.description || cfg.label}
                                </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-neutral-400">
                                {tx.model_name && (
                                    <span className="truncate rounded bg-neutral-100 px-1 py-0.5 font-mono text-[9px]">
                                        {tx.model_name.split('/').pop()}
                                    </span>
                                )}
                                <span>
                                    {parseUtcDate(tx.created_at).toLocaleString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span
                                className={cn(
                                    'text-xs font-bold',
                                    isPositive ? 'text-emerald-600' : 'text-red-500'
                                )}
                            >
                                {isPositive ? '+' : ''}
                                {Number(tx.amount).toFixed(2)}
                            </span>
                            <div className="text-[10px] text-neutral-400">
                                Bal: {Number(tx.balance_after).toFixed(1)}
                            </div>
                        </div>
                    </div>
                );
            })}
            {/* Pagination */}
            {data && data.total_pages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="rounded-md border px-2.5 py-1 text-[10px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Prev
                    </button>
                    <span className="text-[10px] text-neutral-500">
                        {page} / {data.total_pages}
                    </span>
                    <button
                        onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
                        disabled={page >= data.total_pages}
                        className="rounded-md border px-2.5 py-1 text-[10px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Analytics Tab ─────────────────────────────────
function AnalyticsTab() {
    const [days, setDays] = useState(30);
    const { data: analytics, isLoading } = useAiUsageAnalyticsQuery(days, true);

    if (isLoading) {
        return (
            <div className="space-y-3">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-24 w-full rounded-lg" />
            </div>
        );
    }

    if (!analytics) {
        return (
            <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-neutral-400">
                <ChartBar className="mb-2 size-8 text-neutral-300" />
                No analytics data available
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Period selector */}
            <div className="flex items-center gap-1.5">
                {[7, 14, 30].map((d) => (
                    <button
                        key={d}
                        onClick={() => setDays(d)}
                        className={cn(
                            'rounded-full px-2.5 py-1 text-[10px] font-medium transition-all',
                            days === d
                                ? 'bg-purple-600 text-white shadow-sm'
                                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        )}
                    >
                        {d}d
                    </button>
                ))}
            </div>

            {/* Usage by type */}
            {analytics.by_request_type && analytics.by_request_type.length > 0 && (
                <div className="rounded-xl border bg-white p-3">
                    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                        Usage by Type
                    </h4>
                    <div className="space-y-2">
                        {analytics.by_request_type.map((item: UsageByRequestType) => (
                            <div key={item.request_type}>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium capitalize text-neutral-700">
                                        {item.request_type}
                                    </span>
                                    <span className="text-xs text-neutral-500">
                                        {Number(item.total_credits).toFixed(1)} credits
                                    </span>
                                </div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-purple-400 to-indigo-400 transition-all duration-500"
                                        style={{ width: `${item.percentage}%` }}
                                    />
                                </div>
                                <div className="mt-0.5 flex justify-between text-[10px] text-neutral-400">
                                    <span>{item.total_requests} requests</span>
                                    <span>{Number(item.percentage).toFixed(1)}%</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Top models */}
            {analytics.top_models && analytics.top_models.length > 0 && (
                <div className="rounded-xl border bg-white p-3">
                    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                        Top Models
                    </h4>
                    <div className="space-y-1.5">
                        {analytics.top_models.slice(0, 5).map((model: TopModel, i: number) => (
                            <div
                                key={model.model}
                                className="flex items-center gap-2 rounded-lg bg-neutral-50 px-2 py-1.5"
                            >
                                <span className="flex size-5 items-center justify-center rounded-full bg-purple-100 text-[10px] font-bold text-purple-600">
                                    {i + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <span className="block truncate text-[11px] font-medium text-neutral-700">
                                        {model.model.split('/').pop()}
                                    </span>
                                </div>
                                <div className="text-right text-[10px] text-neutral-500">
                                    <span className="font-semibold text-neutral-700">
                                        {Number(model.credits).toFixed(1)}
                                    </span>{' '}
                                    · {model.requests}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Daily usage mini chart */}
            {analytics.by_day && analytics.by_day.length > 0 && (
                <div className="rounded-xl border bg-white p-3">
                    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                        Daily Usage
                    </h4>
                    <DailyUsageChart data={analytics.by_day} />
                </div>
            )}
        </div>
    );
}

// ─── Mini Bar Chart ────────────────────────────────
function DailyUsageChart({ data }: { data: { date: string; total_credits: number }[] }) {
    const maxCredits = useMemo(
        () => Math.max(...data.map((d) => Number(d.total_credits)), 0.1),
        [data]
    );
    const last7 = data.slice(-7);

    return (
        <div className="flex items-end gap-1" style={{ height: 48 }}>
            {last7.map((day) => {
                const h = Math.max((Number(day.total_credits) / maxCredits) * 100, 4);
                return (
                    <div
                        key={day.date}
                        className="group relative flex flex-1 flex-col items-center"
                    >
                        <div
                            className="w-full rounded-t bg-gradient-to-t from-purple-400 to-indigo-300 transition-all group-hover:from-purple-500 group-hover:to-indigo-400"
                            style={{ height: `${h}%` }}
                        />
                        <span className="mt-1 text-[8px] text-neutral-400">
                            {new Date(day.date).toLocaleDateString('en-US', {
                                weekday: 'narrow',
                                timeZone: 'UTC',
                            })}
                        </span>
                        {/* Tooltip */}
                        <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 scale-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-white shadow-lg transition-transform group-hover:scale-100">
                            {Number(day.total_credits).toFixed(2)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Billing Tab ───────────────────────────────────
// Credit-pack invoices exactly as before; with the plan storefront on, AI plan
// invoices and every credit note (from the plans facade) are listed below them.
function BillingTab({ storefrontVisible = false }: { storefrontVisible?: boolean }) {
    return (
        <div className="space-y-3">
            <PackInvoiceList />
            {storefrontVisible && <PlanDocumentList />}
        </div>
    );
}

function PlanDocumentList() {
    const { t } = useTranslation('aiPlans');
    const instituteId = getCurrentInstituteId();
    const { data } = useBillingDocumentsQuery(instituteId);
    const docs = sortDocuments(
        (data ?? []).filter((d) => d.doc_type === 'CREDIT_NOTE' || d.item_kind !== 'CREDIT_PACK')
    );
    if (!instituteId || docs.length === 0) return null;
    return (
        <div className="space-y-1.5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                {t('invoices.popoverTitle')}
            </p>
            <ul className="space-y-1.5">
                {docs.map((d) => (
                    <BillingDocumentRow
                        key={`${d.doc_type}-${d.id}`}
                        instituteId={instituteId}
                        doc={d}
                        compact
                    />
                ))}
            </ul>
        </div>
    );
}

// AI credit purchase invoices (credit packs).
function PackInvoiceList() {
    const instituteId = getCurrentInstituteId();
    const { data, isLoading, isError } = usePlatformInvoicesQuery(instituteId);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    const handleDownload = async (inv: PlatformInvoiceSummary) => {
        setDownloadingId(inv.invoice_id);
        try {
            await downloadInvoicePdf(inv.invoice_id, `${inv.invoice_number}.pdf`);
        } catch {
            toast.error('Could not download the invoice', {
                description: 'Please try again in a moment.',
            });
        } finally {
            setDownloadingId(null);
        }
    };

    if (isLoading) {
        return (
            <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
            </div>
        );
    }

    if (isError) {
        return (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                Could not load invoices. Please try again later.
            </div>
        );
    }

    const invoices = data ?? [];

    if (invoices.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-neutral-400">
                <FileText className="mb-2 size-8 text-neutral-300" />
                No purchases yet
                <span className="mt-1 text-2xs text-neutral-400">
                    GST tax invoices for credit top-ups will appear here.
                </span>
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            {invoices.map((inv) => {
                const refunded = inv.payment_status !== 'PAID';
                const busy = downloadingId === inv.invoice_id;
                return (
                    <div
                        key={inv.invoice_id}
                        className="flex items-center gap-2.5 rounded-lg border bg-white px-2.5 py-2 transition-colors hover:bg-neutral-50"
                    >
                        <div className="rounded-lg bg-purple-50 p-1.5">
                            <FileText className="size-3 text-purple-600" weight="bold" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-medium text-neutral-800">
                                    {inv.pack_name} · {Number(inv.credits).toLocaleString('en-IN')}{' '}
                                    credits
                                </span>
                                {refunded && (
                                    <span className="rounded bg-amber-50 px-1 py-0.5 text-2xs font-semibold uppercase tracking-wide text-amber-600">
                                        {inv.payment_status === 'REFUNDED'
                                            ? 'Refunded'
                                            : 'Partly refunded'}
                                    </span>
                                )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-2xs text-neutral-400">
                                <span className="truncate font-mono">{inv.invoice_number}</span>
                                <span>
                                    {parseUtcDate(inv.issued_at).toLocaleDateString('en-IN', {
                                        day: 'numeric',
                                        month: 'short',
                                        year: 'numeric',
                                    })}
                                </span>
                                {inv.buyer_gstin && (
                                    <span className="rounded bg-emerald-50 px-1 py-0.5 text-2xs font-semibold text-emerald-600">
                                        B2B
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="text-end">
                            <div className="text-xs font-bold text-neutral-800">
                                {inv.display_total_major}
                            </div>
                            <div className="text-2xs text-neutral-400">
                                {inv.is_export
                                    ? 'GST 0% (export)'
                                    : `incl. GST ${(inv.tax_amount_minor / 100).toLocaleString(
                                          'en-IN',
                                          {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 2,
                                          }
                                      )}`}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => handleDownload(inv)}
                            disabled={busy}
                            title="Download GST tax invoice (PDF)"
                            aria-label={`Download invoice ${inv.invoice_number}`}
                            className="ms-1 rounded-md border border-neutral-200 p-1.5 text-neutral-500 transition-colors hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700 disabled:opacity-50"
                        >
                            <DownloadSimple
                                className={cn('size-3.5', busy && 'animate-pulse')}
                                weight="bold"
                            />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Tab buttons ───────────────────────────────────
const tabs: { id: TabId; label: string; icon: typeof ChartBar }[] = [
    { id: 'overview', label: 'Overview', icon: ChartBar },
    { id: 'transactions', label: 'History', icon: Clock },
    { id: 'analytics', label: 'Analytics', icon: Lightning },
    { id: 'billing', label: 'Billing', icon: Receipt },
];

// ─── Main Component ────────────────────────────────
interface AiCreditsPanelProps {
    className?: string;
    /** Override the default badge trigger. Must be a single focusable element (e.g. a button). */
    trigger?: React.ReactNode;
    popoverSide?: 'top' | 'right' | 'bottom' | 'left';
    popoverAlign?: 'start' | 'center' | 'end';
    popoverSideOffset?: number;
    /** Override the default "Explore AI Tools" link in the footer. Pass `null` to hide it. */
    footerAction?: React.ReactNode | null;
    /** When true, hide the Top Up button and modal (e.g. for non-admin Vimotion users). */
    hideTopUp?: boolean;
}

export function AiCreditsPanel({
    className,
    trigger,
    popoverSide,
    popoverAlign = 'end',
    popoverSideOffset = 8,
    footerAction,
    hideTopUp: hideTopUpProp = false,
}: AiCreditsPanelProps) {
    // Apple Guideline 3.1.1: digital credit purchases are not allowed outside of
    // In-App Purchase, so we hide the Top Up entry points entirely on native iOS.
    const hideTopUp = hideTopUpProp || isIOS();
    const { data: credits, isError } = useAiCreditsQuery(true);
    const [activeTab, setActiveTab] = useState<TabId>('overview');
    const [isOpen, setIsOpen] = useState(false);
    const [topUpOpen, setTopUpOpen] = useState(false);
    const [resumePaymentId, setResumePaymentId] = useState<string | null>(null);

    // Usage metering v2 (History v2 / Analytics v2). Asked for only once the
    // popover is opened; any error or a false flag keeps today's v1 tabs.
    const instituteId = getCurrentInstituteId();
    const usageConfig = useUsageConfigQuery(instituteId, isOpen);
    // AI plan storefront: asked for only once the popover is open; admin-only,
    // off by default, hidden on iOS — null keeps the popover exactly as before.
    const storefront = useStorefrontVisible(instituteId, isOpen && !hideTopUp);
    const storefrontVisible = !!storefront;
    const { t: tPlans } = useTranslation('aiPlans');
    const usageV2 =
        !!instituteId && usageConfig.data?.history_v2_enabled === true ? instituteId : null;
    const usageV2Admin = usageConfig.data?.is_admin === true;
    // Hold the History/Analytics tabs on a skeleton while the flag is in
    // flight so v1 and v2 never both fire their requests.
    const usageConfigPending = isOpen && !!instituteId && usageConfig.isPending;

    // Returning from Razorpay's hosted payment lands on …?topup_pp=<id>.
    // Reopen the top-up modal straight into its polling/confirmation state, then
    // scrub the payment params from the URL so a refresh can't re-trigger it.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const pp = params.get('topup_pp');
        if (!pp) return;
        setResumePaymentId(pp);
        setTopUpOpen(true);
        [
            'topup_pp',
            'razorpay_payment_id',
            'razorpay_payment_link_id',
            'razorpay_payment_link_reference_id',
            'razorpay_payment_link_status',
            'razorpay_signature',
        ].forEach((k) => params.delete(k));
        const qs = params.toString();
        window.history.replaceState(
            {},
            '',
            `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
        );
    }, []);

    if (!credits || isError) return null;

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                {trigger ?? (
                    <button className={cn('cursor-pointer outline-none', className)}>
                        <AiCreditsBadge
                            currentBalance={credits.current_balance}
                            isLowBalance={credits.is_low_balance}
                        />
                    </button>
                )}
            </PopoverTrigger>
            <PopoverContent
                side={popoverSide}
                align={popoverAlign}
                sideOffset={popoverSideOffset}
                className="w-[340px] rounded-2xl border border-neutral-200 bg-neutral-50 p-0 shadow-xl sm:w-[380px]"
            >
                {/* Header */}
                <div className="flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-white/20 p-1.5">
                            <Sparkle className="size-4 text-white" weight="fill" />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-white">AI Credits</h3>
                            <p className="text-[10px] text-purple-200">Usage & Analytics</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-lg font-bold text-white">
                            {parseFloat(credits.current_balance || '0').toFixed(1)}
                        </div>
                        <div className="text-[10px] text-purple-200">remaining</div>
                    </div>
                </div>

                {/* Tab bar */}
                <div className="flex gap-0.5 border-b bg-white px-2 pt-1.5">
                    {tabs.map((tab) => {
                        // Billing (purchase invoices) only makes sense where top-ups do.
                        if (tab.id === 'billing' && hideTopUp) return null;
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    'flex items-center gap-1 rounded-t-lg px-3 py-1.5 text-[11px] font-medium transition-all',
                                    activeTab === tab.id
                                        ? 'border-b-2 border-purple-600 bg-purple-50 text-purple-700'
                                        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                                )}
                            >
                                <Icon
                                    className="size-3"
                                    weight={activeTab === tab.id ? 'fill' : 'regular'}
                                />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Content */}
                <div className="max-h-[400px] overflow-y-auto">
                    <div className="p-3">
                        {activeTab === 'overview' && (
                            <OverviewTab storefrontVisible={storefrontVisible} />
                        )}
                        {(activeTab === 'transactions' || activeTab === 'analytics') &&
                        usageConfigPending ? (
                            <div className="space-y-2">
                                {[...Array(4)].map((_, i) => (
                                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                                ))}
                            </div>
                        ) : (
                            <>
                                {activeTab === 'transactions' &&
                                    (usageV2 ? (
                                        <UsageHistoryV2
                                            instituteId={usageV2}
                                            isAdmin={usageV2Admin}
                                        />
                                    ) : (
                                        <TransactionsTab />
                                    ))}
                                {activeTab === 'analytics' &&
                                    (usageV2 ? (
                                        <UsageAnalyticsV2
                                            instituteId={usageV2}
                                            isAdmin={usageV2Admin}
                                        />
                                    ) : (
                                        <AnalyticsTab />
                                    ))}
                            </>
                        )}
                        {activeTab === 'billing' && (
                            <BillingTab storefrontVisible={storefrontVisible} />
                        )}
                    </div>
                </div>

                {/* Footer */}
                <Separator />
                <div className="flex items-center justify-between rounded-b-2xl bg-white px-4 py-2">
                    {footerAction === null || hideTopUp ? (
                        <span />
                    ) : (
                        footerAction ?? (
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsOpen(false);
                                        setTopUpOpen(true);
                                    }}
                                    className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-purple-700"
                                >
                                    <Sparkle className="size-3" weight="fill" />
                                    Top up
                                </button>
                                {storefrontVisible && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsOpen(false);
                                            goToPlans();
                                        }}
                                        className="rounded-lg border border-primary-200 px-2.5 py-1.5 text-2xs font-semibold text-primary-600 transition-colors hover:bg-primary-50"
                                    >
                                        {tPlans('entry.plansLink')}
                                    </button>
                                )}
                            </div>
                        )
                    )}

                    {credits.is_low_balance ? (
                        <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                            <Warning className="size-3" weight="fill" />
                            Low Balance
                        </span>
                    ) : (
                        <span className="text-[10px] text-neutral-400">
                            Updated{' '}
                            {credits.updated_at
                                ? parseUtcDate(credits.updated_at).toLocaleString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                  })
                                : 'recently'}
                        </span>
                    )}
                </div>
            </PopoverContent>
            {!hideTopUp && (
                <TopUpModal
                    open={topUpOpen}
                    onOpenChange={(o) => {
                        setTopUpOpen(o);
                        if (!o) setResumePaymentId(null);
                    }}
                    resumePaymentId={resumePaymentId}
                />
            )}
        </Popover>
    );
}
