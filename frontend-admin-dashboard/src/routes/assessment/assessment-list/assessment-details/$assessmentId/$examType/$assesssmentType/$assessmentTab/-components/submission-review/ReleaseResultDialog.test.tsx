import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestI18n } from '@/services/submission-review/test-i18n';
import type { ReleaseCheck } from '@/services/submission-review/types';

const api = vi.hoisted(() => ({
    getReleaseCheck: vi.fn(),
    releaseResultW9: vi.fn(),
}));
vi.mock('@/services/submission-review/api', () => api);
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/components/core/dashboard-loader', () => ({ DashboardLoader: () => <div>loading</div> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ReleaseResultDialog, w9Counts, w9RequestFlags } from './ReleaseResultDialog';

/** Acceptance 10: 49 learners — 41 ready, 3 unmarked, 2 AI running, 3 AI drafts. */
const CHECK: ReleaseCheck = {
    selected: 49,
    ready: { count: 41, attempt_ids: [] },
    ai_drafts: { count: 3, answers: 5, attempt_ids: [] },
    unmarked: { count: 3, answers: 5, attempt_ids: ['u1', 'u2', 'u3'] },
    ai_checking: { count: 2, eta_minutes: 6, attempt_ids: [] },
    already_released: { count: 0, attempt_ids: [] },
    not_submitted: { count: 0 },
    notifications: { learner_result_notifications: true },
};

const renderDialog = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <ReleaseResultDialog assessmentId="asmt-1" attemptIds="ALL" open onOpenChange={() => {}} />
        </QueryClientProvider>
    );

beforeAll(async () => {
    await setupTestI18n();
});
beforeEach(() => {
    api.getReleaseCheck.mockReset().mockResolvedValue(CHECK);
    api.releaseResultW9.mockReset().mockResolvedValue('Done');
});

describe('w9 helpers', () => {
    it('releases 44 now (41 ready + 3 drafts) and flags the other 5', () => {
        expect(w9Counts(CHECK, false)).toEqual({ readyNow: 44, waiting: 5, all: 49 });
        expect(w9RequestFlags('ready', true, false, 5)).toEqual({
            skip_unready: true,
            skip_already_released: true,
            allow_unmarked: false,
            release_when_marked: true,
        });
        expect(w9RequestFlags('all', true, true, 5)).toEqual({
            skip_unready: false,
            skip_already_released: false,
            allow_unmarked: true,
            release_when_marked: false,
        });
    });
});

describe('ReleaseResultDialog (W9)', () => {
    it('shows the counts and defaults to "Release the ready now" with auto-release on', async () => {
        renderDialog();
        expect(await screen.findByText('49 selected')).toBeInTheDocument();
        expect(screen.getByText('41 ready')).toBeInTheDocument();
        expect(screen.getByText('3 have answers not marked yet (5 answers)')).toBeInTheDocument();
        expect(screen.getByText('2 are still being checked by AI (about 6 min)')).toBeInTheDocument();
        expect(screen.getByText(/3 include AI marks nobody looked at/)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Release the 44 ready now' })).toHaveAttribute('aria-checked', 'true');
        expect(
            screen.getByRole('checkbox', { name: 'Release the other 5 automatically as soon as their marking is done' })
        ).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(screen.getByRole('button', { name: /^Release$/ }));
        await waitFor(() => expect(api.releaseResultW9).toHaveBeenCalledTimes(1));
        expect(api.releaseResultW9).toHaveBeenCalledWith('asmt-1', 'inst-1', 'ALL', {
            skip_unready: true,
            skip_already_released: true,
            allow_unmarked: false,
            release_when_marked: true,
        });
    });

    it('"Release all" needs the "I understand" tick before it sends allow_unmarked', async () => {
        renderDialog();
        await screen.findByText('49 selected');
        fireEvent.click(screen.getByRole('radio', { name: 'Release all 49. Unmarked answers count with their current mark (0, or a keyword match score).' }));
        const release = screen.getByRole('button', { name: /^Release$/ });
        expect(release).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand' }));
        expect(release).toBeEnabled();
        fireEvent.click(release);
        await waitFor(() => expect(api.releaseResultW9).toHaveBeenCalledTimes(1));
        expect(api.releaseResultW9.mock.calls[0]![3]).toEqual({
            skip_unready: false,
            skip_already_released: true,
            allow_unmarked: true,
            release_when_marked: false,
        });
    });
});
