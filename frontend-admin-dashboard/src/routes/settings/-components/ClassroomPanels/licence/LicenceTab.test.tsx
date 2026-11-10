import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PanelLicenceResponse } from '@/classroom-shared/apiTypes';
import en from '../../../../../../public/locales/en/settingsClassroomPanels.json';

/** Resolve against the real en catalogue so a missing key shows up as a raw key. */
const translate = (key: string, vars?: Record<string, unknown>): string => {
    const value = key.split('.').reduce<unknown>((node, part) => {
        if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
        return undefined;
    }, en);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
};

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
    initReactI18next: { type: '3rdParty', init: () => {} },
    Trans: ({ children }: { children?: unknown }) => children,
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-a' }));
vi.mock('@/constants/urls', () => ({ BASE_URL: 'http://api.test' }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: api }));

import { LicenceTab } from './LicenceTab';
import { useLicenceAvailability } from './probe';
import { canAssign, canRelease } from './api';

const ADMIN = 'http://api.test/auth-service/v1/panel/admin';

const reject = (status: number, code: string) =>
    Promise.reject({ response: { status, data: { code, message: 'server text' } } });

const licence = (over: Partial<PanelLicenceResponse> = {}): PanelLicenceResponse => ({
    state: 'ACTIVE',
    enforcement: 'LIVE',
    seats_granted: 2,
    seats_used: 1,
    ends_at: '2027-03-31T18:29:59Z',
    grace_ends_at: null,
    grants: [
        {
            kind: 'PAID',
            seats: 2,
            starts_at: '2026-04-01T00:00:00Z',
            ends_at: '2027-03-31T18:29:59Z',
            grace_days: 14,
        },
    ],
    rooms: [
        {
            room: { id: 'room-1', name: 'Room 1' },
            licence_state: 'LICENSED',
            licensed_at: '2026-11-01T10:00:00Z',
            device_id: 'dev-1',
        },
        {
            room: { id: 'room-2', name: 'Room 2' },
            licence_state: 'UNLICENSED',
            licensed_at: null,
            device_id: 'dev-2',
        },
    ],
    ...over,
});

let answer: () => Promise<unknown>;

beforeEach(() => {
    vi.clearAllMocks();
    answer = () => Promise.resolve({ data: licence() });
    api.get.mockImplementation((url: string) => {
        if (url === `${ADMIN}/licence`) return answer();
        return Promise.reject(new Error(`unexpected GET ${url}`));
    });
});

function renderTab(children = <LicenceTab instituteId="inst-a" />) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

describe('Licences tab states', () => {
    it('loading: a placeholder, and no empty or error text', () => {
        answer = () => new Promise(() => {});
        renderTab();
        expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
        expect(screen.queryByText(en.licence.rooms.empty.title)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('error: the mapped words, never the server text, and retry recovers', async () => {
        answer = () => reject(503, 'BUSY');
        renderTab();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(en.licence.loadError);
        expect(alert).toHaveTextContent(en.errors.BUSY);
        expect(alert).not.toHaveTextContent('server text');

        answer = () => Promise.resolve({ data: licence() });
        fireEvent.click(within(alert).getByRole('button', { name: en.common.retry }));
        expect(await screen.findByText('Room 1')).toBeInTheDocument();
    });

    it('empty: no room holds a panel yet', async () => {
        answer = () => Promise.resolve({ data: licence({ rooms: [] }) });
        renderTab();
        expect(await screen.findByText(en.licence.rooms.empty.title)).toBeInTheDocument();
    });

    it('populated: summary, grant and one chip per room', async () => {
        renderTab();
        expect(await screen.findByText('Room 1')).toBeInTheDocument();
        expect(screen.getByText(en.licence.state.ACTIVE)).toBeInTheDocument();
        expect(screen.getByText('1 of 2')).toBeInTheDocument();
        expect(screen.getByText(en.licence.grants.kind.PAID)).toBeInTheDocument();
        expect(screen.getByText(en.licence.roomState.LICENSED)).toBeInTheDocument();
        expect(screen.getByText(en.licence.roomState.UNLICENSED)).toBeInTheDocument();
        expect(screen.queryByText(en.licence.note.shadow)).toBeNull();
        expect(screen.getByRole('button', { name: 'Assign a seat to Room 2' })).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Release the seat of Room 1' })
        ).toBeInTheDocument();
    });

    it('under SHADOW it says the seats are not enforced yet', async () => {
        answer = () => Promise.resolve({ data: licence({ enforcement: 'SHADOW' }) });
        renderTab();
        expect(await screen.findByText(en.licence.note.shadow)).toBeInTheDocument();
    });

    it('a shrunk grant shows the over-limit note and lets the room give its seat back', async () => {
        answer = () =>
            Promise.resolve({
                data: licence({
                    seats_granted: 1,
                    seats_used: 2,
                    rooms: [
                        {
                            room: { id: 'room-3', name: 'Room 3' },
                            licence_state: 'OVER_LIMIT',
                            licensed_at: '2026-11-02T10:00:00Z',
                            device_id: 'dev-3',
                        },
                    ],
                }),
            });
        renderTab();
        expect(await screen.findByText(en.licence.note.overLimit)).toBeInTheDocument();
        expect(screen.getByText(en.licence.roomState.OVER_LIMIT)).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Release the seat of Room 3' })
        ).toBeInTheDocument();
    });
});

describe('seat actions', () => {
    it('assign confirms with the room name, posts, and reports success', async () => {
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Assign a seat to Room 2' }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText('Assign a seat to Room 2?')).toBeInTheDocument();

        api.post.mockResolvedValueOnce({
            status: 200,
            data: { room_id: 'room-2', licence_state: 'LICENSED' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: en.licence.assign.confirm }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Room 2 now has a seat.'));
        expect(api.post.mock.calls[0]!.slice(0, 2)).toEqual([
            `${ADMIN}/licence/rooms/room-2/assign`,
            {},
        ]);
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('NO_SEAT (409) keeps the dialog open with its own words', async () => {
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Assign a seat to Room 2' }));
        const dialog = await screen.findByRole('alertdialog');
        api.post.mockImplementationOnce(() => reject(409, 'NO_SEAT'));
        fireEvent.click(within(dialog).getByRole('button', { name: en.licence.assign.confirm }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(
            en.licence.errors.NO_SEAT
        );
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('release confirms, then posts to the release path', async () => {
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Release the seat of Room 1' }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText('Release the seat of Room 1?')).toBeInTheDocument();
        api.post.mockResolvedValueOnce({
            status: 200,
            data: { room_id: 'room-1', licence_state: 'UNLICENSED' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: en.licence.release.confirm }));
        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('Seat released from Room 1.')
        );
        expect(api.post.mock.calls[0]![0]).toBe(`${ADMIN}/licence/rooms/room-1/release`);
    });

    it('which rooms offer which action', () => {
        expect(canAssign('UNLICENSED')).toBe(true);
        expect(canAssign('LICENSED')).toBe(false);
        expect(canAssign('UNMANAGED')).toBe(false);
        expect(canRelease('LICENSED', '2026-11-01T00:00:00Z')).toBe(true);
        expect(canRelease('EXPIRED', null)).toBe(false);
        expect(canRelease('EXPIRED', '2026-11-01T00:00:00Z')).toBe(true);
        expect(canRelease('UNMANAGED', null)).toBe(false);
    });
});

describe('probe', () => {
    function Probe({ instituteId }: { instituteId: string }) {
        const on = useLicenceAvailability(instituteId);
        return (
            <>
                <span data-testid="probe">{on}</span>
                {on === 'on' && <LicenceTab instituteId={instituteId} />}
            </>
        );
    }

    it('the probe and the tab share one request', async () => {
        renderTab(<Probe instituteId="inst-a" />);
        expect(await screen.findByText('Room 1')).toBeInTheDocument();
        expect(screen.getByTestId('probe')).toHaveTextContent('on');
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(api.get.mock.calls[0]![1]).toMatchObject({ params: { institute_id: 'inst-a' } });
    });

    it('FEATURE_OFF keeps the tab off', async () => {
        answer = () => reject(404, 'FEATURE_OFF');
        renderTab(<Probe instituteId="inst-a" />);
        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('off'));
        expect(screen.queryByText(en.licence.title)).toBeNull();
    });
});
