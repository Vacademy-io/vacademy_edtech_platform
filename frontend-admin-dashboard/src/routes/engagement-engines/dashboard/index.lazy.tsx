import { useRef, useState } from 'react';
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
import { DailyReport } from './-components/daily-report/DailyReport';
import { ReportFilterBar, type ExportKind } from './-components/daily-report/ReportFilterBar';
import { minDateIso, shiftDay, todayIso } from './-utils/report-format';
import { engineDisplayName, useReportView } from './-utils/use-report-model';

export const Route = createLazyFileRoute('/engagement-engines/dashboard/')({
    component: EngagementDashboardPage,
});

const LINK_BTN =
    'inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-600';

/**
 * Engagement Dashboard: a daily report card for one engine (or all of them). What it did,
 * what it cost and what came back, with charts for the summary, tables for the detail and
 * an Excel / PDF export. Whole-institute numbers, so admins only.
 *
 * The engine and the day live in the URL (?engine=<id>&date=yyyy-MM-dd), so a report can be
 * shared; with no date the report is for today in the institute's time zone.
 */
function EngagementDashboardPage() {
    const { t: tCrm } = useTranslation('crmPages');
    const { t } = useTranslation('engagementDailyReport');
    const isAdmin = useIsInstituteAdmin();
    const navigate = useNavigate();
    const { engine, date } = useSearch({ strict: false }) as { engine?: string; date?: string };
    const engineId = engine ?? null;
    const [exporting, setExporting] = useState(false);

    const q = useEngagementDailyReport(
        getCurrentInstituteId() ?? '',
        engineId,
        date ?? null,
        isAdmin
    );
    // While another day or engine loads, the previous report stays around so the engine
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
    const shownDate = date ?? data?.date ?? today;

    const go = (next: { engine?: string; date?: string }) =>
        navigate({ to: '/engagement-engines/dashboard', search: next, replace: true });
    const changeDate = (value: string) => {
        if (!value) return;
        const day = value < minDate ? minDate : value > today ? today : value;
        go({ engine, date: day === today ? undefined : day });
    };

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
            subtitle={t('subtitle')}
            isAdmin={isAdmin}
            isLoading={false}
            isError={false}
            actions={
                <>
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
                onEngineChange={(id) => go({ engine: id ?? undefined, date })}
                date={shownDate}
                minDate={minDate}
                maxDate={today}
                onDateChange={changeDate}
                onPreviousDay={() => changeDate(shiftDay(shownDate, -1))}
                onNextDay={() => changeDate(shiftDay(shownDate, 1))}
                onExport={handleExport}
                exporting={exporting}
                exportDisabled={!data || !view}
            />
            <DailyReport
                data={data}
                view={view}
                isLoading={isLoading}
                isError={q.isError}
                isFetching={q.isFetching}
                errorStatus={reportErrorStatus(q.error)}
                onRetry={() => q.refetch()}
                onResetEngine={() => go({ engine: undefined, date })}
                onResetDate={() => go({ engine, date: undefined })}
                onPreviousDay={() => changeDate(shiftDay(shownDate, -1))}
                canGoBack={shownDate > minDate}
            />
        </GroupDashboardShell>
    );
}
