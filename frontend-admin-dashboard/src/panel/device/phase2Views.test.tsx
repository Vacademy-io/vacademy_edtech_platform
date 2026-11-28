/**
 * The three refused sign-in views (licence, awaiting, updateRequired), the GRACE chip and
 * the update bar. The sync snapshot, the session and the update state are faked.
 */
import { useSyncExternalStore } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelSyncLicence } from '@/classroom-shared/apiTypes';
import panelEn from '../i18n/panel.en.json';

const session = vi.hoisted(() => ({ signedIn: false }));
const meeting = vi.hoisted(() => ({ open: false }));
const sync = vi.hoisted(() => ({
    snapshot: {
        lastSyncAt: 1 as number | null,
        licence: null as PanelSyncLicence | null,
        approvalState: 'PENDING' as string | null,
    },
    listeners: new Set<() => void>(),
    syncNow: vi.fn(),
}));
const device = vi.hoisted(() => ({
    value: { room_name: 'Room 7B', institute_name: 'Alpha School' } as {
        room_name: string | null;
        institute_name: string | null;
    } | null,
}));
const update = vi.hoisted(() => ({
    state: {
        offer: null as null | { version_code: number; version_name: string },
        phase: 'none',
        progress: null as number | null,
        available: true,
        last: null,
    },
    install: vi.fn(async () => undefined),
}));

vi.mock('../lib/session', () => ({
    usePanelSession: () => ({ isSignedIn: session.signedIn }),
}));
vi.mock('./activity', () => ({ isMeetingOpen: () => meeting.open }));
vi.mock('./store', () => ({ useDeviceRecord: () => device.value }));
vi.mock('./syncLoop', () => ({
    syncNow: sync.syncNow,
    useSyncSnapshot: () => useSyncExternalStore(subscribeSync, () => sync.snapshot),
}));
vi.mock('./updateOffer', () => ({
    useUpdateState: () => update.state,
    installUpdate: update.install,
}));

import { AwaitingCard } from './AwaitingCard';
import { LicenceCard } from './LicenceCard';
import { LicenceGraceChip } from './LicenceGraceChip';
import { UpdateBar } from './UpdateBar';
import { UpdateRequiredCard } from './UpdateRequiredCard';

function subscribeSync(listener: () => void): () => void {
    sync.listeners.add(listener);
    return () => {
        sync.listeners.delete(listener);
    };
}

function publishSync(next: Partial<typeof sync.snapshot>): void {
    act(() => {
        sync.snapshot = {
            ...sync.snapshot,
            ...next,
            lastSyncAt: (sync.snapshot.lastSyncAt ?? 0) + 1,
        };
        sync.listeners.forEach((listener) => listener());
    });
}

const LICENCE: PanelSyncLicence = {
    state: 'UNLICENSED',
    enforced: true,
    ends_at: null,
    grace_ends_at: null,
};

describe('phase 2 panel views', () => {
    beforeAll(async () => {
        await i18next.use(initReactI18next).init({
            lng: 'en',
            resources: { en: { panel: panelEn } },
            defaultNS: 'panel',
            interpolation: { escapeValue: false },
        });
    });
    beforeEach(() => {
        session.signedIn = false;
        meeting.open = false;
        sync.snapshot = { lastSyncAt: 1, licence: LICENCE, approvalState: 'PENDING' };
        sync.syncNow.mockReset();
        device.value = { room_name: 'Room 7B', institute_name: 'Alpha School' };
        update.state = { offer: null, phase: 'none', progress: null, available: true, last: null };
        update.install.mockReset();
    });

    describe('licence', () => {
        it('loads on first use through the refused views chunk', async () => {
            const { LicenceCard: Lazy } = await import('./refusedViews');
            render(<Lazy onRetry={vi.fn()} />);
            expect(await screen.findByText('This classroom needs a licence')).toBeInTheDocument();
        });

        it('names the room and rechecks at once on Check again', () => {
            const onRetry = vi.fn();
            render(<LicenceCard onRetry={onRetry} />);
            expect(screen.getByText('This classroom needs a licence')).toBeInTheDocument();
            expect(
                screen.getByText('Ask your school admin to assign one to Room 7B.')
            ).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
            expect(onRetry).toHaveBeenCalledTimes(1);
            expect(sync.syncNow).toHaveBeenCalledTimes(1);
        });

        it('says the licence ended when the school is EXPIRED', () => {
            sync.snapshot.licence = { ...LICENCE, state: 'EXPIRED' };
            render(<LicenceCard onRetry={vi.fn()} />);
            expect(screen.getByText("The school's panel licence has ended")).toBeInTheDocument();
        });

        it('falls back to "this room" without a room name', () => {
            device.value = null;
            render(<LicenceCard onRetry={vi.fn()} />);
            expect(
                screen.getByText('Ask your school admin to assign one to this room.')
            ).toBeInTheDocument();
        });

        it('rechecks after a sync that says the room has a seat, and not before', () => {
            const onRetry = vi.fn();
            render(<LicenceCard onRetry={onRetry} />);
            publishSync({ licence: LICENCE });
            expect(onRetry).not.toHaveBeenCalled();
            publishSync({ licence: { ...LICENCE, state: 'LICENSED' } });
            expect(onRetry).toHaveBeenCalledTimes(1);
        });

        it('rechecks when the server stops enforcing', () => {
            const onRetry = vi.fn();
            render(<LicenceCard onRetry={onRetry} />);
            publishSync({ licence: { ...LICENCE, enforced: false } });
            expect(onRetry).toHaveBeenCalledTimes(1);
        });
    });

    describe('grace chip', () => {
        const grace: PanelSyncLicence = {
            state: 'GRACE',
            enforced: true,
            ends_at: '2026-11-01T00:00:00Z',
            grace_ends_at: '2026-11-15T12:00:00Z',
        };

        it('shows the grace end date while signed out', () => {
            sync.snapshot.licence = grace;
            render(<LicenceGraceChip />);
            expect(screen.getByText(/^Licence ends .*2026/)).toBeInTheDocument();
        });

        it('is never shown signed in, unenforced, or outside GRACE', () => {
            sync.snapshot.licence = grace;
            session.signedIn = true;
            const { container, rerender } = render(<LicenceGraceChip />);
            expect(container).toBeEmptyDOMElement();
            session.signedIn = false;
            sync.snapshot.licence = { ...grace, enforced: false };
            rerender(<LicenceGraceChip key="b" />);
            expect(container).toBeEmptyDOMElement();
            sync.snapshot.licence = { ...grace, state: 'LICENSED' };
            rerender(<LicenceGraceChip key="c" />);
            expect(container).toBeEmptyDOMElement();
        });

        it('shows nothing for a date it cannot read', () => {
            sync.snapshot.licence = { ...grace, grace_ends_at: 'soon', ends_at: null };
            const { container } = render(<LicenceGraceChip />);
            expect(container).toBeEmptyDOMElement();
        });
    });

    describe('awaiting approval', () => {
        it('names the school and rechecks once a sync says approved', () => {
            const onRetry = vi.fn();
            render(<AwaitingCard onRetry={onRetry} />);
            expect(screen.getByText('Waiting for the school')).toBeInTheDocument();
            expect(
                screen.getByText(/Alpha School's admin needs to approve it/)
            ).toBeInTheDocument();
            publishSync({ approvalState: 'PENDING' });
            expect(onRetry).not.toHaveBeenCalled();
            publishSync({ approvalState: 'APPROVED' });
            expect(onRetry).toHaveBeenCalledTimes(1);
        });

        it('Check again rechecks at once', () => {
            const onRetry = vi.fn();
            render(<AwaitingCard onRetry={onRetry} />);
            fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
            expect(onRetry).toHaveBeenCalledTimes(1);
            expect(sync.syncNow).toHaveBeenCalledTimes(1);
        });
    });

    describe('update bar', () => {
        const ready = () => {
            update.state = {
                offer: { version_code: 4, version_name: '0.4.0' },
                phase: 'ready',
                progress: null,
                available: true,
                last: null,
            };
        };

        it('shows nothing without an offer', () => {
            const { container } = render(<UpdateBar placement="signin" />);
            expect(container).toBeEmptyDOMElement();
        });

        it('offers Install when the download is ready', () => {
            ready();
            render(<UpdateBar placement="pair" />);
            expect(screen.getByText('Version 0.4.0 is downloaded.')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Install' }));
            expect(update.install).toHaveBeenCalledTimes(1);
        });

        it('shows progress while downloading', () => {
            ready();
            update.state.phase = 'downloading';
            update.state.progress = 40;
            render(<UpdateBar placement="signin" />);
            expect(screen.getByText('Downloading an update… 40%')).toBeInTheDocument();
        });

        it('explains the permission step', () => {
            ready();
            update.state.phase = 'needsPermission';
            render(<UpdateBar placement="signin" />);
            expect(screen.getByText(/Allow installs from this app/)).toBeInTheDocument();
        });

        it('is never shown signed in or in a meeting', () => {
            ready();
            session.signedIn = true;
            const { container, rerender } = render(<UpdateBar placement="signin" />);
            expect(container).toBeEmptyDOMElement();
            session.signedIn = false;
            meeting.open = true;
            rerender(<UpdateBar placement="pair" />);
            expect(container).toBeEmptyDOMElement();
        });
    });

    describe('update required', () => {
        it('without the updater, says who can update it, and Check again rechecks', () => {
            update.state.available = false;
            const onRetry = vi.fn();
            render(<UpdateRequiredCard onRetry={onRetry} />);
            expect(screen.getByText('This panel needs an app update')).toBeInTheDocument();
            expect(screen.getByText(/Ask your school admin or installer/)).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
            expect(onRetry).toHaveBeenCalledTimes(1);
        });

        it('with a downloaded update, Install sits in the card', () => {
            update.state = {
                offer: { version_code: 4, version_name: '0.4.0' },
                phase: 'ready',
                progress: null,
                available: true,
                last: null,
            };
            render(<UpdateRequiredCard onRetry={vi.fn()} />);
            fireEvent.click(screen.getByRole('button', { name: 'Install' }));
            expect(update.install).toHaveBeenCalledTimes(1);
            expect(screen.queryByText(/Ask your school admin or installer/)).toBeNull();
        });
    });
});
