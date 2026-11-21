import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DialogButtons, Field, inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { typeReceiptCost } from '../-shared/inventory-api';
import { useInvalidateInventory } from '../-shared/inventory-hooks';
import type { ReceiptView } from '../-shared/inventory-types';
import { costDecimalsFor, costInputText, parseCostPerUnit } from '@/routes/commerce/-shared/units';
import { InventoryErrorNotice, ItemCell, qtyUnit, TOUCH } from './inventory-ui';
import { useInventoryWrite } from './use-inventory-write';

/**
 * Type cost (manager; `PATCH /stock/receipts/{id}/cost`). Typed per unit
 * people buy in (a metre of cloth, WP-44 D13) and sent per base unit (4
 * decimals); a per-metre cost that does not fit 4 decimals per base unit is
 * refused, never rounded.
 */
export function costLines(
    receipt: Pick<ReceiptView, 'lines'>,
    costs: Record<string, string>
):
    | { lines: { line_id: string; unit_cost: string }[] }
    | { problemLineId: string | null; decimals: number | null; comma?: true } {
    const byId = new Map(receipt.lines.map((line) => [line.id, line]));
    const lines: { line_id: string; unit_cost: string }[] = [];
    for (const [lineId, value] of Object.entries(costs)) {
        if (value.trim() === '') continue;
        const scale = byId.get(lineId)?.qty_scale ?? 1;
        const parsed = parseCostPerUnit(value, scale);
        if ('problem' in parsed) {
            // A comma is refused with "use a dot", as in every admin money and length box (WP-44 W4).
            if (parsed.problem === 'comma') return { problemLineId: lineId, decimals: null, comma: true };
            return { problemLineId: lineId, decimals: parsed.problem === 'decimals' ? costDecimalsFor(scale) : null };
        }
        lines.push({ line_id: lineId, unit_cost: parsed.baseCost });
    }
    if (lines.length === 0) return { problemLineId: null, decimals: null };
    return { lines };
}

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
        Object.fromEntries(receipt.lines.map((l) => [l.id, costInputText(l.unit_cost, l.qty_scale)]))
    );
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);

    const save = async () => {
        setProblem(null);
        setError(null);
        const outcome = costLines(receipt, costs);
        if (!('lines' in outcome)) {
            if (outcome.comma) return setProblem(t('units.problems.comma'));
            return setProblem(
                outcome.decimals !== null
                    ? t('inventory.receipt.costDecimals', { count: outcome.decimals })
                    : t('inventory.receipt.costProblem')
            );
        }
        const { lines } = outcome;
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
                        <Field
                            label={
                                line.qty_scale > 1
                                    ? t('inventory.receipt.unitCostPer', { unit: qtyUnit(line.unit, t) ?? t('orders.units.metre') })
                                    : t('inventory.receipt.unitCost')
                            }
                            htmlFor={`cost-${line.id}`}
                            className="sm:w-40"
                        >
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
