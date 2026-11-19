import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { MoneyCell } from '@/components/design-system/money-cell';
import { cn } from '@/lib/utils';
import { isZeroFigure } from '../-shared/report-format';
import { GSTR1_CHECK_KEYS, GSTR1_TABS } from '../-shared/report-keys';
import type { ReportAnswer, ReportCheck, ReportSection } from '../-shared/report-types';
import { ReportTabs } from './ReportTabs';
import { SectionBlock } from './ReportTable';

export type Gstr1Tab = (typeof GSTR1_TABS)[number];

const KNOWN_CHECK = new Set<string>(GSTR1_CHECK_KEYS);

const emptySection = (key: string): ReportSection => ({ key, title: null, columns: [], rows: [], totals: null });

/** The server's check adds up when its overall difference and every line's difference are zero. */
export function checkAddsUp(check: ReportCheck): boolean {
    const overall = check.difference === null || check.difference === undefined || isZeroFigure(check.difference);
    return overall && check.lines.every((line) => isZeroFigure(line.difference));
}

/**
 * GSTR-1 for one GSTIN and month (contract §7.2 `Gstr1View`): one tab per
 * sheet and the check block ("sections = documents"), both from the server.
 */
export function Gstr1View({ answer }: { answer: ReportAnswer }) {
    const { t } = useTranslation('commerce');
    const [tab, setTab] = useState<Gstr1Tab>('b2b');
    const byKey = new Map(answer.sections.map((s) => [s.key, s]));
    const section = byKey.get(tab) ?? emptySection(tab);
    const netted = tab === 'b2cs' ? byKey.get('b2cs_credit_notes') : undefined;

    return (
        <div className="flex flex-col gap-4" data-testid="gstr1-view">
            {answer.check && <Gstr1Check check={answer.check} />}
            <ReportTabs
                idPrefix="gstr1"
                label={t('reports.catalogue.gstr1.title')}
                active={tab}
                onChange={setTab}
                tabs={GSTR1_TABS.map((id) => ({ id, label: t(`reports.gstr1.tabs.${id}`) }))}
            />
            <div role="tabpanel" id="gstr1-panel" aria-labelledby={`gstr1-tab-${tab}`} className="flex flex-col gap-4">
                <SectionBlock section={section} />
                {netted && <SectionBlock section={netted} />}
            </div>
        </div>
    );
}

export function Gstr1Check({ check }: { check: ReportCheck }) {
    const { t } = useTranslation('commerce');
    const addsUp = checkAddsUp(check);
    return (
        <section
            className={cn(
                'flex flex-col gap-3 rounded-lg border p-4',
                addsUp ? 'border-success-200 bg-success-50' : 'border-danger-200 bg-danger-50'
            )}
            data-testid="gstr1-check"
        >
            <div className={cn('flex items-center gap-2 text-body font-medium', addsUp ? 'text-success-600' : 'text-danger-600')}>
                {addsUp ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}
                <span>{addsUp ? t('reports.gstr1.check.addsUp') : t('reports.gstr1.check.doesNotAddUp')}</span>
            </div>
            <p className="text-caption text-muted-foreground">{t('reports.gstr1.check.help')}</p>
            {!addsUp && check.lines.length === 0 && (
                <div className="flex items-center justify-between gap-3 text-caption">
                    <span>{t('reports.gstr1.check.difference')}</span>
                    <MoneyCell value={check.difference as number | string} tone="deduction" />
                </div>
            )}
            {check.lines.length > 0 && (
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
                            {check.lines.map((line) => (
                                <tr key={line.key} className="border-t border-border">
                                    <td className="py-1">
                                        {KNOWN_CHECK.has(line.key) ? t(`reports.gstr1.check.keys.${line.key}`) : line.key}
                                    </td>
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
        </section>
    );
}
