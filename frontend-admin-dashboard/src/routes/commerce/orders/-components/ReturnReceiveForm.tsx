import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { COMMERCE_FEATURE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { useLocations } from '@/routes/commerce/-shared/commerce-hooks';
import { receiveReturn } from '@/routes/commerce/orders/-shared/order-api';
import { lengthProblemText } from '@/routes/commerce/-shared/units';
import { conditionLabel, conditionSplit, wholeText } from '@/routes/commerce/orders/-shared/length-entry';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { orderKeys } from '@/routes/commerce/orders/-shared/order-hooks';
import {
    CONDITIONS,
    type Condition,
    type ReturnLineView,
    type ReturnReceiveBody,
    type ReturnView,
    type StaffOrderDetail,
    type StatusLine,
} from '@/routes/commerce/orders/-shared/order-types';
import { PieceConditionRow } from './dialogs/RtoReceiveDialog';
import { resolvePieceIds } from './dialogs/piece-ids';
import { useAnswerWrite } from './dialogs/use-answer-write';
import { DialogButtons, Field, OrderErrorAlert, OrderNotice, TextAreaField, inputClass } from './order-ui';

/** The sold pieces of an order line, with their ids when the server sends them (B1). */
export function soldPieces(detail: StaffOrderDetail, orderLineId: string): { codes: string[]; ids: string[] | undefined } {
    const codes: string[] = [];
    const ids: string[] = [];
    let idsComplete = true;
    detail.shipments
        .filter((shipment) => shipment.status !== 'CANCELLED')
        .forEach((shipment) =>
            shipment.lines
                .filter((line) => line.order_line_id === orderLineId)
                .forEach((line) => {
                    codes.push(...line.piece_codes);
                    if (line.piece_ids && line.piece_ids.length === line.piece_codes.length) ids.push(...line.piece_ids);
                    else idsComplete = false;
                })
        );
    return { codes, ids: idsComplete ? ids : undefined };
}

interface PieceChoice {
    back: boolean;
    condition: Condition;
}

/**
 * Receive a customer return (contract §5.7.2 RECEIVE; warehouse, manager): for
 * a one-of-a-kind line tick which sold pieces came back and say each one's
 * condition; for a quantity line split the amount between "can be sold again"
 * and "damaged". The credit note is issued by the server.
 */
export function ReturnReceiveForm({
    view,
    detail,
    onDone,
    onCancel,
}: {
    view: ReturnView;
    detail: StaffOrderDetail;
    onDone: () => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation('commerce');
    const queryClient = useQueryClient();
    const access = useCommerceAccess();
    const stockOn = access.isFeatureOn(COMMERCE_FEATURE.STOCK);
    const locations = useLocations(stockOn && access.isManager);
    const lineById = useMemo(() => new Map(detail.lines.map((line) => [line.id, line])), [detail.lines]);
    /** The pieces a return line can name: the order line's sold pieces (from its parcel). */
    const soldByLine = useMemo(
        () => new Map(view.lines.map((line) => [line.id, soldPieces(detail, line.order_line_id)])),
        [view.lines, detail]
    );
    const candidatesOf = (line: ReturnLineView): string[] => {
        const sold = soldByLine.get(line.id)?.codes ?? [];
        return sold.length > 0 ? sold : line.piece_codes;
    };
    const isPieceLine = (line: ReturnLineView) => candidatesOf(line).length > 0;

    const [pieces, setPieces] = useState<Record<string, PieceChoice>>(() => {
        const out: Record<string, PieceChoice> = {};
        view.lines.forEach((line) => {
            const sold = soldPieces(detail, line.order_line_id).codes;
            const codes = sold.length > 0 ? sold : line.piece_codes;
            // When every sold piece of the line comes back, they start ticked.
            const all = codes.length === line.quantity;
            codes.forEach((code) => (out[code] = { back: all, condition: 'RESALEABLE' }));
        });
        return out;
    });
    const [counts, setCounts] = useState<Record<string, { resaleable: string; damaged: string }>>(() =>
        Object.fromEntries(
            view.lines
                .filter((line) => !isPieceLine(line))
                .map((line) => [
                    line.id,
                    {
                        resaleable: wholeText(line.quantity, lineById.get(line.order_line_id)?.qty_scale),
                        damaged: '0',
                    },
                ])
        )
    );
    const [locationId, setLocationId] = useState(view.location_id ?? '');
    const [note, setNote] = useState('');
    const [lookupFailed, setLookupFailed] = useState(false);

    const write = useAnswerWrite((body: ReturnReceiveBody) => receiveReturn(view.id, body), {
        open: true,
        onOpenChange: (open) => {
            if (!open) onCancel();
        },
        currency: detail.order.currency,
        prefix: 'rrc',
        onAnswer: (answer) => queryClient.setQueryData(orderKeys.returnView(view.id), answer),
    });

    const lineProblem = (line: ReturnLineView): boolean => {
        if (isPieceLine(line)) {
            return candidatesOf(line).filter((code) => pieces[code]?.back).length !== line.quantity;
        }
        return 'problem' in conditionSplit(counts[line.id], lineById.get(line.order_line_id)?.qty_scale, line.quantity);
    };
    /** A refused length box ("1.25" at scale 10) names its own sentence; null for "must add up". */
    const typedProblem = (line: ReturnLineView): string | null => {
        if (isPieceLine(line)) return null;
        const scale = lineById.get(line.order_line_id)?.qty_scale;
        const split = conditionSplit(counts[line.id], scale, line.quantity);
        return 'problem' in split && split.problem !== 'sum' ? lengthProblemText(split.problem, scale, t) : null;
    };
    const invalid = view.lines.some(lineProblem);

    const buildLines = async (): Promise<StatusLine[]> => {
        const out: StatusLine[] = [];
        for (const line of view.lines) {
            if (isPieceLine(line)) {
                const sold = soldByLine.get(line.id) ?? { codes: [], ids: undefined };
                const allCodes = candidatesOf(line);
                for (const condition of CONDITIONS) {
                    const codes = allCodes.filter(
                        (code) => pieces[code]?.back && pieces[code]?.condition === condition
                    );
                    if (codes.length === 0) continue;
                    const ids = await resolvePieceIds(codes, allCodes, sold.codes.length > 0 ? sold.ids : undefined);
                    out.push({ order_line_id: line.order_line_id, condition, quantity: codes.length, piece_ids: ids });
                }
            } else {
                const split = conditionSplit(counts[line.id], lineById.get(line.order_line_id)?.qty_scale, line.quantity);
                if ('problem' in split) continue;
                const { good, bad } = split;
                if (good > 0) out.push({ order_line_id: line.order_line_id, condition: 'RESALEABLE', quantity: good });
                if (bad > 0) out.push({ order_line_id: line.order_line_id, condition: 'DAMAGED', quantity: bad });
            }
        }
        return out;
    };

    const submit = async () => {
        if (invalid) return;
        setLookupFailed(false);
        let lines: StatusLine[];
        try {
            lines = await buildLines();
        } catch {
            setLookupFailed(true);
            return;
        }
        const answer = await write.submit({
            from_status: 'APPROVED',
            ...(stockOn && locationId ? { location_id: locationId } : {}),
            lines,
            ...(note.trim() ? { note: note.trim() } : {}),
        });
        if (answer) {
            toast.success(t('orders.returnSheet.received', { number: answer.credit_note?.number ?? '' }));
            onDone();
        }
    };

    const activeLocations = (locations.data ?? []).filter(
        (location) => (location.status ?? 'ACTIVE').toUpperCase() !== 'INACTIVE'
    );

    return (
        <section className="flex flex-col gap-4 rounded-lg border border-primary-200 p-3">
            <h4 className="text-subtitle font-medium text-foreground">{t('orders.returnSheet.receiveTitle')}</h4>
            <p className="text-caption text-muted-foreground">{t('orders.returnSheet.receiveHelp')}</p>
            {view.lines.map((line) => {
                const orderLine = lineById.get(line.order_line_id);
                const scale = orderLine?.qty_scale;
                const entry = counts[line.id];
                const problem = lineProblem(line);
                return (
                    <div key={line.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-body font-medium text-foreground">{line.name ?? line.sku ?? '—'}</span>
                            <span className="text-caption text-muted-foreground">
                                {formatQuantity(line.quantity, scale, orderLine?.unit, t)}
                            </span>
                        </div>
                        {isPieceLine(line) ? (
                            candidatesOf(line).map((code) => {
                                const choice = pieces[code] ?? { back: false, condition: 'RESALEABLE' as Condition };
                                const id = `return-piece-${code}`;
                                return (
                                    <div key={code} className="flex flex-col gap-2">
                                        <label htmlFor={id} className="flex min-h-12 items-center gap-2 text-body md:min-h-0">
                                            <Checkbox
                                                id={id}
                                                checked={choice.back}
                                                onCheckedChange={(checked) =>
                                                    setPieces((current) => ({
                                                        ...current,
                                                        [code]: { ...choice, back: checked === true },
                                                    }))
                                                }
                                            />
                                            {t('orders.returnSheet.cameBack', { code })}
                                        </label>
                                        {choice.back && (
                                            <PieceConditionRow
                                                code={code}
                                                value={choice.condition}
                                                onChange={(condition) =>
                                                    setPieces((current) => ({ ...current, [code]: { ...choice, condition } }))
                                                }
                                            />
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {(['resaleable', 'damaged'] as const).map((kind) => (
                                    <Field
                                        key={kind}
                                        label={conditionLabel(kind, scale, orderLine?.unit, t)}
                                        htmlFor={`return-${line.id}-${kind}`}
                                    >
                                        <input
                                            id={`return-${line.id}-${kind}`}
                                            inputMode={scale && scale > 1 ? 'decimal' : 'numeric'}
                                            className={inputClass}
                                            value={entry?.[kind] ?? ''}
                                            onChange={(event) =>
                                                setCounts((current) => ({
                                                    ...current,
                                                    [line.id]: {
                                                        resaleable: current[line.id]?.resaleable ?? '0',
                                                        damaged: current[line.id]?.damaged ?? '0',
                                                        [kind]: event.target.value,
                                                    },
                                                }))
                                            }
                                        />
                                    </Field>
                                ))}
                            </div>
                        )}
                        {problem && (
                            <p role="alert" className="text-caption text-danger-600">
                                {typedProblem(line) ??
                                    t(isPieceLine(line) ? 'orders.returnSheet.tickPieces' : 'orders.returnSheet.mustAddUp', {
                                        quantity: formatQuantity(line.quantity, scale, orderLine?.unit, t),
                                    })}
                            </p>
                        )}
                    </div>
                );
            })}
            {stockOn && activeLocations.length > 0 && (
                <PlainSelect
                    label={t('orders.returns.restockLocation')}
                    value={locationId}
                    onChange={setLocationId}
                    options={activeLocations.map((location) => ({ value: location.id, label: location.name }))}
                />
            )}
            <TextAreaField id="return-receive-note" label={t('orders.note')} value={note} onChange={setNote} />
            {lookupFailed && <OrderNotice tone="danger">{t('orders.dialogs.pieceLookupFailed')}</OrderNotice>}
            <OrderErrorAlert error={write.error} currency={detail.order.currency} />
            <DialogButtons onCancel={onCancel}>
                <MyButton type="button" buttonType="primary" scale="medium" disable={invalid} onAsyncClick={submit}>
                    {t('orders.returnSheet.receive')}
                </MyButton>
            </DialogButtons>
        </section>
    );
}
