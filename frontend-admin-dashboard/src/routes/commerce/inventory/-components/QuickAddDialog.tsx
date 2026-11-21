import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { useTaxClasses, useTaxSettings } from '@/routes/commerce/-shared/commerce-hooks';
import { DialogButtons, Field, inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { quickAddItem } from '../-shared/inventory-api';
import { useInventoryAccess } from '../-shared/inventory-hooks';
import { QUICK_ADD_KINDS, type QuickAddKind } from '../-shared/inventory-types';
import type { ReceiveItem } from '../-shared/receive-lines';
import { ChoiceGroup, InventoryErrorNotice, TOUCH } from './inventory-ui';
import { useInventoryWrite } from './use-inventory-write';

const KIND_SHAPE: Record<QuickAddKind, { unit: string; stock_mode: 'QUANTITY' | 'PIECE'; qty_scale: number }> = {
    QUANTITY: { unit: 'PCS', stock_mode: 'QUANTITY', qty_scale: 1 },
    PIECE: { unit: 'PCS', stock_mode: 'PIECE', qty_scale: 1 },
    MEASURED: { unit: 'MTR', stock_mode: 'QUANTITY', qty_scale: 10 },
};

const SKU = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Quick add item (contract §4.6, §7.3): a new item at the door, saved as a
 * DRAFT product with one variant and no price; it can be received at once and
 * a manager sets the price before it is sold or labelled. A repeat of the same
 * request (double tap, retry) updates the same product at the server.
 */
export function QuickAddDialog({
    open,
    onOpenChange,
    onAdded,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAdded: (item: ReceiveItem) => void;
}) {
    const { t } = useTranslation('commerce');
    const access = useInventoryAccess();
    const write = useInventoryWrite('qa');
    const classes = useTaxClasses(access.enabled);
    // The tax mode is readable by managers only; for others the server says when a class is needed.
    const settings = useTaxSettings(access.enabled && access.isManager);
    const regular = settings.data?.tax_mode === 'REGULAR';

    const [nameHi, setNameHi] = useState('');
    const [nameEn, setNameEn] = useState('');
    const [kind, setKind] = useState<QuickAddKind | null>(null);
    const [taxClassId, setTaxClassId] = useState('');
    const [sku, setSku] = useState('');
    const [barcode, setBarcode] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);

    const save = async () => {
        setProblem(null);
        setError(null);
        const hi = nameHi.trim();
        const en = nameEn.trim();
        if (!hi && !en) return setProblem(t('inventory.quickAdd.problems.name'));
        if (hi.length > 120 || en.length > 120) return setProblem(t('inventory.quickAdd.problems.nameLength'));
        if (!kind) return setProblem(t('inventory.quickAdd.problems.kind'));
        if (regular && !taxClassId) return setProblem(t('inventory.quickAdd.problems.taxClass'));
        if (sku.trim() && !SKU.test(sku.trim())) return setProblem(t('inventory.quickAdd.problems.sku'));
        if (barcode.trim().length > 100) return setProblem(t('inventory.quickAdd.problems.barcode'));
        const shape = KIND_SHAPE[kind];
        const body = {
            name: { ...(hi ? { hi } : {}), ...(en ? { en } : {}) },
            ...(taxClassId ? { tax_class_id: taxClassId } : {}),
            ...shape,
            ...(sku.trim() ? { sku: sku.trim() } : {}),
            ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
        };
        try {
            await write.run({
                scope: 'quick-add',
                body,
                send: (id) => quickAddItem({ ...body, client_request_id: id }),
                onDone: (answer) =>
                    onAdded({
                        package_session_id: answer.package_session_id,
                        sku: answer.sku,
                        name: answer.name ?? (en || hi),
                        variant_name: null,
                        stock_mode: answer.stock_mode ?? shape.stock_mode,
                        stock_policy: 'TRACKED',
                        unit: answer.unit ?? shape.unit,
                        qty_scale: answer.qty_scale || shape.qty_scale,
                        qty_step: 1,
                        draft: true,
                    }),
            });
        } catch (e) {
            setError(e);
        }
    };

    const activeClasses = (classes.data ?? []).filter((c) => c.status !== 'ARCHIVED');

    return (
        <MyDialog
            heading={t('inventory.receive.quickAdd')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onAsyncClick={save}>
                        {t('inventory.quickAdd.save')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-info-600">
                    <Info size={16} className="mt-0.5 shrink-0" />
                    <span>{t('inventory.receive.quickAddDraft')}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={t('inventory.quickAdd.nameHi')} htmlFor="qa-name-hi">
                        <input id="qa-name-hi" lang="hi" className={inputClass} value={nameHi} maxLength={120} onChange={(e) => setNameHi(e.target.value)} />
                    </Field>
                    <Field label={t('inventory.quickAdd.nameEn')} htmlFor="qa-name-en">
                        <input id="qa-name-en" lang="en" className={inputClass} value={nameEn} maxLength={120} onChange={(e) => setNameEn(e.target.value)} />
                    </Field>
                </div>
                <ChoiceGroup<QuickAddKind>
                    name="qa-kind"
                    label={t('inventory.quickAdd.kind')}
                    value={kind}
                    onChange={setKind}
                    columns={3}
                    options={QUICK_ADD_KINDS.map((value) => ({
                        value,
                        label: t(`products.selling.options.${value}.title`),
                        hint: t(`products.selling.options.${value}.description`),
                    }))}
                />
                <PlainSelect
                    label={t('inventory.quickAdd.taxClass')}
                    value={taxClassId}
                    onChange={setTaxClassId}
                    noneLabel={regular ? undefined : t('inventory.quickAdd.noTaxClass')}
                    placeholder={t('inventory.quickAdd.taxClassPlaceholder')}
                    options={activeClasses.map((c) => ({ value: c.id, label: `${c.name}${c.hsn_code ? ` · HSN ${c.hsn_code}` : ''}` }))}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={t('inventory.quickAdd.sku')} htmlFor="qa-sku" hint={t('inventory.quickAdd.skuHint')}>
                        <input id="qa-sku" className={inputClass} value={sku} maxLength={64} autoCapitalize="characters" onChange={(e) => setSku(e.target.value)} />
                    </Field>
                    <Field label={t('inventory.quickAdd.barcode')} htmlFor="qa-barcode">
                        <input id="qa-barcode" className={inputClass} value={barcode} maxLength={100} onChange={(e) => setBarcode(e.target.value)} />
                    </Field>
                </div>
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
