import type { DashboardCollectionResponse } from '@/services/manage-finances';
import type { StudentFeeDueDTO } from '@/types/manage-finances';

/**
 * One data source behind a dashboard card, reduced to what a card needs to decide between
 * skeleton, value and "couldn't load". Kept free of React Query types so the KPI and
 * pending-action builders stay pure and testable.
 *
 * `isError` must be true whenever the request failed: a 403/500 rendered as 0 (or as
 * "All clear") reads as a real, healthy number, which is worse than saying nothing.
 */
export interface SourceState<T> {
    data: T | undefined;
    isLoading: boolean;
    isError: boolean;
}

/** Structural subset of a React Query result — enough to build a SourceState. */
interface QueryLike<T> {
    data: T | undefined;
    isPending: boolean;
    isError: boolean;
    fetchStatus?: 'fetching' | 'paused' | 'idle';
}

/**
 * A disabled query sits in `pending` forever with `fetchStatus: 'idle'`; that is "not
 * applicable", not "loading", so it must not keep a skeleton on screen.
 */
export const toSourceState = <T>(q: QueryLike<T>): SourceState<T> => ({
    data: q.data,
    isLoading: q.isPending && q.fetchStatus !== 'idle',
    isError: q.isError,
});

/**
 * The adjustment status the backend writes while a concession/penalty awaits review
 * (admin_core AdjustmentStatus.PENDING_FOR_APPROVAL). Not 'PENDING_APPROVAL' — that is the
 * slide/chapter/CPO status and never appears on a fee bill.
 */
export const ADJUSTMENT_PENDING_STATUS = 'PENDING_FOR_APPROVAL';

export const isAdjustmentPendingApproval = (
    row: Pick<StudentFeeDueDTO, 'adjustment_status'>
): boolean => row.adjustment_status === ADJUSTMENT_PENDING_STATUS;

export interface FeeTotals {
    /** Everything billed and not yet collected, upcoming installments included. */
    outstanding: number;
    /** Past its due date and still unpaid. */
    overdue: number;
}

/**
 * Institute-wide fee totals from the Collection Dashboard endpoint, read exactly as the
 * Fee Management → Collection page reads them: outstanding = projected − collected
 * ("Total due"), overdue = totalOverdue. Clamped at 0 so an over-collection (advance
 * payments) never shows a negative due.
 */
export const toFeeTotals = (
    c: Pick<DashboardCollectionResponse, 'projectedRevenue' | 'collectedToDate' | 'totalOverdue'>
): FeeTotals => ({
    outstanding: Math.max(0, Number(c.projectedRevenue || 0) - Number(c.collectedToDate || 0)),
    overdue: Math.max(0, Number(c.totalOverdue || 0)),
});
