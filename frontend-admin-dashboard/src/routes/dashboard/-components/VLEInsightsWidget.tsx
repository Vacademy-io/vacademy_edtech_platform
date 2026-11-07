import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, ChartPieSlice, Armchair, TrendUp } from '@phosphor-icons/react';
import {
    PieChart,
    Pie,
    Cell,
    AreaChart,
    Area,
    XAxis,
    ResponsiveContainer,
    Tooltip,
} from 'recharts';
import {
    getSubOrgsWithDetails,
    type SubOrgListItem,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

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

const toTime = (v: string | number | null | undefined): number | null => {
    if (v == null) return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
};

const buildPlanMeta =
    (t: TFunction) =>
    (k: string): { label: string; color: string } => {
        switch (k) {
            case 'ACTIVE':
                return { label: t('planStatus.active'), color: 'hsl(var(--success-500))' };
            case 'PENDING':
                return { label: t('planStatus.pending'), color: 'hsl(var(--warning-500))' };
            case 'EXPIRED':
                return { label: t('planStatus.expired'), color: 'hsl(var(--danger-500))' };
            case 'INACTIVE':
                return { label: t('planStatus.inactive'), color: 'hsl(var(--muted-foreground))' };
            case 'NONE':
                return { label: t('planStatus.none'), color: 'hsl(var(--muted-foreground))' };
            default:
                return {
                    label: k.charAt(0) + k.slice(1).toLowerCase(),
                    color: 'hsl(var(--info-500))',
                };
        }
    };

/**
 * PARENT-admin VLE network analytics in one card: plan-status mix (donut),
 * network seat utilisation (bar) and registration growth (area). All derived
 * from the shared getSubOrgsWithDetails list (same cache key as Manage VLEs /
 * the snapshot + geography widgets — one fetch). Hides when there are no VLEs.
 */
export default function VLEInsightsWidget() {
    const navigate = useNavigate();
    const instituteId = getCurrentInstituteId();
    const { t } = useTranslation('dashboardVLEInsightsWidget');
    const planMeta = useMemo(() => buildPlanMeta(t), [t]);
    const months = useMemo(() => buildMonths(t), [t]);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['sub-orgs-with-details', instituteId],
        queryFn: () => getSubOrgsWithDetails(instituteId || undefined),
        enabled: !!instituteId,
        staleTime: 5 * 60_000,
        retry: false,
    });
    const items = useMemo<SubOrgListItem[]>(() => data?.content ?? [], [data]);

    const plan = useMemo(() => {
        const m = new Map<string, number>();
        for (const it of items) {
            const key = (it.plan_status ?? '').toUpperCase().trim() || 'NONE';
            m.set(key, (m.get(key) ?? 0) + 1);
        }
        return [...m.entries()]
            .map(([k, value]) => ({ key: k, value, ...planMeta(k) }))
            .sort((a, b) => b.value - a.value);
    }, [items, planMeta]);

    const seats = useMemo(() => {
        let used = 0;
        let total = 0;
        for (const it of items) {
            used += it.used_seats ?? 0;
            total += it.total_seats ?? 0;
        }
        return { used, total, pct: total > 0 ? Math.round((used / total) * 100) : 0 };
    }, [items]);

    const growth = useMemo(() => {
        // Last 6 calendar months of new registrations.
        const buckets = new Map<string, number>();
        for (const it of items) {
            const t = toTime(it.created_at);
            if (t == null) continue;
            const d = new Date(t);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
        const now = new Date();
        const out: { label: string; count: number }[] = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            out.push({ label: months[d.getMonth()] ?? '', count: buckets.get(key) ?? 0 });
        }
        return out;
    }, [items, months]);

    const plural = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const totalPlan = plan.reduce((s, p) => s + p.value, 0);

    if (isError || (!isLoading && items.length === 0)) return null;

    return (
        <Card className="p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                        <ChartPieSlice size={14} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <h3 className="line-clamp-1 text-sm font-semibold text-neutral-900">
                            {t('heading', { plural })}
                        </h3>
                        <p className="line-clamp-1 text-xs text-neutral-500">{t('subtitle')}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => navigate({ to: '/manage-custom-teams' })}
                    className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
                >
                    {t('manage')}
                    <ArrowRight size={12} weight="bold" />
                </button>
            </div>

            {isLoading ? (
                <Skeleton className="h-44 w-full rounded-md" />
            ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    {/* Plan status donut */}
                    <div className="rounded-lg border border-neutral-200 p-3">
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                            <ChartPieSlice size={13} weight="duotone" className="text-violet-500" />
                            {t('planStatus.title')}
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="h-24 w-24 shrink-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={plan}
                                            dataKey="value"
                                            nameKey="label"
                                            innerRadius={26}
                                            outerRadius={44}
                                            paddingAngle={2}
                                            stroke="hsl(var(--card))"
                                            strokeWidth={2}
                                        >
                                            {plan.map((p) => (
                                                <Cell key={p.key} fill={p.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{
                                                borderRadius: 8,
                                                border: '1px solid hsl(var(--border))',
                                                fontSize: 12,
                                            }}
                                            formatter={(v: number, n: string) => [nfmt(v), n]}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                                {plan.slice(0, 4).map((p) => (
                                    <div
                                        key={p.key}
                                        className="flex items-center justify-between gap-2 text-xs"
                                    >
                                        <span className="flex min-w-0 items-center gap-1.5 text-neutral-600">
                                            <span
                                                className="size-2 shrink-0 rounded-full"
                                                style={{ backgroundColor: p.color }}
                                            />
                                            <span className="line-clamp-1">{p.label}</span>
                                        </span>
                                        <span className="shrink-0 font-semibold tabular-nums text-neutral-800">
                                            {p.value}
                                            <span className="ml-1 font-normal text-neutral-400">
                                                {totalPlan > 0
                                                    ? `${Math.round((p.value / totalPlan) * 100)}%`
                                                    : ''}
                                            </span>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Seat utilization */}
                    <div className="flex flex-col rounded-lg border border-neutral-200 p-3">
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                            <Armchair size={13} weight="duotone" className="text-amber-500" />
                            {t('seatUtilization.title')}
                        </div>
                        <div className="mt-1 flex items-baseline gap-1.5">
                            <span className="text-2xl font-semibold tabular-nums text-neutral-900">
                                {seats.pct}%
                            </span>
                            <span className="text-xs text-neutral-500">
                                {t('seatUtilization.seatsFraction', {
                                    used: nfmt(seats.used),
                                    total: nfmt(seats.total),
                                })}
                            </span>
                        </div>
                        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
                            <div
                                className="h-full rounded-full bg-amber-400"
                                style={{ width: `${Math.min(seats.pct, 100)}%` }}
                            />
                        </div>
                        <p className="mt-2 text-xs text-neutral-500">
                            {t('seatUtilization.seatsAvailable', {
                                count: Math.max(seats.total - seats.used, 0),
                                formatted: nfmt(Math.max(seats.total - seats.used, 0)),
                            })}
                        </p>
                    </div>

                    {/* Registration growth */}
                    <div className="flex flex-col rounded-lg border border-neutral-200 p-3">
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                            <TrendUp size={13} weight="duotone" className="text-emerald-500" />
                            {t('growth.title')}
                        </div>
                        <div className="min-h-0 flex-1">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart
                                    data={growth}
                                    margin={{ top: 6, right: 4, bottom: 0, left: 4 }}
                                >
                                    <defs>
                                        <linearGradient id="vleGrowthFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="hsl(var(--success-500))" stopOpacity={0.3} />
                                            <stop offset="100%" stopColor="hsl(var(--success-500))" stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis
                                        dataKey="label"
                                        tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: 8,
                                            border: '1px solid hsl(var(--border))',
                                            fontSize: 12,
                                        }}
                                        formatter={(v: number) => [
                                            nfmt(v),
                                            t('growth.tooltipLabel', { plural }),
                                        ]}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="count"
                                        stroke="hsl(var(--success-500))"
                                        strokeWidth={2}
                                        fill="url(#vleGrowthFill)"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}
