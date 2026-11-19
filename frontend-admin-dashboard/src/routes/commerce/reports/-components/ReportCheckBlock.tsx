import { useTranslation } from 'react-i18next';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { MoneyCell } from '@/components/design-system/money-cell';
import { cn } from '@/lib/utils';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { columnLabel, totalColumn } from '../-shared/report-columns';
import { isZeroFigure } from '../-shared/report-format';
import { CHECK_FIGURES, CHECK_RULE_REPORTS } from '../-shared/report-keys';
import type { ReportCheck, ReportColumn } from '../-shared/report-types';

const FIGURES = new Set<string>(CHECK_FIGURES);
const RULES = new Set<string>(CHECK_RULE_REPORTS);

/** The server's check adds up when its overall difference and every column's difference are zero. */
export function checkAddsUp(check: ReportCheck): boolean {
    const overall = check.difference === null || check.difference === undefined || isZeroFigure(check.difference);
    return overall && check.columns.every((line) => isZeroFigure(line.difference));
}

/**
 * Any report's check block (M8): "Adds up" / "Does not add up" from the
 * server's difference, the rule in the admin's words, and the figures the
 * server compared — one line per column for GSTR-1 (`check.columns`), the flat
 * figures for the sales register, credit notes, HSN summary and POS sessions.
 * Every figure is the server's; nothing is added here.
 */
export function ReportCheckBlock({
    check,
    columns = [],
    report,
    testId = 'report-check',
}: {
    check: ReportCheck;
    /** Every column of the answer: a figure with a column's key is named by its label. */
    columns?: ReportColumn[];
    /** The report's API name, for the rule's words. */
    report: string;
    testId?: string;
}) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const name = (key: string) => {
        const column = totalColumn(key, columns);
        if (column) return columnLabel(column, lang);
        return FIGURES.has(key) ? t(`reports.check.figures.${key}`) : key;
    };
    const addsUp = checkAddsUp(check);
    const help = report === 'gstr1' ? t('reports.gstr1.check.help') : RULES.has(report) ? t(`reports.check.rules.${report}`) : null;
    return (
        <section
            className={cn(
                'flex flex-col gap-3 rounded-lg border p-4',
                addsUp ? 'border-success-200 bg-success-50' : 'border-danger-200 bg-danger-50'
            )}
            data-testid={testId}
        >
            <div className={cn('flex items-center gap-2 text-body font-medium', addsUp ? 'text-success-600' : 'text-danger-600')}>
                {addsUp ? (
                    <CheckCircle size={18} weight="fill" aria-hidden="true" />
                ) : (
                    <WarningCircle size={18} weight="fill" aria-hidden="true" />
                )}
                <span>{addsUp ? t('reports.gstr1.check.addsUp') : t('reports.gstr1.check.doesNotAddUp')}</span>
            </div>
            {help && <p className="text-caption text-muted-foreground">{help}</p>}
            {check.columns.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-caption">
                        <thead>
                            <tr className="text-muted-foreground">
                                <th className="py-1 text-start font-normal">{t('reports.gstr1.check.what')}</th>
                                <th className="py-1 text-end font-normal">{t('reports.gstr1.check.sections')}</th>
                                <th className="py-1 text-end font-normal">{t('reports.gstr1.check.documents')}</th>
                                <th className="py-1 text-end font-normal">{t('reports.gstr1.check.difference')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {check.columns.map((line) => (
                                <tr key={line.key} className="border-t border-border">
                                    <td className="py-1">{name(line.key)}</td>
                                    <td className="py-1">
                                        <MoneyCell value={line.sections as number | string | null} />
                                    </td>
                                    <td className="py-1">
                                        <MoneyCell value={line.documents as number | string | null} />
                                    </td>
                                    <td className="py-1">
                                        <MoneyCell
                                            value={line.difference as number | string | null}
                                            tone={isZeroFigure(line.difference) ? 'default' : 'deduction'}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {check.columns.length === 0 && (
                <dl className="flex flex-col gap-1 text-caption" data-testid={`${testId}-figures`}>
                    {check.figures.map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between gap-3" data-figure={key}>
                            <dt className="text-muted-foreground">{name(key)}</dt>
                            <dd>
                                <MoneyCell value={value as number | string} />
                            </dd>
                        </div>
                    ))}
                    {check.difference !== null && check.difference !== undefined && (
                        <div className="flex items-center justify-between gap-3 border-t border-border pt-1" data-figure="difference">
                            <dt className="text-foreground">{t('reports.gstr1.check.difference')}</dt>
                            <dd>
                                <MoneyCell
                                    value={check.difference as number | string}
                                    tone={isZeroFigure(check.difference) ? 'default' : 'deduction'}
                                />
                            </dd>
                        </div>
                    )}
                </dl>
            )}
        </section>
    );
}
