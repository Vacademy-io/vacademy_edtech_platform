import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Info } from '@phosphor-icons/react';
import { addDays, format } from 'date-fns';
import { MyButton } from '@/components/design-system/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    MANUAL_RENEWAL_PREVIEW_QUERY_KEY,
    PLAN_REMARKS_QUERY_KEY,
    changePlanEndDate,
} from '@/services/user-plan';
import { PlanRemarksPanel } from './plan-remarks';

interface ChangeEndDateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userPlanId: string | null;
    instituteId: string;
    /** The plan's current end date, ISO; prefills the picker. */
    currentEndDate?: string | null;
    planLabel?: string;
    /** Called after the change lands, so the caller can refresh its plan list. */
    onChanged: () => void;
}

const toInputDate = (iso?: string | null): string => {
    if (!iso) return '';
    try {
        return format(new Date(iso), 'yyyy-MM-dd');
    } catch {
        return '';
    }
};

/**
 * Admin corrects when an active membership ends — a payment taken before the learner was
 * enrolled, a date entered wrong — without recording a payment. Course access moves with
 * it, and the remark joins the plan's history with the admin's name and the time.
 */
export const ChangeEndDateDialog = ({
    open,
    onOpenChange,
    userPlanId,
    instituteId,
    currentEndDate,
    planLabel,
    onChanged,
}: ChangeEndDateDialogProps) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const queryClient = useQueryClient();
    const [endDate, setEndDate] = useState('');
    const [remarks, setRemarks] = useState('');

    // Reset per-open so nothing carries onto another member.
    useEffect(() => {
        if (!open) return;
        setEndDate(toInputDate(currentEndDate));
        setRemarks('');
    }, [open, userPlanId, currentEndDate]);

    const mutation = useMutation({
        mutationFn: () =>
            changePlanEndDate(userPlanId as string, instituteId, {
                new_end_date: endDate,
                remarks: remarks.trim(),
            }),
        onSuccess: (result) => {
            toast.success(
                t('endDate.success', {
                    date: format(new Date(result.new_end_date), 'dd MMM yyyy'),
                })
            );
            queryClient.invalidateQueries({ queryKey: [PLAN_REMARKS_QUERY_KEY, userPlanId] });
            queryClient.invalidateQueries({
                queryKey: [MANUAL_RENEWAL_PREVIEW_QUERY_KEY, userPlanId],
            });
            onChanged();
            onOpenChange(false);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || err?.message || t('endDate.failed'));
        },
    });

    const minEndDate = format(addDays(new Date(), 1), 'yyyy-MM-dd');
    const unchanged = endDate !== '' && endDate === toInputDate(currentEndDate);
    const canSubmit =
        Boolean(userPlanId) &&
        Boolean(endDate) &&
        endDate >= minEndDate &&
        !unchanged &&
        remarks.trim() !== '' &&
        !mutation.isPending;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-screen max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('endDate.title')}</DialogTitle>
                    {planLabel && <p className="text-sm text-neutral-500">{planLabel}</p>}
                </DialogHeader>

                <div className="space-y-4 py-1">
                    <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-xs text-info-700 ring-1 ring-info-200">
                        <Info className="mt-0.5 size-4 shrink-0" />
                        <span>
                            {t('endDate.explainer', {
                                date: currentEndDate
                                    ? format(new Date(currentEndDate), 'dd MMM yyyy')
                                    : '—',
                            })}
                        </span>
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="ced-end">{t('endDate.newEndDate')}</Label>
                        <Input
                            id="ced-end"
                            type="date"
                            min={minEndDate}
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                        />
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="ced-remarks">
                            {t('endDate.remarks')} <span className="text-danger-600">*</span>
                        </Label>
                        <Textarea
                            id="ced-remarks"
                            rows={3}
                            value={remarks}
                            onChange={(e) => setRemarks(e.target.value)}
                            placeholder={t('endDate.remarksPlaceholder')}
                            aria-required="true"
                        />
                        <p className="text-xs text-neutral-500">{t('endDate.remarksHint')}</p>
                    </div>

                    {userPlanId && (
                        <div className="space-y-2 border-t border-neutral-100 pt-3">
                            <h4 className="text-xs font-semibold uppercase text-neutral-500">
                                {t('remarks.history')}
                            </h4>
                            <PlanRemarksPanel
                                userPlanId={userPlanId}
                                instituteId={instituteId}
                                showComposer={false}
                            />
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => onOpenChange(false)}
                        disable={mutation.isPending}
                    >
                        {t('endDate.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        onClick={() => mutation.mutate()}
                        disable={!canSubmit}
                    >
                        {mutation.isPending ? t('endDate.saving') : t('endDate.submit')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
