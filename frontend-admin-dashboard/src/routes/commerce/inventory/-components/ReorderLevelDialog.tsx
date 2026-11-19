import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DialogButtons, Field, inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { lengthInputText } from '@/routes/commerce/-shared/units';
import { setReorderLevel } from '../-shared/inventory-api';
import { useInvalidateInventory } from '../-shared/inventory-hooks';
import type { ItemFacts, PlaceRef } from '../-shared/inventory-types';
import { InventoryErrorNotice, ItemCell, parseDisplayQuantity, TOUCH, typedLengthProblem } from './inventory-ui';

/** Set reorder level (manager only; `PUT /stock/levels/reorder-level`). Empty clears it. */
export function ReorderLevelDialog({
    open,
    onOpenChange,
    item,
    place,
    current,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: ItemFacts;
    place: PlaceRef;
    current: number | null;
}) {
    const { t } = useTranslation('commerce');
    const invalidate = useInvalidateInventory();
    const [text, setText] = useState(current === null ? '' : lengthInputText(current, item.qty_scale));
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);

    const save = async () => {
        setProblem(null);
        setError(null);
        const level = text.trim() === '' ? null : parseDisplayQuantity(text, item.qty_scale);
        if (text.trim() !== '' && level === null) {
            return setProblem(typedLengthProblem(text, item.qty_scale, t) ?? t('inventory.adjust.problems.quantity'));
        }
        try {
            await setReorderLevel({ location_id: place.id, package_session_id: item.package_session_id, reorder_level: level });
            toast.success(t('inventory.reorder.done'));
            void invalidate();
            onOpenChange(false);
        } catch (e) {
            setError(e);
        }
    };

    return (
        <MyDialog
            heading={t('inventory.stock.setReorder')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onAsyncClick={save}>
                        {t('common.save')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <ItemCell name={item.product_name} variant={item.variant_name} sku={item.sku} />
                <Field
                    label={t('inventory.stock.reorderLevel')}
                    htmlFor="reorder-level"
                    hint={t('inventory.reorder.hint', { place: place.code ?? place.name ?? '' })}
                    error={problem}
                >
                    <input
                        id="reorder-level"
                        className={inputClass}
                        inputMode="decimal"
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                    />
                </Field>
                <InventoryErrorNotice error={error} />
            </div>
        </MyDialog>
    );
}
