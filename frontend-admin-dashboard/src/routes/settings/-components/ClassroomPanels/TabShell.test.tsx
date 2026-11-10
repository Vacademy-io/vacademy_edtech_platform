import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '../../../../../public/locales/en/settingsClassroomPanels.json';

const translate = (key: string): string => {
    const value = key.split('.').reduce<unknown>((node, part) => {
        if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
        return undefined;
    }, en);
    return typeof value === 'string' ? value : key;
};

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
    initReactI18next: { type: '3rdParty', init: () => {} },
    Trans: ({ children }: { children?: unknown }) => children,
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-a' }));
vi.mock('@/constants/urls', () => ({ BASE_URL: 'http://api.test' }));
vi.mock('@/lib/auth/roleUtils', () => ({ isAdminForInstitute: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: api }));

import ClassroomPanelsSettings from './ClassroomPanelsSettings';
import { isFeatureOff } from './featureProbe';

const ADMIN = 'http://api.test/auth-service/v1/panel/admin';
const featureOff = () =>
    Promise.reject({ response: { status: 404, data: { code: 'FEATURE_OFF', message: 'x' } } });

/** Which phase 2 endpoints answer; everything else is FEATURE_OFF. */
function answer(on: string[]) {
    api.get.mockImplementation((url: string) => {
        if (url === `${ADMIN}/rooms`) {
            return Promise.resolve({ data: { rooms: [], next_unpaired_room_id: null } });
        }
        if (url === `${ADMIN}/devices`) return Promise.resolve({ data: [] });
        const path = url.slice(ADMIN.length);
        return on.includes(path) ? Promise.resolve({ data: {} }) : featureOff();
    });
}

function renderConsole() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ClassroomPanelsSettings />
        </QueryClientProvider>
    );
}

/** happy-dom does not move location on history.replaceState; its own setter does. */
function setUrl(path: string) {
    (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(
        `http://localhost:3000${path}`
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    setUrl('/settings?selectedTab=classroomPanels');
});

describe('the phase 2 tab shell', () => {
    it('with every feature off it is the phase 1 screen: no tab list', async () => {
        answer([]);
        renderConsole();
        await waitFor(() =>
            expect(api.get).toHaveBeenCalledWith(`${ADMIN}/fleet`, expect.anything())
        );
        await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(6));
        expect(screen.queryByRole('tablist')).toBeNull();
    });

    it('shows only the tabs whose endpoint answers, after Panels & rooms', async () => {
        answer(['/usage', '/fleet']);
        renderConsole();
        const list = await screen.findByRole('tablist', { name: en.tabs.label });
        const names = (await screen.findAllByRole('tab')).map((tab) => tab.textContent);
        expect(list).toBeTruthy();
        expect(names).toEqual([en.tabs.panels, en.tabs.usage, en.tabs.alerts]);
        expect(
            screen.getByRole('tab', { name: en.tabs.panels }).getAttribute('aria-selected')
        ).toBe('true');
    });

    it('?view=usage opens the Usage tab once it is available', async () => {
        setUrl('/settings?selectedTab=classroomPanels&view=usage');
        answer(['/usage']);
        renderConsole();
        const usage = await screen.findByRole('tab', { name: en.tabs.usage });
        await waitFor(() => expect(usage.getAttribute('aria-selected')).toBe('true'));
    });

    it('a 404 or FEATURE_OFF is off; any other failure leaves the tab to show its error', () => {
        expect(isFeatureOff({ response: { status: 404, data: { code: 'FEATURE_OFF' } } })).toBe(
            true
        );
        expect(isFeatureOff({ response: { status: 403, data: { code: 'PANEL_DISABLED' } } })).toBe(
            true
        );
        expect(isFeatureOff({ response: { status: 404, data: '' } })).toBe(true);
        expect(isFeatureOff({ response: { status: 500, data: { code: 'ERROR' } } })).toBe(false);
        expect(isFeatureOff({ response: { status: 404, data: { code: 'ROOM_OCCUPIED' } } })).toBe(
            false
        );
        expect(isFeatureOff(new Error('network'))).toBe(false);
    });
});
