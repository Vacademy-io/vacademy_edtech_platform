import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { Icon } from '@phosphor-icons/react';
import {
    ArrowDownRight,
    ArrowRight,
    ArrowUpRight,
    CalendarCheck,
    ChartPieSlice,
    CheckCircle,
    Clock,
    Fire,
    Funnel,
    Lightbulb,
    ListChecks,
    Megaphone,
    PhoneCall,
    Siren,
    Timer,
    Trophy,
    UserPlus,
    Users,
    UsersThree,
    Warning,
    WarningCircle,
} from '@phosphor-icons/react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { MyTable, type TableData } from '@/components/design-system/table';
import { cn } from '@/lib/utils';
import type { ColumnDef } from '@tanstack/react-table';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { Avatar } from '@/routes/study-library/live-session/-components/dashboard/dashboard-highlights';
import type {
    CrmCallsBlock,
    CrmCounsellorRow,
    CrmFollowupsBlock,
    CrmListRow,
    CrmQualityBlock,
    CrmSourceRow,
    CrmSummaryBlock,
} from '../../-services/crm-dashboard';
import {
    AGE_BUCKETS,
    bestCallWindow,
    callsMatrix,
    formatMinutes,
    formatNumber,
    formatPercent,
    formatTalkTime,
    humanizeKey,
    pctChange,
    type CrmInsight,
    type CrmWindow,
    type PipelineStage,
} from '../../-utils/crm-dashboard';

const NS = 'crmDashboard';

export type Tint = 'primary' | 'info' | 'success' | 'warning' | 'danger';

const ICON_TINT: Record<Tint, string> = {
    primary: 'bg-primary-50 text-primary-500',
    info: 'bg-info-50 text-info-600',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-600',
    danger: 'bg-danger-50 text-danger-600',
};

const SPARK: Record<Tint, string> = {
    primary: 'hsl(var(--primary-500))',
    info: 'hsl(var(--info-500))',
    success: 'hsl(var(--success-500))',
    warning: 'hsl(var(--warning-500))',
    danger: 'hsl(var(--danger-500))',
};

/** Leads list links take calendar days for a custom range. */
export const recentLeadsLink = (w: CrmWindow, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ range: 'CUSTOM', from: w.fromDay, to: w.toDay, ...extra });
    return `/audience-manager/recent-leads?${q.toString()}`;
};

// ─── small pieces ──────────────────────────────────────────────────────────

/**
 * Link from a "path?query" href. The router does not read a query out of `to`,
 * so the query is split into `search` — the destination page then opens with
 * the same filter its own URL would carry.
 */
export function CrmLink({
    href,
    className,
    children,
}: {
    href: string;
    className?: string;
    children: React.ReactNode;
}) {
    const [path, qs] = href.split('?');
    const search = Object.fromEntries(new URLSearchParams(qs ?? ''));
    return (
        <Link to={path as never} search={search as never} className={className}>
            {children}
        </Link>
    );
}

export function DeltaChip({
    value,
    lowerIsBetter,
    title,
}: {
    value: number | null;
    lowerIsBetter?: boolean;
    title: string;
}) {
    if (value === null) return null;
    const up = value > 0;
    const flat = value === 0;
    const good = flat ? null : lowerIsBetter ? !up : up;
    const Arrow = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
    return (
        <span
            title={title}
            className={cn(
                'inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold tabular-nums',
                good === true && 'bg-success-50 text-success-700',
                good === false && 'bg-danger-50 text-danger-600',
                good === null && 'bg-neutral-100 text-neutral-600'
            )}
        >
            <Arrow size={12} weight="bold" />
            <span className="text-caption">{Math.abs(value)}%</span>
        </span>
    );
}

export function Sparkline({ values, tint, id }: { values: number[]; tint: Tint; id: string }) {
    if (values.length < 2) return null;
    const data = values.map((v, i) => ({ i, v }));
    const color = SPARK[tint];
    return (
        <div className="h-10 w-24 shrink-0" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id={`crmSpark-${id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <Area
                        isAnimationActive={false}
                        type="monotone"
                        dataKey="v"
                        stroke={color}
                        strokeWidth={2}
                        fill={`url(#crmSpark-${id})`}
                        dot={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

export function Meter({ value, max, tone }: { value: number; max: number; tone: Tint }) {
    const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
    const bar: Record<Tint, string> = {
        primary: '[&>div]:bg-primary-400',
        info: '[&>div]:bg-info-500',
        success: '[&>div]:bg-success-500',
        warning: '[&>div]:bg-warning-500',
        danger: '[&>div]:bg-danger-500',
    };
    return <Progress value={pct} className={cn('h-2 bg-neutral-100', bar[tone])} />;
}

function UnavailableCard({ title, icon }: { title: string; icon: Icon }) {
    const { t } = useTranslation(NS);
    return (
        <SectionCard title={title} icon={icon}>
            <EmptyChart text={t('common.unavailable')} className="h-32" />
        </SectionCard>
    );
}

// ─── hero ──────────────────────────────────────────────────────────────────

export function CrmHero({
    summary,
    window,
    rangeDays,
    rangeControl,
    actions,
    showContacted = false,
}: {
    summary: CrmSummaryBlock;
    window: CrmWindow;
    rangeDays: number;
    rangeControl: React.ReactNode;
    actions: React.ReactNode;
    /** Draw the "contacted" line (leads of that day already reached). */
    showContacted?: boolean;
}) {
    const { t } = useTranslation(NS);
    const growth = pctChange(summary.new_leads, summary.previous_new_leads);
    const rate = formatPercent(summary.converted, summary.new_leads);
    const data = useMemo(() => {
        const prev = summary.previous_daily_leads ?? [];
        const offset = prev.length - summary.daily.length;
        return summary.daily.map((d, i) => ({
            day: d.day.slice(5),
            leads: d.leads,
            contacted: d.contacted ?? null,
            converted: d.converted,
            previous: prev.length ? prev[i + offset] ?? null : null,
        }));
    }, [summary]);

    return (
        <Card className="overflow-hidden rounded-xl border-primary-100 bg-gradient-to-br from-primary-50 via-white to-white p-5 shadow-sm">
            <div className="grid gap-6 lg:grid-cols-12 lg:items-center">
                <div className="min-w-0 lg:col-span-4">
                    <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-primary-600">
                        <Fire size={14} weight="fill" />
                        <span className="text-caption">
                            {t('hero.eyebrow', { days: rangeDays })}
                        </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline gap-2">
                        <span className="font-bold tabular-nums text-neutral-900">
                            <span className="text-h1">{formatNumber(summary.new_leads)}</span>
                        </span>
                        <span className="text-neutral-500">
                            <span className="text-body">{t('hero.unit')}</span>
                        </span>
                        <DeltaChip value={growth} title={t('common.vsPrevious')} />
                    </div>
                    <p className="mt-2 text-neutral-600">
                        <span className="text-body">
                            {t('hero.sub', {
                                converted: formatNumber(summary.converted),
                                rate,
                            })}
                        </span>
                    </p>
                    {summary.previous_new_leads !== undefined && (
                        <p className="mt-1 text-neutral-500">
                            <span className="text-caption">
                                {t('hero.compare', {
                                    days: rangeDays,
                                    total: formatNumber(summary.previous_new_leads),
                                })}
                            </span>
                        </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">{actions}</div>
                </div>
                <div className="h-36 min-w-0 lg:col-span-6">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                            <defs>
                                <linearGradient id="crmHeroArea" x1="0" y1="0" x2="0" y2="1">
                                    <stop
                                        offset="0%"
                                        stopColor={SPARK.primary}
                                        stopOpacity={0.25}
                                    />
                                    <stop offset="100%" stopColor={SPARK.primary} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                            <XAxis
                                dataKey="day"
                                tickLine={false}
                                axisLine={false}
                                minTickGap={24}
                                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                            />
                            <Tooltip
                                formatter={(v: number, k: string) => [
                                    formatNumber(v),
                                    t(`hero.series.${k}`),
                                ]}
                            />
                            <Line
                                isAnimationActive={false}
                                type="monotone"
                                dataKey="previous"
                                stroke="hsl(var(--neutral-400))"
                                strokeDasharray="4 4"
                                dot={false}
                                connectNulls
                            />
                            <Area
                                isAnimationActive={false}
                                type="monotone"
                                dataKey="leads"
                                stroke={SPARK.primary}
                                strokeWidth={2}
                                fill="url(#crmHeroArea)"
                                dot={false}
                            />
                            {showContacted && (
                                <Line
                                    isAnimationActive={false}
                                    type="monotone"
                                    dataKey="contacted"
                                    stroke={SPARK.info}
                                    strokeWidth={2}
                                    dot={false}
                                    connectNulls
                                />
                            )}
                            <Line
                                isAnimationActive={false}
                                type="monotone"
                                dataKey="converted"
                                stroke={SPARK.success}
                                strokeWidth={2}
                                dot={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                    <div className="mt-1 flex flex-wrap gap-4 text-neutral-500">
                        {(showContacted
                            ? (['leads', 'contacted', 'converted', 'previous'] as const)
                            : (['leads', 'converted', 'previous'] as const)
                        ).map((k) => (
                            <span key={k} className="flex items-center gap-1.5">
                                <span
                                    className={cn(
                                        'size-2 rounded-full',
                                        k === 'leads' && 'bg-primary-500',
                                        k === 'contacted' && 'bg-info-500',
                                        k === 'converted' && 'bg-success-500',
                                        k === 'previous' && 'bg-neutral-400'
                                    )}
                                />
                                <span className="text-caption">{t(`hero.series.${k}`)}</span>
                            </span>
                        ))}
                    </div>
                </div>
                <div className="flex flex-col items-start gap-2 lg:col-span-2 lg:items-end">
                    {rangeControl}
                    <span className="text-neutral-500">
                        <span className="text-caption">
                            {window.fromDay} → {window.toDay}
                        </span>
                    </span>
                </div>
            </div>
        </Card>
    );
}

// ─── today strip ───────────────────────────────────────────────────────────

export function TodayStrip({
    followups,
    summary,
    calls,
    window,
}: {
    followups?: CrmFollowupsBlock;
    summary?: CrmSummaryBlock;
    calls?: CrmCallsBlock;
    window: CrmWindow;
}) {
    const { t } = useTranslation(NS);
    const items: Array<{
        key: string;
        icon: Icon;
        tone: 'danger' | 'warning' | 'neutral';
        value: string;
        detail: string;
        to: string;
    }> = [];
    if (followups) {
        items.push({
            key: 'overdue',
            icon: WarningCircle,
            tone: followups.overdue > 0 ? 'danger' : 'neutral',
            value: formatNumber(followups.overdue),
            detail: t('today.overdueDetail'),
            to: '/audience-manager/follow-ups?bucket=overdue',
        });
        items.push({
            key: 'dueToday',
            icon: CalendarCheck,
            tone: followups.today > 0 ? 'warning' : 'neutral',
            value: formatNumber(followups.today),
            detail:
                followups.completed_today !== undefined
                    ? t('today.closedToday', { count: followups.completed_today })
                    : t('today.dueTodayDetail'),
            to: '/audience-manager/follow-ups?bucket=today',
        });
        items.push({
            key: 'upcoming',
            icon: Clock,
            tone: 'neutral',
            value: formatNumber(followups.upcoming),
            detail: t('today.upcomingDetail'),
            to: '/audience-manager/follow-ups?bucket=upcoming',
        });
    }
    if (summary) {
        items.push({
            key: 'notContacted',
            icon: UserPlus,
            tone: 'neutral',
            value: formatNumber(Math.max(0, summary.new_leads - summary.contacted)),
            detail: t('today.notContactedDetail', { days: window.fromDay }),
            to: recentLeadsLink(window),
        });
    }
    if (calls && !calls.restricted && calls.total !== undefined) {
        items.push({
            key: 'calls',
            icon: PhoneCall,
            tone: 'neutral',
            value: formatNumber(calls.total),
            detail: t('today.callsDetail', {
                rate: formatPercent(calls.connected ?? 0, calls.total, 0),
            }),
            to: '/audience-manager/call-log',
        });
    }
    if (items.length === 0) return null;
    return (
        <Card className="grid grid-cols-2 overflow-hidden rounded-xl border-neutral-200 shadow-sm sm:grid-cols-3 xl:grid-cols-5">
            {items.map((it) => (
                <CrmLink
                    key={it.key}
                    href={it.to}
                    className="flex min-w-0 flex-col gap-1 border-b border-r border-neutral-100 p-4 transition-colors hover:bg-primary-50"
                >
                    <span className="flex items-center gap-1.5 text-neutral-500">
                        <it.icon size={14} />
                        <span className="text-caption">{t(`today.${it.key}`)}</span>
                    </span>
                    <span
                        className={cn(
                            'font-bold tabular-nums',
                            it.tone === 'danger' && 'text-danger-600',
                            it.tone === 'warning' && 'text-warning-700',
                            it.tone === 'neutral' && 'text-neutral-900'
                        )}
                    >
                        <span className="text-h2">{it.value}</span>
                    </span>
                    <span className="truncate text-neutral-500">
                        <span className="text-caption">{it.detail}</span>
                    </span>
                </CrmLink>
            ))}
        </Card>
    );
}

// ─── KPI row ───────────────────────────────────────────────────────────────

interface KpiProps {
    id: string;
    icon: Icon;
    tint: Tint;
    label: string;
    value: string;
    detail: string;
    delta?: number | null;
    lowerIsBetter?: boolean;
    spark?: number[];
    to?: string;
}

function KpiCard(p: KpiProps) {
    const { t } = useTranslation(NS);
    const body = (
        <Card className="flex h-full min-w-0 flex-col gap-3 rounded-xl border-neutral-200 p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center gap-2 text-neutral-600">
                <span
                    className={cn(
                        'flex size-8 items-center justify-center rounded-lg',
                        ICON_TINT[p.tint]
                    )}
                >
                    <p.icon size={16} weight="duotone" />
                </span>
                <span className="truncate font-medium">
                    <span className="text-caption">{p.label}</span>
                </span>
            </div>
            <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold tabular-nums text-neutral-900">
                            <span className="text-h2">{p.value}</span>
                        </span>
                        {p.delta !== undefined && (
                            <DeltaChip
                                value={p.delta ?? null}
                                lowerIsBetter={p.lowerIsBetter}
                                title={t('common.vsPrevious')}
                            />
                        )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-neutral-500">
                        <span className="text-caption">{p.detail}</span>
                    </p>
                </div>
                {p.spark && <Sparkline values={p.spark} tint={p.tint} id={p.id} />}
            </div>
        </Card>
    );
    return p.to ? (
        <CrmLink href={p.to} className="block h-full">
            {body}
        </CrmLink>
    ) : (
        body
    );
}

export function KpiRow({
    summary,
    followups,
    window,
}: {
    summary?: CrmSummaryBlock;
    followups?: CrmFollowupsBlock;
    window: CrmWindow;
}) {
    const { t } = useTranslation(NS);
    const cards: KpiProps[] = [];
    if (summary) {
        const leadsSpark = summary.daily.map((d) => d.leads);
        cards.push({
            id: 'newLeads',
            icon: Users,
            tint: 'primary',
            label: t('kpi.newLeads'),
            value: formatNumber(summary.new_leads),
            delta: pctChange(summary.new_leads, summary.previous_new_leads),
            detail: t('kpi.newLeadsDetail', {
                perDay: formatNumber(summary.new_leads / Math.max(1, summary.daily.length)),
            }),
            spark: leadsSpark,
            to: recentLeadsLink(window),
        });
        cards.push({
            id: 'firstResponse',
            icon: Timer,
            tint: 'info',
            label: t('kpi.firstResponse'),
            value: formatMinutes(summary.median_first_response_minutes),
            detail: t('kpi.firstResponseDetail', {
                share: formatPercent(summary.contacted, summary.new_leads, 0),
            }),
        });
        cards.push({
            id: 'converted',
            icon: CheckCircle,
            tint: 'success',
            label: t('kpi.converted'),
            value: formatNumber(summary.converted),
            delta: pctChange(summary.converted, summary.previous_converted),
            detail: t('kpi.convertedDetail', {
                rate: formatPercent(summary.converted, summary.new_leads),
            }),
            spark: summary.daily.map((d) => d.converted),
            to: recentLeadsLink(window, { status: '__CONVERTED__' }),
        });
    }
    if (followups) {
        cards.push({
            id: 'overdue',
            icon: Warning,
            tint: 'danger',
            label: t('kpi.overdue'),
            value: formatNumber(followups.overdue),
            detail: t('kpi.overdueDetail', { today: formatNumber(followups.today) }),
            to: '/audience-manager/follow-ups?bucket=overdue',
        });
    }
    if (cards.length === 0) return null;
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((c) => (
                <KpiCard key={c.id} {...c} />
            ))}
        </div>
    );
}

// ─── insights ──────────────────────────────────────────────────────────────

const INSIGHT_TONE: Record<CrmInsight['tone'], string> = {
    success: 'border-success-100 bg-success-50',
    danger: 'border-danger-100 bg-danger-50',
    warning: 'border-warning-100 bg-warning-50',
    info: 'border-info-100 bg-info-50',
};
const INSIGHT_ICON: Record<CrmInsight['tone'], Icon> = {
    success: Trophy,
    danger: Siren,
    warning: Clock,
    info: Lightbulb,
};

export function InsightsRow({ insights }: { insights: CrmInsight[] }) {
    const { t } = useTranslation(NS);
    if (insights.length === 0) return null;
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {insights.map((x) => {
                const I = INSIGHT_ICON[x.tone];
                return (
                    <CrmLink
                        key={x.id}
                        href={x.link}
                        className={cn(
                            'flex gap-3 rounded-xl border p-4 transition-shadow hover:shadow-md',
                            INSIGHT_TONE[x.tone]
                        )}
                    >
                        <span
                            className={cn(
                                'flex size-8 shrink-0 items-center justify-center rounded-lg bg-white',
                                ICON_TINT[x.tone === 'info' ? 'info' : x.tone]
                            )}
                        >
                            <I size={16} weight="duotone" />
                        </span>
                        <span className="min-w-0">
                            <span className="block font-semibold text-neutral-900">
                                <span className="text-body">{t(x.titleKey, x.values)}</span>
                            </span>
                            <span className="mt-0.5 block text-neutral-600">
                                <span className="text-caption">{t(x.textKey, x.values)}</span>
                            </span>
                        </span>
                    </CrmLink>
                );
            })}
        </div>
    );
}

// ─── pipeline + sources ────────────────────────────────────────────────────

/** Statuses shown before "Show all": the biggest ones, kept in pipeline order. */
const PIPELINE_COLLAPSED = 8;

export function PipelineCard({ stages, window }: { stages: PipelineStage[]; window: CrmWindow }) {
    const { t } = useTranslation(NS);
    const [expanded, setExpanded] = useState(false);
    // Empty statuses add rows and nothing to read, so they never show.
    const nonZero = useMemo(() => stages.filter((s) => s.count > 0), [stages]);
    const collapsible = nonZero.length > PIPELINE_COLLAPSED;
    const shownStages = useMemo(() => {
        if (!collapsible || expanded) return nonZero;
        const top = new Set(
            [...nonZero]
                .sort((a, b) => b.count - a.count)
                .slice(0, PIPELINE_COLLAPSED)
                .map((s) => s.key)
        );
        return nonZero.filter((s) => top.has(s.key));
    }, [nonZero, collapsible, expanded]);
    const hidden = nonZero.filter((s) => !shownStages.includes(s));
    const hiddenLeads = hidden.reduce((sum, s) => sum + s.count, 0);
    const max = Math.max(1, ...nonZero.map((s) => s.count));
    return (
        <SectionCard icon={Funnel} title={t('pipeline.title')} subtitle={t('pipeline.subtitle')}>
            {nonZero.length === 0 ? (
                <EmptyChart text={t('common.noLeads')} />
            ) : (
                <div className="space-y-0.5">
                    {shownStages.map((s) => (
                        <CrmLink
                            key={s.key}
                            href={recentLeadsLink(
                                window,
                                s.key === '__NO_STATUS__' ? {} : { status: s.key }
                            )}
                            className="grid grid-cols-12 items-center gap-3 rounded-lg px-2 py-1 hover:bg-neutral-50"
                        >
                            <span className="col-span-4 truncate text-neutral-700" title={s.label}>
                                <span className="text-caption">{s.label}</span>
                            </span>
                            <span className="col-span-6">
                                <Meter value={s.count} max={max} tone="primary" />
                            </span>
                            <span className="col-span-2 text-right font-semibold tabular-nums text-neutral-900">
                                <span className="text-caption">{formatNumber(s.count)}</span>
                            </span>
                        </CrmLink>
                    ))}
                    {collapsible && (
                        <div className="flex items-center justify-between gap-3 px-2 pt-2">
                            <span className="text-neutral-500">
                                <span className="text-caption">
                                    {expanded
                                        ? ''
                                        : t('pipeline.more', {
                                              count: hidden.length,
                                              leads: formatNumber(hiddenLeads),
                                          })}
                                </span>
                            </span>
                            <button
                                type="button"
                                onClick={() => setExpanded((v) => !v)}
                                className="shrink-0 font-medium text-primary-600 hover:text-primary-700"
                            >
                                <span className="text-caption">
                                    {expanded
                                        ? t('pipeline.showLess')
                                        : t('pipeline.showAll', { count: nonZero.length })}
                                </span>
                            </button>
                        </div>
                    )}
                </div>
            )}
        </SectionCard>
    );
}

export function SourcesCard({ rows }: { rows: CrmSourceRow[] }) {
    const { t } = useTranslation(NS);
    const max = Math.max(1, ...rows.map((r) => r.leads));
    return (
        <SectionCard
            icon={ChartPieSlice}
            title={t('sources.title')}
            subtitle={t('sources.subtitle')}
        >
            {rows.length === 0 ? (
                <EmptyChart text={t('common.noLeads')} />
            ) : (
                <div className="space-y-3">
                    {rows.map((r) => {
                        const rate = r.leads > 0 ? (r.converted / r.leads) * 100 : 0;
                        return (
                            <div key={r.source} className="space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate font-medium text-neutral-800">
                                        <span className="text-caption">
                                            {humanizeKey(r.source)}
                                        </span>
                                    </span>
                                    <span className="shrink-0 tabular-nums text-neutral-500">
                                        <span className="text-caption">
                                            {t('sources.row', {
                                                leads: formatNumber(r.leads),
                                                converted: formatNumber(r.converted),
                                                rate: rate.toFixed(1),
                                            })}
                                        </span>
                                    </span>
                                </div>
                                <Meter value={r.leads} max={max} tone="info" />
                            </div>
                        );
                    })}
                </div>
            )}
        </SectionCard>
    );
}

// ─── follow-up health + needs attention ────────────────────────────────────

export function FollowupHealthCard({
    followups,
    counsellors,
}: {
    followups: CrmFollowupsBlock;
    counsellors?: CrmCounsellorRow[];
}) {
    const { t } = useTranslation(NS);
    const tiles: Array<{ key: string; value: number | undefined; tone: string; bucket: string }> = [
        {
            key: 'overdue',
            value: followups.overdue,
            tone: 'bg-danger-50 text-danger-600',
            bucket: 'overdue',
        },
        {
            key: 'today',
            value: followups.today,
            tone: 'bg-warning-50 text-warning-700',
            bucket: 'today',
        },
        {
            key: 'upcoming',
            value: followups.upcoming,
            tone: 'bg-info-50 text-info-600',
            bucket: 'upcoming',
        },
        {
            key: 'closedToday',
            value: followups.completed_today,
            tone: 'bg-success-50 text-success-700',
            bucket: 'completed',
        },
    ];
    const overdueRows = (counsellors ?? [])
        .filter((c) => c.overdue > 0)
        .sort((a, b) => b.overdue - a.overdue)
        .slice(0, 6);
    const max = Math.max(1, ...overdueRows.map((r) => r.overdue));
    return (
        <SectionCard
            icon={ListChecks}
            title={t('followups.title')}
            subtitle={t('followups.subtitle')}
        >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {tiles
                    .filter((x) => x.value !== undefined)
                    .map((x) => (
                        <CrmLink
                            key={x.key}
                            href={`/audience-manager/follow-ups?bucket=${x.bucket}`}
                            className={cn('flex flex-col rounded-lg p-3', x.tone)}
                        >
                            <span className="font-bold tabular-nums">
                                <span className="text-h3">{formatNumber(x.value)}</span>
                            </span>
                            <span className="text-neutral-600">
                                <span className="text-caption">{t(`followups.${x.key}`)}</span>
                            </span>
                        </CrmLink>
                    ))}
            </div>
            {overdueRows.length > 0 && (
                <div className="mt-4 space-y-2">
                    <p className="text-neutral-500">
                        <span className="text-caption">{t('followups.byCounsellor')}</span>
                    </p>
                    {overdueRows.map((r) => (
                        <div key={r.owner_id} className="grid grid-cols-12 items-center gap-3">
                            <span className="col-span-4 truncate text-neutral-700">
                                <span className="text-caption">{r.name || '—'}</span>
                            </span>
                            <span className="col-span-7">
                                <Meter value={r.overdue} max={max} tone="danger" />
                            </span>
                            <span className="col-span-1 text-right font-semibold tabular-nums text-neutral-900">
                                <span className="text-caption">{r.overdue}</span>
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}

export interface AttentionItem {
    key: string;
    tone: 'danger' | 'warning' | 'info';
    title: string;
    text: string;
    to: string;
    cta: string;
}

export function AttentionCard({ items }: { items: AttentionItem[] }) {
    const { t } = useTranslation(NS);
    return (
        <SectionCard icon={Siren} title={t('attention.title')} subtitle={t('attention.subtitle')}>
            {items.length === 0 ? (
                <EmptyChart text={t('attention.allClear')} className="h-32" />
            ) : (
                <div className="divide-y divide-neutral-100">
                    {items.map((it) => (
                        <div key={it.key} className="flex items-center gap-3 py-2.5">
                            <span
                                className={cn(
                                    'flex size-8 shrink-0 items-center justify-center rounded-lg',
                                    ICON_TINT[it.tone]
                                )}
                            >
                                <WarningCircle size={16} weight="duotone" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-neutral-900">
                                    <span className="text-caption">{it.title}</span>
                                </span>
                                <span className="block truncate text-neutral-500">
                                    <span className="text-caption">{it.text}</span>
                                </span>
                            </span>
                            <CrmLink
                                href={it.to}
                                className="shrink-0 rounded-md border border-neutral-200 px-2.5 py-1 font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-600"
                            >
                                <span className="text-caption">{it.cta}</span>
                            </CrmLink>
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}

// ─── counsellors ───────────────────────────────────────────────────────────

const asTableData = <T,>(rows: T[]): TableData<T> => ({
    content: rows,
    total_pages: 1,
    page_no: 0,
    page_size: rows.length,
    total_elements: rows.length,
    last: true,
});

export function CounsellorsCard({ rows }: { rows: CrmCounsellorRow[] }) {
    const { t } = useTranslation(NS);
    const columns = useMemo<ColumnDef<CrmCounsellorRow>[]>(
        () => [
            {
                id: 'name',
                header: t('counsellors.col.name'),
                size: 220,
                cell: ({ row }) => (
                    <span className="flex items-center gap-2">
                        <Avatar
                            id={row.original.owner_id}
                            name={row.original.name}
                            className="size-7"
                        />
                        <span className="truncate font-medium text-neutral-900">
                            {row.original.name || '—'}
                        </span>
                    </span>
                ),
            },
            {
                id: 'assigned',
                header: t('counsellors.col.assigned'),
                size: 110,
                cell: ({ row }) => (
                    <span className="tabular-nums">
                        {formatNumber(row.original.assigned)}
                        <span className="block text-neutral-500">
                            <span className="text-caption">
                                {t('counsellors.contacted', {
                                    share: formatPercent(
                                        row.original.contacted,
                                        row.original.assigned,
                                        0
                                    ),
                                })}
                            </span>
                        </span>
                    </span>
                ),
            },
            {
                id: 'converted',
                header: t('counsellors.col.converted'),
                size: 110,
                cell: ({ row }) => (
                    <span className="tabular-nums">
                        <b>{formatNumber(row.original.converted)}</b>
                        <span className="block text-neutral-500">
                            <span className="text-caption">
                                {formatPercent(row.original.converted, row.original.assigned)}
                            </span>
                        </span>
                    </span>
                ),
            },
            {
                id: 'firstResponse',
                header: t('counsellors.col.firstResponse'),
                size: 110,
                cell: ({ row }) => {
                    const m = row.original.median_minutes;
                    return (
                        <span
                            className={cn(
                                'tabular-nums',
                                m === null && 'text-neutral-400',
                                m !== null && m > 120 && 'text-danger-600',
                                m !== null && m > 45 && m <= 120 && 'text-warning-700',
                                m !== null && m <= 45 && 'text-success-700'
                            )}
                        >
                            {formatMinutes(m)}
                        </span>
                    );
                },
            },
            {
                id: 'overdue',
                header: t('counsellors.col.overdue'),
                size: 90,
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'font-semibold tabular-nums',
                            row.original.overdue > 0 ? 'text-danger-600' : 'text-neutral-400'
                        )}
                    >
                        {formatNumber(row.original.overdue)}
                    </span>
                ),
            },
        ],
        [t]
    );
    return (
        <SectionCard
            icon={UsersThree}
            title={t('counsellors.title')}
            subtitle={t('counsellors.subtitle')}
            right={
                <CrmLink
                    href="/counsellors"
                    className="font-medium text-primary-600 hover:underline"
                >
                    <span className="text-caption">{t('common.viewAll')}</span>
                </CrmLink>
            }
        >
            {rows.length === 0 ? (
                <EmptyChart text={t('counsellors.empty')} />
            ) : (
                <MyTable<CrmCounsellorRow>
                    data={asTableData(rows.slice(0, 12))}
                    columns={columns}
                    isLoading={false}
                    error={null}
                    currentPage={0}
                    enableColumnResizing={false}
                    enableColumnPinning={false}
                    scrollable
                />
            )}
        </SectionCard>
    );
}

export function LeaderboardCard({ rows }: { rows: CrmCounsellorRow[] }) {
    const { t } = useTranslation(NS);
    const top = rows
        .filter((r) => r.converted > 0)
        .sort((a, b) => b.converted - a.converted)
        .slice(0, 5);
    const max = Math.max(1, ...top.map((r) => r.converted));
    return (
        <SectionCard
            icon={Trophy}
            title={t('leaderboard.title')}
            subtitle={t('leaderboard.subtitle')}
        >
            {top.length === 0 ? (
                <EmptyChart text={t('leaderboard.empty')} />
            ) : (
                <div className="space-y-3">
                    {top.map((r, i) => (
                        <div key={r.owner_id} className="flex items-center gap-3">
                            <span className="w-5 text-center font-semibold text-neutral-500">
                                <span className="text-caption">{i + 1}</span>
                            </span>
                            <Avatar id={r.owner_id} name={r.name} className="size-8" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-neutral-900">
                                    <span className="text-caption">{r.name || '—'}</span>
                                </span>
                                <Meter
                                    value={r.converted}
                                    max={max}
                                    tone={i === 0 ? 'success' : 'primary'}
                                />
                            </span>
                            <span className="shrink-0 font-semibold tabular-nums text-neutral-900">
                                <span className="text-caption">
                                    {t('leaderboard.joined', { count: r.converted })}
                                </span>
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </SectionCard>
    );
}

// ─── calls ─────────────────────────────────────────────────────────────────

const HEAT = [
    'bg-neutral-100',
    'bg-primary-100',
    'bg-primary-200',
    'bg-primary-300',
    'bg-primary-400',
    'bg-primary-500',
];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function CallsCard({ calls }: { calls: CrmCallsBlock }) {
    const { t } = useTranslation(NS);
    const matrix = useMemo(() => callsMatrix(calls), [calls]);
    const max = Math.max(1, ...matrix.flat());
    const best = bestCallWindow(matrix);
    if (calls.restricted) return <UnavailableCard title={t('calls.title')} icon={PhoneCall} />;
    const total = calls.total ?? 0;
    return (
        <SectionCard
            icon={PhoneCall}
            title={t('calls.title')}
            subtitle={t('calls.subtitle')}
            right={
                <CrmLink
                    href="/audience-manager/call-log"
                    className="font-medium text-primary-600 hover:underline"
                >
                    <span className="text-caption">{t('common.viewAll')}</span>
                </CrmLink>
            }
        >
            <div className="mb-4 grid grid-cols-3 gap-2">
                {[
                    [t('calls.dials'), formatNumber(total)],
                    [t('calls.connected'), formatPercent(calls.connected ?? 0, total, 0)],
                    [t('calls.talk'), formatTalkTime(calls.talk_seconds)],
                ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-neutral-100 p-3">
                        <span className="block font-bold tabular-nums text-neutral-900">
                            <span className="text-subtitle">{value}</span>
                        </span>
                        <span className="text-neutral-500">
                            <span className="text-caption">{label}</span>
                        </span>
                    </div>
                ))}
            </div>
            {total === 0 ? (
                <EmptyChart text={t('calls.empty')} className="h-32" />
            ) : (
                <div className="overflow-x-auto">
                    <div className="min-w-96 space-y-1">
                        {matrix.map((row, d) => (
                            <div key={d} className="flex items-center gap-1">
                                <span className="w-9 shrink-0 text-neutral-500">
                                    <span className="text-caption">
                                        {t(`weekday.${WEEKDAYS[d]}`)}
                                    </span>
                                </span>
                                {row.map((v, h) => (
                                    <span
                                        key={h}
                                        title={t('calls.cellTip', { count: v, hour: h })}
                                        className={cn(
                                            'h-4 flex-1 rounded-sm',
                                            HEAT[v === 0 ? 0 : Math.ceil((v / max) * 5)]
                                        )}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {best && (
                <p className="mt-3 text-neutral-600">
                    <span className="text-caption">
                        {t('calls.bestWindow', { from: best.from, to: best.to })}
                    </span>
                </p>
            )}
        </SectionCard>
    );
}

// ─── lists / campaigns ─────────────────────────────────────────────────────

export function ListsCard({ rows }: { rows: CrmListRow[] }) {
    const { t } = useTranslation(NS);
    const columns = useMemo<ColumnDef<CrmListRow>[]>(
        () => [
            {
                id: 'name',
                header: t('lists.col.name'),
                size: 240,
                cell: ({ row }) => (
                    <span className="min-w-0">
                        <span className="block truncate font-medium text-neutral-900">
                            {row.original.name || '—'}
                        </span>
                        <span className="block text-neutral-500">
                            <span className="text-caption">
                                {humanizeKey(row.original.campaign_type)}
                            </span>
                        </span>
                    </span>
                ),
            },
            {
                id: 'leads',
                header: t('lists.col.leads'),
                size: 90,
                cell: ({ row }) => (
                    <span className="tabular-nums">{formatNumber(row.original.leads)}</span>
                ),
            },
            {
                id: 'contacted',
                header: t('lists.col.contacted'),
                size: 100,
                cell: ({ row }) => (
                    <span className="tabular-nums">
                        {formatPercent(row.original.contacted, row.original.leads, 0)}
                    </span>
                ),
            },
            {
                id: 'converted',
                header: t('lists.col.converted'),
                size: 110,
                cell: ({ row }) => (
                    <span className="tabular-nums">
                        <b>{formatNumber(row.original.converted)}</b>{' '}
                        <span className="text-neutral-500">
                            <span className="text-caption">
                                {formatPercent(row.original.converted, row.original.leads)}
                            </span>
                        </span>
                    </span>
                ),
            },
        ],
        [t]
    );
    return (
        <SectionCard
            icon={Megaphone}
            title={t('lists.title')}
            subtitle={t('lists.subtitle')}
            right={
                <CrmLink
                    href="/audience-manager/list"
                    className="font-medium text-primary-600 hover:underline"
                >
                    <span className="text-caption">{t('common.viewAll')}</span>
                </CrmLink>
            }
        >
            {rows.length === 0 ? (
                <EmptyChart text={t('common.noLeads')} />
            ) : (
                <MyTable<CrmListRow>
                    data={asTableData(rows)}
                    columns={columns}
                    isLoading={false}
                    error={null}
                    currentPage={0}
                    enableColumnResizing={false}
                    enableColumnPinning={false}
                    scrollable
                />
            )}
        </SectionCard>
    );
}

// ─── lead quality ──────────────────────────────────────────────────────────

const TIER_TONE: Record<string, string> = {
    HOT: 'bg-danger-500',
    WARM: 'bg-warning-500',
    COLD: 'bg-info-500',
    NONE: 'bg-neutral-300',
};
const TIER_FALLBACK = [
    'bg-primary-500',
    'bg-success-500',
    'bg-primary-300',
    'bg-info-300',
    'bg-warning-300',
];
const AGE_TONE: Record<string, Tint> = {
    TODAY: 'success',
    D1_3: 'success',
    D4_7: 'warning',
    D8_14: 'warning',
    D15_PLUS: 'danger',
};

export function QualityCard({ block }: { block: CrmQualityBlock }) {
    const { t } = useTranslation(NS);
    const tierTotals = useMemo(() => {
        const m = new Map<string, number>();
        block.rows.forEach((r) => m.set(r.tier, (m.get(r.tier) ?? 0) + Number(r.n)));
        const order = [...block.tiers.map((x) => x.tier_key), 'HOT', 'WARM', 'COLD', 'NONE'];
        return [...m.entries()].sort((a, b) => {
            const ia = order.indexOf(a[0]);
            const ib = order.indexOf(b[0]);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
    }, [block]);
    const ageTotals = AGE_BUCKETS.map((a) => ({
        key: a,
        n: block.rows.filter((r) => r.age === a).reduce((s, r) => s + Number(r.n), 0),
    }));
    const total = tierTotals.reduce((s, [, n]) => s + n, 0);
    const maxAge = Math.max(1, ...ageTotals.map((a) => a.n));
    const label = (key: string) =>
        key === 'NONE'
            ? t('quality.notScored')
            : block.tiers.find((x) => x.tier_key === key)?.label || humanizeKey(key);
    return (
        <SectionCard icon={Fire} title={t('quality.title')} subtitle={t('quality.subtitle')}>
            {total === 0 ? (
                <EmptyChart text={t('common.noLeads')} />
            ) : (
                <>
                    <div className="flex h-3 overflow-hidden rounded-full bg-neutral-100">
                        {tierTotals.map(([k, n], i) => (
                            <span
                                key={k}
                                title={`${label(k)}: ${formatNumber(n)}`}
                                className={cn(
                                    'h-full',
                                    TIER_TONE[k] ?? TIER_FALLBACK[i % TIER_FALLBACK.length]
                                )}
                                style={{ width: `${(n / total) * 100}%` }} // design-lint-ignore: data-driven share of the bar
                            />
                        ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        {tierTotals.map(([k, n], i) => (
                            <span key={k} className="flex items-center gap-1.5 text-neutral-600">
                                <span
                                    className={cn(
                                        'size-2 rounded-sm',
                                        TIER_TONE[k] ?? TIER_FALLBACK[i % TIER_FALLBACK.length]
                                    )}
                                />
                                <span className="text-caption">
                                    {label(k)} <b className="tabular-nums">{formatNumber(n)}</b>
                                </span>
                            </span>
                        ))}
                    </div>
                    <p className="mb-2 mt-4 text-neutral-500">
                        <span className="text-caption">{t('quality.ageTitle')}</span>
                    </p>
                    <div className="space-y-2">
                        {ageTotals.map((a) => (
                            <div key={a.key} className="grid grid-cols-12 items-center gap-3">
                                <span className="col-span-3 text-neutral-700">
                                    <span className="text-caption">
                                        {t(`quality.age.${a.key}`)}
                                    </span>
                                </span>
                                <span className="col-span-7">
                                    <Meter
                                        value={a.n}
                                        max={maxAge}
                                        tone={AGE_TONE[a.key] ?? 'primary'}
                                    />
                                </span>
                                <span className="col-span-2 text-right font-semibold tabular-nums text-neutral-900">
                                    <span className="text-caption">{formatNumber(a.n)}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </SectionCard>
    );
}
