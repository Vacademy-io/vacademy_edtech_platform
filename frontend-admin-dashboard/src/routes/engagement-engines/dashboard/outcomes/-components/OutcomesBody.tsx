import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyPagination } from '@/components/design-system/pagination';
import type { SearchableSelectOption } from '@/components/design-system/searchable-select';
import { useIsInstituteAdmin } from '@/components/shared/crm-enhance/group-dashboard-shell';
import { Card } from '@/components/ui/card';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNamingSettingsVersion } from '@/hooks/useNamingSettingsVersion';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import {
    fetchAllReportItems,
    reportErrorStatus,
    useEngagementDailyReport,
    useEngagementReportItems,
    type DailyReportEngineOption,
} from '@/services/engagement-daily-report';
import { useEngines } from '../../../-hooks';
import { ReportFilterBar } from '../../-components/daily-report/ReportFilterBar';
import {
    OUTCOME_TABS,
    itemsQueryFor,
    listIdOf,
    normalizeOutcomeFilter,
    type OutcomeTab,
} from '../../-utils/outcomes-params';
import { formatNumber, minDateIso, shiftDay, todayIso } from '../../-utils/report-format';
import { engineDisplayName } from '../../-utils/use-report-model';
import { reportTerms } from '../../-utils/report-terms';
import type { OutcomesSearch } from '../index';
import { useDebouncedSearch } from '../-hooks/use-debounced-search';
import { useOpenLeadProfile } from '../-hooks/use-open-lead-profile';
import {
    buildOutcomeColumns,
    listDisplayName,
    type OutcomeColumnsCtx,
} from '../-utils/outcomes-columns';
import { OutcomesFilters } from './OutcomesFilters';
import { OutcomesTable } from './OutcomesTable';

const ROUTE = '/engagement-engines/dashboard/outcomes' as const;
const PAGE_SIZES = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

/**
 * The lead side sheet is this wide wherever it opens (Recent Leads, Follow-ups, the Call Log).
 * It is a CSS variable the sheet reads, not a style of this page.
 */
const LEAD_SHEET_STYLE = { ['--sidebar-width' as string]: '565px' };

/** Words for each tab's empty list. */
const EMPTY_KEY: Record<OutcomeTab, string> = {
    leads: 'leads',
    demos: 'demos',
    status: 'status',
    conversions: 'conversions',
    templates: 'templates',
};

/**
 * Leads & outcomes: for one engine (or all) and one day, the people behind the daily report's
 * numbers. Five lists, one per tab, each a full-width table with filter chips, search, paging
 * and an Excel export of the whole list. The Templates list is of WhatsApp templates, not
 * people: no lead search, and a row opens nothing. Everything that picks a list is in the URL, so a link
 * from the report (or one you share) opens exactly this view; a row opens the lead's profile.
 */
export function OutcomesBody() {
    const { t } = useTranslation('engagementDailyReport');
    const navigate = useNavigate();
    const isAdmin = useIsInstituteAdmin();
    const params = useSearch({ strict: false }) as OutcomesSearch;
    const instituteId = getCurrentInstituteId() ?? '';

    const tab: OutcomeTab = params.tab ?? 'leads';
    const filter = normalizeOutcomeFilter(tab, params.filter);
    // The templates have no lead to search for (and nothing in the URL's `search` applies).
    const searchable = tab !== 'templates';
    const searchText = searchable ? params.search?.trim() ?? '' : '';
    const engineId = params.engine ?? null;
    const page = Math.max(1, params.page ?? 1) - 1;
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [exporting, setExporting] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);

    // The institute's own words (Settings > Naming), refreshed when they change.
    const namingVersion = useNamingSettingsVersion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const terms = useMemo(() => reportTerms(), [namingVersion]);

    // The report for the same engine and day gives the institute's time zone and the lists to
    // pick from. It is cached on the server and shared with the report page; the lists below
    // work without it.
    const report = useEngagementDailyReport(instituteId, engineId, params.date ?? null, isAdmin);
    const engines = useEngines();
    const engineOptions = useMemo<DailyReportEngineOption[]>(
        () =>
            (engines.data ?? []).map((e) => ({
                id: e.id,
                name: e.name,
                status: e.status,
                system: !!e.systemManaged,
            })),
        [engines.data]
    );

    // "Today" and the 90-day window are the institute's, as on the report. Until a response
    // says which zone that is, the browser's is used.
    const reportZone = report.data?.timezone || null;
    const today = todayIso(reportZone);
    const minDate = minDateIso(reportZone);
    const shownDate = params.date ?? report.data?.date ?? today;

    const query = itemsQueryFor(tab, filter);
    const items = useEngagementReportItems(
        {
            instituteId,
            engineId,
            date: shownDate,
            kind: query.kind,
            filter: query.filter,
            search: searchText || undefined,
            page,
            size: pageSize,
        },
        isAdmin
    );
    const timeZone = reportZone || items.data?.timezone || null;

    const update = useCallback(
        (patch: Partial<OutcomesSearch>) => {
            // Anything but the page itself puts the list back on its first page.
            const next: OutcomesSearch = { ...params, page: undefined, ...patch };
            navigate({ to: ROUTE, search: next, replace: true });
        },
        [navigate, params]
    );

    const changeDate = (value: string) => {
        if (!value) return;
        update({ date: value < minDate ? minDate : value > today ? today : value });
    };
    const changeTab = (next: string) =>
        update({
            tab: next as OutcomeTab,
            filter: undefined,
            ...(next === 'templates' ? { search: undefined } : {}),
        });

    const [searchInput, setSearchInput] = useDebouncedSearch(searchText, (value) =>
        update({ search: value || undefined })
    );

    const openSheet = useCallback(() => setSheetOpen(true), []);
    const openLead = useOpenLeadProfile(openSheet);

    const columnsCtx: OutcomeColumnsCtx = {
        t,
        terms,
        timeZone,
        showEngine: engineId === null,
        openLead,
    };
    const columns = useMemo(
        () => buildOutcomeColumns(tab, columnsCtx),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tab, t, terms, timeZone, engineId, openLead]
    );

    const listOptions = useMemo<SearchableSelectOption[]>(
        () =>
            // Not the previous engine's lists while another engine's report loads.
            (report.isPlaceholderData ? [] : report.data?.lists ?? []).map((l) => {
                const name = listDisplayName(l, t, terms);
                return {
                    value: l.listId,
                    label: `${name} (${formatNumber(l.leadsAdded)})`,
                    keywords: [name],
                };
            }),
        [report.data?.lists, report.isPlaceholderData, t, terms]
    );
    const rows = items.data?.rows ?? [];
    const total = items.data?.total ?? 0;
    // A page past the end (a narrower search, a shared link) goes back to the first page.
    useEffect(() => {
        if (items.data && items.data.rows.length === 0 && items.data.total > 0 && page > 0) {
            update({ page: undefined });
        }
    }, [items.data, page, update]);
    const selectedListId = listIdOf(filter);
    const selectedListName = selectedListId
        ? rows.find((r) => r.listId === selectedListId)?.listName?.trim() || undefined
        : undefined;

    const engineName = engineId
        ? engineDisplayName(
              engineOptions.find((e) => e.id === engineId) ??
                  report.data?.engines.find((e) => e.id === engineId),
              t
          )
        : t('filter.allEngines');

    // Every row of the list, not only the page on screen (the server caps one page at 500).
    const handleExport = async () => {
        if (!items.data) return;
        setExporting(true);
        try {
            const all = await fetchAllReportItems(
                {
                    instituteId,
                    engineId,
                    date: shownDate,
                    kind: query.kind,
                    filter: query.filter,
                    search: searchText || undefined,
                },
                total
            );
            const { exportOutcomesExcel } = await import('../-utils/outcomes-export');
            exportOutcomesExcel({
                columns: buildOutcomeColumns(tab, { ...columnsCtx, forExport: true }),
                rows: all.rows,
                sheetName: t(`outcomesPage.tab.${tab}`),
                tab,
                engineName,
                engineId,
                date: shownDate,
            });
            if (all.truncated) {
                toast.warning(
                    t('outcomesPage.export.capped', {
                        shown: formatNumber(all.rows.length),
                        total: formatNumber(all.total),
                    })
                );
            } else {
                toast.success(t('outcomesPage.export.done'));
            }
        } catch {
            toast.error(t('filter.exportFailed'));
        } finally {
            setExporting(false);
        }
    };

    const errorStatus = reportErrorStatus(items.error);
    const failed = items.isError && !items.data;
    const hasNarrowing = !!searchText || !!filter;
    const emptyKey = searchText ? 'searched' : filter ? 'filtered' : EMPTY_KEY[tab];

    return (
        <SidebarProvider
            style={LEAD_SHEET_STYLE}
            defaultOpen={false}
            open={sheetOpen}
            onOpenChange={setSheetOpen}
        >
            <div className="flex min-w-0 flex-1 flex-col gap-4">
                <ReportFilterBar
                    engines={engineOptions}
                    engineId={engineId}
                    onEngineChange={(id) => update({ engine: id ?? undefined })}
                    date={shownDate}
                    minDate={minDate}
                    maxDate={today}
                    onDateChange={changeDate}
                    onPreviousDay={() => changeDate(shiftDay(shownDate, -1))}
                    onNextDay={() => changeDate(shiftDay(shownDate, 1))}
                    onExport={handleExport}
                    exporting={exporting}
                    exportDisabled={!items.data || total === 0}
                    exportKinds={['xlsx']}
                />

                <Tabs value={tab} onValueChange={changeTab}>
                    <TabsList
                        aria-label={t('outcomesPage.tabsLabel')}
                        className="h-auto w-full flex-wrap justify-start sm:w-fit"
                    >
                        {OUTCOME_TABS.map((key) => (
                            <TabsTrigger key={key} value={key}>
                                {t(`outcomesPage.tab.${key}`)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <TabsContent value={tab} className="mt-4">
                        <Card className="flex flex-col gap-4 rounded-xl border-neutral-200 p-4 shadow-sm">
                            <OutcomesFilters
                                tab={tab}
                                filter={filter}
                                onFilterChange={(next) => update({ filter: next })}
                                listOptions={listOptions}
                                selectedListName={selectedListName}
                                terms={terms}
                            />

                            <div className="flex flex-wrap items-center justify-between gap-3">
                                {searchable && (
                                    <div className="relative w-full sm:w-80">
                                        <MagnifyingGlass
                                            size={16}
                                            aria-hidden="true"
                                            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                                        />
                                        <MyInput
                                            inputType="text"
                                            size="medium"
                                            inputPlaceholder={t('outcomesPage.search.placeholder')}
                                            input={searchInput}
                                            onChangeFunction={(event) =>
                                                setSearchInput(event.target.value)
                                            }
                                            aria-label={t('outcomesPage.search.label')}
                                            className="ps-9 sm:w-full"
                                        />
                                    </div>
                                )}
                                <p
                                    role="status"
                                    aria-live="polite"
                                    className="tabular-nums text-neutral-600"
                                >
                                    <span className="text-body">
                                        {items.data
                                            ? t('outcomesPage.results', {
                                                  count: total,
                                                  total: formatNumber(total),
                                              })
                                            : ''}
                                    </span>
                                </p>
                            </div>

                            {failed ? (
                                <ItemsError
                                    status={errorStatus}
                                    retrying={items.isFetching}
                                    onRetry={() => items.refetch()}
                                    onResetDate={() => update({ date: undefined })}
                                    onResetEngine={() => update({ engine: undefined })}
                                />
                            ) : items.isLoading ? (
                                <OutcomesTable
                                    columns={columns}
                                    rows={[]}
                                    isLoading
                                    onOpenRow={searchable ? openLead : undefined}
                                />
                            ) : rows.length === 0 ? (
                                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-8 text-center">
                                    <p className="font-semibold text-neutral-800">
                                        <span className="text-subtitle">
                                            {t('outcomesPage.empty.title')}
                                        </span>
                                    </p>
                                    <p className="max-w-md text-neutral-500">
                                        <span className="text-body">
                                            {emptyKey === 'searched'
                                                ? t('outcomesPage.empty.searched', {
                                                      query: searchText,
                                                  })
                                                : t(`outcomesPage.empty.${emptyKey}`)}
                                        </span>
                                    </p>
                                    {hasNarrowing && (
                                        <MyButton
                                            buttonType="secondary"
                                            scale="medium"
                                            onClick={() =>
                                                update({ search: undefined, filter: undefined })
                                            }
                                        >
                                            {t('outcomesPage.empty.clear')}
                                        </MyButton>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <OutcomesTable
                                        columns={columns}
                                        rows={rows}
                                        stale={items.isPlaceholderData}
                                        onOpenRow={searchable ? openLead : undefined}
                                    />
                                    <MyPagination
                                        currentPage={page}
                                        totalPages={Math.max(1, Math.ceil(total / pageSize))}
                                        onPageChange={(next) =>
                                            update({ page: next === 0 ? undefined : next + 1 })
                                        }
                                        totalElements={total}
                                        pageSize={pageSize}
                                        onPageSizeChange={(size) => {
                                            setPageSize(size);
                                            update({ page: undefined });
                                        }}
                                        pageSizeOptions={PAGE_SIZES}
                                    />
                                </>
                            )}
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>

            {/* The same lead side sheet Recent Leads, Follow-ups and the Call Log open. */}
            <StudentSidebar defaultLeadProfile />
        </SidebarProvider>
    );
}

interface ItemsErrorProps {
    status: number | null;
    retrying: boolean;
    onRetry: () => void;
    onResetDate: () => void;
    onResetEngine: () => void;
}

/** A list that could not load: each cause gets its own words and its own way out. */
function ItemsError({ status, retrying, onRetry, onResetDate, onResetEngine }: ItemsErrorProps) {
    const { t } = useTranslation('engagementDailyReport');
    const kind =
        status === 400
            ? 'badDate'
            : status === 404
              ? 'noEngine'
              : status === 403
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
                    disable={retrying}
                    onClick={action.run}
                >
                    {action.label}
                </MyButton>
            )}
        </div>
    );
}
