import { useRef, useState, type ReactNode } from 'react';
import { createLazyFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Lightning, Tray } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    GroupDashboardShell,
    useIsInstituteAdmin,
} from '@/components/shared/crm-enhance/group-dashboard-shell';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { CrmLink } from '@/routes/dashboard/-components/crm/crm-cards';
import {
    reportErrorStatus,
    useEngagementDailyReport,
    type DailyReportEngineOption,
} from '@/services/engagement-daily-report';
import { DashboardViewSwitch, type DashboardView } from './-components/DashboardViewSwitch';
import { DailyReport } from './-components/daily-report/DailyReport';
import { EngagementOverview } from './-components/overview/EngagementOverview';
import { ReportFilterBar, type ExportKind } from './-components/daily-report/ReportFilterBar';
import { minDateIso, todayIso } from './-utils/report-format';
import {
    clampPeriod,
    isSingleDay,
    periodOfSearch,
    periodPatch,
    shiftPeriod,
    canShift,
    type PeriodSearch,
    type ReportPeriod,
} from './-utils/report-period';
import { rangeT } from './-utils/report-range-t';
import { engineDisplayName, useReportView } from './-utils/use-report-model';

export const Route = createLazyFileRoute('/engagement-engines/dashboard/')({
    component: EngagementDashboardPage,
});

const LINK_BTN =
    'inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-600';

/**
 * Engagement Dashboard, two views behind a switch in the header: the daily report (default)
 * and the 7/30/90-day overview. Only the active view mounts, so only its data is fetched.
 */
function EngagementDashboardPage() {
    const navigate = useNavigate();
    const search = useSearch({ strict: false }) as PeriodSearch & {
        engine?: string;
        view?: 'overview';
    };
    const view: DashboardView = search.view === 'overview' ? 'overview' : 'daily';
    // The engine and period stay in the URL while on the overview, so switching back restores them.
    const viewSwitch = (
        <DashboardViewSwitch
            value={view}
            onChange={(next) =>
                navigate({
                    to: '/engagement-engines/dashboard',
                    search: { ...search, view: next === 'overview' ? 'overview' : undefined },
                    replace: true,
                })
            }
        />
    );
    return view === 'overview' ? (
        <EngagementOverview viewSwitch={viewSwitch} />
    ) : (
        <DailyReportView viewSwitch={viewSwitch} />
    );
}

/**
 * The report for one engine (or all of them) over a day or a range of days. What it did, what
 * it cost and what came back, with charts for the summary, tables for the detail and an Excel /
 * PDF export. Whole-institute numbers, so admins only.
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
    const search = useSearch({ strict: false }) as PeriodSearch & { engine?: string };
    const { engine } = search;
    const engineId = engine ?? null;
    const urlPeriod = periodOfSearch(search);
    const [exporting, setExporting] = useState(false);

    const q = useEngagementDailyReport(getCurrentInstituteId() ?? '', engineId, urlPeriod, isAdmin);
    // While another period or engine loads, the previous report stays around so the engine
    // picker keeps its options, but it is not shown as the numbers for the new choice.
    const data = q.isPlaceholderData ? undefined : q.data;
    // The picker keeps the last list it was given: a failed load, or a response whose engine
    // list came back empty, must not leave it with no engines to choose from.
    const lastEngines = useRef<DailyReportEngineOption[]>([]);
    if (q.data?.engines && q.data.engines.length > 0) lastEngines.current = q.data.engines;
    const engines = q.data?.engines?.length ? q.data.engines : lastEngines.current;
    const view = useReportView(data);
    const isLoading = !q.isError && (q.isLoading || q.isPlaceholderData);

    // "Today" and the 90-day window are the institute's, not the browser's: the server rejects
    // days outside them, so the picker and the arrows stay inside them. Before the first
    // response the zone is not known yet and the browser's is used.
    const timeZone = q.data?.timezone;
    const today = todayIso(timeZone);
    const minDate = minDateIso(timeZone);
    const shownPeriod: ReportPeriod =
        urlPeriod ?? (data ? { from: data.from, to: data.to } : { from: today, to: today });

    const go = (next: PeriodSearch & { engine?: string }) =>
        navigate({ to: '/engagement-engines/dashboard', search: next, replace: true });
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

    return (
        <GroupDashboardShell
            title={tCrm('engageDash.title')}
            subtitle={tr('subtitle')}
            isAdmin={isAdmin}
            isLoading={false}
            isError={false}
            actions={
                <>
                    {viewSwitch}
                    <CrmLink href="/engagement-engines/inbox" className={LINK_BTN}>
                        <Tray size={14} />
                        <span className="text-caption">{tCrm('engageDash.inbox')}</span>
                    </CrmLink>
                    <CrmLink href="/engagement-engines" className={LINK_BTN}>
                        <Lightning size={14} />
                        <span className="text-caption">{tCrm('engageDash.engines.all')}</span>
                    </CrmLink>
                </>
            }
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
            />
            <DailyReport
                data={data}
                period={urlPeriod}
                view={view}
                isLoading={isLoading}
                isError={q.isError}
                isFetching={q.isFetching}
                errorStatus={reportErrorStatus(q.error)}
                onRetry={() => q.refetch()}
                onResetEngine={() => go({ date: search.date, from: search.from, to: search.to })}
                onResetDate={() => go({ engine })}
                onPreviousPeriod={goPrevious}
                canGoBack={canShift(shownPeriod, -1, minDate, today)}
            />
        </GroupDashboardShell>
    );
}
