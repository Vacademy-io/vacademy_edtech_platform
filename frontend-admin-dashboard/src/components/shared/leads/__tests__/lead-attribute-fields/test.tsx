import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { flags, setStatus, setTier } = vi.hoisted(() => ({
    flags: { enabled: true, tierRequired: false },
    setStatus: vi.fn(),
    setTier: vi.fn(),
}));

vi.mock('@/hooks/use-lead-settings', () => ({
    useLeadSettings: () => ({
        followUpFields: {
            leadStatusAndTier: flags.enabled,
            leadTierRequired: flags.tierRequired,
        },
    }),
}));
vi.mock('@/hooks/use-lead-statuses', () => ({
    useLeadStatuses: () => ({
        statuses: [
            { id: 's1', status_key: 'CALL_BACK', label: 'Call Back', is_active: true },
            { id: 's2', status_key: 'OLD', label: 'Old', is_active: false },
        ],
    }),
    setLeadStatusForLead: setStatus,
}));
vi.mock('@/hooks/use-lead-tiers', () => ({
    useLeadTiers: () => ({ tiers: [{ tier_key: 'HOT', label: 'Interested (Hot)' }] }),
}));
vi.mock('@/hooks/use-invalidate-lead-caches', () => ({ invalidateLeadCaches: vi.fn() }));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/components/shared/leads/services/update-lead-tier', () => ({
    updateLeadTier: setTier,
}));

import { useLeadAttributeFields } from '@/components/shared/leads/lead-attribute-fields';

const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const render = (args: { userId?: string; audienceResponseId?: string }) =>
    renderHook(() => useLeadAttributeFields(args), { wrapper });

describe('useLeadAttributeFields', () => {
    beforeEach(() => {
        flags.enabled = true;
        flags.tierRequired = false;
        setStatus.mockReset().mockResolvedValue(undefined);
        setTier.mockReset().mockResolvedValue(undefined);
    });

    it('stays hidden and posts nothing while the institute switch is off', async () => {
        flags.enabled = false;
        const { result } = render({ userId: 'u1', audienceResponseId: 'r1' });
        expect(result.current.visible).toBe(false);
        act(() => {
            result.current.setStatusId('s1');
            result.current.setTierKey('HOT');
        });
        expect(await result.current.apply()).toBe(false);
        expect(setStatus).not.toHaveBeenCalled();
        expect(setTier).not.toHaveBeenCalled();
    });

    it('posts nothing when the counsellor kept the current values', async () => {
        const { result } = render({ userId: 'u1', audienceResponseId: 'r1' });
        expect(result.current.visible).toBe(true);
        expect(await result.current.apply()).toBe(false);
        expect(setStatus).not.toHaveBeenCalled();
        expect(setTier).not.toHaveBeenCalled();
    });

    it('offers only active statuses', () => {
        const { result } = render({ userId: 'u1', audienceResponseId: 'r1' });
        expect(result.current.statusOptions).toEqual([{ label: 'Call Back', value: 's1' }]);
    });

    it('posts the picked status and tier once, even when retried', async () => {
        const { result } = render({ userId: 'u1', audienceResponseId: 'r1' });
        act(() => {
            result.current.setStatusId('s1');
            result.current.setTierKey('HOT');
        });
        expect(await result.current.apply()).toBe(true);
        // A retry after the note / follow-up failed must not post them again.
        expect(await result.current.apply()).toBe(false);
        expect(setStatus).toHaveBeenCalledTimes(1);
        expect(setStatus).toHaveBeenCalledWith('r1', 's1', 'MANUAL');
        expect(setTier).toHaveBeenCalledTimes(1);
        expect(setTier).toHaveBeenCalledWith('u1', 'inst-1', 'HOT');
    });

    it('never reports the tier missing unless the institute requires it', () => {
        const { result } = render({ userId: 'u1', audienceResponseId: 'r1' });
        expect(result.current.tierRequired).toBe(false);
        expect(result.current.tierMissing).toBe(false);
    });

    it('reports the tier missing until one is picked when the institute requires it', () => {
        flags.tierRequired = true;
        const { result } = render({ userId: 'u1', audienceResponseId: 'r1' });
        expect(result.current.tierMissing).toBe(true);
        act(() => result.current.setTierKey('HOT'));
        expect(result.current.tierMissing).toBe(false);
    });

    it('does not require a tier while the dropdowns themselves are off', () => {
        flags.enabled = false;
        flags.tierRequired = true;
        const { result } = render({ userId: 'u1', audienceResponseId: 'r1' });
        expect(result.current.tierMissing).toBe(false);
    });

    it('hides the status without a lead response id, keeping the tier', () => {
        const { result } = render({ userId: 'u1' });
        expect(result.current.showStatus).toBe(false);
        expect(result.current.showTier).toBe(true);
    });
});
