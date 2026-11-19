import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceEmptyState, CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { type ReportEntry, reportHelpKey, reportTitleKey } from '../-shared/report-catalogue';
import { readReportError } from '../-shared/report-errors';
import { formatIndiaTime, indiaToday } from '../-shared/report-format';
import { useReport, useReportLocations } from '../-shared/report-hooks';
import { rangeProblem, type ReportsSearch, resolveReportFilters } from '../-shared/report-search';
import { answerColumns } from '../-shared/report-columns';
import type { ReportAnswer } from '../-shared/report-types';
import { downloadReport } from '../-shared/reports-api';
import { DayBookView } from './DayBookView';
import { DocumentsIssuedView } from './DocumentsIssuedView';
import { ExportButtons } from './ExportButtons';
import { Gstr1View } from './Gstr1View';
import { ReportFilters } from './ReportFilters';
import { ReportErrorNotice } from './ReportStates';
import { ExtraTotals, KeysetPager, ReportTable, SectionBlock } from './ReportTable';
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
    const error = query.isError ? readReportError(query.error) : null;
    const gstins = useMemo(() => {
        const fromPlaces = locations.places.map((p) => p.gstin).filter((g): g is string => !!g);
        return Array.from(new Set([...fromPlaces, ...(error?.gstins ?? [])])).sort();
    }, [locations.places, error?.gstins]);

    const download = (format: 'csv' | 'xlsx') => downloadReport(entry.api ?? '', filters, format);
    const asOf = answer?.asOf ?? (query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : null);

    return (
        <CommercePage
            navId="commerce-reports"
            anyFeature={entry.anyFeature}
            title={t(reportTitleKey(entry.id))}
            description={t(reportHelpKey(entry.id))}
            backTo={{ to: '/commerce/reports', label: t('reports.home.back') }}
            actions={<ExportButtons formats={entry.formats} onDownload={download} disabled={!!problem} />}
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
                                    <ReportWarnings warnings={answer.warnings} />
                                    <ReportBody entry={entry} answer={answer} />
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

function ReportBody({ entry, answer }: { entry: ReportEntry; answer: ReportAnswer }) {
    const { t } = useTranslation('commerce');
    if (entry.view === 'gstr1') return <Gstr1View answer={answer} />;
    if (isEmptyAnswer(answer)) {
        return <CommerceEmptyState title={t('reports.page.empty')} description={t('reports.page.emptyHelp')} />;
    }
    if (entry.view === 'documents') return <DocumentsIssuedView answer={answer} />;
    if (entry.view === 'dayBook') return <DayBookView answer={answer} />;
    const all = answerColumns(answer);
    return (
        <div className="flex flex-col gap-6">
            {answer.columns.length > 0 && (answer.rows.length > 0 || answer.totals) && (
                <ReportTable
                    columns={answer.columns}
                    rows={answer.rows}
                    totals={answer.totals}
                    testId="report-main-table"
                />
            )}
            <ExtraTotals columns={answer.columns} allColumns={all} totals={answer.totals} />
            {answer.sections.map((section) => (
                <SectionBlock key={section.key} section={section} allColumns={all} />
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
