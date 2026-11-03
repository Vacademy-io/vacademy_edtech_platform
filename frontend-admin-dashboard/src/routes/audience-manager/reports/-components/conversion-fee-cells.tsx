/**
 * Money columns of a converted lead — the course fee it enrolled at, what is paid, how many
 * installments are paid, and the next installment — shared by the Conversions tab's lead list and
 * the Counsellors tab's converted-leads drill-down so both read (and export) the same way.
 */
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { fmtCurrency, fmtDay } from './report-shared';
import type { CsvCell } from '../-utils/export-csv';

/** The money side of one row (an enrolment, or a student's enrolments added up). */
export interface FeeSummary {
    /** null = no fee plan on this row. */
    fee: number | null;
    paid: number | null;
    installments: number | null;
    installments_paid: number | null;
    next_due_amount: number | null;
    next_due_date: string | null;
    /** The plan's amounts sit on another row (one plan bought for several courses). */
    plan_shared: boolean;
}

const hasPlan = (f: FeeSummary) => f.fee != null;

export function FeeCell({ fee, currency }: { fee: FeeSummary; currency: string }) {
    const { t } = useTranslation('audienceManagerConversionsTab');
    if (!hasPlan(fee))
        return fee.plan_shared ? (
            <span className="text-xs italic text-neutral-500">{t('fee.sharedPlan')}</span>
        ) : (
            <span className="text-neutral-400">—</span>
        );
    return (
        <span className="font-medium tabular-nums text-neutral-900">
            {fmtCurrency(fee.fee, currency)}
        </span>
    );
}

export function PaidCell({ fee, currency }: { fee: FeeSummary; currency: string }) {
    const { t } = useTranslation('audienceManagerConversionsTab');
    if (!hasPlan(fee)) return <span className="text-neutral-400">—</span>;
    const balance = Math.max(0, (fee.fee ?? 0) - (fee.paid ?? 0));
    return (
        <div className="tabular-nums">
            <div className="font-medium text-success-700">
                {fmtCurrency(fee.paid ?? 0, currency)}
            </div>
            {balance > 0 && (
                <div className="text-xs text-neutral-500">
                    {t('fee.balance', { amount: fmtCurrency(balance, currency) })}
                </div>
            )}
        </div>
    );
}

export function InstallmentsCell({ fee }: { fee: FeeSummary }) {
    const { t } = useTranslation('audienceManagerConversionsTab');
    if (!hasPlan(fee) || !fee.installments) return <span className="text-neutral-400">—</span>;
    const done = fee.installments_paid ?? 0;
    return (
        <span
            className={cn(
                'whitespace-nowrap tabular-nums',
                done >= fee.installments ? 'text-success-700' : 'text-neutral-800'
            )}
        >
            {t('fee.installmentsOf', { paid: done, total: fee.installments })}
        </span>
    );
}

export function NextInstallmentCell({ fee, currency }: { fee: FeeSummary; currency: string }) {
    const { t } = useTranslation('audienceManagerConversionsTab');
    if (!hasPlan(fee)) return <span className="text-neutral-400">—</span>;
    if (fee.next_due_amount == null)
        return <span className="font-medium text-success-700">{t('fee.fullyPaid')}</span>;
    const overdue = fee.next_due_date != null && fee.next_due_date < todayIso();
    return (
        <div className="tabular-nums">
            <div className="font-medium text-neutral-900">
                {fmtCurrency(fee.next_due_amount, currency)}
            </div>
            {fee.next_due_date && (
                <div
                    className={cn(
                        'whitespace-nowrap text-xs',
                        overdue ? 'text-danger-600' : 'text-neutral-500'
                    )}
                >
                    {t(overdue ? 'fee.overdueSince' : 'fee.dueOn', {
                        date: fmtDay(fee.next_due_date),
                    })}
                </div>
            )}
        </div>
    );
}

/** CSV headers for the money columns, in the order {@link feeCsvValues} returns them. */
export function feeCsvHeaders(t: (key: string) => unknown): string[] {
    return [
        'column.fee',
        'column.paid',
        'column.balance',
        'column.installmentsPaid',
        'column.installments',
        'column.nextInstallment',
        'column.nextDueDate',
    ].map((k) => String(t(k)));
}

export function feeCsvValues(f: FeeSummary): CsvCell[] {
    if (!hasPlan(f)) return [null, null, null, null, null, null, null];
    return [
        f.fee,
        f.paid ?? 0,
        Math.max(0, (f.fee ?? 0) - (f.paid ?? 0)),
        f.installments_paid,
        f.installments,
        f.next_due_amount,
        f.next_due_date ? fmtDay(f.next_due_date) : null,
    ];
}

/**
 * Adds one enrolment's money into a student's running total. Rows whose plan sits on another
 * row add nothing; the next installment is the earliest one due (amounts due that day add up).
 */
export function addFee(into: FeeSummary, row: FeeSummary): FeeSummary {
    if (!hasPlan(row)) return { ...into, plan_shared: into.plan_shared || row.plan_shared };
    const out: FeeSummary = {
        ...into,
        fee: (into.fee ?? 0) + (row.fee ?? 0),
        paid: (into.paid ?? 0) + (row.paid ?? 0),
        installments: (into.installments ?? 0) + (row.installments ?? 0),
        installments_paid: (into.installments_paid ?? 0) + (row.installments_paid ?? 0),
    };
    if (row.next_due_amount != null) {
        const a = into.next_due_date;
        const b = row.next_due_date;
        if (into.next_due_amount == null || (b != null && (a == null || b < a))) {
            out.next_due_amount = row.next_due_amount;
            out.next_due_date = b;
        } else if (a === b) {
            out.next_due_amount = (into.next_due_amount ?? 0) + row.next_due_amount;
        }
    }
    return out;
}

export const EMPTY_FEE: FeeSummary = {
    fee: null,
    paid: null,
    installments: null,
    installments_paid: null,
    next_due_amount: null,
    next_due_date: null,
    plan_shared: false,
};

function todayIso(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
