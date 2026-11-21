/**
 * The City / Region chips shared by the Learner List page and a course's learners tab.
 *
 * Chips come from the institute's own values (with counts), follow the "Manage filters"
 * switches, sit right after Gender, and a switched-off chip also drops its applied selection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { StudentFilterRequest } from '@/types/student-table-types';
import {
    useLearnerLocationFilters,
    withLocationFiltersAfterGender,
} from './useLearnerLocationFilters';

const I18N = { t: (key: string) => key };
vi.mock('react-i18next', () => ({
    useTranslation: () => I18N,
}));

let hidden: string[] = [];
vi.mock('@/components/shared/leads/use-list-built-in-filter-controls', () => ({
    useListBuiltInFilterControls: () => ({
        isVisible: (filter: string) => !hidden.includes(filter),
        isLoading: false,
    }),
}));

const OPTIONS = {
    data: {
        cities: [
            { value: 'Pune', count: 30 },
            { value: 'Nagpur', count: 8 },
        ],
        regions: [{ value: 'Maharashtra', count: 3 }],
    },
};
const optionsHook = vi.fn((_instituteId?: string, _enabled?: boolean) => OPTIONS);
vi.mock('@/routes/manage-students/students-list/-services/getLearnerLocationFilterOptions', () => ({
    useLearnerLocationFilterOptions: (instituteId?: string, enabled?: boolean) =>
        optionsHook(instituteId, enabled),
}));

const NO_FILTERS: StudentFilterRequest = {} as StudentFilterRequest;

function render(appliedFilters: StudentFilterRequest = NO_FILTERS) {
    const setColumnFilters = vi.fn();
    const setAppliedFilters = vi.fn();
    const { result } = renderHook(() =>
        useLearnerLocationFilters({
            instituteId: 'inst-1',
            appliedFilters,
            setColumnFilters,
            setAppliedFilters,
        })
    );
    return { chips: result.current, setColumnFilters, setAppliedFilters };
}

describe('useLearnerLocationFilters', () => {
    beforeEach(() => {
        hidden = [];
        optionsHook.mockClear();
    });

    it('builds City and Region chips from the institute values, with counts', () => {
        const { chips, setAppliedFilters } = render();

        expect(chips.map((c) => c.id)).toEqual(['cities', 'regions']);
        expect(chips[0]!.title).toBe('city.title');
        expect(chips[0]!.filterList).toEqual([
            { id: 'Pune', label: 'Pune (30)' },
            { id: 'Nagpur', label: 'Nagpur (8)' },
        ]);
        expect(optionsHook).toHaveBeenCalledWith('inst-1', true);
        expect(setAppliedFilters).not.toHaveBeenCalled();
    });

    it('leaves out a chip switched off in Manage filters, and fetches nothing when both are off', () => {
        hidden = ['city'];
        expect(render().chips.map((c) => c.id)).toEqual(['regions']);

        hidden = ['city', 'region'];
        expect(render().chips).toEqual([]);
        expect(optionsHook).toHaveBeenLastCalledWith('inst-1', false);
    });

    it('drops an applied City selection once its switch is off, and keeps Region', () => {
        hidden = ['city'];
        const { setColumnFilters, setAppliedFilters } = render({
            cities: ['pune'],
            regions: ['maharashtra'],
        } as StudentFilterRequest);

        const nextApplied = setAppliedFilters.mock.calls[0]![0] as (
            prev: StudentFilterRequest
        ) => StudentFilterRequest;
        expect(
            nextApplied({ cities: ['pune'], regions: ['maharashtra'] } as StudentFilterRequest)
        ).toEqual({ regions: ['maharashtra'] });

        const nextColumns = setColumnFilters.mock.calls[0]![0] as (
            prev: { id: string; value: { id: string; label: string }[] }[]
        ) => unknown[];
        expect(
            nextColumns([
                { id: 'cities', value: [{ id: 'Pune', label: 'Pune (30)' }] },
                { id: 'regions', value: [{ id: 'Maharashtra', label: 'Maharashtra (3)' }] },
            ])
        ).toEqual([{ id: 'regions', value: [{ id: 'Maharashtra', label: 'Maharashtra (3)' }] }]);
    });
});

describe('withLocationFiltersAfterGender', () => {
    const locationChips = [{ id: 'cities' }, { id: 'regions' }];

    it('puts the chips right after Gender', () => {
        const base = [{ id: 'statuses' }, { id: 'gender' }, { id: 'session_expiry_days' }];
        expect(withLocationFiltersAfterGender(base, locationChips).map((f) => f.id)).toEqual([
            'statuses',
            'gender',
            'cities',
            'regions',
            'session_expiry_days',
        ]);
    });

    it('appends them when there is no Gender filter', () => {
        expect(
            withLocationFiltersAfterGender([{ id: 'statuses' }], locationChips).map((f) => f.id)
        ).toEqual(['statuses', 'cities', 'regions']);
    });
});
