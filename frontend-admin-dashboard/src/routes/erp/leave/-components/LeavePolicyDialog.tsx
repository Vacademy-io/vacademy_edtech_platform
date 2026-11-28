import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Info } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import SelectField from '@/components/design-system/select-field';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
} from '@/components/ui/form';
import { reportApiError } from '@/lib/report-api-error';
import type { LeavePolicyDTO, LeaveTypeDTO } from '@/routes/erp/-shared/hr-types';
import { HrTextField } from '@/routes/erp/people/-components/HrFormFields';
import { useSaveLeavePolicy } from '@/routes/erp/leave/-hooks/use-leave';
import { ACCRUAL_TYPE_LABELS, ACCRUAL_TYPE_OPTIONS, RECORD_STATUS_OPTIONS } from './leave-meta';

const buildSchema = (t: TFunction) =>
    z
        .object({
            leave_type_id: z.string().min(1, t('validation.leaveTypeRequired')),
            annual_quota: z
                .string()
                .trim()
                .min(1, t('validation.annualQuotaRequired'))
                .regex(/^\d+(\.\d+)?$/, t('validation.annualQuotaFormat')),
            accrual_type: z.string().min(1, t('validation.accrualTypeRequired')),
            accrual_amount: z
                .string()
                .trim()
                .min(1, t('validation.accrualAmountRequired'))
                .regex(/^\d+(\.\d+)?$/, t('validation.accrualAmountFormat')),
            pro_rata_enabled: z.boolean(),
            applicable_after_days: z.string().trim().regex(/^\d*$/, t('validation.wholeDaysOnly')),
            effective_from: z.string().min(1, t('validation.effectiveFromRequired')),
            effective_to: z.string(),
            status: z.string().min(1, t('validation.statusRequired')),
        })
        .refine(
            (values) =>
                !values.effective_to || !values.effective_from
                    ? true
                    : values.effective_to >= values.effective_from,
            { path: ['effective_to'], message: t('validation.endBeforeStart') }
        );

type PolicyFormValues = z.infer<ReturnType<typeof buildSchema>>;

const emptyValues: PolicyFormValues = {
    leave_type_id: '',
    annual_quota: '',
    accrual_type: 'MONTHLY',
    accrual_amount: '',
    pro_rata_enabled: true,
    applicable_after_days: '',
    effective_from: '',
    effective_to: '',
    status: 'ACTIVE',
};

interface LeavePolicyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** `null` to create; a policy to edit. */
    policy: LeavePolicyDTO | null;
    /** The institute's leave types — a policy has to attach to one. */
    leaveTypes: LeaveTypeDTO[];
}

/**
 * Add or edit one leave policy: how much of a leave type an employee gets, and
 * on what rhythm it arrives.
 *
 * Quota and accrual are two different numbers on purpose — the quota is the year's
 * entitlement, the accrual amount is what each scheduled run actually credits.
 * A 12-day annual quota accrued monthly is 1 day a month; the same quota accrued
 * yearly lands all at once in the first run of the year.
 */
export const LeavePolicyDialog = ({
    open,
    onOpenChange,
    policy,
    leaveTypes,
}: LeavePolicyDialogProps) => {
    const { t } = useTranslation('erpLeavePolicyDialog');
    const mutation = useSaveLeavePolicy();
    const isEdit = !!policy?.id;

    const schema = useMemo(() => buildSchema(t), [t]);

    const form = useForm<PolicyFormValues>({
        resolver: zodResolver(schema),
        defaultValues: emptyValues,
        mode: 'onBlur',
    });

    useEffect(() => {
        if (!open) return;
        form.reset(
            policy
                ? {
                      leave_type_id: policy.leave_type_id ?? '',
                      annual_quota:
                          policy.annual_quota === undefined || policy.annual_quota === null
                              ? ''
                              : String(policy.annual_quota),
                      accrual_type: (policy.accrual_type || 'MONTHLY').toUpperCase(),
                      accrual_amount:
                          policy.accrual_amount === undefined || policy.accrual_amount === null
                              ? ''
                              : String(policy.accrual_amount),
                      pro_rata_enabled: policy.pro_rata_enabled ?? true,
                      applicable_after_days:
                          policy.applicable_after_days === undefined ||
                          policy.applicable_after_days === null
                              ? ''
                              : String(policy.applicable_after_days),
                      effective_from: policy.effective_from ?? '',
                      effective_to: policy.effective_to ?? '',
                      status: (policy.status || 'ACTIVE').toUpperCase(),
                  }
                : emptyValues
        );
    }, [open, policy, form]);

    const leaveTypeOptions = leaveTypes
        .filter((type) => !!type.id)
        .map((type) => ({
            _id: type.id as string,
            value: type.id as string,
            label: type.code
                ? `${type.name || type.code} (${type.code})`
                : type.name || t('fields.leaveType.fallback'),
        }));

    const accrualType = form.watch('accrual_type');
    const accrualLabel = ACCRUAL_TYPE_LABELS[accrualType] ?? accrualType;

    const onSubmit = async (values: PolicyFormValues) => {
        try {
            await mutation.mutateAsync({
                ...(policy?.id ? { id: policy.id } : {}),
                leave_type_id: values.leave_type_id,
                annual_quota: Number(values.annual_quota),
                accrual_type: values.accrual_type,
                accrual_amount: Number(values.accrual_amount),
                pro_rata_enabled: values.pro_rata_enabled,
                applicable_after_days:
                    values.applicable_after_days.trim() === ''
                        ? undefined
                        : Number(values.applicable_after_days),
                effective_from: values.effective_from,
                effective_to: values.effective_to || undefined,
                status: values.status,
            });
            toast.success(isEdit ? t('toast.updated') : t('toast.created'));
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-leave',
                tags: { action: isEdit ? 'update-leave-policy' : 'create-leave-policy' },
                fallbackMessage: t('errors.saveFailed'),
            });
        }
    };

    return (
        <MyDialog
            heading={isEdit ? t('dialog.editHeading') : t('dialog.addHeading')}
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
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('actions.saving')}
                    >
                        {isEdit ? t('actions.saveChanges') : t('actions.createPolicy')}
                    </MyButton>
                </div>
            }
        >
            <Form {...form}>
                <form className="flex flex-col gap-4" noValidate>
                    <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                        <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                        <span>
                            {t('info.accrualExplanationPrefix')}
                            <b>{accrualLabel.toLowerCase()}</b>
                            {t('info.accrualExplanationSuffix')}
                        </span>
                    </div>

                    {leaveTypeOptions.length === 0 ? (
                        <p className="text-body text-danger-600">{t('noLeaveTypes')}</p>
                    ) : (
                        <SelectField
                            control={form.control}
                            name="leave_type_id"
                            label={t('fields.leaveType.label')}
                            required
                            options={leaveTypeOptions}
                            className="w-full sm:w-full"
                        />
                    )}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <HrTextField
                            control={form.control}
                            name="annual_quota"
                            label={t('fields.annualQuota.label')}
                            placeholder={t('fields.annualQuota.placeholder')}
                            required
                            description={t('fields.annualQuota.description')}
                        />
                        <SelectField
                            control={form.control}
                            name="accrual_type"
                            label={t('fields.accrualType.label')}
                            required
                            options={ACCRUAL_TYPE_OPTIONS}
                            className="w-full sm:w-full"
                        />
                        <HrTextField
                            control={form.control}
                            name="accrual_amount"
                            label={t('fields.accrualAmount.label')}
                            placeholder={t('fields.accrualAmount.placeholder')}
                            required
                            description={t('fields.accrualAmount.description', {
                                accrualLabel: accrualLabel.toLowerCase(),
                            })}
                        />
                        <HrTextField
                            control={form.control}
                            name="applicable_after_days"
                            label={t('fields.applicableAfterDays.label')}
                            placeholder={t('fields.applicableAfterDays.placeholder')}
                            description={t('fields.applicableAfterDays.description')}
                        />
                        <HrTextField
                            control={form.control}
                            name="effective_from"
                            label={t('fields.effectiveFrom.label')}
                            inputType="date"
                            required
                        />
                        <HrTextField
                            control={form.control}
                            name="effective_to"
                            label={t('fields.effectiveTo.label')}
                            inputType="date"
                            description={t('fields.effectiveTo.description')}
                        />
                        <SelectField
                            control={form.control}
                            name="status"
                            label={t('fields.status.label')}
                            required
                            options={RECORD_STATUS_OPTIONS}
                            className="w-full sm:w-full"
                        />
                    </div>

                    <FormField
                        control={form.control}
                        name="pro_rata_enabled"
                        render={({ field }) => (
                            <FormItem className="flex flex-col gap-1.5">
                                <div className="flex flex-row items-center gap-2">
                                    <FormControl>
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={(checked) =>
                                                field.onChange(checked === true)
                                            }
                                        />
                                    </FormControl>
                                    <FormLabel className="!mt-0 text-body text-foreground">
                                        {t('checkbox.proRata.label')}
                                    </FormLabel>
                                </div>
                                <FormDescription className="text-caption text-muted-foreground">
                                    {t('checkbox.proRata.description')}
                                </FormDescription>
                            </FormItem>
                        )}
                    />
                </form>
            </Form>
        </MyDialog>
    );
};
