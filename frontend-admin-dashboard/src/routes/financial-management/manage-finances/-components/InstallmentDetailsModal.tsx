import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
    fetchInstallmentDetails,
    getInstallmentDetailsQueryKey,
} from '@/services/manage-finances';
import { InstallmentDetailDTO } from '@/types/manage-finances';

interface InstallmentDetailsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    studentId: string;
    cpoId: string;
    studentName: string;
    cpoName: string;
}

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
    PAID: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    OVERDUE: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
    PARTIAL: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
    PENDING: { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' },
};

function StatusPill({ status }: { status: string }) {
    const style = STATUS_STYLES[status] || STATUS_STYLES['PENDING']!;
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style.bg} ${style.text}`}
        >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
            {status}
        </span>
    );
}

export function InstallmentDetailsModal({
    open,
    onOpenChange,
    studentId,
    cpoId,
    studentName,
    cpoName,
}: InstallmentDetailsModalProps) {
    const { t } = useTranslation('financialManagementInstallmentDetailsModal');
    const { data, isLoading, error } = useQuery({
        queryKey: getInstallmentDetailsQueryKey(studentId, cpoId),
        queryFn: () => fetchInstallmentDetails(studentId, cpoId),
        enabled: open && !!studentId && !!cpoId,
        staleTime: 30000,
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[820px] max-w-[95vw] max-h-[85vh] overflow-hidden flex flex-col rounded-xl p-0">
                {/* Header */}
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-gray-100">
                    <DialogTitle className="text-lg font-bold text-gray-800">
                        {t('installmentDetails')}
                    </DialogTitle>
                    <DialogDescription className="mt-1 text-sm text-gray-500">
                        <span className="font-semibold text-gray-700">{studentName}</span>
                        {cpoName && (
                            <>
                                {' · '}
                                <span className="text-gray-500">{cpoName}</span>
                            </>
                        )}
                    </DialogDescription>
                </DialogHeader>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {isLoading && (
                        <div className="flex h-40 items-center justify-center">
                            <DashboardLoader />
                        </div>
                    )}

                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
                            <p className="text-sm font-medium text-red-800">
                                {t('errors.unableToLoad')}
                            </p>
                        </div>
                    )}

                    {data && data.length === 0 && (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
                            <p className="text-sm font-medium text-gray-600">
                                {t('empty.noInstallmentsFound')}
                            </p>
                        </div>
                    )}

                    {data && data.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                            <table className="w-full text-left border-collapse min-w-[700px]">
                                <thead>
                                    <tr className="border-b-2 border-gray-200 bg-gray-50/80">
                                        <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                            {t('table.feeType')}
                                        </th>
                                        <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                            {t('table.instNumber')}
                                        </th>
                                        <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                            {t('table.expected')}
                                        </th>
                                        <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                            {t('table.discount')}
                                        </th>
                                        <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                            {t('table.paid')}
                                        </th>
                                        <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                            {t('table.due')}
                                        </th>
                                        <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                            {t('table.dueDate')}
                                        </th>
                                        <th className="py-3 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                            {t('table.status')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-sm font-medium">
                                    {data.map((inst: InstallmentDetailDTO, i: number) => (
                                        <tr
                                            key={i}
                                            className="hover:bg-gray-50/60 transition-colors"
                                        >
                                            <td className="py-3 px-4 text-gray-800 font-semibold">
                                                {inst.fee_type_name}
                                            </td>
                                            <td className="py-3 px-4 text-gray-600">
                                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-50 text-blue-700 text-xs font-bold">
                                                    {inst.installment_number}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-gray-700">
                                                {formatCurrency(inst.amount_expected)}
                                            </td>
                                            <td className="py-3 px-4 text-gray-500">
                                                {inst.adjustment_amount > 0
                                                    ? `${inst.adjustment_type === 'PENALTY' ? '+' : '-'}${formatCurrency(inst.adjustment_amount)}`
                                                    : '—'}
                                            </td>
                                            <td className="py-3 px-4 text-emerald-700 font-semibold">
                                                {formatCurrency(inst.amount_paid)}
                                            </td>
                                            <td className="py-3 px-4 text-red-600 font-semibold">
                                                {inst.due_amount > 0
                                                    ? formatCurrency(inst.due_amount)
                                                    : '—'}
                                            </td>
                                            <td className="py-3 px-4 text-gray-600">
                                                {inst.due_date
                                                    ? dayjs(inst.due_date).format(
                                                          'D MMM YYYY, h:mm a'
                                                      )
                                                    : '—'}
                                            </td>
                                            <td className="py-3 px-4">
                                                <StatusPill status={inst.status} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
