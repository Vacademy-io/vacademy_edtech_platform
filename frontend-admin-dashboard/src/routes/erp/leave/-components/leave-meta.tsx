import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import type { ChipToggleOption } from '@/components/design-system/chips';
import type { Money } from '@/routes/erp/-shared/hr-types';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';

/**
 * Labels, option lists and cell renderers shared by the three Leave screens.
 *
 * Leave is counted in DAYS, not currency — a half day is 0.5 — so it never goes
 * through `MoneyCell`. `formatDays` is the one place that decides how a decimal
 * day is written, so the requests table, the balance matrix and the comp-off
 * table can't drift into three different renderings of "0.5".
 */

/** `Money` is the platform's number-or-numeric-string wire type; leave uses it for day counts. */
export const toNumber = (value: Money | number | undefined): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

/**
 * `1` → "1", `0.5` → "0.5", `1.25` → "1.25", nothing → "—".
 *
 * Deliberately not `toLocaleString`: day counts are small and a locale-grouped
 * "1,000" would be wrong here, and a locale-less call is an i18n-gate failure.
 */
export const formatDays = (value: Money | number | undefined): string => {
    const parsed = toNumber(value);
    if (parsed === null) return '—';
    return String(Number(parsed.toFixed(2)));
};

export const DaysCell = ({
    value,
    emphasis = false,
}: {
    value: Money | number | undefined;
    emphasis?: boolean;
}) => (
    <span
        className={cn(
            'block text-end tabular-nums',
            emphasis ? 'text-body font-semibold text-foreground' : 'text-body text-muted-foreground'
        )}
    >
        {formatDays(value)}
    </span>
);

/** APPROVED reads as success, REJECTED/CANCELLED as danger, PENDING as needs-attention. */
export const leaveStatusTone = (status: string | null | undefined): StatusType => {
    switch ((status ?? '').toUpperCase()) {
        case 'APPROVED':
            return 'SUCCESS';
        case 'REJECTED':
        case 'CANCELLED':
            return 'DANGER';
        case 'PENDING':
            return 'WARNING';
        default:
            return 'INFO';
    }
};

/** `NOTICE_PERIOD` → `Notice period`. Mirrors the People module's token humanizer. */
export const humanizeToken = (token: string | null | undefined): string => {
    if (!token) return '';
    const lower = token.replace(/_/g, ' ').toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
};

export const LeaveStatusChip = ({ status }: { status: string | null | undefined }) => {
    if (!status) return <span className="text-caption text-muted-foreground">—</span>;
    return (
        <StatusChip
            text={humanizeToken(status)}
            textSize="text-caption"
            status={leaveStatusTone(status)}
            showIcon={false}
        />
    );
};

export type LeaveStatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ALL';

export const LEAVE_STATUS_FILTERS: ChipToggleOption<LeaveStatusFilter>[] = [
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'CANCELLED', label: 'Cancelled' },
    { value: 'ALL', label: 'All' },
];

export const ACCRUAL_TYPE_LABELS: Record<string, string> = {
    MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly',
    YEARLY: 'Yearly',
};

export const ACCRUAL_TYPE_OPTIONS = ['MONTHLY', 'QUARTERLY', 'YEARLY'].map((value) => ({
    _id: value,
    value,
    label: ACCRUAL_TYPE_LABELS[value] ?? value,
}));

export const GENDER_LABELS: Record<string, string> = {
    ALL: 'All',
    MALE: 'Male',
    FEMALE: 'Female',
};

export const GENDER_OPTIONS = ['ALL', 'MALE', 'FEMALE'].map((value) => ({
    _id: value,
    value,
    label: GENDER_LABELS[value] ?? value,
}));

export const RECORD_STATUS_OPTIONS = [
    { _id: 'ACTIVE', value: 'ACTIVE', label: 'Active' },
    { _id: 'INACTIVE', value: 'INACTIVE', label: 'Inactive' },
];

/** The leave years an admin realistically looks at: last three, this one, and the next. */
export const recentLeaveYears = (): number[] => {
    const current = new Date().getFullYear();
    return [current + 1, current, current - 1, current - 2, current - 3];
};

/** `EMP001 · Jane Doe`, degrading to whichever half the API actually returned. */
export const employeeLabel = (
    name: string | null | undefined,
    code: string | null | undefined
): string => {
    const cleanName = name?.trim();
    const cleanCode = code?.trim();
    if (cleanName && cleanCode) return `${cleanCode} · ${cleanName}`;
    return cleanName || cleanCode || i18n.t('erpLeaveMeta:employeeFallback');
};
