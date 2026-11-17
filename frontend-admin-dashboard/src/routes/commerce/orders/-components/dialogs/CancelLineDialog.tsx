import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { itemLines, liveShipment, openQuantity } from '@/routes/commerce/orders/-shared/order-actions';
import { cancelOrderLine } from '@/routes/commerce/orders/-shared/order-api';
import {
    displayQuantity,
    formatQuantity,
    storedQuantity,
} from '@/routes/commerce/orders/-shared/order-format';
import type { LineCancelBody } from '@/routes/commerce/orders/-shared/order-types';
import { DialogButtons, Field, OrderErrorAlert, OrderNotice, TextAreaField, inputClass } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { resolvePieceIds } from './piece-ids';
import { useDialogWrite } from './use-dialog-write';

type CancelLineWrite = LineCancelBody & { line_id: string };

/**
 * Cancel part of an item line (contract §5.6.4). At PACKED a one-of-a-kind line
 * names exactly which packed pieces leave the parcel.
 */
export function CancelLineDialog({ open, onOpenChange, detail }: OrderDialogProps) {
    const { t } = useTranslation('commerce');
    const order = detail.order;
    const lines = itemLines(detail).filter((line) => openQuantity(line) > 0);
    const shipment = liveShipment(detail);
    const [lineId, setLineId] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [reason, setReason] = useState('');
    const [note, setNote] = useState('');
    const [picked, setPicked] = useState<string[]>([]);
    const [touched, setTouched] = useState(false);
    const [lookupFailed, setLookupFailed] = useState(false);
    const write = useDialogWrite(
        ({ line_id, ...body }: CancelLineWrite) => cancelOrderLine(order.id, line_id, body),
        { open, onOpenChange, currency: order.currency, prefix: 'cln' }
    );
    useEffect(() => {
        if (!open) return;
        setLineId(lines.length === 1 ? (lines[0]?.id ?? '') : '');
        setQuantity('1');
        setReason('');
        setNote('');
        setPicked([]);
        setTouched(false);
        setLookupFailed(false);
        // Fresh on every opening.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const line = lines.find((l) => l.id === lineId) ?? null;
    const shipLine = line ? shipment?.lines.find((s) => s.order_line_id === line.id) : undefined;
    const pieceCodes = order.status === 'PACKED' ? (shipLine?.piece_codes ?? []) : [];
    const needsPieces = pieceCodes.length > 0;
    const open$ = line ? openQuantity(line) : 0;
    const stored = line ? storedQuantity(Number(quantity), line.qty_scale) : 0;

    const problems = {
        line: !line ? 'orders.dialogs.cancelLine.lineRequired' : null,
        quantity:
            line && (!Number.isFinite(stored) || stored < 1 || stored > open$)
                ? 'orders.dialogs.cancelLine.quantityRange'
                : null,
        reason: !reason.trim() ? 'orders.dialogs.reasonRequired' : null,
        pieces: needsPieces && picked.length !== stored ? 'orders.dialogs.cancelLine.pickPieces' : null,
    };
    const invalid = Object.values(problems).some(Boolean);

    const submit = async () => {
        setTouched(true);
        if (invalid || !line) return;
        setLookupFailed(false);
        let pieceIds: string[] | undefined;
        if (needsPieces && shipLine) {
            try {
                pieceIds = await resolvePieceIds(picked, shipLine.piece_codes, shipLine.piece_ids);
            } catch {
                setLookupFailed(true);
                return;
            }
        }
        const done = await write.submit({
            line_id: line.id,
            quantity: stored,
            reason: reason.trim(),
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(pieceIds ? { piece_ids: pieceIds } : {}),
        });
        if (done) {
            toast.success(t('orders.dialogs.cancelLine.done'));
            write.close();
        }
    };

    const show = (key: string | null) => (touched && key ? t(key) : null);

    return (
        <MyDialog
            heading={t('orders.actions.CANCEL_LINE')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={submit}>
                        {t('orders.actions.CANCEL_LINE')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <PlainSelect
                    label={t('orders.dialogs.cancelLine.line')}
                    value={lineId}
                    onChange={(value) => {
                        setLineId(value);
                        setPicked([]);
                        setQuantity('1');
                    }}
                    options={lines.map((l) => ({
                        value: l.id,
                        label: `${l.name ?? l.sku ?? ''}${l.variant_label ? ` · ${l.variant_label}` : ''} (${formatQuantity(openQuantity(l), l.qty_scale, l.unit, t)})`,
                    }))}
                    invalid={touched && !!problems.line}
                />
                {show(problems.line) && (
                    <p role="alert" className="text-caption text-danger-600">
                        {show(problems.line)}
                    </p>
                )}
                {line && (
                    <Field
                        label={t('orders.dialogs.cancelLine.quantity')}
                        htmlFor="cancel-line-qty"
                        required
                        hint={t('orders.dialogs.cancelLine.openHint', {
                            quantity: formatQuantity(open$, line.qty_scale, line.unit, t),
                        })}
                        error={show(problems.quantity)}
                    >
                        <input
                            id="cancel-line-qty"
                            type="number"
                            inputMode="decimal"
                            min={line.qty_scale > 1 ? 1 / line.qty_scale : 1}
                            max={displayQuantity(open$, line.qty_scale)}
                            step={line.qty_scale > 1 ? 1 / line.qty_scale : 1}
                            className={inputClass}
                            value={quantity}
                            onChange={(event) => setQuantity(event.target.value)}
                        />
                    </Field>
                )}
                {needsPieces && (
                    <Field label={t('orders.dialogs.cancelLine.pieces')} error={show(problems.pieces)}>
                        <ul className="flex flex-col gap-1">
                            {pieceCodes.map((code) => {
                                const id = `cancel-piece-${code}`;
                                return (
                                    <li key={code} className="flex min-h-12 items-center gap-2 md:min-h-0">
                                        <Checkbox
                                            id={id}
                                            checked={picked.includes(code)}
                                            onCheckedChange={(checked) =>
                                                setPicked((current) =>
                                                    checked === true
                                                        ? [...current, code]
                                                        : current.filter((c) => c !== code)
                                                )
                                            }
                                        />
                                        <label htmlFor={id} className="font-mono text-body text-foreground">
                                            {code}
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </Field>
                )}
                <TextAreaField
                    id="cancel-line-reason"
                    label={t('orders.reason')}
                    value={reason}
                    onChange={setReason}
                    required
                    error={show(problems.reason)}
                />
                <TextAreaField id="cancel-line-note" label={t('orders.note')} value={note} onChange={setNote} />
                <OrderNotice tone="info">{t('orders.dialogs.cancelLine.wholeOrder')}</OrderNotice>
                {lookupFailed && <OrderNotice tone="danger">{t('orders.dialogs.pieceLookupFailed')}</OrderNotice>}
                <OrderErrorAlert error={write.error} currency={order.currency} />
            </div>
        </MyDialog>
    );
}
