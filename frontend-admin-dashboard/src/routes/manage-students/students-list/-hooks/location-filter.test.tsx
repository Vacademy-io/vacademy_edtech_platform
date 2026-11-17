/**
 * City / Region filters on the learner list.
 *
 * The chips put the picked values under the `cities` / `regions` filter ids; this hook
 * turns them into the request (`cities` / `regions`), mirrors them in the URL as
 * `?city=` / `?region=` so a reload keeps them, and drops them on "Clear filters".
 * Nothing picked must leave the request exactly as before (no keys at all).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const searchParams: Record<string, unknown> = {};

const navigate = () => {};
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
    useSearch: () => searchParams,
}));

const I18N = { t: (key: string) => key };
vi.mock('react-i18next', () => ({
    useTranslation: () => I18N,
}));

vi.mock('@/lib/auth/instituteUtils', () => ({
    getCurrentInstituteId: () => 'inst-1',
}));

const NO_CUSTOM_FIELDS = { data: [] as unknown[] };
vi.mock('@/routes/audience-manager/list/-hooks/useCustomFieldSetup', () => ({
    useCustomFieldSetup: () => NO_CUSTOM_FIELDS,
}));

vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminologyPlural: () => 'Sessions',
    getTerminology: () => 'Session',
}));

const SELECTED_SESSION_STORE = { selectedSession: null, setSelectedSession: () => {} };
vi.mock('@/stores/study-library/selected-session-store', () => ({
    useSelectedSessionStore: () => SELECTED_SESSION_STORE,
}));

const SESSION = { id: 'sess-1', session_name: '2026', status: 'ACTIVE', start_date: null };

// One frozen object, returned by reference: a fresh object per call would re-run the
// hook's `[instituteDetails]` effects forever.
const INSTITUTE_DETAILS = {
    batches_for_sessions: [
        {
            id: 'ps-1',
            name: 'Batch 1',
            level: { id: 'lvl-default', level_name: 'default' },
            session: SESSION,
            start_time: null,
            status: 'ACTIVE',
            package_dto: { id: 'p1', package_name: 'Course' },
        },
    ],
    student_statuses: ['ACTIVE'],
    dropdown_custom_fields: [],
    session_expiry_days: [],
};
const SESSIONS = [SESSION];
const STORE = {
    getAllSessions: () => SESSIONS,
    instituteDetails: INSTITUTE_DETAILS,
};

vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => STORE,
}));

import { useStudentFilters } from './useStudentFilters';

// happy-dom's history.replaceState does not move window.location, so read the URL the
// hook last wrote from the call itself.
const replaceState = vi.spyOn(window.history, 'replaceState');

const resetUrl = () => {
    for (const key of Object.keys(searchParams)) delete searchParams[key];
    replaceState.mockClear();
};

const urlValues = (param: string) => {
    const calls = replaceState.mock.calls;
    const last = calls.length > 0 ? calls[calls.length - 1][2] : undefined;
    if (!last) return [];
    return new URL(String(last), 'http://localhost').searchParams.getAll(param);
};

describe('City / Region filters on the learner list', () => {
    beforeEach(resetUrl);

    it('restores the chips and the request from ?city= / ?region= on load', async () => {
        searchParams.city = ['Pune', 'Nagpur'];
        searchParams.region = 'Maharashtra';
        const { result } = renderHook(() => useStudentFilters({ allowAllSessions: true }));

        await waitFor(() => {
            expect(result.current.appliedFilters.cities).toEqual(['Pune', 'Nagpur']);
            expect(result.current.appliedFilters.regions).toEqual(['Maharashtra']);
        });
        const cityChip = result.current.columnFilters.find((f) => f.id === 'cities');
        expect(cityChip?.value).toEqual([
            { id: 'Pune', label: 'Pune' },
            { id: 'Nagpur', label: 'Nagpur' },
        ]);
        expect(result.current.getActiveFiltersState()).toBe(true);
    });

    it('sends the picked cities and regions and puts them in the URL', async () => {
        const { result } = renderHook(() => useStudentFilters({ allowAllSessions: true }));

        act(() => {
            result.current.handleFilterChange('cities', [
                { id: 'Nashik', label: 'Nashik (5)' },
            ]);
            result.current.handleFilterChange('regions', [{ id: 'Maharashtra', label: 'Maharashtra (3)' }]);
        });
        await act(async () => {
            await result.current.handleFilterClick();
        });

        // The id (the value), never the "(count)" label, goes to the server.
        expect(result.current.appliedFilters.cities).toEqual(['Nashik']);
        expect(result.current.appliedFilters.regions).toEqual(['Maharashtra']);
        expect(urlValues('city')).toEqual(['Nashik']);
        expect(urlValues('region')).toEqual(['Maharashtra']);
    });

    it('leaves the request without cities / regions when none is picked', async () => {
        const { result } = renderHook(() => useStudentFilters({ allowAllSessions: true }));

        act(() => {
            result.current.handleFilterChange('gender', [{ id: '0', label: 'MALE' }]);
        });
        await act(async () => {
            await result.current.handleFilterClick();
        });

        expect(result.current.appliedFilters.gender).toEqual(['MALE']);
        expect('cities' in result.current.appliedFilters).toBe(false);
        expect('regions' in result.current.appliedFilters).toBe(false);
        expect(urlValues('city')).toEqual([]);
    });

    it('drops them on "Clear filters"', async () => {
        const { result } = renderHook(() => useStudentFilters({ allowAllSessions: true }));

        act(() => {
            result.current.handleFilterChange('cities', [{ id: 'Pune', label: 'Pune' }]);
        });
        await act(async () => {
            await result.current.handleFilterClick();
        });
        expect(urlValues('city')).toEqual(['Pune']);

        await act(async () => {
            await result.current.handleClearFilters();
        });

        expect(result.current.appliedFilters.cities).toBeUndefined();
        expect(result.current.columnFilters.find((f) => f.id === 'cities')).toBeUndefined();
        expect(urlValues('city')).toEqual([]);
    });
});
