import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

// getInstituteDetails.ts pulls in the axios instance, theme provider and
// local-storage hook at module load; none of them matter for this helper.
vi.mock('@/lib/auth/axiosInstance', () => ({ default: vi.fn() }));
vi.mock('@/providers/theme/theme-provider', () => ({ useTheme: () => ({}) }));
vi.mock('@/hooks/use-local-storage', () => ({ default: () => ({ setValue: vi.fn() }) }));

import { invalidateInstituteDetails } from './getInstituteDetails';

// The two batch-carrying institute queries are the ONLY writers of
// useInstituteDetailsStore.batches_for_sessions. A course/level/session
// mutation that forgets to invalidate them leaves the invite-links dialog and
// the Enroll button on the pre-mutation snapshot until a hard reload.
describe('invalidateInstituteDetails', () => {
    const seed = (queryClient: QueryClient) => {
        const keys = [
            ['GET_BOTH_INSTITUTE_APIS', 'v4'],
            ['GET_INSTITUTE_FULL', 'v1'],
            ['GET_INSTITUTE_LIGHTWEIGHT', 'v1'],
            ['GET_INIT_STUDY_LIBRARY'],
        ];
        keys.forEach((queryKey) => queryClient.setQueryData(queryKey, { id: 'inst' }));
    };

    it('marks the batch-carrying institute queries stale, matching versioned keys by prefix', async () => {
        const queryClient = new QueryClient();
        seed(queryClient);

        await invalidateInstituteDetails(queryClient);

        expect(queryClient.getQueryState(['GET_BOTH_INSTITUTE_APIS', 'v4'])?.isInvalidated).toBe(
            true
        );
        expect(queryClient.getQueryState(['GET_INSTITUTE_FULL', 'v1'])?.isInvalidated).toBe(true);
    });

    it('leaves the lightweight query alone: its queryFn stores batches_for_sessions: []', async () => {
        const queryClient = new QueryClient();
        seed(queryClient);

        await invalidateInstituteDetails(queryClient);

        expect(queryClient.getQueryState(['GET_INSTITUTE_LIGHTWEIGHT', 'v1'])?.isInvalidated).toBe(
            false
        );
        // Unrelated queries are left alone too.
        expect(queryClient.getQueryState(['GET_INIT_STUDY_LIBRARY'])?.isInvalidated).toBe(false);
    });
});
