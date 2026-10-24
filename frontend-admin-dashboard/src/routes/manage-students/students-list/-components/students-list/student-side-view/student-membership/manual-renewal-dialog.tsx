import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Info, Warning } from '@phosphor-icons/react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { OfflinePaymentFields } from '@/components/common/payments/OfflinePaymentFields';
import {
    toOfflinePaymentDetailsPayload,
    type OfflinePaymentDetails,
} from '@/services/offline-payment-modes';
import { getCurrencySymbol } from '@/constants/currencies';
import {
    MANUAL_RENEWAL_PREVIEW_QUERY_KEY,
    PLAN_REMARKS_QUERY_KEY,
    getManualRenewalPreview,
    recordManualRenewal,
} from '@/services/user-plan';
import { PlanRemarksPanel } from './plan-remarks';

interface ManualRenewalDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userPlanId: string | null;
    instituteId: string;
    planLabel?: string;
    /** Called after the renewal lands, so the caller can refresh its plan list. */
    onRenewed: () => void;
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
 * Admin records a renewal the member paid outside the platform (bank transfer, cheque,
 * card over the phone): the membership and its course access come back on until the
 * chosen date, and the admin's remark joins the plan's history for the other admins.
 *
 * <p>Never turns autopay on, and nothing is sent to the member unless the admin ticks it.
 */
export const ManualRenewalDialog = ({
    open,
    onOpenChange,
    userPlanId,
    instituteId,
    planLabel,
    onRenewed,
}: ManualRenewalDialogProps) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const queryClient = useQueryClient();
    const [amount, setAmount] = useState('');
    const [endDate, setEndDate] = useState('');
    const [remarks, setRemarks] = useState('');
    const [details, setDetails] = useState<OfflinePaymentDetails>({});
    const [detailsError, setDetailsError] = useState<string | null>(null);
    const [generateInvoice, setGenerateInvoice] = useState(false);
    const [sendEmail, setSendEmail] = useState(false);

    const {
        data: preview,
        isLoading,
        isError,
    } = useQuery({
        queryKey: [MANUAL_RENEWAL_PREVIEW_QUERY_KEY, userPlanId, instituteId],
        queryFn: () => getManualRenewalPreview(userPlanId as string, instituteId),
        enabled: open && Boolean(userPlanId) && Boolean(instituteId),
    });

    // Reset per-open so nothing carries onto another member.
    useEffect(() => {
        if (!open) return;
        setRemarks('');
        setDetails({});
        setGenerateInvoice(false);
        setSendEmail(false);
    }, [open, userPlanId]);

    useEffect(() => {
        if (!open || !preview) return;
        setAmount(preview.suggested_amount != null ? String(preview.suggested_amount) : '');
        setEndDate(toInputDate(preview.suggested_end_date));
    }, [open, preview]);

    const mutation = useMutation({
        mutationFn: () =>
            recordManualRenewal(userPlanId as string, instituteId, {
                amount: Number(amount),
                currency: preview?.currency || undefined,
                new_end_date: endDate || undefined,
                remarks: remarks.trim(),
                payment_details: toOfflinePaymentDetailsPayload(details),
                generate_invoice: generateInvoice,
                send_email: generateInvoice && sendEmail,
            }),
        onSuccess: (result) => {
            toast.success(
                t('manualRenewal.success', {
                    date: format(new Date(result.new_end_date), 'dd MMM yyyy'),
                })
            );
            queryClient.invalidateQueries({ queryKey: [PLAN_REMARKS_QUERY_KEY, userPlanId] });
            queryClient.invalidateQueries({
                queryKey: [MANUAL_RENEWAL_PREVIEW_QUERY_KEY, userPlanId],
            });
            onRenewed();
            onOpenChange(false);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || err?.message || t('manualRenewal.failed'));
        },
    });

    const amountValue = Number(amount);
    const amountValid = amount.trim() !== '' && Number.isFinite(amountValue) && amountValue >= 0;
    const minEndDate = format(addDays(new Date(), 1), 'yyyy-MM-dd');
    const endDateValid = Boolean(endDate) && endDate >= minEndDate;
    const canSubmit =
        Boolean(preview?.renewable) &&
        amountValid &&
        endDateValid &&
        remarks.trim() !== '' &&
        !detailsError &&
        !mutation.isPending;
    const currency = preview?.currency || 'INR';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-screen max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('manualRenewal.title')}</DialogTitle>
                    {planLabel && <p className="text-sm text-neutral-500">{planLabel}</p>}
                </DialogHeader>

                {isLoading ? (
                    <div className="flex justify-center py-6">
                        <DashboardLoader />
                    </div>
                ) : isError || !preview ? (
                    <p className="text-sm text-danger-600">{t('manualRenewal.loadFailed')}</p>
                ) : !preview.renewable ? (
                    <div className="flex items-start gap-2 rounded-md bg-warning-50 p-3 text-sm text-warning-700 ring-1 ring-warning-200">
                        <Warning className="mt-0.5 size-4 shrink-0" />
                        <span>{preview.not_renewable_reason}</span>
                    </div>
                ) : (
                    <div className="space-y-4 py-1">
                        <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-xs text-info-700 ring-1 ring-info-200">
                            <Info className="mt-0.5 size-4 shrink-0" />
                            <span>
                                {t('manualRenewal.explainer', {
                                    status: preview.status,
                                    date: preview.current_end_date
                                        ? format(new Date(preview.current_end_date), 'dd MMM yyyy')
                                        : '—',
                                })}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label htmlFor="mr-amount">
                                    {t('manualRenewal.amount', {
                                        symbol: getCurrencySymbol(currency),
                                    })}
                                </Label>
                                <Input
                                    id="mr-amount"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="mr-end">{t('manualRenewal.accessUntil')}</Label>
                                <Input
                                    id="mr-end"
                                    type="date"
                                    min={minEndDate}
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                        </div>
                        {preview.validity_days != null && (
                            <p className="-mt-2 text-xs text-neutral-500">
                                {t('manualRenewal.suggestedHint', { days: preview.validity_days })}
                            </p>
                        )}

                        {/* How it was paid: mode, reference, date received, proof. */}
                        <OfflinePaymentFields
                            value={details}
                            onChange={setDetails}
                            onErrorChange={setDetailsError}
                            showDate
                            instituteId={instituteId}
                        />

                        <div className="space-y-1">
                            <Label htmlFor="mr-remarks">
                                {t('manualRenewal.remarks')}{' '}
                                <span className="text-danger-600">*</span>
                            </Label>
                            <Textarea
                                id="mr-remarks"
                                rows={3}
                                value={remarks}
                                onChange={(e) => setRemarks(e.target.value)}
                                placeholder={t('manualRenewal.remarksPlaceholder')}
                                aria-required="true"
                            />
                            <p className="text-xs text-neutral-500">
                                {t('manualRenewal.remarksHint')}
                            </p>
                        </div>

                        <div className="space-y-2 rounded-md border border-neutral-200 p-3">
                            <label className="flex items-center gap-2 text-sm text-neutral-700">
                                <Checkbox
                                    checked={generateInvoice}
                                    disabled={amountValue <= 0}
                                    onCheckedChange={(v) => {
                                        setGenerateInvoice(v === true);
                                        if (v !== true) setSendEmail(false);
                                    }}
                                />
                                {t('manualRenewal.generateInvoice')}
                            </label>
                            <label className="flex items-center gap-2 text-sm text-neutral-700">
                                <Checkbox
                                    checked={sendEmail}
                                    disabled={!generateInvoice}
                                    onCheckedChange={(v) => setSendEmail(v === true)}
                                />
                                {t('manualRenewal.sendEmail')}
                            </label>
                            <p className="text-xs text-neutral-500">
                                {t('manualRenewal.noAutopay')}
                            </p>
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
                )}

                <DialogFooter className="gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => onOpenChange(false)}
                        disable={mutation.isPending}
                    >
                        {t('manualRenewal.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        onClick={() => mutation.mutate()}
                        disable={!canSubmit}
                    >
                        {mutation.isPending ? t('manualRenewal.saving') : t('manualRenewal.submit')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
