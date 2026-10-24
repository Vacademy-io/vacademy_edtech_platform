import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getCurrencySymbol } from '@/constants/currencies';
import { serverErrorMessage } from '@/services/payment-logs';
import { useStopDues } from '@/routes/manage-students/students-list/-services/cpoSideViewService';

const fmt = (n: number, currency?: string | null) => {
    const code = (currency || 'INR').toUpperCase();
    return `${getCurrencySymbol(code)}${n.toLocaleString(code === 'INR' ? 'en-IN' : 'en-US', {
        maximumFractionDigits: 2,
    })}`;
};

interface StopDuesFormProps {
    /** A course installment, or a package installment (with its due date). */
    target: { sfpId: string } | { packageId: string; dueDate: string };
    userId: string;
    currency?: string | null;
    /** Unpaid on this installment, and on the later ones still open. */
    thisAmount: number;
    laterAmount: number;
    laterCount: number;
    /** Package: how many courses a removal takes the learner out of. */
    courseCount?: number;
    onDone: () => void;
}

/**
 * Stop dues for a learner who dropped out or stopped paying: this installment, or it and every
 * later one, stops being owed — no longer due, overdue or reminded. Paid money and receipts stay,
 * and Reopen undoes it. Optionally the learner is also removed from the course(s), which ends
 * their access now.
 */
export const StopDuesForm = ({
    target,
    userId,
    currency,
    thisAmount,
    laterAmount,
    laterCount,
    courseCount,
    onDone,
}: StopDuesFormProps) => {
    const { t } = useTranslation('manageStudentsCpoInstallmentsEditor');
    const isPackage = 'packageId' in target;
    const { mutateAsync, isPending } = useStopDues(
        isPackage ? { packageId: target.packageId } : { sfpId: target.sfpId },
        userId
    );
    const [includeLater, setIncludeLater] = useState(laterCount > 0);
    const [reason, setReason] = useState('');
    const [remove, setRemove] = useState(false);
    const total = Math.round((thisAmount + (includeLater ? laterAmount : 0)) * 100) / 100;

    const submit = async () => {
        if (!reason.trim()) {
            toast.error(t('stopDues.reasonError'));
            return;
        }
        try {
            const result = await mutateAsync({
                reopen: false,
                body: {
                    ...(isPackage ? { due_date: target.dueDate } : {}),
                    include_later: includeLater,
                    reason: reason.trim(),
                    remove_from_course: remove,
                },
            });
            toast.success(
                result.removed_from_courses > 0
                    ? t('stopDues.successRemoved', {
                          amount: fmt(total, currency),
                          count: result.removed_from_courses,
                      })
                    : t('stopDues.success', { amount: fmt(total, currency) })
            );
            if (result.removal_errors && result.removal_errors.length > 0) {
                toast.error(
                    t('stopDues.removalError', { errors: result.removal_errors.join('; ') })
                );
            }
            onDone();
        } catch (e: unknown) {
            toast.error(serverErrorMessage(e) || t('stopDues.error'));
        }
    };

    return (
        <div className="rounded border border-danger-200 bg-danger-50/40 p-2.5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-danger-700">
                {t('stopDues.heading')}
            </p>
            <p className="mb-2 text-2xs text-neutral-600">{t('stopDues.hint')}</p>
            {laterCount > 0 && (
                <div className="mb-2 space-y-1 text-2xs text-neutral-700">
                    <label className="flex items-center gap-1.5">
                        <input
                            type="radio"
                            checked={!includeLater}
                            onChange={() => setIncludeLater(false)}
                            className="size-3.5"
                        />
                        {t('stopDues.onlyThis', { amount: fmt(thisAmount, currency) })}
                    </label>
                    <label className="flex items-center gap-1.5">
                        <input
                            type="radio"
                            checked={includeLater}
                            onChange={() => setIncludeLater(true)}
                            className="size-3.5"
                        />
                        {t('stopDues.thisAndLater', {
                            count: laterCount,
                            amount: fmt(thisAmount + laterAmount, currency),
                        })}
                    </label>
                </div>
            )}
            <label className="block text-2xs text-neutral-500">{t('stopDues.reason')}</label>
            <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('stopDues.reasonPlaceholder')}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs"
            />
            <label className="mt-2 flex items-start gap-1.5 text-2xs text-neutral-700">
                <input
                    type="checkbox"
                    checked={remove}
                    onChange={(e) => setRemove(e.target.checked)}
                    className="mt-0.5 size-3.5"
                />
                <span>
                    {isPackage
                        ? t('stopDues.removePackage', { count: courseCount ?? 0 })
                        : t('stopDues.removeCourse')}
                    {remove && (
                        <span className="block text-danger-700">{t('stopDues.removeWarning')}</span>
                    )}
                </span>
            </label>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button
                    type="button"
                    onClick={onDone}
                    className="rounded border border-neutral-200 bg-white px-3 py-1 text-2xs text-neutral-600 hover:bg-neutral-50"
                >
                    {t('stopDues.cancel')}
                </button>
                <button
                    type="button"
                    disabled={isPending || !reason.trim()}
                    onClick={submit}
                    className="rounded bg-danger-600 px-3 py-1 text-2xs font-semibold text-white hover:bg-danger-700 disabled:opacity-50"
                >
                    {isPending
                        ? t('stopDues.saving')
                        : t('stopDues.submit', { amount: fmt(total, currency) })}
                </button>
            </div>
        </div>
    );
};

/** Reopens what one Stop dues stopped (the learner came back), while they are still enrolled. */
export const ReopenDuesButton = ({
    target,
    userId,
    className,
}: {
    target: { sfpId: string } | { packageId: string; dueDate: string };
    userId: string;
    className: string;
}) => {
    const { t } = useTranslation('manageStudentsCpoInstallmentsEditor');
    const isPackage = 'packageId' in target;
    const { mutateAsync, isPending } = useStopDues(
        isPackage ? { packageId: target.packageId } : { sfpId: target.sfpId },
        userId
    );
    const reopen = async () => {
        try {
            const result = await mutateAsync({
                reopen: true,
                body: isPackage ? { due_date: target.dueDate } : {},
            });
            toast.success(t('stopDues.reopened', { count: result.reopened }));
        } catch (e: unknown) {
            toast.error(serverErrorMessage(e) || t('stopDues.reopenError'));
        }
    };
    return (
        <button type="button" disabled={isPending} onClick={reopen} className={className}>
            {isPending ? t('stopDues.saving') : t('stopDues.reopen')}
        </button>
    );
};
