import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, MapPin, MapTrifold, Buildings, Signpost } from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell } from 'recharts';
import {
    getSubOrgsWithDetails,
    type SubOrgListItem,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn } from '@/lib/utils';
import IndiaStateMap, { normalizeState } from './IndiaStateMap';

type GeoDim = 'state' | 'city' | 'pincode';

interface GeoGroup {
    key: string;
    label: string;
    count: number;
    active: number;
    usedSeats: number;
    totalSeats: number;
}

const NONE_KEY = '__none__';
const nfmt = (n: number) => n.toLocaleString('en-IN');
const norm = (s: string | null | undefined): string => (s ?? '').trim();

// Registration-date filter for the VLE list (by created_at). 'all' = no filter.
type GeoRange = 'all' | '24h' | '3d' | '7d' | 'custom';
const buildGeoRanges = (t: TFunction): { key: GeoRange; label: string; days: number | null }[] => [
    { key: 'all', label: t('dateRange.all'), days: null },
    { key: '24h', label: t('dateRange.last24h'), days: 1 },
    { key: '3d', label: t('dateRange.last3d'), days: 3 },
    { key: '7d', label: t('dateRange.last7d'), days: 7 },
    { key: 'custom', label: t('dateRange.custom'), days: null },
];

/** Parse a created_at that may be an ISO string or an epoch (s or ms) → millis. */
const toTime = (v: string | number | null | undefined): number | null => {
    if (v == null) return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
};

const buildDims = (t: TFunction): { key: GeoDim; label: string }[] => [
    { key: 'state', label: t('dims.state') },
    { key: 'city', label: t('dims.city') },
    { key: 'pincode', label: t('dims.pincode') },
];

const pick = (it: SubOrgListItem, dim: GeoDim): string =>
    dim === 'state' ? norm(it.state) : dim === 'city' ? norm(it.city) : norm(it.pincode);

function aggregate(items: SubOrgListItem[], dim: GeoDim, t: TFunction): GeoGroup[] {
    const map = new Map<string, GeoGroup>();
    for (const it of items) {
        const raw = pick(it, dim);
        const key = raw.length ? raw : NONE_KEY;
        const g =
            map.get(key) ??
            { key, label: key === NONE_KEY ? t('notSpecified') : raw, count: 0, active: 0, usedSeats: 0, totalSeats: 0 };
        g.count += 1;
        if (norm(it.status).toUpperCase() === 'ACTIVE') g.active += 1;
        g.usedSeats += it.used_seats ?? 0;
        g.totalSeats += it.total_seats ?? 0;
        map.set(key, g);
    }
    // Real locations first (by count), "Not specified" always last.
    return [...map.values()].sort((a, b) => {
        if (a.key === NONE_KEY) return 1;
        if (b.key === NONE_KEY) return -1;
        return b.count - a.count;
    });
}

// Categorical palette from the design-system semantic scales (theme-aware).
const BAR_COLORS = [
    'hsl(var(--primary-500))',
    'hsl(var(--info-500))',
    'hsl(var(--success-500))',
    'hsl(var(--warning-500))',
    'hsl(var(--danger-500))',
    'hsl(var(--primary-400))',
    'hsl(var(--info-400))',
    'hsl(var(--success-400))',
];

interface MiniStat {
    label: string;
    value: string;
    Icon: typeof MapPin;
    iconBg: string;
    iconColor: string;
}

/**
 * PARENT-admin view: where the institute's sub-orgs are located, grouped by
 * state / city / pincode. KPI mini-stats + a top-locations bar chart + a full
 * breakdown table. Data is the same `getSubOrgsWithDetails` list the Manage VLEs
 * page uses (shared cache key), whose rows carry the spawned org's address.
 * Sub-orgs whose registration link never collected an address fall into a
 * "Not specified" bucket. Hides when the institute has no sub-orgs.
 */
export default function SubOrgGeographyWidget() {
    const { t } = useTranslation('dashboardSubOrgGeographyWidget');
    const navigate = useNavigate();
    const instituteId = getCurrentInstituteId();
    const [dim, setDim] = useState<GeoDim>('state');
    const [range, setRange] = useState<GeoRange>('all');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');

    const DIMS = useMemo(() => buildDims(t), [t]);
    const GEO_RANGES = useMemo(() => buildGeoRanges(t), [t]);
    const topLocationsLabels: Record<GeoDim, string> = useMemo(
        () => ({
            state: t('topLocations.state'),
            city: t('topLocations.city'),
            pincode: t('topLocations.pincode'),
        }),
        [t]
    );

    const { data, isLoading, isError } = useQuery({
        queryKey: ['sub-orgs-with-details', instituteId],
        queryFn: () => getSubOrgsWithDetails(instituteId || undefined),
        enabled: !!instituteId,
        staleTime: 5 * 60_000,
        retry: false,
    });

    const items = useMemo<SubOrgListItem[]>(() => data?.content ?? [], [data]);

    // Apply the registration-date filter. 'all' passes everything through.
    const filteredItems = useMemo(() => {
        if (range === 'all') return items;
        let start = -Infinity;
        let end = Infinity;
        if (range === 'custom') {
            if (customFrom) start = new Date(`${customFrom}T00:00:00`).getTime();
            if (customTo) end = new Date(`${customTo}T23:59:59`).getTime();
        } else {
            const days = GEO_RANGES.find((r) => r.key === range)?.days ?? 1;
            start = Date.now() - days * 86_400_000;
        }
        return items.filter((it) => {
            const ts = toTime(it.created_at);
            return ts != null && ts >= start && ts <= end;
        });
    }, [items, range, customFrom, customTo, GEO_RANGES]);

    const groups = useMemo(() => aggregate(filteredItems, dim, t), [filteredItems, dim, t]);
    // Sub-org count per (normalized) state — drives the India choropleth.
    const stateCounts = useMemo(() => {
        const m = new Map<string, number>();
        for (const it of filteredItems) {
            const key = normalizeState(pick(it, 'state'));
            if (key) m.set(key, (m.get(key) ?? 0) + 1);
        }
        return m;
    }, [filteredItems]);

    const stats = useMemo<MiniStat[]>(() => {
        const distinct = (d: GeoDim) =>
            new Set(filteredItems.map((i) => pick(i, d)).filter((v) => v.length)).size;
        const located = filteredItems.filter(
            (i) => pick(i, 'state') || pick(i, 'city') || pick(i, 'pincode')
        ).length;
        return [
            { label: t('stats.states'), value: nfmt(distinct('state')), Icon: MapTrifold, iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600' },
            { label: t('stats.cities'), value: nfmt(distinct('city')), Icon: Buildings, iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
            { label: t('stats.pincodes'), value: nfmt(distinct('pincode')), Icon: Signpost, iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600' },
            { label: t('stats.located'), value: `${nfmt(located)}/${nfmt(filteredItems.length)}`, Icon: MapPin, iconBg: 'bg-amber-100', iconColor: 'text-amber-600' },
        ];
    }, [filteredItems, t]);

    const subOrgPlural = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);

    // Hide entirely when there are no sub-orgs (matches SubOrgOverviewWidget).
    if (isError || (!isLoading && items.length === 0)) return null;

    const chartData = groups.slice(0, 8).map((g) => ({ label: g.label, count: g.count }));

    return (
        <Card className="p-4 shadow-sm">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                        <MapPin size={14} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <h3 className="line-clamp-1 text-sm font-semibold text-neutral-900">
                            {t('header.title', { term: subOrgPlural })}
                        </h3>
                        <p className="line-clamp-1 text-xs text-neutral-500">
                            {t('header.subtitle', { term: subOrgPlural })}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div
                        role="group"
                        aria-label={t('groupBy.ariaLabel')}
                        className="flex shrink-0 items-center gap-0.5 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5"
                    >
                        {DIMS.map((d) => (
                            <button
                                key={d.key}
                                type="button"
                                onClick={() => setDim(d.key)}
                                aria-pressed={dim === d.key}
                                className={cn(
                                    'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                                    dim === d.key
                                        ? 'bg-primary-500 text-white shadow-sm'
                                        : 'text-neutral-600 hover:bg-neutral-100'
                                )}
                            >
                                {d.label}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate({ to: '/manage-custom-teams' })}
                        className="hidden shrink-0 items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 sm:flex"
                    >
                        {t('manage')}
                        <ArrowRight size={12} weight="bold" />
                    </button>
                </div>
            </div>

            {/* Registration-date filter */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-neutral-500">{t('registered')}</span>
                <div
                    role="group"
                    aria-label={t('dateRange.ariaLabel')}
                    className="flex shrink-0 items-center gap-0.5 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5"
                >
                    {GEO_RANGES.map((r) => (
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
                            {r.label}
                        </button>
                    ))}
                </div>
                {range === 'custom' && (
                    <div className="flex items-center gap-1.5">
                        <input
                            type="date"
                            value={customFrom}
                            max={customTo || undefined}
                            onChange={(e) => setCustomFrom(e.target.value)}
                            aria-label={t('dateRange.fromDate')}
                            className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 focus:border-primary-400 focus:outline-none"
                        />
                        <span className="text-xs text-neutral-400">{t('dateRange.to')}</span>
                        <input
                            type="date"
                            value={customTo}
                            min={customFrom || undefined}
                            onChange={(e) => setCustomTo(e.target.value)}
                            aria-label={t('dateRange.toDate')}
                            className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 focus:border-primary-400 focus:outline-none"
                        />
                    </div>
                )}
            </div>

            {/* KPI mini-stats */}
            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                {stats.map((s) => {
                    const Icon = s.Icon;
                    return (
                        <div
                            key={s.label}
                            className="flex items-center gap-2.5 rounded-lg border border-neutral-200 p-2.5"
                        >
                            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', s.iconBg)}>
                                <Icon size={16} weight="duotone" className={s.iconColor} />
                            </span>
                            <div className="min-w-0">
                                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                    {s.label}
                                </div>
                                {isLoading ? (
                                    <Skeleton className="mt-0.5 h-4 w-10" />
                                ) : (
                                    <div className="text-base font-semibold tabular-nums text-neutral-900">
                                        {s.value}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Chart + table */}
            {isLoading ? (
                <Skeleton className="mt-4 h-56 w-full rounded-md" />
            ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {/* State view → India choropleth; City/Pincode → top-locations bar */}
                    <div className="h-56 w-full">
                        {dim === 'state' ? (
                            <IndiaStateMap counts={stateCounts} subOrgPlural={subOrgPlural} />
                        ) : (
                            <>
                        <div className="mb-1 text-xs font-medium text-neutral-500">
                            {topLocationsLabels[dim]}
                        </div>
                        <ResponsiveContainer width="100%" height="90%">
                            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                                <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <YAxis
                                    type="category"
                                    dataKey="label"
                                    width={92}
                                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip
                                    cursor={{ fill: 'hsl(var(--muted-foreground) / 0.08)' }}
                                    contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                                    formatter={(v: number) => [nfmt(v), subOrgPlural]}
                                />
                                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22}>
                                    {chartData.map((entry, i) => (
                                        <Cell key={entry.label} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                            </>
                        )}
                    </div>

                    {/* Breakdown table */}
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-neutral-200">
                        <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-neutral-50 text-neutral-500">
                                <tr>
                                    <th className="px-3 py-2 font-medium">
                                        {DIMS.find((d) => d.key === dim)?.label}
                                    </th>
                                    <th className="px-3 py-2 text-right font-medium">{subOrgPlural}</th>
                                    <th className="px-3 py-2 text-end font-medium">{t('table.active')}</th>
                                    <th className="px-3 py-2 text-end font-medium">{t('table.seats')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {groups.map((g) => (
                                    <tr key={g.key} className="border-t border-neutral-100">
                                        <td className="px-3 py-2 text-neutral-800">
                                            <span className="line-clamp-1">{g.label}</span>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-neutral-900">{nfmt(g.count)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-success-600">{nfmt(g.active)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-neutral-600">
                                            {g.totalSeats > 0 ? `${nfmt(g.usedSeats)}/${nfmt(g.totalSeats)}` : nfmt(g.usedSeats)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </Card>
    );
}
