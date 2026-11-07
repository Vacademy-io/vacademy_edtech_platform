import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ expired: true }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../device/publicApi', () => ({
    isBackendReachable: () => false,
    subscribeReachability: () => () => undefined,
}));
vi.mock('../lib/session', () => ({
    signOut: vi.fn(),
    usePanelSession: () => ({ isSignedIn: true }),
}));
vi.mock('../router', () => ({
    navigate: vi.fn(),
    usePanelRoute: () => ({ screen: 'home', params: {} }),
}));
vi.mock('./lock', () => ({ offlineUseExpired: () => state.expired }));
vi.mock('./savedCopy', () => ({ useShowingSavedCopy: () => false }));

import OfflineLayer from './OfflineLayer';

describe('OfflineLayer', () => {
    beforeEach(() => {
        state.expired = true;
    });
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('the lock takes focus when it appears, so a remote can reach its buttons', () => {
        render(<OfflineLayer />);
        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'lock.diagnostics' })
        );
        expect(document.querySelector('[data-panel-lock]')).not.toBeNull();
    });

    it('looks again when the page comes back from sleep', () => {
        state.expired = false;
        render(<OfflineLayer />);
        expect(document.querySelector('[data-panel-lock]')).toBeNull();
        state.expired = true;
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(document.querySelector('[data-panel-lock]')).not.toBeNull();
    });
});
