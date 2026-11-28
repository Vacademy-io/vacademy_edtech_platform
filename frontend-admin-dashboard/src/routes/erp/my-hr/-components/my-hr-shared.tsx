import type { ReactNode } from 'react';
import { IdentificationBadge } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Money } from '@/routes/erp/-shared/hr-types';
import { HrEmptyState } from '@/routes/erp/people/-components/HrStates';
import { humanizeToken } from '@/routes/erp/leave/-components/leave-meta';

/**
 * Vocabulary and small pieces shared by the five My HR screens.
 *
 * My HR is the same API surface as the admin ERP modules seen from the other
 * side of the guard, so the wording is the thing that has to differ: an employee
 * reads "You have not applied for any leave", never "No applications for
 * employee EMP0142". Keeping the phrasing decisions here stops the five screens
 * drifting into five different tones.
 */

/**
 * A list out of whatever the endpoint returned.
 *
 * Three of the endpoints these screens read (`/leaves/applications`,
 * `/payroll/reimbursements`) answer with a Spring `Page` while the rest answer
 * with a bare array, and the shared fetchers in `hr-service` hand both back
 * untouched. Spreading a Page object throws ("is not iterable"), so every list
 * on these screens goes through here rather than trusting the declared type.
 */
export function asList<T>(payload: unknown): T[] {
    if (Array.isArray(payload)) return payload as T[];
    const content = (payload as { content?: unknown } | null | undefined)?.content;
    return Array.isArray(content) ? (content as T[]) : [];
}

/**
 * `hr_reimbursement` and `hr_employee_loan` rows.
 *
 * Declared here rather than in `erp/-shared/hr-types` because My Claims is the
 * only screen that reads them — the shared fetchers (`fetchMyReimbursements`,
 * `fetchMyLoans`) are deliberately untyped, and inventing shared types for a
 * single consumer would put them out of sight of the screen that has to keep
 * them honest. Field names mirror the backend DTOs exactly (snake_case).
 */
export interface ReimbursementDTO {
    id?: string;
    employee_id?: string;
    employee_code?: string;
    institute_id?: string;
    type?: string;
    amount?: Money;
    description?: string;
    receipt_file_id?: string;
    expense_date?: string;
    status?: string;
    approved_by?: string;
    rejection_reason?: string;
    currency?: string;
}

export interface EmployeeLoanDTO {
    id?: string;
    employee_id?: string;
    employee_code?: string;
    institute_id?: string;
    loan_type?: string;
    principal_amount?: Money;
    interest_rate?: Money;
    tenure_months?: number;
    emi_amount?: Money;
    disbursed_amount?: Money;
    balance_amount?: Money;
    start_month?: number;
    start_year?: number;
    status?: string;
    notes?: string;
    currency?: string;
}

/** The claim types the backend's `ReimbursementType` enum accepts. */
export const REIMBURSEMENT_TYPES = [
    'TRAVEL',
    'MEDICAL',
    'FOOD',
    'PHONE',
    'INTERNET',
    'OTHER',
] as const;

export type ReimbursementType = (typeof REIMBURSEMENT_TYPES)[number];

/**
 * Status → chip tone, for every status these screens show.
 *
 * Read from the employee's point of view: APPROVED/ACTIVE/VERIFIED are
 * settled-in-your-favour, PENDING/SUBMITTED are waiting on someone else, and
 * REJECTED is the only bad outcome. LOCKED and CLOSED are neutral facts — a
 * closed loan is good news, not a failure, so neither gets a danger tone.
 */
export const myHrStatusTone = (status: string | null | undefined): StatusType => {
    switch ((status ?? '').toUpperCase()) {
        case 'APPROVED':
        case 'ACTIVE':
        case 'VERIFIED':
        case 'PAID':
        case 'SENT':
            return 'SUCCESS';
        case 'REJECTED':
        case 'FAILED':
            return 'DANGER';
        case 'PENDING':
        case 'SUBMITTED':
        case 'DRAFT':
            return 'WARNING';
        default:
            return 'INFO';
    }
};

export const MyHrStatusChip = ({ status }: { status?: string | null }) => {
    if (!status) return <span className="text-caption text-muted-foreground">—</span>;
    return (
        <StatusChip
            text={humanizeToken(status)}
            textSize="text-caption"
            status={myHrStatusTone(status)}
            showIcon={false}
        />
    );
};

/** A labelled figure, matching the stat tiles the admin ERP screens use. */
export const MyHrStat = ({
    label,
    value,
    hint,
    tone = 'default',
}: {
    label: string;
    value: ReactNode;
    hint?: string;
    tone?: 'default' | 'positive' | 'negative';
}) => (
    <div className="flex min-w-28 flex-1 flex-col gap-1 rounded-md border border-border px-4 py-3">
        <span className="text-caption text-muted-foreground">{label}</span>
        <span
            className={cn(
                'text-subtitle font-medium tabular-nums',
                tone === 'positive' && 'text-success-600',
                tone === 'negative' && 'text-danger-600',
                tone === 'default' && 'text-foreground'
            )}
        >
            {value}
        </span>
        {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
    </div>
);

/** One labelled read-only value in the profile card. */
export const MyHrDetail = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className="flex flex-col gap-0.5">
        <span className="text-caption text-muted-foreground">{label}</span>
        <span className="break-words text-body text-foreground">{value || '—'}</span>
    </div>
);

/**
 * Shown on every My HR screen when the signed-in user has no employee record.
 *
 * Not an error and not a permission wall: plenty of admins at an institute that
 * has not onboarded payroll simply are not employees in the HR sense, and every
 * fetcher on these screens needs an employee id to ask for anything. There is no
 * self-serve fix, so this points at the only person who can create the record.
 */
export const MyHrNoProfileState = () => {
    const { t } = useTranslation('erpMyHrShared');
    return (
        <HrEmptyState
            icon={<IdentificationBadge size={40} className="text-muted-foreground" />}
            title={t('noProfile.title')}
            description={t('noProfile.description')}
        />
    );
};

/** Card-shaped skeleton for the tile grids, so a slow load doesn't flash empty. */
export const MyHrLoadingCards = ({ count = 3 }: { count?: number }) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }, (_, index) => (
            <Card key={index} className="flex flex-col gap-2 p-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-3 w-32" />
            </Card>
        ))}
    </div>
);

/** `2026-08` for a 1-12 month — the key attendance records are bucketed by. */
export const monthKey = (year: number, month: number): string =>
    `${year}-${String(month).padStart(2, '0')}`;
