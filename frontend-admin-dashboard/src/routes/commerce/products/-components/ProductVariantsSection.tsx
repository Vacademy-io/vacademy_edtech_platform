import { useState } from 'react';
import {
    type FieldPath,
    useController,
    useFieldArray,
    useFormContext,
    useWatch,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import {
    FieldError,
    PlainSelect,
    SectionCard,
    useAdminLanguage,
} from '@/routes/commerce/-components/CatalogueBits';
import { CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import type { CommerceAttribute } from '@/routes/commerce/-shared/catalogue-types';
import { i18nName } from '@/routes/commerce/-shared/collection-tree';
import type { ProductStatus } from '@/routes/commerce/-shared/commerce-types';
import { sectionDomId } from '@/routes/commerce/-shared/product-errors';
import {
    type ProductFormValues,
    type VariantValues,
    emptyVariant,
    variantPriceLabels,
} from '@/routes/commerce/-shared/product-form';
import {
    MAX_OPTIONS,
    MAX_VARIANTS,
    countCombinations,
    reconcileVariants,
    suggestSku,
} from '@/routes/commerce/-shared/variant-combinations';

const toMoney = (raw: string) => raw.replace(/[^\d.]/g, '').slice(0, 13);
const toWhole = (raw: string) => raw.replace(/\D/g, '').slice(0, 9);
const VARIANT_STATUSES: ProductStatus[] = ['ACTIVE', 'DRAFT', 'ARCHIVED'];

type CellName = 'sku' | 'barcode' | 'price' | 'mrp' | 'weight_grams' | 'lead_time_days' | 'name';

/** One labelled cell of a variant row, with its own error line. */
function Cell({
    index,
    name,
    label,
    transform,
    inputMode,
    alignEnd,
    disabled,
}: {
    index: number;
    name: CellName;
    label: string;
    transform?: (raw: string) => string;
    inputMode?: 'numeric' | 'decimal';
    alignEnd?: boolean;
    disabled?: boolean;
}) {
    const path = `variants.${index}.${name}` as FieldPath<ProductFormValues>;
    const { field, fieldState } = useController<ProductFormValues>({ name: path });
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={path} className="text-caption text-muted-foreground">
                {label}
            </label>
            <MyInput
                id={path}
                ref={field.ref}
                name={field.name}
                inputType="text"
                inputMode={inputMode}
                input={(field.value as string) ?? ''}
                onChangeFunction={(event) =>
                    field.onChange(transform ? transform(event.target.value) : event.target.value)
                }
                onBlur={field.onBlur}
                disabled={disabled}
                aria-invalid={!!fieldState.error || undefined}
                className={cn(
                    'sm:w-full',
                    alignEnd && 'text-end tabular-nums',
                    fieldState.error && 'border-danger-600'
                )}
            />
            <FieldError message={fieldState.error?.message} />
        </div>
    );
}

/**
 * Options and variants. Pick up to three attributes that vary,
 * tick values, press "Make variants": one row per combination. A product with
 * no options has one default variant. Each row has its SKU, barcode, price
 * (tax-inclusive), MRP, weight, whether stock is tracked, and a status.
 *
 * A saved variant is never deleted: unticking its value archives the row.
 */
export function ProductVariantsSection({
    attributes,
    attributesLoading,
    onManageAttributes,
}: {
    attributes: CommerceAttribute[];
    attributesLoading: boolean;
    onManageAttributes: () => void;
}) {
    const { t } = useTranslation('commerce');
    const language = useAdminLanguage();
    const form = useFormContext<ProductFormValues>();
    const rows = useFieldArray({ control: form.control, name: 'variants', keyName: 'fieldId' });
    const optionIds = useWatch({ control: form.control, name: 'option_attribute_ids' });
    const ticked = useWatch({ control: form.control, name: 'option_value_ids' });
    const soldAs = useWatch({ control: form.control, name: 'sold_as' });
    const unit = useWatch({ control: form.control, name: 'unit' });
    // Measured goods are priced per unit (a metre); the form converts to the base unit on save.
    const priceLabels = variantPriceLabels({ sold_as: soldAs, unit }, t);
    const variants = useWatch({ control: form.control, name: 'variants' });
    const [applyAll, setApplyAll] = useState({ price: '', mrp: '', weight_grams: '' });

    const byId = new Map(attributes.map((attribute) => [attribute.id, attribute]));
    const attributeName = (id: string) =>
        i18nName(byId.get(id)?.name_i18n, language, byId.get(id)?.code ?? id);
    const valueOf = (attributeId: string, valueId: string) =>
        byId.get(attributeId)?.values.find((value) => value.id === valueId);
    const valueLabel = (attributeId: string, valueId: string) => {
        const value = valueOf(attributeId, valueId);
        return value ? i18nName(value.label_i18n, language, value.code) : valueId;
    };
    const rowTitle = (row: VariantValues) => {
        const parts = Object.entries(row.option_values).map(([attributeId, valueId]) =>
            valueLabel(attributeId, valueId)
        );
        return parts.length > 0 ? parts.join(' / ') : t('products.variants.defaultVariant');
    };

    const selections = optionIds.map((attributeId) => ({
        attributeId,
        // Keep the attribute's own order, whatever order the boxes were ticked in.
        valueIds: (byId.get(attributeId)?.values ?? [])
            .map((value) => value.id)
            .filter((id) => (ticked[attributeId] ?? []).includes(id)),
    }));
    const combinations = countCombinations(selections);
    const unusedAttributes = attributes.filter((attribute) => !optionIds.includes(attribute.id));
    const variantsError =
        form.formState.errors.variants?.root?.message ?? form.formState.errors.variants?.message;

    const setOptions = (next: string[]) =>
        form.setValue('option_attribute_ids', next, { shouldDirty: true, shouldValidate: true });

    const addOption = (attributeId: string) => {
        if (!attributeId || optionIds.length >= MAX_OPTIONS) return;
        setOptions([...optionIds, attributeId]);
        // A facet value of this attribute would now be an option value instead.
        const own = new Set(byId.get(attributeId)?.values.map((value) => value.id));
        form.setValue(
            'attribute_value_ids',
            form.getValues('attribute_value_ids').filter((id) => !own.has(id)),
            { shouldDirty: true }
        );
    };

    const removeOption = (attributeId: string) => {
        setOptions(optionIds.filter((id) => id !== attributeId));
        const rest = { ...form.getValues('option_value_ids') };
        delete rest[attributeId];
        form.setValue('option_value_ids', rest, { shouldDirty: true });
    };

    const toggleValue = (attributeId: string, valueId: string, on: boolean) => {
        const current = form.getValues('option_value_ids')[attributeId] ?? [];
        form.setValue(
            'option_value_ids',
            {
                ...form.getValues('option_value_ids'),
                [attributeId]: on ? [...current, valueId] : current.filter((id) => id !== valueId),
            },
            { shouldDirty: true }
        );
    };

    const makeVariants = () => {
        if (combinations === 0) {
            toast.error(t('products.variants.tickValues'));
            return;
        }
        if (combinations > MAX_VARIANTS) {
            toast.error(t('products.variants.tooMany', { max: MAX_VARIANTS }));
            return;
        }
        const current = form.getValues('variants');
        const template = current.find((row) => row.status !== 'ARCHIVED') ?? current[0];
        const base =
            form.getValues('slug') ||
            form.getValues('translations.en.name') ||
            template?.sku.split('-')[0] ||
            '';
        const result = reconcileVariants(current, selections, (combination) => ({
            ...emptyVariant(combination),
            // A new row starts from the prices already typed, never from a guess.
            price: template?.price ?? '',
            mrp: template?.mrp ?? '',
            weight_grams: template?.weight_grams ?? '',
            stock_policy: soldAs === 'PIECE' ? 'TRACKED' : template?.stock_policy ?? 'TRACKED',
            sku: suggestSku(
                base,
                optionIds.map(
                    (attributeId) =>
                        valueOf(attributeId, combination[attributeId] ?? '')?.code ?? ''
                )
            ),
        }));
        rows.replace(result.rows);
        void form.trigger('variants');
        toast.success(
            t('products.variants.made', {
                added: result.added,
                archived: result.archived,
                restored: result.restored,
            })
        );
    };

    const applyToAll = () => {
        const current = form.getValues('variants');
        current.forEach((row, index) => {
            if (row.status === 'ARCHIVED') return;
            (['price', 'mrp', 'weight_grams'] as const).forEach((cell) => {
                if (applyAll[cell] !== '') {
                    form.setValue(`variants.${index}.${cell}`, applyAll[cell], {
                        shouldDirty: true,
                        shouldValidate: true,
                    });
                }
            });
        });
        setApplyAll({ price: '', mrp: '', weight_grams: '' });
    };

    return (
        <SectionCard
            id={sectionDomId('variants')}
            title={t('products.variants.title')}
            description={t('products.variants.description')}
            actions={
                <MyButton
                    buttonType="text"
                    scale="small"
                    type="button"
                    onClick={onManageAttributes}
                >
                    {t('products.organise.manageAttributes')}
                </MyButton>
            }
        >
            {/* ── Options ── */}
            <div className="flex flex-col gap-3">
                {optionIds.map((attributeId) => (
                    <div
                        key={attributeId}
                        className="flex flex-col gap-2 rounded-lg border border-border p-3"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-body font-medium text-foreground">
                                {attributeName(attributeId)}
                            </span>
                            <MyButton
                                buttonType="text"
                                scale="small"
                                type="button"
                                onClick={() => removeOption(attributeId)}
                            >
                                <Trash size={14} />
                                {t('products.variants.removeOption')}
                            </MyButton>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {(byId.get(attributeId)?.values ?? []).map((value) => (
                                <label
                                    key={value.id}
                                    className="flex items-center gap-2 text-body text-foreground"
                                >
                                    <Checkbox
                                        checked={(ticked[attributeId] ?? []).includes(value.id)}
                                        onCheckedChange={(checked) =>
                                            toggleValue(attributeId, value.id, checked === true)
                                        }
                                    />
                                    {i18nName(value.label_i18n, language, value.code)}
                                </label>
                            ))}
                            {(byId.get(attributeId)?.values ?? []).length === 0 && (
                                <span className="text-caption text-muted-foreground">
                                    {t('products.variants.noValues')}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
                <FieldError message={form.formState.errors.option_attribute_ids?.message} />
                <div className="flex flex-wrap items-end gap-2">
                    {optionIds.length < MAX_OPTIONS && (
                        <PlainSelect
                            className="w-full sm:w-64"
                            label={t('products.variants.addOption')}
                            placeholder={
                                attributesLoading
                                    ? t('products.variants.loadingAttributes')
                                    : t('products.variants.chooseAttribute')
                            }
                            value=""
                            onChange={addOption}
                            disabled={unusedAttributes.length === 0}
                            options={unusedAttributes.map((attribute) => ({
                                value: attribute.id,
                                label: i18nName(attribute.name_i18n, language, attribute.code),
                            }))}
                        />
                    )}
                    {optionIds.length > 0 && (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            type="button"
                            onClick={makeVariants}
                        >
                            {t('products.variants.make', { count: combinations })}
                        </MyButton>
                    )}
                </div>
                {optionIds.length === 0 &&
                    variants.some((row) => Object.keys(row.option_values).length > 0) && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            type="button"
                            onClick={makeVariants}
                        >
                            {t('products.variants.backToOne')}
                        </MyButton>
                    )}
            </div>

            {/* ── Set a value on every row ── */}
            {variants.filter((row) => row.status !== 'ARCHIVED').length > 1 && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
                    <p className="text-caption text-muted-foreground">
                        {t('products.variants.applyAllHint')}
                    </p>
                    <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
                        {(
                            [
                                ['price', 'products.variants.price', toMoney],
                                ['mrp', 'products.variants.mrp', toMoney],
                                ['weight_grams', 'products.variants.weight', toWhole],
                            ] as const
                        ).map(([cell, labelKey, clean]) => (
                            <div key={cell} className="flex min-w-0 flex-col gap-1">
                                <label
                                    htmlFor={`apply-all-${cell}`}
                                    className="text-caption text-muted-foreground"
                                >
                                    {t(labelKey)}
                                </label>
                                <MyInput
                                    id={`apply-all-${cell}`}
                                    inputType="text"
                                    inputMode="decimal"
                                    input={applyAll[cell]}
                                    onChangeFunction={(event) =>
                                        setApplyAll((current) => ({
                                            ...current,
                                            [cell]: clean(event.target.value),
                                        }))
                                    }
                                    className="text-end tabular-nums sm:w-full"
                                />
                            </div>
                        ))}
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            type="button"
                            disable={Object.values(applyAll).every((value) => value === '')}
                            onClick={applyToAll}
                        >
                            {t('products.variants.applyAll')}
                        </MyButton>
                    </div>
                </div>
            )}

            {/* ── Rows ── */}
            <FieldError message={variantsError} />
            <ul className="flex flex-col gap-3">
                {rows.fields.map((field, index) => {
                    const row = variants[index] ?? field;
                    const saved = row.package_session_id !== '';
                    const archived = row.status === 'ARCHIVED';
                    return (
                        <li
                            key={field.fieldId}
                            className={cn(
                                'flex flex-col gap-3 rounded-lg border border-border p-3',
                                archived && 'bg-muted'
                            )}
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span className="text-body font-medium text-foreground">
                                        {rowTitle(row)}
                                    </span>
                                    <CommerceStatusChip kind="product" value={row.status} />
                                    {row.label_code && (
                                        <span className="font-mono text-caption text-muted-foreground">
                                            {t('products.variants.scanCode', {
                                                code: row.label_code,
                                            })}
                                        </span>
                                    )}
                                </div>
                                {!saved && rows.fields.length > 1 && (
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        type="button"
                                        aria-label={t('products.variants.removeRow', {
                                            name: rowTitle(row),
                                        })}
                                        onClick={() => rows.remove(index)}
                                    >
                                        <Trash size={14} />
                                    </MyButton>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                                <Cell index={index} name="sku" label={t('products.variants.sku')} />
                                <Cell
                                    index={index}
                                    name="barcode"
                                    label={t('products.variants.barcode')}
                                />
                                <Cell
                                    index={index}
                                    name="price"
                                    label={priceLabels.price}
                                    transform={toMoney}
                                    inputMode="decimal"
                                    alignEnd
                                />
                                <Cell
                                    index={index}
                                    name="mrp"
                                    label={priceLabels.mrp}
                                    transform={toMoney}
                                    inputMode="decimal"
                                    alignEnd
                                />
                                <Cell
                                    index={index}
                                    name="weight_grams"
                                    label={t('products.variants.weight')}
                                    transform={toWhole}
                                    inputMode="numeric"
                                    alignEnd
                                />
                                <div className="flex min-w-0 flex-col gap-1">
                                    <PlainSelect
                                        label={t('products.variants.stockPolicy')}
                                        value={row.stock_policy}
                                        onChange={(next) =>
                                            form.setValue(
                                                `variants.${index}.stock_policy`,
                                                next === 'UNTRACKED' ? 'UNTRACKED' : 'TRACKED',
                                                { shouldDirty: true, shouldValidate: true }
                                            )
                                        }
                                        // Fixed once saved (the stock ledger owns it) and for pieces.
                                        disabled={saved || soldAs === 'PIECE'}
                                        options={(['TRACKED', 'UNTRACKED'] as const).map(
                                            (value) => ({
                                                value,
                                                label: t(`products.variants.policy.${value}`),
                                            })
                                        )}
                                    />
                                    <FieldError
                                        message={
                                            form.formState.errors.variants?.[index]?.stock_policy
                                                ?.message
                                        }
                                    />
                                </div>
                                {row.stock_policy === 'UNTRACKED' && (
                                    <Cell
                                        index={index}
                                        name="lead_time_days"
                                        label={t('products.variants.leadTime')}
                                        transform={toWhole}
                                        inputMode="numeric"
                                        alignEnd
                                    />
                                )}
                                <PlainSelect
                                    label={t('products.variants.status')}
                                    value={row.status}
                                    onChange={(next) =>
                                        form.setValue(
                                            `variants.${index}.status`,
                                            next as ProductStatus,
                                            { shouldDirty: true, shouldValidate: true }
                                        )
                                    }
                                    options={VARIANT_STATUSES.map((value) => ({
                                        value,
                                        label: t(`status.product.${value}`),
                                    }))}
                                />
                            </div>
                        </li>
                    );
                })}
            </ul>
            {optionIds.length === 0 && rows.fields.length === 0 && (
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    type="button"
                    onClick={() => rows.append(emptyVariant())}
                >
                    <Plus size={14} />
                    {t('products.variants.addRow')}
                </MyButton>
            )}
            <p className="text-caption text-muted-foreground">{t('products.variants.priceHint')}</p>
        </SectionCard>
    );
}
