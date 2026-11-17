import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { liveShipment } from '@/routes/commerce/orders/-shared/order-actions';
import { changeShipmentStatus } from '@/routes/commerce/orders/-shared/order-api';
import {
    displayQuantity,
    formatQuantity,
    storedQuantity,
} from '@/routes/commerce/orders/-shared/order-format';
import {
    CONDITIONS,
    type Condition,
    type ShipmentStatusBody,
    type StaffShipmentLine,
    type StatusLine,
} from '@/routes/commerce/orders/-shared/order-types';
import { DialogButtons, Field, OrderErrorAlert, OrderNotice, TextAreaField, inputClass } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { resolvePieceIds } from './piece-ids';
import { useDialogWrite } from './use-dialog-write';

/** Per piece code its condition; per quantity line the resaleable and damaged amounts (display units). */
interface ReceiveState {
    pieces: Record<string, Condition>;
    counts: Record<string, { resaleable: string; damaged: string }>;
}

export function PieceConditionRow({
    code,
    value,
    onChange,
}: {
    code: string;
    value: Condition;
    onChange: (value: Condition) => void;
}) {
    const { t } = useTranslation('commerce');
    return (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono text-body text-foreground">{code}</span>
            <RadioGroup
                value={value}
                onValueChange={(next) => onChange(next as Condition)}
                className="flex flex-wrap gap-4"
                aria-label={code}
            >
                {CONDITIONS.map((condition) => {
                    const id = `cond-${code}-${condition}`;
                    return (
                        <label key={condition} htmlFor={id} className="flex min-h-12 items-center gap-2 text-body md:min-h-0">
                            <RadioGroupItem id={id} value={condition} />
                            {t(`orders.condition.${condition}`)}
                        </label>
                    );
                })}
            </RadioGroup>
        </div>
    );
}

/** Receive the returned parcel: each unit back on the shelf or written off as damaged (§5.4.3). */
export function RtoReceiveDialog({ open, onOpenChange, detail }: OrderDialogProps) {
    const { t } = useTranslation('commerce');
    const shipment = liveShipment(detail);
    const lines = shipment?.lines ?? [];
    const lineById = new Map(detail.lines.map((line) => [line.id, line]));
    const [state, setState] = useState<ReceiveState>({ pieces: {}, counts: {} });
    const [note, setNote] = useState('');
    const [lookupFailed, setLookupFailed] = useState(false);
    const write = useDialogWrite(
        (body: ShipmentStatusBody) => changeShipmentStatus(shipment?.id ?? '', body),
        { open, onOpenChange, currency: detail.order.currency, prefix: 'rtr' }
    );

    useEffect(() => {
        if (!open) return;
        const pieces: ReceiveState['pieces'] = {};
        const counts: ReceiveState['counts'] = {};
        lines.forEach((line) => {
            if (line.piece_codes.length > 0) {
                line.piece_codes.forEach((code) => (pieces[code] = 'RESALEABLE'));
            } else {
                const scale = lineById.get(line.order_line_id)?.qty_scale;
                counts[line.id] = { resaleable: String(displayQuantity(line.quantity, scale)), damaged: '0' };
            }
        });
        setState({ pieces, counts });
        setNote('');
        setLookupFailed(false);
        // Fresh on every opening.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const countProblem = (line: StaffShipmentLine): boolean => {
        const entry = state.counts[line.id];
        if (!entry) return false;
        const scale = lineById.get(line.order_line_id)?.qty_scale;
        const good = Number(entry.resaleable || 0);
        const bad = Number(entry.damaged || 0);
        if (!Number.isFinite(good) || !Number.isFinite(bad) || good < 0 || bad < 0) return true;
        return storedQuantity(good, scale) + storedQuantity(bad, scale) !== line.quantity;
    };
    const invalid = lines.some(countProblem);

    const buildLines = async (): Promise<StatusLine[]> => {
        const out: StatusLine[] = [];
        for (const line of lines) {
            if (line.piece_codes.length > 0) {
                for (const condition of CONDITIONS) {
                    const codes = line.piece_codes.filter((code) => state.pieces[code] === condition);
                    if (codes.length === 0) continue;
                    const ids = await resolvePieceIds(codes, line.piece_codes, line.piece_ids);
                    out.push({ order_line_id: line.order_line_id, condition, quantity: codes.length, piece_ids: ids });
                }
            } else {
                const entry = state.counts[line.id];
                const scale = lineById.get(line.order_line_id)?.qty_scale;
                const good = storedQuantity(Number(entry?.resaleable || 0), scale);
                const bad = storedQuantity(Number(entry?.damaged || 0), scale);
                if (good > 0) out.push({ order_line_id: line.order_line_id, condition: 'RESALEABLE', quantity: good });
                if (bad > 0) out.push({ order_line_id: line.order_line_id, condition: 'DAMAGED', quantity: bad });
            }
        }
        return out;
    };

    const submit = async () => {
        if (invalid || !shipment) return;
        setLookupFailed(false);
        let bodyLines: StatusLine[];
        try {
            bodyLines = await buildLines();
        } catch {
            setLookupFailed(true);
            return;
        }
        const done = await write.submit({
            to: 'RTO_RECEIVED',
            lines: bodyLines,
            ...(note.trim() ? { note: note.trim() } : {}),
        });
        if (done) {
            toast.success(t('orders.dialogs.rtoReceive.done'));
            write.close();
        }
    };

    return (
        <MyDialog
            heading={t('orders.actions.RTO_RECEIVE')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={invalid || !shipment}
                        onAsyncClick={submit}
                    >
                        {t('orders.dialogs.rtoReceive.submit')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-muted-foreground">{t('orders.dialogs.rtoReceive.help')}</p>
                {lines.map((line) => {
                    const orderLine = lineById.get(line.order_line_id);
                    const scale = orderLine?.qty_scale;
                    const entry = state.counts[line.id];
                    return (
                        <section key={line.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <span className="text-body font-medium text-foreground">
                                    {orderLine?.name ?? '—'}
                                    {orderLine?.variant_label ? ` · ${orderLine.variant_label}` : ''}
                                </span>
                                <span className="text-caption text-muted-foreground">
                                    {formatQuantity(line.quantity, scale, orderLine?.unit, t)}
                                </span>
                            </div>
                            {line.piece_codes.length > 0 ? (
                                line.piece_codes.map((code) => (
                                    <PieceConditionRow
                                        key={code}
                                        code={code}
                                        value={state.pieces[code] ?? 'RESALEABLE'}
                                        onChange={(value) =>
                                            setState((current) => ({
                                                ...current,
                                                pieces: { ...current.pieces, [code]: value },
                                            }))
                                        }
                                    />
                                ))
                            ) : (
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {(['resaleable', 'damaged'] as const).map((kind) => (
                                        <Field
                                            key={kind}
                                            label={t(kind === 'resaleable' ? 'orders.condition.RESALEABLE' : 'orders.condition.DAMAGED')}
                                            htmlFor={`rto-${line.id}-${kind}`}
                                        >
                                            <input
                                                id={`rto-${line.id}-${kind}`}
                                                type="number"
                                                inputMode="decimal"
                                                min={0}
                                                step={scale && scale > 1 ? 1 / scale : 1}
                                                className={inputClass}
                                                value={entry?.[kind] ?? ''}
                                                onChange={(event) =>
                                                    setState((current) => ({
                                                        ...current,
                                                        counts: {
                                                            ...current.counts,
                                                            [line.id]: {
                                                                resaleable: current.counts[line.id]?.resaleable ?? '0',
                                                                damaged: current.counts[line.id]?.damaged ?? '0',
                                                                [kind]: event.target.value,
                                                            },
                                                        },
                                                    }))
                                                }
                                            />
                                        </Field>
                                    ))}
                                    {countProblem(line) && (
                                        <p role="alert" className="text-caption text-danger-600 sm:col-span-2">
                                            {t('orders.dialogs.rtoReceive.mustAddUp', {
                                                quantity: formatQuantity(line.quantity, scale, orderLine?.unit, t),
                                            })}
                                        </p>
                                    )}
                                </div>
                            )}
                        </section>
                    );
                })}
                <TextAreaField id="rto-receive-note" label={t('orders.note')} value={note} onChange={setNote} />
                {lookupFailed && <OrderNotice tone="danger">{t('orders.dialogs.pieceLookupFailed')}</OrderNotice>}
                <OrderErrorAlert error={write.error} currency={detail.order.currency} />
            </div>
        </MyDialog>
    );
}
