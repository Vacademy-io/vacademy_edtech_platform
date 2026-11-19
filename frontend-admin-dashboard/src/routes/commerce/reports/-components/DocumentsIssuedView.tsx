import { useTranslation } from 'react-i18next';
import type { ReportAnswer, ReportRow, ReportSection } from '../-shared/report-types';
import { SectionBlock } from './ReportTable';

/** A cell the server sends as text ("none", "102, 105"), trimmed; anything else as empty. */
const textCell = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** A system series row with missing numbers: its `gap` text is something other than "none". */
export function hasGap(row: ReportRow): boolean {
    const gap = textCell(row.gap);
    return gap !== '' && gap.toLowerCase() !== 'none';
}

const emptySection = (key: string): ReportSection => ({
    key,
    labelEn: null,
    labelHi: null,
    columns: [],
    rows: [],
    totals: null,
});

/**
 * Documents issued (GSTR-1 table 13; contract §2.6, §7.2): the server's two
 * blocks, `system` (system numbers; "dated in another period" is its column
 * `dated_in_other_period`) and `bill_books` (paper bill books). A series with
 * missing numbers (`gap` ≠ "none") is drawn in the error colour; under the
 * books, each book's pages "not entered" (`not_entered`, by `prefix`).
 */
export function DocumentsIssuedView({ answer }: { answer: ReportAnswer }) {
    const { t } = useTranslation('commerce');
    const byKey = new Map(answer.sections.map((s) => [s.key, s]));
    const system = byKey.get('system') ?? emptySection('system');
    const books = byKey.get('bill_books') ?? emptySection('bill_books');
    const booksWithBlanks = books.rows.filter((row) => textCell(row.not_entered) !== '');

    return (
        <div className="flex flex-col gap-6" data-testid="documents-issued-view">
            <SectionBlock section={system} rowFlag={(row) => (hasGap(row) ? t('reports.table.gapRow') : null)} />
            <SectionBlock section={books}>
                {booksWithBlanks.length > 0 && (
                    <ul className="flex flex-col gap-1" data-testid="not-entered">
                        {booksWithBlanks.map((row, index) => (
                            <li key={`${textCell(row.prefix)}-${index}`} className="text-caption text-warning-600">
                                {t('reports.documents.notEntered', {
                                    book: textCell(row.prefix) || '—',
                                    pages: textCell(row.not_entered),
                                })}
                            </li>
                        ))}
                    </ul>
                )}
                <p className="text-caption text-muted-foreground">{t('reports.documents.notEnteredHelp')}</p>
            </SectionBlock>
        </div>
    );
}
