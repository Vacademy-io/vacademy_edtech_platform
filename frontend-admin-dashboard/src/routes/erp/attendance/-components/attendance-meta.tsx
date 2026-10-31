import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { getActiveLocale } from '@/lib/formatters';
import { humanizeToken } from '@/routes/erp/people/-components/EmployeeFields';
import type { AttendanceStatus } from '@/routes/erp/-shared/hr-types';

/**
 * Vocabulary shared by the three Attendance screens.
 *
 * Kept out of the screens themselves so the daily board, the regularization queue
 * and the setup tabs colour and word a status identically — a day that reads
 * "On leave" in one place and "ON_LEAVE" in another is the same record twice.
 */

/**
 * Status → chip tone.
 *
 * PRESENT is the only positive outcome, ABSENT the only bad one. HALF_DAY and
 * ON_LEAVE are warnings because both cost pay days; HOLIDAY and WEEKEND are
 * informational — the institute's calendar produced them, nobody did anything
 * wrong. COMP_OFF is a granted day off, so it reads as informational too.
 */
const STATUS_TONE: Record<string, StatusType> = {
    PRESENT: 'SUCCESS',
    ABSENT: 'DANGER',
    HALF_DAY: 'WARNING',
    ON_LEAVE: 'WARNING',
    HOLIDAY: 'INFO',
    WEEKEND: 'INFO',
    COMP_OFF: 'INFO',
};

export const attendanceStatusTone = (status: string | null | undefined): StatusType =>
    STATUS_TONE[(status ?? '').toUpperCase()] ?? 'INFO';

/** The chip used for an attendance status anywhere in the module. */
export const AttendanceStatusChip = ({ status }: { status?: string | null }) => {
    const { t } = useTranslation('erpAttendanceMeta');
    if (!status) {
        return <span className="text-body text-muted-foreground">{t('notMarked')}</span>;
    }
    return (
        <StatusChip
            text={humanizeToken(status)}
            textSize="text-caption"
            status={attendanceStatusTone(status)}
            showIcon={false}
        />
    );
};

/**
 * The statuses an admin may set by hand.
 *
 * HOLIDAY and WEEKEND are deliberately absent: they are derived from the holiday
 * calendar and the weekend-days configuration under Shifts & Holidays. Marking
 * one by hand would produce a day the calendar disagrees with, and the next
 * recalculation would silently overwrite it.
 */
export const MARKABLE_STATUSES: AttendanceStatus[] = [
    'PRESENT',
    'ABSENT',
    'HALF_DAY',
    'ON_LEAVE',
    'COMP_OFF',
];

export const REGULARIZATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type RegularizationStatus = (typeof REGULARIZATION_STATUSES)[number];

export const regularizationTone = (status: string | null | undefined): StatusType => {
    switch ((status ?? '').toUpperCase()) {
        case 'APPROVED':
            return 'SUCCESS';
        case 'REJECTED':
            return 'DANGER';
        default:
            return 'WARNING';
    }
};

/** Day names as the backend stores them in `weekend_days`. */
export const WEEKDAYS = [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
] as const;

export const HOLIDAY_TYPES = ['NATIONAL', 'REGIONAL', 'OPTIONAL', 'RESTRICTED'] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];

export const ATTENDANCE_MODES = ['TIME_TRACKING', 'DAY_LEVEL'] as const;

/** Today as `YYYY-MM-DD` in the browser's own day, which is what a date input expects. */
export const todayIso = (): string => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
};

/**
 * The `YYYY-MM-DD` part of whatever the API returned.
 *
 * `attendance_date` comes back as a bare date from LocalDate columns but as a
 * full instant from a few projections, so comparing raw strings to the picked
 * day would drop half the rows.
 */
export const dateOnly = (value: string | null | undefined): string => (value ?? '').slice(0, 10);

/** 1-12 month and year of an ISO date string, falling back to today. */
export const monthOf = (isoDate: string): { month: number; year: number } => {
    const [year, month] = dateOnly(isoDate).split('-');
    const parsedYear = Number(year);
    const parsedMonth = Number(month);
    if (!Number.isFinite(parsedYear) || !Number.isFinite(parsedMonth) || !parsedMonth) {
        const now = new Date();
        return { month: now.getMonth() + 1, year: now.getFullYear() };
    }
    return { month: parsedMonth, year: parsedYear };
};

/**
 * A clock time for the table.
 *
 * Check-in/out arrive either as a bare `HH:mm:ss` (LocalTime) or as a full
 * instant, depending on the endpoint — both have to render as a time, never as
 * a raw string or an "Invalid Date".
 */
export const formatClockTime = (value: string | null | undefined): string => {
    if (!value) return '—';
    if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(getActiveLocale(), {
        hour: 'numeric',
        minute: '2-digit',
    }).format(parsed);
};

/** `HH:mm` from an input, widened to the `HH:mm:ss` the backend's LocalTime parser wants. */
export const toBackendTime = (value: string | null | undefined): string | undefined => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return undefined;
    return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
};

/** `HH:mm` for a time input, from whatever shape the record holds. */
export const toTimeInput = (value: string | null | undefined): string =>
    value && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : '';

/** Money-typed counts come back as numbers or numeric strings; sum them safely. */
export const toNumber = (value: number | string | null | undefined): number => {
    const numeric = typeof value === 'string' ? Number(value) : value ?? 0;
    return Number.isFinite(numeric) ? numeric : 0;
};

/** A small labelled figure, matching the compliance stat tiles. */
export const AttendanceStat = ({
    label,
    value,
    hint,
}: {
    label: string;
    value: string | number;
    hint?: string;
}) => (
    <div className="flex min-w-32 flex-1 flex-col gap-1 rounded-md border border-border px-4 py-3">
        <span className="text-caption text-muted-foreground">{label}</span>
        <span className="text-subtitle font-medium tabular-nums text-foreground">{value}</span>
        {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
    </div>
);
