/**
 * Reports Center — Funnel tab.
 *
 * Stage throughput + dwell time from GET /v1/reports/funnel-velocity:
 * an overall KPI pair (median days to convert · conversion rate), visual
 * stage bars (entered volume, div-bar idiom shared with the breakdown cards),
 * and a stage table (Entered · In stage now · Median days · Advanced % ·
 * Regressed) ordered by the status catalog's display_order. Stages drill
 * through to Recent Leads pre-filtered by ?status=<status_key>.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CaretRight, CheckCircle, Funnel, Timer } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    fetchFunnelVelocity,
    funnelVelocityQueryKey,
    type FunnelStage,
} from '../-services/get-crm-reports';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    KpiCard,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    fmtDays,
    fmtNumber,
    fmtPct,
    type ReportTabProps,
} from './report-shared';

/** Where the stage drill-through lands. */
const RECENT_LEADS_ROUTE = '/audience-manager/recent-leads' as const;

export function FunnelTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
    audienceId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerFunnelTab');
    const navigate = useNavigate();
    const params = { instituteId, fromDate, toDate, teamId, counsellorUserId, audienceId };

    const query = useQuery({
        queryKey: funnelVelocityQueryKey(params),
        queryFn: () => fetchFunnelVelocity(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const stages = useMemo(
        () => [...(query.data?.stages ?? [])].sort((a, b) => a.display_order - b.display_order),
        [query.data]
    );

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError) {
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;
    }

    const overall = query.data?.overall ?? null;
    const maxEntered = Math.max(1, ...stages.map((s) => s.entered));

    const drill = (statusKey: string) =>
        navigate({ to: RECENT_LEADS_ROUTE, search: { status: statusKey } });


    return (
        <div className="flex flex-col gap-6">
            {/* Overall KPI pair */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <KpiCard
                    label={t('kpi.medianDaysToConvert.label')}
                    value={fmtDays(overall?.median_days_to_convert)}
                    sub={t('kpi.medianDaysToConvert.sub')}
                    icon={<Timer size={20} weight="bold" />}
                    tone="info"
                />
                <KpiCard
                    label={t('kpi.conversionRate.label')}
                    value={fmtPct(overall?.conversion_rate)}
                    sub={t('kpi.conversionRate.sub')}
                    icon={<CheckCircle size={20} weight="bold" />}
                    tone="success"
                />
            </div>

            <ReportSection
                title={t('section.title')}
                icon={<Funnel size={18} />}
                actions={
                    <ExportWithColumnPickerButton
                        filename={`funnel-velocity_${fromDate}_${toDate}.csv`}
                        disabled={stages.length === 0}
                        getHeadersAndRows={() => ({
                            headers: [
                                t('csv.headers.stage'),
                                t('csv.headers.entered'),
                                t('csv.headers.inStageNow'),
                                t('csv.headers.medianDaysInStage'),
                                t('csv.headers.advanced'),
                                t('csv.headers.advancedPct'),
                                t('csv.headers.regressed'),
                            ],
                            rows: stages.map((s) => [
                                s.label || s.status_key,
                                s.entered,
                                s.current_stock,
                                s.median_days_in_stage,
                                s.advanced,
                                s.advanced_rate,
                                s.regressed,
                            ]),
                        })}
                    />
                }
            >
                {stages.length === 0 ? (
                    <EmptyHint message={t('emptyHint')} />
                ) : (
                    <>
                        {/* Visual stage bars — entered volume per stage. */}
                        <div className="flex flex-col gap-3">
                            {stages.map((s) => (
                                <StageBar
                                    key={s.status_key}
                                    stage={s}
                                    maxEntered={maxEntered}
                                    onClick={() => drill(s.status_key)}
                                />
                            ))}
                        </div>

                        {/* Stage table */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                        <th className="py-2 pe-3 text-start">
                                            {t('table.headers.stage')}
                                        </th>
                                        <th className="py-2 pe-3 text-end">
                                            {t('table.headers.entered')}
                                        </th>
                                        <th className="py-2 pe-3 text-end">
                                            {t('table.headers.inStageNow')}
                                        </th>
                                        <th className="py-2 pe-3 text-end">
                                            {t('table.headers.medianDays')}
                                        </th>
                                        <th className="py-2 pe-3 text-end">
                                            {t('table.headers.advancedPct')}
                                        </th>
                                        <th className="py-2 pe-3 text-end">
                                            {t('table.headers.regressed')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stages.map((s) => (
                                        <tr
                                            key={s.status_key}
                                            className="group cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                            onClick={() => drill(s.status_key)}
                                        >
                                            <td className="py-2.5 pr-3">
                                                <span className="flex items-center gap-2">
                                                    {/* Catalog colour from API — isolated dynamic style. */}
                                                    <span
                                                        className={cn(
                                                            'size-3 shrink-0 rounded-sm',
                                                            !s.color && 'bg-primary-500'
                                                        )}
                                                        style={
                                                            s.color
                                                                ? { backgroundColor: s.color }
                                                                : undefined
                                                        }
                                                    />
                                                    <span className="font-medium text-neutral-900">
                                                        {s.label || s.status_key}
                                                    </span>
                                                    <CaretRight
                                                        size={12}
                                                        className="text-neutral-300 transition-colors group-hover:text-neutral-500"
                                                    />
                                                </span>
                                            </td>
                                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                                {fmtNumber(s.entered)}
                                            </td>
                                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                                {fmtNumber(s.current_stock)}
                                            </td>
                                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                                {fmtDays(s.median_days_in_stage)}
                                            </td>
                                            <td
                                                className={cn(
                                                    'py-2.5 pr-3 text-right',
                                                    s.advanced_rate == null
                                                        ? 'text-neutral-400'
                                                        : s.advanced_rate >= 50
                                                          ? 'font-semibold text-green-700'
                                                          : s.advanced_rate >= 20
                                                            ? 'font-medium text-amber-700'
                                                            : 'font-medium text-red-600'
                                                )}
                                            >
                                                {fmtPct(s.advanced_rate)}
                                            </td>
                                            <td className="py-2.5 pr-3 text-right">
                                                {s.regressed > 0 ? (
                                                    <span className="font-medium text-red-600">
                                                        {fmtNumber(s.regressed)}
                                                    </span>
                                                ) : (
                                                    <span className="text-neutral-400">0</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-xs text-neutral-400">{t('footnote')}</p>
                    </>
                )}
            </ReportSection>
        </div>
    );
}

// ── Visual stage bar ───────────────────────────────────────────────────

function StageBar({
    stage,
    maxEntered,
    onClick,
}: {
    stage: FunnelStage;
    maxEntered: number;
    onClick: () => void;
}) {
    const { t } = useTranslation('audienceManagerFunnelTab');
    const pct = Math.min(100, (stage.entered / maxEntered) * 100);
    return (
        <div
            className="group -mx-1.5 flex cursor-pointer flex-col gap-1.5 rounded-md px-1.5 py-1 hover:bg-neutral-50"
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            }}
        >
            <div className="flex items-center justify-between text-sm">
                <span className="flex min-w-0 items-center gap-2">
                    {/* Catalog colour from API — isolated dynamic style. */}
                    <span
                        className={cn('size-3 shrink-0 rounded-sm', !stage.color && 'bg-primary-500')}
                        style={stage.color ? { backgroundColor: stage.color } : undefined}
                    />
                    <span className="truncate text-neutral-700">
                        {stage.label || stage.status_key}
                    </span>
                </span>
                <span className="flex items-center gap-1 font-medium text-neutral-900">
                    {fmtNumber(stage.entered)}
                    <span className="text-xs font-normal text-neutral-500">
                        {t('stageBar.nowSuffix', { value: fmtNumber(stage.current_stock) })}
                    </span>
                    <CaretRight
                        size={12}
                        className="text-neutral-300 transition-colors group-hover:text-neutral-500"
                    />
                </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                {stage.color ? (
                    /* Per-institute catalog colour + dynamic width — inline style is the
                       right call here, isolated to this rule. */
                    <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: stage.color }}
                    />
                ) : (
                    /* Width is data-driven; colour comes from a Tailwind utility class. */
                    <div
                        className="absolute inset-y-0 left-0 rounded-full bg-primary-500"
                        style={{ width: `${pct}%` }}
                    />
                )}
            </div>
        </div>
    );
}
