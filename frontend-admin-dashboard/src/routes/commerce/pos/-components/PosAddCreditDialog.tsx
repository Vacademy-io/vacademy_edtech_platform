import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { formatDate } from '@/lib/formatters';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import type { CartExchange } from '../-shared/pos-cart';
import { fetchSale, lookupSales } from '../-shared/pos-api';
import type { SaleDetail, SaleRow } from '../-shared/pos-types';
import { PosErrorNotice, PosField, posInputClass, rupees } from './pos-ui';

/** A return whose credit is still waiting: received, not refunded. */
export const RETURN_CREDIT_STATUSES: ReadonlySet<string> = new Set(['RECEIVED']);

/** The returns of a bill whose credit a new bill may use (the server decides at the quote). */
export function creditReturns(sale: Pick<SaleDetail, 'returns'>): SaleDetail['returns'] {
    return sale.returns.filter((ret) => RETURN_CREDIT_STATUSES.has((ret.status ?? '').toUpperCase()));
}

/**
 * "Add return credit" on the bill: finds the old bill (scan its QR, or type
 * the bill number or the phone), lists its returns whose credit is waiting,
 * and puts the picked one on the bill. The quote then decides: the credit, or
 * "a manager's PIN is needed" for a return taken elsewhere (the PIN is asked
 * when the bill is paid).
 */
export function PosAddCreditDialog({
    open,
    onOpenChange,
    sessionId,
    online,
    onPick,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sessionId: string;
    online: boolean;
    onPick: (exchange: CartExchange) => void;
}) {
    const { t } = useTranslation('commerce');
    const [q, setQ] = useState('');
    const [rows, setRows] = useState<SaleRow[] | null>(null);
    const [sale, setSale] = useState<SaleDetail | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!open) return;
        setQ('');
        setRows(null);
        setSale(null);
        setError(null);
    }, [open]);

    const openSale = async (orderId: string) => {
        setError(null);
        try {
            setSale(await fetchSale(orderId, sessionId));
        } catch (e) {
            setError(e);
        }
    };

    const search = async () => {
        const text = q.trim();
        if (text.length < 2 || !online || busy) return;
        setBusy(true);
        setError(null);
        setSale(null);
        try {
            const found = await lookupSales(sessionId, text);
            if (found.length === 1 && found[0]) {
                setRows(null);
                await openSale(found[0].order_id);
            } else {
                setRows(found);
            }
        } catch (e) {
            setError(e);
        } finally {
            setBusy(false);
        }
    };

    const credits = sale ? creditReturns(sale) : [];

    return (
        <MyDialog
            heading={t('pos.addCredit.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full justify-end">
                    <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => onOpenChange(false)}>
                        {t('common.cancel')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-600">{t('pos.addCredit.hint')}</p>
                <div className="flex items-end gap-2">
                    <PosField label={t('pos.returns.find')} htmlFor="pos-add-credit-q" className="flex-1">
                        <input
                            id="pos-add-credit-q"
                            autoComplete="off"
                            maxLength={64}
                            className={posInputClass}
                            value={q}
                            onChange={(event) => setQ(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void search();
                                }
                            }}
                        />
                    </PosField>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="large"
                        className="h-12"
                        disable={!online || q.trim().length < 2}
                        onAsyncClick={search}
                    >
                        <MagnifyingGlass size={20} className="me-2" />
                        {t('pos.returns.search')}
                    </MyButton>
                </div>
                {!online && (
                    <OrderNotice tone="warning">
                        <p>{t('pos.offline')}</p>
                    </OrderNotice>
                )}
                <PosErrorNotice error={error} />
                {rows && rows.length === 0 && <p className="text-body text-danger-600">{t('pos.returns.notFound')}</p>}
                {rows && rows.length > 0 && !sale && (
                    <ul className="flex flex-col gap-2">
                        {rows.map((row) => (
                            <li key={row.order_id}>
                                <button
                                    type="button"
                                    onClick={() => void openSale(row.order_id)}
                                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-border px-4 py-2 text-start hover:border-primary-500"
                                >
                                    <span className="flex flex-col">
                                        <span className="text-body font-medium text-foreground">
                                            {row.invoice_number ?? row.order_number}
                                        </span>
                                        <span className="text-caption text-muted-foreground">
                                            {[row.document_date ? formatDate(row.document_date) : null, row.customer_name]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                    </span>
                                    <span className="tabular-nums text-body text-foreground">{rupees(row.total)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {sale && credits.length === 0 && (
                    <OrderNotice tone="info">
                        <p data-testid="pos-add-credit-none">{t('pos.addCredit.none')}</p>
                    </OrderNotice>
                )}
                {sale && credits.length > 0 && (
                    <ul className="flex flex-col gap-2">
                        {credits.map((ret) => (
                            <li key={ret.id}>
                                <button
                                    type="button"
                                    data-testid={`pos-add-credit-${ret.id}`}
                                    onClick={() => {
                                        onPick({ returnId: ret.id, number: ret.number, credit: ret.credit });
                                        onOpenChange(false);
                                    }}
                                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-border px-4 py-2 text-start hover:border-primary-500"
                                >
                                    <span className="text-body font-medium text-foreground">
                                        {t('pos.addCredit.use', { number: ret.number ?? '' })}
                                    </span>
                                    {ret.credit > 0 && (
                                        <span className="tabular-nums text-body text-foreground">{rupees(ret.credit)}</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </MyDialog>
    );
}
