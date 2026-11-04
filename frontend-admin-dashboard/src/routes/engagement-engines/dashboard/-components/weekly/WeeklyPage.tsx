import { useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    GroupDashboardShell,
    useIsInstituteAdmin,
} from '@/components/shared/crm-enhance/group-dashboard-shell';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    reportErrorStatus,
    useEngagementDailyReport,
    useRefreshEngagementDailyReport,
    type DailyReportEngineOption,
} from '@/services/engagement-daily-report';
import {
    useEngagementDiagnosis,
    useRefreshEngagementDiagnosis,
} from '@/services/engagement-diagnosis';
import type { DashboardSearch } from '../../-utils/dashboard-search';
import { minDateIso, todayIso } from '../../-utils/report-format';
import { periodOfSearch, periodPatch } from '../../-utils/report-period';
import { weekEndingOn } from '../../-utils/report-week';
import { useDiagnosisView } from '../../-utils/use-diagnosis-view';
import { engineDisplayName, useReportView } from '../../-utils/use-report-model';
import { DashboardActions } from '../DashboardActions';
import { ReportErrorState } from '../daily-report/ReportErrorState';
import { ReportFilterBar, type ExportKind } from '../daily-report/ReportFilterBar';
import { WeekPicker } from '../period/WeekPicker';
import { WeeklyReport } from './WeeklyReport';

/**
 * The weekly report: the same engine picker, a week to pick (the 7 days ending on a chosen day),
 * the week's headline numbers and funnel, what to change, and the week's detail per stage, with
 * an Excel / PDF export. Whole-institute numbers, so admins only.
 *
 * It lives in the URL (?view=weekly&engine=<id>&date=yyyy-MM-dd), where `date` is the week's last
 * day and no date means a week ending today in the institute's time zone.
 */
export function WeeklyPage({ viewSwitch }: { viewSwitch: ReactNode }) {
    const { t: tCrm } = useTranslation('crmPages');
    const { t } = useTranslation('engagementDailyReport');
    const isAdmin = useIsInstituteAdmin();
    const navigate = useNavigate();
    const search = useSearch({ strict: false }) as DashboardSearch;
    const engineId = search.engine ?? null;
    const instituteId = getCurrentInstituteId() ?? '';
    // The week's last day as the URL names it; null = today, which the server works out itself.
    const urlEnd = periodOfSearch(search)?.to ?? null;
    const [exporting, setExporting] = useState(false);

    const diagnosisQ = useEngagementDiagnosis(instituteId, engineId, 'WEEKLY', urlEnd, isAdmin);
    const diagnosis = diagnosisQ.data;

    // With no day in the URL the week's first day depends on the institute's "today", which only
    // a response knows (the browser may be in another zone): the report waits for the diagnosis,
    // or, if that failed, falls back to the browser's today so the numbers still show.
    const reportEnd = urlEnd ?? diagnosis?.to ?? (diagnosisQ.isError ? todayIso(undefined) : null);
    const reportPeriod = reportEnd ? weekEndingOn(reportEnd) : null;
    const reportQ = useEngagementDailyReport(
        instituteId,
        engineId,
        reportPeriod,
        isAdmin && !!reportPeriod
    );
    // While another week or engine loads, the previous report stays around so the engine picker
    // keeps its options, but it is not shown as the numbers for the new choice.
    const report = reportQ.isPlaceholderData ? undefined : reportQ.data;
    const reportView = useReportView(report);
    const diagnosisView = useDiagnosisView(diagnosis, {
        emailRepliesTracked: report?.email?.repliesTracked,
    });

    // The picker keeps the last list it was given, as on the daily page.
    const lastEngines = useRef<DailyReportEngineOption[]>([]);
    if (reportQ.data?.engines && reportQ.data.engines.length > 0) {
        lastEngines.current = reportQ.data.engines;
    }
    const engines = reportQ.data?.engines?.length ? reportQ.data.engines : lastEngines.current;

    // "Today" and the 90-day window are the institute's; the zone of the last response is kept
    // while the next one loads so the picker does not jump.
    const lastZone = useRef<string | undefined>(undefined);
    const zone = diagnosis?.timezone || reportQ.data?.timezone || undefined;
    if (zone) lastZone.current = zone;
    const timeZone = zone ?? lastZone.current;
    const today = todayIso(timeZone);
    const minDate = minDateIso(timeZone);
    const end = urlEnd ?? diagnosis?.to ?? today;

    const { refresh: refreshReport, refreshing: refreshingReport } =
        useRefreshEngagementDailyReport(instituteId, engineId, reportPeriod);
    const { refresh: refreshDiagnosis, refreshing: refreshingDiagnosis } =
        useRefreshEngagementDiagnosis(instituteId, engineId, 'WEEKLY', urlEnd);
    const handleRefresh = async () => {
        try {
            await Promise.all([reportPeriod ? refreshReport() : null, refreshDiagnosis()]);
        } catch {
            toast.error(t('filter.refreshFailed'));
        }
    };

    const go = (next: Omit<DashboardSearch, 'view'>) =>
        navigate({
            to: '/engagement-engines/dashboard',
            search: { ...next, view: 'weekly' },
            replace: true,
        });
    // A week ending today is left out of the URL: no day means today.
    const changeEnd = (next: string) =>
        go({ engine: search.engine, ...periodPatch({ from: next, to: next }, today) });

    const handleExport = async (kind: ExportKind) => {
        if (!diagnosis || !diagnosisView) return;
        setExporting(true);
        try {
            const engineName = engineId
                ? engineDisplayName(
                      engines.find((e) => e.id === engineId),
                      t
                  )
                : t('filter.allEngines');
            const input = {
                diagnosis,
                view: diagnosisView,
                kpis: reportView?.kpis ?? [],
                engineName,
                t,
            };
            if (kind === 'xlsx') {
                const { exportWeeklyExcel } = await import('../../-utils/report-export-weekly');
                exportWeeklyExcel(input);
            } else {
                const { exportWeeklyPdf } = await import('../../-utils/report-export-weekly-pdf');
                await exportWeeklyPdf(input);
            }
            toast.success(t('filter.exportDone'));
        } catch {
            toast.error(t('filter.exportFailed'));
        } finally {
            setExporting(false);
        }
    };

    // A date, an engine or an access problem will not fix itself: it replaces the page, as on the daily one.
    const status = diagnosisQ.isError && !diagnosis ? reportErrorStatus(diagnosisQ.error) : null;
    const blocked = status !== null && status >= 400 && status < 500;

    return (
        <GroupDashboardShell
            title={tCrm('engageDash.title')}
            subtitle={t('diagnosis.weekly.pageSubtitle')}
            isAdmin={isAdmin}
            isLoading={false}
            isError={false}
            actions={<DashboardActions viewSwitch={viewSwitch} />}
        >
            <ReportFilterBar
                engines={engines}
                engineId={engineId}
                onEngineChange={(id) =>
                    go({
                        engine: id ?? undefined,
                        date: search.date,
                        from: search.from,
                        to: search.to,
                    })
                }
                period={weekEndingOn(end)}
                minDate={minDate}
                maxDate={today}
                onPeriodChange={() => undefined}
                periodControl={
                    <WeekPicker end={end} onChange={changeEnd} minDate={minDate} today={today} />
                }
                onExport={handleExport}
                exporting={exporting}
                exportDisabled={!diagnosis || !diagnosisView}
                onRefresh={handleRefresh}
                refreshing={refreshingReport || refreshingDiagnosis}
            />
            {blocked ? (
                <ReportErrorState
                    status={status}
                    range
                    isFetching={diagnosisQ.isFetching}
                    onRetry={() => diagnosisQ.refetch()}
                    onResetEngine={() =>
                        go({ date: search.date, from: search.from, to: search.to })
                    }
                    onResetDate={() => go({ engine: search.engine })}
                />
            ) : (
                <WeeklyReport
                    diagnosis={diagnosis}
                    diagnosisView={diagnosisView}
                    diagnosisLoading={diagnosisQ.isLoading}
                    diagnosisError={diagnosisQ.isError}
                    diagnosisFetching={diagnosisQ.isFetching}
                    onRetryDiagnosis={() => diagnosisQ.refetch()}
                    report={report}
                    reportView={reportView}
                    reportLoading={!report && !reportQ.isError}
                    reportError={reportQ.isError}
                    reportFetching={reportQ.isFetching}
                    onRetryReport={() => reportQ.refetch()}
                />
            )}
        </GroupDashboardShell>
    );
}
