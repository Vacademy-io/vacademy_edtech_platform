import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above these; vi.hoisted keeps the handles usable inside them.
const { http, toast, flags } = vi.hoisted(() => ({
    http: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
    toast: { success: vi.fn(), error: vi.fn() },
    // The institute's "close pop-ups only with X" switch.
    flags: { keepPopupsOpen: false },
}));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/urls', () => ({
    GET_LEAD_FOLLOWUPS: (id: string) => `/followups/${id}`,
    CLOSE_LEAD_FOLLOWUP: (id: string) => `/followup/${id}/close`,
    CREATE_LEAD_FOLLOWUP: '/followup',
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/use-invalidate-lead-caches', () => ({ invalidateLeadCaches: vi.fn() }));
vi.mock('@/hooks/use-lead-settings', () => ({
    useLeadSettings: () => ({
        followUpFields: {
            enabled: false,
            studentResponses: [],
            followUpModes: [],
            nextActions: [],
            interestLevels: [],
            notesRequired: false,
            fieldsRequired: false,
            keepPopupsOpen: flags.keepPopupsOpen,
            showHistory: false,
            allowEditing: false,
        },
    }),
}));

import { CompleteFollowUpPopover } from '../../complete-followup-popover';

const mount = (props: Partial<Parameters<typeof CompleteFollowUpPopover>[0]> = {}) =>
    render(
        <QueryClientProvider client={new QueryClient()}>
            <CompleteFollowUpPopover
                audienceResponseId="ar1"
                userId="u1"
                followupId="f1"
                {...props}
            />
        </QueryClientProvider>
    );

const openAndFill = (opts: { scheduleNext?: boolean; nextTime?: string } = {}) => {
    fireEvent.click(screen.getByText('Mark complete'));
    fireEvent.change(screen.getByPlaceholderText('Closing note (required)…'), {
        target: { value: 'Spoke to the parent' },
    });
    if (opts.scheduleNext) {
        fireEvent.click(screen.getByLabelText('Schedule next follow-up'));
    }
    if (opts.nextTime) {
        const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: opts.nextTime } });
    }
};

const resetMocks = () => {
    http.get.mockReset();
    http.post.mockReset();
    http.put.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
};

/**
 * Closing a follow-up and booking the next used to close first, so a failed
 * create or a dismissed schedule dialog left the lead "Completed" with nothing
 * booked. That is a bug, so the fix applies to every institute — no switch.
 */
describe('CompleteFollowUpPopover — scheduling order (every institute)', () => {
    beforeEach(() => {
        flags.keepPopupsOpen = false;
        resetMocks();
    });

    it('a plain close still sends exactly one close and nothing else', async () => {
        http.put.mockResolvedValue({ data: {} });
        mount();
        openAndFill();
        fireEvent.click(screen.getByText('Done ✓'));
        await waitFor(() => expect(http.put).toHaveBeenCalledTimes(1));
        expect(http.put).toHaveBeenCalledWith('/followup/f1/close', {
            closer_reason: 'Spoke to the parent',
        });
        expect(http.post).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('Follow-up marked complete');
    });

    it('books the next follow-up before closing the current one', async () => {
        http.post.mockResolvedValue({ data: { id: 'f2' } });
        http.put.mockResolvedValue({ data: {} });
        mount();
        openAndFill({ scheduleNext: true, nextTime: '2026-10-27T10:00' });
        fireEvent.click(screen.getByText('Done & Schedule next'));
        await waitFor(() => expect(http.put).toHaveBeenCalledTimes(1));
        expect(http.post).toHaveBeenCalledTimes(1);
        expect(http.post.mock.invocationCallOrder[0]).toBeLessThan(
            http.put.mock.invocationCallOrder[0]!
        );
        expect(http.put).toHaveBeenCalledWith('/followup/f1/close', {
            closer_reason: 'Spoke to the parent',
        });
    });

    it('leaves the current follow-up open when booking the next one fails', async () => {
        http.post.mockRejectedValue(new Error('500'));
        mount();
        openAndFill({ scheduleNext: true, nextTime: '2026-10-27T10:00' });
        fireEvent.click(screen.getByText('Done & Schedule next'));
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(http.put).not.toHaveBeenCalled();
    });

    it('retrying after a failed close does not book the next follow-up twice', async () => {
        http.post.mockResolvedValue({ data: { id: 'f2' } });
        http.put.mockRejectedValueOnce(new Error('500')).mockResolvedValue({ data: {} });
        mount();
        openAndFill({ scheduleNext: true, nextTime: '2026-10-27T10:00' });
        fireEvent.click(screen.getByText('Done & Schedule next'));
        await waitFor(() => expect(http.put).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        fireEvent.click(screen.getByText('Done & Schedule next'));
        await waitFor(() => expect(http.put).toHaveBeenCalledTimes(2));
        expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('with a schedule dialog, closes nothing until the host reports the next one saved', async () => {
        http.put.mockResolvedValue({ data: {} });
        const onScheduleNext = vi.fn();
        mount({ onScheduleNext });
        openAndFill({ scheduleNext: true });
        fireEvent.click(screen.getByText('Done & Schedule next'));
        expect(onScheduleNext).toHaveBeenCalledTimes(1);
        // Dialog dismissed: the host never calls back, so nothing is closed.
        expect(http.put).not.toHaveBeenCalled();

        const closeCurrent = onScheduleNext.mock.calls[0]![0] as () => Promise<void>;
        await act(() => closeCurrent());
        expect(http.put).toHaveBeenCalledWith('/followup/f1/close', {
            closer_reason: 'Spoke to the parent',
        });
    });
});

/** The "close pop-ups only with X" switch changes how the pop-up closes, nothing else. */
describe('CompleteFollowUpPopover — close-only-with-X switch', () => {
    beforeEach(resetMocks);

    it('OFF (default): no X, and Escape closes it as before', async () => {
        flags.keepPopupsOpen = false;
        mount();
        openAndFill();
        expect(screen.queryByLabelText('Close')).toBeNull();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        await waitFor(() =>
            expect(screen.queryByPlaceholderText('Closing note (required)…')).toBeNull()
        );
    });

    it('ON: Escape does not close it or drop the typed note; X does', async () => {
        flags.keepPopupsOpen = true;
        mount();
        openAndFill();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        expect(screen.getByPlaceholderText('Closing note (required)…')).toHaveProperty(
            'value',
            'Spoke to the parent'
        );
        fireEvent.click(screen.getByLabelText('Close'));
        await waitFor(() =>
            expect(screen.queryByPlaceholderText('Closing note (required)…')).toBeNull()
        );
    });
});
