import { useRef, useState, type ReactNode } from 'react';
import { createLazyFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
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
import { DashboardActions } from './-components/DashboardActions';
import { DashboardViewSwitch, type DashboardView } from './-components/DashboardViewSwitch';
import { DailyReport } from './-components/daily-report/DailyReport';
import { HealthBanners } from './-components/daily-report/HealthBanners';
import { AllNumbers } from './-components/diagnosis/AllNumbers';
import { DiagnosisPanel } from './-components/diagnosis/DiagnosisPanel';
import { EngagementOverview } from './-components/overview/EngagementOverview';
import { ReportFilterBar, type ExportKind } from './-components/daily-report/ReportFilterBar';
import { WeeklyPage } from './-components/weekly/WeeklyPage';
import {
    isNumbersOpen,
    numbersPatch,
    viewOfSearch,
    viewPatch,
    type DashboardSearch,
} from './-utils/dashboard-search';
import { minDateIso, todayIso } from './-utils/report-format';
import {
    clampPeriod,
    isSingleDay,
    periodOfSearch,
    periodPatch,
    shiftPeriod,
    canShift,
    type ReportPeriod,
} from './-utils/report-period';
import { rangeT } from './-utils/report-range-t';
import { useDiagnosisView } from './-utils/use-diagnosis-view';
import { engineDisplayName, useReportView } from './-utils/use-report-model';

export const Route = createLazyFileRoute('/engagement-engines/dashboard/')({
    component: EngagementDashboardPage,
});

/**
 * Engagement Dashboard, three views behind a switch in the header: the daily report (default),
 * the weekly report and the 7/30/90-day overview. Only the active view mounts, so only its data
 * is fetched.
 */
function EngagementDashboardPage() {
    const navigate = useNavigate();
    const search = useSearch({ strict: false }) as DashboardSearch;
    const view: DashboardView = viewOfSearch(search);
    // The engine and period stay in the URL across the views, so switching back restores them.
    const viewSwitch = (
        <DashboardViewSwitch
            value={view}
            onChange={(next) =>
                navigate({
                    to: '/engagement-engines/dashboard',
                    search: { ...search, ...viewPatch(next) },
                    replace: true,
                })
            }
        />
    );
    if (view === 'overview') return <EngagementOverview viewSwitch={viewSwitch} />;
    if (view === 'weekly') return <WeeklyPage viewSwitch={viewSwitch} />;
    return <DailyReportView viewSwitch={viewSwitch} />;
}

/**
 * The report for one engine (or all of them) over a day or a range of days. What it did, what
 * it cost and what came back, with charts for the summary, tables for the detail and an Excel /
 * PDF export. Whole-institute numbers, so admins only.
 *
 * For a single day the page starts short: a diagnosis of what is clearly broken, with the full
 * report folded under "All numbers" (open with ?numbers=1). For a range of days there is no
 * diagnosis and the full report shows as it always did.
 *
 * The engine and the period live in the URL (?engine=<id>&date=yyyy-MM-dd for a day,
 * &from=&to= for a range), so a report can be shared; with no day the report is for today in
 * the institute's time zone.
 */
function DailyReportView({ viewSwitch }: { viewSwitch: ReactNode }) {
    const { t: tCrm } = useTranslation('crmPages');
    const { t } = useTranslation('engagementDailyReport');
    const isAdmin = useIsInstituteAdmin();
    const navigate = useNavigate();
    const search = useSearch({ strict: false }) as DashboardSearch;
    const { engine } = search;
    const engineId = engine ?? null;
    const instituteId = getCurrentInstituteId() ?? '';
    const urlPeriod = periodOfSearch(search);
    const numbersOpen = isNumbersOpen(search);
    // The diagnosis is for one day. No day in the URL is today, which the server works out.
    const singleDay = !urlPeriod || isSingleDay(urlPeriod);
    const diagnosisDay = urlPeriod?.to ?? null;
    const [exporting, setExporting] = useState(false);

    const q = useEngagementDailyReport(instituteId, engineId, urlPeriod, isAdmin);
    const diagnosisQ = useEngagementDiagnosis(
        instituteId,
        engineId,
        'DAILY',
        diagnosisDay,
        isAdmin && singleDay
    );
    const { refresh, refreshing } = useRefreshEngagementDailyReport(
        instituteId,
        engineId,
        urlPeriod
    );
    const { refresh: refreshDiagnosis, refreshing: refreshingDiagnosis } =
        useRefreshEngagementDiagnosis(instituteId, engineId, 'DAILY', diagnosisDay);
    const handleRefresh = async () => {
        try {
            await Promise.all([refresh(), singleDay ? refreshDiagnosis() : null]);
        } catch {
            toast.error(t('filter.refreshFailed'));
        }
    };
    // While another period or engine loads, the previous report stays around so the engine
    // picker keeps its options, but it is not shown as the numbers for the new choice.
    const data = q.isPlaceholderData ? undefined : q.data;
    // The picker keeps the last list it was given: a failed load, or a response whose engine
    // list came back empty, must not leave it with no engines to choose from.
    const lastEngines = useRef<DailyReportEngineOption[]>([]);
    if (q.data?.engines && q.data.engines.length > 0) lastEngines.current = q.data.engines;
    const engines = q.data?.engines?.length ? q.data.engines : lastEngines.current;
    const view = useReportView(data);
    const diagnosisView = useDiagnosisView(diagnosisQ.data);
    const isLoading = !q.isError && (q.isLoading || q.isPlaceholderData);

    // "Today" and the 90-day window are the institute's, not the browser's: the server rejects
    // days outside them, so the picker and the arrows stay inside them. Before the first
    // response the zone is not known yet and the browser's is used.
    const timeZone = q.data?.timezone;
    const today = todayIso(timeZone);
    const minDate = minDateIso(timeZone);
    const shownPeriod: ReportPeriod =
        urlPeriod ?? (data ? { from: data.from, to: data.to } : { from: today, to: today });

    // The open "All numbers" section stays open when the engine or the day changes.
    const go = (next: Omit<DashboardSearch, 'view' | 'numbers'>) =>
        navigate({
            to: '/engagement-engines/dashboard',
            search: { ...next, ...numbersPatch(numbersOpen) },
            replace: true,
        });
    // A single day that is today is left out of the URL: no day means today.
    const changePeriod = (next: ReportPeriod) => {
        const period = clampPeriod(next, minDate, today);
        go({ engine, ...periodPatch(period, today) });
    };
    // One day reads "on this day"; a range reads "in this period".
    const tr = rangeT(t, !isSingleDay(shownPeriod));
    const goPrevious = () => changePeriod(shiftPeriod(shownPeriod, -1, minDate, today));

    const handleExport = async (kind: ExportKind) => {
        if (!data || !view) return;
        setExporting(true);
        try {
            const engineName = engineId
                ? engineDisplayName(
                      data.engines.find((e) => e.id === engineId),
                      t
                  )
                : t('filter.allEngines');
            const input = { data, view, engineName, t };
            if (kind === 'xlsx') {
                const { exportReportExcel } = await import('./-utils/report-export');
                exportReportExcel(input);
            } else {
                const { exportReportPdf } = await import('./-utils/report-export-pdf');
                await exportReportPdf(input);
            }
            toast.success(t('filter.exportDone'));
        } catch {
            toast.error(t('filter.exportFailed'));
        } finally {
            setExporting(false);
        }
    };

    // A date, an engine or an access problem will not fix itself, so the report's own error
    // replaces the page (as before) instead of hiding behind a closed "All numbers".
    const reportStatus = reportErrorStatus(q.error);
    const blocked =
        q.isError && !data && reportStatus !== null && reportStatus >= 400 && reportStatus < 500;

    const report = (
        <DailyReport
            data={data}
            period={urlPeriod}
            view={view}
            isLoading={isLoading}
            isError={q.isError}
            isFetching={q.isFetching}
            errorStatus={reportStatus}
            onRetry={() => q.refetch()}
            onResetEngine={() => go({ date: search.date, from: search.from, to: search.to })}
            onResetDate={() => go({ engine })}
            onPreviousPeriod={goPrevious}
            canGoBack={canShift(shownPeriod, -1, minDate, today)}
        />
    );

    return (
        <GroupDashboardShell
            title={tCrm('engageDash.title')}
            subtitle={tr('subtitle')}
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
                period={shownPeriod}
                minDate={minDate}
                maxDate={today}
                onPeriodChange={changePeriod}
                onExport={handleExport}
                exporting={exporting}
                exportDisabled={!data || !view}
                onRefresh={handleRefresh}
                refreshing={refreshing || refreshingDiagnosis}
            />
            {singleDay && !blocked ? (
                <div className="flex flex-col gap-4">
                    {/* Opt-outs aren't a problem the diagnosis ranks, so they stay in view here. */}
                    {view && (
                        <HealthBanners
                            banners={view.banners.filter((b) => b.key.startsWith('OPT_OUTS'))}
                        />
                    )}
                    <DiagnosisPanel
                        view={diagnosisView}
                        isLoading={diagnosisQ.isLoading}
                        isError={diagnosisQ.isError}
                        isFetching={diagnosisQ.isFetching}
                        onRetry={() => diagnosisQ.refetch()}
                        isToday={(diagnosisQ.data?.to ?? shownPeriod.to) === today}
                        kpis={view?.kpis ?? []}
                    />
                    <AllNumbers
                        open={numbersOpen}
                        failed={q.isError && !data}
                        onOpenChange={(open) =>
                            navigate({
                                to: '/engagement-engines/dashboard',
                                search: { ...search, ...numbersPatch(open) },
                                replace: true,
                            })
                        }
                    >
                        {report}
                    </AllNumbers>
                </div>
            ) : (
                report
            )}
        </GroupDashboardShell>
    );
}
