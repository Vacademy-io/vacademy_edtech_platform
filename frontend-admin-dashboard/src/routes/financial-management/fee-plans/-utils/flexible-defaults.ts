/**
 * Form shape and checks for a FLEXIBLE fee plan's defaults (number of installments, gap,
 * optional maximum). Shared by the Fee Plans dialog and Settings → Payment Settings.
 * See docs/CPO_FLEXIBLE_INSTALLMENTS.md §6.8.
 */

/** Same cap as the backend's InstallmentScheduleService.MAX_INSTALLMENTS. */
export const MAX_INSTALLMENTS = 60;

export interface FlexibleDefaultsForm {
    count: number | string;
    unit: 'DAYS' | 'MONTHS';
    value: number | string;
    /** Blank = no limit beyond the system's. */
    maxCount: number | string;
}

export const DEFAULT_FLEXIBLE_DEFAULTS: FlexibleDefaultsForm = {
    count: 4,
    unit: 'MONTHS',
    value: 1,
    maxCount: '',
};

/** Which field is invalid ('count' | 'value' | 'maxCount'), or null when they can be saved. */
export function flexibleDefaultsError(
    scheduleMode: 'FIXED' | 'FLEXIBLE' | undefined,
    defaults: FlexibleDefaultsForm | undefined
): 'count' | 'value' | 'maxCount' | null {
    if (scheduleMode !== 'FLEXIBLE') return null;
    const d = defaults ?? DEFAULT_FLEXIBLE_DEFAULTS;
    const max = d.maxCount === '' ? MAX_INSTALLMENTS : Number(d.maxCount);
    if (!Number.isInteger(max) || max < 1 || max > MAX_INSTALLMENTS) return 'maxCount';
    const count = Number(d.count);
    if (!Number.isInteger(count) || count < 1 || count > max) return 'count';
    const value = Number(d.value);
    const maxGap = d.unit === 'DAYS' ? 3660 : 120;
    if (!Number.isInteger(value) || value < 1 || value > maxGap) return 'value';
    return null;
}

/** A flexible plan must split at least one fee, or there is nothing to schedule. */
export function flexibleHasNoSplitFee(
    scheduleMode: 'FIXED' | 'FLEXIBLE' | undefined,
    feeTypes: Array<{ hasInstallment: boolean }>
): boolean {
    return scheduleMode === 'FLEXIBLE' && feeTypes.length > 0 && !feeTypes.some((f) => f.hasInstallment);
}
