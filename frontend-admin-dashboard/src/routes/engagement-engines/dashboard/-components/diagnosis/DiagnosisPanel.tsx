import { Stethoscope } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { ReportKpi } from '../../-utils/report-kpis';
import type { DiagnosisViewModel } from '../../-utils/use-diagnosis-view';
import { ReportRetryingContext } from '../daily-report/retry-context';
import { ReportSection } from '../daily-report/ReportSection';
import { DiagnosisBody } from './DiagnosisBody';

interface DiagnosisPanelProps {
    /** Undefined until the diagnosis has loaded. */
    view: DiagnosisViewModel | null;
    isLoading: boolean;
    /** The request failed. It only affects this panel: the report below is separate. */
    isError: boolean;
    isFetching: boolean;
    onRetry: () => void;
    /** The day shown is today, so "No problems today" is the right words. */
    isToday: boolean;
    /** The report's headline numbers, shown on a calm day; empty while that report is loading. */
    kpis: ReportKpi[];
}

/**
 * The top of the daily report: at most 5 problems, each with what was seen, what to do and where
 * to look; a line per stage; and a note on what the report cannot see. A failed request is a
 * small retryable note here, and the report below is not affected.
 */
export function DiagnosisPanel({
    view,
    isLoading,
    isError,
    isFetching,
    onRetry,
    isToday,
    kpis,
}: DiagnosisPanelProps) {
    const { t } = useTranslation('engagementDailyReport');
    return (
        <ReportRetryingContext.Provider value={isFetching}>
            <ReportSection
                icon={Stethoscope}
                title={t('diagnosis.title')}
                subtitle={t('diagnosis.subtitle')}
                isLoading={!isError && (isLoading || !view)}
                hasError={isError && !view}
                onRetry={onRetry}
            >
                {view && (
                    <DiagnosisBody view={view} scope={isToday ? 'today' : 'day'} kpis={kpis} />
                )}
            </ReportSection>
        </ReportRetryingContext.Provider>
    );
}
