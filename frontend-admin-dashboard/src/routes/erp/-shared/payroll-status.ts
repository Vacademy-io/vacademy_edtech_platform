import type { TFunction } from 'i18next';
import type { StatusType } from '@/components/design-system/status-chips';

/** Payroll run lifecycle, mirroring the backend PayrollStatus enum. */
export type PayrollRunStatus =
    | 'DRAFT'
    | 'PROCESSING'
    | 'PROCESSED'
    | 'APPROVED'
    | 'PAID'
    | 'CANCELLED';

/** Per-employee line status, mirroring PayrollEntryStatus. */
export type PayrollEntryStatus = 'CALCULATED' | 'HELD' | 'PAID';

export type PayrollRunType = 'REGULAR' | 'OFF_CYCLE' | 'FNF' | 'BONUS';

/**
 * The happy path a run walks. CANCELLED is deliberately absent: it is an exit,
 * not a step, and drawing it in the stepper would imply progress.
 */
export const RUN_STEPS: PayrollRunStatus[] = ['DRAFT', 'PROCESSED', 'APPROVED', 'PAID'];

/**
 * Human labels for a run's lifecycle status.
 *
 * Module-scope constant, so this is a `buildXxx(t)` factory rather than a plain
 * object — every call site must pass a `t` whose loaded namespaces include
 * `erpPayrollStatus` (add it to that component's `useTranslation([...])` array).
 */
export function buildRunStatusLabels(t: TFunction): Record<PayrollRunStatus, string> {
    return {
        DRAFT: t('erpPayrollStatus:runStatus.draft'),
        PROCESSING: t('erpPayrollStatus:runStatus.processing'),
        PROCESSED: t('erpPayrollStatus:runStatus.processed'),
        APPROVED: t('erpPayrollStatus:runStatus.approved'),
        PAID: t('erpPayrollStatus:runStatus.paid'),
        CANCELLED: t('erpPayrollStatus:runStatus.cancelled'),
    };
}

/** Human labels for a run's type. Same `erpPayrollStatus` namespace requirement as above. */
export function buildRunTypeLabels(t: TFunction): Record<PayrollRunType, string> {
    return {
        REGULAR: t('erpPayrollStatus:runType.regular'),
        OFF_CYCLE: t('erpPayrollStatus:runType.offCycle'),
        FNF: t('erpPayrollStatus:runType.fnf'),
        BONUS: t('erpPayrollStatus:runType.bonus'),
    };
}

export function runStatusChipType(status: string | null | undefined): StatusType {
    switch ((status ?? '').toUpperCase()) {
        case 'PAID':
        case 'APPROVED':
            return 'SUCCESS';
        case 'CANCELLED':
            return 'DANGER';
        case 'PROCESSING':
            return 'WARNING';
        default:
            // DRAFT / PROCESSED — in flight, nothing wrong.
            return 'INFO';
    }
}

export function entryStatusChipType(status: string | null | undefined): StatusType {
    switch ((status ?? '').toUpperCase()) {
        case 'PAID':
            return 'SUCCESS';
        case 'HELD':
            return 'WARNING';
        default:
            return 'INFO';
    }
}

/**
 * Which transitions the backend will accept from here — the single source the UI
 * uses to decide which buttons exist at all, so a user is never offered an
 * action that ends in a 400.
 *
 * Backend rules (PayrollRunService): process needs DRAFT; approve needs
 * PROCESSED; reject accepts PROCESSED or APPROVED; mark-paid needs APPROVED;
 * cancel accepts anything except PAID.
 */
export interface RunTransitions {
    canProcess: boolean;
    canApprove: boolean;
    canReject: boolean;
    canMarkPaid: boolean;
    canCancel: boolean;
    /** Entries can be held/released only while the run is still mutable. */
    canEditEntries: boolean;
}

export function runTransitions(status: string | null | undefined): RunTransitions {
    const s = (status ?? '').toUpperCase();
    return {
        canProcess: s === 'DRAFT',
        canApprove: s === 'PROCESSED',
        canReject: s === 'PROCESSED' || s === 'APPROVED',
        canMarkPaid: s === 'APPROVED',
        canCancel: s !== 'PAID' && s !== 'CANCELLED',
        canEditEntries: s === 'PROCESSED' || s === 'APPROVED',
    };
}
