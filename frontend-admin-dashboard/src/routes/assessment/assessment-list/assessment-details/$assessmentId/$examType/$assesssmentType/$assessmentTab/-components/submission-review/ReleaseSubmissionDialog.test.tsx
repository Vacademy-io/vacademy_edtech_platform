import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestI18n } from '@/services/submission-review/test-i18n';

vi.mock('@/services/submission-review/api', () => ({
    releaseSubmission: vi.fn(),
    parseApiError: () => null,
    httpStatusOf: () => null,
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ReleaseSubmissionDialog } from './ReleaseSubmissionDialog';

const renderDialog = (aiDrafts?: number) =>
    render(
        <QueryClientProvider client={new QueryClient()}>
            <ReleaseSubmissionDialog
                attemptId="att-1"
                assessmentId="asmt-1"
                learnerName="Harsh Mehta"
                releaseToken="PENDING|0"
                aiDrafts={aiDrafts}
                open
                onOpenChange={() => {}}
            />
        </QueryClientProvider>
    );

beforeAll(async () => {
    await setupTestI18n();
});

describe('ReleaseSubmissionDialog (one learner)', () => {
    it('says that releasing accepts the AI marks nobody checked (owner decision 1, review 4 #6)', () => {
        renderDialog(3);
        expect(
            screen.getByText('3 answers have AI marks nobody checked. Releasing counts as your OK.')
        ).toBeInTheDocument();
    });

    it('says nothing about AI marks when there are none', () => {
        renderDialog(0);
        expect(screen.queryByText(/Releasing counts as your OK/)).not.toBeInTheDocument();
    });
});
