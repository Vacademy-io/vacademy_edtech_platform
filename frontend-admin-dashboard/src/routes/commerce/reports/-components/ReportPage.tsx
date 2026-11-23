import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceEmptyState, CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { type ReportEntry, reportHelpKey, reportTitleKey } from '../-shared/report-catalogue';
import { readReportError } from '../-shared/report-errors';
import { formatIndiaDate, formatIndiaTime, indiaToday, isRunningMonth, monthRange } from '../-shared/report-format';
import { useReport, useReportLocations } from '../-shared/report-hooks';
import { rangeProblem, type ReportsSearch, resolvedMonth, resolveReportFilters } from '../-shared/report-search';
import { answerColumns } from '../-shared/report-columns';
import type { ReportAnswer, ReportFilterValues } from '../-shared/report-types';
import { downloadReport } from '../-shared/reports-api';
import { DayBookView } from './DayBookView';
import { DocumentsIssuedView } from './DocumentsIssuedView';
import { ExportButtons } from './ExportButtons';
import { type Gstr1Tab, Gstr1View } from './Gstr1View';
import { ReportCheckBlock } from './ReportCheckBlock';
import { ReportFilters } from './ReportFilters';
import { ReportErrorNotice } from './ReportStates';
import { KeysetPager, ReportTable, SectionBlock, TotalsStrip } from './ReportTable';
import { ReportWarnings } from './ReportWarnings';

const isEmptyAnswer = (answer: ReportAnswer): boolean =>
    answer.rows.length === 0 && answer.sections.every((s) => s.rows.length === 0);

/**
 * One report (contract §7.1, §7.2 `ReportPage`): header with the title, help
 * line and "Figures as of hh:mm", the filters, the warnings, the table(s)
 * with the server's totals, keyset paging for registers, and the two
 * downloads. The page shows the server's figures only: nothing is added up here.
 */
export function ReportPage({
    entry,
    search,
    onSearch,
}: {
    entry: ReportEntry;
    search: ReportsSearch;
    onSearch: (next: Partial<ReportsSearch>) => void;
}) {
    const { t } = useTranslation('commerce');
    const today = indiaToday();
    const filters = useMemo(() => resolveReportFilters(entry, search, today), [entry, search, today]);
    const problem = rangeProblem(entry, filters, today);
    const locations = useReportLocations();

    // Keyset paging: the cursors of the pages seen so far; a new filter starts again.
    const filterKey = JSON.stringify(filters);
    const [pages, setPages] = useState<{ key: string; cursors: (string | null)[] }>({ key: filterKey, cursors: [null] });
    const cursors = pages.key === filterKey ? pages.cursors : [null];
    useEffect(() => {
        if (pages.key !== filterKey) setPages({ key: filterKey, cursors: [null] });
    }, [filterKey, pages.key]);
    const cursor = cursors[cursors.length - 1] ?? null;

    const query = useReport(entry, filters, cursor, !problem);
    const answer = query.data;

    // M7: GSTINs the page has learned (a `GSTIN_REQUIRED` refusal of the report or of a
    // download) stay on offer after the refusal clears; the places add theirs.
    const [learned, setLearned] = useState<string[]>([]);
    const learn = useCallback((error: unknown) => {
        const named = readReportError(error).gstins;
        if (named.length > 0) setLearned((known) => Array.from(new Set([...known, ...named])));
    }, []);
    useEffect(() => {
        if (query.isError) learn(query.error);
    }, [query.isError, query.error, learn]);
    const gstins = useMemo(() => {
        const fromPlaces = locations.places.map((p) => p.gstin).filter((g): g is string => !!g);
        return Array.from(new Set([...fromPlaces, ...learned])).sort();
    }, [locations.places, learned]);

    const download = (format: 'csv' | 'xlsx') => downloadReport(entry.api ?? '', filters, format);
    const asOf = answer?.asOf ?? (query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : null);
    const month = entry.filters.includes('month') ? resolvedMonth(search, today) : null;

    return (
        <CommercePage
            navId="commerce-reports"
            anyFeature={entry.anyFeature}
            title={t(reportTitleKey(entry.id))}
            description={t(reportHelpKey(entry.id))}
            backTo={{ to: '/commerce/reports', label: t('reports.home.back') }}
            actions={
                <ExportButtons formats={entry.formats} onDownload={download} onError={learn} disabled={!!problem} />
            }
        >
            <div className="flex flex-col gap-4" data-testid={`report-page-${entry.id}`}>
                <ReportFilters
                    entry={entry}
                    search={search}
                    filters={filters}
                    places={locations.places}
                    gstins={gstins}
                    problem={problem}
                    onChange={onSearch}
                />
                {!problem && month && <RangeLine answer={answer} filters={filters} month={month} today={today} />}
                {entry.view === 'file' ? (
                    <GstPackNote />
                ) : (
                    !problem && (
                        <>
                            {answer && asOf && (
                                <p className="text-caption text-muted-foreground" data-testid="report-as-of">
                                    {t('reports.page.asOf', { time: formatIndiaTime(asOf) })}
                                </p>
                            )}
                            {query.isLoading && <CommerceLoadingRows rows={5} />}
                            {query.isError && (
                                <ReportErrorNotice error={query.error} onRetry={() => void query.refetch()} />
                            )}
                            {answer && !query.isError && (
                                <div className={cn('flex flex-col gap-4', query.isPlaceholderData && 'opacity-60')}>
                                    <ReportWarnings warnings={answer.warnings} sections={answer.sections} />
                                    <ReportBody
                                        entry={entry}
                                        answer={answer}
                                        tab={search.tab}
                                        onTab={(tab) => onSearch({ tab })}
                                    />
                                    {entry.kind === 'register' && (
                                        <KeysetPager
                                            page={cursors.length - 1}
                                            hasNext={!!answer.nextCursor}
                                            busy={query.isFetching}
                                            onPrevious={() =>
                                                setPages({ key: filterKey, cursors: cursors.slice(0, -1) })
                                            }
                                            onNext={() =>
                                                answer.nextCursor &&
                                                setPages({ key: filterKey, cursors: [...cursors, answer.nextCursor] })
                                            }
                                        />
                                    )}
                                </div>
                            )}
                        </>
                    )
                )}
            </div>
        </CommercePage>
    );
}

/**
 * GST month reports: the dates the figures cover, as the server answered them
 * (M1; the date boxes of other reports already say it), and a line when the
 * month is the running one: its figures are the month so far, not
 * a month to file.
 */
function RangeLine({
    answer,
    filters,
    month,
    today,
}: {
    answer: ReportAnswer | undefined;
    filters: ReportFilterValues;
    month: string | null;
    today: string;
}) {
    const { t } = useTranslation('commerce');
    const span = month ? monthRange(month, today) : null;
    const from = answer?.from ?? filters.from ?? span?.from ?? null;
    const to = answer?.to ?? filters.to ?? span?.to ?? null;
    const running = isRunningMonth(month, today);
    if (!from || !to) return null;
    return (
        <div className="flex flex-col gap-2">
            <p className="text-caption text-muted-foreground" data-testid="report-range">
                {t('reports.page.range', { from: formatIndiaDate(from), to: formatIndiaDate(to) })}
            </p>
            {running && (
                <OrderNotice tone="warning">
                    <p data-testid="report-month-so-far">
                        {t('reports.page.monthSoFar', { from: formatIndiaDate(from), to: formatIndiaDate(to) })}
                    </p>
                </OrderNotice>
            )}
        </div>
    );
}

const redFlagDaysOf = (answer: ReportAnswer): number | undefined => {
    const days = answer.filters.red_flag_days;
    return typeof days === 'number' && Number.isFinite(days) ? days : undefined;
};

function ReportBody({
    entry,
    answer,
    tab,
    onTab,
}: {
    entry: ReportEntry;
    answer: ReportAnswer;
    tab?: string;
    onTab: (tab: Gstr1Tab) => void;
}) {
    const { t } = useTranslation('commerce');
    if (entry.view === 'gstr1') return <Gstr1View answer={answer} tab={tab} onTab={onTab} />;
    if (isEmptyAnswer(answer)) {
        // N5: a report with no dates (customer dues) is not "empty in these dates".
        return entry.defaultRange === 'none' ? (
            <CommerceEmptyState title={t('reports.page.emptyNow')} />
        ) : (
            <CommerceEmptyState title={t('reports.page.empty')} description={t('reports.page.emptyHelp')} />
        );
    }
    if (entry.view === 'documents') return <DocumentsIssuedView answer={answer} />;
    if (entry.view === 'dayBook') return <DayBookView answer={answer} />;
    const all = answerColumns(answer);
    const paged = entry.kind === 'register';
    const redFlagDays = redFlagDaysOf(answer);
    return (
        <div className="flex flex-col gap-6">
            {answer.check && <ReportCheckBlock check={answer.check} columns={all} report={answer.report} />}
            {answer.columns.length > 0 && answer.rows.length > 0 && (
                <ReportTable columns={answer.columns} rows={answer.rows} redFlagDays={redFlagDays} testId="report-main-table" />
            )}
            <TotalsStrip columns={answer.columns} allColumns={all} totals={answer.totals} paged={paged} />
            {answer.sections.map((section) => (
                <SectionBlock
                    key={section.key}
                    section={section}
                    allColumns={all}
                    redFlagDays={redFlagDays}
                    paged={paged}
                />
            ))}
        </div>
    );
}

/** The GST pack is a file only: what it holds, then "Download Excel" in the header. */
function GstPackNote() {
    const { t } = useTranslation('commerce');
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid="gst-pack-note">
            <p className="text-body text-foreground">{t('reports.gstPack.holds')}</p>
            <p className="text-caption text-muted-foreground">{t('reports.gstPack.sheets')}</p>
        </div>
    );
}
