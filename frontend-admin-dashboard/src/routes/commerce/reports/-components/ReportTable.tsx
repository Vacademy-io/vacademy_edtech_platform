import { type ReactNode, useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { MyTable } from '@/components/design-system/table';
import { cn } from '@/lib/utils';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { isKnownSection } from '../-shared/report-catalogue';
import { cellText } from '../-shared/report-format';
import type { ReportCell, ReportColumn, ReportRow, ReportSection } from '../-shared/report-types';

/**
 * One report table (contract §7.2 `ReportTable`): `MyTable` columns from the
 * answer's `columns`, money right-aligned through `MoneyCell`, and the
 * server's totals as the last row. The totals row is the server's figure for
 * the whole filter, never a sum of the rows on screen.
 */

/** Marks the totals row inside the table data. */
const TOTALS = Symbol('totals');
type TableRow = ReportRow & { [TOTALS]?: true };

const NUMERIC = new Set(['MONEY', 'INT', 'QTY', 'PERCENT', 'RATE']);

/** The column's label in the admin's language (the server's label table), else its key. */
export function columnLabel(column: ReportColumn, lang: 'en' | 'hi'): string {
    const own = lang === 'hi' ? column.labelHi : column.labelEn;
    return own ?? column.label ?? column.labelEn ?? column.key;
}

export function ReportCellView({ column, value, strong }: { column: ReportColumn; value: ReportCell; strong?: boolean }) {
    const { t } = useTranslation('commerce');
    if (column.type === 'MONEY') {
        if (value === null || value === undefined || value === '') return <span className="block text-end">—</span>;
        return <MoneyCell value={value as number | string} className={cn(strong && 'font-medium')} />;
    }
    const text = cellText(column.type, value, t);
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
            columns.map((column, index) => ({
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

/** A section's title: the screen's own words for known blocks, else the server's, else its key. */
export function useSectionTitle() {
    const { t } = useTranslation('commerce');
    return (section: Pick<ReportSection, 'key' | 'title'>) =>
        isKnownSection(section.key) ? t(`reports.sections.${section.key}`) : (section.title ?? section.key);
}

/** One titled block of a report: its table with the server's totals, or "nothing here". */
export function SectionBlock({
    section,
    rowTone,
    children,
}: {
    section: ReportSection;
    rowTone?: (row: ReportRow) => 'danger' | null;
    children?: ReactNode;
}) {
    const { t } = useTranslation('commerce');
    const title = useSectionTitle();
    return (
        <section className="flex flex-col gap-2" data-testid={`report-section-${section.key}`}>
            <h3 className="text-subtitle font-medium text-foreground">{title(section)}</h3>
            {section.rows.length === 0 && !section.totals ? (
                <p className="text-caption text-muted-foreground">{t('reports.table.nothing')}</p>
            ) : (
                <ReportTable columns={section.columns} rows={section.rows} totals={section.totals} rowTone={rowTone} />
            )}
            {children}
        </section>
    );
}
