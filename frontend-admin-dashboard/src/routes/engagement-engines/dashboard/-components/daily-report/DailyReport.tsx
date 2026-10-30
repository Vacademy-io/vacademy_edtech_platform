import { useMemo } from 'react';
import { CalendarBlank, Info, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import type { EngagementDailyReport } from '@/services/engagement-daily-report';
import { failedSectionNames } from '../../-utils/report-errors';
import { daysAgo, formatTimeInZone, REPLY_WINDOW_DAYS } from '../../-utils/report-format';
import { isSingleDay, type ReportPeriod } from '../../-utils/report-period';
import { rangeT } from '../../-utils/report-range-t';
import type { ReportView } from '../../-utils/use-report-model';
import { ChannelsCard, CostBreakdownCard, FunnelCard, TrendCard } from './ReportCharts';
import { ReportSections } from './ReportSections';
import { HealthBanners } from './HealthBanners';
import { KpiCards } from './KpiCards';
import { SectionError } from './ReportSection';
import { ReportRangeContext } from './range-context';
import { ReportRetryingContext } from './retry-context';

/** True when nothing at all happened in the period, so the detail sections would all be empty. */
const isQuietDay = (data: EngagementDailyReport): boolean => {
    const s = data.summary;
    if (!s) return false;
    return [
        s.leadsAdded,
        s.decisions,
        s.failed,
        s.contacted,
        s.emailsSent,
        s.whatsappSent,
        s.inAppSent,
        s.callsPlaced,
        s.delivered,
        s.replies,
        s.callsConnected,
        s.demosBooked,
        s.demosScheduled,
        s.conversions,
        s.statusChanges,
        s.optOuts,
        s.creditsSpent,
        // Templates the engine drafted are activity too, even on a day nothing went out.
        data.newTemplates?.created,
    ].every((n) => !n);
};

function Notice({ children }: { children: React.ReactNode }) {
    return (
        <p className="flex items-start gap-2 rounded-lg border border-info-200 bg-info-50 p-3 text-info-700">
            <Info size={16} weight="fill" className="mt-0.5 shrink-0" />
            <span className="text-caption">{children}</span>
        </p>
    );
}

interface DailyReportProps {
    /** Undefined while a new period or engine is loading. */
    data: EngagementDailyReport | undefined;
    /** The period asked for (null = today); tells the wording whether it is a range while loading. */
    period: ReportPeriod | null;
    view: ReportView | null;
    isLoading: boolean;
    /** The last request failed. It only replaces the page when there is no report to show. */
    isError: boolean;
    /** The report is being fetched (again): "Try again" buttons show it. */
    isFetching: boolean;
    /** HTTP status of that failure: 400 bad date or range, 403 no access, 404 unknown engine. */
    errorStatus: number | null;
    onRetry: () => void;
    onResetEngine: () => void;
    onResetDate: () => void;
    /** Moves the report to the period just before this one. */
    onPreviousPeriod: () => void;
    canGoBack: boolean;
}

/** The body of the page: health banners, headline numbers, charts, then the detail tables. */
export function DailyReport({
    data,
    period,
    view,
    isLoading,
    isError,
    isFetching,
    errorStatus,
    onRetry,
    onResetEngine,
    onResetDate,
    onPreviousPeriod,
    canGoBack,
}: DailyReportProps) {
    const { t: plainT } = useTranslation('engagementDailyReport');
    // One day reads "on this day"; a range reads "in this period".
    const range = data ? data.days > 1 : !!period && !isSingleDay(period);
    const t = useMemo(() => rangeT(plainT, range), [plainT, range]);

    // A failed refresh must not blank a report that already loaded, so the full-page error is
    // only for when there is nothing to show.
    if (isError && !data) {
        // Each cause gets its own words and its own way out.
        const kind =
            errorStatus === 400
                ? 'badDate'
                : errorStatus === 404
                  ? 'noEngine'
                  : errorStatus === 403
                    ? 'noAccess'
                    : 'generic';
        const action =
            kind === 'badDate'
                ? { label: t('error.resetDate'), run: onResetDate }
                : kind === 'noEngine'
                  ? { label: t('error.resetEngine'), run: onResetEngine }
                  : kind === 'generic'
                    ? { label: t('retry'), run: onRetry }
                    : null;
        return (
            <div
                role="alert"
                className="flex flex-col items-center gap-3 rounded-xl border border-danger-200 bg-danger-50 p-8 text-center"
            >
                <WarningCircle size={28} weight="fill" className="text-danger-600" />
                <p className="font-semibold text-neutral-900">
                    <span className="text-subtitle">{t(`error.${kind}.title`)}</span>
                </p>
                <p className="max-w-md text-neutral-600">
                    <span className="text-body">{t(`error.${kind}.text`)}</span>
                </p>
                {action && (
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        disable={isFetching}
                        onClick={action.run}
                    >
                        {action.label}
                    </MyButton>
                )}
            </div>
        );
    }

    const hasSectionErrors = !!data && Object.keys(data.errors).length > 0;
    // Zeros from a query that failed are not a quiet day.
    const quiet = !!data && !hasSectionErrors && isQuietDay(data);
    const stillArriving =
        !!data && !!data.to && daysAgo(data.to, data.timezone) < REPLY_WINDOW_DAYS;
    const chartProps = { data, isLoading, onRetry };

    // Shown in the institute's time zone, the one the footer names and the days follow.
    const generated = data?.generatedAt ? formatTimeInZone(data.generatedAt, data.timezone) : '';
    // "too_many": the period has more messages than delivery and replies can be read for. That is
    // not a failure, so it gets its own note instead of the "couldn't load" one.
    const errors = data?.errors ?? {};
    const tooMany = Object.values(errors).includes('too_many');
    const failedErrors = Object.fromEntries(
        Object.entries(errors).filter(([, reason]) => reason !== 'too_many')
    );

    return (
        <ReportRangeContext.Provider value={range}>
            <ReportRetryingContext.Provider value={isFetching}>
                <div className="flex flex-col gap-4">
                    {isError && data && (
                        <SectionError message={t('refreshFailed')} onRetry={onRetry} />
                    )}
                    {hasSectionErrors && data && Object.keys(failedErrors).length > 0 && (
                        <Notice>
                            {t('partialNote', { sections: failedSectionNames(failedErrors, t) })}
                        </Notice>
                    )}
                    {tooMany && <Notice>{t('tooManyNote')}</Notice>}
                    {stillArriving && <Notice>{t('recentNote')}</Notice>}
                    {view && <HealthBanners banners={view.banners} />}

                    <KpiCards
                        kpis={view?.kpis ?? []}
                        isLoading={isLoading}
                        hasError={!!data && 'summary' in data.errors}
                        onRetry={onRetry}
                    />

                    {quiet ? (
                        <>
                            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-8 text-center">
                                <CalendarBlank size={28} className="text-neutral-400" />
                                <p className="font-semibold text-neutral-800">
                                    <span className="text-subtitle">{t('emptyDay.title')}</span>
                                </p>
                                <p className="max-w-md text-neutral-500">
                                    <span className="text-body">{t('emptyDay.text')}</span>
                                </p>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    disable={!canGoBack}
                                    onClick={onPreviousPeriod}
                                >
                                    {t('emptyDay.previous')}
                                </MyButton>
                            </div>
                            <TrendCard {...chartProps} />
                        </>
                    ) : (
                        <>
                            <TrendCard {...chartProps} />
                            <div className="grid gap-4 lg:grid-cols-2">
                                <FunnelCard {...chartProps} ctx={view?.ctx} />
                                <ChannelsCard {...chartProps} ctx={view?.ctx} />
                            </div>
                            <CostBreakdownCard {...chartProps} />
                            <ReportSections data={data} view={view} onRetry={onRetry} />
                        </>
                    )}

                    {data && data.timezone && (
                        <p className="text-neutral-500">
                            <span className="text-caption">
                                {generated
                                    ? t('foot.withTime', {
                                          timezone: data.timezone,
                                          time: generated,
                                      })
                                    : t('foot.timezoneOnly', { timezone: data.timezone })}
                            </span>
                        </p>
                    )}
                </div>
            </ReportRetryingContext.Provider>
        </ReportRangeContext.Provider>
    );
}
