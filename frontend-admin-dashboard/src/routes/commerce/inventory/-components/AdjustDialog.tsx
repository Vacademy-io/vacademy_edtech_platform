import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { DialogButtons, Field, inputClass, TextAreaField } from '@/routes/commerce/orders/-components/order-ui';
import { scanCode } from '@/routes/commerce/orders/-shared/order-api';
import { adjustStock } from '../-shared/inventory-api';
import { useInvalidateInventory } from '../-shared/inventory-hooks';
import { ADJUSTMENT_REASONS, DAMAGE_REASONS, type ItemFacts, type PlaceRef } from '../-shared/inventory-types';
import { ChoiceGroup, InventoryErrorNotice, ItemCell, parseDisplayQuantity, Qty, TOUCH, typedLengthProblem } from './inventory-ui';
import { useInventoryWrite } from './use-inventory-write';

type Kind = 'ADJUSTMENT' | 'DAMAGE';
type Direction = 'ADD' | 'REMOVE';

/**
 * Adjust stock / Record damage (contract §7.3, OPS §4): kind, quantity in or
 * out, a reason code and a note. A one-of-a-kind item names its piece by its
 * label code. Above the shop's limit a warehouse login gets
 * `403 APPROVAL_REQUIRED`: the manager PIN dialog opens with the approvers of
 * this place, and the same request goes again with the flat approver fields of
 * this route, under the same request id.
 */
export function AdjustDialog({
    open,
    onOpenChange,
    item,
    place,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: ItemFacts & { product_name?: string | null };
    place: PlaceRef;
}) {
    const { t } = useTranslation('commerce');
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('adj');
    const isPiece = (item.stock_mode ?? '').toUpperCase() === 'PIECE';
    const [kind, setKind] = useState<Kind>('ADJUSTMENT');
    const [direction, setDirection] = useState<Direction | null>(isPiece ? 'REMOVE' : null);
    const [quantity, setQuantity] = useState(isPiece ? '1' : '');
    const [pieceCode, setPieceCode] = useState('');
    const [reason, setReason] = useState('');
    const [note, setNote] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);

    const reasons = kind === 'DAMAGE' ? DAMAGE_REASONS : ADJUSTMENT_REASONS;
    const base = parseDisplayQuantity(quantity, item.qty_scale);

    const submit = async () => {
        setProblem(null);
        setError(null);
        const dir: Direction | null = kind === 'DAMAGE' ? 'REMOVE' : direction;
        if (!dir) return setProblem(t('inventory.adjust.problems.direction'));
        if (!base || base < 1) {
            return setProblem(typedLengthProblem(quantity, item.qty_scale, t) ?? t('inventory.adjust.problems.quantity'));
        }
        if (!reason) return setProblem(t('inventory.adjust.problems.reason'));
        let pieceId: string | undefined;
        if (isPiece) {
            const found = pieceCode.trim() ? await scanCode(pieceCode.trim()).catch(() => null) : null;
            if (!found?.piece || found.variant.package_session_id !== item.package_session_id) {
                return setProblem(t('inventory.adjust.problems.piece'));
            }
            pieceId = found.piece.id;
        }
        const body = {
            location_id: place.id,
            package_session_id: item.package_session_id,
            ...(pieceId ? { piece_id: pieceId } : {}),
            kind,
            quantity_delta: dir === 'REMOVE' ? -(isPiece ? 1 : base) : isPiece ? 1 : base,
            reason,
            ...(note.trim() ? { note: note.trim() } : {}),
        };
        try {
            await write.run({
                scope: `adjust:${place.id}:${item.package_session_id}`,
                body,
                approvalAt: place.id,
                approvalText: t('inventory.approval.adjust'),
                send: (id, approval) =>
                    adjustStock({
                        ...body,
                        client_request_id: id,
                        ...(approval ? { approver_user_id: approval.approver_user_id, approver_pin: approval.pin } : {}),
                    }),
                onDone: () => {
                    toast.success(t('inventory.adjust.done'));
                    void invalidate();
                    onOpenChange(false);
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    return (
        <>
            <MyDialog
                heading={kind === 'DAMAGE' ? t('inventory.stock.damage') : t('inventory.stock.adjust')}
                open={open && !write.pinOpen}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-lg"
                footer={
                    <DialogButtons onCancel={() => onOpenChange(false)}>
                        <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onAsyncClick={submit}>
                            {t('inventory.adjust.save')}
                        </MyButton>
                    </DialogButtons>
                }
            >
                <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-3 rounded-md bg-neutral-50 p-3">
                        <ItemCell name={item.product_name} variant={item.variant_name} sku={item.sku} />
                        <span className="shrink-0 text-caption text-muted-foreground">{place.code ?? place.name}</span>
                    </div>
                    <ChoiceGroup<Kind>
                        name="adjust-kind"
                        label={t('inventory.adjust.kind')}
                        value={kind}
                        onChange={(value) => {
                            setKind(value);
                            setReason('');
                        }}
                        options={[
                            { value: 'ADJUSTMENT', label: t('inventory.stock.adjust') },
                            { value: 'DAMAGE', label: t('inventory.stock.damage') },
                        ]}
                    />
                    {kind === 'ADJUSTMENT' && (
                        <ChoiceGroup<Direction>
                            name="adjust-direction"
                            label={t('inventory.adjust.direction')}
                            value={direction}
                            onChange={setDirection}
                            options={[
                                { value: 'ADD', label: t('inventory.adjust.add') },
                                { value: 'REMOVE', label: t('inventory.adjust.remove') },
                            ]}
                        />
                    )}
                    {isPiece ? (
                        <Field label={t('inventory.adjust.pieceCode')} htmlFor="adjust-piece" required>
                            <input
                                id="adjust-piece"
                                className={inputClass}
                                value={pieceCode}
                                autoCapitalize="characters"
                                autoComplete="off"
                                maxLength={100}
                                onChange={(event) => setPieceCode(event.target.value)}
                            />
                        </Field>
                    ) : (
                        <Field
                            label={t('inventory.adjust.quantity')}
                            htmlFor="adjust-qty"
                            required
                            hint={
                                base ? (
                                    <Qty qty={base} scale={item.qty_scale} unit={item.unit} />
                                ) : undefined
                            }
                        >
                            <input
                                id="adjust-qty"
                                className={inputClass}
                                inputMode="decimal"
                                value={quantity}
                                onChange={(event) => setQuantity(event.target.value)}
                            />
                        </Field>
                    )}
                    <PlainSelect
                        label={t('inventory.adjust.reason')}
                        value={reason}
                        onChange={setReason}
                        placeholder={t('inventory.adjust.reasonPlaceholder')}
                        options={reasons.map((code) => ({ value: code, label: t(`inventory.reasons.${code}`) }))}
                    />
                    <TextAreaField id="adjust-note" label={t('inventory.adjust.note')} value={note} onChange={setNote} maxLength={500} />
                    {problem && (
                        <p role="alert" className="text-caption text-danger-600">
                            {problem}
                        </p>
                    )}
                    <InventoryErrorNotice error={error} />
                </div>
            </MyDialog>
            {write.dialog}
        </>
    );
}
