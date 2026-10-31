import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above these; vi.hoisted keeps the handles usable inside them.
const { http, toast, flags, setStatus } = vi.hoisted(() => ({
    http: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
    toast: { success: vi.fn(), error: vi.fn() },
    // The institute's follow-up switches — all off by default.
    flags: {
        keepPopupsOpen: false,
        scheduleNextByDefault: false,
        closingNoteOptional: false,
        leadStatusAndTier: false,
        markDoneLeadStatusAndTier: false,
    },
    setStatus: vi.fn(),
}));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/urls', () => ({
    GET_LEAD_FOLLOWUPS: (id: string) => `/followups/${id}`,
    CLOSE_LEAD_FOLLOWUP: (id: string) => `/followup/${id}/close`,
    CREATE_LEAD_FOLLOWUP: '/followup',
    // Read at import time by the lead status / tier hooks.
    BASE_URL: '',
    UPDATE_LEAD_TIER: '/tier',
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/use-invalidate-lead-caches', () => ({ invalidateLeadCaches: vi.fn() }));
vi.mock('@/hooks/use-lead-settings', () => ({
    LOST_STATUS_KEY: 'LOST',
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
            leadStatusAndTier: flags.leadStatusAndTier,
            scheduleNextByDefault: flags.scheduleNextByDefault,
            closingNoteOptional: flags.closingNoteOptional,
            markDoneLeadStatusAndTier: flags.markDoneLeadStatusAndTier,
        },
    }),
}));
vi.mock('@/hooks/use-lead-statuses', () => ({
    useLeadStatuses: () => ({
        statuses: [
            { id: 's-cb', status_key: 'CALL_BACK', label: 'Call Back', is_active: true },
            { id: 's-lost', status_key: 'LOST', label: 'Discarded', is_active: true },
        ],
    }),
    setLeadStatusForLead: setStatus,
}));
vi.mock('@/hooks/use-lead-tiers', () => ({
    useLeadTiers: () => ({ tiers: [{ tier_key: 'HOT', label: 'Hot' }] }),
}));
vi.mock('@/hooks/use-lead-terminology', () => ({
    useLeadTerminology: () => ({ leadStatus: 'Action Label', tier: 'Interest Level' }),
}));
// A plain <select> stands in for the searchable dropdown (cmdk needs layout APIs).
vi.mock('@/components/design-system/searchable-select', () => ({
    SearchableSelect: ({
        options,
        value,
        onChange,
    }: {
        options: { label: string; value: string }[];
        value: string;
        onChange: (v: string) => void;
    }) => (
        <select
            aria-label="lead-attribute"
            value={value}
            onChange={(e) => onChange(e.target.value)}
        >
            <option value="">Keep current</option>
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    ),
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
    setStatus.mockReset().mockResolvedValue(undefined);
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
const resetFlags = () => {
    flags.keepPopupsOpen = false;
    flags.scheduleNextByDefault = false;
    flags.closingNoteOptional = false;
    flags.leadStatusAndTier = false;
    flags.markDoneLeadStatusAndTier = false;
};

describe('CompleteFollowUpPopover — scheduling order (every institute)', () => {
    beforeEach(() => {
        resetFlags();
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
    beforeEach(() => {
        resetFlags();
        resetMocks();
    });

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

/** Mark-complete switches (all off by default): off must behave exactly as before. */
describe('CompleteFollowUpPopover — Mark complete switches', () => {
    it('status/tier switch on but Mark-complete switch off: dropdowns only in the inline schedule block, LOST does not untick', () => {
        resetFlags();
        flags.leadStatusAndTier = true;
        mount();
        fireEvent.click(screen.getByText('Mark complete'));
        expect(screen.queryByLabelText('lead-attribute')).toBeNull();
        const box = screen.getByLabelText('Schedule next follow-up');
        fireEvent.click(box);
        const [statusSelect] = screen.getAllByLabelText('lead-attribute');
        fireEvent.change(statusSelect!, { target: { value: 's-lost' } });
        expect(box).toHaveProperty('checked', true);
        expect(box).toHaveProperty('disabled', false);
    });

    it('status/tier switch on but Mark-complete switch off: a plain Done posts no status', async () => {
        resetFlags();
        resetMocks();
        flags.leadStatusAndTier = true;
        http.put.mockResolvedValue({ data: {} });
        mount();
        openAndFill();
        fireEvent.click(screen.getByText('Done ✓'));
        await waitFor(() => expect(http.put).toHaveBeenCalledTimes(1));
        expect(setStatus).not.toHaveBeenCalled();
    });

    beforeEach(() => {
        resetFlags();
        resetMocks();
    });

    it('OFF: schedule-next unticked, closing note required, no status/tier dropdowns', () => {
        mount();
        fireEvent.click(screen.getByText('Mark complete'));
        expect(screen.getByLabelText('Schedule next follow-up')).toHaveProperty('checked', false);
        expect(screen.getByText('Done ✓').closest('button')).toHaveProperty('disabled', true);
        expect(screen.queryByLabelText('lead-attribute')).toBeNull();
    });

    it('scheduleNextByDefault: opens ticked, and can still be unticked to just close', () => {
        flags.scheduleNextByDefault = true;
        mount();
        fireEvent.click(screen.getByText('Mark complete'));
        const box = screen.getByLabelText('Schedule next follow-up');
        expect(box).toHaveProperty('checked', true);
        expect(screen.getByText('Done & Schedule next')).toBeTruthy();
        fireEvent.click(box);
        expect(box).toHaveProperty('checked', false);
        expect(screen.getByText('Done ✓')).toBeTruthy();
    });

    it('closingNoteOptional: closes with an empty note', async () => {
        flags.closingNoteOptional = true;
        http.put.mockResolvedValue({ data: {} });
        mount();
        fireEvent.click(screen.getByText('Mark complete'));
        expect(screen.getByPlaceholderText('Closing note (optional)…')).toBeTruthy();
        fireEvent.click(screen.getByText('Done ✓'));
        await waitFor(() => expect(http.put).toHaveBeenCalledTimes(1));
        expect(http.put).toHaveBeenCalledWith('/followup/f1/close', { closer_reason: '' });
    });

    it('discarding (LOST) unticks schedule-next, sets the status, then closes — no follow-up booked', async () => {
        flags.leadStatusAndTier = true;
        flags.markDoneLeadStatusAndTier = true;
        flags.scheduleNextByDefault = true;
        http.put.mockResolvedValue({ data: {} });
        mount();
        openAndFill();
        const [statusSelect] = screen.getAllByLabelText('lead-attribute');
        fireEvent.change(statusSelect!, { target: { value: 's-lost' } });
        const box = screen.getByLabelText('Schedule next follow-up');
        expect(box).toHaveProperty('checked', false);
        expect(box).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByText('Done ✓'));
        await waitFor(() => expect(http.put).toHaveBeenCalledTimes(1));
        expect(setStatus).toHaveBeenCalledWith('ar1', 's-lost', 'MANUAL');
        expect(setStatus.mock.invocationCallOrder[0]).toBeLessThan(
            http.put.mock.invocationCallOrder[0]!
        );
        expect(http.post).not.toHaveBeenCalled();
    });

    it('with a schedule dialog: dropdowns hide while schedule-next is ticked (the dialog has them)', () => {
        flags.leadStatusAndTier = true;
        flags.markDoneLeadStatusAndTier = true;
        flags.scheduleNextByDefault = true;
        mount({ onScheduleNext: vi.fn() });
        fireEvent.click(screen.getByText('Mark complete'));
        expect(screen.queryByLabelText('lead-attribute')).toBeNull();
        fireEvent.click(screen.getByLabelText('Schedule next follow-up'));
        expect(screen.getAllByLabelText('lead-attribute')).toHaveLength(2);
    });

    it('handing off to the schedule dialog posts no status from the pop-up', async () => {
        flags.leadStatusAndTier = true;
        flags.markDoneLeadStatusAndTier = true;
        const onScheduleNext = vi.fn();
        mount({ onScheduleNext });
        openAndFill();
        const [statusSelect] = screen.getAllByLabelText('lead-attribute');
        fireEvent.change(statusSelect!, { target: { value: 's-cb' } });
        fireEvent.click(screen.getByLabelText('Schedule next follow-up'));
        fireEvent.click(screen.getByText('Done & Schedule next'));
        expect(onScheduleNext).toHaveBeenCalledTimes(1);
        expect(setStatus).not.toHaveBeenCalled();
    });
});
