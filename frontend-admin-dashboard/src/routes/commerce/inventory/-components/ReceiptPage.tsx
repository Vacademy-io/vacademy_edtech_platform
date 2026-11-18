import { type ReactNode, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { useInventoryAccess, useInventoryLocations, useLabels, useReceipt } from '../-shared/inventory-hooks';
import type { ReceiptView } from '../-shared/inventory-types';
import { InventoryErrorNotice, ItemCell, placeLabel, Qty, TOUCH } from './inventory-ui';
import { PrintLabelsDialog } from './PrintLabelsDialog';
import { ReprintDialog } from './ReprintDialog';
import { ReverseReceiptDialog } from './ReverseReceiptDialog';
import { TypeCostDialog } from './TypeCostDialog';

/** I2 (contract §7.3): one goods receipt, its pieces and codes, its labels; cost and reversal for managers. */
export function ReceiptPage() {
    const { t } = useTranslation('commerce');
    const { receiptId } = useParams({ from: '/commerce/inventory/receipts/$receiptId/' });
    const query = useReceipt(receiptId);
    return (
        <CommercePage
            navId="commerce-inventory"
            title={query.data?.receipt_number ?? t('inventory.receipt.title')}
            backTo={{ to: '/commerce/inventory', label: t('inventory.title') }}
        >
            {query.isLoading && <CommerceLoadingRows rows={4} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.data && <ReceiptBody receipt={query.data} />}
        </CommercePage>
    );
}

function ReceiptBody({ receipt }: { receipt: ReceiptView }) {
    const { t } = useTranslation('commerce');
    const access = useInventoryAccess();
    const locations = useInventoryLocations();
    const placeOf = (id: string | null) => placeLabel(locations.data?.find((p) => p.id === id) ?? (id ? { id } : null));
    const [costOpen, setCostOpen] = useState(false);
    const [reverseOpen, setReverseOpen] = useState(false);
    const reversed = receipt.status === 'REVERSED';
    const facts: [string, ReactNode][] = [
        [t('inventory.receipt.number'), receipt.receipt_number ?? '—'],
        [t('inventory.receipt.date'), receipt.received_date ? formatDate(receipt.received_date) : '—'],
        [t('inventory.receipt.place'), placeOf(receipt.location_id)],
        [
            t('inventory.receipt.source'),
            receipt.source_kind
                ? `${t(`inventory.receipt.sources.${receipt.source_kind}`)}${receipt.source_location_id ? ` · ${placeOf(receipt.source_location_id)}` : ''}`
                : '—',
        ],
        [t('inventory.receipt.status'), <CommerceStatusChip key="status" kind="receipt" value={receipt.status} />],
    ];
    if (receipt.bill_status && receipt.bill_status !== 'NOT_APPLICABLE') {
        facts.push([t('inventory.receipt.bill'), <CommerceStatusChip key="bill" kind="receiptBill" value={receipt.bill_status} />]);
    }

    return (
        <div className="flex flex-col gap-4">
            <SectionCard
                title={t('inventory.receipt.facts')}
                actions={
                    access.isManager && !reversed ? (
                        <>
                            <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onClick={() => setCostOpen(true)}>
                                {t('inventory.receipt.typeCost')}
                            </MyButton>
                            <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onClick={() => setReverseOpen(true)}>
                                {t('inventory.receipt.reverse')}
                            </MyButton>
                        </>
                    ) : undefined
                }
            >
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {facts.map(([label, value]) => (
                        <div key={label} className="flex flex-col gap-0.5">
                            <dt className="text-caption text-muted-foreground">{label}</dt>
                            <dd className="text-body text-foreground">{value}</dd>
                        </div>
                    ))}
                </dl>
                {receipt.note && <p className="text-body text-muted-foreground">{receipt.note}</p>}
                {reversed && receipt.reversed_at && (
                    <p className="text-body text-danger-600">
                        {t('inventory.receipt.reversedAt', { time: formatDateTime(receipt.reversed_at) })}
                    </p>
                )}
            </SectionCard>
            <SectionCard title={t('inventory.receipt.lines')}>
                <ul className="flex flex-col divide-y divide-border">
                    {receipt.lines.map((line) => (
                        <li key={line.id} className="flex flex-col gap-2 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <ItemCell
                                    name={line.product_name ?? line.sku ?? t('inventory.receipt.unknownItem')}
                                    variant={line.variant_name}
                                    sku={line.sku}
                                />
                                <div className="flex shrink-0 flex-col items-end">
                                    <Qty qty={line.qty_received} scale={line.qty_scale} unit={line.unit} className="text-body" />
                                    {access.isManager && line.unit_cost !== null && (
                                        <span className="text-caption text-muted-foreground">
                                            <MoneyCell value={line.unit_cost} />
                                        </span>
                                    )}
                                </div>
                            </div>
                            {line.pieces.length > 0 && (
                                <ul className="flex flex-wrap gap-2" aria-label={t('inventory.receipt.pieces')}>
                                    {line.pieces.map((piece) => (
                                        <li
                                            key={piece.id}
                                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-caption"
                                        >
                                            <span className="font-medium tabular-nums">{piece.code}</span>
                                            <CommerceStatusChip kind="piece" value={piece.status} />
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    ))}
                </ul>
            </SectionCard>
            <ReceiptLabelsCard receipt={receipt} />
            {costOpen && <TypeCostDialog open onOpenChange={setCostOpen} receipt={receipt} />}
            {reverseOpen && <ReverseReceiptDialog open onOpenChange={setReverseOpen} receipt={receipt} />}
        </div>
    );
}

function ReceiptLabelsCard({ receipt }: { receipt: ReceiptView }) {
    const { t } = useTranslation('commerce');
    const labels = useLabels({ sourceType: 'STOCK_RECEIPT', sourceId: receipt.id, page: 0, size: 100 });
    const [printing, setPrinting] = useState(false);
    const [reprint, setReprint] = useState(false);
    const rows = labels.data?.rows ?? [];
    const pending = rows.filter((r) => r.status === 'PENDING');
    return (
        <SectionCard
            title={t('inventory.receipt.labels')}
            actions={
                <>
                    {pending.length > 0 && (
                        <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onClick={() => setPrinting(true)}>
                            {t('inventory.labels.print')}
                        </MyButton>
                    )}
                    <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onClick={() => setReprint(true)}>
                        {t('inventory.labels.reprint')}
                    </MyButton>
                </>
            }
        >
            {labels.isLoading && <CommerceLoadingRows rows={2} />}
            {labels.isError && <InventoryErrorNotice error={labels.error} />}
            {labels.isSuccess && rows.length === 0 && (
                <p className="text-body text-muted-foreground">{t('inventory.receipt.noLabels')}</p>
            )}
            <ul className="flex flex-col divide-y divide-border">
                {rows.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                        <ItemCell name={row.item_name} variant={row.variant_name} sku={row.sku} code={row.piece_code ?? row.label_code} />
                        <span className="flex shrink-0 items-center gap-2">
                            {!row.piece_id && <span className="text-caption tabular-nums">×{row.quantity}</span>}
                            <CommerceStatusChip kind="labelRequest" value={row.status} />
                        </span>
                    </li>
                ))}
            </ul>
            {/* The whole receipt's waiting rows (every page), drawn and marked by the server's list. */}
            {printing && (
                <PrintLabelsDialog open onOpenChange={setPrinting} receiptId={receipt.id} locationId={receipt.location_id} />
            )}
            {reprint && receipt.location_id && (
                <ReprintDialog open onOpenChange={setReprint} locationId={receipt.location_id} />
            )}
        </SectionCard>
    );
}
