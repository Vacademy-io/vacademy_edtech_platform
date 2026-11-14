import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
import en from '../../../../../public/locales/en/settingsClassroomPanels.json';
import hi from '../../../../../public/locales/hi/settingsClassroomPanels.json';
import fr from '../../../../../public/locales/fr/settingsClassroomPanels.json';
import ar from '../../../../../public/locales/ar/settingsClassroomPanels.json';

/** Resolve against the REAL en catalogue so a missing key shows up as a raw key. */
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

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('@/lib/auth/roleUtils', () => ({ isAdminForInstitute: () => auth.isAdmin }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: api }));

import ClassroomPanelsSettings from './ClassroomPanelsSettings';
import { normaliseSetupCode, panelErrorMessage, parseRoomList } from './api';

const BEARER = 'http://api.test/auth-service/v1/panel';

const reject = (status: number, code: string, extra: Record<string, unknown> = {}) =>
    Promise.reject({ response: { status, data: { code, message: 'server text', ...extra } } });

const device = (over: Record<string, unknown> = {}) => ({
    id: 'dev-1',
    room: { id: 'room-1', name: 'Room 1' },
    status: 'ACTIVE',
    online: true,
    last_seen_at: new Date(Date.now() - 60_000).toISOString(),
    last_ip: '203.0.113.9',
    model: 'Board 65',
    manufacturer: 'Acme',
    sdk_int: 28,
    webview_major: 66,
    app_version_code: 12,
    password_login_allowed: false,
    claimed_by_name: 'Asha Admin',
    claimed_at: '2026-11-01T10:00:00Z',
    current_session: null,
    ...over,
});

const SESSION = {
    id: 'sess-1',
    user_id: 'teacher_a',
    user_name: 'Tara Teacher',
    started_via: 'QR',
    created_at: '2026-11-04T05:00:00Z',
    expires_in_s: 3600,
    approved_ip: '198.51.100.7',
};

const ROOMS = [
    { id: 'room-1', name: 'Room 1', status: 'ACTIVE', device_id: 'dev-1' },
    { id: 'room-2', name: 'Room 2', status: 'ACTIVE', device_id: null },
];

let rooms: unknown;
let devices: unknown;

function respondToLists() {
    api.get.mockImplementation((url: string) => {
        if (url === `${BEARER}/admin/rooms`) return Promise.resolve({ data: rooms });
        if (url === `${BEARER}/admin/devices`) return Promise.resolve({ data: devices });
        return Promise.reject(new Error(`unexpected GET ${url}`));
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

const openAddPanel = () =>
    fireEvent.click(screen.getAllByRole('button', { name: en.panels.add })[0]!);

async function enterCode(code = 'K7QF-2M9X') {
    renderConsole();
    await screen.findByRole('button', { name: 'Add a panel to Room 2' });
    openAddPanel();
    const input = await screen.findByLabelText(en.addPanel.code.label);
    fireEvent.change(input, { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: en.addPanel.code.submit }));
}

const previewOk = {
    data: {
        model: 'Board 86',
        manufacturer: 'Acme',
        webview_major: 66,
        match_options: [37, 52, 14],
        expires_in_s: 300,
    },
};

/** Radix menus open on keyboard events here: happy-dom has no pointer-driven open path. */
async function openMenu(label: string) {
    const trigger = await screen.findByRole('button', { name: label });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    return screen.findByRole('menu');
}

beforeEach(() => {
    auth.isAdmin = true;
    vi.clearAllMocks();
    rooms = { rooms: ROOMS, next_unpaired_room_id: 'room-2' };
    devices = [device()];
    respondToLists();
});

describe('who can see the console', () => {
    it('a non-admin gets the note and no request goes out', () => {
        auth.isAdmin = false;
        renderConsole();
        expect(screen.getByText(en.notAdmin)).toBeInTheDocument();
        expect(api.get).not.toHaveBeenCalled();
    });
});

describe('table states', () => {
    it('loading: no empty state flashes while the lists are on their way', () => {
        api.get.mockImplementation(() => new Promise(() => {}));
        renderConsole();
        expect(screen.queryByText(en.panels.empty.title)).not.toBeInTheDocument();
        expect(screen.queryByText(en.rooms.empty.title)).not.toBeInTheDocument();
        expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
    });

    it('empty: both tables explain that a panel must first show a code', async () => {
        rooms = { rooms: [], next_unpaired_room_id: null };
        devices = [];
        renderConsole();
        expect(await screen.findByText(en.panels.empty.title)).toBeInTheDocument();
        expect(screen.getByText(en.panels.empty.body)).toBeInTheDocument();
        expect(await screen.findByText(en.rooms.empty.title)).toBeInTheDocument();
        expect(screen.getByText(en.rooms.empty.body)).toBeInTheDocument();
    });

    it('error: shows the mapped text, never the server text, and retry recovers', async () => {
        api.get.mockImplementation(() => reject(403, 'FORBIDDEN'));
        renderConsole();
        await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
        expect(screen.getAllByRole('alert')[0]).toHaveTextContent(en.errors.FORBIDDEN);
        expect(screen.queryByText(/server text/)).not.toBeInTheDocument();

        respondToLists();
        screen.getAllByRole('button', { name: en.common.retry }).forEach((b) => fireEvent.click(b));
        expect(await screen.findByText('Board 65', { exact: false })).toBeInTheDocument();
    });

    it('error with no response at all is described as a connection problem', async () => {
        api.get.mockImplementation(() => Promise.reject(new Error('Network Error')));
        renderConsole();
        const alerts = await screen.findAllByRole('alert');
        expect(alerts[0]).toHaveTextContent(en.errors.network);
    });

    it('a 5xx keeps its code, because every call asks to receive it as a response', async () => {
        api.get.mockImplementation(
            (_url: string, config: { validateStatus: (s: number) => boolean }) => {
                expect(config.validateStatus(503)).toBe(true);
                expect(config.validateStatus(403)).toBe(false);
                expect(config.validateStatus(200)).toBe(true);
                return Promise.resolve({ status: 503, data: { code: 'BUSY' } });
            }
        );
        renderConsole();
        await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
        expect(screen.getAllByRole('alert')[0]).toHaveTextContent(en.errors.BUSY);
    });

    it('a 500 with no code is a server failure, not a connection problem', async () => {
        api.get.mockImplementation(() => Promise.resolve({ status: 500, data: 'oops' }));
        renderConsole();
        await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
        expect(screen.getAllByRole('alert')[0]).toHaveTextContent(en.errors.generic);
    });

    it('populated: the panel row carries everything the admin reviews', async () => {
        devices = [device({ current_session: SESSION })];
        renderConsole();
        const cell = await screen.findByText('Tara Teacher');
        const row = cell.closest('tr')!;
        const scoped = within(row);
        expect(scoped.getByText('Room 1')).toBeInTheDocument();
        expect(scoped.getByText(en.panels.status.online)).toBeInTheDocument();
        expect(scoped.getByText('Last IP 203.0.113.9')).toBeInTheDocument();
        expect(scoped.getByText('Approved from 198.51.100.7')).toBeInTheDocument();
        expect(scoped.getByText(en.panels.teacher.viaQr)).toBeInTheDocument();
        expect(scoped.getByText('Acme Board 65')).toBeInTheDocument();
        expect(scoped.getByText('App 12, WebView 66')).toBeInTheDocument();
        expect(scoped.getByText(en.panels.liveClassHint)).toBeInTheDocument();
        expect(scoped.getByText('Asha Admin')).toBeInTheDocument();
    });

    it('removed panels stay hidden until asked for, and have no actions', async () => {
        devices = [
            device(),
            device({
                id: 'dev-old',
                room: { id: 'room-9', name: 'Room 9' },
                status: 'REVOKED',
                online: false,
            }),
        ];
        renderConsole();
        await screen.findByText('Acme Board 65');
        expect(screen.queryByText('Room 9')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('switch', { name: en.panels.showRemoved }));
        const row = (await screen.findByText('Room 9')).closest('tr')!;
        expect(within(row).getByText(en.panels.status.removed)).toBeInTheDocument();
        expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    });

    it('pages a long list and searches by room', async () => {
        rooms = {
            rooms: Array.from({ length: 23 }, (_, i) => ({
                id: `r${i}`,
                name: `Room ${i + 1}`,
                status: 'ACTIVE',
                device_id: null,
            })),
            next_unpaired_room_id: 'r0',
        };
        devices = [];
        renderConsole();
        await screen.findByRole('button', { name: 'Add a panel to Room 1' });
        // Reading order: Room 2 comes before Room 10, and Room 11 is on the next page.
        expect(screen.getByRole('button', { name: 'Add a panel to Room 10' })).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Add a panel to Room 11' })
        ).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(en.rooms.search), { target: { value: 'room 23' } });
        expect(
            await screen.findByRole('button', { name: 'Add a panel to Room 23' })
        ).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(en.rooms.search), { target: { value: 'nope' } });
        expect(await screen.findByText(en.rooms.noMatch)).toBeInTheDocument();
    });
});

describe('add a panel', () => {
    beforeEach(() => {
        api.post.mockImplementation((url: string) => {
            if (url === `${BEARER}/pair/preview`) return Promise.resolve(previewOk);
            return Promise.reject(new Error(`unexpected POST ${url}`));
        });
    });

    it('rejects a short code without calling the server', async () => {
        await enterCode('K7QF');
        expect(await screen.findByText(en.addPanel.code.invalid)).toBeInTheDocument();
        expect(api.post).not.toHaveBeenCalled();
    });

    it('explains a code no panel is showing', async () => {
        api.post.mockImplementation(() => reject(404, 'NOT_FOUND'));
        await enterCode();
        expect(await screen.findByText(en.addPanel.code.notFound)).toBeInTheDocument();
    });

    it('previews the panel, then needs the number before it will pair', async () => {
        await enterCode();
        expect(await screen.findByText('Acme Board 86, WebView 66')).toBeInTheDocument();
        expect(api.post.mock.calls[0]![1]).toEqual({ code: 'K7QF2M9X' });
        ['37', '52', '14'].forEach((n) =>
            expect(screen.getByRole('radio', { name: n })).toBeInTheDocument()
        );
        expect(screen.getByText(en.addPanel.details.warning)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.submit }));
        expect(await screen.findByText(en.addPanel.details.numberRequired)).toBeInTheDocument();
        expect(api.post).toHaveBeenCalledTimes(1);
    });

    it('claims into the suggested room and tells the admin to confirm on the panel', async () => {
        await enterCode();
        await screen.findByRole('radio', { name: '52' });
        api.post.mockImplementation(() =>
            Promise.resolve({
                data: {
                    device_id: 'dev-new',
                    status: 'CLAIMED',
                    room: { id: 'room-2', name: 'Room 2' },
                },
            })
        );
        fireEvent.click(screen.getByRole('radio', { name: '52' }));
        expect(screen.getByRole('radio', { name: '52' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.submit }));

        expect(await screen.findByText(en.addPanel.done.title)).toBeInTheDocument();
        expect(api.post.mock.lastCall!.slice(0, 2)).toEqual([
            `${BEARER}/admin/devices/claim`,
            {
                code: 'K7QF2M9X',
                match_code: 52,
                institute_id: 'inst-a',
                room_id: 'room-2',
                replace_existing: false,
            },
        ]);

        devices = [device({ id: 'dev-new', room: { id: 'room-2', name: 'Room 2' } })];
        await waitFor(() => expect(screen.getByText('Room 2 is ready')).toBeInTheDocument(), {
            timeout: 8000,
        });
    }, 15000);

    it('a new room name goes in place of a room id', async () => {
        await enterCode();
        await screen.findByRole('radio', { name: '37' });
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.useNewRoom }));
        fireEvent.change(await screen.findByLabelText(en.addPanel.details.newRoomLabel), {
            target: { value: 'Lab 4' },
        });
        fireEvent.click(screen.getByRole('radio', { name: '37' }));
        api.post.mockImplementation(() => reject(409, 'ROOM_NAME_TAKEN'));
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.submit }));

        expect(await screen.findByText(en.errors.ROOM_NAME_TAKEN)).toBeInTheDocument();
        expect(api.post.mock.lastCall![1]).toEqual({
            code: 'K7QF2M9X',
            match_code: 37,
            institute_id: 'inst-a',
            new_room_name: 'Lab 4',
            replace_existing: false,
        });
    });

    it('T52: a wrong number goes back for the new code and keeps the room', async () => {
        await enterCode();
        await screen.findByRole('radio', { name: '14' });
        api.post.mockImplementation(() => reject(409, 'WRONG_NUMBER'));
        fireEvent.click(screen.getByRole('radio', { name: '14' }));
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.submit }));

        expect(await screen.findByText(en.addPanel.details.wrongNumber)).toBeInTheDocument();
        const input = screen.getByLabelText(en.addPanel.code.label);
        expect(input).toHaveValue('');

        api.post.mockImplementation((url: string) =>
            url === `${BEARER}/pair/preview`
                ? Promise.resolve(previewOk)
                : Promise.resolve({
                      data: {
                          device_id: 'dev-new',
                          status: 'CLAIMED',
                          room: { id: 'room-2', name: 'Room 2' },
                      },
                  })
        );
        fireEvent.change(input, { target: { value: 'NEWC0DE1' } });
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.code.submit }));
        fireEvent.click(await screen.findByRole('radio', { name: '14' }));
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.submit }));
        await screen.findByText(en.addPanel.done.title);
        expect(api.post.mock.lastCall![1]).toMatchObject({
            code: 'NEWC0DE1',
            room_id: 'room-2',
        });
    });

    it('a code that lapses before the tap goes back for a new one', async () => {
        await enterCode();
        await screen.findByRole('radio', { name: '14' });
        api.post.mockImplementation(() => reject(404, 'NOT_FOUND'));
        fireEvent.click(screen.getByRole('radio', { name: '14' }));
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.submit }));
        expect(await screen.findByText(en.addPanel.details.expired)).toBeInTheDocument();
    });

    it('T5: an occupied room asks first, names the room, and replaces only on confirm', async () => {
        await enterCode();
        await screen.findByRole('radio', { name: '52' });
        api.post.mockImplementation(() =>
            reject(409, 'ROOM_OCCUPIED', {
                current_device: { id: 'dev-1', model: 'Board 65', last_seen_at: null },
            })
        );
        fireEvent.click(screen.getByRole('radio', { name: '52' }));
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.submit }));

        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText('Replace the panel in Room 2?')).toBeInTheDocument();
        expect(within(dialog).getByText(/Board 65, not seen yet/)).toBeInTheDocument();
        expect(api.post.mock.lastCall![1]).toMatchObject({ replace_existing: false });

        api.post.mockImplementation(() =>
            Promise.resolve({
                data: {
                    device_id: 'dev-new',
                    status: 'CLAIMED',
                    room: { id: 'room-2', name: 'Room 2' },
                },
            })
        );
        fireEvent.click(within(dialog).getByRole('button', { name: en.addPanel.replace.confirm }));
        expect(await screen.findByText(en.addPanel.done.title)).toBeInTheDocument();
        expect(api.post.mock.lastCall![1]).toMatchObject({
            room_id: 'room-2',
            replace_existing: true,
        });
    });

    it('T51: a room of another institute shows inline and stays on the form', async () => {
        await enterCode();
        await screen.findByRole('radio', { name: '52' });
        api.post.mockImplementation(() => reject(403, 'ROOM_OTHER_INSTITUTE'));
        fireEvent.click(screen.getByRole('radio', { name: '52' }));
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.submit }));
        expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.ROOM_OTHER_INSTITUTE);
        expect(screen.getByRole('radio', { name: '52' })).toBeInTheDocument();
    });

    it('T6, T7: a refused claim says why and does not leave the form', async () => {
        await enterCode();
        await screen.findByRole('radio', { name: '52' });
        api.post.mockImplementation(() => reject(403, 'FORBIDDEN'));
        fireEvent.click(screen.getByRole('radio', { name: '52' }));
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.submit }));
        expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.FORBIDDEN);
    });

    it('T63: the 503 from a claim tells the admin to try again and keeps the form', async () => {
        await enterCode();
        await screen.findByRole('radio', { name: '52' });
        api.post.mockImplementation(() =>
            Promise.resolve({ status: 503, data: { code: 'TRY_AGAIN' } })
        );
        fireEvent.click(screen.getByRole('radio', { name: '52' }));
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.details.submit }));
        expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.TRY_AGAIN);
        expect(screen.getByRole('radio', { name: '52' })).toHaveAttribute('aria-checked', 'true');
    });

    it('opened from a room row, it starts on that room', async () => {
        devices = [];
        rooms = {
            rooms: [
                { id: 'room-2', name: 'Room 2', status: 'ACTIVE', device_id: null },
                { id: 'room-3', name: 'Room 3', status: 'ACTIVE', device_id: null },
            ],
            next_unpaired_room_id: 'room-2',
        };
        renderConsole();
        fireEvent.click(await screen.findByRole('button', { name: 'Add a panel to Room 3' }));
        fireEvent.change(await screen.findByLabelText(en.addPanel.code.label), {
            target: { value: 'K7QF2M9X' },
        });
        fireEvent.click(screen.getByRole('button', { name: en.addPanel.code.submit }));
        await screen.findByRole('radio', { name: '52' });
        expect(screen.getByRole('combobox')).toHaveTextContent('Room 3');
    });
});

describe('panel actions', () => {
    it('toggles password sign-in and reports a failure', async () => {
        renderConsole();
        const toggle = await screen.findByRole('switch', {
            name: 'Allow password sign-in on the panel in Room 1',
        });
        api.patch.mockResolvedValueOnce({ data: device({ password_login_allowed: true }) });
        fireEvent.click(toggle);
        await waitFor(() =>
            expect(api.patch.mock.lastCall!.slice(0, 2)).toEqual([
                `${BEARER}/admin/devices/dev-1`,
                { password_login_allowed: true },
            ])
        );

        api.patch.mockImplementationOnce(() => reject(429, 'RATE_LIMITED'));
        await waitFor(() => expect(toggle).toBeEnabled());
        fireEvent.click(toggle);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.errors.RATE_LIMITED));
    });

    it('revoke confirms with the room name, then calls the server', async () => {
        renderConsole();
        const menu = await openMenu('Actions for the panel in Room 1');
        fireEvent.click(within(menu).getByRole('menuitem', { name: en.panels.actions.revoke }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText('Remove the panel in Room 1?')).toBeInTheDocument();
        expect(api.post).not.toHaveBeenCalled();

        api.post.mockResolvedValueOnce({ data: { status: 'REVOKED' } });
        fireEvent.click(within(dialog).getByRole('button', { name: en.revoke.confirm }));
        await waitFor(() =>
            expect(api.post.mock.lastCall!.slice(0, 2)).toEqual([
                `${BEARER}/admin/devices/dev-1/revoke`,
                {},
            ])
        );
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    });

    it('a failed revoke stays open with the reason', async () => {
        renderConsole();
        const menu = await openMenu('Actions for the panel in Room 1');
        fireEvent.click(within(menu).getByRole('menuitem', { name: en.panels.actions.revoke }));
        const dialog = await screen.findByRole('alertdialog');
        api.post.mockImplementationOnce(() => reject(503, 'BUSY'));
        fireEvent.click(within(dialog).getByRole('button', { name: en.revoke.confirm }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.errors.BUSY);
    });

    it('end session appears only with a session, and names the teacher', async () => {
        const first = renderConsole();
        let menu = await openMenu('Actions for the panel in Room 1');
        expect(
            within(menu).queryByRole('menuitem', { name: en.panels.actions.endSession })
        ).not.toBeInTheDocument();
        first.unmount();

        devices = [device({ current_session: SESSION })];
        renderConsole();
        menu = await openMenu('Actions for the panel in Room 1');
        fireEvent.click(within(menu).getByRole('menuitem', { name: en.panels.actions.endSession }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText(/Tara Teacher is signed out/)).toBeInTheDocument();
        api.post.mockResolvedValueOnce({ data: { ended: true } });
        fireEvent.click(within(dialog).getByRole('button', { name: en.endSession.confirm }));
        await waitFor(() =>
            expect(api.post.mock.lastCall!.slice(0, 2)).toEqual([
                `${BEARER}/admin/sessions/sess-1/end`,
                {},
            ])
        );
    });

    it('move offers only free rooms, and shows a refusal from the server', async () => {
        renderConsole();
        await screen.findByRole('button', { name: 'Add a panel to Room 2' });
        const menu = await openMenu('Actions for the panel in Room 1');
        fireEvent.click(within(menu).getByRole('menuitem', { name: en.panels.actions.move }));
        const dialog = await screen.findByRole('dialog');

        fireEvent.click(within(dialog).getByRole('button', { name: en.move.submit }));
        expect(await within(dialog).findByText(en.move.roomRequired)).toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('combobox'));
        const options = await within(dialog).findAllByRole('option');
        expect(options.map((o) => o.textContent)).toEqual(['Room 2']);
        fireEvent.click(options[0]!);

        api.patch.mockImplementationOnce(() => reject(403, 'ROOM_OTHER_INSTITUTE'));
        fireEvent.click(within(dialog).getByRole('button', { name: en.move.submit }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(
            en.errors.ROOM_OTHER_INSTITUTE
        );
        expect(api.patch.mock.lastCall!.slice(0, 2)).toEqual([
            `${BEARER}/admin/devices/dev-1`,
            { room_id: 'room-2' },
        ]);

        api.patch.mockResolvedValueOnce({ data: device() });
        fireEvent.click(within(dialog).getByRole('button', { name: en.move.submit }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(toast.success).toHaveBeenCalledWith('Panel moved to Room 2.');
    });
});

describe('rooms', () => {
    it('adds a room, and shows a taken name on the field', async () => {
        renderConsole();
        fireEvent.click(await screen.findByRole('button', { name: en.rooms.add.open }));
        const input = await screen.findByLabelText(en.rooms.name.label);
        fireEvent.click(screen.getByRole('button', { name: en.common.save }));
        expect(await screen.findByText(en.rooms.name.required)).toBeInTheDocument();

        api.post.mockImplementationOnce(() => reject(409, 'ROOM_NAME_TAKEN'));
        fireEvent.change(input, { target: { value: '  Room 1  ' } });
        fireEvent.click(screen.getByRole('button', { name: en.common.save }));
        expect(await screen.findByText(en.errors.ROOM_NAME_TAKEN)).toBeInTheDocument();
        expect(api.post.mock.lastCall!.slice(0, 2)).toEqual([
            `${BEARER}/admin/rooms`,
            { institute_id: 'inst-a', name: 'Room 1' },
        ]);

        api.post.mockResolvedValueOnce({ data: { id: 'r', name: 'Room 3', status: 'ACTIVE' } });
        fireEvent.change(input, { target: { value: 'Room 3' } });
        fireEvent.click(screen.getByRole('button', { name: en.common.save }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('pastes a list and reports what was added and skipped', async () => {
        renderConsole();
        fireEvent.click(await screen.findByRole('button', { name: en.rooms.paste.open }));
        const area = await screen.findByLabelText(en.rooms.paste.label);

        fireEvent.click(screen.getByRole('button', { name: en.rooms.paste.submit }));
        expect(await screen.findByText(en.rooms.paste.required)).toBeInTheDocument();

        fireEvent.change(area, {
            target: { value: Array.from({ length: 201 }, (_, i) => `R${i}`).join('\n') },
        });
        fireEvent.click(screen.getByRole('button', { name: en.rooms.paste.submit }));
        expect(await screen.findByText('Paste at most 200 rooms at a time.')).toBeInTheDocument();
        expect(api.post).not.toHaveBeenCalled();

        api.post.mockResolvedValueOnce({
            data: {
                created: [{ id: 'a', name: 'Lab 1', status: 'ACTIVE' }],
                skipped_duplicates: ['Room 1'],
            },
        });
        fireEvent.change(area, { target: { value: 'Lab 1\n\n Room 1 \nlab 1\n' } });
        fireEvent.click(screen.getByRole('button', { name: en.rooms.paste.submit }));
        expect(await screen.findByText('Rooms added: 1')).toBeInTheDocument();
        expect(screen.getByText('Already there, skipped: 1')).toBeInTheDocument();
        expect(api.post.mock.lastCall!.slice(0, 2)).toEqual([
            `${BEARER}/admin/rooms/bulk`,
            { institute_id: 'inst-a', names: ['Lab 1', 'Room 1'] },
        ]);
    });

    it('archive confirms with the room name and shows a refusal inline', async () => {
        renderConsole();
        const menu = await openMenu('Actions for Room 1');
        fireEvent.click(within(menu).getByRole('menuitem', { name: en.rooms.actions.archive }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText('Archive Room 1?')).toBeInTheDocument();

        api.patch.mockImplementationOnce(() => reject(409, 'ROOM_HAS_DEVICE'));
        fireEvent.click(within(dialog).getByRole('button', { name: en.rooms.archive.confirm }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(
            en.errors.ROOM_HAS_DEVICE
        );
        expect(api.patch.mock.lastCall!.slice(0, 2)).toEqual([
            `${BEARER}/admin/rooms/room-1`,
            { status: 'ARCHIVED' },
        ]);
    });

    it('archived rooms are not listed or offered', async () => {
        rooms = {
            rooms: [...ROOMS, { id: 'room-x', name: 'Old Room', status: 'ARCHIVED' }],
            next_unpaired_room_id: 'room-2',
        };
        renderConsole();
        await screen.findByRole('button', { name: 'Add a panel to Room 2' });
        expect(screen.queryByText('Old Room')).not.toBeInTheDocument();
    });
});

describe('helpers', () => {
    it('normalises a typed code', () => {
        expect(normaliseSetupCode(' k7qf-2m9x ')).toBe('K7QF2M9X');
    });
    it('parses a pasted list', () => {
        expect(parseRoomList('A\r\n\r\n  B  \na\n')).toEqual(['A', 'B']);
    });
});

describe('catalogs', () => {
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
    const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort().join();
    const reference = flatten(en);

    it.each([
        ['hi', hi],
        ['fr', fr],
        ['ar', ar],
    ])('%s has every key and the same placeholders as en', (_name, catalog) => {
        const flat = flatten(catalog);
        expect(Object.keys(flat).sort()).toEqual(Object.keys(reference).sort());
        Object.entries(reference).forEach(([key, text]) =>
            expect(placeholders(flat[key]!), key).toBe(placeholders(text))
        );
    });

    it('every key the code asks for exists in en', () => {
        const dir = path.resolve(process.cwd(), 'src/routes/settings/-components/ClassroomPanels');
        const source = fs
            .readdirSync(dir)
            .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
            .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
            .join('\n');
        const used = [...source.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((m) => m[1]!);
        const quoted = [...source.matchAll(/key: '(panels\.[\w.]+)'/g)].map((m) => m[1]!);
        const codes = [...source.matchAll(/^ {4}'([A-Z_]+)',$/gm)].map((m) => `errors.${m[1]}`);
        expect(used.length).toBeGreaterThan(40);
        expect(quoted.length).toBeGreaterThan(3);
        expect(codes.length).toBeGreaterThan(8);
        [...used, ...quoted, ...codes].forEach((key) => expect(reference[key], key).toBeDefined());
    });
});

describe('panelErrorMessage, phase 2 codes', () => {
    const t = ((key: string) => key) as never;
    it.each([
        'LICENCE_REQUIRED',
        'AWAITING_APPROVAL',
        'UPDATE_REQUIRED',
        'FEATURE_OFF',
        'NOT_INSTALLER',
        'INVITE_INVALID',
        'NO_SEAT',
    ])('%s has its own words, never the generic ones', (code) => {
        const error = { response: { status: 403, data: { code, message: 'server text' } } };
        expect(panelErrorMessage(t, error)).toBe(`errors.${code}`);
        expect(en.errors[code as keyof typeof en.errors]).toBeTruthy();
    });
});
