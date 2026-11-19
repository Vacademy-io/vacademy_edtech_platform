import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { num } from '@/routes/commerce/-shared/commerce-api';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceEmptyState, CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { type ReportEntry, reportHelpKey, reportTitleKey } from '../-shared/report-catalogue';
import { readReportError } from '../-shared/report-errors';
import { formatIndiaTime, indiaToday } from '../-shared/report-format';
import { KNOWN_EXTRA_TOTALS } from '../-shared/report-keys';
import { useReport, useReportLocations } from '../-shared/report-hooks';
import { rangeProblem, type ReportsSearch, resolveReportFilters } from '../-shared/report-search';
import type { ReportAnswer, ReportColumn, ReportRow } from '../-shared/report-types';
import { downloadReport } from '../-shared/reports-api';
import { DayBookView } from './DayBookView';
import { DocumentsIssuedView } from './DocumentsIssuedView';
import { ExportButtons } from './ExportButtons';
import { Gstr1View } from './Gstr1View';
import { ReportFilters } from './ReportFilters';
import { ReportErrorNotice } from './ReportStates';
import { KeysetPager, ReportTable, SectionBlock } from './ReportTable';
import { ReportWarnings } from './ReportWarnings';

const KNOWN_EXTRA = new Set<string>(KNOWN_EXTRA_TOTALS);
const COUNT_TOTALS = new Set<string>(['count', 'cancelled_count', 'customers', 'orders', 'invoices']);

/** Totals keys that are not a column of the table (count, cancelled apart…), in the server's order. */
export function extraTotals(columns: ReportColumn[], totals: ReportRow | null): [string, unknown][] {
    if (!totals) return [];
    const keys = new Set(columns.map((c) => c.key));
    return Object.entries(totals).filter(([key, value]) => !keys.has(key) && value !== null && typeof value !== 'object');
}

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
    const extras = extraTotals(answer.columns, answer.totals);
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
            {extras.length > 0 && <ExtraTotals entries={extras} />}
            {answer.sections.map((section) => (
                <SectionBlock key={section.key} section={section} />
            ))}
        </div>
    );
}

function ExtraTotals({ entries }: { entries: [string, unknown][] }) {
    const { t } = useTranslation('commerce');
    return (
        <dl className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="report-extra-totals">
            {entries.map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                    <dt className="text-caption text-muted-foreground">
                        {KNOWN_EXTRA.has(key) ? t(`reports.totals.${key}`) : key}
                    </dt>
                    <dd className="text-body">
                        {COUNT_TOTALS.has(key) ? (
                            <span className="tabular-nums">{formatNumber(num(value) ?? 0)}</span>
                        ) : (
                            <MoneyCell value={value as number | string} />
                        )}
                    </dd>
                </div>
            ))}
        </dl>
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
