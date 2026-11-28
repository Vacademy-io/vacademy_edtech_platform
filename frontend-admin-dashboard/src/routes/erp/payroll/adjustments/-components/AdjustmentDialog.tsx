import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { formatMonthValue, type MonthValue } from '@/components/design-system/month-picker';
import SelectField from '@/components/design-system/select-field';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { reportApiError } from '@/lib/report-api-error';
import { EmployeePicker } from '@/routes/erp/-shared/EmployeePicker';
import { createAdjustment, hrKeys } from '@/routes/erp/-shared/hr-service';
import { ADJUSTMENT_TYPE_OPTIONS, CURRENCY_OPTIONS, buildRunScopeOptions } from './adjustment-meta';

const buildSchema = (t: TFunction) =>
    z.object({
        employee_id: z.string().min(1, t('validation.employeeRequired')),
        type: z.enum(['EARNING', 'DEDUCTION']),
        code: z
            .string()
            .trim()
            .min(2, t('validation.codeMinLength'))
            .regex(/^[A-Z0-9_]+$/, t('validation.codeFormat')),
        label: z.string().trim().min(1, t('validation.labelRequired')),
        amount: z
            .string()
            .min(1, t('validation.amountRequired'))
            .refine(
                (value) => Number.isFinite(Number(value)) && Number(value) > 0,
                t('validation.amountPositive')
            ),
        currency: z.enum(['INR', 'AED', 'SAR']),
        run_scope: z.enum(['REGULAR', 'OFF_CYCLE', 'FNF', 'BONUS']),
        notes: z.string().trim().max(500, t('validation.notesMaxLength')),
    });

type AdjustmentFormValues = z.infer<ReturnType<typeof buildSchema>>;

const defaultValues: AdjustmentFormValues = {
    employee_id: '',
    type: 'EARNING',
    code: '',
    label: '',
    amount: '',
    currency: 'INR',
    run_scope: 'REGULAR',
    notes: '',
};

interface AdjustmentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The month the table is showing — the adjustment is stamped with it. */
    month: MonthValue;
}

/**
 * Record one adjustment against the month currently in view.
 *
 * The month is taken from the page rather than asked for again: an adjustment
 * entered while looking at August that silently lands in September is the
 * failure mode of a second date control here.
 */
export const AdjustmentDialog = ({ open, onOpenChange, month }: AdjustmentDialogProps) => {
    const { t } = useTranslation(['erpAdjustmentDialog', 'erpPayrollStatus']);
    const queryClient = useQueryClient();

    const schema = useMemo(() => buildSchema(t), [t]);
    const runScopeOptions = useMemo(() => buildRunScopeOptions(t), [t]);

    const form = useForm<AdjustmentFormValues>({
        resolver: zodResolver(schema),
        defaultValues,
        mode: 'onBlur',
    });

    useEffect(() => {
        if (open) form.reset(defaultValues);
    }, [open, form]);

    const mutation = useMutation({
        mutationFn: createAdjustment,
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: hrKeys.adjustments(month.year, month.month),
            });
            toast.success(t('toast.added'));
            onOpenChange(false);
        },
        onError: (error) => {
            reportApiError(error, {
                feature: 'erp-adjustments',
                tags: { action: 'create-adjustment' },
                fallbackMessage: t('errors.addFailed'),
            });
        },
    });

    const onSubmit = async (values: AdjustmentFormValues) => {
        await mutation.mutateAsync({
            employee_id: values.employee_id,
            month: month.month,
            year: month.year,
            type: values.type,
            code: values.code.toUpperCase(),
            label: values.label,
            amount: Number(values.amount),
            currency: values.currency,
            run_scope: values.run_scope,
            notes: values.notes || undefined,
        });
    };

    return (
        <MyDialog
            heading={t('dialog.heading', { month: formatMonthValue(month) })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
            footer={
                <>
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
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('actions.adding')}
                    >
                        {t('actions.addAdjustment')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-4"
                    noValidate
                >
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="employee_id"
                            render={({ field }) => (
                                <FormItem className="sm:col-span-2">
                                    <FormLabel>{t('fields.employee.label')}</FormLabel>
                                    <FormControl>
                                        <EmployeePicker
                                            value={field.value}
                                            onChange={field.onChange}
                                            portal={false}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <SelectField
                            control={form.control}
                            name="type"
                            label={t('fields.type.label')}
                            required
                            options={ADJUSTMENT_TYPE_OPTIONS}
                            className="w-full sm:w-full"
                        />

                        <FormField
                            control={form.control}
                            name="code"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('fields.code.label')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t('fields.code.placeholder')}
                                            className="w-full font-mono sm:w-full"
                                            required
                                            input={field.value}
                                            name={field.name}
                                            onBlur={field.onBlur}
                                            onChangeFunction={(event) =>
                                                field.onChange(
                                                    event.target.value
                                                        .toUpperCase()
                                                        .replace(/\s+/g, '_')
                                                )
                                            }
                                        />
                                    </FormControl>
                                    <FormDescription className="text-caption text-neutral-500">
                                        {t('fields.code.description')}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="label"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('fields.label.label')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t('fields.label.placeholder')}
                                            className="w-full sm:w-full"
                                            required
                                            input={field.value}
                                            name={field.name}
                                            onBlur={field.onBlur}
                                            onChangeFunction={(event) =>
                                                field.onChange(event.target.value)
                                            }
                                        />
                                    </FormControl>
                                    <FormDescription className="text-caption text-neutral-500">
                                        {t('fields.label.description')}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="amount"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('fields.amount.label')}</FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="number"
                                            inputPlaceholder={t('fields.amount.placeholder')}
                                            className="w-full sm:w-full"
                                            required
                                            input={field.value}
                                            name={field.name}
                                            onBlur={field.onBlur}
                                            onChangeFunction={(event) =>
                                                field.onChange(event.target.value)
                                            }
                                        />
                                    </FormControl>
                                    <FormDescription className="text-caption text-neutral-500">
                                        {t('fields.amount.description')}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <SelectField
                            control={form.control}
                            name="currency"
                            label={t('fields.currency.label')}
                            required
                            options={CURRENCY_OPTIONS}
                            className="w-full sm:w-full"
                        />

                        <SelectField
                            control={form.control}
                            name="run_scope"
                            label={t('fields.runScope.label')}
                            required
                            options={runScopeOptions}
                            className="w-full sm:w-full"
                        />
                    </div>

                    <FormField
                        control={form.control}
                        name="notes"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('fields.notes.label')}</FormLabel>
                                <FormControl>
                                    <Textarea
                                        {...field}
                                        placeholder={t('fields.notes.placeholder')}
                                        className="text-body"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </form>
            </Form>
        </MyDialog>
    );
};
