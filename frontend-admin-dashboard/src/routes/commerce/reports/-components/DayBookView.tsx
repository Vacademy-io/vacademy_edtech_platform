import { useTranslation } from 'react-i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import type { ReportAnswer, ReportCell, ReportSection } from '../-shared/report-types';
import { SectionBlock } from './ReportTable';

const emptySection = (key: string): ReportSection => ({ key, title: null, columns: [], rows: [], totals: null });

/**
 * The day book's documents and money blocks. Normally two sections; an answer
 * that sends one list with a `row_kind` column (DOCUMENT / MONEY) is split by
 * that column, never by guessing from the figures.
 */
export function dayBookBlocks(answer: ReportAnswer): { documents: ReportSection; money: ReportSection } {
    const byKey = new Map(answer.sections.map((s) => [s.key, s]));
    const documents = byKey.get('documents');
    const money = byKey.get('money');
    if (documents || money) {
        return { documents: documents ?? emptySection('documents'), money: money ?? emptySection('money') };
    }
    const kindOf = (row: Record<string, unknown>) => String(row.row_kind ?? '').toUpperCase();
    return {
        documents: { ...emptySection('documents'), columns: answer.columns, rows: answer.rows.filter((r) => kindOf(r) === 'DOCUMENT') },
        money: { ...emptySection('money'), columns: answer.columns, rows: answer.rows.filter((r) => kindOf(r) === 'MONEY') },
    };
}

/**
 * Day book (contract §2.7, §7.2 `DayBookView`): documents and money as two
 * tables, the footer by payment mode, the counter sessions of the day and
 * "cash at the tills", every figure from the server.
 */
export function DayBookView({ answer }: { answer: ReportAnswer }) {
    const { t } = useTranslation('commerce');
    const { documents, money } = dayBookBlocks(answer);
    const byKey = new Map(answer.sections.map((s) => [s.key, s]));
    const byMode = byKey.get('by_mode');
    const sessions = byKey.get('sessions');
    const tills: ReportCell =
        answer.totals?.cash_at_tills ?? sessions?.totals?.cash_at_tills ?? null;

    return (
        <div className="flex flex-col gap-6" data-testid="day-book-view">
            <SectionBlock section={documents} />
            <SectionBlock section={money} />
            {byMode && <SectionBlock section={byMode} />}
            {sessions && <SectionBlock section={sessions} />}
            {tills !== null && tills !== undefined && (
                <div
                    className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                    data-testid="cash-at-tills"
                >
                    <div className="flex flex-col gap-0.5">
                        <span className="text-body font-medium text-foreground">{t('reports.dayBook.cashAtTills')}</span>
                        <span className="text-caption text-muted-foreground">{t('reports.dayBook.cashAtTillsHelp')}</span>
                    </div>
                    <MoneyCell value={tills as number | string} className="text-subtitle font-medium" />
                </div>
            )}
        </div>
    );
}
