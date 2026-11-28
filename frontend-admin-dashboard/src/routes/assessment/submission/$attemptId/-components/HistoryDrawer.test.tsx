import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestI18n } from '@/services/submission-review/test-i18n';
import type { MarkEventView } from '@/services/submission-review/types';

const api = vi.hoisted(() => ({ getHistory: vi.fn() }));
vi.mock('@/services/submission-review/api', () => api);
vi.mock('@/components/core/dashboard-loader', () => ({ DashboardLoader: () => <div>loading</div> }));

import { HistoryDrawer } from './HistoryDrawer';

const ev = (i: number): MarkEventView => ({
    id: `e${i}`,
    created_at: '2026-11-18T05:22:00Z',
    event_type: 'TEACHER_EDITED',
    section_id: 's1',
    question_id: 'q1',
    old_marks: 0,
    new_marks: 7,
    max_marks: 10,
    old_source: null,
    new_source: 'MANUAL',
    old_state: 'NEEDS_MARKING',
    new_state: 'MARKED',
    old_feedback: null,
    new_feedback: null,
    reason: null,
    actor_type: 'TEACHER',
    actor: { user_id: 'u1', name: 'Riya' },
    after_release: false,
    payload: null,
});

beforeAll(async () => {
    await setupTestI18n();
});

describe('HistoryDrawer (W10)', () => {
    it('says when only the newest events are shown, and loads older ones (review 4 #9)', async () => {
        api.getHistory.mockImplementation(async (_a: string, _s?: string, _q?: string, limit = 100) => ({
            events: Array.from({ length: Math.min(limit, 150) }, (_, i) => ev(i)),
            legacy_logs: [],
        }));
        render(
            <QueryClientProvider client={new QueryClient()}>
                <HistoryDrawer attemptId="att-1" learnerName="Harsh" row={null} open onOpenChange={() => {}} />
            </QueryClientProvider>
        );
        expect(await screen.findByText('Showing the latest 100 events')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
        await waitFor(() => expect(api.getHistory).toHaveBeenLastCalledWith('att-1', undefined, undefined, 500));
        await waitFor(() => expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument());
    });
});
