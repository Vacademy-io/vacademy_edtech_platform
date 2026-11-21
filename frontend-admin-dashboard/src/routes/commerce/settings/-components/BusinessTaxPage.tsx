import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { MyButton } from '@/components/design-system/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { COMMERCE_FEATURE } from '@/lib/commerce/commerce-access';
import {
    CommerceSelectField,
    CommerceTextField,
} from '@/routes/commerce/-components/CommerceFormFields';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceErrorState,
    CommerceLoadingRows,
} from '@/routes/commerce/-components/CommerceStates';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { useSaveTaxSettings, useTaxSettings } from '@/routes/commerce/-shared/commerce-hooks';
import type {
    CommerceTaxSettings,
    RoundTotalTo,
    SlabBasis,
    SlabCompare,
    TaxMode,
} from '@/routes/commerce/-shared/commerce-types';
import { gstinProblem, normalizeGstin } from '@/routes/commerce/-shared/gstin';
import { CaBanner, settingsBackLink, stateOptions } from './settings-shared';

const TAX_MODES: readonly TaxMode[] = ['REGULAR', 'COMPOSITION', 'UNREGISTERED'];
const SLAB_BASES: readonly SlabBasis[] = ['NET_UNIT_PRICE', 'LIST_UNIT_PRICE'];
const SLAB_COMPARES: readonly SlabCompare[] = ['TAX_EXCLUSIVE', 'TAX_INCLUSIVE'];
const ROUNDINGS: readonly RoundTotalTo[] = ['NONE', 'RUPEE'];

const buildSchema = (t: TFunction) =>
    z
        .object({
            tax_mode: z.string().min(1, t('business.validation.taxModeRequired')),
            seller_legal_name: z.string().trim().max(200, t('business.validation.nameMax')),
            seller_address: z.string().trim().max(500, t('business.validation.addressMax')),
            seller_state_code: z.string().min(1, t('business.validation.stateRequired')),
            seller_gstin: z.string().trim(),
            slab_basis: z.string(),
            slab_compare: z.string(),
            round_total_to: z.string(),
        })
        .superRefine((values, ctx) => {
            const gstin = normalizeGstin(values.seller_gstin);
            // A GSTIN is required only in tax mode Regular; optional elsewhere,
            // and checked whenever one is typed.
            if (!gstin) {
                if (values.tax_mode === 'REGULAR') {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['seller_gstin'],
                        message: t('business.validation.gstinRequired'),
                    });
                }
                return;
            }
            const problem = gstinProblem(gstin, values.seller_state_code || null);
            if (problem) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['seller_gstin'],
                    message: t(`business.validation.gstin.${problem}`),
                });
            }
        });

type BusinessValues = z.infer<ReturnType<typeof buildSchema>>;

const toValues = (settings: CommerceTaxSettings | undefined): BusinessValues => ({
    tax_mode: settings?.tax_mode ?? '',
    seller_legal_name: settings?.seller_legal_name ?? '',
    seller_address: settings?.seller_address ?? '',
    seller_state_code: settings?.seller_state_code ?? '',
    seller_gstin: settings?.seller_gstin ?? '',
    // Never pre-filled: the slab basis is the CA's answer, not a default.
    slab_basis: settings?.slab_basis ?? '',
    slab_compare: settings?.slab_compare ?? '',
    round_total_to: settings?.round_total_to ?? '',
});

/**
 * Settings → Business and tax (checklist item 1): who the seller is for tax and
 * how tax is worked out. The app never calculates tax itself: these are the
 * inputs of the server's one calculator.
 */
export function BusinessTaxPage() {
    const { t } = useTranslation('commerce');
    return (
        <CommercePage
            navId="commerce-settings"
            anyFeature={[COMMERCE_FEATURE.TAX_REPORTS]}
            title={t('settings.cards.business.title')}
            description={t('business.description')}
            backTo={settingsBackLink(t)}
        >
            <BusinessTaxForm />
        </CommercePage>
    );
}

function BusinessTaxForm() {
    const { t } = useTranslation('commerce');
    const query = useTaxSettings();
    const mutation = useSaveTaxSettings();
    const schema = useMemo(() => buildSchema(t), [t]);
    const form = useForm<BusinessValues>({
        resolver: zodResolver(schema),
        defaultValues: toValues(undefined),
        mode: 'onChange',
    });

    useEffect(() => {
        if (query.data) form.reset(toValues(query.data));
    }, [query.data, form]);

    const taxMode = form.watch('tax_mode');
    const isRegular = taxMode === 'REGULAR';

    if (query.isLoading) return <CommerceLoadingRows rows={3} />;
    if (query.isError) {
        return (
            <CommerceErrorState
                message={readCommerceError(query.error, t('business.errors.load')).message}
                onRetry={() => void query.refetch()}
            />
        );
    }

    const onSubmit = async (values: BusinessValues) => {
        try {
            await mutation.mutateAsync({
                tax_mode: values.tax_mode as TaxMode,
                seller_legal_name: values.seller_legal_name || null,
                seller_address: values.seller_address || null,
                seller_state_code: values.seller_state_code || null,
                seller_gstin: normalizeGstin(values.seller_gstin) || null,
                slab_basis: isRegular ? (values.slab_basis as SlabBasis) || null : null,
                slab_compare: isRegular ? (values.slab_compare as SlabCompare) || null : null,
                round_total_to: (values.round_total_to as RoundTotalTo) || null,
            });
            toast.success(t('business.toast.saved'));
        } catch (error) {
            toast.error(readCommerceError(error, t('business.errors.save')).message);
        }
    };

    const option = (prefix: string) => (value: string) => ({
        value,
        label: t(`${prefix}.${value}`),
    });

    return (
        <Form {...form}>
            <form className="flex flex-col gap-6" noValidate>
                <CaBanner text={t('business.caBanner')} />
                <Card>
                    <CardHeader>
                        <CardTitle className="text-title font-medium">
                            {t('business.sections.seller.title')}
                        </CardTitle>
                        <CardDescription className="text-body">
                            {t('business.sections.seller.description')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <CommerceTextField
                            control={form.control}
                            name="seller_legal_name"
                            label={t('business.fields.legalName')}
                            placeholder={t('business.fields.legalNamePlaceholder')}
                            maxLength={200}
                        />
                        <CommerceSelectField
                            control={form.control}
                            name="seller_state_code"
                            label={t('business.fields.state')}
                            placeholder={t('business.fields.statePlaceholder')}
                            options={stateOptions(t)}
                            required
                        />
                        <CommerceTextField
                            control={form.control}
                            name="seller_address"
                            label={t('business.fields.address')}
                            placeholder={t('business.fields.addressPlaceholder')}
                            maxLength={500}
                            className="sm:col-span-2"
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-title font-medium">
                            {t('business.sections.tax.title')}
                        </CardTitle>
                        <CardDescription className="text-body">
                            {t('business.sections.tax.description')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <CommerceSelectField
                            control={form.control}
                            name="tax_mode"
                            label={t('business.fields.taxMode')}
                            placeholder={t('business.fields.taxModePlaceholder')}
                            description={taxMode ? t(`business.taxModeHelp.${taxMode}`) : undefined}
                            options={TAX_MODES.map(option('status.taxMode'))}
                            required
                        />
                        <CommerceTextField
                            control={form.control}
                            name="seller_gstin"
                            label={t('business.fields.gstin')}
                            placeholder={t('business.fields.gstinPlaceholder')}
                            description={
                                isRegular
                                    ? t('business.fields.gstinHintRegular')
                                    : t('business.fields.gstinHintOptional')
                            }
                            maxLength={15}
                            transform={normalizeGstin}
                            required={isRegular}
                        />
                        {isRegular && (
                            <>
                                <CommerceSelectField
                                    control={form.control}
                                    name="slab_basis"
                                    label={t('business.fields.slabBasis')}
                                    placeholder={t('business.fields.choose')}
                                    description={t('business.fields.slabBasisHint')}
                                    options={SLAB_BASES.map(option('business.slabBasis'))}
                                />
                                <CommerceSelectField
                                    control={form.control}
                                    name="slab_compare"
                                    label={t('business.fields.slabCompare')}
                                    placeholder={t('business.fields.choose')}
                                    description={t('business.fields.slabCompareHint')}
                                    options={SLAB_COMPARES.map(option('business.slabCompare'))}
                                />
                            </>
                        )}
                        <CommerceSelectField
                            control={form.control}
                            name="round_total_to"
                            label={t('business.fields.roundTotalTo')}
                            placeholder={t('business.fields.choose')}
                            options={ROUNDINGS.map(option('business.roundTotalTo'))}
                        />
                    </CardContent>
                </Card>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    {isRegular ? (
                        <Link
                            to="/commerce/settings/tax-classes"
                            className="text-body text-primary-500 hover:underline"
                        >
                            {t('business.manageTaxClasses')}
                        </Link>
                    ) : (
                        <p className="text-caption text-muted-foreground">
                            {t('business.noTaxClassesNeeded')}
                        </p>
                    )}
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('common.saving')}
                    >
                        {t('common.save')}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
}
