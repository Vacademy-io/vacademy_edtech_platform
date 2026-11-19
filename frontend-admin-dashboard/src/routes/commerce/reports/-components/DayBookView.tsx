import { useTranslation } from 'react-i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import type { ReportAnswer, ReportCell, ReportSection } from '../-shared/report-types';
import { SectionBlock } from './ReportTable';

const emptySection = (key: string): ReportSection => ({
    key,
    labelEn: null,
    labelHi: null,
    columns: [],
    rows: [],
    totals: null,
});

/** Figures the "cash at the tills" card shows; not repeated under the sessions block. */
const TILLS = ['cash_at_tills'] as const;

/**
 * Day book (contract §2.7, §7.2 `DayBookView`): the server's sections
 * `documents`, `money`, `by_mode` and `sessions` as four tables, and "cash at
 * the tills" (`totals.cash_at_tills`), every figure from the server.
 */
export function DayBookView({ answer }: { answer: ReportAnswer }) {
    const { t } = useTranslation('commerce');
    const byKey = new Map(answer.sections.map((s) => [s.key, s]));
    const documents = byKey.get('documents') ?? emptySection('documents');
    const money = byKey.get('money') ?? emptySection('money');
    const byMode = byKey.get('by_mode');
    const sessions = byKey.get('sessions');
    const tills: ReportCell = answer.totals?.cash_at_tills ?? sessions?.totals?.cash_at_tills ?? null;

    return (
        <div className="flex flex-col gap-6" data-testid="day-book-view">
            <SectionBlock section={documents} />
            <SectionBlock section={money} />
            {byMode && <SectionBlock section={byMode} />}
            {sessions && <SectionBlock section={sessions} omitTotals={TILLS} />}
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
