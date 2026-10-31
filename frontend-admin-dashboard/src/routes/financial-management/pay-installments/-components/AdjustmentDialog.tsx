import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { CaretDown, CaretLeft, CaretRight } from '@phosphor-icons/react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { StudentFeeDueDTO, AdjustmentHistoryDTO } from '@/types/manage-finances';
import {
    submitAdjustment,
    retractAdjustment,
    getStudentDuesQueryKey,
    fetchAdjustmentHistory,
    getAdjustmentHistoryQueryKey,
} from '@/services/manage-finances';
import { cn } from '@/lib/utils';

interface AdjustmentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    installment: StudentFeeDueDTO;
    studentId: string;
}

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

const ADJ_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
    PENDING_FOR_APPROVAL: { bg: 'bg-amber-100', text: 'text-amber-800' },
    APPROVED: { bg: 'bg-emerald-100', text: 'text-emerald-800' },
    REJECTED: { bg: 'bg-red-100', text: 'text-red-800' },
};

export function AdjustmentDialog({
    open,
    onOpenChange,
    installment,
    studentId,
}: AdjustmentDialogProps) {
    const { t } = useTranslation('financialManagementAdjustmentDialog');
    const queryClient = useQueryClient();
    const [selectedType, setSelectedType] = useState<'CONCESSION' | 'PENALTY' | null>(null);
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');

    const hasExistingAdjustment =
        installment.adjustment_status !== null && installment.adjustment_status !== undefined;

    // ── Adjustment history (paginated, 20 per page) ─────────────────────────
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyPage, setHistoryPage] = useState(0);
    const HISTORY_SIZE = 20;

    const { data: historyData, isLoading: isHistoryLoading } = useQuery({
        queryKey: getAdjustmentHistoryQueryKey(installment.id, historyPage, HISTORY_SIZE),
        queryFn: () => fetchAdjustmentHistory(installment.id, historyPage, HISTORY_SIZE),
        enabled: open && historyOpen,
        staleTime: 10000,
        placeholderData: keepPreviousData,
    });

    const submitMutation = useMutation({
        mutationFn: () =>
            submitAdjustment({
                student_fee_payment_id: installment.id,
                user_id: studentId,
                adjustment_amount: Number(amount),
                adjustment_type: selectedType!,
                adjustment_reason: reason || undefined,
            }),
        onSuccess: () => {
            const msg =
                selectedType === 'PENALTY'
                    ? t('toast.penaltyApplied')
                    : t('toast.concessionSubmitted');
            toast.success(msg);
            queryClient.invalidateQueries({ queryKey: getStudentDuesQueryKey(studentId) });
            handleClose();
        },
        onError: (err: any) => {
            toast.error(
                err?.response?.data?.ex || err?.message || t('toast.submitFailed')
            );
        },
    });

    const retractMutation = useMutation({
        mutationFn: () =>
            retractAdjustment({ student_fee_payment_id: installment.id }),
        onSuccess: () => {
            toast.success(t('toast.retracted'));
            queryClient.invalidateQueries({ queryKey: getStudentDuesQueryKey(studentId) });
            handleClose();
        },
        onError: (err: any) => {
            toast.error(
                err?.response?.data?.ex || err?.message || t('toast.retractFailed')
            );
        },
    });

    const handleClose = () => {
        setSelectedType(null);
        setAmount('');
        setReason('');
        onOpenChange(false);
    };

    const handleSubmit = () => {
        const amt = Number(amount);
        if (!selectedType) {
            toast.error(t('toast.selectType'));
            return;
        }
        if (!amount || isNaN(amt) || amt <= 0) {
            toast.error(t('toast.invalidAmount'));
            return;
        }
        if (selectedType === 'CONCESSION' && amt > installment.amount_expected) {
            toast.error(t('toast.exceedsExpected'));
            return;
        }
        submitMutation.mutate();
    };

    const isPending = submitMutation.isPending || retractMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                </DialogHeader>

                {/* Installment summary */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
                    <div className="flex justify-between">
                        <span className="text-gray-500">{t('summary.feeType')}</span>
                        <span className="font-medium">{installment.fee_type_name}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">{t('summary.expected')}</span>
                        <span className="font-medium">
                            {formatCurrency(installment.amount_expected)}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">{t('summary.paid')}</span>
                        <span className="font-medium text-emerald-700">
                            {formatCurrency(installment.amount_paid)}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">{t('summary.due')}</span>
                        <span className="font-medium text-red-600">
                            {formatCurrency(installment.amount_due)}
                        </span>
                    </div>
                </div>

                {/* Existing adjustment info */}
                {hasExistingAdjustment && (
                    <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="font-semibold text-gray-700">
                                {t('current.heading')}
                            </span>
                            <span
                                className={cn(
                                    'rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase',
                                    ADJ_STATUS_STYLES[installment.adjustment_status ?? '']?.bg ??
                                        'bg-gray-100',
                                    ADJ_STATUS_STYLES[installment.adjustment_status ?? '']
                                        ?.text ?? 'text-gray-600'
                                )}
                            >
                                {installment.adjustment_status?.replace(/_/g, ' ')}
                            </span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                            <span>
                                {installment.adjustment_type === 'PENALTY'
                                    ? t('type.penalty')
                                    : t('type.concession')}
                            </span>
                            <span className="font-medium">
                                {formatCurrency(installment.adjustment_amount)}
                            </span>
                        </div>
                        {installment.adjustment_reason && (
                            <div className="text-gray-500 text-xs">
                                {t('reasonPrefix', { reason: installment.adjustment_reason })}
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => retractMutation.mutate()}
                            disabled={isPending}
                            className="w-full mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                            {t('actions.retract')}
                        </button>
                    </div>
                )}

                {/* New adjustment form - only show if no existing adjustment */}
                {!hasExistingAdjustment && (
                    <div className="space-y-4">
                        {/* Type selection - side by side */}
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => setSelectedType('CONCESSION')}
                                className={cn(
                                    'rounded-lg border-2 p-3 text-center transition-all',
                                    selectedType === 'CONCESSION'
                                        ? 'border-emerald-500 bg-emerald-50'
                                        : 'border-gray-200 hover:border-gray-300'
                                )}
                            >
                                <div className="text-sm font-semibold text-emerald-700">
                                    {t('type.concession')}
                                </div>
                                <div className="text-[11px] text-gray-500 mt-0.5">
                                    {t('form.concessionHint')}
                                </div>
                                <div className="text-[10px] text-amber-600 mt-1 font-medium">
                                    {t('form.concessionApproval')}
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelectedType('PENALTY')}
                                className={cn(
                                    'rounded-lg border-2 p-3 text-center transition-all',
                                    selectedType === 'PENALTY'
                                        ? 'border-red-500 bg-red-50'
                                        : 'border-gray-200 hover:border-gray-300'
                                )}
                            >
                                <div className="text-sm font-semibold text-red-700">
                                    {t('type.penalty')}
                                </div>
                                <div className="text-[11px] text-gray-500 mt-0.5">
                                    {t('form.penaltyHint')}
                                </div>
                                <div className="text-[10px] text-emerald-600 mt-1 font-medium">
                                    {t('form.penaltyInstant')}
                                </div>
                            </button>
                        </div>

                        {/* Amount & Reason */}
                        {selectedType && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        {t('form.amountLabel')}
                                    </label>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        min={0}
                                        step={1}
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        placeholder={t('form.amountPlaceholder')}
                                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        {t('form.reasonLabel')}
                                    </label>
                                    <input
                                        type="text"
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        placeholder={
                                            selectedType === 'CONCESSION'
                                                ? t('form.reasonPlaceholderConcession')
                                                : t('form.reasonPlaceholderPenalty')
                                        }
                                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={isPending}
                                    className={cn(
                                        'w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50',
                                        selectedType === 'CONCESSION'
                                            ? 'bg-emerald-600 hover:bg-emerald-700'
                                            : 'bg-red-600 hover:bg-red-700'
                                    )}
                                >
                                    {isPending
                                        ? t('actions.submitting')
                                        : selectedType === 'PENALTY'
                                          ? t('actions.submitPenalty')
                                          : t('actions.submitConcession')}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Adjustment history — collapsible, paginated 20/page */}
                <div className="rounded-lg border border-gray-200 bg-white">
                    <button
                        type="button"
                        onClick={() => setHistoryOpen((v) => !v)}
                        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        <span>{t('history.heading')}</span>
                        <CaretDown
                            size={14}
                            className={cn('transition-transform', historyOpen && 'rotate-180')}
                        />
                    </button>
                    {historyOpen && (
                        <div className="border-t border-gray-100 px-3 py-2 space-y-2">
                            {isHistoryLoading && !historyData && (
                                <p className="text-xs text-gray-400 text-center py-4">
                                    {t('history.loading')}
                                </p>
                            )}
                            {historyData && historyData.content.length === 0 && (
                                <p className="text-xs text-gray-400 text-center py-4">
                                    {t('history.empty')}
                                </p>
                            )}
                            {historyData && historyData.content.length > 0 && (
                                <>
                                    <ul className="space-y-2 max-h-64 overflow-y-auto">
                                        {historyData.content.map((evt: AdjustmentHistoryDTO) => (
                                            <li
                                                key={evt.id}
                                                className="rounded border border-gray-100 bg-gray-50 p-2 text-xs"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span
                                                        className={cn(
                                                            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                                                            evt.event_type === 'SUBMITTED' &&
                                                                'bg-blue-100 text-blue-700',
                                                            evt.event_type === 'APPROVED' &&
                                                                'bg-emerald-100 text-emerald-700',
                                                            evt.event_type === 'REJECTED' &&
                                                                'bg-red-100 text-red-700',
                                                            evt.event_type === 'RETRACTED' &&
                                                                'bg-gray-200 text-gray-700'
                                                        )}
                                                    >
                                                        {evt.event_type}
                                                    </span>
                                                    <span className="text-gray-500">
                                                        {dayjs(evt.created_at).format(
                                                            'DD MMM YYYY, HH:mm'
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="mt-1 flex items-center justify-between text-gray-700">
                                                    <span>
                                                        {evt.adjustment_type === 'PENALTY'
                                                            ? t('type.penalty')
                                                            : t('type.concession')}{' '}
                                                        · {formatCurrency(evt.amount)}
                                                    </span>
                                                    <span className="text-gray-500">
                                                        {t('history.by', {
                                                            actor:
                                                                evt.actor_name ||
                                                                evt.actor_user_id,
                                                        })}
                                                    </span>
                                                </div>
                                                {evt.reason && (
                                                    <div className="mt-1 text-gray-500">
                                                        {t('reasonPrefix', { reason: evt.reason })}
                                                    </div>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                    {(historyData.total_pages ?? historyData.totalPages ?? 1) > 1 && (
                                        <div className="flex items-center justify-between pt-1 text-[11px] text-gray-500">
                                            <span>
                                                {t('history.page', {
                                                    current: historyPage + 1,
                                                    total:
                                                        historyData.total_pages ??
                                                        historyData.totalPages,
                                                })}
                                            </span>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setHistoryPage((p) => Math.max(0, p - 1))
                                                    }
                                                    disabled={historyPage === 0}
                                                    className="rounded border border-gray-200 p-1 disabled:opacity-40"
                                                >
                                                    <CaretLeft size={12} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setHistoryPage((p) => p + 1)}
                                                    disabled={historyData.last}
                                                    className="rounded border border-gray-200 p-1 disabled:opacity-40"
                                                >
                                                    <CaretRight size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
