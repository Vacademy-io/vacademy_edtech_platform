import { useTranslation } from 'react-i18next';
import type { ReportAnswer, ReportCell, ReportRow, ReportSection } from '../-shared/report-types';
import { SectionBlock } from './ReportTable';

/** Pages as text: `[102, 105]` → "102, 105"; a string as sent. */
export function pagesText(value: ReportCell): string {
    if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
    if (typeof value === 'number') return String(value);
    return typeof value === 'string' ? value.trim() : '';
}

/** A system series row with missing numbers (`gap` other than "none", or a `missing` list). */
export function hasGap(row: ReportRow): boolean {
    const gap = row.gap ?? row.missing;
    if (Array.isArray(gap)) return gap.length > 0;
    if (typeof gap === 'number') return gap > 0;
    if (typeof gap === 'string') return gap.trim() !== '' && gap.trim().toLowerCase() !== 'none';
    return false;
}

const notEnteredOf = (row: ReportRow): string => pagesText(row.not_entered ?? row.not_entered_pages);
const bookName = (row: ReportRow): string =>
    String(row.book_prefix ?? row.prefix ?? row.book ?? row.series ?? '').trim();

const emptySection = (key: string): ReportSection => ({ key, title: null, columns: [], rows: [], totals: null });

/**
 * Documents issued (GSTR-1 table 13; contract §2.6, §7.2): system numbers and
 * paper bill books in two blocks. A series with missing numbers is drawn in
 * the error colour; under each book, the pages "not entered".
 */
export function DocumentsIssuedView({ answer }: { answer: ReportAnswer }) {
    const { t } = useTranslation('commerce');
    const byKey = new Map(answer.sections.map((s) => [s.key, s]));
    const system =
        byKey.get('system') ??
        (answer.rows.length > 0 ? { ...emptySection('system'), columns: answer.columns, rows: answer.rows, totals: answer.totals } : emptySection('system'));
    const books = byKey.get('bill_books') ?? emptySection('bill_books');
    const otherPeriod = byKey.get('other_period');
    const booksWithBlanks = books.rows.filter((row) => notEnteredOf(row) !== '');

    return (
        <div className="flex flex-col gap-6" data-testid="documents-issued-view">
            <SectionBlock section={system} rowTone={(row) => (hasGap(row) ? 'danger' : null)} />
            <SectionBlock section={books}>
                {booksWithBlanks.length > 0 && (
                    <ul className="flex flex-col gap-1" data-testid="not-entered">
                        {booksWithBlanks.map((row, index) => (
                            <li key={`${bookName(row)}-${index}`} className="text-caption text-warning-600">
                                {t('reports.documents.notEntered', { book: bookName(row) || '—', pages: notEnteredOf(row) })}
                            </li>
                        ))}
                    </ul>
                )}
                <p className="text-caption text-muted-foreground">{t('reports.documents.notEnteredHelp')}</p>
            </SectionBlock>
            {otherPeriod && otherPeriod.rows.length > 0 && <SectionBlock section={otherPeriod} />}
        </div>
    );
}
