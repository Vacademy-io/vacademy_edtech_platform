import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { OfflinePaymentFields } from '@/components/common/payments/OfflinePaymentFields';
import {
    toOfflinePaymentDetailsPayload,
    type OfflinePaymentDetails,
} from '@/services/offline-payment-modes';
import { getCurrencySymbol } from '@/constants/currencies';
import { serverErrorMessage } from '@/services/payment-logs';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    useAdmissionPackagePaymentPreview,
    useChangeAdmissionPackageInstallment,
    useRecordAdmissionPackagePayment,
    useUserAdmissionPackages,
} from '@/routes/manage-students/students-list/-services/cpoSideViewService';
import { ReopenDuesButton, StopDuesForm } from './stop-dues-form';
import type {
    AdmissionPackageInstallment,
    AdmissionPackageSummary,
} from '@/routes/manage-students/students-list/-types/cpo-side-view-types';

/** Money in the package's currency (en-IN grouping only for INR), as the course cards show it. */
const fmt = (n: number | null | undefined, currency?: string | null) => {
    if (!Number.isFinite(n as number)) return '—';
    const code = (currency || 'INR').toUpperCase();
    return `${getCurrencySymbol(code)}${(n as number).toLocaleString(
        code === 'INR' ? 'en-IN' : 'en-US',
        { maximumFractionDigits: 2 }
    )}`;
};

/** "10 Nov 2026" for a YYYY-MM-DD due date. */
const shortDate = (iso: string | null | undefined, locale: string) => {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
};

/** Today as YYYY-MM-DD in the admin's own zone. */
const todayIso = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Settles a typed amount before it is previewed, so each keystroke is not a request. */
const useSettled = <T,>(value: T, ms = 400): T => {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return settled;
};

const statusPill = (status: AdmissionPackageInstallment['status'], t: TFunction) => {
    const tone =
        status === 'PAID'
            ? 'bg-success-50 text-success-700'
            : status === 'STOPPED'
              ? 'bg-neutral-100 text-neutral-500'
              : status === 'OVERDUE'
                ? 'bg-danger-50 text-danger-700'
                : status === 'PARTIAL_PAID'
                  ? 'bg-info-50 text-info-700'
                  : 'bg-warning-50 text-warning-700';
    return (
        <span className={`inline-block rounded-full px-2 py-0.5 text-2xs font-medium ${tone}`}>
            {t(`side.status.${status}`)}
        </span>
    );
};

// ------------------------------------------------------------ Record payment

interface PaymentPanelProps {
    pkg: AdmissionPackageSummary;
    userId: string;
    /** Paying one installment: what clears it (and any earlier one still open). */
    initialAmount?: number;
    heading?: string;
    note?: string | null;
    onDone: () => void;
}

/**
 * One offline payment for the whole package. The server shares it between the courses (earliest
 * due date first, a part-payment by what each course owes on it), records it on each course and
 * issues one receipt for all of them; the split is previewed before saving.
 */
const PackagePaymentPanel = ({
    pkg,
    userId,
    initialAmount,
    heading,
    note,
    onDone,
}: PaymentPanelProps) => {
    const { t } = useTranslation('manageStudentsAdmissionPackage');
    const { mutateAsync, isPending } = useRecordAdmissionPackagePayment(pkg.id, userId);
    const nextDue = Number(pkg.next_due_amount) || 0;
    const outstanding = Number(pkg.outstanding_total) || 0;
    const start = initialAmount ?? (nextDue > 0 ? nextDue : outstanding);
    const [amount, setAmount] = useState<string>(start > 0 ? String(start) : '');
    const [paymentDate, setPaymentDate] = useState<string>(todayIso());
    const [details, setDetails] = useState<OfflinePaymentDetails>({});
    const [detailsError, setDetailsError] = useState<string | null>(null);
    const [generateInvoice, setGenerateInvoice] = useState<boolean>(true);
    const amt = Number(amount);
    const validAmount = amount !== '' && Number.isFinite(amt) && amt > 0;
    const tooMuch = validAmount && amt > outstanding + 0.005;
    const settled = useSettled(validAmount && !tooMuch ? amt : null);
    const preview = useAdmissionPackagePaymentPreview(pkg.id, settled);

    const submit = async () => {
        if (!validAmount) {
            toast.error(t('side.pay.amountError'));
            return;
        }
        if (detailsError) {
            toast.error(detailsError);
            return;
        }
        const paymentDetails = toOfflinePaymentDetailsPayload(details);
        try {
            await mutateAsync({
                amount: amt,
                payment_date: paymentDate,
                reference: paymentDetails?.reference ?? null,
                generate_invoice: generateInvoice,
                payment_details: paymentDetails,
            });
            toast.success(t('side.pay.success', { amount: fmt(amt, pkg.currency) }));
            onDone();
        } catch (e: unknown) {
            toast.error(serverErrorMessage(e) || t('side.pay.error'));
        }
    };

    const quick =
        nextDue > 0 && outstanding > nextDue
            ? [
                  {
                      label: t('side.pay.next', { amount: fmt(nextDue, pkg.currency) }),
                      value: nextDue,
                  },
                  {
                      label: t('side.pay.all', { amount: fmt(outstanding, pkg.currency) }),
                      value: outstanding,
                  },
              ]
            : [];

    return (
        <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-3">
            <p className="text-2xs font-semibold uppercase tracking-wide text-primary-700">
                {heading ?? t('side.pay.heading')}
            </p>
            <p className="mt-0.5 text-2xs text-neutral-500">{note ?? t('side.pay.note')}</p>
            <div className="mt-2 flex flex-wrap items-start gap-2">
                <div>
                    <label className="block text-2xs text-neutral-500">
                        {t('side.pay.amount')}
                    </label>
                    <input
                        type="number"
                        step="any"
                        min={0}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-28 rounded border border-neutral-200 bg-white px-2 py-1 text-xs tabular-nums"
                    />
                </div>
                <div>
                    <label className="block text-2xs text-neutral-500">{t('side.pay.date')}</label>
                    <input
                        type="date"
                        value={paymentDate}
                        max={todayIso()}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="rounded border border-neutral-200 bg-white px-2 py-1 text-xs"
                    />
                </div>
            </div>
            {quick.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 text-2xs">
                    {quick.map((q) => (
                        <button
                            key={q.label}
                            type="button"
                            onClick={() => setAmount(String(q.value))}
                            className="font-medium text-primary-600 hover:underline"
                        >
                            {q.label}
                        </button>
                    ))}
                </div>
            )}
            {tooMuch && (
                <p className="mt-1 text-2xs text-danger-600">
                    {t('side.pay.tooMuch', { amount: fmt(outstanding, pkg.currency) })}
                </p>
            )}
            {!tooMuch && settled != null && preview.data && (
                <div className="mt-2 rounded border border-neutral-200 bg-white px-2 py-1.5">
                    <p className="text-2xs font-medium text-neutral-600">{t('side.pay.split')}</p>
                    <ul className="mt-0.5 space-y-0.5">
                        {preview.data.courses.map((c) => (
                            <li
                                key={c.user_plan_id}
                                className="flex justify-between gap-2 text-2xs text-neutral-700"
                            >
                                <span className="truncate">{c.course_name || '—'}</span>
                                <span className="tabular-nums">{fmt(c.amount, pkg.currency)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {!tooMuch && preview.isError && (
                <p className="mt-1 text-2xs text-danger-600">
                    {serverErrorMessage(preview.error) || t('side.pay.previewError')}
                </p>
            )}
            <div className="mt-2">
                <OfflinePaymentFields
                    compact
                    value={details}
                    onChange={setDetails}
                    onErrorChange={setDetailsError}
                    numbering={
                        pkg.courses[0] ? { userPlanId: pkg.courses[0].user_plan_id, userId } : null
                    }
                />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-2xs text-neutral-600">
                    <input
                        type="checkbox"
                        checked={generateInvoice}
                        onChange={(e) => setGenerateInvoice(e.target.checked)}
                        className="size-3.5"
                    />
                    {t('side.pay.receipt')}
                </label>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onDone}
                        className="rounded border border-neutral-200 bg-white px-3 py-1 text-2xs text-neutral-600 hover:bg-neutral-50"
                    >
                        {t('side.pay.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={isPending || !validAmount || tooMuch || !!detailsError}
                        onClick={submit}
                        className="rounded bg-primary-500 px-3 py-1 text-2xs font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
                    >
                        {isPending
                            ? t('side.pay.saving')
                            : t('side.pay.submit', {
                                  amount: validAmount ? fmt(amt, pkg.currency) : '',
                              })}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ------------------------------------------------------- Package installment

const actionButton =
    'rounded border border-neutral-200 bg-white px-2 py-0.5 text-2xs font-medium text-neutral-700 hover:bg-neutral-50';

const round2 = (n: number) => Math.round(n * 100) / 100;

interface ChangeFormProps {
    pkg: AdmissionPackageSummary;
    userId: string;
    row: AdmissionPackageInstallment;
    /** Move the installment, split part of it to a new date, or change its amount. */
    mode: 'move' | 'split' | 'amount';
    onDone: () => void;
}

/**
 * Changes one package installment on every course at once, so the package keeps one schedule:
 * move it to another date; move part of what is unpaid on it onto a new date (shared between the
 * courses by what each owes on it); or set its amount (each course keeps what it has paid, the
 * unpaid part is shared the same way, and the package total moves by the difference).
 */
const InstallmentChangeForm = ({ pkg, userId, row, mode, onDone }: ChangeFormProps) => {
    const { t } = useTranslation('manageStudentsAdmissionPackage');
    const { mutateAsync, isPending } = useChangeAdmissionPackageInstallment(pkg.id, userId);
    const unpaid = Math.max(0, Number(row.outstanding) || 0);
    const paid = Math.max(0, Number(row.paid) || 0);
    const [amount, setAmount] = useState<string>(
        mode === 'split' && unpaid > 0
            ? String(unpaid)
            : mode === 'amount'
              ? String(row.amount)
              : ''
    );
    const [dueDate, setDueDate] = useState<string>(
        mode === 'move' ? row.due_date.slice(0, 10) : ''
    );
    const amt = Number(amount);
    const amountOk =
        mode === 'move' ||
        (amount !== '' &&
            Number.isFinite(amt) &&
            (mode === 'split'
                ? amt > 0 && amt <= unpaid
                : amt >= paid && amt !== Number(row.amount)));
    const dateOk = mode === 'amount' || (!!dueDate && dueDate !== row.due_date.slice(0, 10));
    const money = (n: number) => fmt(n, pkg.currency);

    const submit = async () => {
        if (!amountOk) {
            toast.error(
                mode === 'split'
                    ? t('side.change.amountError', { amount: money(unpaid) })
                    : t('side.change.newAmountError', { amount: money(paid) })
            );
            return;
        }
        if (!dateOk) {
            toast.error(t('side.change.dateError'));
            return;
        }
        try {
            await mutateAsync({
                kind: mode,
                body: {
                    due_date: row.due_date.slice(0, 10),
                    ...(mode !== 'amount' ? { new_due_date: dueDate } : {}),
                    ...(mode !== 'move' ? { amount: amt } : {}),
                },
            });
            toast.success(
                mode === 'split'
                    ? t('side.change.splitSuccess', { amount: money(amt) })
                    : mode === 'amount'
                      ? t('side.change.amountSuccess', { amount: money(amt) })
                      : t('side.change.moveSuccess')
            );
            onDone();
        } catch (e: unknown) {
            toast.error(serverErrorMessage(e) || t('side.change.error'));
        }
    };

    return (
        <div className="rounded border border-primary-200 bg-primary-50/40 p-2.5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-primary-700">
                {mode === 'split'
                    ? t('side.change.splitHeading', { amount: money(unpaid) })
                    : mode === 'amount'
                      ? t('side.change.amountHeading')
                      : t('side.change.moveHeading')}
            </p>
            <p className="mb-2 text-2xs text-neutral-500">
                {mode === 'split'
                    ? t('side.change.splitHint')
                    : mode === 'amount'
                      ? t('side.change.amountHint', { paid: money(paid) })
                      : t('side.change.moveHint')}
            </p>
            <div className="flex flex-wrap items-end gap-2">
                {mode !== 'move' && (
                    <div>
                        <label className="block text-2xs text-neutral-500">
                            {mode === 'split'
                                ? t('side.change.amount')
                                : t('side.change.newAmount')}
                        </label>
                        <input
                            type="number"
                            step="any"
                            min={mode === 'amount' ? paid : 0}
                            max={mode === 'split' ? unpaid : undefined}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            className="w-28 rounded border border-neutral-200 bg-white px-2 py-1 text-2xs tabular-nums"
                        />
                    </div>
                )}
                {mode !== 'amount' && (
                    <div>
                        <label className="block text-2xs text-neutral-500">
                            {mode === 'split'
                                ? t('side.change.newDueDate')
                                : t('side.change.dueDate')}
                        </label>
                        <input
                            type="date"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            className="rounded border border-neutral-200 bg-white px-2 py-1 text-2xs"
                        />
                    </div>
                )}
                <button
                    type="button"
                    disabled={isPending || !amountOk || !dateOk}
                    onClick={submit}
                    className="rounded bg-primary-500 px-3 py-1 text-2xs font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                >
                    {isPending ? t('side.pay.saving') : t('side.change.save')}
                </button>
                <button
                    type="button"
                    onClick={onDone}
                    className="rounded border border-neutral-200 bg-white px-3 py-1 text-2xs text-neutral-600 hover:bg-neutral-50"
                >
                    {t('side.pay.cancel')}
                </button>
            </div>
        </div>
    );
};

type ItemPanel = 'pay' | 'move' | 'split' | 'amount' | 'stop' | null;

interface ItemProps {
    pkg: AdmissionPackageSummary;
    userId: string;
    index: number;
}

/**
 * One package installment: its date, amount and status, and what can be done to it — pay it,
 * move it to another date, move part of it to a later date, change its amount, or stop its dues
 * (a learner who dropped out); a stopped one can be reopened. Each acts on every course's bill
 * for that date at once.
 */
const PackageInstallmentItem = ({ pkg, userId, index }: ItemProps) => {
    const { t, i18n } = useTranslation('manageStudentsAdmissionPackage');
    const row = pkg.installments[index]!;
    const [panel, setPanel] = useState<ItemPanel>(null);
    const toggle = (p: ItemPanel) => setPanel((cur) => (cur === p ? null : p));
    const money = (n: number | null | undefined) => fmt(n, pkg.currency);
    const outstanding = Number(row.outstanding) || 0;
    const open = row.status !== 'PAID' && outstanding > 0;
    const earlier = pkg.installments.slice(0, index).filter((r) => Number(r.outstanding) > 0);
    // Paid oldest first, so this one is cleared only with every earlier one still open.
    const clearsThrough = round2(
        earlier.reduce((sum, r) => sum + Number(r.outstanding), 0) + outstanding
    );
    const date = shortDate(row.due_date, i18n.language);
    const later = pkg.installments.slice(index + 1).filter((r) => Number(r.outstanding) > 0);
    const stopped = Number(row.stopped) > 0;

    return (
        <li className="px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-2xs">
                <span className="text-neutral-700">{date}</span>
                <span className="flex items-center gap-2">
                    <span className="tabular-nums text-neutral-800">{money(row.amount)}</span>
                    {row.status === 'PARTIAL_PAID' && (
                        <span className="tabular-nums text-neutral-500">
                            {t('side.left', { amount: money(row.outstanding) })}
                        </span>
                    )}
                    {statusPill(row.status, t)}
                </span>
            </div>
            {stopped && (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-2xs text-neutral-500">
                    <span>
                        {t('side.stoppedFact', {
                            amount: money(row.stopped),
                            reason: row.stopped_reason || '—',
                        })}
                    </span>
                    <ReopenDuesButton
                        target={{ packageId: pkg.id, dueDate: row.due_date.slice(0, 10) }}
                        userId={userId}
                        className={actionButton}
                    />
                </div>
            )}
            {open && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => toggle('pay')}
                        className={
                            panel === 'pay'
                                ? 'rounded bg-primary-600 px-2.5 py-0.5 text-2xs font-semibold text-white'
                                : 'rounded bg-primary-500 px-2.5 py-0.5 text-2xs font-semibold text-white hover:bg-primary-600'
                        }
                    >
                        {t('side.item.pay')}
                    </button>
                    <button type="button" onClick={() => toggle('move')} className={actionButton}>
                        {t('side.item.move')}
                    </button>
                    <button type="button" onClick={() => toggle('split')} className={actionButton}>
                        {t('side.item.split')}
                    </button>
                    <button type="button" onClick={() => toggle('amount')} className={actionButton}>
                        {t('side.item.amount')}
                    </button>
                    <button
                        type="button"
                        onClick={() => toggle('stop')}
                        className="rounded border border-danger-200 bg-white px-2 py-0.5 text-2xs font-medium text-danger-700 hover:bg-danger-50"
                    >
                        {t('side.item.stop')}
                    </button>
                </div>
            )}
            {panel === 'pay' && open && (
                <div className="mt-2">
                    <PackagePaymentPanel
                        pkg={pkg}
                        userId={userId}
                        initialAmount={clearsThrough}
                        heading={t('side.item.payHeading', { date })}
                        note={
                            earlier.length > 0
                                ? t('side.item.coversEarlier', { count: earlier.length })
                                : null
                        }
                        onDone={() => setPanel(null)}
                    />
                </div>
            )}
            {(panel === 'move' || panel === 'split' || panel === 'amount') && open && (
                <div className="mt-2">
                    <InstallmentChangeForm
                        key={panel}
                        pkg={pkg}
                        userId={userId}
                        row={row}
                        mode={panel}
                        onDone={() => setPanel(null)}
                    />
                </div>
            )}
            {panel === 'stop' && open && (
                <div className="mt-2">
                    <StopDuesForm
                        target={{ packageId: pkg.id, dueDate: row.due_date.slice(0, 10) }}
                        userId={userId}
                        currency={pkg.currency}
                        thisAmount={outstanding}
                        laterAmount={round2(
                            later.reduce((sum, r) => sum + Number(r.outstanding), 0)
                        )}
                        laterCount={later.length}
                        courseCount={pkg.courses.length}
                        onDone={() => setPanel(null)}
                    />
                </div>
            )}
        </li>
    );
};

// ------------------------------------------------------------- Package card

interface CardProps {
    pkg: AdmissionPackageSummary;
    userId: string;
}

const AdmissionPackageCard = ({ pkg, userId }: CardProps) => {
    const { t, i18n } = useTranslation('manageStudentsAdmissionPackage');
    const [expanded, setExpanded] = useState(false);
    const [paying, setPaying] = useState(false);
    const money = (n: number | null | undefined) => fmt(n, pkg.currency);
    const names = pkg.courses.map((c) => c.course_name || '—').join(' + ');

    return (
        <div className="rounded-xl border border-primary-200 bg-white">
            <button
                type="button"
                onClick={() => setExpanded((x) => !x)}
                className="flex w-full items-center justify-between px-4 py-3 text-start hover:bg-neutral-50"
            >
                <div className="min-w-0 flex-1">
                    <p className="text-2xs font-semibold uppercase tracking-wide text-primary-700">
                        {t('side.heading', { count: pkg.courses.length })}
                    </p>
                    <p className="truncate text-sm font-medium text-neutral-800">{names}</p>
                    <p className="mt-0.5 text-2xs text-neutral-500">
                        {t('side.net', { amount: money(pkg.net_total) })}
                        {' · '}
                        {t('side.paid', { amount: money(pkg.paid_total) })}
                        {' · '}
                        <span
                            className={
                                pkg.outstanding_total > 0
                                    ? 'font-medium text-warning-700'
                                    : 'text-neutral-500'
                            }
                        >
                            {t('side.outstanding', { amount: money(pkg.outstanding_total) })}
                        </span>
                    </p>
                    {pkg.next_due_date && (
                        <p className="mt-0.5 text-2xs text-neutral-600">
                            {t('side.nextDue', {
                                amount: money(pkg.next_due_amount),
                                date: shortDate(pkg.next_due_date, i18n.language),
                            })}
                        </p>
                    )}
                </div>
                <span className="ms-2 text-xs text-neutral-400">{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div className="space-y-3 border-t border-neutral-100 px-4 py-3">
                    <div className="overflow-x-auto rounded-lg border border-neutral-200">
                        <table className="w-full text-2xs">
                            <thead className="bg-neutral-50 text-neutral-500">
                                <tr>
                                    <th className="px-2 py-1 text-start font-medium">
                                        {t('side.courses.course')}
                                    </th>
                                    <th className="px-2 py-1 text-end font-medium">
                                        {t('side.courses.fee')}
                                    </th>
                                    <th className="px-2 py-1 text-end font-medium">
                                        {t('side.courses.discount')}
                                    </th>
                                    <th className="px-2 py-1 text-end font-medium">
                                        {t('side.courses.paid')}
                                    </th>
                                    <th className="px-2 py-1 text-end font-medium">
                                        {t('side.courses.left')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100 text-neutral-700">
                                {pkg.courses.map((c) => (
                                    <tr key={c.user_plan_id}>
                                        <td className="px-2 py-1">
                                            {c.course_name || '—'}
                                            {c.plan_status && c.plan_status !== 'ACTIVE' && (
                                                <span className="ms-1 text-neutral-400">
                                                    ({c.plan_status.toLowerCase()})
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-2 py-1 text-end tabular-nums">
                                            {money(c.fee)}
                                        </td>
                                        <td className="px-2 py-1 text-end tabular-nums">
                                            {Number(c.discount) > 0 ? `−${money(c.discount)}` : '—'}
                                        </td>
                                        <td className="px-2 py-1 text-end tabular-nums">
                                            {money(c.paid)}
                                        </td>
                                        <td className="px-2 py-1 text-end tabular-nums">
                                            {money(c.outstanding)}
                                        </td>
                                    </tr>
                                ))}
                                <tr className="bg-neutral-50 font-medium">
                                    <td className="px-2 py-1">{t('side.courses.total')}</td>
                                    <td className="px-2 py-1 text-end tabular-nums">
                                        {money(pkg.fee_total)}
                                    </td>
                                    <td className="px-2 py-1 text-end tabular-nums">
                                        {Number(pkg.discount_total) > 0
                                            ? `−${money(pkg.discount_total)}`
                                            : '—'}
                                    </td>
                                    <td className="px-2 py-1 text-end tabular-nums">
                                        {money(pkg.paid_total)}
                                    </td>
                                    <td className="px-2 py-1 text-end tabular-nums">
                                        {money(pkg.outstanding_total)}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    {pkg.discount_reason && (
                        <p className="text-2xs text-neutral-500">
                            {t('side.discountReason', { reason: pkg.discount_reason })}
                        </p>
                    )}

                    {pkg.installments.length > 0 && (
                        <div>
                            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                                {t('side.installments')}
                            </p>
                            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                                {pkg.installments.map((row, idx) => (
                                    <PackageInstallmentItem
                                        key={row.due_date}
                                        pkg={pkg}
                                        userId={userId}
                                        index={idx}
                                    />
                                ))}
                            </ul>
                        </div>
                    )}

                    {paying ? (
                        <PackagePaymentPanel
                            pkg={pkg}
                            userId={userId}
                            onDone={() => setPaying(false)}
                        />
                    ) : (
                        pkg.outstanding_total > 0 && (
                            <button
                                type="button"
                                onClick={() => setPaying(true)}
                                className="rounded border border-primary-300 bg-primary-50 px-3 py-1 text-2xs font-medium text-primary-700 hover:bg-primary-100"
                            >
                                {t('side.recordPayment')}
                            </button>
                        )
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * The learner's admission packages (courses enrolled together with one discount and schedule),
 * above the per-course cards. Renders nothing for a learner without one.
 */
export const AdmissionPackagesSection = ({ userId }: { userId: string }) => {
    const { data } = useUserAdmissionPackages(userId, getCurrentInstituteId());
    if (!data || data.length === 0) return null;
    return (
        <div className="space-y-3">
            {data.map((pkg) => (
                <AdmissionPackageCard key={pkg.id} pkg={pkg} userId={userId} />
            ))}
        </div>
    );
};
