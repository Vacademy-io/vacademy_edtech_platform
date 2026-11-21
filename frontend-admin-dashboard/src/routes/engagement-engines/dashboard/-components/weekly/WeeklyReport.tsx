import { Stethoscope } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import type { EngagementDailyReport } from '@/services/engagement-daily-report';
import type { EngagementDiagnosis } from '@/services/engagement-diagnosis';
import type { DiagnosisViewModel } from '../../-utils/use-diagnosis-view';
import type { ReportView } from '../../-utils/use-report-model';
import { DiagnosisBody } from '../diagnosis/DiagnosisBody';
import { FunnelCard } from '../daily-report/ReportCharts';
import { KpiCards } from '../daily-report/KpiCards';
import { ReportRangeContext } from '../daily-report/range-context';
import { ReportSection, SectionError } from '../daily-report/ReportSection';
import { ReportRetryingContext } from '../daily-report/retry-context';
import { WeeklySections } from './WeeklySections';

interface WeeklyReportProps {
    diagnosis: EngagementDiagnosis | undefined;
    diagnosisView: DiagnosisViewModel | null;
    diagnosisLoading: boolean;
    diagnosisError: boolean;
    diagnosisFetching: boolean;
    onRetryDiagnosis: () => void;

    /** The report for the same 7 days: its headline numbers and funnel are the week's too. */
    report: EngagementDailyReport | undefined;
    reportView: ReportView | null;
    reportLoading: boolean;
    reportError: boolean;
    reportFetching: boolean;
    onRetryReport: () => void;
}

/**
 * The body of the weekly page: the week's headline numbers and funnel (the daily report's own
 * cards, for these 7 days), what to change, and one card per stage with the week's detail. The
 * diagnosis and the report are separate requests, so one failing leaves the other on screen.
 */
export function WeeklyReport({
    diagnosis,
    diagnosisView,
    diagnosisLoading,
    diagnosisError,
    diagnosisFetching,
    onRetryDiagnosis,
    report,
    reportView,
    reportLoading,
    reportError,
    reportFetching,
    onRetryReport,
}: WeeklyReportProps) {
    const { t } = useTranslation('engagementDailyReport');
    const numbersFailed = reportError && !report;
    const diagnosisPending = !diagnosisError && (diagnosisLoading || !diagnosisView);
    return (
        // The report is for several days, so its copy says "this period".
        <ReportRangeContext.Provider value={true}>
            <div className="flex flex-col gap-4">
                <ReportRetryingContext.Provider value={reportFetching}>
                    {numbersFailed ? (
                        <SectionError
                            message={t('diagnosis.week.numbersFailed')}
                            onRetry={onRetryReport}
                        />
                    ) : (
                        <>
                            <KpiCards
                                kpis={reportView?.kpis ?? []}
                                isLoading={reportLoading}
                                hasError={!!report && 'summary' in report.errors}
                                onRetry={onRetryReport}
                            />
                            <FunnelCard
                                data={report}
                                ctx={reportView?.ctx}
                                isLoading={reportLoading}
                                onRetry={onRetryReport}
                            />
                        </>
                    )}
                </ReportRetryingContext.Provider>

                <ReportRetryingContext.Provider value={diagnosisFetching}>
                    <ReportSection
                        icon={Stethoscope}
                        title={t('diagnosis.weekly.title')}
                        subtitle={t('diagnosis.weekly.subtitle')}
                        isLoading={diagnosisPending}
                        hasError={diagnosisError && !diagnosisView}
                        onRetry={onRetryDiagnosis}
                    >
                        {diagnosisView && (
                            <DiagnosisBody
                                view={diagnosisView}
                                scope="week"
                                kpis={reportView?.kpis ?? []}
                            />
                        )}
                    </ReportSection>

                    {diagnosis && diagnosisView ? (
                        <WeeklySections
                            diagnosis={diagnosis}
                            view={diagnosisView}
                            onRetry={onRetryDiagnosis}
                        />
                    ) : (
                        diagnosisPending && (
                            <div className="flex flex-col gap-4" aria-busy="true">
                                {[0, 1, 2].map((i) => (
                                    <Skeleton key={i} className="h-40 w-full rounded-lg" />
                                ))}
                            </div>
                        )
                    )}
                </ReportRetryingContext.Provider>
            </div>
        </ReportRangeContext.Provider>
    );
}
