import { useEffect, useMemo, useState } from 'react';
import { OfflinePaymentFields } from '@/components/common/payments/OfflinePaymentFields';
import {
    toOfflinePaymentDetailsPayload,
    type OfflinePaymentDetails,
} from '@/services/offline-payment-modes';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    useApplyCpoDiscount,
    useCpoDiscountPreview,
    useModifyInstallment,
    useRecordOfflinePayment,
    useSplitInstallment,
    useUserCpoUserPlans,
    useUserPlanInstallments,
} from '@/routes/manage-students/students-list/-services/cpoSideViewService';
import type {
    ApplyCpoDiscountRequest,
    CpoDiscountAllocation,
    CpoInstallmentRow,
    CpoSideViewInstallmentsResponse,
    CpoUserPlanSummary,
    DiscountType,
    ModifyInstallmentRequest,
    RecordOfflinePaymentRequest,
} from '@/routes/manage-students/students-list/-types/cpo-side-view-types';
import { getCurrencySymbol } from '@/constants/currencies';
import { serverErrorMessage } from '@/services/payment-logs';
import { AdmissionPackagesSection } from './admission-package-card';
import { ReopenDuesButton, StopDuesForm } from './stop-dues-form';

/**
 * Money for one CPO plan. The currency comes from the plan itself — this used to hard-code
 * ₹, so an AUD plan's installments read as rupees. en-IN lakh grouping is likewise only
 * right for INR.
 */
const fmt = (n: number | null | undefined, currency?: string | null) => {
    if (!Number.isFinite(n as number)) return '—';
    const code = (currency || 'INR').toUpperCase();
    return `${getCurrencySymbol(code)}${(n as number).toLocaleString(
        code === 'INR' ? 'en-IN' : 'en-US',
        {
            maximumFractionDigits: 2,
        }
    )}`;
};

const isoDate = (s: string | null | undefined) => {
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
};

const statusPill = (status: string, t: TFunction) => {
    const tone =
        status === 'PAID'
            ? 'bg-green-100 text-green-700'
            : status === 'PARTIAL_PAID'
              ? 'bg-blue-100 text-blue-700'
              : status === 'OVERDUE'
                ? 'bg-red-100 text-red-700'
                : status === 'WAIVED' || status === 'CANCELLED' || status === 'STOPPED'
                  ? 'bg-neutral-100 text-neutral-500'
                  : 'bg-orange-100 text-orange-700';
    const statusLabels: Record<string, string> = {
        PAID: t('status.paid'),
        PARTIAL_PAID: t('status.partialPaid'),
        OVERDUE: t('status.overdue'),
        WAIVED: t('status.waived'),
        CANCELLED: t('status.cancelled'),
        STOPPED: t('status.stopped'),
    };
    const label = statusLabels[status] ?? status;
    return (
        <span className={`inline-block rounded-full px-2 py-0.5 text-2xs font-medium ${tone}`}>
            {label}
        </span>
    );
};

// ------------------------------------------------------------ Split form

/** Today as YYYY-MM-DD in the admin's own zone (toISOString would give the UTC date — yesterday in IST before 5:30am). */
const todayIso = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

interface SplitFormProps {
    row: CpoInstallmentRow;
    userPlanId: string;
    userId: string;
    currency?: string | null;
    onDone: () => void;
}

/**
 * Moves part of an installment's unpaid balance onto a new installment with its own due date —
 * how an admin schedules "25,000 paid, the other 40,000 is due on the 10th". The plan total
 * stays the same; only when that part falls due changes.
 */
const SplitInstallmentForm = ({ row, userPlanId, userId, currency, onDone }: SplitFormProps) => {
    const { t } = useTranslation('manageStudentsCpoInstallmentsEditor');
    const { mutateAsync, isPending } = useSplitInstallment(userPlanId, userId);
    const unpaid = Math.max(0, Number(row.outstanding) || 0);
    const [amount, setAmount] = useState<string>(unpaid > 0 ? String(unpaid) : '');
    const [startDate, setStartDate] = useState<string>(todayIso());
    const [dueDate, setDueDate] = useState<string>('');

    const submit = async () => {
        const amt = Number(amount);
        if (!Number.isFinite(amt) || amt <= 0 || amt > unpaid) {
            toast.error(t('split.amountError', { unpaid: fmt(unpaid, currency) }));
            return;
        }
        if (!dueDate) {
            toast.error(t('split.dueDateError'));
            return;
        }
        try {
            await mutateAsync({
                sfpId: row.id,
                body: { amount: amt, start_date: startDate || null, due_date: dueDate },
            });
            toast.success(t('split.successToast', { amount: fmt(amt, currency), date: dueDate }));
            onDone();
        } catch (e: unknown) {
            toast.error(serverErrorMessage(e) || t('split.errorToast'));
        }
    };

    return (
        <div className="rounded border border-primary-200 bg-primary-50/40 p-2.5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-primary-700">
                {t('split.heading', { unpaid: fmt(unpaid, currency) })}
            </p>
            <p className="mb-2 text-2xs text-neutral-500">{t('split.hint')}</p>
            <div className="flex flex-wrap items-end gap-2">
                <div>
                    <label className="block text-2xs text-neutral-500">
                        {t('split.amountLabel')}
                    </label>
                    <input
                        type="number"
                        step="any"
                        min={0}
                        max={unpaid}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-28 rounded border border-neutral-200 px-2 py-1 text-2xs"
                    />
                </div>
                <div>
                    <label className="block text-2xs text-neutral-500">
                        {t('split.startDateLabel')}
                    </label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="rounded border border-neutral-200 px-2 py-1 text-2xs"
                    />
                </div>
                <div>
                    <label className="block text-2xs text-neutral-500">
                        {t('split.dueDateLabel')}
                    </label>
                    <input
                        type="date"
                        value={dueDate}
                        min={startDate || undefined}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="rounded border border-neutral-200 px-2 py-1 text-2xs"
                    />
                </div>
                <button
                    type="button"
                    disabled={isPending}
                    onClick={submit}
                    className="rounded bg-primary-500 px-3 py-1 text-2xs font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                >
                    {isPending ? t('split.saving') : t('split.save')}
                </button>
                <button
                    type="button"
                    onClick={onDone}
                    className="rounded border border-neutral-200 px-3 py-1 text-2xs text-neutral-600 hover:bg-neutral-50"
                >
                    {t('split.cancel')}
                </button>
            </div>
        </div>
    );
};

// ------------------------------------------------------------- Helpers

/** "29 Oct 2026" for a due date, or a dash. */
const shortDate = (s: string | null | undefined, locale: string) => {
    const iso = isoDate(s);
    if (!iso) return '—';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
};

/** An installment a payment can still go to (the FIFO allocator skips only PAID rows). */
const isOpen = (r: CpoInstallmentRow) => r.status !== 'PAID' && Number(r.outstanding) > 0;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Paid in full by the learner, or waived: a re-spread plan discount leaves its share alone
 * (CpoDiscountAllocator). A row the discount took to zero reads PAID but nobody paid it.
 */
const isSettled = (r: CpoInstallmentRow) =>
    r.status === 'WAIVED' ||
    (Number(r.amount_paid) > 0 && Number(r.amount_paid) >= Number(r.amount_expected));

/**
 * Payments settle installments oldest-due first, so paying installment k means paying
 * everything still open up to and including it. Rows come sorted by due date.
 */
const dueThrough = (rows: CpoInstallmentRow[], index: number) =>
    round2(
        rows
            .slice(0, index + 1)
            .filter(isOpen)
            .reduce((s, r) => s + Number(r.outstanding), 0)
    );

/** Payments settle installments in due-date order, so the next one is the usual amount. */
const nextDueOutstanding = (rows: CpoInstallmentRow[]): number => {
    const open = rows.filter((r) => r.status !== 'WAIVED' && Number(r.outstanding) > 0);
    if (open.length === 0) return 0;
    const dueOf = (r: CpoInstallmentRow) => r.due_date?.slice(0, 10) ?? '';
    const earliest = open.map(dueOf).reduce((a, b) => (b < a ? b : a));
    const sum = open
        .filter((r) => dueOf(r) === earliest)
        .reduce((s, r) => s + Number(r.outstanding), 0);
    return round2(sum);
};

const actionButton =
    'rounded border border-neutral-200 px-2 py-0.5 text-2xs font-medium text-neutral-700 hover:bg-neutral-50';

// ------------------------------------------------------------ Record payment

interface RecordPaymentPanelProps {
    userPlanId: string;
    userId: string;
    currency?: string | null;
    initialAmount: number;
    heading: string;
    note?: string | null;
    /** One-tap amounts shown under the input (e.g. next installment / all dues). */
    quickAmounts?: { label: string; amount: number }[];
    onDone: () => void;
}

/**
 * Records an offline payment against the plan: amount, date and how it was paid (mode chips
 * from Payment Settings, the institute's default preselected). The backend settles it
 * oldest-due first and marks the matching invoices paid.
 */
const RecordPaymentPanel = ({
    userPlanId,
    userId,
    currency,
    initialAmount,
    heading,
    note,
    quickAmounts,
    onDone,
}: RecordPaymentPanelProps) => {
    const { t } = useTranslation('manageStudentsCpoInstallmentsEditor');
    const { mutateAsync, isPending } = useRecordOfflinePayment(userPlanId, userId);
    const [amount, setAmount] = useState<string>(initialAmount > 0 ? String(initialAmount) : '');
    const [details, setDetails] = useState<OfflinePaymentDetails>({});
    const [detailsError, setDetailsError] = useState<string | null>(null);
    const [paymentDate, setPaymentDate] = useState<string>(todayIso());
    const [generateInvoice, setGenerateInvoice] = useState<boolean>(true);
    const amt = Number(amount);
    const validAmount = amount !== '' && Number.isFinite(amt) && amt > 0;

    const submit = async () => {
        if (!validAmount) {
            toast.error(t('offlinePayment.amountRequiredError'));
            return;
        }
        if (detailsError) {
            toast.error(detailsError);
            return;
        }
        const paymentDetails = toOfflinePaymentDetailsPayload(details);
        const body: RecordOfflinePaymentRequest = {
            amount: amt,
            payment_date: paymentDate,
            reference: paymentDetails?.reference ?? null,
            generate_invoice: generateInvoice,
            payment_details: paymentDetails,
        };
        try {
            await mutateAsync(body);
            toast.success(t('offlinePayment.recordedSuccessToast', { amount: fmt(amt, currency) }));
            onDone();
        } catch (e: unknown) {
            toast.error(serverErrorMessage(e) || t('offlinePayment.recordErrorToast'));
        }
    };

    return (
        <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-3">
            <p className="text-2xs font-semibold uppercase tracking-wide text-primary-700">
                {heading}
            </p>
            {note && <p className="mt-0.5 text-2xs text-neutral-500">{note}</p>}
            <div className="mt-2 flex flex-wrap items-start gap-2">
                <div>
                    <label className="block text-2xs text-neutral-500">
                        {t('offlinePayment.amountLabel')}
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
                    <label className="block text-2xs text-neutral-500">
                        {t('offlinePayment.dateLabel')}
                    </label>
                    <input
                        type="date"
                        value={paymentDate}
                        max={todayIso()}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="rounded border border-neutral-200 bg-white px-2 py-1 text-xs"
                    />
                </div>
            </div>
            {quickAmounts && quickAmounts.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 text-2xs">
                    {quickAmounts.map((q) => (
                        <button
                            key={q.label}
                            type="button"
                            onClick={() => setAmount(String(q.amount))}
                            className="font-medium text-primary-600 hover:underline"
                        >
                            {q.label}
                        </button>
                    ))}
                </div>
            )}
            <div className="mt-2">
                <OfflinePaymentFields
                    compact
                    value={details}
                    onChange={setDetails}
                    onErrorChange={setDetailsError}
                    numbering={{ userPlanId, userId }}
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
                    {t('offlinePayment.generateInvoiceLabel')}
                </label>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onDone}
                        className="rounded border border-neutral-200 bg-white px-3 py-1 text-2xs text-neutral-600 hover:bg-neutral-50"
                    >
                        {t('offlinePayment.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={isPending || !validAmount || !!detailsError}
                        onClick={submit}
                        className="rounded bg-primary-500 px-3 py-1 text-2xs font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
                    >
                        {isPending
                            ? t('offlinePayment.saving')
                            : t('pay.submit', { amount: validAmount ? fmt(amt, currency) : '' })}
                    </button>
                </div>
            </div>
        </div>
    );
};

// -------------------------------------------------------------- Edit form

interface EditFormProps {
    row: CpoInstallmentRow;
    userPlanId: string;
    userId: string;
    currency?: string | null;
    onDone: () => void;
}

/** Dates, amount and the installment's own discount for one installment. */
const InstallmentEditForm = ({ row, userPlanId, userId, currency, onDone }: EditFormProps) => {
    const { t } = useTranslation('manageStudentsCpoInstallmentsEditor');
    const { mutateAsync: modify, isPending } = useModifyInstallment(userPlanId, userId);
    const currentAmount =
        row.manual_amount_override?.new_amount != null
            ? String(row.manual_amount_override.new_amount)
            : '';
    const currentDiscType = row.installment_discount?.type ?? '';
    const currentDiscValue =
        row.installment_discount?.value != null ? String(row.installment_discount.value) : '';
    const currentDiscReason = row.installment_discount?.reason ?? '';

    const [startDate, setStartDate] = useState<string>(isoDate(row.start_date));
    const [dueDate, setDueDate] = useState<string>(isoDate(row.due_date));
    const [amount, setAmount] = useState<string>(currentAmount);
    const [discType, setDiscType] = useState<DiscountType | ''>(currentDiscType);
    const [discValue, setDiscValue] = useState<string>(currentDiscValue);
    const [discReason, setDiscReason] = useState<string>(currentDiscReason);

    const dirty =
        startDate !== isoDate(row.start_date) ||
        dueDate !== isoDate(row.due_date) ||
        amount !== currentAmount ||
        discType !== currentDiscType ||
        discValue !== currentDiscValue ||
        discReason !== currentDiscReason;

    const save = async () => {
        const body: ModifyInstallmentRequest = {
            start_date: startDate || null,
            due_date: dueDate || null,
            amount: amount === '' ? null : Number(amount),
            clear_amount_override: amount === '' && row.manual_amount_override != null,
            discount: discType
                ? {
                      type: discType,
                      value: discValue === '' ? 0 : Number(discValue),
                      reason: discReason || null,
                  }
                : null,
            clear_discount: discType === '' && row.installment_discount != null,
        };
        try {
            await modify({ sfpId: row.id, body });
            toast.success(t('row.updateSuccessToast'));
            onDone();
        } catch (e: unknown) {
            toast.error(serverErrorMessage(e) || t('row.updateErrorToast'));
        }
    };

    const input = 'w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs';
    return (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className="block text-2xs text-neutral-500">{t('edit.startDate')}</label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className={input}
                    />
                </div>
                <div>
                    <label className="block text-2xs text-neutral-500">{t('edit.dueDate')}</label>
                    <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className={input}
                    />
                </div>
                <div className="col-span-2">
                    <label className="block text-2xs text-neutral-500">{t('edit.amount')}</label>
                    <input
                        type="number"
                        step="any"
                        min={0}
                        placeholder={String(row.amount_expected)}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className={`${input} tabular-nums`}
                    />
                    <p className="mt-0.5 text-2xs text-neutral-500">
                        {t('edit.amountHint', { amount: fmt(row.original_amount, currency) })}
                    </p>
                </div>
                <div>
                    <label className="block text-2xs text-neutral-500">{t('edit.discount')}</label>
                    <div className="flex items-center gap-1">
                        <select
                            value={discType}
                            onChange={(e) => setDiscType(e.target.value as DiscountType | '')}
                            className="rounded border border-neutral-200 bg-white p-1 text-xs"
                        >
                            <option value="">{t('row.discountOptionNone')}</option>
                            <option value="PERCENTAGE">{t('row.discountOptionPercentage')}</option>
                            <option value="FLAT">{t('row.discountOptionFlat')}</option>
                        </select>
                        <input
                            type="number"
                            step="any"
                            min={0}
                            disabled={!discType}
                            value={discValue}
                            onChange={(e) => setDiscValue(e.target.value)}
                            placeholder="0"
                            className={`${input} disabled:bg-neutral-100`}
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-2xs text-neutral-500">{t('edit.reason')}</label>
                    <input
                        type="text"
                        disabled={!discType}
                        value={discReason}
                        onChange={(e) => setDiscReason(e.target.value)}
                        placeholder={t('row.reasonPlaceholder')}
                        className={`${input} disabled:bg-neutral-100`}
                    />
                </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onDone}
                    className="rounded border border-neutral-200 bg-white px-3 py-1 text-2xs text-neutral-600 hover:bg-neutral-50"
                >
                    {t('split.cancel')}
                </button>
                <button
                    type="button"
                    disabled={!dirty || isPending}
                    onClick={save}
                    className="rounded bg-primary-500 px-3 py-1 text-2xs font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
                >
                    {isPending ? t('offlinePayment.saving') : t('row.save')}
                </button>
            </div>
        </div>
    );
};

// -------------------------------------------------------------- Installment

interface ItemProps {
    rows: CpoInstallmentRow[];
    index: number;
    userPlanId: string;
    userId: string;
    currency?: string | null;
    /** Part of an admission package: paid and changed on the package, so no actions here. */
    readOnly?: boolean;
}

type ItemPanel = 'pay' | 'edit' | 'split' | 'stop' | null;

/**
 * One installment as a compact line that fits the narrow side view: number, due date,
 * amount and status, what has been paid or taken off, and its actions — Record payment
 * (the quick path), Edit and Split — each opening below the line.
 */
const InstallmentItem = ({ rows, index, userPlanId, userId, currency, readOnly }: ItemProps) => {
    const { t, i18n } = useTranslation('manageStudentsCpoInstallmentsEditor');
    const row = rows[index]!;
    const [panel, setPanel] = useState<ItemPanel>(null);
    const toggle = (p: ItemPanel) => setPanel((cur) => (cur === p ? null : p));
    const number = row.installment_number ?? index + 1;
    const outstanding = Number(row.outstanding) || 0;
    const paid = Number(row.amount_paid) || 0;
    const open = isOpen(row) && row.status !== 'WAIVED';
    const canSplit = outstanding > 0 && row.status !== 'WAIVED';
    const payAmount = dueThrough(rows, index);
    const earlierOpen = rows.slice(0, index).filter(isOpen).length;
    const stopped = !!row.stopped_at;
    const later = rows.slice(index + 1).filter((r) => isOpen(r) && r.status !== 'WAIVED');

    const facts: string[] = [];
    if (stopped)
        facts.push(
            t('stopDues.stoppedFact', {
                amount: fmt(row.stopped_amount ?? 0, currency),
                reason: row.stopped_reason || '—',
            })
        );
    if (paid > 0) facts.push(t('item.paid', { amount: fmt(paid, currency) }));
    if (paid > 0 && outstanding > 0)
        facts.push(t('item.left', { amount: fmt(outstanding, currency) }));
    if (outstanding < 0) facts.push(t('item.overpaid', { amount: fmt(-outstanding, currency) }));
    if (row.plan_discount_share)
        facts.push(t('item.planDiscount', { amount: fmt(row.plan_discount_share, currency) }));
    if (row.installment_discount?.resolved_amount)
        facts.push(
            t('item.ownDiscount', {
                amount: fmt(row.installment_discount.resolved_amount, currency),
            })
        );
    if (Number(row.original_amount) !== Number(row.amount_expected))
        facts.push(t('item.was', { amount: fmt(row.original_amount, currency) }));

    return (
        <li className="px-3 py-2.5">
            <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xs font-semibold text-neutral-600">
                    {number}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <p className="text-xs font-medium text-neutral-800">
                            {t('item.due', { date: shortDate(row.due_date, i18n.language) })}
                        </p>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold tabular-nums text-neutral-800">
                                {fmt(row.amount_expected, currency)}
                            </span>
                            {statusPill(stopped ? 'STOPPED' : row.status, t)}
                        </div>
                    </div>
                    {facts.length > 0 && (
                        <p className="mt-0.5 text-2xs text-neutral-500">{facts.join(' · ')}</p>
                    )}
                    {!readOnly && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {open && (
                                <button
                                    type="button"
                                    onClick={() => toggle('pay')}
                                    className={
                                        panel === 'pay'
                                            ? 'rounded bg-primary-600 px-2.5 py-0.5 text-2xs font-semibold text-white'
                                            : 'rounded bg-primary-500 px-2.5 py-0.5 text-2xs font-semibold text-white hover:bg-primary-600'
                                    }
                                >
                                    {t('item.recordPayment')}
                                </button>
                            )}
                            {/* A bill cancelled with its course is closed; nothing to edit. */}
                            {row.status !== 'CANCELLED' && (
                                <button
                                    type="button"
                                    onClick={() => toggle('edit')}
                                    className={actionButton}
                                >
                                    {t('item.edit')}
                                </button>
                            )}
                            {canSplit && (
                                <button
                                    type="button"
                                    onClick={() => toggle('split')}
                                    title={t('row.splitTitle')}
                                    className={actionButton}
                                >
                                    {t('row.split')}
                                </button>
                            )}
                            {open && outstanding > 0 && (
                                <button
                                    type="button"
                                    onClick={() => toggle('stop')}
                                    className="rounded border border-danger-200 px-2 py-0.5 text-2xs font-medium text-danger-700 hover:bg-danger-50"
                                >
                                    {t('stopDues.action')}
                                </button>
                            )}
                            {stopped && (
                                <ReopenDuesButton
                                    target={{ sfpId: row.id }}
                                    userId={userId}
                                    className={actionButton}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>
            {panel === 'pay' && open && (
                <div className="mt-2">
                    <RecordPaymentPanel
                        userPlanId={userPlanId}
                        userId={userId}
                        currency={currency}
                        initialAmount={payAmount}
                        heading={t('pay.heading', { n: number })}
                        note={
                            earlierOpen > 0 ? t('pay.coversEarlier', { count: earlierOpen }) : null
                        }
                        onDone={() => setPanel(null)}
                    />
                </div>
            )}
            {panel === 'edit' && (
                <div className="mt-2">
                    <InstallmentEditForm
                        row={row}
                        userPlanId={userPlanId}
                        userId={userId}
                        currency={currency}
                        onDone={() => setPanel(null)}
                    />
                </div>
            )}
            {panel === 'stop' && open && (
                <div className="mt-2">
                    <StopDuesForm
                        target={{ sfpId: row.id }}
                        userId={userId}
                        currency={currency}
                        thisAmount={Math.max(0, outstanding)}
                        laterAmount={round2(
                            later.reduce((sum, r) => sum + Math.max(0, Number(r.outstanding)), 0)
                        )}
                        laterCount={later.length}
                        onDone={() => setPanel(null)}
                    />
                </div>
            )}
            {panel === 'split' && canSplit && (
                <div className="mt-2">
                    <SplitInstallmentForm
                        row={row}
                        userPlanId={userPlanId}
                        userId={userId}
                        currency={currency}
                        onDone={() => setPanel(null)}
                    />
                </div>
            )}
        </li>
    );
};

// ----------------------------------------------------------- CPO discount

const ALLOCATIONS: CpoDiscountAllocation[] = [
    'UNPAID_PROPORTIONAL',
    'UNPAID_EQUAL',
    'LAST_FIRST',
    'NEXT_FIRST',
    'CUSTOM',
    'ALL_PROPORTIONAL',
];

/** Waits until the admin stops typing before the preview is asked for. */
const useSettled = <T,>(value: T, ms = 400): T => {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return settled;
};

interface DiscountEditorProps {
    userPlanId: string;
    userId: string;
    current: CpoSideViewInstallmentsResponse['cpo_discount'];
    rows: CpoInstallmentRow[];
    currency?: string | null;
}

/**
 * The discount on the whole plan, and how it is taken off the installments: spread over what
 * is unpaid (in proportion or equally), from the last installment back, from the next one on,
 * custom amounts per installment, or — the original way — over every installment including
 * paid ones. A preview from the server shows each installment's new amount before applying.
 */
const CpoDiscountEditor = ({
    userPlanId,
    userId,
    current,
    rows,
    currency,
}: DiscountEditorProps) => {
    const { t, i18n } = useTranslation('manageStudentsCpoInstallmentsEditor');
    const { mutateAsync, isPending } = useApplyCpoDiscount(userPlanId, userId);
    const initialAllocation: CpoDiscountAllocation = current
        ? current.allocation ?? 'ALL_PROPORTIONAL'
        : 'UNPAID_PROPORTIONAL';
    const initialCustom = () => {
        const out: Record<string, string> = {};
        if (current?.allocation === 'CUSTOM' && current.shares) {
            for (const [id, v] of Object.entries(current.shares)) out[id] = String(v);
        }
        return out;
    };
    const [type, setType] = useState<DiscountType>(current?.type ?? 'FLAT');
    const [value, setValue] = useState<string>(current?.value != null ? String(current.value) : '');
    const [reason, setReason] = useState<string>(current?.reason ?? '');
    const [allocation, setAllocation] = useState<CpoDiscountAllocation>(initialAllocation);
    const [custom, setCustom] = useState<Record<string, string>>(initialCustom);

    useEffect(() => {
        setType(current?.type ?? 'FLAT');
        setValue(current?.value != null ? String(current.value) : '');
        setReason(current?.reason ?? '');
        setAllocation(current ? current.allocation ?? 'ALL_PROPORTIONAL' : 'UNPAID_PROPORTIONAL');
        setCustom(initialCustom());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current]);

    const isCustom = allocation === 'CUSTOM';
    const customShares = useMemo(() => {
        const settledIds = new Set(rows.filter(isSettled).map((r) => r.id));
        const out: Record<string, number> = {};
        for (const [id, v] of Object.entries(custom)) {
            const n = Number(v);
            if (!settledIds.has(id) && v !== '' && Number.isFinite(n) && n > 0) out[id] = n;
        }
        return out;
    }, [custom, rows]);
    const customTotal = round2(Object.values(customShares).reduce((s, n) => s + n, 0));
    const numericValue = Number(value);
    const hasDiscount = isCustom
        ? customTotal > 0
        : value !== '' && Number.isFinite(numericValue) && numericValue > 0;

    const request: ApplyCpoDiscountRequest | null = hasDiscount
        ? isCustom
            ? {
                  discount: { type: 'FLAT', value: customTotal },
                  allocation,
                  custom_shares: customShares,
              }
            : { discount: { type, value: numericValue }, allocation }
        : null;
    const settledRequest = useSettled(request);
    const preview = useCpoDiscountPreview(userPlanId, settledRequest);
    const previewError = preview.isError
        ? serverErrorMessage(preview.error) || t('cpoDiscount.previewError')
        : null;
    const shareById = useMemo(() => {
        const m = new Map<string, { share: number; after: number }>();
        for (const r of preview.data?.installments ?? [])
            m.set(r.id, { share: r.share, after: r.amount_after });
        return m;
    }, [preview.data]);
    const capped =
        preview.data &&
        !isCustom &&
        preview.data.resolved_amount < preview.data.requested_amount - 0.005;

    const apply = async () => {
        if (!request) return;
        try {
            await mutateAsync({
                ...request,
                discount: { ...request.discount!, reason: reason || null },
            });
            toast.success(t('cpoDiscount.applySuccessToast'));
        } catch (e: unknown) {
            toast.error(serverErrorMessage(e) || t('cpoDiscount.applyErrorToast'));
        }
    };
    const remove = async () => {
        try {
            await mutateAsync({ remove: true });
            toast.success(t('cpoDiscount.removeSuccessToast'));
        } catch (e: unknown) {
            toast.error(serverErrorMessage(e) || t('cpoDiscount.applyErrorToast'));
        }
    };

    const input = 'rounded border border-neutral-200 bg-white px-2 py-1 text-xs';
    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                    {t('cpoDiscount.heading')}
                </p>
                {current && (
                    <p className="text-2xs text-neutral-600">
                        {t('cpoDiscount.currentSummary', {
                            amount: fmt(current.resolved_amount ?? 0, currency),
                            how: t(`allocation.${current.allocation ?? 'ALL_PROPORTIONAL'}.short`),
                        })}
                    </p>
                )}
            </div>

            <div className="mt-2 flex flex-col gap-2">
                <div>
                    <label className="block text-2xs text-neutral-500">
                        {t('cpoDiscount.howLabel')}
                    </label>
                    <select
                        value={allocation}
                        onChange={(e) => setAllocation(e.target.value as CpoDiscountAllocation)}
                        className={`${input} w-full`}
                    >
                        {ALLOCATIONS.map((a) => (
                            <option key={a} value={a}>
                                {t(`allocation.${a}.label`)}
                            </option>
                        ))}
                    </select>
                    <p className="mt-0.5 text-2xs text-neutral-500">
                        {t(`allocation.${allocation}.hint`)}
                    </p>
                </div>

                {!isCustom && (
                    <div className="flex flex-wrap items-end gap-2">
                        <div>
                            <label className="block text-2xs text-neutral-500">
                                {t('cpoDiscount.typeLabel')}
                            </label>
                            <select
                                value={type}
                                onChange={(e) => setType(e.target.value as DiscountType)}
                                className={input}
                            >
                                <option value="FLAT">{t('cpoDiscount.discountOptionFlat')}</option>
                                <option value="PERCENTAGE">
                                    {t('cpoDiscount.discountOptionPercentage')}
                                </option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-2xs text-neutral-500">
                                {t('cpoDiscount.valueLabel')}
                            </label>
                            <input
                                type="number"
                                step="any"
                                min={0}
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                className={`${input} w-24 tabular-nums`}
                            />
                        </div>
                    </div>
                )}

                {/* Every installment with what it is billed now and, once a discount is typed, after. */}
                <ul className="divide-y divide-neutral-100 rounded border border-neutral-100">
                    {rows.map((row, i) => {
                        const p = shareById.get(row.id);
                        const room = round2(
                            Number(row.amount_expected) +
                                Number(row.plan_discount_share ?? 0) -
                                Number(row.amount_paid)
                        );
                        const settled = isSettled(row);
                        const editable = isCustom && !settled && room > 0;
                        return (
                            <li key={row.id} className="flex items-center gap-2 px-2 py-1 text-2xs">
                                <span className="w-5 shrink-0 text-neutral-500">
                                    {row.installment_number ?? i + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-neutral-600">
                                    {shortDate(row.due_date, i18n.language)}
                                </span>
                                {isCustom &&
                                    (editable ? (
                                        <input
                                            type="number"
                                            step="any"
                                            min={0}
                                            max={room}
                                            value={custom[row.id] ?? ''}
                                            placeholder="0"
                                            onChange={(e) =>
                                                setCustom({ ...custom, [row.id]: e.target.value })
                                            }
                                            aria-label={t('cpoDiscount.customOff', {
                                                n: row.installment_number ?? i + 1,
                                            })}
                                            className="w-20 rounded border border-neutral-200 px-1.5 py-0.5 text-end tabular-nums"
                                        />
                                    ) : (
                                        <span className="w-20 text-end text-neutral-400">
                                            {settled && row.plan_discount_share
                                                ? t('cpoDiscount.paidRowKeeps', {
                                                      amount: fmt(
                                                          row.plan_discount_share,
                                                          currency
                                                      ),
                                                  })
                                                : t('cpoDiscount.paidRow')}
                                        </span>
                                    ))}
                                {!isCustom && p && p.share > 0 && (
                                    <span className="tabular-nums text-success-700">
                                        −{fmt(p.share, currency)}
                                    </span>
                                )}
                                <span className="w-32 text-end tabular-nums text-neutral-700">
                                    {p &&
                                    request &&
                                    Math.abs(p.after - Number(row.amount_expected)) > 0.004 ? (
                                        <>
                                            <span className="text-neutral-400 line-through">
                                                {fmt(row.amount_expected, currency)}
                                            </span>{' '}
                                            <span className="font-semibold">
                                                {fmt(p.after, currency)}
                                            </span>
                                        </>
                                    ) : (
                                        fmt(row.amount_expected, currency)
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ul>

                {request && preview.data && !previewError && (
                    <p className="text-2xs text-neutral-600">
                        {t('cpoDiscount.totalOff', {
                            amount: fmt(preview.data.resolved_amount, currency),
                        })}
                        {capped && (
                            <span className="text-warning-700">
                                {' '}
                                {t('cpoDiscount.capped', {
                                    requested: fmt(preview.data.requested_amount, currency),
                                })}
                            </span>
                        )}
                    </p>
                )}
                {previewError && request && (
                    <p role="alert" className="text-2xs font-medium text-danger-600">
                        {previewError}
                    </p>
                )}

                <div>
                    <label className="block text-2xs text-neutral-500">
                        {t('cpoDiscount.reasonLabel')}
                    </label>
                    <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={t('cpoDiscount.reasonPlaceholder')}
                        className={`${input} w-full`}
                    />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                    {current && (
                        <button
                            type="button"
                            disabled={isPending}
                            onClick={remove}
                            className="rounded border border-neutral-200 px-3 py-1 text-2xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                        >
                            {t('cpoDiscount.remove')}
                        </button>
                    )}
                    <button
                        type="button"
                        disabled={isPending || !request || !!previewError || preview.isFetching}
                        onClick={apply}
                        className="rounded bg-primary-500 px-3 py-1 text-2xs font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
                    >
                        {isPending ? t('cpoDiscount.applying') : t('cpoDiscount.apply')}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ----------------------------------------------------------- Offline payment

interface OfflineProps {
    userPlanId: string;
    userId: string;
    outstanding: number;
    /** Outstanding on the earliest-due unpaid installment(s): what the payment usually covers. */
    nextDue: number;
    currency?: string | null;
}

/** Any amount, not tied to one installment: still settled oldest-due first. */
const OfflinePaymentForm = ({
    userPlanId,
    userId,
    outstanding,
    nextDue,
    currency,
}: OfflineProps) => {
    const { t } = useTranslation('manageStudentsCpoInstallmentsEditor');
    const [open, setOpen] = useState(false);

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded border border-primary-300 bg-primary-50 px-3 py-1 text-2xs font-medium text-primary-700 hover:bg-primary-100"
            >
                {t('offlinePayment.addPaymentButton')}
            </button>
        );
    }
    const quick =
        nextDue > 0 && outstanding > nextDue
            ? [
                  {
                      label: t('offlinePayment.nextDue', { amount: fmt(nextDue, currency) }),
                      amount: nextDue,
                  },
                  {
                      label: t('offlinePayment.allDues', { amount: fmt(outstanding, currency) }),
                      amount: outstanding,
                  },
              ]
            : [];
    return (
        <RecordPaymentPanel
            userPlanId={userPlanId}
            userId={userId}
            currency={currency}
            initialAmount={nextDue > 0 ? nextDue : Math.max(0, outstanding)}
            heading={t('offlinePayment.heading')}
            note={t('pay.anyAmountNote')}
            quickAmounts={quick}
            onDone={() => setOpen(false)}
        />
    );
};

// ----------------------------------------------------------- UserPlan card

interface CardProps {
    summary: CpoUserPlanSummary;
    userId: string;
}

const CpoUserPlanCard = ({ summary, userId }: CardProps) => {
    const { t } = useTranslation('manageStudentsCpoInstallmentsEditor');
    const [expanded, setExpanded] = useState(false);
    const { data, isLoading, isError } = useUserPlanInstallments(
        expanded ? summary.user_plan_id : null
    );
    // A package course is paid and rescheduled on its package, so all its courses stay on one
    // schedule; here it is shown, not changed.
    const inPackage = !!summary.admission_package_id;

    return (
        <div className="rounded-xl border border-neutral-200 bg-white">
            {/* Header */}
            <button
                type="button"
                onClick={() => setExpanded((x) => !x)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-neutral-50"
            >
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-800">
                        {summary.cpo_name || summary.payment_option_name || summary.cpo_id}
                    </p>
                    {summary.admission_package_id && (
                        <p className="text-2xs font-medium text-primary-600">{t('card.inPackage')}</p>
                    )}
                    <p className="mt-0.5 text-2xs text-neutral-500">
                        {t('card.installmentCount', { count: summary.installment_count })}
                        {' · '}
                        {t('card.net', { amount: fmt(summary.net_total, summary.currency) })}
                        {' · '}
                        {t('card.paid', { amount: fmt(summary.paid_total, summary.currency) })}
                        {' · '}
                        <span
                            className={
                                summary.outstanding_total > 0
                                    ? 'font-medium text-orange-700'
                                    : summary.outstanding_total < 0
                                      ? 'font-medium text-blue-700'
                                      : 'text-neutral-500'
                            }
                        >
                            {t('card.outstanding', {
                                amount: fmt(summary.outstanding_total, summary.currency),
                            })}
                        </span>
                    </p>
                </div>
                <span className="ml-2 text-xs text-neutral-400">{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div className="space-y-3 border-t border-neutral-100 px-4 py-3">
                    {isLoading && (
                        <p className="py-2 text-center text-2xs text-neutral-500">
                            {t('card.loadingInstallments')}
                        </p>
                    )}
                    {isError && (
                        <p className="py-2 text-center text-2xs text-red-600">
                            {t('card.loadInstallmentsError')}
                        </p>
                    )}
                    {data && (
                        <>
                            {data.installments.length > 0 && (
                                <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                                    {data.installments.map((row, idx) => (
                                        <InstallmentItem
                                            key={row.id}
                                            rows={data.installments}
                                            index={idx}
                                            userPlanId={data.user_plan_id}
                                            userId={userId}
                                            currency={summary.currency}
                                            readOnly={inPackage}
                                        />
                                    ))}
                                </ul>
                            )}

                            {inPackage ? (
                                <p className="rounded-lg bg-primary-50 px-3 py-2 text-2xs text-primary-700">
                                    {t('card.packageManaged')}
                                </p>
                            ) : (
                                <>
                                    <OfflinePaymentForm
                                        userPlanId={data.user_plan_id}
                                        userId={userId}
                                        outstanding={data.outstanding_total}
                                        nextDue={nextDueOutstanding(data.installments)}
                                        currency={summary.currency}
                                    />

                                    <CpoDiscountEditor
                                        userPlanId={data.user_plan_id}
                                        userId={userId}
                                        current={data.cpo_discount}
                                        rows={data.installments}
                                        currency={summary.currency}
                                    />
                                </>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

// ----------------------------------------------------------- Top-level

interface CpoInstallmentsEditorProps {
    userId: string;
}

/**
 * Side-view "CPO installments" section for a learner. Lists each CPO UserPlan
 * the learner is enrolled in; each card expands into a full installment editor
 * (per-installment dates / amount / discount), CPO-level discount control, and
 * an offline-payment recorder.
 */
export const CpoInstallmentsEditor = ({ userId }: CpoInstallmentsEditorProps) => {
    const { t } = useTranslation('manageStudentsCpoInstallmentsEditor');
    const { data, isLoading, isError } = useUserCpoUserPlans(userId);

    if (isLoading) {
        return <p className="py-2 text-2xs text-neutral-500">{t('loadingPlans')}</p>;
    }
    if (isError) {
        return <p className="py-2 text-2xs text-red-600">{t('loadPlansError')}</p>;
    }
    if (!data || data.length === 0) {
        return null; // not a CPO learner — silently skip the section
    }

    return (
        <div className="space-y-3">
            <AdmissionPackagesSection userId={userId} />
            {data.map((s) => (
                <CpoUserPlanCard key={s.user_plan_id} summary={s} userId={userId} />
            ))}
        </div>
    );
};
