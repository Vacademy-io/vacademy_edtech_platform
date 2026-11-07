import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Info, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Form } from '@/components/ui/form';
import { formatDate } from '@/lib/formatters';
import { reportApiError } from '@/lib/report-api-error';
import type { LeaveApplicationDTO } from '@/routes/erp/-shared/hr-types';
import { HrTextareaField } from '@/routes/erp/people/-components/HrFormFields';
import { useActOnLeaveApplication } from '@/routes/erp/leave/-hooks/use-leave';
import { employeeLabel, formatDays, humanizeToken } from './leave-meta';

const buildSchema = (t: TFunction) =>
    z.object({
        rejection_reason: z
            .string()
            .trim()
            .max(500, t('validation.reasonTooLong', { ns: 'erpLeaveActionDialog' })),
    });

type ActionFormValues = z.infer<ReturnType<typeof buildSchema>>;

interface LeaveActionDialogProps {
    /** `null` closes the dialog; an application opens it for that row. */
    application: LeaveApplicationDTO | null;
    onOpenChange: (open: boolean) => void;
}

const DetailRow = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className="flex flex-col gap-0.5">
        <span className="text-caption text-muted-foreground">{label}</span>
        <span className="text-body text-foreground">{value}</span>
    </div>
);

/**
 * Approve or reject one leave application.
 *
 * Two things the backend decides only at approval time, and this dialog does NOT
 * try to predict: it re-reads the employee's balance (an approval queued behind
 * another one can find the balance already spent) and it refuses outright when
 * the month has been locked by payroll. Guessing either client-side would mean
 * hiding a button that would in fact have worked, or promising one that won't —
 * so the request is sent and the backend's own sentence is shown here, verbatim,
 * with the dialog left open on the row it applies to.
 */
export const LeaveActionDialog = ({ application, onOpenChange }: LeaveActionDialogProps) => {
    const { t } = useTranslation('erpLeaveActionDialog');
    const mutation = useActOnLeaveApplication();
    const [refusal, setRefusal] = useState<string | null>(null);

    const form = useForm<ActionFormValues>({
        resolver: zodResolver(buildSchema(t)),
        defaultValues: { rejection_reason: '' },
        mode: 'onBlur',
    });

    useEffect(() => {
        if (!application) return;
        form.reset({ rejection_reason: '' });
        setRefusal(null);
    }, [application, form]);

    const act = async (status: 'APPROVED' | 'REJECTED', rejectionReason?: string) => {
        if (!application?.id) return;
        setRefusal(null);
        try {
            await mutation.mutateAsync({ id: application.id, status, rejectionReason });
            toast.success(
                status === 'APPROVED' ? t('toast.approved') : t('toast.rejected')
            );
            onOpenChange(false);
        } catch (error) {
            // showToast: false — the message is the whole point here, and a toast that
            // fades in four seconds is the wrong place for "the March payroll is locked".
            setRefusal(
                reportApiError(error, {
                    feature: 'erp-leave',
                    tags: { action: status === 'APPROVED' ? 'approve-leave' : 'reject-leave' },
                    fallbackMessage:
                        status === 'APPROVED'
                            ? t('errors.approveFailed')
                            : t('errors.rejectFailed'),
                    showToast: false,
                })
            );
        }
    };

    const onReject = async () => {
        const reason = form.getValues('rejection_reason').trim();
        if (!reason) {
            form.setError('rejection_reason', {
                message: t('validation.reasonRequired'),
            });
            return;
        }
        await act('REJECTED', reason);
    };

    return (
        <MyDialog
            heading={t('heading')}
            open={!!application}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footer={
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('actions.close')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onAsyncClick={onReject}
                        loadingText={t('actions.rejecting')}
                    >
                        {t('actions.reject')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        onAsyncClick={() => act('APPROVED')}
                        loadingText={t('actions.approving')}
                    >
                        {t('actions.approve')}
                    </MyButton>
                </div>
            }
        >
            {application && (
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <DetailRow
                            label={t('fields.employee')}
                            value={employeeLabel(
                                application.employee_name,
                                application.employee_code
                            )}
                        />
                        <DetailRow
                            label={t('fields.leaveType')}
                            value={application.leave_type_name || '—'}
                        />
                        <DetailRow
                            label={t('fields.dates')}
                            value={
                                application.from_date
                                    ? `${formatDate(application.from_date)} → ${
                                          application.to_date
                                              ? formatDate(application.to_date)
                                              : formatDate(application.from_date)
                                      }`
                                    : '—'
                            }
                        />
                        <DetailRow
                            label={t('fields.totalDays')}
                            value={
                                <span className="tabular-nums">
                                    {formatDays(application.total_days)}
                                    {application.is_half_day
                                        ? ` · ${t('fields.halfDay')}${
                                              application.half_day_type
                                                  ? ` (${humanizeToken(application.half_day_type)})`
                                                  : ''
                                          }`
                                        : ''}
                                </span>
                            }
                        />
                    </div>

                    <DetailRow label={t('fields.reasonGiven')} value={application.reason || '—'} />

                    <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                        <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                        <span>{t('approvalNotice')}</span>
                    </div>

                    <Form {...form}>
                        <form className="flex flex-col gap-2" noValidate>
                            <HrTextareaField
                                control={form.control}
                                name="rejection_reason"
                                label={t('fields.rejectionReason')}
                                rows={3}
                                placeholder={t('fields.rejectionReasonPlaceholder')}
                                description={t('fields.rejectionReasonDescription')}
                            />
                        </form>
                    </Form>

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
                </div>
            )}
        </MyDialog>
    );
};
