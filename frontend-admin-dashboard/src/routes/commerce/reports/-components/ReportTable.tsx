import { type ReactNode, useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { MyTable } from '@/components/design-system/table';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { num } from '@/routes/commerce/-shared/commerce-api';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import {
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
 * `MoneyCell`, and the server's totals as the last row. The totals row is the
 * server's figure for the whole filter, never a sum of the rows on screen.
 */

/** Marks the totals row inside the table data. */
const TOTALS = Symbol('totals');
type TableRow = ReportRow & { [TOTALS]?: true };

const NUMERIC = new Set(['MONEY', 'INT', 'QTY', 'PERCENT']);

export function ReportCellView({ column, value, strong }: { column: ReportColumn; value: ReportCell; strong?: boolean }) {
    if (column.type === 'MONEY') {
        if (value === null || value === undefined || value === '') return <span className="block text-end">—</span>;
        return <MoneyCell value={value as number | string} className={cn(strong && 'font-medium')} />;
    }
    const text = cellText(column.type, value);
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
    totals,
    rowTone,
    testId,
}: {
    columns: ReportColumn[];
    rows: ReportRow[];
    totals: ReportRow | null;
    /** A row to draw in the error colour (a numbering gap). */
    rowTone?: (row: ReportRow) => 'danger' | null;
    testId?: string;
}) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();

    const defs = useMemo<ColumnDef<TableRow>[]>(
        () =>
            screenColumns(columns).map((column, index) => ({
                id: column.key,
                header: columnLabel(column, lang),
                cell: ({ row }) => {
                    const data = row.original;
                    const isTotals = data[TOTALS] === true;
                    // A row the server flags (`red_flag`: COD outstanding over 10 days) or the view marks.
                    const danger = !isTotals && (data.red_flag === true || rowTone?.(data) === 'danger');
                    const value = data[column.key];
                    const empty = value === null || value === undefined || value === '';
                    let content: ReactNode;
                    if (isTotals && index === 0 && empty) {
                        content = <span className="block font-medium">{t('reports.table.total')}</span>;
                    } else if (isTotals && empty) {
                        content = null;
                    } else {
                        content = <ReportCellView column={column} value={value} strong={isTotals} />;
                    }
                    return (
                        <div
                            className={cn(danger && 'text-danger-600')}
                            data-tone={danger ? 'danger' : undefined}
                            data-totals={isTotals ? 'true' : undefined}
                        >
                            {content}
                        </div>
                    );
                },
            })),
        [columns, lang, rowTone, t]
    );

    const content: TableRow[] = totals ? [...rows, { ...totals, [TOTALS]: true }] : rows;

    return (
        <div data-testid={testId}>
            <MyTable<TableRow>
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
 * Totals the server sends beyond the table's columns (counts, values of their
 * own). Each is drawn by the type of the column with the same key anywhere in
 * the answer; a key that is no column is a count, unless the server names it
 * as money (lead decision 2).
 */
export function ExtraTotals({
    columns,
    allColumns = [],
    totals,
    omit,
    testId = 'report-extra-totals',
}: {
    columns: ReportColumn[];
    allColumns?: ReportColumn[];
    totals: ReportRow | null;
    omit?: readonly string[];
    testId?: string;
}) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const entries = extraTotals(columns, totals, omit);
    if (entries.length === 0) return null;
    return (
        <dl
            className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid={testId}
        >
            {entries.map(([key, value]) => {
                const column = totalColumn(key, columns, allColumns);
                const type = totalType(key, columns, allColumns);
                const label = column ? columnLabel(column, lang) : isWordedTotal(key) ? t(`reports.totals.${key}`) : key;
                const plain = num(value);
                return (
                    <div key={key} className="flex items-center justify-between gap-3" data-total={key} data-type={type}>
                        <dt className="text-caption text-muted-foreground">{label}</dt>
                        <dd className="text-body">
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
    );
}

/** One titled block of a report (heading = the server's label): its table with the server's totals, or "nothing here". */
export function SectionBlock({
    section,
    allColumns,
    omitTotals,
    rowTone,
    children,
}: {
    section: ReportSection;
    /** Every column of the answer, to type totals beyond this block's columns. */
    allColumns?: ReportColumn[];
    /** Totals shown elsewhere on the page (the day book's cash at the tills). */
    omitTotals?: readonly string[];
    rowTone?: (row: ReportRow) => 'danger' | null;
    children?: ReactNode;
}) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    return (
        <section className="flex flex-col gap-2" data-testid={`report-section-${section.key}`}>
            <h3 className="text-subtitle font-medium text-foreground">{sectionLabel(section, lang)}</h3>
            {section.rows.length === 0 && !section.totals ? (
                <p className="text-caption text-muted-foreground">{t('reports.table.nothing')}</p>
            ) : (
                <ReportTable columns={section.columns} rows={section.rows} totals={section.totals} rowTone={rowTone} />
            )}
            <ExtraTotals
                columns={section.columns}
                allColumns={allColumns}
                totals={section.totals}
                omit={omitTotals}
                testId={`report-section-totals-${section.key}`}
            />
            {children}
        </section>
    );
}
