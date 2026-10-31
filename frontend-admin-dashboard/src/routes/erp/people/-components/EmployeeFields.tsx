import type { TFunction } from 'i18next';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { cn } from '@/lib/utils';

/**
 * Shared vocabulary for the People screens: how HR enum tokens are labelled, how a
 * status maps to a chip tone, the masked-value rule, and the read-only field row
 * used by the detail tabs.
 */

/** `NOTICE_PERIOD` → `Notice period`. Backend enums are the source of truth; this is display only. */
export const humanizeToken = (value: string | null | undefined): string => {
    if (!value) return '';
    const spaced = value.replace(/_/g, ' ').toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Sentinel for "no selection" — Radix Select rejects an empty-string item value. */
export const NONE_VALUE = '__none__';

/**
 * Detail tabs. Declared here rather than in the route files so the route stub can
 * validate `?tab=` and the lazy component can render it without importing each
 * other.
 */
export type EmployeeDetailTab = 'profile' | 'salary' | 'employment';

export const EMPLOYEE_DETAIL_TABS: EmployeeDetailTab[] = ['profile', 'salary', 'employment'];

/** Options shape expected by `SelectField`. */
export interface SelectOption {
    _id: string;
    value: string;
    label: string;
}

export const toSelectOptions = (
    rows: Array<{ id?: string; name?: string }> | undefined,
    noneLabel?: string
): SelectOption[] => {
    const options = (rows ?? [])
        .filter((row) => !!row.id)
        .map((row) => ({ _id: row.id!, value: row.id!, label: row.name || row.id! }));
    return noneLabel
        ? [{ _id: NONE_VALUE, value: NONE_VALUE, label: noneLabel }, ...options]
        : options;
};

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;

const EMPLOYMENT_TYPE_LABEL_KEYS: Record<(typeof EMPLOYMENT_TYPES)[number], string> = {
    FULL_TIME: 'employmentType.fullTime',
    PART_TIME: 'employmentType.partTime',
    CONTRACT: 'employmentType.contract',
    INTERN: 'employmentType.intern',
};

/**
 * Module-scope constant (a `SelectOption[]`), so this is a `buildXxx(t)` factory —
 * every call site must pass a `t` whose loaded namespaces include
 * `erpEmployeeFields` (add it to that component's `useTranslation([...])` array).
 */
export const buildEmploymentTypeOptions = (t: TFunction): SelectOption[] =>
    EMPLOYMENT_TYPES.map((type) => ({
        _id: type,
        value: type,
        label: t(`erpEmployeeFields:${EMPLOYMENT_TYPE_LABEL_KEYS[type]}`),
    }));

export const EMPLOYMENT_STATUSES = [
    'ACTIVE',
    'PROBATION',
    'NOTICE_PERIOD',
    'ON_LEAVE',
    'TERMINATED',
    'RELIEVED',
    'ABSCONDING',
] as const;

const EMPLOYMENT_STATUS_LABEL_KEYS: Record<(typeof EMPLOYMENT_STATUSES)[number], string> = {
    ACTIVE: 'employmentStatus.active',
    PROBATION: 'employmentStatus.probation',
    NOTICE_PERIOD: 'employmentStatus.noticePeriod',
    ON_LEAVE: 'employmentStatus.onLeave',
    TERMINATED: 'employmentStatus.terminated',
    RELIEVED: 'employmentStatus.relieved',
    ABSCONDING: 'employmentStatus.absconding',
};

/** Same `erpEmployeeFields` namespace requirement as {@link buildEmploymentTypeOptions}. */
export const buildEmploymentStatusOptions = (t: TFunction): SelectOption[] =>
    EMPLOYMENT_STATUSES.map((status) => ({
        _id: status,
        value: status,
        label: t(`erpEmployeeFields:${EMPLOYMENT_STATUS_LABEL_KEYS[status]}`),
    }));

/**
 * Statuses that end the employment. Choosing one of these requires a last working
 * date and a reason, because full-and-final settlement is computed from them.
 */
export const EXIT_STATUSES: string[] = ['TERMINATED', 'RELIEVED', 'ABSCONDING'];

export const isExitStatus = (status: string | null | undefined): boolean =>
    EXIT_STATUSES.includes((status ?? '').toUpperCase());

export const employmentStatusTone = (status: string | null | undefined): StatusType => {
    switch ((status ?? '').toUpperCase()) {
        case 'ACTIVE':
            return 'SUCCESS';
        case 'PROBATION':
        case 'NOTICE_PERIOD':
            return 'WARNING';
        case 'TERMINATED':
        case 'RELIEVED':
        case 'ABSCONDING':
            return 'DANGER';
        default:
            return 'INFO';
    }
};

export const EmploymentStatusChip = ({ status }: { status: string | null | undefined }) => {
    if (!status) return <span className="text-caption text-muted-foreground">—</span>;
    return (
        <StatusChip
            text={humanizeToken(status)}
            textSize="text-caption"
            status={employmentStatusTone(status)}
            showIcon={false}
        />
    );
};

/**
 * True when the API returned a masked value (`****1234`) instead of the real one.
 *
 * PAN/UAN come back masked for everyone, so an edit form must never echo the mask
 * back in the payload — that would overwrite the stored number with asterisks.
 */
export const isMaskedValue = (value: string | null | undefined): boolean =>
    !!value && value.includes('*');

/**
 * Placeholder used for a masked field the user has left alone. Same
 * `erpEmployeeFields` namespace requirement as {@link buildEmploymentTypeOptions}.
 */
export const buildUnchangedPlaceholder = (t: TFunction): string =>
    t('erpEmployeeFields:unchangedPlaceholder');

/** One label/value pair in a read-only detail grid. */
export const DetailField = ({
    label,
    value,
    className,
}: {
    label: string;
    value?: React.ReactNode;
    className?: string;
}) => {
    const isEmpty = value === null || value === undefined || value === '' || value === false;
    return (
        <div className={cn('flex flex-col gap-1', className)}>
            <span className="text-caption text-muted-foreground">{label}</span>
            {isEmpty ? (
                <span className="text-body text-muted-foreground">—</span>
            ) : typeof value === 'string' || typeof value === 'number' ? (
                <span className="break-words text-body text-foreground">{value}</span>
            ) : (
                value
            )}
        </div>
    );
};
