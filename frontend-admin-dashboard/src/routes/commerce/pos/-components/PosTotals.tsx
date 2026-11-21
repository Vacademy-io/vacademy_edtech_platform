import { useTranslation } from 'react-i18next';
import { ArrowsClockwise } from '@phosphor-icons/react';
import type { Quote } from '../-shared/pos-types';
import { PosFigure, rupees } from './pos-ui';

/**
 * The bill's money, exactly as the server priced it (`POST /pos/quote`); the
 * screen never computes tax. "Updating…" while the next quote is on its way.
 */
export function PosTotals({
    quote,
    updating,
    credit,
}: {
    quote: Quote | null;
    updating: boolean;
    /** Exchange credit counted against this bill. */
    credit: number;
}) {
    const { t } = useTranslation('commerce');
    const totals = quote?.totals;
    return (
        <section aria-label={t('pos.totals.title')} aria-busy={updating} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between">
                <span className="text-subtitle font-medium text-foreground">{t('pos.totals.title')}</span>
                {updating && (
                    <span className="flex items-center gap-1 text-caption text-muted-foreground">
                        <ArrowsClockwise size={14} className="animate-spin" />
                        {t('pos.totals.updating')}
                    </span>
                )}
            </div>
            {!totals && <p className="text-body text-muted-foreground">{t('pos.totals.empty')}</p>}
            {totals && (
                <>
                    <PosFigure label={t('pos.totals.subtotal')} value={rupees(totals.subtotal)} />
                    {totals.discount > 0 && (
                        <PosFigure
                            label={t('pos.totals.discount')}
                            value={`− ${rupees(totals.discount)}`}
                            tone="success"
                        />
                    )}
                    {quote.tax_rows.map((row) => (
                        <div key={row.rate} className="flex flex-col gap-0.5">
                            {(row.cgst > 0 || row.sgst > 0) && (
                                <>
                                    <PosFigure label={t('pos.receipt.cgst', { rate: row.rate / 2 })} value={rupees(row.cgst)} />
                                    <PosFigure label={t('pos.receipt.sgst', { rate: row.rate / 2 })} value={rupees(row.sgst)} />
                                </>
                            )}
                            {row.igst > 0 && (
                                <PosFigure label={t('pos.receipt.igst', { rate: row.rate })} value={rupees(row.igst)} />
                            )}
                            {row.cess > 0 && <PosFigure label={t('pos.receipt.cess')} value={rupees(row.cess)} />}
                        </div>
                    ))}
                    {quote.tax_rows.length === 0 && totals.tax > 0 && (
                        <PosFigure label={t('pos.totals.tax')} value={rupees(totals.tax)} />
                    )}
                    {totals.round_off !== 0 && (
                        <PosFigure label={t('pos.totals.roundOff')} value={rupees(totals.round_off)} />
                    )}
                    <div className="my-1 border-t border-border" />
                    <PosFigure label={t('pos.totals.total')} value={rupees(totals.total)} strong testId="pos-total" />
                    {credit > 0 && (
                        <>
                            <PosFigure label={t('pos.totals.exchangeCredit')} value={`− ${rupees(Math.min(credit, totals.total))}`} tone="success" />
                            <PosFigure
                                label={t('pos.totals.toPay')}
                                value={rupees(Math.max(0, totals.total - credit))}
                                strong
                            />
                        </>
                    )}
                </>
            )}
        </section>
    );
}
