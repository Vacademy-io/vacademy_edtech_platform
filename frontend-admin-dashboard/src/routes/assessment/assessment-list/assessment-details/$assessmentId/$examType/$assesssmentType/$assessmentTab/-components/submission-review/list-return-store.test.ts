import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

import { useSubmissionNavStore } from '@/services/submission-review/nav-store';
import { placeToRestore, useSubmissionsListReturnStore, type SubmissionsListPlace } from './list-return-store';
import { useOpenSubmission } from './use-attempt-marking';

const place = (overrides: Partial<SubmissionsListPlace> = {}): SubmissionsListPlace => ({
    page: 2,
    pageSize: 25,
    selectedFilter: { name: 'riya', batches: ['b-1'] },
    listedFilter: { name: 'riya', batches: ['b-1'], registration_source: 'BATCH_PREVIEW_REGISTRATION', attempt_type: ['ENDED'] },
    searchText: 'riya',
    selectedTab: 'Attempted',
    selectedParticipantsTab: 'internal',
    batchSelectionTab: 'batch',
    ...overrides,
});

beforeEach(() => {
    navigate.mockReset();
    useSubmissionsListReturnStore.setState({ saved: null, returning: false });
    useSubmissionNavStore.getState().clear();
});

describe('Submissions tab place across the Submission page round trip', () => {
    it('gives the saved place back only when coming back to the same assessment', () => {
        const store = useSubmissionsListReturnStore.getState();
        store.save('asmt-1', place());
        // An ordinary visit (not back from the Submission page) starts fresh.
        expect(placeToRestore('asmt-1')).toBeNull();

        store.markLeaving();
        expect(placeToRestore('asmt-1')).toEqual(place());
        // Pure read: a second call (React may run initializers twice) still sees it.
        expect(placeToRestore('asmt-1')).toEqual(place());
        // Another assessment never gets this one's filters.
        expect(placeToRestore('asmt-2')).toBeNull();

        store.clearReturning();
        expect(placeToRestore('asmt-1')).toBeNull();
    });

    it('the last saved place wins (filtered page 3 of one batch, not page 1)', () => {
        const store = useSubmissionsListReturnStore.getState();
        store.save('asmt-1', place({ page: 0 }));
        store.save('asmt-1', place({ page: 3 }));
        store.markLeaving();
        expect(placeToRestore('asmt-1')?.page).toBe(3);
        expect(placeToRestore('asmt-1')?.listedFilter).toMatchObject({ batches: ['b-1'] });
    });

    it('opening the Submission page marks the way back and seeds Prev / Next with the page list', () => {
        useSubmissionsListReturnStore.getState().save('asmt-1', place());
        const { result } = renderHook(() => useOpenSubmission());
        result.current('att-2', { assessmentId: 'asmt-1', attemptIds: ['att-1', 'att-2', 'att-3'], source: 'list' });

        expect(useSubmissionsListReturnStore.getState().returning).toBe(true);
        expect(useSubmissionNavStore.getState().attemptIds).toEqual(['att-1', 'att-2', 'att-3']);
        expect(navigate).toHaveBeenCalledWith({
            to: '/assessment/submission/$attemptId',
            params: { attemptId: 'att-2' },
            search: {},
        });
    });

    it('a single-attempt list replaces an older list, so a stale one is not walked', () => {
        useSubmissionNavStore.getState().set('asmt-1', ['att-1', 'att-9'], 'list');
        const { result } = renderHook(() => useOpenSubmission());
        result.current('att-9', { assessmentId: 'asmt-1', attemptIds: ['att-9'], source: 'list' });
        expect(useSubmissionNavStore.getState().attemptIds).toEqual(['att-9']);
    });
});
