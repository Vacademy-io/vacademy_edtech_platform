/**
 * Reports Center — Cohort Analysis tab.
 *
 * Leads grouped by ACQUISITION MONTH (GET /v1/reports/cohort-analysis), showing how each cohort
 * matured: how many converted, the revenue they produced, revenue per acquired lead, and how long
 * conversion took. Pick a wider date range (90d / custom) to see more cohorts.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChartLineUp, Stack } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { fetchCohortAnalysis, cohortQueryKey } from '../-services/get-revenue-reports';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    convRateClass,
    fmtCurrency,
    fmtDays,
    fmtNumber,
    fmtPct,
    type ReportTabProps,
} from './report-shared';

/** "2026-06" → "Jun 2026" (locale-aware month/year formatting). */
function fmtCohortLabel(cohort: string): string {
    const [y, m] = cohort.split('-').map(Number);
    if (!y || !m) return cohort;
    const d = new Date(Date.UTC(y, m - 1, 1));
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function CohortTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerCohortTab');
    const params = { instituteId, fromDate, toDate, teamId, counsellorUserId };
    const query = useQuery({
        queryKey: cohortQueryKey(params),
        queryFn: () => fetchCohortAnalysis(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError)
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;

    const currency = query.data?.currency ?? 'INR';
    const cohorts = query.data?.cohorts ?? [];
    const peakRevenue = Math.max(1, ...cohorts.map((c) => c.revenue));

    return (
        <ReportSection
            title={t('section.title')}
            icon={<Stack size={18} />}
            actions={
                <ExportWithColumnPickerButton
                    filename={`cohort-analysis_${fromDate}_${toDate}.csv`}
                    disabled={cohorts.length === 0}
                    getHeadersAndRows={() => ({
                        headers: [
                            t('csv.headers.cohort'),
                            t('csv.headers.leads'),
                            t('csv.headers.converted'),
                            t('csv.headers.convPct'),
                            t('csv.headers.revenue'),
                            t('csv.headers.avgDealValue'),
                            t('csv.headers.revenuePerLead'),
                            t('csv.headers.medianDaysToConvert'),
                        ],
                        rows: cohorts.map((c) => [
                            c.cohort,
                            c.leads,
                            c.converted,
                            c.conversion_rate,
                            c.revenue,
                            c.avg_deal_value,
                            c.revenue_per_lead,
                            c.median_days_to_convert,
                        ]),
                    })}
                />
            }
        >
            {cohorts.length === 0 ? (
                <EmptyHint message={t('emptyHint')} />
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                <th className="py-2 pe-3">{t('table.headers.cohort')}</th>
                                <th className="py-2 pe-3 text-end">{t('table.headers.leads')}</th>
                                <th className="py-2 pe-3 text-end">
                                    {t('table.headers.converted')}
                                </th>
                                <th className="py-2 pe-3 text-end">
                                    {t('table.headers.convPct')}
                                </th>
                                <th className="py-2 pe-3 text-end">
                                    {t('table.headers.revenue')}
                                </th>
                                <th className="py-2 pe-3 text-end">
                                    {t('table.headers.avgDeal')}
                                </th>
                                <th className="py-2 pe-3 text-end">
                                    {t('table.headers.revPerLead')}
                                </th>
                                <th className="py-2 pe-3 text-end">
                                    {t('table.headers.medianDays')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {cohorts.map((c) => (
                                <tr
                                    key={c.cohort}
                                    className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                >
                                    <td className="py-2.5 pr-3 font-medium text-neutral-900">
                                        {fmtCohortLabel(c.cohort)}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right text-neutral-800">
                                        {fmtNumber(c.leads)}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right text-neutral-800">
                                        {fmtNumber(c.converted)}
                                    </td>
                                    <td
                                        className={cn(
                                            'py-2.5 pr-3 text-right',
                                            convRateClass(c.conversion_rate)
                                        )}
                                    >
                                        {fmtPct(c.conversion_rate)}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100 sm:block">
                                                <div
                                                    className="h-full rounded-full bg-green-500"
                                                    style={{
                                                        width: `${(c.revenue / peakRevenue) * 100}%`,
                                                    }}
                                                />
                                            </div>
                                            <span className="font-semibold text-green-700">
                                                {fmtCurrency(c.revenue, currency)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="py-2.5 pr-3 text-right text-neutral-800">
                                        {fmtCurrency(c.avg_deal_value, currency)}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right text-neutral-800">
                                        {fmtCurrency(c.revenue_per_lead, currency)}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right text-neutral-600">
                                        {fmtDays(c.median_days_to_convert)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <p className="flex items-center gap-1.5 text-xs text-neutral-400">
                <ChartLineUp size={13} />
                {t('footnote')}
            </p>
        </ReportSection>
    );
}
