import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import {
    applyBatchFilters,
    DEFAULT_BATCH_FILTERS,
    filterAndSortBatches,
    getBatchDisplayStatus,
} from './batch-filters';
import type { BatchType } from '@/routes/manage-institute/batches/-types/manage-batches-types';

const TODAY = dayjs('2026-10-06');

const batch = (overrides: Partial<BatchType>): BatchType => ({
    batch_name: 'default Nutrition In Skin',
    batch_status: 'ACTIVE',
    count_students: 1,
    start_date: '2026-09-01',
    package_session_id: Math.random().toString(36),
    invite_code: '',
    ...overrides,
});

describe('getBatchDisplayStatus', () => {
    it('an ACTIVE batch that has not started yet is upcoming', () => {
        expect(getBatchDisplayStatus(batch({ start_date: '2026-11-01' }), TODAY)).toBe('upcoming');
        expect(getBatchDisplayStatus(batch({ start_date: '2026-10-06' }), TODAY)).toBe('active');
        expect(getBatchDisplayStatus(batch({ start_date: '' }), TODAY)).toBe('active');
        expect(
            getBatchDisplayStatus(
                batch({ batch_status: 'INACTIVE', start_date: '2026-11-01' }),
                TODAY
            )
        ).toBe('inactive');
    });
});

describe('filterAndSortBatches', () => {
    const a = batch({
        batch_name: 'Alpha',
        invite_code: 'NS001',
        start_date: '2026-01-10',
        count_students: 5,
    });
    const b = batch({
        batch_name: 'Beta',
        invite_code: 'NS002',
        start_date: '2026-08-10',
        count_students: 9,
    });
    const c = batch({
        batch_name: 'Gamma',
        batch_status: 'INACTIVE',
        start_date: '2026-05-10',
        count_students: 0,
    });
    const all = [a, b, c];

    it('searches name and invite code, case-insensitively', () => {
        expect(
            filterAndSortBatches(all, { ...DEFAULT_BATCH_FILTERS, search: 'ns002' }, TODAY)
        ).toEqual([b]);
        expect(
            filterAndSortBatches(all, { ...DEFAULT_BATCH_FILTERS, search: 'gam' }, TODAY)
        ).toEqual([c]);
    });

    it('filters by status and by an inclusive start-date range', () => {
        expect(
            filterAndSortBatches(all, { ...DEFAULT_BATCH_FILTERS, status: 'inactive' }, TODAY)
        ).toEqual([c]);
        expect(
            filterAndSortBatches(
                all,
                { ...DEFAULT_BATCH_FILTERS, from: '2026-05-10', to: '2026-08-10' },
                TODAY
            )
        ).toEqual([b, c]);
    });

    it('sorts newest, oldest, by name and by learners', () => {
        const names = (sort: typeof DEFAULT_BATCH_FILTERS.sort) =>
            filterAndSortBatches(all, { ...DEFAULT_BATCH_FILTERS, sort }, TODAY).map(
                (x) => x.batch_name
            );
        expect(names('newest')).toEqual(['Beta', 'Gamma', 'Alpha']);
        expect(names('oldest')).toEqual(['Alpha', 'Gamma', 'Beta']);
        expect(names('name')).toEqual(['Alpha', 'Beta', 'Gamma']);
        expect(names('learners')).toEqual(['Beta', 'Alpha', 'Gamma']);
    });
});

describe('applyBatchFilters', () => {
    const course = (id: string, batches: BatchType[]) => ({
        package_dto: { id, package_name: id, thumbnail_file_id: '' },
        batches,
    });

    it('keeps empty courses until a filter is on, then drops courses with no match', () => {
        const courses = [course('c1', [batch({ batch_name: 'Alpha' })]), course('c2', [])];
        expect(applyBatchFilters(courses, DEFAULT_BATCH_FILTERS, TODAY)).toHaveLength(2);
        expect(
            applyBatchFilters(courses, { ...DEFAULT_BATCH_FILTERS, search: 'alpha' }, TODAY).map(
                (x) => x.package_dto.id
            )
        ).toEqual(['c1']);
    });
});
