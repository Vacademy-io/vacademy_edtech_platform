import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    CurrencyCny,
    CurrencyDollar,
    CurrencyEur,
    CurrencyGbp,
    CurrencyInr,
    CurrencyJpy,
    Money,
    Receipt,
    TrendUp,
    type Icon,
} from '@phosphor-icons/react';
import {
    Area,
    AreaChart,
    XAxis,
    YAxis,
    ResponsiveContainer,
    Tooltip,
    CartesianGrid,
} from 'recharts';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { isRealCurrency } from '@/utils/payment-currency';
import {
    fetchCollectionSummary,
    rangeToWindow,
    COLLECTION_RANGES,
    type CollectionRangeKey,
} from '../-services/collection-summary-service';

interface RevenueTrendsWidgetProps {
    /** When set, scope to one sub-org (sub-org admin view). Omit = institute-wide. */
    subOrgId?: string | null;
    /** Optional heading override (e.g. the sub-org name). */
    title?: string;
}

/**
 * Format in the currency the backend actually collected in. It used to fall back to INR whenever
 * the aggregate returned no code — which was every institute whose payment_log rows carry a blank
 * currency, so USD/AUD/GBP collections were labelled with a ₹. An unresolvable code now renders a
 * bare number rather than a wrong symbol. Locale stays en-IN so compact notation reads as L/Cr.
 */
const money = (n: number, currency: string | null): string => {
    const code = currency?.trim().toUpperCase() || '';
    const notation = n >= 100000 ? 'compact' : 'standard';
    if (isRealCurrency(code)) {
        try {
            return new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency: code,
                maximumFractionDigits: 0,
                notation,
            }).format(n);
        } catch {
            /* fall through to the plain-number form below */
        }
    }
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0, notation }).format(n);
};

/** Header glyph follows the collected currency; codes without a dedicated icon get a banknote. */
const CURRENCY_ICONS: Record<string, Icon> = {
    INR: CurrencyInr,
    USD: CurrencyDollar,
    AUD: CurrencyDollar,
    CAD: CurrencyDollar,
    SGD: CurrencyDollar,
    GBP: CurrencyGbp,
    EUR: CurrencyEur,
    JPY: CurrencyJpy,
    CNY: CurrencyCny,
};

const currencyIcon = (currency: string | null): Icon =>
    CURRENCY_ICONS[currency?.trim().toUpperCase() || ''] ?? Money;

const nfmt = (n: number) => n.toLocaleString('en-IN');

const buildMonths = (t: TFunction): string[] => [
    t('months.jan'),
    t('months.feb'),
    t('months.mar'),
    t('months.apr'),
    t('months.may'),
    t('months.jun'),
    t('months.jul'),
    t('months.aug'),
    t('months.sep'),
    t('months.oct'),
    t('months.nov'),
    t('months.dec'),
];

/** Short axis label from a YYYY-MM-DD string, e.g. "12 Jul". */
const buildShortDay =
    (t: TFunction) =>
    (d: string): string => {
        const parts = d.split('-');
        if (parts.length !== 3) return d;
        const months = buildMonths(t);
        const m = months[Number(parts[1]) - 1] ?? '';
        return `${Number(parts[2])} ${m}`;
    };

/**
 * "Amount collected" panel with a 3d / 7d / 24d / All time filter. Sums PAID
 * payments over the window (backend aggregate) and plots the per-day series.
 * Institute-wide for a parent admin; pass `subOrgId` for a sub-org admin's own
 * collection. Renders nothing on error so it never shows a broken/zero card.
 */
export default function RevenueTrendsWidget({ subOrgId, title }: RevenueTrendsWidgetProps) {
    const instituteId = getCurrentInstituteId();
    const [range, setRange] = useState<CollectionRangeKey>('7d');
    const { t } = useTranslation('dashboardRevenueTrendsWidget');
    const shortDay = useMemo(() => buildShortDay(t), [t]);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['collection-summary', instituteId, subOrgId ?? null, range],
        queryFn: () =>
            fetchCollectionSummary({
                institute_id: instituteId || '',
                ...(subOrgId ? { sub_org_id: subOrgId } : {}),
                ...rangeToWindow(range),
            }),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const chartData = useMemo(
        () => (data?.daily ?? []).map((p) => ({ ...p, label: shortDay(p.date) })),
        [data, shortDay]
    );

    if (isError) return null;

    const total = data?.total_amount ?? 0;
    const count = data?.total_count ?? 0;
    const currency = data?.currency ?? null;
    const rangeLabel = t(`ranges.${range}`);
    const CurrencyIcon = currencyIcon(currency);

    return (
        <Card className="p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                        <CurrencyIcon size={14} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <h3 className="line-clamp-1 text-sm font-semibold text-neutral-900">
                            {title || t('heading')}
                        </h3>
                        <p className="line-clamp-1 text-xs text-neutral-500">
                            {t('subtitle', { range: rangeLabel.toLowerCase() })}
                        </p>
                    </div>
                </div>

                {/* Time-range segmented control */}
                <div
                    role="group"
                    aria-label={t('rangeGroup')}
                    className="flex shrink-0 items-center gap-0.5 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5"
                >
                    {COLLECTION_RANGES.map((r) => (
                        <button
                            key={r.key}
                            type="button"
                            onClick={() => setRange(r.key)}
                            aria-pressed={range === r.key}
                            className={cn(
                                'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                                range === r.key
                                    ? 'bg-primary-500 text-white shadow-sm'
                                    : 'text-neutral-600 hover:bg-neutral-100'
                            )}
                        >
                            {t(`ranges.${r.key}`)}
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI row */}
            <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
                <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                        {t('totalCollected')}
                    </div>
                    {isLoading ? (
                        <Skeleton className="mt-1 h-8 w-32" />
                    ) : (
                        <div className="mt-0.5 text-3xl font-semibold tabular-nums text-neutral-900">
                            {money(total, currency)}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                    <Receipt size={14} weight="duotone" className="text-neutral-400" />
                    {isLoading ? (
                        <Skeleton className="h-3 w-16" />
                    ) : (
                        <span className="tabular-nums">
                            {t('payments', { count, formatted: nfmt(count) })}
                        </span>
                    )}
                </div>
            </div>

            {/* Trend chart */}
            <div className="mt-3 h-40 w-full">
                {isLoading ? (
                    <Skeleton className="h-full w-full rounded-md" />
                ) : chartData.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-1 text-neutral-400">
                        <TrendUp size={22} weight="duotone" />
                        <span className="text-xs">{t('emptyState')}</span>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: -12 }}>
                            <defs>
                                <linearGradient id="collectionFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="hsl(var(--success-500))" stopOpacity={0.28} />
                                    <stop offset="100%" stopColor="hsl(var(--success-500))" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                            <XAxis
                                dataKey="label"
                                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                                tickLine={false}
                                axisLine={false}
                                minTickGap={24}
                            />
                            <YAxis
                                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                                tickLine={false}
                                axisLine={false}
                                width={44}
                                tickFormatter={(v: number) =>
                                    v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`
                                }
                            />
                            <Tooltip
                                cursor={{ stroke: 'hsl(var(--success-500))', strokeWidth: 1, strokeOpacity: 0.3 }}
                                contentStyle={{
                                    borderRadius: 8,
                                    border: '1px solid hsl(var(--border))',
                                    fontSize: 12,
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                                }}
                                formatter={(v: number) => [money(v, currency), t('tooltip.collected')]}
                            />
                            <Area
                                type="monotone"
                                dataKey="amount"
                                stroke="hsl(var(--success-500))"
                                strokeWidth={2}
                                fill="url(#collectionFill)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </Card>
    );
}
