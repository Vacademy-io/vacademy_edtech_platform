import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DialogButtons, Field, inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { typeReceiptCost } from '../-shared/inventory-api';
import { useInvalidateInventory } from '../-shared/inventory-hooks';
import type { ReceiptView } from '../-shared/inventory-types';
import { InventoryErrorNotice, ItemCell, TOUCH } from './inventory-ui';
import { useInventoryWrite } from './use-inventory-write';

const MONEY = /^\d{1,10}(\.\d{1,4})?$/;

/** Type cost (manager; `PATCH /stock/receipts/{id}/cost`): cost per base unit for each line. */
export function TypeCostDialog({
    open,
    onOpenChange,
    receipt,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    receipt: ReceiptView;
}) {
    const { t } = useTranslation('commerce');
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('cost');
    const [costs, setCosts] = useState<Record<string, string>>(() =>
        Object.fromEntries(receipt.lines.map((l) => [l.id, l.unit_cost === null ? '' : String(l.unit_cost)]))
    );
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);

    const save = async () => {
        setProblem(null);
        setError(null);
        const lines = Object.entries(costs)
            .filter(([, value]) => value.trim() !== '')
            .map(([line_id, value]) => ({ line_id, unit_cost: value.trim() }));
        if (lines.length === 0 || lines.some((l) => !MONEY.test(l.unit_cost))) {
            return setProblem(t('inventory.receipt.costProblem'));
        }
        try {
            await write.run({
                scope: `cost:${receipt.id}`,
                body: { lines },
                send: (id) => typeReceiptCost(receipt.id, { client_request_id: id, lines }),
                onDone: () => {
                    toast.success(t('inventory.receipt.costSaved'));
                    void invalidate();
                    onOpenChange(false);
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    return (
        <MyDialog
            heading={t('inventory.receipt.typeCost')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onAsyncClick={save}>
                        {t('common.save')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-caption text-muted-foreground">{t('inventory.receipt.costHint')}</p>
                {receipt.lines.map((line) => (
                    <div key={line.id} className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                        <ItemCell name={line.product_name} variant={line.variant_name} sku={line.sku} />
                        <Field label={t('inventory.receipt.unitCost')} htmlFor={`cost-${line.id}`} className="sm:w-40">
                            <input
                                id={`cost-${line.id}`}
                                className={inputClass}
                                inputMode="decimal"
                                value={costs[line.id] ?? ''}
                                onChange={(event) => setCosts({ ...costs, [line.id]: event.target.value })}
                            />
                        </Field>
                    </div>
                ))}
                {problem && (
                    <p role="alert" className="text-caption text-danger-600">
                        {problem}
                    </p>
                )}
                <InventoryErrorNotice error={error} />
            </div>
        </MyDialog>
    );
}
