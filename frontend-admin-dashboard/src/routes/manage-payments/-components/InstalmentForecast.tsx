import { CalendarDots } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney } from '@/utils/payment-currency';
import type { InstalmentForecast as InstalmentForecastData } from '@/services/payment-logs';

/** "Nov 2026" from yyyy-MM. */
export const formatForecastMonth = (month: string): string => {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return month;
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

/**
 * Instalments are the institute's main fee model: at least half its live plans are instalment
 * plans. Having one is not enough — Shiksha Nation holds 2 instalment plans against 14,000 one-time
 * ones, and a page that led with their schedule would bury everything it actually sells.
 *
 * Both counts come from the billing summary and cover the whole institute, not the date window or
 * course filter, so the answer does not flip as the admin filters. An older server sends no counts,
 * which reads as "not instalment-first": the page stays exactly as it was.
 */
export const isInstalmentFirst = (
    instalmentPlans: number | null | undefined,
    livePlans: number | null | undefined
): boolean =>
    typeof instalmentPlans === 'number' &&
    typeof livePlans === 'number' &&
    instalmentPlans > 0 &&
    instalmentPlans * 2 >= livePlans;

/** "6 Nov" from yyyy-MM-dd. */
const formatDay = (iso: string | null): string | null => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const plural = (n: number, one: string, many: string) =>
    `${n.toLocaleString()} ${n === 1 ? one : many}`;

interface InstalmentForecastProps {
    data: InstalmentForecastData | undefined;
    isLoading: boolean;
    error: unknown;
    currency: string;
    /** yyyy-MM of the month whose learners are listed below, if any. */
    selectedMonth: string | null;
    /** Picks a month (or clears it when the selected one is clicked again). */
    onSelectMonth: (month: string | null) => void;
    /**
     * What the Total card already says (collected, and outstanding for its total). When the
     * instalment plans ARE the whole fee book the progress row would repeat that card word for word,
     * so it is left out and the panel keeps only what the cards cannot show: the months.
     */
    cardTotals?: { collected: number; outstanding: number } | null;
}

/**
 * The instalment view of Manage Payments: how far the instalment plans have got, and when the rest
 * comes in, month by month. Clicking a month lists the learners who pay in it.
 *
 * Only rendered for institutes that run instalment plans. The months add up to the Upcoming card
 * above (same server rules); the progress bar covers instalment plans only, which is why it is
 * labelled as such rather than as the institute's whole fee book.
 */
export function InstalmentForecast({
    data,
    isLoading,
    error,
    currency,
    selectedMonth,
    onSelectMonth,
    cardTotals,
}: InstalmentForecastProps) {
    const money = (amount: number) => formatMoney(amount, currency, { maximumFractionDigits: 0 });

    if (error) {
        // The cards and the table still work without it — say so quietly rather than take the page down.
        return (
            <div className="rounded-xl border border-neutral-200 bg-white p-4 text-caption text-neutral-500">
                Couldn’t load the instalment schedule. The cards and lists below are unaffected.
            </div>
        );
    }

    if (isLoading || !data) {
        return (
            <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-2 w-full" />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-20 w-full" />
                    ))}
                </div>
            </div>
        );
    }

    const billed = data.instalment_billed;
    const repeatsCard =
        !!cardTotals &&
        Math.abs(data.instalment_paid - cardTotals.collected) < 1 &&
        Math.abs(billed - (cardTotals.collected + cardTotals.outstanding)) < 1;
    const hasProgress = data.instalment_plans > 0 && billed > 0 && !repeatsCard;
    const pct = (amount: number) => (billed > 0 ? Math.min(100, (amount / billed) * 100) : 0);
    const paidPct = Math.round(pct(data.instalment_paid));

    const months = data.months;
    const upcomingTotal = months.reduce((sum, m) => sum + m.amount, 0);
    const maxMonth = Math.max(...months.map((m) => m.amount), 0);

    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <CalendarDots size={15} weight="duotone" />
                    </span>
                    <span className="text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                        Instalment schedule
                    </span>
                </div>
                {data.instalment_plans > 0 && (
                    <span className="text-caption text-neutral-500">
                        {plural(data.instalment_plans, 'instalment plan', 'instalment plans')} ·{' '}
                        {plural(data.instalment_learners, 'learner', 'learners')}
                    </span>
                )}
            </div>

            {hasProgress && (
                <div className="mt-4">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-title font-semibold tabular-nums text-neutral-800">
                            {money(data.instalment_paid)}
                        </span>
                        <span className="text-body text-neutral-500">of {money(billed)} paid</span>
                        <span className="rounded-full bg-success-50 px-2 py-0.5 text-caption font-semibold text-success-700">
                            {paidPct}%
                        </span>
                    </div>

                    <div
                        className="mt-2 flex h-2 overflow-hidden rounded-full bg-neutral-100"
                        role="img"
                        aria-label={`${paidPct}% of instalment fees paid`}
                    >
                        {/* Segment widths are data, not design — the one place inline style is right. */}
                        <div
                            className="h-full bg-success-500"
                            style={{ width: `${pct(data.instalment_paid)}%` }}
                        />
                        <div
                            className="h-full bg-danger-500"
                            style={{ width: `${pct(data.instalment_overdue)}%` }}
                        />
                        <div
                            className="h-full bg-primary-500"
                            style={{ width: `${pct(data.instalment_to_come)}%` }}
                        />
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-neutral-600">
                        <LegendItem
                            dotClass="bg-success-500"
                            label="Paid"
                            value={money(data.instalment_paid)}
                        />
                        <LegendItem
                            dotClass="bg-danger-500"
                            label="Overdue"
                            value={money(data.instalment_overdue)}
                        />
                        <LegendItem
                            dotClass="bg-primary-500"
                            label="To come"
                            value={money(data.instalment_to_come)}
                        />
                    </div>
                </div>
            )}

            <div
                className={cn(
                    hasProgress && 'mt-4 border-t border-neutral-100 pt-4',
                    !hasProgress && 'mt-3'
                )}
            >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-caption font-semibold text-neutral-600">
                        Upcoming by month
                    </span>
                    {months.length > 0 && (
                        <span className="text-caption text-neutral-500">
                            {money(upcomingTotal)} over {plural(months.length, 'month', 'months')} ·
                            click a month to see who pays
                        </span>
                    )}
                </div>

                {months.length === 0 ? (
                    <p className="mt-2 text-caption text-neutral-500">
                        Nothing scheduled ahead in this view.
                    </p>
                ) : (
                    // One row, oldest first; a long schedule scrolls sideways rather than stacking
                    // rows of tiles above the table.
                    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                        {months.map((m) => {
                            const label = m.month ? formatForecastMonth(m.month) : 'No due date';
                            const firstDay = formatDay(m.first_due_on);
                            const isSelected = !!m.month && m.month === selectedMonth;
                            // An undated instalment has no month to list by — shown for the total, not clickable.
                            const clickable = !!m.month;
                            const body = (
                                <>
                                    <div className="text-caption font-medium text-neutral-500">
                                        {label}
                                    </div>
                                    <div className="mt-1 text-subtitle font-semibold tabular-nums text-neutral-800">
                                        {money(m.amount)}
                                    </div>
                                    <div className="mb-2 text-2xs text-neutral-500">
                                        {plural(m.learners, 'learner', 'learners')}
                                        {firstDay ? ` · from ${firstDay}` : ''}
                                    </div>
                                    <div className="mt-auto h-1 w-full overflow-hidden rounded-full bg-neutral-100">
                                        {/* Bar length is the month's share of the busiest month. */}
                                        <div
                                            className={cn(
                                                'h-full rounded-full',
                                                isSelected ? 'bg-primary-500' : 'bg-primary-300'
                                            )}
                                            style={{
                                                width: `${maxMonth > 0 ? Math.max(4, (m.amount / maxMonth) * 100) : 0}%`,
                                            }}
                                        />
                                    </div>
                                </>
                            );
                            const tileClass = cn(
                                'flex w-40 shrink-0 flex-col rounded-lg border p-3 text-left transition-all',
                                isSelected
                                    ? 'border-primary-300 bg-primary-50 ring-1 ring-primary-100'
                                    : 'border-neutral-200',
                                clickable &&
                                    'cursor-pointer hover:border-neutral-300 hover:shadow-sm'
                            );
                            return clickable ? (
                                <button
                                    key={m.month}
                                    type="button"
                                    aria-pressed={isSelected}
                                    onClick={() => onSelectMonth(isSelected ? null : m.month)}
                                    className={tileClass}
                                >
                                    {body}
                                </button>
                            ) : (
                                <div key="undated" className={tileClass}>
                                    {body}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function LegendItem({
    dotClass,
    label,
    value,
}: {
    dotClass: string;
    label: string;
    value: string;
}) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', dotClass)} />
            {label}
            <span className="font-medium tabular-nums text-neutral-800">{value}</span>
        </span>
    );
}
