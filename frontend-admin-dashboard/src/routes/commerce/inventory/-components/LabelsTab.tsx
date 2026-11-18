import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { formatDateTime } from '@/lib/formatters';
import { PlainSelect, SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceEmptyState, CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { cancelLabels, requestLabels } from '../-shared/inventory-api';
import { useInvalidateInventory, useLabels, useLabelsToReplace } from '../-shared/inventory-hooks';
import { LABEL_STATUSES, type LabelRow, type ToReplaceRow } from '../-shared/inventory-types';
import { labelCount } from '../-shared/label-print';
import type { TabProps } from './InventoryPage';
import { ConfirmDialog, InventoryErrorNotice, ItemCell, TOUCH } from './inventory-ui';
import { PrintLabelsDialog } from './PrintLabelsDialog';
import { ReprintDialog } from './ReprintDialog';
import { useInventoryWrite } from './use-inventory-write';

/** The link of a label's source (a receipt or a transfer), when it has one. */
function SourceLink({ row }: { row: LabelRow }) {
    const { t } = useTranslation('commerce');
    const text = row.source_label ?? t(`inventory.labels.sources.${row.source_type ?? 'MANUAL'}`);
    if (row.source_type === 'STOCK_RECEIPT' && row.source_id) {
        return (
            <Link to="/commerce/inventory/receipts/$receiptId" params={{ receiptId: row.source_id }} className="text-primary-500 hover:underline">
                {text}
            </Link>
        );
    }
    if (row.source_type === 'STOCK_TRANSFER' && row.source_id) {
        return (
            <Link to="/commerce/inventory/transfers/$transferId" params={{ transferId: row.source_id }} className="text-primary-500 hover:underline">
                {text}
            </Link>
        );
    }
    return <span>{text}</span>;
}

/**
 * Labels tab (contract §7.3), one place: the print queue (all waiting rows
 * chosen by default), Print → template and symbols → the PDF → "Did the
 * labels come out well?" → Mark printed; Reprint; Tags to replace after a
 * price change; history of printed and cancelled rows.
 */
export function LabelsTab({ locationId }: TabProps) {
    const { t } = useTranslation('commerce');
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('lbl');
    const place = locationId as string;
    const [status, setStatus] = useState<string>('PENDING');
    const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
    const [printing, setPrinting] = useState<LabelRow[] | null>(null);
    const [reprint, setReprint] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [showReplace, setShowReplace] = useState(false);
    const query = useLabels({ locationId: place, status, page: 0, size: 100 });
    const rows = query.data?.rows ?? [];
    const pending = status === 'PENDING';
    const selected = pending ? rows.filter((r) => !unchecked.has(r.id)) : [];

    const toggle = (id: string) => {
        const next = new Set(unchecked);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setUnchecked(next);
    };

    const cancelSelected = async () => {
        const ids = selected.map((r) => r.id);
        await write.run({
            scope: 'cancel-labels',
            body: { request_ids: ids },
            send: (id) => cancelLabels({ client_request_id: id, request_ids: ids }),
            onDone: (n) => {
                toast.success(t('inventory.labels.cancelled', { count: n }));
                void invalidate();
            },
        });
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <PlainSelect
                    className="sm:w-60"
                    label={t('inventory.labels.show')}
                    value={status}
                    onChange={(value) => {
                        setStatus(value || 'PENDING');
                        setUnchecked(new Set());
                    }}
                    options={LABEL_STATUSES.map((value) => ({ value, label: t(`status.labelRequest.${value}`) }))}
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                    <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onClick={() => setShowReplace(!showReplace)}>
                        {t('inventory.labels.toReplace')}
                    </MyButton>
                    <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onClick={() => setReprint(true)}>
                        {t('inventory.labels.reprint')}
                    </MyButton>
                    {pending && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            className={TOUCH}
                            disable={selected.length === 0}
                            onClick={() => setPrinting(selected)}
                            data-testid="labels-open-print"
                        >
                            {t('inventory.labels.printCount', { count: labelCount(selected) })}
                        </MyButton>
                    )}
                </div>
            </div>
            {showReplace && <ToReplaceCard locationId={place} />}
            <SectionCard title={pending ? t('inventory.labels.queue') : t('inventory.labels.history')}>
                {query.isLoading && <CommerceLoadingRows rows={3} />}
                {query.isError && <InventoryErrorNotice error={query.error} />}
                {query.isSuccess && rows.length === 0 && (
                    <CommerceEmptyState title={pending ? t('inventory.labels.emptyQueue') : t('inventory.labels.emptyHistory')} />
                )}
                <ul className="flex flex-col divide-y divide-border" data-testid="labels-queue">
                    {rows.map((row) => (
                        <li key={row.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                            <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3">
                                {pending && (
                                    <input
                                        type="checkbox"
                                        checked={!unchecked.has(row.id)}
                                        onChange={() => toggle(row.id)}
                                        className="size-5 shrink-0 accent-primary-500"
                                        aria-label={row.sku ?? row.id}
                                    />
                                )}
                                <ItemCell name={row.item_name} variant={row.variant_name} sku={row.sku} code={row.piece_code ?? row.label_code} />
                            </label>
                            <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                                {!row.piece_id && <span className="tabular-nums">×{row.quantity}</span>}
                                <CommerceStatusChip kind="labelRequest" value={row.status} />
                                <span>{row.reason ? t(`inventory.labels.reasons.${row.reason}`) : ''}</span>
                                <SourceLink row={row} />
                                <span>{row.created_at ? formatDateTime(row.created_at) : ''}</span>
                                {!row.has_price && <span className="text-danger-600">{t('inventory.labels.noPrice')}</span>}
                            </div>
                        </li>
                    ))}
                </ul>
                {pending && selected.length > 0 && (
                    <div>
                        <MyButton type="button" buttonType="text" scale="medium" className={TOUCH} onClick={() => setCancelling(true)}>
                            {t('inventory.labels.cancelSelected')}
                        </MyButton>
                    </div>
                )}
            </SectionCard>
            {printing && (
                <PrintLabelsDialog
                    open
                    onOpenChange={(open) => !open && setPrinting(null)}
                    rows={printing}
                    locationId={place}
                    onPrinted={() => setUnchecked(new Set())}
                />
            )}
            {reprint && <ReprintDialog open onOpenChange={setReprint} locationId={place} />}
            <ConfirmDialog
                open={cancelling}
                onOpenChange={setCancelling}
                heading={t('inventory.labels.cancelSelected')}
                confirmLabel={t('inventory.labels.cancelConfirm')}
                onConfirm={cancelSelected}
                danger
            >
                <p>{t('inventory.labels.cancelQuestion', { count: selected.length })}</p>
            </ConfirmDialog>
            {write.dialog}
        </div>
    );
}

function ToReplaceCard({ locationId }: { locationId: string }) {
    const { t } = useTranslation('commerce');
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('ptag');
    const query = useLabelsToReplace(locationId, true);
    const [error, setError] = useState<unknown>(null);
    const rows = (query.data ?? []).filter((r) => r.on_hand > 0);

    const queue = async (items: ToReplaceRow[]) => {
        setError(null);
        const body = {
            location_id: locationId,
            reason: 'PRICE_CHANGE' as const,
            lines: items.map((r) => ({ package_session_id: r.package_session_id, quantity: Math.min(10000, r.on_hand) })),
        };
        try {
            await write.run({
                scope: 'price-change',
                body,
                send: (id) => requestLabels({ ...body, client_request_id: id }),
                onDone: () => {
                    toast.success(t('inventory.labels.queued'));
                    void invalidate();
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    return (
        <SectionCard
            title={t('inventory.labels.toReplace')}
            description={t('inventory.labels.toReplaceHelp')}
            actions={
                rows.length > 0 ? (
                    <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onAsyncClick={() => queue(rows)}>
                        {t('inventory.labels.queueLabels')}
                    </MyButton>
                ) : undefined
            }
        >
            {query.isLoading && <CommerceLoadingRows rows={2} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.isSuccess && rows.length === 0 && <p className="text-body text-muted-foreground">{t('inventory.labels.nothingToReplace')}</p>}
            <ul className="flex flex-col divide-y divide-border">
                {rows.map((row) => (
                    <li key={row.package_session_id} className="flex items-center justify-between gap-3 py-2">
                        <ItemCell name={row.item_name} sku={row.sku} />
                        <span className="flex items-center gap-2 text-caption">
                            {row.printed_mrp !== null && <MoneyCell value={row.printed_mrp} />}→
                            {row.current_mrp !== null && <MoneyCell value={row.current_mrp} />}
                            <span className="text-muted-foreground">×{row.on_hand}</span>
                        </span>
                    </li>
                ))}
            </ul>
            <InventoryErrorNotice error={error} />
        </SectionCard>
    );
}
