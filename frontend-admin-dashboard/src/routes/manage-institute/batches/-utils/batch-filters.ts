/**
 * Search, status, date and sort for the Batches page — all client-side, over the
 * list the page already fetched for the selected session.
 */
import dayjs from 'dayjs';
import type {
    BatchType,
    batchWithStudentDetails,
} from '@/routes/manage-institute/batches/-types/manage-batches-types';

/**
 * The API only knows ACTIVE / INACTIVE. "Upcoming" is an ACTIVE batch whose
 * start date is still ahead, so an admin can tell a running batch from one
 * that has not begun.
 */
export type BatchDisplayStatus = 'active' | 'upcoming' | 'inactive';

export type BatchSort = 'newest' | 'oldest' | 'name' | 'learners';

export type BatchStatusFilter = 'all' | BatchDisplayStatus;

export interface BatchFilters {
    search: string;
    status: BatchStatusFilter;
    /** YYYY-MM-DD, inclusive; empty = open-ended. */
    from: string;
    to: string;
    sort: BatchSort;
}

export const DEFAULT_BATCH_FILTERS: BatchFilters = {
    search: '',
    status: 'all',
    from: '',
    to: '',
    sort: 'newest',
};

export const hasActiveBatchFilters = (filters: BatchFilters) =>
    filters.search.trim() !== '' || filters.status !== 'all' || !!filters.from || !!filters.to;

export function getBatchDisplayStatus(batch: BatchType, today = dayjs()): BatchDisplayStatus {
    if (batch.batch_status !== 'ACTIVE') return 'inactive';
    const start = batch.start_date ? dayjs(batch.start_date) : null;
    if (start?.isValid() && start.isAfter(today, 'day')) return 'upcoming';
    return 'active';
}

const startTime = (batch: BatchType) => {
    const start = batch.start_date ? dayjs(batch.start_date) : null;
    return start?.isValid() ? start.valueOf() : 0;
};

function matches(batch: BatchType, filters: BatchFilters, today: dayjs.Dayjs) {
    const query = filters.search.trim().toLowerCase();
    if (
        query &&
        !batch.batch_name?.toLowerCase().includes(query) &&
        !batch.invite_code?.toLowerCase().includes(query)
    ) {
        return false;
    }
    if (filters.status !== 'all' && getBatchDisplayStatus(batch, today) !== filters.status) {
        return false;
    }
    if (filters.from || filters.to) {
        const start = batch.start_date ? dayjs(batch.start_date) : null;
        if (!start?.isValid()) return false;
        if (filters.from && start.isBefore(dayjs(filters.from), 'day')) return false;
        if (filters.to && start.isAfter(dayjs(filters.to), 'day')) return false;
    }
    return true;
}

const SORTERS: Record<BatchSort, (a: BatchType, b: BatchType) => number> = {
    newest: (a, b) => startTime(b) - startTime(a),
    oldest: (a, b) => startTime(a) - startTime(b),
    name: (a, b) => (a.batch_name ?? '').localeCompare(b.batch_name ?? ''),
    learners: (a, b) => (b.count_students ?? 0) - (a.count_students ?? 0),
};

export function filterAndSortBatches(
    batches: BatchType[],
    filters: BatchFilters,
    today = dayjs()
): BatchType[] {
    return batches.filter((batch) => matches(batch, filters, today)).sort(SORTERS[filters.sort]);
}

/** Each course with only its matching batches; a course left with none is dropped while filtering. */
export function applyBatchFilters(
    courses: batchWithStudentDetails[],
    filters: BatchFilters,
    today = dayjs()
): batchWithStudentDetails[] {
    const filtering = hasActiveBatchFilters(filters);
    return courses
        .map((course) => ({
            ...course,
            batches: filterAndSortBatches(course.batches, filters, today),
        }))
        .filter((course) => !filtering || course.batches.length > 0);
}
