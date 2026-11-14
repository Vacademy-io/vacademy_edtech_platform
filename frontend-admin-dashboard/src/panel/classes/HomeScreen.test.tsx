/**
 * Home's layouts and the tile rules. The chunks it loads are faked: this is about what
 * Home chooses to show, and the strip has its own tests.
 */
import { render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import panelEn from '../i18n/panel.en.json';
import HomeScreen from '../screens/HomeScreen';

const state = vi.hoisted(() => ({
    signedIn: false,
    paired: true,
    native: true,
    admin: false,
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../components/PanelTopBar', () => ({ PanelTopBar: () => <header>top bar</header> }));
vi.mock('../components/PanelStage', () => ({
    PanelStage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PanelStageBody: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
    PanelFullscreenButton: () => null,
}));
vi.mock('../components/PanelScreenState', () => ({ PanelLoading: () => <p>loading</p> }));
vi.mock('./TodayStrip', () => ({
    default: ({ userId }: { userId: string }) => <p>today strip for {userId}</p>,
}));
vi.mock('../device/SignInCard', () => ({
    SignInCard: ({ showActions }: { showActions: boolean }) => (
        <p>sign-in card actions={String(showActions)}</p>
    ),
}));
vi.mock('../device/store', () => ({
    subscribeDeviceEvents: () => () => undefined,
    useDeviceRecord: () => (state.paired ? { institute_id: 'inst-a' } : null),
    usesDeviceAuth: () => state.paired,
}));
vi.mock('../lib/session', () => ({
    usePanelSession: () => ({
        isSignedIn: state.signedIn,
        user: state.signedIn ? { id: 'u1', fullName: 'Tara', username: 'tara' } : null,
    }),
    canUseDeviceSettings: () => !state.paired || state.admin,
}));
vi.mock('../lib/native', () => ({
    isNativePanel: () => state.native,
    openDeviceSettings: vi.fn(),
}));
vi.mock('../router', () => ({ navigate: vi.fn() }));

const labels = panelEn.home.tiles;

describe('HomeScreen', () => {
    beforeAll(async () => {
        await i18next.use(initReactI18next).init({
            lng: 'en',
            resources: { en: { panel: panelEn } },
            defaultNS: 'panel',
            interpolation: { escapeValue: false },
        });
    });

    beforeEach(() => {
        Object.assign(state, { signedIn: false, paired: true, native: true, admin: false });
    });

    it('signed out on a paired panel: QR card, Whiteboard, Diagnostics, nothing else', async () => {
        render(<HomeScreen />);
        await waitFor(() => screen.getByText('sign-in card actions=false'));
        expect(screen.getByText(labels.whiteboard)).toBeTruthy();
        expect(screen.getByText(labels.diagnostics)).toBeTruthy();
        [labels.volt, labels.lessons, labels.androidSettings, labels.switchHome].forEach((name) => {
            expect(screen.queryByText(name)).toBeNull();
        });
        expect(screen.queryByText(/today strip/)).toBeNull();
    });

    it('signed in as a teacher: Today above the tiles, and no way into Android', async () => {
        state.signedIn = true;
        render(<HomeScreen />);
        await waitFor(() => screen.getByText('today strip for u1'));
        [labels.whiteboard, labels.volt, labels.lessons, labels.diagnostics].forEach((name) => {
            expect(screen.getByText(name)).toBeTruthy();
        });
        expect(screen.queryByText(labels.androidSettings)).toBeNull();
        expect(screen.queryByText(labels.switchHome)).toBeNull();
        expect(screen.queryByText(/sign-in card/)).toBeNull();
    });

    it('signed in as an admin of this institute: settings tiles are there', async () => {
        Object.assign(state, { signedIn: true, admin: true });
        render(<HomeScreen />);
        await waitFor(() => screen.getByText('today strip for u1'));
        expect(screen.getByText(labels.androidSettings)).toBeTruthy();
        expect(screen.getByText(labels.switchHome)).toBeTruthy();
    });

    it('an admin on a web page has no settings tiles', async () => {
        Object.assign(state, { signedIn: true, admin: true, native: false });
        render(<HomeScreen />);
        await waitFor(() => screen.getByText('today strip for u1'));
        expect(screen.queryByText(labels.androidSettings)).toBeNull();
    });

    it('before pairing a lab build keeps the Phase 0 tiles, settings included', () => {
        state.paired = false;
        render(<HomeScreen />);
        expect(screen.getByText(labels.signIn)).toBeTruthy();
        expect(screen.getByText(labels.androidSettings)).toBeTruthy();
        expect(screen.getByText(labels.switchHome)).toBeTruthy();
        expect(screen.queryByText(/today strip/)).toBeNull();
    });
});
