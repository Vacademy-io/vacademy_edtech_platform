/**
 * CRM Intelligence report (Reports Center) — the pitch-grade view:
 *   1. TEAM REPORT (first block): the team's call-quality analytics (KPIs, outcome
 *      + sentiment mix, per-counsellor quality leaderboard) followed by whole-team
 *      coaching (weakest skills, recurring themes, common objections).
 *   2. COUNSELLOR WORK PATTERNS: per rep — how many leads they dispositioned
 *      (status changes) and their calling reach (dials / connected), each row
 *      expandable to "what they can improve" (their coaching from transcripts).
 *
 * Read-only; reuses the analytics/coaching endpoints + the dispositions report.
 */
import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretRight, ArrowsLeftRight, Lightbulb, Target } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import CallIntelligenceTab from './call-intelligence-tab';
import { TeamCoachingSection } from '@/components/shared/leads';
import { fetchCounsellorCoaching } from '@/components/shared/leads/services/call-intelligence';
import { fetchDispositions } from '../-services/get-crm-reports';
import {
    EmptyHint,
    ReportSection,
    ReportTabSkeleton,
    ReportErrorState,
    type ReportTabProps,
} from './report-shared';

interface WorkRow {
    userId: string;
    name: string;
    statusChanges: number;
    dials: number;
    connected: number;
    reach: number | null;
}

function reachTone(reach: number | null): string {
    if (reach == null) return 'text-neutral-500';
    if (reach >= 40) return 'text-green-700';
    if (reach >= 20) return 'text-amber-700';
    return 'text-red-600';
}

// ── Per-counsellor "what they can improve" (lazy, on expand) ──────────────
function CoachingDrillIn({ counsellorUserId }: { counsellorUserId: string }) {
    const { t } = useTranslation('audienceManagerCrmIntelligenceReportTab');
    const { data, isLoading } = useQuery({
        queryKey: ['counsellor-coaching', counsellorUserId, 'report-drillin'],
        queryFn: () => fetchCounsellorCoaching(counsellorUserId),
        staleTime: 60 * 1000,
    });

    if (isLoading)
        return (
            <div className="p-3 text-xs text-neutral-400">{t('coachingDrillIn.loading')}</div>
        );
    if (!data || data.totalAnalyzed === 0) {
        return (
            <div className="p-3 text-xs text-neutral-400">
                {t('coachingDrillIn.noAnalyzedCalls')}
            </div>
        );
    }
    const weakest = (data.qualityAverages ?? []).slice(0, 2);
    const tips = (data.topCoachingTips ?? []).slice(0, 3);
    return (
        <div className="flex flex-col gap-2 bg-neutral-50 px-4 py-3">
            {weakest.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-neutral-600">
                        {t('coachingDrillIn.weakestLabel')}
                    </span>
                    {weakest.map((q) => (
                        <span
                            key={q.key}
                            className="rounded-full bg-white px-2 py-0.5 text-neutral-600"
                        >
                            {q.key.replace(/_/g, ' ')} ·{' '}
                            {t('coachingDrillIn.scoreOutOfTen', {
                                score: q.avgScore == null ? '—' : q.avgScore.toFixed(1),
                            })}
                        </span>
                    ))}
                </div>
            )}
            {tips.length > 0 && (
                <ul className="space-y-1">
                    {tips.map((tip, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-neutral-700">
                            <Target className="mt-0.5 size-3.5 shrink-0 text-primary-400" />
                            <span>{tip.text}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Counsellor work patterns table ────────────────────────────────────────
function CounsellorWorkPatterns({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerCrmIntelligenceReportTab');
    const [expanded, setExpanded] = useState<string | null>(null);
    const query = useQuery({
        queryKey: [
            'crm-intel-work-patterns',
            instituteId,
            fromDate,
            toDate,
            teamId,
            counsellorUserId,
        ],
        queryFn: () =>
            fetchDispositions({ instituteId, fromDate, toDate, teamId, counsellorUserId }),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });

    const rows: WorkRow[] = useMemo(() => {
        const d = query.data;
        if (!d) return [];
        const byId = new Map<string, WorkRow>();
        for (const r of d.rows) {
            if (r.user_id === 'SYSTEM') continue;
            byId.set(r.user_id, {
                userId: r.user_id,
                name: r.name ?? r.user_id,
                statusChanges: r.total_changes,
                dials: 0,
                connected: 0,
                reach: null,
            });
        }
        for (const c of d.call_outcomes) {
            if (c.user_id === 'SYSTEM') continue;
            const dials = Object.values(c.outcomes).reduce((s, n) => s + n, 0);
            const connected = c.outcomes.COMPLETED ?? 0;
            const existing = byId.get(c.user_id) ?? {
                userId: c.user_id,
                name: c.name ?? c.user_id,
                statusChanges: 0,
                dials: 0,
                connected: 0,
                reach: null,
            };
            existing.dials = dials;
            existing.connected = connected;
            existing.reach = dials > 0 ? Math.round((connected / dials) * 100) : null;
            byId.set(c.user_id, existing);
        }
        return Array.from(byId.values()).sort((a, b) => b.statusChanges - a.statusChanges);
    }, [query.data]);

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError)
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;

    return (
        <ReportSection
            title={t('workPatterns.sectionTitle')}
            icon={<ArrowsLeftRight size={16} />}
        >
            {rows.length === 0 ? (
                <EmptyHint message={t('workPatterns.emptyMessage')} />
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                                <th className="w-8 py-2" />
                                <th className="py-2 text-start">
                                    {t('workPatterns.columns.counsellor')}
                                </th>
                                <th className="py-2 text-end">
                                    {t('workPatterns.columns.leadsDispositioned')}
                                </th>
                                <th className="py-2 text-end">
                                    {t('workPatterns.columns.calls')}
                                </th>
                                <th className="py-2 text-end">
                                    {t('workPatterns.columns.connected')}
                                </th>
                                <th className="py-2 text-end">
                                    {t('workPatterns.columns.reach')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const open = expanded === r.userId;
                                return (
                                    <Fragment key={r.userId}>
                                        <tr
                                            className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50"
                                            onClick={() => setExpanded(open ? null : r.userId)}
                                        >
                                            <td className="py-2 text-neutral-400">
                                                {open ? (
                                                    <CaretDown size={14} />
                                                ) : (
                                                    <CaretRight size={14} />
                                                )}
                                            </td>
                                            <td className="py-2 text-neutral-800">{r.name}</td>
                                            <td className="py-2 text-right font-medium text-neutral-900">
                                                {r.statusChanges}
                                            </td>
                                            <td className="py-2 text-right text-neutral-700">
                                                {r.dials}
                                            </td>
                                            <td className="py-2 text-right text-neutral-700">
                                                {r.connected}
                                            </td>
                                            <td
                                                className={cn(
                                                    'py-2 text-right font-medium',
                                                    reachTone(r.reach)
                                                )}
                                            >
                                                {r.reach == null ? '—' : `${r.reach}%`}
                                            </td>
                                        </tr>
                                        {open && (
                                            <tr>
                                                <td colSpan={6} className="p-0">
                                                    <div className="flex items-center gap-1.5 px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                                        <Lightbulb size={13} />{' '}
                                                        {t('workPatterns.improveHeading')}
                                                    </div>
                                                    <CoachingDrillIn counsellorUserId={r.userId} />
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </ReportSection>
    );
}

const toMillis = (d: string, endOfDay = false): number | undefined => {
    const ms = new Date(endOfDay ? `${d}T23:59:59` : d).getTime();
    return Number.isNaN(ms) ? undefined : ms;
};

export default function CrmIntelligenceReportTab(props: ReportTabProps) {
    return (
        <div className="flex flex-col gap-6">
            {/* First block — team report: quality analytics + whole-team coaching */}
            <CallIntelligenceTab {...props} />
            <TeamCoachingSection
                instituteId={props.instituteId}
                fromMillis={toMillis(props.fromDate)}
                toMillis={toMillis(props.toDate, true)}
            />
            {/* Per-counsellor work patterns + improvement drill-in */}
            <CounsellorWorkPatterns {...props} />
        </div>
    );
}
