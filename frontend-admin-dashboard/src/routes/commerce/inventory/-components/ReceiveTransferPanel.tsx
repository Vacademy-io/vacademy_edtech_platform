import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { PlainSelect, SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { TextAreaField } from '@/routes/commerce/orders/-components/order-ui';
import { displayQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { receiveTransfer } from '../-shared/inventory-api';
import { useInvalidateInventory } from '../-shared/inventory-hooks';
import { SHORTFALL_REASONS, type ShortfallReason, type TransferView } from '../-shared/inventory-types';
import {
    applyReceive,
    canReceive,
    type ReceiveEvent,
    type ReceiveState,
    receiveFromView,
    toReceiveBody,
} from '../-shared/transfer-lines';
import { type StockScan, useStockScan } from '../-shared/use-stock-scan';
import { InventoryErrorNotice, ItemCell, parseDisplayQuantity, Qty, useInventoryErrorText } from './inventory-ui';
import { type ScanMessage, StockScanBox } from './StockScanBox';
import { useInventoryWrite } from './use-inventory-write';

/**
 * Receive a transfer at its destination (contract §3.4, §7.3): each line's
 * Sent and Received (quantity lines start at what was sent, pieces at 0 and
 * are ticked by scanning their label); a short line asks "Why is it short?".
 * A shortage above the shop's limit needs a manager's PIN: the dialog lists
 * the approvers of the destination and the same body goes again with
 * `approval`, under the same request id.
 */
export function ReceiveTransferPanel({ view }: { view: TransferView }) {
    const { t } = useTranslation('commerce');
    const errorText = useInventoryErrorText();
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('rcv');
    const [state, setState] = useState<ReceiveState>(() => receiveFromView(view));
    const [typed, setTyped] = useState<Record<string, string>>({});
    const [note, setNote] = useState('');
    const [message, setMessage] = useState<ScanMessage | null>(null);
    const [error, setError] = useState<unknown>(null);

    const apply = (event: ReceiveEvent): boolean => {
        const outcome = applyReceive(state, event);
        if (outcome.refusal) {
            scan.refuse();
            setMessage({ tone: 'danger', text: t(`inventory.transferLines.${outcome.refusal}`) });
            return false;
        }
        setState(outcome.state);
        return true;
    };

    const onScan = (result: StockScan) => {
        if (result.kind === 'PIECE' && result.result.piece) {
            if (apply({ type: 'RECEIVE_SCAN_PIECE', code: result.result.piece.code })) {
                setMessage({ tone: 'success', text: t('inventory.receiveTransfer.ticked', { code: result.result.piece.code }) });
            }
        } else if (result.kind === 'VARIANT') {
            const v = result.result.variant;
            if (apply({ type: 'RECEIVE_SCAN_VARIANT', packageSessionId: v.package_session_id })) {
                setTyped({});
                setMessage({ tone: 'success', text: t('inventory.receive.added', { item: v.product_name ?? v.sku ?? '' }) });
            }
        } else if (result.kind === 'NOT_FOUND') {
            setMessage({ tone: 'danger', text: t('inventory.scan.notFound') });
        } else if (result.kind === 'ERROR') {
            setMessage({ tone: 'danger', text: errorText(result.error) });
        }
    };
    const scan = useStockScan(onScan, { paused: write.pinOpen });

    const receive = async () => {
        setError(null);
        const body = { ...toReceiveBody(state), ...(note.trim() ? { note: note.trim() } : {}) };
        try {
            await write.run({
                scope: `receive:${view.id}`,
                body,
                approvalAt: view.to?.id ?? null,
                approvalText: t('inventory.approval.shortfall'),
                send: (id, approval) =>
                    receiveTransfer(view.id, { ...body, client_request_id: id, ...(approval ? { approval } : {}) }),
                onDone: () => {
                    toast.success(t('inventory.receiveTransfer.done'));
                    void invalidate();
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    const ready = canReceive(state);
    const byId = new Map(view.lines.map((l) => [l.id, l]));

    return (
        <SectionCard title={t('inventory.receiveTransfer.title')} description={t('inventory.receiveTransfer.help')}>
            <StockScanBox scan={scan} message={message} locationId={view.to?.id ?? null} testId="receive-scan" />
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="receive-transfer-lines">
                {state.lines.map((line) => {
                    const info = byId.get(line.line_id);
                    const scale = info?.qty_scale ?? 1;
                    const short = line.received < line.sent;
                    return (
                        <li key={line.line_id} className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
                            <ItemCell name={info?.item_name} variant={info?.variant_name} sku={info?.sku} code={line.piece_code} />
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                                <div className="flex flex-col gap-1">
                                    <span className="text-caption text-muted-foreground">{t('inventory.transfers.sent')}</span>
                                    <Qty qty={line.sent} scale={scale} unit={info?.unit} className="text-body" />
                                </div>
                                {line.piece_code ? (
                                    <label className="flex min-h-12 items-center gap-2 text-body">
                                        <input
                                            type="checkbox"
                                            checked={line.received === 1}
                                            onChange={(event) =>
                                                apply({ type: 'SET_RECEIVED', lineId: line.line_id, quantity: event.target.checked ? 1 : 0 })
                                            }
                                            className="size-5 accent-primary-500"
                                        />
                                        {t('inventory.receiveTransfer.arrived')}
                                    </label>
                                ) : (
                                    <label className="flex flex-col gap-1 text-caption text-muted-foreground">
                                        {t('inventory.transfers.receivedQty')}
                                        <input
                                            inputMode={scale > 1 ? 'decimal' : 'numeric'}
                                            value={typed[line.line_id] ?? String(displayQuantity(line.received, scale))}
                                            onChange={(event) => {
                                                const text = event.target.value;
                                                setTyped({ ...typed, [line.line_id]: text });
                                                const base = parseDisplayQuantity(text, scale);
                                                if (base !== null) apply({ type: 'SET_RECEIVED', lineId: line.line_id, quantity: base });
                                            }}
                                            className="h-12 w-28 rounded-md border border-neutral-300 bg-background px-3 text-end text-body tabular-nums text-foreground focus:border-primary-500 focus:outline-none"
                                        />
                                    </label>
                                )}
                                {short && (
                                    <PlainSelect
                                        className="sm:w-56"
                                        label={t('inventory.transfers.shortReason')}
                                        value={line.reason ?? ''}
                                        invalid={!line.reason}
                                        onChange={(value) =>
                                            apply({
                                                type: 'SET_REASON',
                                                lineId: line.line_id,
                                                reason: (value || null) as ShortfallReason | null,
                                            })
                                        }
                                        options={SHORTFALL_REASONS.map((value) => ({ value, label: t(`inventory.shortfall.${value}`) }))}
                                    />
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
            <TextAreaField id="receive-transfer-note" label={t('inventory.transfers.note')} value={note} onChange={setNote} maxLength={500} />
            {!ready && <p className="text-caption text-warning-600">{t('inventory.receiveTransfer.needReasons')}</p>}
            <InventoryErrorNotice error={error} />
            <div className="flex justify-stretch sm:justify-end sm:pe-24">
                {/* Disabled until every short line has a reason; the disabled state is set only then. */}
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large"
                    className="h-14 w-full sm:w-auto"
                    disable={ready ? undefined : true}
                    onAsyncClick={receive}
                    data-testid="receive-transfer"
                >
                    {t('inventory.transfers.receive')}
                </MyButton>
            </div>
            {write.dialog}
        </SectionCard>
    );
}
