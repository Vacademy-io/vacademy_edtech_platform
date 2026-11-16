import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Form } from '@/components/ui/form';
import {
    CommerceCheckboxField,
    CommerceSelectField,
    CommerceTextField,
} from '@/routes/commerce/-components/CommerceFormFields';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { useSaveLocation } from '@/routes/commerce/-shared/commerce-hooks';
import type { CommerceLocation } from '@/routes/commerce/-shared/commerce-types';
import { gstinProblem, normalizeGstin } from '@/routes/commerce/-shared/gstin';
import { stateOptions } from './settings-shared';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const buildSchema = (t: TFunction) =>
    z
        .object({
            name: z.string().trim().min(1, t('locations.validation.nameRequired')).max(120),
            code: z
                .string()
                .trim()
                .min(2, t('locations.validation.codeFormat'))
                .max(30, t('locations.validation.codeFormat'))
                .regex(/^[A-Z0-9_-]+$/, t('locations.validation.codeFormat')),
            address_line1: z.string().trim().max(200),
            address_line2: z.string().trim().max(200),
            city: z.string().trim().max(100),
            pincode: z
                .string()
                .trim()
                .regex(/^(\d{6})?$/, t('locations.validation.pincode')),
            state_code: z.string().min(1, t('locations.validation.stateRequired')),
            gstin: z.string().trim(),
            is_store: z.boolean(),
            is_warehouse: z.boolean(),
            is_source: z.boolean(),
            is_temporary: z.boolean(),
            starts_on: z.string(),
            ends_on: z.string(),
            is_pos_enabled: z.boolean(),
        })
        .superRefine((values, ctx) => {
            if (!values.is_store && !values.is_warehouse && !values.is_source) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['is_store'],
                    message: t('locations.validation.typeRequired'),
                });
            }
            const gstin = normalizeGstin(values.gstin);
            if (gstin) {
                const problem = gstinProblem(gstin, values.state_code || null);
                if (problem) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['gstin'],
                        message: t(`business.validation.gstin.${problem}`),
                    });
                }
            }
            if (values.is_temporary) {
                const startOk = ISO_DATE.test(values.starts_on);
                const endOk = ISO_DATE.test(values.ends_on);
                if (!startOk) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['starts_on'],
                        message: t('locations.validation.datesRequired'),
                    });
                }
                if (!endOk) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['ends_on'],
                        message: t('locations.validation.datesRequired'),
                    });
                }
                if (startOk && endOk && values.ends_on < values.starts_on) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['ends_on'],
                        message: t('locations.validation.endBeforeStart'),
                    });
                }
            }
        });

type LocationValues = z.infer<ReturnType<typeof buildSchema>>;

const EMPTY: LocationValues = {
    name: '',
    code: '',
    address_line1: '',
    address_line2: '',
    city: '',
    pincode: '',
    state_code: '',
    gstin: '',
    is_store: false,
    is_warehouse: false,
    is_source: false,
    is_temporary: false,
    starts_on: '',
    ends_on: '',
    is_pos_enabled: false,
};

const toValues = (location: CommerceLocation): LocationValues => ({
    name: location.name,
    code: location.code.toUpperCase(),
    address_line1: location.address_line1 ?? '',
    address_line2: location.address_line2 ?? '',
    city: location.city ?? '',
    pincode: location.pincode ?? '',
    state_code: location.state_code ?? '',
    gstin: location.gstin ?? '',
    is_store: location.is_store,
    is_warehouse: location.is_warehouse,
    is_source: location.is_source,
    is_temporary: location.is_temporary,
    starts_on: location.starts_on ?? '',
    ends_on: location.ends_on ?? '',
    is_pos_enabled: location.is_pos_enabled,
});

const toCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
const toDigits = (raw: string) => raw.replace(/\D/g, '').slice(0, 6);

interface LocationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** `null` to add; a location to edit. */
    location: CommerceLocation | null;
    /** Upper-case codes already in use, so a duplicate is caught before the round trip. */
    existingCodes: string[];
}

/**
 * Add or edit a place of the seller (checklist item 2): any mix of store,
 * warehouse and source; an exhibition is a temporary store with dates.
 */
export function LocationDialog({
    open,
    onOpenChange,
    location,
    existingCodes,
}: LocationDialogProps) {
    const { t } = useTranslation('commerce');
    const mutation = useSaveLocation();
    const isEdit = !!location;
    const schema = useMemo(() => buildSchema(t), [t]);
    const form = useForm<LocationValues>({
        resolver: zodResolver(schema),
        defaultValues: EMPTY,
        mode: 'onBlur',
    });

    useEffect(() => {
        if (open) form.reset(location ? toValues(location) : EMPTY);
    }, [open, location, form]);

    const isTemporary = form.watch('is_temporary');

    const onSubmit = async (values: LocationValues) => {
        const clash = existingCodes.some(
            (code) => code === values.code && code !== (location?.code ?? '').toUpperCase()
        );
        if (clash) {
            form.setError('code', { message: t('locations.validation.codeClash') });
            return;
        }
        try {
            await mutation.mutateAsync({
                id: location?.id,
                body: {
                    name: values.name,
                    code: values.code,
                    address_line1: values.address_line1 || null,
                    address_line2: values.address_line2 || null,
                    city: values.city || null,
                    pincode: values.pincode || null,
                    state_code: values.state_code,
                    gstin: normalizeGstin(values.gstin) || null,
                    is_store: values.is_store,
                    is_warehouse: values.is_warehouse,
                    is_source: values.is_source,
                    is_temporary: values.is_temporary,
                    starts_on: values.is_temporary ? values.starts_on : null,
                    ends_on: values.is_temporary ? values.ends_on : null,
                    is_pos_enabled: values.is_pos_enabled,
                },
            });
            toast.success(isEdit ? t('locations.toast.updated') : t('locations.toast.created'));
            onOpenChange(false);
        } catch (error) {
            // A 409 (duplicate code) arrives as the server's own sentence.
            toast.error(readCommerceError(error, t('locations.errors.save')).message);
        }
    };

    return (
        <MyDialog
            heading={isEdit ? t('locations.dialog.editHeading') : t('locations.dialog.addHeading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
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
                        {isEdit ? t('common.saveChanges') : t('locations.dialog.add')}
                    </MyButton>
                </div>
            }
        >
            <Form {...form}>
                <form className="flex flex-col gap-5" noValidate>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <CommerceTextField
                            control={form.control}
                            name="name"
                            label={t('locations.fields.name')}
                            placeholder={t('locations.fields.namePlaceholder')}
                            maxLength={120}
                            required
                        />
                        <CommerceTextField
                            control={form.control}
                            name="code"
                            label={t('locations.fields.code')}
                            placeholder={t('locations.fields.codePlaceholder')}
                            description={t('locations.fields.codeHint')}
                            maxLength={30}
                            transform={toCode}
                            required
                        />
                        <CommerceTextField
                            control={form.control}
                            name="address_line1"
                            label={t('locations.fields.addressLine1')}
                            maxLength={200}
                        />
                        <CommerceTextField
                            control={form.control}
                            name="address_line2"
                            label={t('locations.fields.addressLine2')}
                            maxLength={200}
                        />
                        <CommerceTextField
                            control={form.control}
                            name="city"
                            label={t('locations.fields.city')}
                            maxLength={100}
                        />
                        <CommerceTextField
                            control={form.control}
                            name="pincode"
                            label={t('locations.fields.pincode')}
                            inputMode="numeric"
                            transform={toDigits}
                        />
                        <CommerceSelectField
                            control={form.control}
                            name="state_code"
                            label={t('locations.fields.state')}
                            placeholder={t('business.fields.statePlaceholder')}
                            options={stateOptions(t)}
                            required
                        />
                        <CommerceTextField
                            control={form.control}
                            name="gstin"
                            label={t('locations.fields.gstin')}
                            description={t('locations.fields.gstinHint')}
                            maxLength={15}
                            transform={normalizeGstin}
                        />
                    </div>

                    <fieldset className="flex flex-col gap-3">
                        <legend className="mb-2 text-body font-medium text-foreground">
                            {t('locations.fields.typeLegend')}
                        </legend>
                        <CommerceCheckboxField
                            control={form.control}
                            name="is_store"
                            label={t('locations.types.store')}
                            description={t('locations.types.storeHint')}
                        />
                        <CommerceCheckboxField
                            control={form.control}
                            name="is_warehouse"
                            label={t('locations.types.warehouse')}
                            description={t('locations.types.warehouseHint')}
                        />
                        <CommerceCheckboxField
                            control={form.control}
                            name="is_source"
                            label={t('locations.types.source')}
                            description={t('locations.types.sourceHint')}
                        />
                        {form.formState.errors.is_store?.message && (
                            <p className="text-caption text-danger-600">
                                {form.formState.errors.is_store.message}
                            </p>
                        )}
                    </fieldset>

                    <div className="flex flex-col gap-3">
                        <CommerceCheckboxField
                            control={form.control}
                            name="is_pos_enabled"
                            label={t('locations.fields.posEnabled')}
                            description={t('locations.fields.posEnabledHint')}
                        />
                        <CommerceCheckboxField
                            control={form.control}
                            name="is_temporary"
                            label={t('locations.fields.temporary')}
                            description={t('locations.fields.temporaryHint')}
                        />
                        {isTemporary && (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <CommerceTextField
                                    control={form.control}
                                    name="starts_on"
                                    label={t('locations.fields.startsOn')}
                                    inputType="date"
                                    required
                                />
                                <CommerceTextField
                                    control={form.control}
                                    name="ends_on"
                                    label={t('locations.fields.endsOn')}
                                    inputType="date"
                                    required
                                />
                            </div>
                        )}
                    </div>
                </form>
            </Form>
        </MyDialog>
    );
}
