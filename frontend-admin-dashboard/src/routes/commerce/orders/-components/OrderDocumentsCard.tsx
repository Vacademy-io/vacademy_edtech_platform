import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadSimple, Printer } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { COMMERCE_ROLE } from '@/lib/commerce/commerce-access';
import { formatDate } from '@/lib/formatters';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceErrorState, CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { liveShipment } from '@/routes/commerce/orders/-shared/order-actions';
import { fetchCreditNotePdfUrl, fetchInvoicePdfUrl } from '@/routes/commerce/orders/-shared/order-api';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { useCreditNotes } from '@/routes/commerce/orders/-shared/order-hooks';
import type { StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { OrderNotice, useOrderErrorHandler, useOrderErrorText } from './order-ui';

const { STORE_MANAGER, WAREHOUSE_STAFF, ACCOUNTANT } = COMMERCE_ROLE;

/**
 * Invoice and credit notes (manager, accountant; warehouse sees only that the
 * invoice is issued — owner default Q3) and the packing slip (goods staff).
 */
export function OrderDocumentsCard({ detail }: { detail: StaffOrderDetail }) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const handle = useOrderErrorHandler();
    const text = useOrderErrorText();
    const [showNotes, setShowNotes] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const readsDocuments = access.hasAnyRole([STORE_MANAGER, ACCOUNTANT]);
    const printsSlip = access.hasAnyRole([STORE_MANAGER, WAREHOUSE_STAFF]) && !!liveShipment(detail);
    const notes = useCreditNotes(detail.invoice_id, readsDocuments && showNotes);

    if (!detail.invoice_id && !printsSlip) return null;

    const open = async (load: () => Promise<string | null>) => {
        setError(null);
        try {
            const url = await load();
            if (url) window.open(url, '_blank', 'noopener');
            else setError(t('orders.detail.documents.pdfNotReady'));
        } catch (raw) {
            const left = handle(raw);
            if (left) setError(text(left));
        }
    };

    return (
        <SectionCard title={t('orders.detail.documents.title')}>
            <div className="flex flex-col gap-3">
                {detail.invoice_id && !readsDocuments && (
                    <p className="text-body text-foreground">{t('orders.detail.documents.invoiceIssued')}</p>
                )}
                {detail.invoice_id && readsDocuments && (
                    <>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onAsyncClick={() => open(() => fetchInvoicePdfUrl(detail.invoice_id as string))}
                        >
                            <DownloadSimple size={16} />
                            {t('orders.actions.DOWNLOAD_INVOICE')}
                        </MyButton>
                        {!showNotes && (
                            <MyButton type="button" buttonType="text" scale="small" onClick={() => setShowNotes(true)}>
                                {t('orders.detail.documents.showCreditNotes')}
                            </MyButton>
                        )}
                        {showNotes && notes.isLoading && <CommerceLoadingRows rows={1} />}
                        {showNotes && notes.isError && (
                            <CommerceErrorState
                                message={text(readOrderError(notes.error))}
                                onRetry={() => void notes.refetch()}
                            />
                        )}
                        {showNotes && notes.isSuccess && notes.data.length === 0 && (
                            <p className="text-caption text-muted-foreground">{t('orders.detail.documents.noCreditNotes')}</p>
                        )}
                        {showNotes && notes.isSuccess && notes.data.length > 0 && (
                            <ul className="flex flex-col divide-y divide-border">
                                {notes.data.map((note) => (
                                    <li key={note.id} className="flex items-center justify-between gap-3 py-2">
                                        <div className="flex min-w-0 flex-col">
                                            <span className="text-body text-foreground">
                                                {note.credit_note_number ?? t('orders.detail.documents.creditNote')}
                                            </span>
                                            {note.document_date && (
                                                <span className="text-caption text-muted-foreground">{formatDate(note.document_date)}</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <MoneyCell value={note.total} currency={detail.order.currency} />
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="small"
                                                layoutVariant="icon"
                                                aria-label={t('orders.detail.documents.downloadCreditNote')}
                                                onAsyncClick={() => open(() => fetchCreditNotePdfUrl(note.id))}
                                            >
                                                <DownloadSimple size={14} />
                                            </MyButton>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
                {printsSlip && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() =>
                            window.open(
                                `/commerce/orders/print?ids=${encodeURIComponent(detail.order.id)}`,
                                '_blank',
                                'noopener'
                            )
                        }
                    >
                        <Printer size={16} />
                        {t('orders.actions.PRINT_SLIP')}
                    </MyButton>
                )}
                {error && <OrderNotice tone="danger">{error}</OrderNotice>}
            </div>
        </SectionCard>
    );
}
