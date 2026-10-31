import { CheckCircle, DownloadSimple } from '@phosphor-icons/react';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { AllocatePaymentResponse, ReceiptLineItem } from '@/services/manage-finances';
import { useTheme } from '@/providers/theme/theme-provider';
import { cn } from '@/lib/utils';

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
    PAID: { bg: 'bg-success-50', text: 'text-success-700' },
    PARTIAL_PAID: { bg: 'bg-warning-50', text: 'text-warning-700' },
    PENDING: { bg: 'bg-neutral-100', text: 'text-neutral-600' },
    OVERDUE: { bg: 'bg-danger-50', text: 'text-danger-700' },
};

interface PaymentSuccessStepProps {
    studentName: string;
    receipt?: AllocatePaymentResponse;
    onPayAnother: () => void;
}

export function PaymentSuccessStep({
    studentName,
    receipt,
    onPayAnother,
}: PaymentSuccessStepProps) {
    const { t } = useTranslation('financialManagementPaymentSuccessStep');
    const { getPrimaryColorCode } = useTheme();
    const hasReceipt = receipt && receipt.invoice_id;
    const totalConcession = receipt?.total_concession ?? 0;
    const totalPenalty = receipt?.total_penalty ?? 0;
    const hasAnyAdjustment =
        (receipt?.line_items ?? []).some((item) => item.adjustment_status === 'APPROVED') ||
        totalConcession > 0 ||
        totalPenalty > 0;

    return (
        <div className="space-y-4">
            {/* Success banner */}
            <div className="rounded-xl border border-neutral-100 bg-white p-8 text-center shadow-sm">
                <div className="mb-3 flex justify-center">
                    <CheckCircle size={56} weight="duotone" className="text-success-500" />
                </div>
                <h2 className="text-xl font-bold text-neutral-800">{t('paymentSubmitted')}</h2>
                <p className="mt-1 text-neutral-500">
                    {t('paymentRecordedFor')}{' '}
                    <span className="font-semibold text-neutral-700">{studentName}</span>.
                </p>
                {!hasReceipt && (
                    <p className="mt-1 text-sm text-neutral-400">{t('receiptWillBeGenerated')}</p>
                )}
            </div>

            {/* Receipt card */}
            {hasReceipt && (
                <div className="overflow-hidden rounded-xl border border-neutral-100 bg-white shadow-sm">
                    {/* Receipt header */}
                    <div className="flex items-start justify-between border-b border-neutral-100 bg-neutral-50/60 px-6 py-4">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                                {t('receipt.receiptNo')}
                            </p>
                            <p className="mt-0.5 text-base font-normal text-neutral-800">
                                {receipt.receipt_number}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                                {t('receipt.date')}
                            </p>
                            <p className="mt-0.5 text-sm font-semibold text-neutral-700">
                                {receipt.receipt_date
                                    ? dayjs(receipt.receipt_date).format('DD MMM YYYY')
                                    : '—'}
                            </p>
                        </div>
                    </div>

                    {/* Meta row */}
                    <div className="flex flex-wrap gap-x-8 gap-y-1 border-b border-neutral-100 px-6 py-3 text-sm">
                        <div>
                            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                                {t('receipt.studentLabel')}{' '}
                            </span>
                            <span className="text-lg font-extrabold text-neutral-800">
                                {studentName}
                            </span>
                        </div>
                        {receipt.payment_mode && (
                            <div>
                                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                                    {t('receipt.modeLabel')}{' '}
                                </span>
                                <span className="text-lg font-extrabold text-neutral-800">
                                    {receipt.payment_mode}
                                </span>
                            </div>
                        )}
                        {receipt.transaction_id && (
                            <div>
                                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                                    {t('receipt.txnIdLabel')}{' '}
                                </span>
                                <span className="text-lg font-extrabold text-neutral-800">
                                    {receipt.transaction_id}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Line items table */}
                    {receipt.line_items && receipt.line_items.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-left text-sm">
                                <thead>
                                    <tr className="border-b border-neutral-100 bg-neutral-50/80">
                                        <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            #
                                        </th>
                                        <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.feeType')}
                                        </th>
                                        <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.dueDate')}
                                        </th>
                                        <th className="px-4 py-2.5 text-right text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.expected')}
                                        </th>
                                        {hasAnyAdjustment && (
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
                                            {t('table.status')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-50">
                                    {receipt.line_items.map(
                                        (item: ReceiptLineItem, idx: number) => {
                                            const style =
                                                STATUS_STYLES[item.status] ||
                                                STATUS_STYLES['PENDING']!;
                                            const isApprovedAdj =
                                                item.adjustment_status === 'APPROVED';
                                            const isConcession =
                                                isApprovedAdj &&
                                                item.adjustment_type === 'CONCESSION';
                                            const isPenalty =
                                                isApprovedAdj && item.adjustment_type === 'PENALTY';
                                            return (
                                                <tr key={idx} className="hover:bg-neutral-50/40">
                                                    <td className="px-4 py-2.5 font-medium text-neutral-400">
                                                        {idx + 1}
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        <p className="font-semibold text-neutral-800">
                                                            {item.fee_type_name || '—'}
                                                        </p>
                                                        {item.cpo_name && (
                                                            <p className="mt-0.5 text-xs text-neutral-400">
                                                                {item.cpo_name}
                                                            </p>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-neutral-600">
                                                        {item.due_date
                                                            ? dayjs(item.due_date).format(
                                                                  'DD MMM YYYY'
                                                              )
                                                            : '—'}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right text-neutral-700">
                                                        {formatCurrency(item.amount_expected)}
                                                    </td>
                                                    {hasAnyAdjustment && (
                                                        <td className="px-4 py-2.5 text-right">
                                                            {isConcession ? (
                                                                <span
                                                                    className={cn(
                                                                        'text-xs font-semibold text-success-600'
                                                                    )}
                                                                >
                                                                    -{' '}
                                                                    {formatCurrency(
                                                                        item.adjustment_amount || 0
                                                                    )}{' '}
                                                                    <span className="font-normal">
                                                                        (
                                                                        {t(
                                                                            'adjustmentType.concession'
                                                                        )}
                                                                        )
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
                                                                        item.adjustment_amount || 0
                                                                    )}{' '}
                                                                    <span className="font-normal">
                                                                        (
                                                                        {t(
                                                                            'adjustmentType.penalty'
                                                                        )}
                                                                        )
                                                                    </span>
                                                                </span>
                                                            ) : (
                                                                <span className="text-neutral-400">
                                                                    —
                                                                </span>
                                                            )}
                                                        </td>
                                                    )}
                                                    <td className="px-4 py-2.5 text-right font-semibold text-success-700">
                                                        {formatCurrency(item.amount_paid)}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right font-semibold text-danger-600">
                                                        {item.balance > 0
                                                            ? formatCurrency(item.balance)
                                                            : '—'}
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        <span
                                                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold uppercase tracking-wide ${style.bg} ${style.text}`}
                                                        >
                                                            {item.status.replace('_', ' ')}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        }
                                    )}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-neutral-200 bg-neutral-50/60">
                                        <td colSpan={3} />
                                        <td className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-neutral-500">
                                            {t('totals.totalExpected')}
                                        </td>
                                        {hasAnyAdjustment && <td />}
                                        <td className="px-4 py-3 text-right text-sm font-bold text-neutral-800">
                                            {formatCurrency(receipt.total_expected ?? 0)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-sm font-bold text-neutral-800">
                                            {formatCurrency(receipt.balance_due ?? 0)}
                                        </td>
                                        <td />
                                    </tr>
                                    <tr className="bg-neutral-50/60">
                                        <td colSpan={3} />
                                        <td className="px-4 py-1 text-right text-xs font-bold uppercase tracking-wide text-neutral-500">
                                            {t('totals.totalPaid')}
                                        </td>
                                        {hasAnyAdjustment && <td />}
                                        <td
                                            className="px-4 py-1 text-right text-sm font-bold text-success-700"
                                            colSpan={2}
                                        >
                                            {formatCurrency(receipt.total_paid ?? 0)}
                                        </td>
                                        <td />
                                    </tr>
                                    {totalConcession > 0 && (
                                        <tr className="bg-neutral-50/60">
                                            <td colSpan={3} />
                                            <td className="px-4 py-1 text-right text-xs font-bold uppercase tracking-wide text-neutral-500">
                                                {t('totals.totalConcession')}
                                            </td>
                                            {hasAnyAdjustment && <td />}
                                            <td
                                                className="px-4 py-1 text-right text-sm font-bold text-success-600"
                                                colSpan={2}
                                            >
                                                - {formatCurrency(totalConcession)}
                                            </td>
                                            <td />
                                        </tr>
                                    )}
                                    {totalPenalty > 0 && (
                                        <tr className="bg-neutral-50/60">
                                            <td colSpan={3} />
                                            <td className="px-4 py-1 text-right text-xs font-bold uppercase tracking-wide text-neutral-500">
                                                {t('totals.totalPenalty')}
                                            </td>
                                            {hasAnyAdjustment && <td />}
                                            <td
                                                className="px-4 py-1 text-right text-sm font-bold text-danger-600"
                                                colSpan={2}
                                            >
                                                + {formatCurrency(totalPenalty)}
                                            </td>
                                            <td />
                                        </tr>
                                    )}
                                </tfoot>
                            </table>
                        </div>
                    )}

                    {/* Amount paid now highlight */}
                    {receipt.amount_paid_now != null && (
                        <div className="flex justify-end border-t border-neutral-100 px-6 py-3">
                            <div className="text-right">
                                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                                    {t('amountPaidNow')}
                                </p>
                                <p className="mt-0.5 text-xl font-extrabold text-success-600">
                                    {formatCurrency(receipt.amount_paid_now)}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3">
                {receipt?.download_url && (
                    <a
                        href={receipt.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800"
                    >
                        <DownloadSimple size={15} weight="bold" />
                        {t('downloadReceipt')}
                    </a>
                )}
                <button
                    onClick={onPayAnother}
                    style={{ backgroundColor: getPrimaryColorCode() }}
                    className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors"
                >
                    {t('payForAnotherStudent')}
                </button>
            </div>
        </div>
    );
}
