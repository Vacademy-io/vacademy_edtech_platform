/**
 * Landing on the learner list from "View Batch".
 *
 * The card sends `?batch=<package_session_id>&package_session_id=<same>`. This
 * hook is what turns that into a visible Batch chip, and the chip is the only
 * thing on the page that says which batch you are looking at.
 *
 * Both halves were broken: the card used to send a display label, which matched
 * no id here so no chip appeared at all, and the chip it would have built was
 * labelled with the COURSE name — identical for every batch of that course.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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

const batch = (id: string, name: string | null) => ({
    id,
    name,
    level: { id: 'lvl-default', level_name: 'default' },
    session: SESSION,
    start_time: null,
    status: 'ACTIVE',
    package_dto: { id: 'p1', package_name: 'Adv Diploma In Cosmetology' },
});

const BATCHES = [
    batch('ps-pun', '2026_05_11_ADCT_OF_PUN'),
    batch('ps-mum', '2026_02_16_ADCT_OF_MUM'),
    batch('ps-unnamed', null),
];

// One frozen object, returned by reference. A fresh object per call would make
// the hook's `[instituteDetails]` effects re-run forever and OOM the worker.
const INSTITUTE_DETAILS = {
    batches_for_sessions: BATCHES,
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

const landOnBatch = (id: string) => {
    for (const key of Object.keys(searchParams)) delete searchParams[key];
    searchParams.batch = id;
    searchParams.package_session_id = id;
    return renderHook(() => useStudentFilters({ allowAllSessions: true }));
};

describe('View Batch → learner list', () => {
    beforeEach(() => {
        for (const key of Object.keys(searchParams)) delete searchParams[key];
    });

    it('shows a Batch chip for the batch that was clicked', async () => {
        const { result } = landOnBatch('ps-pun');
        await waitFor(() => {
            const chip = result.current.columnFilters.find((f) => f.id === 'batch');
            expect(chip?.value).toEqual([{ id: 'ps-pun', label: '2026_05_11_ADCT_OF_PUN' }]);
        });
    });

    it('scopes the request to that one batch', async () => {
        const { result } = landOnBatch('ps-mum');
        await waitFor(() => {
            expect(result.current.appliedFilters.package_session_ids).toEqual(['ps-mum']);
        });
    });

    it('labels an unnamed batch with the course, as it always did', async () => {
        const { result } = landOnBatch('ps-unnamed');
        await waitFor(() => {
            const chip = result.current.columnFilters.find((f) => f.id === 'batch');
            expect(chip?.value[0]?.label).toBe('Adv Diploma In Cosmetology');
        });
    });

    it('counts as an active filter, so "clear filters" appears', async () => {
        const { result } = landOnBatch('ps-pun');
        await waitFor(() => {
            expect(result.current.getActiveFiltersState()).toBe(true);
        });
    });
});
