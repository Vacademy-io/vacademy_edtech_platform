import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { StudentFeePaymentRowDTO, StudentFeeDueDTO } from '@/types/manage-finances';
import { allocateSelectedPayment, AllocatePaymentResponse, getStudentDuesQueryKey } from '@/services/manage-finances';
import { getInstituteId } from '@/constants/helper';
import { cn } from '@/lib/utils';
import { ConfirmPaymentDialog } from './ConfirmPaymentDialog';
import { OfflinePaymentFields } from '@/components/common/payments/OfflinePaymentFields';
import {
    findActiveMode,
    toOfflinePaymentDetailsPayload,
    useOfflinePaymentModes,
    type OfflinePaymentDetails,
} from '@/services/offline-payment-modes';

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

// ─── Component ──────────────────────────────────────────────────────────────

interface PaymentDetailsStepProps {
    student: StudentFeePaymentRowDTO;
    selectedDues: StudentFeeDueDTO[];
    onBack: () => void;
    onSuccess: (amount: number, receipt?: AllocatePaymentResponse) => void;
}

export function PaymentDetailsStep({
    student,
    selectedDues,
    onBack,
    onSuccess,
}: PaymentDetailsStepProps) {
    const queryClient = useQueryClient();
    const { t } = useTranslation('financialManagementPaymentDetailsStep');
    // How it was paid: the institute's offline payment modes (Settings → Payment Settings).
    const { data: offlineModes } = useOfflinePaymentModes();
    const [details, setDetails] = useState<OfflinePaymentDetails>({});
    const [detailsError, setDetailsError] = useState<string | null>(null);
    const mode = findActiveMode(offlineModes, details.mode);
    const modeLabel = mode
        ? [mode.label, mode.sub_modes?.find((s) => s.code === details.sub_mode)?.label].filter(Boolean).join(' · ')
        : '';
    const transactionId = details.reference ?? '';
    const [amount, setAmount] = useState('');
    const [remarks, setRemarks] = useState('');
    const [showConfirm, setShowConfirm] = useState(false);

    const totalDue = useMemo(
        () => selectedDues.reduce((sum, d) => sum + d.amount_due, 0),
        [selectedDues]
    );

    const { totalConcession, totalPenalty, showAdjustmentColumn } = useMemo(() => {
        let concession = 0;
        let penalty = 0;
        let hasAdjustment = false;
        for (const d of selectedDues) {
            if (d.adjustment_status === 'APPROVED') {
                hasAdjustment = true;
                if (d.adjustment_type === 'CONCESSION') concession += d.adjustment_amount || 0;
                else if (d.adjustment_type === 'PENALTY') penalty += d.adjustment_amount || 0;
            }
        }
        return { totalConcession: concession, totalPenalty: penalty, showAdjustmentColumn: hasAdjustment };
    }, [selectedDues]);

    const handleAmountChange = (value: string) => {
        if (value === '' || /^\d*\.?\d*$/.test(value)) {
            setAmount(value);
        }
    };

    const parsedAmount = parseFloat(amount) || 0;

    const mutation = useMutation<AllocatePaymentResponse, unknown>({
        mutationFn: () => {
            const instituteId = getInstituteId();
            if (!instituteId) throw new Error(t('errors.instituteIdNotFound'));

            // The remarks text stays as before for the allocation ledger and older receipts;
            // the structured details travel in payment_details.
            const remarkParts: string[] = [];
            if (modeLabel) remarkParts.push(`${t('remarks.modePrefix')}: ${modeLabel}`);
            if (transactionId.trim()) remarkParts.push(`${t('remarks.txnIdPrefix')}: ${transactionId.trim()}`);
            if (remarks.trim()) remarkParts.push(remarks.trim());

            return allocateSelectedPayment(student.student_id, {
                institute_id: instituteId,
                student_fee_payment_ids: selectedDues.map((d) => d.id),
                amount: parsedAmount,
                remarks: remarkParts.join(' | '),
                payment_details: toOfflinePaymentDetailsPayload(details),
            });
        },
        onSuccess: (data) => {
            toast.success(t('toast.paymentSubmitted'));
            queryClient.invalidateQueries({
                queryKey: getStudentDuesQueryKey(student.student_id),
            });
            onSuccess(parsedAmount, data);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.ex || err?.message || t('toast.paymentFailed'));
        },
    });

    const handleSubmit = () => {
        if (parsedAmount <= 0) return;
        setShowConfirm(true);
    };

    const handleConfirm = () => {
        setShowConfirm(false);
        mutation.mutate();
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4 rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-primary-600"
                >
                    <ArrowLeft size={16} />
                    {t('backToInstallments')}
                </button>
                <div className="h-5 w-px bg-neutral-200" />
                <div>
                    <span className="font-semibold text-neutral-800">{student.student_name}</span>
                    {student.phone && (
                        <span className="ml-2 text-sm text-neutral-400">{student.phone}</span>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* ── Left: Receipt Preview ── */}
                <div className="overflow-hidden rounded-xl border border-neutral-100 bg-white shadow-sm lg:col-span-2">
                    <div className="border-b border-neutral-100 bg-neutral-50/60 px-6 py-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-700">
                            {t('selectedInstallments', { count: selectedDues.length })}
                        </h3>
                    </div>
                    <div className="max-h-96 overflow-auto">
                        <table className="w-full border-collapse text-left">
                            <thead className="sticky top-0 z-10">
                                <tr className="border-b border-neutral-200 bg-neutral-50/95">
                                    <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                        {t('table.feeType')}
                                    </th>
                                    <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                        {t('table.cpoPlan')}
                                    </th>
                                    <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                        {t('table.expected')}
                                    </th>
                                    {showAdjustmentColumn && (
                                        <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.adjustment')}
                                        </th>
                                    )}
                                    <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                        {t('table.paid')}
                                    </th>
                                    <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                        {t('table.outstanding')}
                                    </th>
                                    <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                        {t('table.dueDate')}
                                    </th>
                                    <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                        {t('table.status')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100 text-sm font-medium">
                                {selectedDues.map((inst) => {
                                    const approvedAdj = inst.adjustment_status === 'APPROVED';
                                    const isConcession = approvedAdj && inst.adjustment_type === 'CONCESSION';
                                    const isPenalty = approvedAdj && inst.adjustment_type === 'PENALTY';
                                    return (
                                        <tr key={inst.id} className="hover:bg-neutral-50/40">
                                            <td className="px-4 py-2.5 font-semibold text-neutral-800">
                                                {inst.fee_type_name}
                                            </td>
                                            <td className="px-4 py-2.5 text-neutral-600">
                                                {inst.cpo_name || '\u2014'}
                                            </td>
                                            <td className="px-4 py-2.5 text-right text-neutral-700">
                                                {formatCurrency(inst.amount_expected)}
                                            </td>
                                            {showAdjustmentColumn && (
                                                <td className="px-4 py-2.5 text-right">
                                                    {isConcession ? (
                                                        <span
                                                            className={cn(
                                                                'text-xs font-semibold text-success-600'
                                                            )}
                                                        >
                                                            -{' '}
                                                            {formatCurrency(
                                                                inst.adjustment_amount || 0
                                                            )}{' '}
                                                            <span className="font-normal">
                                                                ({t('adjustmentType.concession')})
                                                            </span>
                                                        </span>
                                                    ) : isPenalty ? (
                                                        <span
                                                            className={cn(
                                                                'text-xs font-semibold text-danger-600'
                                                            )}
                                                        >
                                                            +{' '}
                                                            {formatCurrency(
                                                                inst.adjustment_amount || 0
                                                            )}{' '}
                                                            <span className="font-normal">
                                                                ({t('adjustmentType.penalty')})
                                                            </span>
                                                        </span>
                                                    ) : (
                                                        <span className="text-neutral-400">
                                                            {'\u2014'}
                                                        </span>
                                                    )}
                                                </td>
                                            )}
                                            <td className="px-4 py-2.5 text-right font-semibold text-success-700">
                                                {formatCurrency(inst.amount_paid)}
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-semibold text-danger-600">
                                                {formatCurrency(inst.amount_due)}
                                            </td>
                                            <td className="px-4 py-2.5 text-neutral-600">
                                                {inst.due_date
                                                    ? dayjs(inst.due_date).format('D MMM YYYY')
                                                    : '\u2014'}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                {inst.is_overdue ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-caption font-semibold uppercase text-danger-700">
                                                        <span className="size-1.5 rounded-full bg-danger-500" />
                                                        {t('status.overdue')}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-caption font-semibold uppercase text-warning-700">
                                                        <span className="size-1.5 rounded-full bg-warning-500" />
                                                        {inst.status === 'PARTIAL_PAID'
                                                            ? t('status.partial')
                                                            : t('status.pending')}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                {showAdjustmentColumn && totalConcession > 0 && (
                                    <tr className="bg-neutral-50/40">
                                        <td
                                            colSpan={3}
                                            className="px-4 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500"
                                        >
                                            {t('totals.totalConcession')}
                                        </td>
                                        <td className="px-4 py-1.5 text-right text-sm font-semibold text-success-600">
                                            - {formatCurrency(totalConcession)}
                                        </td>
                                        <td colSpan={4} />
                                    </tr>
                                )}
                                {showAdjustmentColumn && totalPenalty > 0 && (
                                    <tr className="bg-neutral-50/40">
                                        <td
                                            colSpan={3}
                                            className="px-4 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500"
                                        >
                                            {t('totals.totalPenalty')}
                                        </td>
                                        <td className="px-4 py-1.5 text-right text-sm font-semibold text-danger-600">
                                            + {formatCurrency(totalPenalty)}
                                        </td>
                                        <td colSpan={4} />
                                    </tr>
                                )}
                                <tr className="border-t-2 border-neutral-200 bg-neutral-50/60">
                                    <td
                                        colSpan={showAdjustmentColumn ? 5 : 4}
                                        className="px-4 py-3 text-right text-sm font-bold text-neutral-700"
                                    >
                                        {t('totals.totalOutstanding')}
                                    </td>
                                    <td className="px-4 py-3 text-right text-base font-extrabold text-danger-600">
                                        {formatCurrency(totalDue)}
                                    </td>
                                    <td colSpan={2} />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

                {/* ── Right: Payment Form ── */}
                <div className="h-fit space-y-5 rounded-xl border border-neutral-100 bg-white p-6 shadow-sm">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-700">
                        {t('paymentDetails')}
                    </h3>

                    {/* How it was paid: mode, option (e.g. PhonePe), reference, proof. */}
                    <OfflinePaymentFields
                        value={details}
                        onChange={setDetails}
                        onErrorChange={setDetailsError}
                        showDate
                        numbering={{
                            userPlanId: selectedDues[0]?.user_plan_id ?? null,
                            userId: student.student_id,
                        }}
                    />

                    {/* Amount */}
                    <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {t('amount')}
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-neutral-400">
                                {'\u20B9'}
                            </span>
                            <Input
                                value={amount}
                                onChange={(e) => handleAmountChange(e.target.value)}
                                placeholder={totalDue.toString()}
                                className="pl-7 text-sm font-semibold"
                            />
                        </div>
                        {parsedAmount > totalDue && (
                            <p className="text-xs text-warning-600">{t('amountExceedsDue')}</p>
                        )}
                    </div>

                    {/* Remarks */}
                    <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {t('remarksLabel')}{' '}
                            <span className="normal-case text-neutral-400">({t('optional')})</span>
                        </label>
                        <Input
                            value={remarks}
                            onChange={(e) => setRemarks(e.target.value)}
                            placeholder={t('placeholders.remarks')}
                            className="text-sm"
                        />
                    </div>

                    {/* Submit */}
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="large"
                        className="w-full"
                        onClick={handleSubmit}
                        disable={parsedAmount <= 0 || mutation.isPending || !!detailsError}
                    >
                        <CheckCircle size={18} weight="bold" className="mr-1.5" />
                        {mutation.isPending ? t('processing') : `${t('submitPayment')} \u2014 ${formatCurrency(parsedAmount || 0)}`}
                    </MyButton>
                </div>
            </div>

            <ConfirmPaymentDialog
                open={showConfirm}
                onOpenChange={setShowConfirm}
                studentName={student.student_name}
                amount={parsedAmount}
                installmentCount={selectedDues.length}
                paymentMode={modeLabel}
                transactionId={transactionId.trim() || undefined}
                isSubmitting={mutation.isPending}
                onConfirm={handleConfirm}
            />
        </div>
    );
}
