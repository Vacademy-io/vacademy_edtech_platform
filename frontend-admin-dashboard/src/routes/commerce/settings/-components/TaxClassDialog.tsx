import { useEffect, useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Form } from '@/components/ui/form';
import { CommerceTextField } from '@/routes/commerce/-components/CommerceFormFields';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { useSaveTaxClass } from '@/routes/commerce/-shared/commerce-hooks';
import type { TaxClass } from '@/routes/commerce/-shared/commerce-types';
import { CaBanner } from './settings-shared';
import {
    EMPTY_RULE,
    EMPTY_TAX_CLASS,
    type TaxClassValues,
    buildTaxClassSchema,
    slabsOverlap,
    taxClassToValues,
    valuesToTaxClassRequest,
} from './tax-class-form';

const toCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
const toDigits = (raw: string) => raw.replace(/\D/g, '').slice(0, 8);
const toDecimal = (raw: string) => raw.replace(/[^\d.]/g, '');

interface TaxClassDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** `null` to add; a tax class to edit. */
    taxClass: TaxClass | null;
    existingCodes: string[];
}

/**
 * Add or edit a tax class: what a product is for tax (HSN code and unit) and
 * its rate slabs by unit-price range with an effective date. Nothing is
 * pre-filled; the numbers come from the seller's CA.
 */
export function TaxClassDialog({
    open,
    onOpenChange,
    taxClass,
    existingCodes,
}: TaxClassDialogProps) {
    const { t } = useTranslation('commerce');
    const mutation = useSaveTaxClass();
    const isEdit = !!taxClass;
    const schema = useMemo(() => buildTaxClassSchema(t), [t]);
    const form = useForm<TaxClassValues>({
        resolver: zodResolver(schema),
        defaultValues: EMPTY_TAX_CLASS,
        mode: 'onBlur',
    });
    const rules = useFieldArray({ control: form.control, name: 'rules' });

    useEffect(() => {
        if (open) form.reset(taxClass ? taxClassToValues(taxClass) : EMPTY_TAX_CLASS);
    }, [open, taxClass, form]);

    const onSubmit = async (values: TaxClassValues) => {
        const clash = existingCodes.some(
            (code) => code === values.code && code !== (taxClass?.code ?? '').toUpperCase()
        );
        if (clash) {
            form.setError('code', { message: t('taxClasses.validation.codeClash') });
            return;
        }
        if (slabsOverlap(values.rules)) {
            form.setError('root', { message: t('taxClasses.validation.overlap') });
            return;
        }
        try {
            await mutation.mutateAsync({ id: taxClass?.id, body: valuesToTaxClassRequest(values) });
            toast.success(isEdit ? t('taxClasses.toast.updated') : t('taxClasses.toast.created'));
            onOpenChange(false);
        } catch (error) {
            toast.error(readCommerceError(error, t('taxClasses.errors.save')).message);
        }
    };

    const rootError = form.formState.errors.root?.message;
    const rulesError = form.formState.errors.rules?.root?.message;

    return (
        <MyDialog
            heading={
                isEdit ? t('taxClasses.dialog.editHeading') : t('taxClasses.dialog.addHeading')
            }
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('common.saving')}
                    >
                        {isEdit ? t('common.saveChanges') : t('taxClasses.dialog.add')}
                    </MyButton>
                </div>
            }
        >
            <Form {...form}>
                <form className="flex flex-col gap-5" noValidate>
                    <CaBanner text={t('taxClasses.caBanner')} />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <CommerceTextField
                            control={form.control}
                            name="name"
                            label={t('taxClasses.fields.name')}
                            placeholder={t('taxClasses.fields.namePlaceholder')}
                            maxLength={120}
                            required
                        />
                        <CommerceTextField
                            control={form.control}
                            name="code"
                            label={t('taxClasses.fields.code')}
                            description={t('taxClasses.fields.codeHint')}
                            maxLength={30}
                            transform={toCode}
                            required
                        />
                        <CommerceTextField
                            control={form.control}
                            name="hsn_code"
                            label={t('taxClasses.fields.hsn')}
                            description={t('taxClasses.fields.hsnHint')}
                            inputMode="numeric"
                            transform={toDigits}
                        />
                        <CommerceTextField
                            control={form.control}
                            name="unit"
                            label={t('taxClasses.fields.unit')}
                            description={t('taxClasses.fields.unitHint')}
                            maxLength={10}
                            transform={(raw) => raw.toUpperCase()}
                        />
                    </div>

                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <p className="text-body font-medium text-foreground">
                                {t('taxClasses.slabs.title')}
                            </p>
                            <p className="text-caption text-muted-foreground">
                                {t('taxClasses.slabs.description')}
                            </p>
                        </div>
                        {rules.fields.map((field, index) => (
                            <div
                                key={field.id}
                                className="flex flex-col gap-3 rounded-lg border border-border p-3"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-caption text-muted-foreground">
                                        {t('taxClasses.slabs.rowLabel', { number: index + 1 })}
                                    </span>
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        type="button"
                                        disable={rules.fields.length === 1}
                                        aria-label={t('taxClasses.slabs.remove', {
                                            number: index + 1,
                                        })}
                                        onClick={() => rules.remove(index)}
                                    >
                                        <Trash size={14} />
                                        {t('taxClasses.slabs.removeShort')}
                                    </MyButton>
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    <CommerceTextField
                                        control={form.control}
                                        name={`rules.${index}.min_unit_price`}
                                        label={t('taxClasses.fields.minPrice')}
                                        inputMode="decimal"
                                        transform={toDecimal}
                                        required
                                    />
                                    <CommerceTextField
                                        control={form.control}
                                        name={`rules.${index}.max_unit_price`}
                                        label={t('taxClasses.fields.maxPrice')}
                                        description={t('taxClasses.fields.maxPriceHint')}
                                        inputMode="decimal"
                                        transform={toDecimal}
                                    />
                                    <CommerceTextField
                                        control={form.control}
                                        name={`rules.${index}.rate_percent`}
                                        label={t('taxClasses.fields.rate')}
                                        inputMode="decimal"
                                        transform={toDecimal}
                                        required
                                    />
                                    <CommerceTextField
                                        control={form.control}
                                        name={`rules.${index}.cess_percent`}
                                        label={t('taxClasses.fields.cess')}
                                        inputMode="decimal"
                                        transform={toDecimal}
                                    />
                                    <CommerceTextField
                                        control={form.control}
                                        name={`rules.${index}.effective_from`}
                                        label={t('taxClasses.fields.effectiveFrom')}
                                        inputType="date"
                                        required
                                    />
                                    <CommerceTextField
                                        control={form.control}
                                        name={`rules.${index}.effective_to`}
                                        label={t('taxClasses.fields.effectiveTo')}
                                        description={t('taxClasses.fields.effectiveToHint')}
                                        inputType="date"
                                    />
                                </div>
                            </div>
                        ))}
                        {(rulesError || rootError) && (
                            <p role="alert" className="text-caption text-danger-600">
                                {rulesError ?? rootError}
                            </p>
                        )}
                        <div>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                type="button"
                                onClick={() => rules.append(EMPTY_RULE)}
                            >
                                <Plus size={14} />
                                {t('taxClasses.slabs.add')}
                            </MyButton>
                        </div>
                    </div>
                </form>
            </Form>
        </MyDialog>
    );
}
