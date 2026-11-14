import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AdjustmentsSummary } from './AdjustmentsSummary';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { Check, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    fetchPendingAdjustments,
    getPendingAdjustmentsQueryKey,
    reviewAdjustment,
} from '@/services/manage-finances';
import { StudentFeeDueDTO } from '@/types/manage-finances';
import { cn } from '@/lib/utils';

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

export function PendingApprovalsTable() {
    const { t } = useTranslation('financialManagementPendingApprovalsTable');
    const queryClient = useQueryClient();

    const { data: pending, isLoading, error } = useQuery({
        queryKey: getPendingAdjustmentsQueryKey(),
        queryFn: fetchPendingAdjustments,
        refetchInterval: 30000,
    });

    const reviewMutation = useMutation({
        mutationFn: (params: { id: string; action: 'APPROVED' | 'REJECTED' }) =>
            reviewAdjustment({
                student_fee_payment_id: params.id,
                action: params.action,
            }),
        onSuccess: (_data, variables) => {
            toast.success(
                variables.action === 'APPROVED' ? t('toast.approved') : t('toast.rejected')
            );
            queryClient.invalidateQueries({ queryKey: getPendingAdjustmentsQueryKey() });
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.ex || err?.message || t('toast.reviewFailed'));
        },
    });

    if (isLoading) {
        return (
            <div className="flex h-48 items-center justify-center">
                <DashboardLoader />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
                <p className="font-semibold text-red-800">{t('errors.unableToLoad')}</p>
                <p className="mt-2 text-sm text-red-600">
                    {error instanceof Error ? error.message : t('errors.tryAgain')}
                </p>
            </div>
        );
    }

    if (!pending || pending.length === 0) {
        return (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
                <p className="text-lg font-semibold text-gray-600">{t('empty.noPendingApprovals')}</p>
                <p className="mt-2 text-sm text-gray-400">
                    {t('empty.allReviewed')}
                </p>
            </div>
        );
    }

    return (
        <>
            <AdjustmentsSummary items={pending} />
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                        <tr className="border-b-2 border-gray-200 bg-gray-50/95">
                            <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                {t('table.student')}
                            </th>
                            <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                {t('table.feeType')}
                            </th>
                            <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                {t('table.cpoPlan')}
                            </th>
                            <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                {t('table.type')}
                            </th>
                            <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                {t('table.expected')}
                            </th>
                            <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                {t('table.amount')}
                            </th>
                            <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                {t('table.reason')}
                            </th>
                            <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                {t('table.dueDate')}
                            </th>
                            <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                {t('table.actions')}
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm font-medium">
                        {pending.map((item: StudentFeeDueDTO) => {
                            const isPenalty = item.adjustment_type === 'PENALTY';
                            return (
                                <tr
                                    key={item.id}
                                    className={cn(
                                        'transition-colors border-l-4',
                                        isPenalty
                                            ? 'border-l-red-400 hover:bg-red-50/40'
                                            : 'border-l-emerald-400 hover:bg-emerald-50/40'
                                    )}
                                >
                                    <td className="py-3 px-4 text-gray-800 font-semibold">
                                        {item.student_name || item.user_id}
                                    </td>
                                    <td className="py-3 px-4 text-gray-800 font-semibold">
                                        {item.fee_type_name}
                                    </td>
                                    <td className="py-3 px-4 text-gray-600">
                                        {item.cpo_name || '\u2014'}
                                    </td>
                                    <td className="py-3 px-4">
                                        <span
                                            className={cn(
                                                'inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
                                                isPenalty
                                                    ? 'bg-red-100 text-red-800'
                                                    : 'bg-emerald-100 text-emerald-800'
                                            )}
                                        >
                                            {isPenalty ? t('adjustmentType.penalty') : t('adjustmentType.concession')}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 text-gray-700">
                                        {formatCurrency(item.amount_expected)}
                                    </td>
                                    <td
                                        className={cn(
                                            'py-3 px-4 font-semibold',
                                            isPenalty ? 'text-red-700' : 'text-emerald-700'
                                        )}
                                    >
                                        {isPenalty ? '+' : '-'}
                                        {formatCurrency(item.adjustment_amount)}
                                    </td>
                                    <td
                                        className="py-3 px-4 text-gray-500 max-w-[200px] truncate"
                                        title={item.adjustment_reason ?? ''}
                                    >
                                        {item.adjustment_reason || '\u2014'}
                                    </td>
                                    <td className="py-3 px-4 text-gray-600">
                                        {item.due_date
                                            ? dayjs(item.due_date).format('D MMM YYYY')
                                            : '\u2014'}
                                    </td>
                                    <td className="py-3 px-4">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                title={t('actions.approve')}
                                                onClick={() =>
                                                    reviewMutation.mutate({
                                                        id: item.id,
                                                        action: 'APPROVED',
                                                    })
                                                }
                                                disabled={reviewMutation.isPending}
                                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                                            >
                                                <Check size={13} weight="bold" />
                                                {t('actions.approve')}
                                            </button>
                                            <button
                                                type="button"
                                                title={t('actions.reject')}
                                                onClick={() =>
                                                    reviewMutation.mutate({
                                                        id: item.id,
                                                        action: 'REJECTED',
                                                    })
                                                }
                                                disabled={reviewMutation.isPending}
                                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition-colors"
                                            >
                                                <X size={13} weight="bold" />
                                                {t('actions.reject')}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
        </>
    );
}
