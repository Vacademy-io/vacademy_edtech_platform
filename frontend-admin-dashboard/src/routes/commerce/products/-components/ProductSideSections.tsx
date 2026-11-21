import { useMemo } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MultiSelect } from '@/components/design-system/multi-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    FieldError,
    PlainSelect,
    SectionCard,
    useAdminLanguage,
} from '@/routes/commerce/-components/CatalogueBits';
import { CommerceTextField } from '@/routes/commerce/-components/CommerceFormFields';
import type { CommerceAttribute } from '@/routes/commerce/-shared/catalogue-types';
import { flattenTree, i18nName } from '@/routes/commerce/-shared/collection-tree';
import type {
    CommerceCollection,
    CommerceLocation,
    TaxClass,
} from '@/routes/commerce/-shared/commerce-types';
import { sectionDomId } from '@/routes/commerce/-shared/product-errors';
import {
    DEFAULT_MEASURE_SCALE,
    DEFAULT_MEASURE_UNIT,
    measureScaleOf,
    type ProductFormValues,
    type SoldAs,
    stepToBase,
    taxUnitWarning,
} from '@/routes/commerce/-shared/product-form';
import { unitWord } from '@/routes/commerce/-shared/units';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';

const SOLD_AS: SoldAs[] = ['QUANTITY', 'PIECE', 'MEASURED'];
const toWhole = (raw: string) => raw.replace(/\D/g, '').slice(0, 9);
/** The smallest cut is typed in units ("0.5"): digits (Hindi too) and a point; a comma is kept to be refused. */
const toLength = (raw: string) => raw.replace(/[^\d.,०-९]/g, '').slice(0, 10);

/**
 * "How it is sold": stocked by quantity, a one-of-a-kind
 * piece, or sold by length. The choice is fixed once the product has been
 * published: stock, holds and prices all count in the unit it sets.
 */
export function ProductSellingSection({ locked }: { locked: boolean }) {
    const { t } = useTranslation('commerce');
    const form = useFormContext<ProductFormValues>();
    const soldAs = useWatch({ control: form.control, name: 'sold_as' });
    const unit = useWatch({ control: form.control, name: 'unit' });
    const scale = useWatch({ control: form.control, name: 'qty_scale' });
    const step = useWatch({ control: form.control, name: 'qty_step' });
    // The smallest cut is typed in units and previewed as customers will see it ("0.5 m").
    const stepBase = stepToBase(step ?? '', scale ?? '');
    const smallest = stepBase !== null ? formatQuantity(stepBase, measureScaleOf(scale ?? ''), unit || DEFAULT_MEASURE_UNIT, t) : null;

    return (
        <SectionCard
            id={sectionDomId('selling')}
            title={t('products.selling.title')}
            description={locked ? t('products.selling.locked') : t('products.selling.description')}
        >
            <Controller
                control={form.control}
                name="sold_as"
                render={({ field, fieldState }) => (
                    <>
                        <RadioGroup
                            value={field.value}
                            onValueChange={(value) => {
                                field.onChange(value);
                                if (value === 'PIECE') {
                                    // Pieces are always tracked.
                                    form.getValues('variants').forEach((_, index) =>
                                        form.setValue(`variants.${index}.stock_policy`, 'TRACKED')
                                    );
                                }
                            }}
                            disabled={locked}
                            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                        >
                            {SOLD_AS.map((value) => (
                                <label
                                    key={value}
                                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 has-[:disabled]:cursor-not-allowed has-[[data-state=checked]]:border-primary-500"
                                >
                                    <RadioGroupItem value={value} className="mt-0.5" />
                                    <span className="flex flex-col gap-0.5">
                                        <span className="text-body font-medium text-foreground">
                                            {t(`products.selling.options.${value}.title`)}
                                        </span>
                                        <span className="text-caption text-muted-foreground">
                                            {t(`products.selling.options.${value}.description`)}
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </RadioGroup>
                        <FieldError message={fieldState.error?.message} />
                    </>
                )}
            />
            {soldAs === 'MEASURED' && (
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <CommerceTextField
                            control={form.control}
                            name="unit"
                            label={t('products.selling.unit')}
                            placeholder={DEFAULT_MEASURE_UNIT}
                            description={t('products.selling.unitHint')}
                            maxLength={32}
                            transform={(raw) => raw.toUpperCase()}
                            disabled={locked}
                        />
                        <CommerceTextField
                            control={form.control}
                            name="qty_scale"
                            label={t('products.selling.scale')}
                            placeholder={DEFAULT_MEASURE_SCALE}
                            description={t('products.selling.scaleHint')}
                            inputMode="numeric"
                            transform={toWhole}
                            disabled={locked}
                        />
                        <CommerceTextField
                            control={form.control}
                            name="qty_step"
                            label={t('products.selling.step')}
                            description={t('products.selling.stepHint')}
                            inputMode="decimal"
                            transform={toLength}
                            required
                        />
                    </div>
                    {smallest !== null && (
                        <p className="rounded-md bg-info-50 p-2 text-caption text-neutral-600">
                            {t('products.selling.smallestCut', { amount: smallest })}
                        </p>
                    )}
                </div>
            )}
        </SectionCard>
    );
}

/**
 * Tax class of the product. A GST-registered shop (tax mode Regular) cannot
 * publish a product without one, and the card says so before Publish is
 * pressed. Rates are shown as stored; the screen never calculates tax.
 */
export function ProductTaxSection({
    taxMode,
    taxClasses,
}: {
    taxMode: string | null;
    taxClasses: TaxClass[];
}) {
    const { t } = useTranslation('commerce');
    const form = useFormContext<ProductFormValues>();
    const value = useWatch({ control: form.control, name: 'tax_class_id' });
    const usable = taxClasses.filter(
        (taxClass) => taxClass.status !== 'ARCHIVED' || taxClass.id === value
    );
    const chosen = taxClasses.find((taxClass) => taxClass.id === value);
    const needed = taxMode === 'REGULAR';
    const soldAs = useWatch({ control: form.control, name: 'sold_as' });
    const unit = useWatch({ control: form.control, name: 'unit' }) ?? '';
    const unitWarning = chosen ? taxUnitWarning({ sold_as: soldAs, unit }, chosen.unit) : null;
    const itemUnit = unitWord(unit.trim() || DEFAULT_MEASURE_UNIT, t) ?? '';

    return (
        <SectionCard id={sectionDomId('tax')} title={t('products.tax.title')}>
            <Controller
                control={form.control}
                name="tax_class_id"
                render={({ field, fieldState }) => (
                    <div className="flex flex-col gap-1.5">
                        <PlainSelect
                            label={t('products.tax.taxClass')}
                            value={field.value}
                            onChange={(next) => {
                                field.onChange(next);
                                form.clearErrors('tax_class_id');
                            }}
                            noneLabel={t('products.tax.none')}
                            placeholder={t('products.tax.choose')}
                            invalid={!!fieldState.error}
                            options={usable.map((taxClass) => ({
                                value: taxClass.id,
                                label: taxClass.hsn_code
                                    ? t('products.tax.optionWithHsn', {
                                          name: taxClass.name,
                                          hsn: taxClass.hsn_code,
                                      })
                                    : taxClass.name,
                            }))}
                        />
                        <FieldError message={fieldState.error?.message} />
                    </div>
                )}
            />
            {chosen && chosen.rules.length > 0 && (
                <p className="text-caption tabular-nums text-muted-foreground">
                    {t('products.tax.rates', {
                        rates: [
                            ...new Set(chosen.rules.map((rule) => `${rule.rate_percent}%`)),
                        ].join(', '),
                    })}
                </p>
            )}
            {needed && !value && (
                <p
                    role="status"
                    className="rounded-md bg-warning-50 p-2 text-caption text-warning-600"
                >
                    {t('products.tax.neededToPublish')}
                </p>
            )}
            {unitWarning && (
                <p
                    role="status"
                    data-testid="tax-unit-warning"
                    className="rounded-md bg-warning-50 p-2 text-caption text-warning-600"
                >
                    {unitWarning === 'pieces'
                        ? t('products.tax.unitPieces', { unit: itemUnit })
                        : t('products.tax.unitMismatch', { taxUnit: unitWord(chosen?.unit, t) ?? '', unit: itemUnit })}
                </p>
            )}
            {taxMode && !needed && (
                <p className="text-caption text-muted-foreground">{t('products.tax.notNeeded')}</p>
            )}
            {usable.length === 0 && (
                <p className="text-caption text-muted-foreground">{t('products.tax.noClasses')}</p>
            )}
            <Link
                to="/commerce/settings/tax-classes"
                className="w-fit text-caption text-primary-500 hover:underline"
            >
                {t('products.tax.manage')}
            </Link>
        </SectionCard>
    );
}

/**
 * Where the product belongs: its category and collections, the facets that do
 * not vary between variants (fabric, craft, occasion), and where it is made.
 */
export function ProductOrganiseSection({
    locations,
    stockFeatureOn,
    collections,
    attributes,
    onManageAttributes,
}: {
    locations: CommerceLocation[];
    stockFeatureOn: boolean;
    collections: CommerceCollection[];
    attributes: CommerceAttribute[];
    onManageAttributes: () => void;
}) {
    const { t } = useTranslation('commerce');
    const language = useAdminLanguage();
    const form = useFormContext<ProductFormValues>();
    const optionIds = useWatch({ control: form.control, name: 'option_attribute_ids' });
    const facetIds = useWatch({ control: form.control, name: 'attribute_value_ids' });
    const originId = useWatch({ control: form.control, name: 'origin_location_id' });

    const collectionOptions = useMemo(
        () =>
            flattenTree(collections)
                .filter((entry) => entry.collection.status !== 'ARCHIVED')
                .map((entry) => ({
                    value: entry.collection.id,
                    label: `${'— '.repeat(entry.depth)}${i18nName(
                        entry.collection.name_i18n,
                        language,
                        entry.collection.slug ?? ''
                    )}`,
                })),
        [collections, language]
    );
    // The server accepts only a source location as the origin.
    const sources = locations.filter(
        (location) =>
            (location.is_source && location.status !== 'INACTIVE') || location.id === originId
    );
    // An attribute that varies between variants is an option, not a facet.
    const facets = attributes.filter(
        (attribute) => !optionIds.includes(attribute.id) && attribute.values.length > 0
    );

    return (
        <SectionCard
            id={sectionDomId('organise')}
            title={t('products.organise.title')}
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
            <Controller
                control={form.control}
                name="collection_ids"
                render={({ field, fieldState }) => (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-caption text-muted-foreground">
                            {t('products.organise.collections')}
                        </span>
                        <MultiSelect
                            options={collectionOptions}
                            selected={field.value}
                            onChange={field.onChange}
                            placeholder={t('products.organise.collectionsPlaceholder')}
                            checkboxes
                        />
                        <FieldError message={fieldState.error?.message} />
                    </div>
                )}
            />
            {facets.map((attribute) => {
                const valueIds = attribute.values.map((value) => value.id);
                return (
                    <div key={attribute.id} className="flex flex-col gap-1.5">
                        <span className="text-caption text-muted-foreground">
                            {i18nName(attribute.name_i18n, language, attribute.code)}
                        </span>
                        <MultiSelect
                            options={attribute.values.map((value) => ({
                                value: value.id,
                                label: i18nName(value.label_i18n, language, value.code),
                            }))}
                            selected={facetIds.filter((id) => valueIds.includes(id))}
                            onChange={(next) =>
                                form.setValue(
                                    'attribute_value_ids',
                                    [...facetIds.filter((id) => !valueIds.includes(id)), ...next],
                                    { shouldDirty: true }
                                )
                            }
                            placeholder={t('products.organise.facetPlaceholder')}
                            checkboxes
                        />
                    </div>
                );
            })}
            <FieldError message={form.formState.errors.attribute_value_ids?.message} />
            <Controller
                control={form.control}
                name="origin_location_id"
                render={({ field, fieldState }) => (
                    <div className="flex flex-col gap-1.5">
                        <PlainSelect
                            label={t('products.organise.origin')}
                            value={field.value}
                            onChange={(next) => {
                                field.onChange(next);
                                form.clearErrors('origin_location_id');
                            }}
                            noneLabel={t('products.organise.originNone')}
                            invalid={!!fieldState.error}
                            disabled={!stockFeatureOn}
                            options={sources.map((location) => ({
                                value: location.id,
                                label: location.city
                                    ? `${location.name}, ${location.city}`
                                    : location.name,
                            }))}
                        />
                        <p className="text-caption text-muted-foreground">
                            {t('products.organise.originHint')}
                        </p>
                        <FieldError message={fieldState.error?.message} />
                    </div>
                )}
            />
        </SectionCard>
    );
}
