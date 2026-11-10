import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
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
vi.mock('@/lib/auth/roleUtils', () => ({ isAdminForInstitute: () => true }));
// The Usage tab is another chunk's; it stays off here.
vi.mock('../usage/probe', () => ({ useUsageAvailability: () => 'off' }));
vi.mock('../usage/UsageTab', () => ({ UsageTab: () => null }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: api }));

import ClassroomPanelsSettings from '../ClassroomPanelsSettings';

const ADMIN = 'http://api.test/auth-service/v1/panel/admin';

const featureOff = () =>
    Promise.reject({ response: { status: 404, data: { code: 'FEATURE_OFF', message: 'x' } } });
const reject = (status: number, code: string) =>
    Promise.reject({ response: { status, data: { code, message: 'server text' } } });

const device = (over: Record<string, unknown> = {}) => ({
    id: 'dev-1',
    room: { id: 'room-1', name: 'Room 1' },
    status: 'ACTIVE',
    online: true,
    last_seen_at: new Date(Date.now() - 60_000).toISOString(),
    last_ip: null,
    model: 'Board 65',
    manufacturer: 'Acme',
    sdk_int: 28,
    webview_major: 66,
    app_version_code: 3,
    password_login_allowed: false,
    claimed_by_name: 'Ivan Installer',
    claimed_at: '2026-11-01T10:00:00Z',
    current_session: null,
    approval_state: 'APPROVED',
    app_channel: 'PLAY',
    installed_by: null,
    licence_state: null,
    ...over,
});

let devices: unknown[];
let fleet: () => Promise<unknown>;

beforeEach(() => {
    vi.clearAllMocks();
    devices = [device()];
    fleet = featureOff;
    api.get.mockImplementation((url: string) => {
        if (url === `${ADMIN}/rooms`) {
            return Promise.resolve({
                data: {
                    rooms: [
                        { id: 'room-1', name: 'Room 1', status: 'ACTIVE', device_id: 'dev-1' },
                        { id: 'room-2', name: 'Room 2', status: 'ACTIVE', device_id: 'dev-2' },
                    ],
                    next_unpaired_room_id: null,
                },
            });
        }
        if (url === `${ADMIN}/devices`) return Promise.resolve({ data: devices });
        if (url === `${ADMIN}/fleet`) return fleet();
        return featureOff();
    });
});

function renderConsole() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ClassroomPanelsSettings />
        </QueryClientProvider>
    );
}

const pending = (over: Record<string, unknown> = {}) =>
    device({ approval_state: 'PENDING', installed_by: 'Installer One', ...over });

describe('installer set-ups waiting for approval', () => {
    it('a banner names the installer and counts the waiting panels', async () => {
        devices = [
            pending(),
            pending({ id: 'dev-2', room: { id: 'room-2', name: 'Room 2' } }),
            device({ id: 'dev-3', room: { id: 'room-3', name: 'Room 3' } }),
        ];
        renderConsole();
        expect(
            await screen.findByText('Set up by Installer One and waiting for your approval: 2')
        ).toBeInTheDocument();
        expect(screen.getAllByText(en.installers.approval.chip)).toHaveLength(2);
        expect(screen.getAllByText('Set up by Installer One')).toHaveLength(2);
    });

    it('panels from different installers get the general banner', async () => {
        devices = [
            pending(),
            pending({
                id: 'dev-2',
                room: { id: 'room-2', name: 'Room 2' },
                installed_by: 'Installer Two',
            }),
        ];
        renderConsole();
        expect(
            await screen.findByText('Set up by installers and waiting for your approval: 2')
        ).toBeInTheDocument();
    });

    it('no banner when nothing is waiting', async () => {
        renderConsole();
        await screen.findByText('Board 65'.replace('Board 65', 'Acme Board 65'));
        expect(screen.queryByText(/waiting for your approval/)).toBeNull();
    });

    it('approve asks first, posts, and reports success', async () => {
        devices = [pending()];
        renderConsole();
        fireEvent.click(await screen.findByRole('button', { name: 'Approve the panel in Room 1' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Approve the panel in Room 1?')).toBeInTheDocument();
        api.post.mockResolvedValueOnce({ status: 200, data: device() });
        devices = [device({ installed_by: 'Installer One' })];
        fireEvent.click(
            within(dialog).getByRole('button', { name: en.installers.approval.approveConfirm })
        );
        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('Panel in Room 1 approved.')
        );
        expect(api.post.mock.calls[0]!.slice(0, 2)).toEqual([`${ADMIN}/devices/dev-1/approve`, {}]);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await waitFor(() => expect(screen.queryByText(/waiting for your approval/)).toBeNull());
    });

    it('a refused approve stays open with the reason', async () => {
        devices = [pending()];
        renderConsole();
        fireEvent.click(await screen.findByRole('button', { name: 'Approve the panel in Room 1' }));
        const dialog = await screen.findByRole('dialog');
        api.post.mockImplementationOnce(() => reject(403, 'FORBIDDEN'));
        fireEvent.click(
            within(dialog).getByRole('button', { name: en.installers.approval.approveConfirm })
        );
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.errors.FORBIDDEN);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('reject confirms with the room name, then posts', async () => {
        devices = [pending()];
        renderConsole();
        fireEvent.click(await screen.findByRole('button', { name: 'Reject the panel in Room 1' }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText('Reject the panel in Room 1?')).toBeInTheDocument();
        api.post.mockResolvedValueOnce({ status: 200, data: { status: 'REVOKED' } });
        fireEvent.click(
            within(dialog).getByRole('button', { name: en.installers.approval.rejectConfirm })
        );
        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('Panel in Room 1 rejected.')
        );
        expect(api.post.mock.calls[0]![0]).toBe(`${ADMIN}/devices/dev-1/reject`);
    });

    it('a waiting panel offers approve and reject, not move or remove', async () => {
        devices = [pending()];
        renderConsole();
        await screen.findByRole('button', { name: 'Approve the panel in Room 1' });
        expect(
            screen.queryByRole('button', { name: 'Actions for the panel in Room 1' })
        ).toBeNull();
    });
});

describe('licence and alert chips on the panel list', () => {
    it('shows the room seat state, and nothing while seats are unmanaged', async () => {
        devices = [
            device({ licence_state: 'OVER_LIMIT' }),
            device({
                id: 'dev-2',
                room: { id: 'room-2', name: 'Room 2' },
                licence_state: 'UNMANAGED',
            }),
        ];
        renderConsole();
        expect(await screen.findByText(en.licence.roomState.OVER_LIMIT)).toBeInTheDocument();
        expect(screen.queryByText(en.licence.roomState.UNMANAGED)).toBeNull();
    });

    it('with alerts on: the worst alert per panel and a one-line summary', async () => {
        fleet = () =>
            Promise.resolve({
                data: {
                    generated_at: '2026-11-09T10:00:00Z',
                    counts: { OFFLINE: 1 },
                    alerts: [
                        {
                            kind: 'OFFLINE',
                            severity: 'warn',
                            device_id: 'dev-1',
                            room: { id: 'room-1', name: 'Room 1' },
                            since: '2026-11-05T10:00:00Z',
                            incident_key: 'k',
                            detail: {},
                        },
                    ],
                },
            });
        renderConsole();
        expect(await screen.findByText('Panels that need attention: 1')).toBeInTheDocument();
        expect(screen.getByText(en.alerts.kind.OFFLINE)).toBeInTheDocument();
        // The probe and the list share one answer.
        expect(api.get.mock.calls.filter(([url]) => url === `${ADMIN}/fleet`)).toHaveLength(1);
    });

    it('with alerts off: no chip, no summary, and /fleet is asked once', async () => {
        renderConsole();
        await screen.findByText('Acme Board 65');
        await waitFor(() =>
            expect(api.get.mock.calls.some(([url]) => url === `${ADMIN}/fleet`)).toBe(true)
        );
        expect(screen.queryByText(/need attention/)).toBeNull();
        expect(screen.queryByText(en.alerts.kind.OFFLINE)).toBeNull();
        expect(api.get.mock.calls.filter(([url]) => url === `${ADMIN}/fleet`)).toHaveLength(1);
    });
});

describe('F2 catalogue', () => {
    it('every key the licence, installer and alert code asks for exists in en', () => {
        const flatten = (node: object, prefix = ''): Record<string, string> =>
            Object.entries(node).reduce<Record<string, string>>((out, [key, value]) => {
                const next = prefix ? `${prefix}.${key}` : key;
                if (typeof value === 'object' && value !== null) {
                    Object.assign(out, flatten(value as object, next));
                } else {
                    out[next] = String(value);
                }
                return out;
            }, {});
        const reference = flatten(en);
        const root = path.resolve(process.cwd(), 'src/routes/settings/-components/ClassroomPanels');
        const files = [
            path.join(root, 'PanelsCard.tsx'),
            ...['licence', 'installers', 'alerts'].flatMap((dir) =>
                fs
                    .readdirSync(path.join(root, dir))
                    .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
                    .map((file) => path.join(root, dir, file))
            ),
        ];
        const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
        const called = [...source.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((m) => m[1]!);
        const literal = [...source.matchAll(/'((?:licence|installers|alerts)\.[\w.]+)'/g)].map(
            (m) => m[1]!
        );
        expect(called.length).toBeGreaterThan(60);
        expect(literal.length).toBeGreaterThan(30);
        [...called, ...literal].forEach((key) => expect(reference[key], key).toBeDefined());
    });
});
