import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Info } from '@phosphor-icons/react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import SelectField from '@/components/design-system/select-field';
import { Form } from '@/components/ui/form';
import { reportApiError } from '@/lib/report-api-error';
import type { EmployeeProfileDTO } from '@/routes/erp/-shared/hr-types';
import { useUpdateEmployeeStatus } from '../-hooks/use-hr-people';
import { buildEmploymentStatusOptions, humanizeToken, isExitStatus } from './EmployeeFields';
import { HrTextField, HrTextareaField } from './HrFormFields';

/**
 * Move an employee to a different employment status.
 *
 * The exit statuses (terminated / relieved / absconding) are the reason this is a
 * dialog and not an inline dropdown: they need a last working date and a reason,
 * both of which the full-and-final settlement is computed from. Asking for them
 * here means the F&F run later has what it needs instead of failing on it.
 */

const buildStatusSchema = (t: TFunction) =>
    z
        .object({
            employment_status: z.string().min(1, t('validation.pickStatus')),
            last_working_date: z.string(),
            exit_reason: z.string(),
        })
        .superRefine((values, ctx) => {
            if (!isExitStatus(values.employment_status)) return;
            if (!values.last_working_date) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['last_working_date'],
                    message: t('validation.lastWorkingDateRequired'),
                });
            }
            if (!values.exit_reason.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['exit_reason'],
                    message: t('validation.exitReasonRequired'),
                });
            }
        });

type StatusFormValues = z.infer<ReturnType<typeof buildStatusSchema>>;

interface EmploymentStatusDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    employee: EmployeeProfileDTO;
}

export function EmploymentStatusDialog({
    open,
    onOpenChange,
    employee,
}: EmploymentStatusDialogProps) {
    const { t } = useTranslation(['erpEmploymentStatusDialog', 'erpEmployeeFields']);
    const updateStatus = useUpdateEmployeeStatus();
    const employmentStatusOptions = useMemo(() => buildEmploymentStatusOptions(t), [t]);

    const form = useForm<StatusFormValues>({
        resolver: zodResolver(buildStatusSchema(t)),
        defaultValues: {
            employment_status: employee.employment_status ?? '',
            last_working_date: (employee.last_working_date ?? '').slice(0, 10),
            exit_reason: employee.exit_reason ?? '',
        },
        mode: 'onBlur',
    });

    useEffect(() => {
        if (open) {
            form.reset({
                employment_status: employee.employment_status ?? '',
                last_working_date: (employee.last_working_date ?? '').slice(0, 10),
                exit_reason: employee.exit_reason ?? '',
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, employee]);

    const selectedStatus = form.watch('employment_status');
    const exiting = isExitStatus(selectedStatus);
    const personLabel = employee.full_name || employee.employee_code || t('fallbackEmployeeLabel');

    const onSubmit = async (values: StatusFormValues) => {
        if (!employee.id) return;
        try {
            await updateStatus.mutateAsync({
                id: employee.id,
                payload: {
                    employment_status: values.employment_status,
                    // Only meaningful for an exit; omitted otherwise so a
                    // correction back to ACTIVE doesn't carry a stale exit date.
                    last_working_date: exiting ? values.last_working_date : undefined,
                    exit_reason: exiting ? values.exit_reason.trim() : undefined,
                },
            });
            toast.success(
                exiting
                    ? t('toast.exitStatusUpdated', {
                          name: personLabel,
                          status: humanizeToken(values.employment_status).toLowerCase(),
                      })
                    : t('toast.statusUpdated', {
                          status: humanizeToken(values.employment_status).toLowerCase(),
                      })
            );
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-people',
                tags: { 'erp.action': 'update-employee-status' },
                extra: { employeeId: employee.id, nextStatus: values.employment_status },
                fallbackMessage: t('errors.updateFailed'),
            });
        }
    };

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('actions.updating')}
                    >
                        {t('actions.updateStatus')}
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
                    <p className="text-body text-muted-foreground">
                        <Trans
                            t={t}
                            i18nKey="currentStatus"
                            values={{
                                status: humanizeToken(employee.employment_status) || t('notSet'),
                                name: personLabel,
                            }}
                            components={{ 1: <span className="text-foreground" /> }}
                        />
                    </p>

                    <SelectField
                        control={form.control}
                        name="employment_status"
                        label={t('fields.newStatus')}
                        required
                        options={employmentStatusOptions}
                        className="w-full sm:w-full"
                    />

                    {exiting && (
                        <div className="flex flex-col gap-4 rounded-lg border border-warning-200 bg-warning-50 p-4">
                            <div className="flex items-start gap-2">
                                <Info size={18} className="mt-0.5 shrink-0 text-warning-600" />
                                <p className="text-caption text-warning-700">
                                    {t('exitNotice')}
                                </p>
                            </div>
                            <HrTextField
                                control={form.control}
                                name="last_working_date"
                                label={t('fields.lastWorkingDate')}
                                inputType="date"
                                required
                            />
                            <HrTextareaField
                                control={form.control}
                                name="exit_reason"
                                label={t('fields.exitReason')}
                                placeholder={t('fields.exitReasonPlaceholder')}
                                required
                            />
                        </div>
                    )}
                </form>
            </Form>
        </MyDialog>
    );
}
