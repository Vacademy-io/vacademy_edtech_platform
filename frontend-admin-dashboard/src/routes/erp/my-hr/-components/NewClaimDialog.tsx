import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Info, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Form } from '@/components/ui/form';
import SelectField from '@/components/design-system/select-field';
import { reportApiError } from '@/lib/report-api-error';
import { HrTextField, HrTextareaField } from '@/routes/erp/people/-components/HrFormFields';
import { humanizeToken } from '@/routes/erp/leave/-components/leave-meta';
import { useSubmitReimbursement } from '@/routes/erp/my-hr/-hooks/use-my-hr';
import { REIMBURSEMENT_TYPES } from './my-hr-shared';

const buildSchema = (t: TFunction) =>
    z.object({
        type: z.string().min(1, t('errors.type')),
        amount: z
            .string()
            .trim()
            .min(1, t('errors.amountRequired'))
            .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
                message: t('errors.amountPositive'),
            }),
        expense_date: z.string().min(1, t('errors.date')),
        description: z.string().trim().max(500, t('errors.descriptionLength')),
    });

type ClaimValues = z.infer<ReturnType<typeof buildSchema>>;

const emptyValues: ClaimValues = {
    type: 'TRAVEL',
    amount: '',
    expense_date: '',
    description: '',
};

const buildTypeOptions = () =>
    REIMBURSEMENT_TYPES.map((value) => ({
        _id: value,
        value,
        label: humanizeToken(value),
    }));

interface NewClaimDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    employeeId: string;
}

/**
 * Submit an expense claim.
 *
 * Deliberately four fields: what it was for, how much, when, and a line of
 * context. Receipts are not uploaded here — the backend accepts a
 * `receipt_file_id`, but nothing in this flow issues one, and an upload control
 * that silently drops the file would be worse than telling people to bring the
 * receipt to HR.
 */
export const NewClaimDialog = ({ open, onOpenChange, employeeId }: NewClaimDialogProps) => {
    const { t } = useTranslation('erpNewClaimDialog');
    const mutation = useSubmitReimbursement(employeeId);
    const [refusal, setRefusal] = useState<string | null>(null);
    const schema = buildSchema(t);
    const TYPE_OPTIONS = buildTypeOptions();

    const form = useForm<ClaimValues>({
        resolver: zodResolver(schema),
        defaultValues: emptyValues,
        mode: 'onBlur',
    });

    useEffect(() => {
        if (!open) return;
        form.reset(emptyValues);
        setRefusal(null);
    }, [open, form]);

    const submit = form.handleSubmit(async (values) => {
        setRefusal(null);
        try {
            await mutation.mutateAsync({
                employee_id: employeeId,
                type: values.type,
                amount: Number(values.amount),
                expense_date: values.expense_date,
                ...(values.description.trim() ? { description: values.description.trim() } : {}),
            });
            toast.success(t('toasts.submitted'));
            onOpenChange(false);
        } catch (error) {
            setRefusal(
                reportApiError(error, {
                    feature: 'erp-my-hr',
                    tags: { action: 'submit-reimbursement' },
                    fallbackMessage: t('errors.submitFailed'),
                    showToast: false,
                })
            );
        }
    });

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
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
                        onAsyncClick={submit}
                        loadingText={t('submitting')}
                    >
                        {t('submit')}
                    </MyButton>
                </div>
            }
        >
            <Form {...form}>
                <form className="flex flex-col gap-4" noValidate>
                    <SelectField
                        control={form.control}
                        name="type"
                        label={t('fields.typeLabel')}
                        required
                        className="w-full sm:w-full"
                        options={TYPE_OPTIONS}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                        <HrTextField
                            control={form.control}
                            name="amount"
                            label={t('fields.amountLabel')}
                            inputType="number"
                            placeholder="0"
                            required
                        />
                        <HrTextField
                            control={form.control}
                            name="expense_date"
                            label={t('fields.dateLabel')}
                            inputType="date"
                            required
                        />
                    </div>
                    <HrTextareaField
                        control={form.control}
                        name="description"
                        label={t('fields.descriptionLabel')}
                        rows={3}
                        placeholder={t('fields.descriptionPlaceholder')}
                        description={t('fields.descriptionHelp')}
                    />

                    <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                        <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                        <span>{t('pendingNotice')}</span>
                    </div>

                    {refusal && (
                        <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3">
                            <WarningCircle
                                size={16}
                                weight="fill"
                                className="mt-0.5 shrink-0 text-danger-600"
                            />
                            <p className="text-body text-danger-600">{refusal}</p>
                        </div>
                    )}
                </form>
            </Form>
        </MyDialog>
    );
};
