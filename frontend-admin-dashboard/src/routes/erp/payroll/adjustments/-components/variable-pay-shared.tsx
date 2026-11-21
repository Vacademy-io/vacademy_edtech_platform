import { Link } from '@tanstack/react-router';
import { Trans, useTranslation } from 'react-i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import { cn } from '@/lib/utils';
import type { Money } from '@/routes/erp/-shared/hr-types';

/**
 * Small pieces the Teaching Pay and Incentives tabs both need.
 *
 * Kept local to this route rather than promoted to the ERP shared folder: both
 * users of them are on this screen, and the wording ("not on the HR roster") is
 * specific to variable pay, where the consequence of the gap is that someone does
 * not get paid.
 */

/**
 * The note on a person the pay run cannot reach.
 *
 * Both endpoints return these people rather than hiding them — someone who taught
 * forty classes or closed nine deals and has no employee record is a problem you
 * want on screen, not filtered out. Staff Coverage is the one place an HR profile
 * is created from an existing staff account, so the note goes straight there
 * instead of describing the fix in prose.
 */
export const NoProfileNote = ({ className }: { className?: string }) => {
    const { t } = useTranslation('erpVariablePayShared');
    return (
        <span className={cn('text-caption text-neutral-500', className)}>
            <Trans i18nKey="noProfileNote" t={t}>
                Not linked to an employee record —{' '}
                <Link
                    to="/erp/people/staff-bridge"
                    className="text-primary-500 underline-offset-2 hover:underline"
                >
                    create one in Staff Coverage
                </Link>
            </Trans>
        </span>
    );
};

/**
 * The note on a teacher whose pay cannot be computed.
 *
 * Named rather than described: the rate is read from two exact custom-field keys
 * on the employee, and an admin who is told only "no rate" has to go and find out
 * which field that means.
 */
export const UnratedNote = ({ className }: { className?: string }) => {
    const { t } = useTranslation('erpVariablePayShared');
    return (
        <span className={cn('text-caption text-warning-700', className)}>
            <Trans i18nKey="unratedNote" t={t}>
                No rate set — add <span className="font-mono">teaching_rate_per_session</span> or{' '}
                <span className="font-mono">teaching_rate_per_hour</span> to this
                employee&apos;s custom fields
            </Trans>
        </span>
    );
};

/** A headline figure above a preview table. Mirrors ERP → Compliance's stat tiles. */
export const VariablePayStat = ({
    label,
    value,
    currency,
    isMoney = false,
}: {
    label: string;
    value: Money | number | undefined;
    currency?: string;
    isMoney?: boolean;
}) => (
    <div className="flex flex-col gap-1 rounded-md border border-neutral-200 px-4 py-3">
        <span className="text-caption text-neutral-500">{label}</span>
        {isMoney ? (
            <MoneyCell value={value ?? null} currency={currency} className="text-start" />
        ) : (
            <span className="text-subtitle font-medium tabular-nums text-neutral-700">
                {value ?? '—'}
            </span>
        )}
    </div>
);

/** Minutes as payable hours, one decimal. Falls back to a dash, never to "NaN". */
export const formatHours = (minutes: number | undefined | null): string => {
    if (minutes === undefined || minutes === null || !Number.isFinite(minutes)) return '—';
    return (minutes / 60).toFixed(1);
};

/** A count that may legitimately be zero — 0 prints as 0, absent prints as a dash. */
export const formatCount = (value: number | undefined | null): string =>
    value === undefined || value === null || !Number.isFinite(value) ? '—' : String(value);
