/**
 * AI Intelligence (Leads → AI Intelligence) — a date-wise, comparison-first view
 * of call-quality intelligence, built to *show progress over time*:
 *
 *   1. TEAM INSIGHTS (first block): whole-team KPIs (analyzed calls, avg caller
 *      self-goal rating, avg call-output rating, positive sentiment) — each with
 *      the delta vs the immediately-preceding equal-length window ("+0.6 vs prev")
 *      so a manager can see "this improved". Followed by whole-team coaching.
 *   2. COUNSELLOR BREAKDOWN: one row per rep — analyzed calls, both ratings,
 *      leads dispositioned and calling reach, each with its own vs-previous delta,
 *      expandable to "what they can improve" (their coaching from transcripts).
 *
 * RBAC: every source here is server-scoped to the caller's descendants — the team
 * analytics/coaching endpoints resolve `descendantUserIdsForCaller`, and the
 * dispositions report is scoped by the caller too. A manager sees only their
 * own reports; the per-counsellor set shown is exactly that scoped roster.
 *
 * Read-only. No new endpoints: current + previous windows are two calls each and
 * the deltas are computed here.
 */
import { SkillRadarCard } from './SkillRadarCard';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Icon } from '@phosphor-icons/react';
import {
    Sparkle,
    UsersThree,
    TrendUp,
    TrendDown,
    Minus,
    CaretDown,
    CaretRight,
    Target,
    Lightbulb,
    ChartLineUp,
    ArrowsLeftRight,
    Phone,
    PhoneCall,
    Smiley,
    CheckCircle,
    User,
    ArrowsClockwise,
    ArrowsInLineVertical,
    ArrowsOutLineVertical,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    TeamCoachingSection,
    useCallIntelligenceEnabled,
    useHasCallIntelligenceData,
    fetchTeamCallIntelligence,
    type CallIntelligenceAnalyticsDto,
} from '@/components/shared/leads';
import {
    fetchCounsellorCoaching,
    fetchTeamCoaching,
    type CallIntelligenceCoachingDto,
} from '@/components/shared/leads/services/call-intelligence';
import { fetchDispositions, type DispositionReport } from '../../reports/-services/get-crm-reports';

// ── Time windows ────────────────────────────────────────────────────────────
interface Win {
    from: number;
    to: number;
    fromDate: string;
    toDate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESETS = [7, 30, 90] as const;

/** The selected period — a rolling preset, or an explicit custom range. */
type Period = { kind: 'preset'; days: number } | { kind: 'custom'; fromMs: number; toMs: number };

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const mkWin = (from: number, to: number): Win => ({
    from,
    to,
    fromDate: toDateStr(from),
    toDate: toDateStr(to),
});

/**
 * The current window plus the immediately-preceding equal-length window we
 * compare it against — this is what makes "improved vs previous" meaningful.
 */
function windowsFor(period: Period): { current: Win; previous: Win } {
    if (period.kind === 'preset') {
        const now = Date.now();
        const curFrom = now - period.days * DAY_MS;
        return {
            current: mkWin(curFrom, now),
            previous: mkWin(curFrom - period.days * DAY_MS, curFrom),
        };
    }
    const len = Math.max(DAY_MS, period.toMs - period.fromMs);
    return {
        current: mkWin(period.fromMs, period.toMs),
        previous: mkWin(period.fromMs - len, period.fromMs),
    };
}

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
const buildFmtDay =
    (t: TFunction) =>
    (ms: number): string => {
        const d = new Date(ms);
        return `${d.getDate()} ${buildMonths(t)[d.getMonth()]}`;
    };
const buildFmtRange =
    (t: TFunction) =>
    (w: Win): string => {
        const fmtDay = buildFmtDay(t);
        return `${fmtDay(w.from)} – ${fmtDay(w.to)}`;
    };

// ── Delta helpers (all metrics here are "higher is better") ─────────────────
function Delta({
    current,
    previous,
    digits = 1,
    suffix = '',
}: {
    current: number | null | undefined;
    previous: number | null | undefined;
    digits?: number;
    suffix?: string;
}) {
    const { t } = useTranslation('audienceManagerAiIntelligencePage');
    if (current == null || previous == null) return null;
    const diff = current - previous;
    const eps = digits > 0 ? 0.05 : 0.5;
    if (Math.abs(diff) < eps) {
        return (
            <span className="inline-flex items-center gap-0.5 text-caption text-neutral-400">
                <Minus size={12} /> {t('delta.noChange')}
            </span>
        );
    }
    const up = diff > 0;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-0.5 text-caption font-medium',
                up ? 'text-success-700' : 'text-danger-600'
            )}
        >
            {up ? <TrendUp size={12} /> : <TrendDown size={12} />}
            {up ? '+' : ''}
            {diff.toFixed(digits)}
            {suffix}
        </span>
    );
}

const KPI_TINT = {
    primary: 'bg-primary-50 text-primary-500',
    info: 'bg-info-50 text-info-600',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-600',
} as const;

function KpiDeltaCard({
    label,
    value,
    previous,
    digits = 1,
    suffix = '',
    icon: IconCmp,
    tint = 'primary',
    detail,
}: {
    label: string;
    value: number | null | undefined;
    previous: number | null | undefined;
    digits?: number;
    suffix?: string;
    icon: Icon;
    tint?: keyof typeof KPI_TINT;
    detail?: string;
}) {
    const { t } = useTranslation('audienceManagerAiIntelligencePage');
    const fmt = (v: number | null | undefined) =>
        v == null ? '—' : `${v.toFixed(digits)}${suffix}`;
    return (
        <Card className="flex min-w-0 flex-col gap-2 rounded-xl border-neutral-200 p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center gap-2 text-neutral-600">
                <span
                    className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-lg',
                        KPI_TINT[tint]
                    )}
                >
                    <IconCmp size={16} weight="duotone" />
                </span>
                <span className="truncate text-caption font-medium">{label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-h2 font-semibold tabular-nums text-neutral-900">
                    {fmt(value)}
                </span>
                <Delta current={value} previous={previous} digits={digits} suffix={suffix} />
            </div>
            <p className="text-caption text-neutral-500">
                {[detail, previous != null ? t('kpi.was', { value: fmt(previous) }) : '']
                    .filter(Boolean)
                    .join(' · ')}
            </p>
        </Card>
    );
}

// ── Sentiment helper ─────────────────────────────────────────────────────────
function positivePct(dist: Record<string, number> | undefined): number | null {
    if (!dist) return null;
    const total = Object.values(dist).reduce((s, n) => s + n, 0);
    if (total === 0) return null;
    const pos = Object.entries(dist)
        .filter(([k]) => /pos/i.test(k))
        .reduce((s, [, n]) => s + n, 0);
    return Math.round((pos / total) * 100);
}

// ── Day-to-day activity aggregation (from the dispositions report) ──────────
interface TeamActivity {
    dispositioned: number; // total lead status changes
    calls: number; // total dials
    reach: number | null; // connected / dials %
}
function aggregateActivity(disp: DispositionReport | undefined): TeamActivity {
    if (!disp) return { dispositioned: 0, calls: 0, reach: null };
    const dispositioned = (disp.rows ?? [])
        .filter((r) => r.user_id !== 'SYSTEM')
        .reduce((s, r) => s + r.total_changes, 0);
    let calls = 0;
    let connected = 0;
    for (const c of disp.call_outcomes ?? []) {
        if (c.user_id === 'SYSTEM') continue;
        for (const [k, n] of Object.entries(c.outcomes)) {
            calls += n;
            if (k === 'COMPLETED') connected += n;
        }
    }
    return {
        dispositioned,
        calls,
        reach: calls > 0 ? Math.round((connected / calls) * 100) : null,
    };
}

// ── "What improved" summary (top movers between the two windows) ────────────
interface Mover {
    label: string;
    cur: number | null;
    prev: number | null;
    digits: number;
    suffix: string;
}
function significantMovers(movers: Mover[]): { improved: Mover[]; declined: Mover[] } {
    const improved: Mover[] = [];
    const declined: Mover[] = [];
    for (const m of movers) {
        if (m.cur == null || m.prev == null) continue;
        const diff = m.cur - m.prev;
        const eps = m.digits > 0 ? 0.05 : 0.5;
        if (Math.abs(diff) < eps) continue;
        (diff > 0 ? improved : declined).push(m);
    }
    const mag = (m: Mover) => Math.abs((m.cur ?? 0) - (m.prev ?? 0));
    improved.sort((a, b) => mag(b) - mag(a));
    declined.sort((a, b) => mag(b) - mag(a));
    return { improved: improved.slice(0, 4), declined: declined.slice(0, 4) };
}

/**
 * A natural-language read of the period, grounded in the AI-generated coaching
 * output (top coaching theme / most-hit objection) plus the quantitative movers.
 * Returns null when there's no analyzed-call data to summarize — the caller then
 * falls back to the plain mover chips.
 */
const buildAiSummary =
    (t: TFunction) =>
    (movers: Mover[], coaching: CallIntelligenceCoachingDto | undefined): string | null => {
        if (!coaching || coaching.totalAnalyzed === 0) return null;
        const phrase = (m: Mover) => {
            const diff = (m.cur ?? 0) - (m.prev ?? 0);
            return `${m.label.toLowerCase()} ${diff > 0 ? '+' : ''}${diff.toFixed(m.digits)}${m.suffix}`;
        };
        const { improved, declined } = significantMovers(movers);
        const parts: string[] = [];
        if (improved.length > 0) {
            parts.push(
                t('teamInsights.aiSummary.improved', {
                    list: improved.slice(0, 3).map(phrase).join(', '),
                })
            );
        }
        if (declined.length > 0) {
            parts.push(
                t('teamInsights.aiSummary.watch', {
                    list: declined.slice(0, 2).map(phrase).join(', '),
                })
            );
        }
        const topTip = coaching.topCoachingTips?.[0]?.text;
        const topObj = coaching.topObjections?.[0]?.objection;
        if (topTip) {
            parts.push(t('teamInsights.aiSummary.coachingFocus', { tip: topTip }));
        } else if (topObj) {
            parts.push(t('teamInsights.aiSummary.mostHitObjection', { objection: topObj }));
        }
        return parts.length > 0 ? parts.join(' ') : null;
    };

function MoverChip({ m, up }: { m: Mover; up: boolean }) {
    const diff = (m.cur ?? 0) - (m.prev ?? 0);
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-caption font-medium',
                up ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-600'
            )}
        >
            {up ? <TrendUp size={13} /> : <TrendDown size={13} />}
            {m.label}
            <span className="tabular-nums">
                {up ? '+' : ''}
                {diff.toFixed(m.digits)}
                {m.suffix}
            </span>
        </span>
    );
}

function ImprovementSummary({ movers, aiSummary }: { movers: Mover[]; aiSummary?: string | null }) {
    const { t } = useTranslation('audienceManagerAiIntelligencePage');
    const { improved, declined } = significantMovers(movers);
    if (improved.length === 0 && declined.length === 0 && !aiSummary) {
        return (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-caption text-neutral-500">
                {t('teamInsights.summary.noChangeYet')}
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3">
            {aiSummary && (
                <div className="flex items-start gap-1.5">
                    <Sparkle size={14} weight="fill" className="mt-0.5 shrink-0 text-primary-500" />
                    <p className="text-caption text-neutral-700">
                        <span className="font-semibold text-primary-700">
                            {t('teamInsights.summary.aiSummaryLabel')}{' '}
                        </span>
                        {aiSummary}
                    </p>
                </div>
            )}
            {improved.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption font-semibold text-success-700">
                        {t('teamInsights.summary.whatImproved')}
                    </span>
                    {improved.map((m) => (
                        <MoverChip key={m.label} m={m} up />
                    ))}
                </div>
            )}
            {declined.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption font-semibold text-danger-600">
                        {t('teamInsights.summary.needsAttention')}
                    </span>
                    {declined.map((m) => (
                        <MoverChip key={m.label} m={m} up={false} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Team insights block ───────────────────────────────────────────────────────
function TeamInsights({
    instituteId,
    current,
    previous,
}: {
    instituteId: string;
    current: Win;
    previous: Win;
}) {
    const { t } = useTranslation('audienceManagerAiIntelligencePage');
    const cur = useQuery({
        queryKey: ['ai-intel-team', instituteId, current.from, current.to],
        queryFn: () => fetchTeamCallIntelligence(instituteId, current.from, current.to),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });
    const prev = useQuery({
        queryKey: ['ai-intel-team', instituteId, previous.from, previous.to],
        queryFn: () => fetchTeamCallIntelligence(instituteId, previous.from, previous.to),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });
    // AI coaching for the current window — shares TeamCoachingSection's query key,
    // so the coaching card below and this AI summary come from one fetch.
    const coaching = useQuery({
        queryKey: ['team-coaching', instituteId, current.from, current.to],
        queryFn: () => fetchTeamCoaching(instituteId, current.from, current.to),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });
    // Day-to-day activity — same query keys as the breakdown below, so React Query
    // serves both from one fetch per window (no duplicate network calls).
    const curDisp = useQuery({
        queryKey: ['ai-intel-disp', instituteId, current.fromDate, current.toDate],
        queryFn: () =>
            fetchDispositions({ instituteId, fromDate: current.fromDate, toDate: current.toDate }),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });
    const prevDisp = useQuery({
        queryKey: ['ai-intel-disp', instituteId, previous.fromDate, previous.toDate],
        queryFn: () =>
            fetchDispositions({
                instituteId,
                fromDate: previous.fromDate,
                toDate: previous.toDate,
            }),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });

    const c: CallIntelligenceAnalyticsDto | undefined = cur.data;
    const p: CallIntelligenceAnalyticsDto | undefined = prev.data;
    const actC = aggregateActivity(curDisp.data);
    const actP = aggregateActivity(prevDisp.data);

    const summaryReady = !cur.isLoading && !prev.isLoading && !curDisp.isLoading;
    const movers: Mover[] = [
        {
            label: t('teamInsights.metrics.callsAnalyzed'),
            cur: c?.totalAnalyzed ?? 0,
            prev: p?.totalAnalyzed ?? 0,
            digits: 0,
            suffix: '',
        },
        {
            label: t('teamInsights.metrics.avgCallerRating'),
            cur: c?.avgCallerSelfGoalRating ?? null,
            prev: p?.avgCallerSelfGoalRating ?? null,
            digits: 1,
            suffix: '',
        },
        {
            label: t('teamInsights.metrics.avgCallOutput'),
            cur: c?.avgCallOutputRating ?? null,
            prev: p?.avgCallOutputRating ?? null,
            digits: 1,
            suffix: '',
        },
        {
            label: t('teamInsights.metrics.positiveSentiment'),
            cur: positivePct(c?.sentimentDistribution),
            prev: positivePct(p?.sentimentDistribution),
            digits: 0,
            suffix: '%',
        },
        {
            label: t('teamInsights.metrics.leadsDispositioned'),
            cur: actC.dispositioned,
            prev: actP.dispositioned,
            digits: 0,
            suffix: '',
        },
        {
            label: t('teamInsights.metrics.callsMade'),
            cur: actC.calls,
            prev: actP.calls,
            digits: 0,
            suffix: '',
        },
        {
            label: t('teamInsights.metrics.teamReach'),
            cur: actC.reach,
            prev: actP.reach,
            digits: 0,
            suffix: '%',
        },
    ];
    const aiSummary = buildAiSummary(t)(movers, coaching.data);

    const fmtRange = buildFmtRange(t);
    const positive = positivePct(c?.sentimentDistribution);
    const groupLabel = (IconCmp: Icon, label: string) => (
        <span className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-neutral-500">
            <IconCmp size={13} />
            {label}
        </span>
    );

    return (
        <section className="flex flex-col gap-4">
            {/* Headline: the team's call quality this period against the previous one. */}
            <Card className="overflow-hidden rounded-xl border-primary-100 bg-gradient-to-br from-primary-50 via-white to-white p-5 shadow-sm">
                <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-primary-600">
                    <Sparkle size={14} weight="fill" />
                    <span className="text-caption">
                        {t('hero.eyebrow', { range: fmtRange(current) })}
                    </span>
                </div>
                {cur.isLoading ? (
                    <div className="mt-3 h-16 w-64 animate-pulse rounded-lg bg-neutral-100" />
                ) : (
                    <>
                        <div className="mt-2 flex flex-wrap items-baseline gap-2">
                            <span className="text-h1 font-semibold tabular-nums text-neutral-900">
                                {c?.avgCallerSelfGoalRating == null
                                    ? '—'
                                    : c.avgCallerSelfGoalRating.toFixed(1)}
                            </span>
                            <span className="text-body text-neutral-500">{t('hero.unit')}</span>
                            <Delta
                                current={c?.avgCallerSelfGoalRating ?? null}
                                previous={p?.avgCallerSelfGoalRating ?? null}
                            />
                        </div>
                        <p className="mt-2 text-body text-neutral-600">
                            {[
                                t('hero.analyzed', { count: c?.totalAnalyzed ?? 0 }),
                                positive != null ? t('hero.positive', { value: positive }) : '',
                                actC.reach != null ? t('hero.reach', { value: actC.reach }) : '',
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                    </>
                )}
                {/* Explicit current-vs-previous comparison so "improved" is unambiguous */}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-caption">
                    <ArrowsLeftRight size={14} className="text-neutral-400" />
                    <span className="font-medium text-neutral-700">{t('comparing.label')}</span>
                    <span className="rounded-full bg-primary-100 px-2.5 py-1 font-medium text-primary-600">
                        {fmtRange(current)}
                    </span>
                    <span className="text-neutral-400">{t('comparing.against')}</span>
                    <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-neutral-600">
                        {fmtRange(previous)}
                    </span>
                </div>
            </Card>

            <div className="flex items-center gap-2">
                <UsersThree size={18} className="text-primary-500" />
                <h2 className="text-h3 font-semibold text-neutral-800">
                    {t('teamInsights.heading')}
                </h2>
            </div>

            {/* Headline — what improved / needs attention vs the previous period,
                with an AI summary grounded in coaching output when available */}
            {summaryReady && <ImprovementSummary movers={movers} aiSummary={aiSummary} />}

            {/* Group 1 — calling & call quality */}
            <div className="flex flex-col gap-2">
                {groupLabel(Phone, t('teamInsights.groupCallQuality'))}
                {cur.isLoading ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="h-28 animate-pulse rounded-xl bg-neutral-100" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <KpiDeltaCard
                            icon={Sparkle}
                            label={t('teamInsights.metrics.callsAnalyzed')}
                            value={c?.totalAnalyzed ?? 0}
                            previous={p?.totalAnalyzed ?? 0}
                            digits={0}
                        />
                        <KpiDeltaCard
                            icon={User}
                            tint="success"
                            label={t('teamInsights.metrics.avgCallerRating')}
                            value={c?.avgCallerSelfGoalRating ?? null}
                            previous={p?.avgCallerSelfGoalRating ?? null}
                            suffix="/10"
                        />
                        <KpiDeltaCard
                            icon={CheckCircle}
                            tint="info"
                            label={t('teamInsights.metrics.avgCallOutput')}
                            value={c?.avgCallOutputRating ?? null}
                            previous={p?.avgCallOutputRating ?? null}
                            suffix="/10"
                        />
                        <KpiDeltaCard
                            icon={Smiley}
                            tint="warning"
                            label={t('teamInsights.metrics.positiveSentiment')}
                            value={positive}
                            previous={positivePct(p?.sentimentDistribution)}
                            digits={0}
                            suffix="%"
                        />
                    </div>
                )}
            </div>

            {/* Group 2 — day-to-day activity (dispositions + calling reach) */}
            <div className="flex flex-col gap-2">
                {groupLabel(ArrowsClockwise, t('teamInsights.groupActivity'))}
                {curDisp.isLoading ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="h-28 animate-pulse rounded-xl bg-neutral-100" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <KpiDeltaCard
                            icon={ArrowsClockwise}
                            label={t('teamInsights.metrics.leadsDispositioned')}
                            value={actC.dispositioned}
                            previous={actP.dispositioned}
                            digits={0}
                        />
                        <KpiDeltaCard
                            icon={Phone}
                            tint="info"
                            label={t('teamInsights.metrics.callsMade')}
                            value={actC.calls}
                            previous={actP.calls}
                            digits={0}
                        />
                        <KpiDeltaCard
                            icon={PhoneCall}
                            tint="success"
                            label={t('teamInsights.metrics.teamReach')}
                            value={actC.reach}
                            previous={actP.reach}
                            digits={0}
                            suffix="%"
                        />
                    </div>
                )}
            </div>

            {/* team skill profile radar, this period vs the previous one. */}
            <SkillRadarCard instituteId={instituteId} current={current} previous={previous} />

            {/* Whole-team qualitative coaching (weakest skills, themes, objections) */}
            <TeamCoachingSection
                instituteId={instituteId}
                fromMillis={current.from}
                toMillis={current.to}
            />
        </section>
    );
}

// ── Per-counsellor "what they can improve" (lazy, on expand) ──────────────────
function CoachingDrillIn({
    counsellorUserId,
    from,
    to,
}: {
    counsellorUserId: string;
    from: number;
    to: number;
}) {
    const { t } = useTranslation('audienceManagerAiIntelligencePage');
    const { data, isLoading } = useQuery({
        queryKey: ['ai-intel-counsellor-coaching', counsellorUserId, from, to],
        queryFn: () => fetchCounsellorCoaching(counsellorUserId, from, to),
        staleTime: 60 * 1000,
    });

    if (isLoading)
        return (
            <div className="p-3 text-caption text-neutral-400">
                {t('counsellorBreakdown.coaching.loading')}
            </div>
        );
    if (!data || data.totalAnalyzed === 0) {
        return (
            <div className="p-3 text-caption text-neutral-400">
                {t('counsellorBreakdown.coaching.noCoaching')}
            </div>
        );
    }
    const weakest = (data.qualityAverages ?? []).slice(0, 3);
    const tips = (data.topCoachingTips ?? []).slice(0, 3);
    const skillTone = (v: number | null | undefined) =>
        v == null
            ? '[&>div]:bg-neutral-300'
            : v >= 7
              ? '[&>div]:bg-success-500'
              : v >= 4
                ? '[&>div]:bg-warning-500'
                : '[&>div]:bg-danger-500';
    return (
        <div className="grid grid-cols-1 gap-4 px-4 py-3 md:grid-cols-2">
            {weakest.length > 0 && (
                <div className="flex flex-col gap-2">
                    <span className="flex items-center gap-1.5 text-caption font-semibold text-neutral-600">
                        <Lightbulb size={13} />
                        {t('counsellorBreakdown.coaching.weakestSkills')}
                    </span>
                    <ul className="flex flex-col gap-2">
                        {weakest.map((q) => (
                            <li key={q.key} className="flex items-center gap-3 text-caption">
                                <span className="w-36 shrink-0 truncate capitalize text-neutral-700">
                                    {q.key.replace(/_/g, ' ')}
                                </span>
                                <Progress
                                    value={q.avgScore == null ? 0 : q.avgScore * 10}
                                    className={cn('h-1.5 !bg-neutral-100', skillTone(q.avgScore))}
                                />
                                <span className="w-10 shrink-0 text-end font-semibold tabular-nums text-neutral-800">
                                    {q.avgScore == null ? '—' : q.avgScore.toFixed(1)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {tips.length > 0 && (
                <ul className="flex flex-col gap-2">
                    {tips.map((tip, i) => (
                        <li
                            key={i}
                            className="flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-caption text-neutral-700"
                        >
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-warning-50 text-warning-600">
                                <Target className="size-3.5" />
                            </span>
                            <span>{tip.text}</span>
                        </li>
                    ))}
                </ul>
            )}
            {weakest.length === 0 && tips.length === 0 && (
                <span className="text-caption text-neutral-400">
                    {t('counsellorBreakdown.coaching.notEnoughSignal')}
                </span>
            )}
        </div>
    );
}

interface CounsellorRow {
    userId: string;
    name: string;
    analyzed: number;
    analyzedPrev: number;
    avgCaller: number | null;
    avgCallerPrev: number | null;
    avgOutput: number | null;
    avgOutputPrev: number | null;
    statusChanges: number;
    statusChangesPrev: number;
    reach: number | null;
    reachPrev: number | null;
}

const reach = (outcomes: Record<string, number>): number | null => {
    const dials = Object.values(outcomes).reduce((s, n) => s + n, 0);
    if (dials === 0) return null;
    return Math.round(((outcomes.COMPLETED ?? 0) / dials) * 100);
};

function reachTone(v: number | null): string {
    if (v == null) return 'text-neutral-400';
    if (v >= 40) return 'text-success-700';
    if (v >= 20) return 'text-warning-700';
    return 'text-danger-600';
}

// One right-aligned metric column (value + its vs-previous delta). Fixed width so
// every counsellor card lines up under the shared header row.
function MetricCol({
    value,
    previous,
    digits = 0,
    suffix = '',
    tone,
}: {
    value: number | null;
    previous: number | null;
    digits?: number;
    suffix?: string;
    tone?: string;
}) {
    return (
        <div className="flex w-24 shrink-0 flex-col items-end">
            <span className={cn('font-medium', tone ?? 'text-neutral-900')}>
                {value == null ? '—' : `${value.toFixed(digits)}${suffix}`}
            </span>
            <Delta current={value} previous={previous} digits={digits} suffix={suffix} />
        </div>
    );
}

// ── Per-counsellor breakdown ──────────────────────────────────────────────────
function CounsellorBreakdown({
    instituteId,
    current,
    previous,
}: {
    instituteId: string;
    current: Win;
    previous: Win;
}) {
    const { t } = useTranslation('audienceManagerAiIntelligencePage');
    // Rows are expanded by default (coaching visible without a click); a row is
    // open unless the user has explicitly collapsed it.
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const toggle = (userId: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });

    const curTeam = useQuery({
        queryKey: ['ai-intel-team', instituteId, current.from, current.to],
        queryFn: () => fetchTeamCallIntelligence(instituteId, current.from, current.to),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });
    const prevTeam = useQuery({
        queryKey: ['ai-intel-team', instituteId, previous.from, previous.to],
        queryFn: () => fetchTeamCallIntelligence(instituteId, previous.from, previous.to),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });
    const curDisp = useQuery({
        queryKey: ['ai-intel-disp', instituteId, current.fromDate, current.toDate],
        queryFn: () =>
            fetchDispositions({
                instituteId,
                fromDate: current.fromDate,
                toDate: current.toDate,
            }),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });
    const prevDisp = useQuery({
        queryKey: ['ai-intel-disp', instituteId, previous.fromDate, previous.toDate],
        queryFn: () =>
            fetchDispositions({
                instituteId,
                fromDate: previous.fromDate,
                toDate: previous.toDate,
            }),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });

    const rows: CounsellorRow[] = useMemo(() => {
        const map = new Map<string, CounsellorRow>();
        const ensure = (userId: string, name?: string | null): CounsellorRow => {
            let r = map.get(userId);
            if (!r) {
                r = {
                    userId,
                    name: name ?? userId,
                    analyzed: 0,
                    analyzedPrev: 0,
                    avgCaller: null,
                    avgCallerPrev: null,
                    avgOutput: null,
                    avgOutputPrev: null,
                    statusChanges: 0,
                    statusChangesPrev: 0,
                    reach: null,
                    reachPrev: null,
                };
                map.set(userId, r);
            } else if (name && r.name === userId) {
                r.name = name;
            }
            return r;
        };

        for (const s of curTeam.data?.perCounsellor ?? []) {
            const r = ensure(s.counsellorUserId);
            r.analyzed = s.totalAnalyzed;
            r.avgCaller = s.avgCallerSelfGoalRating ?? null;
            r.avgOutput = s.avgCallOutputRating ?? null;
        }
        for (const s of prevTeam.data?.perCounsellor ?? []) {
            const r = ensure(s.counsellorUserId);
            r.analyzedPrev = s.totalAnalyzed;
            r.avgCallerPrev = s.avgCallerSelfGoalRating ?? null;
            r.avgOutputPrev = s.avgCallOutputRating ?? null;
        }
        for (const d of curDisp.data?.rows ?? []) {
            if (d.user_id === 'SYSTEM') continue;
            ensure(d.user_id, d.name).statusChanges = d.total_changes;
        }
        for (const d of prevDisp.data?.rows ?? []) {
            if (d.user_id === 'SYSTEM') continue;
            ensure(d.user_id, d.name).statusChangesPrev = d.total_changes;
        }
        for (const c of curDisp.data?.call_outcomes ?? []) {
            if (c.user_id === 'SYSTEM') continue;
            ensure(c.user_id, c.name).reach = reach(c.outcomes);
        }
        for (const c of prevDisp.data?.call_outcomes ?? []) {
            if (c.user_id === 'SYSTEM') continue;
            ensure(c.user_id, c.name).reachPrev = reach(c.outcomes);
        }
        return Array.from(map.values()).sort(
            (a, b) => b.analyzed - a.analyzed || b.statusChanges - a.statusChanges
        );
    }, [curTeam.data, prevTeam.data, curDisp.data, prevDisp.data]);

    const loading =
        curTeam.isLoading || prevTeam.isLoading || curDisp.isLoading || prevDisp.isLoading;

    const allCollapsed = rows.length > 0 && rows.every((r) => collapsed.has(r.userId));

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <ChartLineUp size={18} className="text-primary-500" />
                <h2 className="text-h3 font-semibold text-neutral-800">
                    {t('counsellorBreakdown.heading')}
                </h2>
                <span className="text-caption text-neutral-400">
                    {t('counsellorBreakdown.subtitle')}
                </span>
                {rows.length > 1 && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="ms-auto"
                        onClick={() =>
                            setCollapsed(
                                allCollapsed ? new Set() : new Set(rows.map((r) => r.userId))
                            )
                        }
                    >
                        {allCollapsed ? (
                            <ArrowsOutLineVertical size={14} />
                        ) : (
                            <ArrowsInLineVertical size={14} />
                        )}
                        {allCollapsed
                            ? t('counsellorBreakdown.expandAll')
                            : t('counsellorBreakdown.collapseAll')}
                    </MyButton>
                )}
            </div>
            {loading ? (
                <div className="h-40 animate-pulse rounded-xl bg-neutral-100" />
            ) : rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-200 p-6 text-center text-body text-neutral-400">
                    {t('counsellorBreakdown.noActivity')}
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <div className="flex min-w-max flex-col gap-3">
                        {/* Shared column header — aligns with each card's metric row */}
                        <div className="flex items-center px-4 text-caption uppercase tracking-wide text-neutral-500">
                            <span className="w-6 shrink-0" />
                            <span className="min-w-40 flex-1">
                                {t('counsellorBreakdown.columns.counsellor')}
                            </span>
                            <span className="w-24 shrink-0 text-end">
                                {t('counsellorBreakdown.columns.analyzed')}
                            </span>
                            <span className="w-24 shrink-0 text-end">
                                {t('counsellorBreakdown.columns.avgCaller')}
                            </span>
                            <span className="w-24 shrink-0 text-end">
                                {t('counsellorBreakdown.columns.avgOutput')}
                            </span>
                            <span className="w-24 shrink-0 text-end">
                                {t('counsellorBreakdown.columns.dispositioned')}
                            </span>
                            <span className="w-24 shrink-0 text-end">
                                {t('counsellorBreakdown.columns.reach')}
                            </span>
                        </div>

                        {rows.map((r) => {
                            const open = !collapsed.has(r.userId);
                            return (
                                // One card per counsellor — everything inside belongs to this
                                // rep, and the gap-3 between cards keeps them clearly apart.
                                <div
                                    key={r.userId}
                                    className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
                                >
                                    <div
                                        className={cn(
                                            'flex cursor-pointer items-center px-4 py-3 hover:bg-neutral-50',
                                            open && 'bg-neutral-50/60'
                                        )}
                                        onClick={() => toggle(r.userId)}
                                    >
                                        <span className="w-6 shrink-0 text-neutral-400">
                                            {open ? (
                                                <CaretDown size={14} />
                                            ) : (
                                                <CaretRight size={14} />
                                            )}
                                        </span>
                                        <span className="flex min-w-40 flex-1 items-center gap-2.5 font-medium text-neutral-800">
                                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-600">
                                                {r.name.slice(0, 1).toUpperCase()}
                                            </span>
                                            <span className="truncate">{r.name}</span>
                                        </span>
                                        <MetricCol value={r.analyzed} previous={r.analyzedPrev} />
                                        <MetricCol
                                            value={r.avgCaller}
                                            previous={r.avgCallerPrev}
                                            digits={1}
                                        />
                                        <MetricCol
                                            value={r.avgOutput}
                                            previous={r.avgOutputPrev}
                                            digits={1}
                                        />
                                        <MetricCol
                                            value={r.statusChanges}
                                            previous={r.statusChangesPrev}
                                        />
                                        <MetricCol
                                            value={r.reach}
                                            previous={r.reachPrev}
                                            suffix="%"
                                            tone={reachTone(r.reach)}
                                        />
                                    </div>
                                    {open && (
                                        <div className="border-t border-neutral-200">
                                            <div className="flex items-center gap-1.5 bg-neutral-50 px-4 py-2 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                                <Lightbulb size={13} />{' '}
                                                {t('counsellorBreakdown.whatTheyCanImprove')}
                                            </div>
                                            <CoachingDrillIn
                                                counsellorUserId={r.userId}
                                                from={current.from}
                                                to={current.to}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </section>
    );
}

// ── Period control (preset pills + custom range) ─────────────────────────────
function PeriodControl({
    period,
    current,
    onChange,
}: {
    period: Period;
    current: Win;
    onChange: (p: Period) => void;
}) {
    const { t } = useTranslation('audienceManagerAiIntelligencePage');
    const isCustom = period.kind === 'custom';
    const activeDays = period.kind === 'preset' ? period.days : null;
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');

    const applyCustom = (f: string, toStr: string) => {
        if (!f || !toStr) return;
        const fromMs = new Date(f).getTime();
        const toMs = new Date(`${toStr}T23:59:59`).getTime();
        if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) return;
        onChange({ kind: 'custom', fromMs, toMs });
    };

    const pill = (active: boolean) =>
        cn(
            'rounded-full border px-3 py-1.5 text-caption font-medium transition-colors',
            active
                ? 'border-primary-500 bg-primary-500 text-white'
                : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
        );

    return (
        <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-1.5">
                {PRESETS.map((days) => (
                    <button
                        key={days}
                        type="button"
                        onClick={() => onChange({ kind: 'preset', days })}
                        className={pill(activeDays === days)}
                    >
                        {t('period.days', { count: days })}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => {
                        setFrom(current.fromDate);
                        setTo(current.toDate);
                        onChange({ kind: 'custom', fromMs: current.from, toMs: current.to });
                    }}
                    className={pill(isCustom)}
                >
                    {t('period.custom')}
                </button>
            </div>
            {isCustom && (
                <div className="flex items-center gap-2">
                    <input
                        type="date"
                        value={from}
                        onChange={(e) => {
                            setFrom(e.target.value);
                            applyCustom(e.target.value, to);
                        }}
                        className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-body text-neutral-800 focus:border-primary-500 focus:outline-none"
                        aria-label={t('period.startDateLabel')}
                    />
                    <span className="text-caption text-neutral-400">{t('period.to')}</span>
                    <input
                        type="date"
                        value={to}
                        min={from}
                        onChange={(e) => {
                            setTo(e.target.value);
                            applyCustom(from, e.target.value);
                        }}
                        className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-body text-neutral-800 focus:border-primary-500 focus:outline-none"
                        aria-label={t('period.endDateLabel')}
                    />
                </div>
            )}
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function AiIntelligencePage() {
    const { t } = useTranslation('audienceManagerAiIntelligencePage');
    const { instituteDetails } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id ?? '';
    const enabled = useCallIntelligenceEnabled();
    // When the feature is off but the institute has previously-analyzed data, we
    // still show the historical insights (read-only) with an "off" banner.
    const hasData = useHasCallIntelligenceData(!enabled);
    const showContent = enabled || hasData;
    const [period, setPeriod] = useState<Period>({ kind: 'preset', days: 30 });

    const { current, previous } = useMemo(() => windowsFor(period), [period]);

    return (
        <div className="flex flex-col gap-6 p-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <Sparkle size={22} weight="duotone" />
                    </span>
                    <div className="flex flex-col gap-1">
                        <h1 className="text-h2 font-semibold text-neutral-900">
                            {t('header.title')}
                        </h1>
                        <p className="max-w-xl text-body text-neutral-500">
                            {t('header.subtitle')}
                        </p>
                    </div>
                </div>
                <div className="flex items-start gap-2">
                    <PeriodControl period={period} current={current} onChange={setPeriod} />
                    <SettingsQuickAccessButton
                        settingsKey={SettingsTabs.CrmIntelligence}
                        label={t('header.settings')}
                    />
                </div>
            </header>

            {/* Feature is off but there's historical data — show it read-only and
                make clear no new calls are being analyzed. */}
            {instituteId && !enabled && hasData && (
                <div className="flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-caption text-warning-700">
                    <Sparkle size={16} weight="fill" className="mt-0.5 shrink-0 text-warning-500" />
                    <span>{t('banner.offWithData')}</span>
                </div>
            )}

            {!instituteId ? (
                <div className="rounded-xl border border-dashed border-neutral-200 p-8 text-center text-body text-neutral-400">
                    {t('loadingInstitute')}
                </div>
            ) : !showContent ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-200 bg-white p-10 text-center">
                    <Sparkle size={28} className="text-neutral-300" />
                    <p className="text-body font-medium text-neutral-600">
                        {t('emptyState.title')}
                    </p>
                    <p className="max-w-md text-caption text-neutral-400">
                        {t('emptyState.description')}
                    </p>
                </div>
            ) : (
                <>
                    <TeamInsights instituteId={instituteId} current={current} previous={previous} />
                    <CounsellorBreakdown
                        instituteId={instituteId}
                        current={current}
                        previous={previous}
                    />
                </>
            )}
        </div>
    );
}
