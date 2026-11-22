import { type ReactNode, useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { MyTable } from '@/components/design-system/table';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { num } from '@/routes/commerce/-shared/commerce-api';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import {
    cancelledRows,
    codeText,
    columnLabel,
    extraTotals,
    isWordedTotal,
    screenColumns,
    sectionLabel,
    totalColumn,
    totalType,
} from '../-shared/report-columns';
import { cellText } from '../-shared/report-format';
import type { ReportCell, ReportColumn, ReportRow, ReportSection } from '../-shared/report-types';

/**
 * One report table (contract §7.2 `ReportTable`): `MyTable` columns from the
 * answer's `columns` (labels `label` / `label_hi`; a raw quantity or rate is
 * hidden when its `*_text` column is there), money right-aligned through
 * `MoneyCell`, codes in the admin's words (M2).
 *
 * A flagged row (a COD order over 10 days, a numbering gap) carries a warning
 * icon and a sentence for screen readers besides the error colour (M5); the
 * lines of a cancelled bill are struck through, their status says so (R2).
 *
 * The server's totals are not a table row: they sit in `TotalsStrip` under the
 * table, outside its scroll box, so they stay in view and never read like the
 * sum of the page on screen (M4).
 */

const NUMERIC = new Set(['MONEY', 'INT', 'QTY', 'PERCENT']);

/** The default "over N days" of the COD red flag (contract §2.9) when the answer does not say. */
const RED_FLAG_DAYS = 10;

export function ReportCellView({
    column,
    value,
    strong,
    timeOnly,
}: {
    column: ReportColumn;
    value: ReportCell;
    strong?: boolean;
    timeOnly?: boolean;
}) {
    const { t } = useTranslation('commerce');
    if (column.type === 'MONEY') {
        if (value === null || value === undefined || value === '') return <span className="block text-end">—</span>;
        return <MoneyCell value={value as number | string} className={cn(strong && 'font-medium')} />;
    }
    const text = (column.type === 'TEXT' ? codeText(column.key, value, t) : null) ?? cellText(column.type, value, timeOnly);
    return (
        <span
            className={cn(
                NUMERIC.has(column.type) ? 'block text-end tabular-nums' : 'block break-words',
                strong && 'font-medium'
            )}
        >
            {text || (NUMERIC.has(column.type) ? '—' : '')}
        </span>
    );
}

export function ReportTable({
    columns,
    rows,
    rowFlag,
    redFlagDays = RED_FLAG_DAYS,
    testId,
}: {
    columns: ReportColumn[];
    rows: ReportRow[];
    /** The sentence of a row the view flags (a numbering gap); null for a normal row. */
    rowFlag?: (row: ReportRow) => string | null;
    redFlagDays?: number;
    testId?: string;
}) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const shown = useMemo(() => screenColumns(columns), [columns]);
    // A TIME column beside a date column prints the clock only (N3).
    const hasDate = shown.some((column) => column.type === 'DATE');
    const cancelled = useMemo(() => cancelledRows(rows), [rows]);
    const content = useMemo(() => rows.map((row, index) => ({ row, index })), [rows]);

    const defs = useMemo<ColumnDef<{ row: ReportRow; index: number }>[]>(
        () =>
            shown.map((column, position) => ({
                id: column.key,
                header: columnLabel(column, lang),
                cell: ({ row: tableRow }) => {
                    const { row, index } = tableRow.original;
                    // A row the server flags (`red_flag`: COD outstanding over the limit) or the view marks.
                    const flag =
                        row.red_flag === true ? t('reports.table.redFlag', { days: redFlagDays }) : rowFlag?.(row) ?? null;
                    const struck = cancelled[index] === true;
                    return (
                        <div
                            className={cn('flex items-start gap-1', flag && 'text-danger-600', struck && 'line-through')}
                            data-tone={flag ? 'danger' : undefined}
                            data-cancelled={struck ? 'true' : undefined}
                        >
                            {flag && position === 0 && (
                                <span className="flex shrink-0 items-center pt-0.5" title={flag} data-testid="report-row-flag">
                                    <WarningCircle size={14} weight="fill" aria-hidden="true" />
                                    <span className="sr-only">{flag}</span>
                                </span>
                            )}
                            <div className="min-w-0 flex-1">
                                <ReportCellView
                                    column={column}
                                    value={row[column.key]}
                                    timeOnly={hasDate && column.type === 'TIME'}
                                />
                            </div>
                        </div>
                    );
                },
            })),
        [shown, lang, rowFlag, t, cancelled, hasDate, redFlagDays]
    );

    return (
        <div data-testid={testId}>
            <MyTable<{ row: ReportRow; index: number }>
                fillContainer
                data={{
                    content,
                    page_no: 0,
                    page_size: content.length,
                    total_elements: content.length,
                    total_pages: 1,
                    last: true,
                }}
                columns={defs}
                isLoading={false}
                error={null}
                currentPage={0}
                scrollable
                enableColumnPinning={false}
            />
        </div>
    );
}

/** Keyset paging of a register: "Previous page" / "Next page" (contract §3.6). */
export function KeysetPager({
    page,
    hasNext,
    onPrevious,
    onNext,
    busy,
}: {
    page: number;
    hasNext: boolean;
    onPrevious: () => void;
    onNext: () => void;
    busy?: boolean;
}) {
    const { t } = useTranslation('commerce');
    if (page === 0 && !hasNext) return null;
    return (
        <div className="flex items-center justify-between gap-3">
            <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                className="h-12 md:h-9"
                disable={page === 0 || busy}
                onClick={onPrevious}
            >
                <CaretLeft size={16} className="rtl:rotate-180" />
                {t('reports.table.previous')}
            </MyButton>
            <span className="text-caption text-muted-foreground">{t('reports.table.page', { page: page + 1 })}</span>
            <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                className="h-12 md:h-9"
                disable={!hasNext || busy}
                onClick={onNext}
            >
                {t('reports.table.next')}
                <CaretRight size={16} className="rtl:rotate-180" />
            </MyButton>
        </div>
    );
}

/**
 * The server's totals of one table, under it and outside its scroll box (M4):
 * first the totals of the columns on screen (named by the column), then the
 * figures beyond the columns (counts, values of their own), each drawn by the
 * type of the column with the same key anywhere in the answer; a key that is
 * no column is a count unless the server names it as money (lead decision 2).
 * A paged register says the figures are for every page, not the one on screen.
 * Nothing to show (no totals, or none that match) draws nothing (N2).
 */
export function TotalsStrip({
    columns,
    allColumns = [],
    totals,
    omit,
    paged,
    testId = 'report-extra-totals',
}: {
    columns: ReportColumn[];
    allColumns?: ReportColumn[];
    totals: ReportRow | null;
    omit?: readonly string[];
    paged?: boolean;
    testId?: string;
}) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    if (!totals) return null;
    const columnEntries = screenColumns(columns)
        .filter((column) => {
            const value = totals[column.key];
            return value !== null && value !== undefined && value !== '' && typeof value !== 'object';
        })
        .map((column): [string, unknown] => [column.key, totals[column.key]]);
    const entries: [string, unknown, boolean][] = [
        ...columnEntries.map(([key, value]): [string, unknown, boolean] => [key, value, true]),
        ...extraTotals(columns, totals, omit).map(([key, value]): [string, unknown, boolean] => [key, value, false]),
    ];
    if (entries.length === 0) return null;
    return (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid={testId}>
            <h4 className="text-caption font-medium text-foreground">
                {t(paged ? 'reports.table.totalAllPages' : 'reports.table.total')}
            </h4>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {entries.map(([key, value, isColumn]) => {
                    const column = totalColumn(key, columns, allColumns);
                    const type = totalType(key, columns, allColumns);
                    const label = column ? columnLabel(column, lang) : isWordedTotal(key) ? t(`reports.totals.${key}`) : key;
                    const plain = num(value);
                    return (
                        <div
                            key={key}
                            className="flex items-center justify-between gap-3"
                            data-total={key}
                            data-type={type}
                            data-column={isColumn ? 'true' : undefined}
                        >
                            <dt className="text-caption text-muted-foreground">{label}</dt>
                            <dd className="text-body font-medium">
                                {type === 'MONEY' ? (
                                    <MoneyCell value={value as number | string} />
                                ) : type === 'INT' ? (
                                    <span className="tabular-nums">{plain === null ? String(value) : formatNumber(plain)}</span>
                                ) : (
                                    <span className="tabular-nums">{cellText(type, value)}</span>
                                )}
                            </dd>
                        </div>
                    );
                })}
            </dl>
        </section>
    );
}

/** One titled block of a report (heading = the server's label): its table, the server's totals, or "nothing here". */
export function SectionBlock({
    section,
    allColumns,
    omitTotals,
    rowFlag,
    redFlagDays,
    paged,
    children,
}: {
    section: ReportSection;
    /** Every column of the answer, to type totals beyond this block's columns. */
    allColumns?: ReportColumn[];
    /** Totals shown elsewhere on the page (the day book's cash at the tills). */
    omitTotals?: readonly string[];
    rowFlag?: (row: ReportRow) => string | null;
    redFlagDays?: number;
    paged?: boolean;
    children?: ReactNode;
}) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    return (
        <section className="flex flex-col gap-2" data-testid={`report-section-${section.key}`}>
            <h3 className="text-subtitle font-medium text-foreground">{sectionLabel(section, lang)}</h3>
            {section.rows.length === 0 ? (
                <p className="text-caption text-muted-foreground">{t('reports.table.nothing')}</p>
            ) : (
                <ReportTable columns={section.columns} rows={section.rows} rowFlag={rowFlag} redFlagDays={redFlagDays} />
            )}
            <TotalsStrip
                columns={section.columns}
                allColumns={allColumns}
                totals={section.totals}
                omit={omitTotals}
                paged={paged}
                testId={`report-section-totals-${section.key}`}
            />
            {children}
        </section>
    );
}
