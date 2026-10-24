import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Info } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Form } from '@/components/ui/form';
import { reportApiError } from '@/lib/report-api-error';
import type { LeaveBalanceDTO } from '@/routes/erp/-shared/hr-types';
import { HrTextField, HrTextareaField } from '@/routes/erp/people/-components/HrFormFields';
import { useAdjustLeaveBalance } from '@/routes/erp/leave/-hooks/use-leave';
import { employeeLabel, formatDays, toNumber } from './leave-meta';

const buildSchema = (t: TFunction) =>
    z.object({
        adjustment: z
            .string()
            .trim()
            .min(1, t('errors.correctionRequired'))
            .regex(/^-?\d+(\.\d+)?$/, t('errors.numbersOnly'))
            .refine((value) => Number(value) !== 0, t('errors.notZero')),
        reason: z.string().trim().max(500, t('errors.reasonLength')),
    });

type AdjustFormValues = z.infer<ReturnType<typeof buildSchema>>;

interface BalanceAdjustDialogProps {
    /** `null` closes the dialog; a balance row opens it for that employee + leave type. */
    balance: LeaveBalanceDTO | null;
    onOpenChange: (open: boolean) => void;
}

/**
 * Correct one employee's balance for one leave type.
 *
 * The value is an ADJUSTMENT, not a new closing balance: it is added to the
 * ledger, so `-2` takes two days away and `1.5` grants a day and a half. Writing
 * the resulting closing balance under the field is the cheapest way to stop the
 * common mistake of typing the number the admin wants to end up with.
 */
export const BalanceAdjustDialog = ({ balance, onOpenChange }: BalanceAdjustDialogProps) => {
    const { t } = useTranslation('erpBalanceAdjustDialog');
    const mutation = useAdjustLeaveBalance();

    const form = useForm<AdjustFormValues>({
        resolver: zodResolver(buildSchema(t)),
        defaultValues: { adjustment: '', reason: '' },
        mode: 'onBlur',
    });

    useEffect(() => {
        if (!balance) return;
        form.reset({ adjustment: '', reason: '' });
    }, [balance, form]);

    const typed = toNumber(form.watch('adjustment'));
    const currentClosing = toNumber(balance?.closing_balance) ?? 0;
    const projected = typed === null ? null : currentClosing + typed;

    const onSubmit = async (values: AdjustFormValues) => {
        if (!balance?.id) return;
        try {
            await mutation.mutateAsync({
                id: balance.id,
                adjustment: Number(values.adjustment),
                reason: values.reason || undefined,
            });
            toast.success(t('toasts.adjusted'));
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-leave',
                tags: { action: 'adjust-leave-balance' },
                fallbackMessage: t('errors.adjustFailed'),
            });
        }
    };

    return (
        <MyDialog
            heading={t('heading')}
            open={!!balance}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('adjusting')}
                    >
                        {t('applyAdjustment')}
                    </MyButton>
                </div>
            }
        >
            {balance && (
                <Form {...form}>
                    <form className="flex flex-col gap-4" noValidate>
                        <div className="flex flex-col gap-1 rounded-md border border-border p-3">
                            <span className="text-body font-semibold text-foreground">
                                {employeeLabel(balance.employee_name, balance.employee_code)}
                            </span>
                            <span className="text-caption text-muted-foreground">
                                {balance.leave_type_name || t('leave')} · {balance.year ?? '—'} ·{' '}
                                {t('closingBalance', {
                                    value: formatDays(balance.closing_balance),
                                })}
                            </span>
                        </div>

                        <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                            <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                            <span>
                                {t('adjustmentExplainer.before')} <b>1.5</b>{' '}
                                {t('adjustmentExplainer.middle')} <b>-2</b>{' '}
                                {t('adjustmentExplainer.after')}
                            </span>
                        </div>

                        <HrTextField
                            control={form.control}
                            name="adjustment"
                            label={t('fields.adjustmentLabel')}
                            placeholder="-2"
                            required
                            description={
                                projected === null
                                    ? t('fields.adjustmentHelpDefault')
                                    : t('fields.adjustmentHelpProjected', {
                                          value: formatDays(projected),
                                      })
                            }
                        />

                        <HrTextareaField
                            control={form.control}
                            name="reason"
                            label={t('fields.reasonLabel')}
                            rows={3}
                            placeholder={t('fields.reasonPlaceholder')}
                            description={t('fields.reasonHelp')}
                        />
                    </form>
                </Form>
            )}
        </MyDialog>
    );
};
