import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { modeLabel } from '../-shared/pos-receipt';
import type { ZReport } from '../-shared/pos-types';
import { rupees, signedRupees } from './pos-ui';
import './pos-receipt.css';

/**
 * The day report of one counter session (Z-report, contract §3.8), laid out
 * for the 80 mm roll. Same print mechanism as the bill; on screen it is a
 * narrow card. While the counter is open the same shape is the live summary.
 */
export function PosZReport80({ report, printable = false }: { report: ZReport; printable?: boolean }) {
    const { t } = useTranslation('commerce');
    const row = (label: ReactNode, value: ReactNode, strong = false) => (
        <div className={cn('flex justify-between gap-2', strong && 'font-medium')}>
            <span>{label}</span>
            <span className="tabular-nums">{value}</span>
        </div>
    );
    const section = (title: string, children: ReactNode) => (
        <div className="flex flex-col border-t border-dashed border-black pt-1">
            <p className="font-medium">{title}</p>
            {children}
        </div>
    );
    return (
        <div
            data-testid={printable ? 'pos-z-print' : 'pos-z-preview'}
            className={cn(
                'flex flex-col gap-2 bg-white text-xs text-black',
                printable ? 'pos-receipt-print hidden print:flex' : 'w-72 rounded-md border border-border p-3'
            )}
        >
            <div className="flex flex-col items-center text-center">
                <p className="text-sm font-medium">{t('pos.z.title')}</p>
                <p>
                    {report.register.code} · {report.register.name}
                </p>
                <p>{report.location.name}</p>
            </div>
            {row(t('pos.z.opened'), report.opened_at ? formatDateTime(report.opened_at) : '—')}
            {row(t('pos.z.closed'), report.closed_at ? formatDateTime(report.closed_at) : t('pos.z.stillOpen'))}
            {section(
                t('pos.z.sales'),
                <>
                    {row(t('pos.z.bills', { count: report.bills.count }), rupees(report.bills.total), true)}
                    {row(t('pos.z.voided', { count: report.voided.count }), rupees(report.voided.total))}
                    {row(t('pos.z.billBook', { count: report.bill_book.count }), rupees(report.bill_book.total))}
                    {row(t('pos.z.discounts'), rupees(report.discounts))}
                    {(report.first_invoice_number || report.last_invoice_number) &&
                        row(
                            t('pos.z.numbers'),
                            `${report.first_invoice_number ?? '—'} – ${report.last_invoice_number ?? '—'}`
                        )}
                </>
            )}
            {section(
                t('pos.z.byMode'),
                report.by_mode.length === 0
                    ? row(t('pos.z.none'), rupees(0))
                    : report.by_mode.map((m) => (
                          <div key={m.mode}>{row(`${modeLabel(m.mode, t)} (${m.count})`, rupees(m.amount))}</div>
                      ))
            )}
            {report.tax_by_rate.length > 0 &&
                section(
                    t('pos.z.tax'),
                    report.tax_by_rate.map((r) => (
                        <div key={r.rate}>
                            {row(
                                t('pos.z.taxRate', { rate: r.rate }),
                                rupees(r.cgst + r.sgst + r.igst + r.cess)
                            )}
                        </div>
                    ))
                )}
            {(report.refunds.length > 0 || report.returns.count > 0) &&
                section(
                    t('pos.z.returns'),
                    <>
                        {row(t('pos.z.returnCount', { count: report.returns.count }), rupees(report.returns.credit))}
                        {report.refunds.map((r) => (
                            <div key={r.method}>
                                {row(t('pos.z.refund', { method: modeLabel(r.method, t), count: r.count }), rupees(r.amount))}
                            </div>
                        ))}
                    </>
                )}
            {section(
                t('pos.z.cash'),
                <>
                    {row(t('pos.z.openingCash'), rupees(report.opening_cash))}
                    {row(t('pos.cash.in'), rupees(report.cash_in))}
                    {row(t('pos.cash.out'), rupees(report.cash_out))}
                    {report.expected_cash !== null && row(t('pos.close.expected'), rupees(report.expected_cash), true)}
                    {report.counted_cash !== null && row(t('pos.close.counted'), rupees(report.counted_cash))}
                    {report.variance !== null && row(t('pos.close.difference'), signedRupees(report.variance), true)}
                </>
            )}
        </div>
    );
}
