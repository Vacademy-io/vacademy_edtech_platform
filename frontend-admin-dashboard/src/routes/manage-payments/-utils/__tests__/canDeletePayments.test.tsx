import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = { settingOn: true, serverAllows: true };

vi.mock('@/lib/auth/instituteUtils', () => ({
    getActiveRoleDisplaySettingsKey: () => 'ADMIN_DISPLAY_SETTINGS',
    getCurrentInstituteId: () => 'inst-1',
}));
vi.mock('@/services/display-settings', () => ({
    DISPLAY_SETTINGS_UPDATED_EVENT: 'display-settings-updated',
    getDisplaySettingsFromCache: () => ({
        learnerManagement: { allowDeletePayments: state.settingOn },
    }),
    getDisplaySettingsWithFallback: async () => null,
}));
const serverCheck = vi.fn(async () => state.serverAllows);
vi.mock('@/services/payment-logs', () => ({ fetchCanDeletePayments: () => serverCheck() }));

import { useCanDeletePayments } from '../../-hooks/useCanDeletePayments';

const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

/**
 * An admin at Bhopal-Institute had the switch on, saw "Delete permanently", and was refused with
 * "turned off for your role" — the screen and the server disagreed. The button now needs both.
 */
describe('Delete permanently is offered only when the server agrees', () => {
    beforeEach(() => serverCheck.mockClear());

    it('switch on + server yes → shown', async () => {
        Object.assign(state, { settingOn: true, serverAllows: true });
        const { result } = renderHook(() => useCanDeletePayments(), { wrapper });
        await waitFor(() => expect(result.current).toBe(true));
    });

    it('switch on + server no → hidden', async () => {
        Object.assign(state, { settingOn: true, serverAllows: false });
        const { result } = renderHook(() => useCanDeletePayments(), { wrapper });
        await waitFor(() => expect(serverCheck).toHaveBeenCalled());
        expect(result.current).toBe(false);
    });

    it('switch off → hidden, and the server is not even asked', async () => {
        Object.assign(state, { settingOn: false, serverAllows: true });
        const { result } = renderHook(() => useCanDeletePayments(), { wrapper });
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current).toBe(false);
        expect(serverCheck).not.toHaveBeenCalled();
    });
});
