import { cn } from '@/lib/utils';

interface MoneyCellProps {
    /** Amount as returned by the API — number or numeric string (BigDecimal serializes as either). */
    value: number | string | null | undefined;
    /** ISO currency code from the record (payroll stamps this per entry). Defaults to INR. */
    currency?: string | null;
    /** Show the currency code alongside the amount — use in mixed-currency lists. */
    showCurrency?: boolean;
    /** Render zero as a muted dash instead of 0.00 — keeps sparse columns readable. */
    dashOnZero?: boolean;
    /** Emphasise as a deduction (danger) or an earning (neutral). */
    tone?: 'default' | 'deduction' | 'earning';
    className?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
    INR: '₹',
    AED: 'AED ',
    SAR: 'SAR ',
    USD: '$',
    GBP: '£',
    EUR: '€',
};

/** Grouped, 2-decimal amount — no Cr/L abbreviation: payroll figures must reconcile exactly. */
export function formatMoney(value: number | string | null | undefined, currency = 'INR'): string {
    const numeric = typeof value === 'string' ? Number(value) : (value ?? 0);
    if (!Number.isFinite(numeric)) return '—';
    const symbol = CURRENCY_SYMBOLS[currency?.toUpperCase() ?? 'INR'] ?? `${currency} `;
    return `${symbol}${numeric.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

/**
 * A money amount in a table cell.
 *
 * Right-aligned with `tabular-nums` so columns of figures line up digit-for-digit —
 * the thing that makes a payroll register scannable. Deliberately NOT
 * `formatCurrency` from finance-utils: that abbreviates to Cr/L for dashboard
 * headlines, and an payslip line reading "₹1.2L" instead of "₹1,20,450.00" is
 * unusable for reconciliation.
 */
export const MoneyCell = ({
    value,
    currency = 'INR',
    showCurrency = false,
    dashOnZero = false,
    tone = 'default',
    className,
}: MoneyCellProps) => {
    const numeric = typeof value === 'string' ? Number(value) : (value ?? 0);
    const isZero = !Number.isFinite(numeric) || numeric === 0;

    if (dashOnZero && isZero) {
        return <span className={cn('block text-end text-neutral-300', className)}>—</span>;
    }

    return (
        <span
            className={cn(
                'block text-end tabular-nums',
                tone === 'deduction' && 'text-danger-600',
                tone === 'earning' && 'text-success-600',
                className
            )}
        >
            {formatMoney(value, currency ?? 'INR')}
            {showCurrency && (
                <span className="ms-1 text-caption text-neutral-400">
                    {(currency ?? 'INR').toUpperCase()}
                </span>
            )}
        </span>
    );
};
