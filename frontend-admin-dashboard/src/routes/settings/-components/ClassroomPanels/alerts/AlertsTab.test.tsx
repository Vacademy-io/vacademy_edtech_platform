import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PanelFleetAlert, PanelFleetResponse } from '@/classroom-shared/apiTypes';
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

import { AlertsTab } from './AlertsTab';
import { groupBySeverity, parseNotifySetting, worstAlertByDevice } from './api';

const ADMIN = 'http://api.test/auth-service/v1/panel/admin';
const SETTING = 'http://api.test/admin-core-service/institute/setting/v1';

const reject = (status: number, code: string) =>
    Promise.reject({ response: { status, data: { code, message: 'server text' } } });

const alert = (over: Partial<PanelFleetAlert>): PanelFleetAlert => ({
    kind: 'OFFLINE',
    severity: 'warn',
    device_id: 'dev-1',
    room: { id: 'room-1', name: 'Room 1' },
    since: '2026-11-05T10:00:00Z',
    incident_key: 'k',
    detail: {},
    ...over,
});

const FLEET: PanelFleetResponse = {
    generated_at: '2026-11-09T10:00:00Z',
    counts: { OFFLINE: 1, UPDATE_REQUIRED: 1, WEBVIEW_OLD: 1 },
    alerts: [
        alert({}),
        alert({
            kind: 'UPDATE_REQUIRED',
            severity: 'bad',
            device_id: 'dev-2',
            room: { id: 'room-2', name: 'Room 2' },
        }),
        alert({ kind: 'WEBVIEW_OLD', severity: 'info', device_id: 'dev-3', room: null }),
        // A kind from a newer server is listed with a generic label, never as a raw code.
        alert({ kind: 'SOMETHING_NEW', device_id: 'dev-4', room: { id: 'r4', name: 'Room 4' } }),
    ],
};

let fleet: () => Promise<unknown>;
let setting: () => Promise<unknown>;

beforeEach(() => {
    vi.clearAllMocks();
    fleet = () => Promise.resolve({ data: FLEET });
    setting = () => Promise.resolve({ data: '' });
    api.get.mockImplementation((url: string) => {
        if (url === `${ADMIN}/fleet`) return fleet();
        if (url === `${SETTING}/get`) return setting();
        return Promise.reject(new Error(`unexpected GET ${url}`));
    });
});

function renderTab() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AlertsTab instituteId="inst-a" />
        </QueryClientProvider>
    );
}

describe('Alerts tab states', () => {
    it('loading: a placeholder, and no empty text', () => {
        fleet = () => new Promise(() => {});
        renderTab();
        expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
        expect(screen.queryByText(en.alerts.empty.title)).toBeNull();
    });

    it('error: the mapped words, never the server text, and retry recovers', async () => {
        fleet = () => reject(503, 'BUSY');
        renderTab();
        const box = (await screen.findAllByRole('alert')).find((node) =>
            node.textContent?.includes(en.alerts.loadError)
        )!;
        expect(box).toHaveTextContent(en.errors.BUSY);
        expect(box).not.toHaveTextContent('server text');
        fleet = () => Promise.resolve({ data: FLEET });
        fireEvent.click(within(box).getByRole('button', { name: en.common.retry }));
        expect(await screen.findByText('Room 2')).toBeInTheDocument();
    });

    it('empty: says nothing needs attention', async () => {
        fleet = () => Promise.resolve({ data: { ...FLEET, counts: {}, alerts: [] } });
        renderTab();
        expect(await screen.findByText(en.alerts.empty.title)).toBeInTheDocument();
    });

    it('populated: grouped worst first, each with what to do', async () => {
        renderTab();
        await screen.findByText('Room 2');
        const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(headings).toEqual([
            en.alerts.severity.bad,
            en.alerts.severity.warn,
            en.alerts.severity.info,
        ]);
        expect(screen.getByText(en.alerts.todo.UPDATE_REQUIRED)).toBeInTheDocument();
        expect(screen.getByText(en.alerts.todo.OFFLINE)).toBeInTheDocument();
        expect(screen.getByText(en.alerts.todo.WEBVIEW_OLD)).toBeInTheDocument();
        expect(screen.getByText(en.alerts.institute)).toBeInTheDocument();
        expect(screen.getByText('Room 4')).toBeInTheDocument();
        expect(screen.getByText(en.alerts.todo.other)).toBeInTheDocument();
        expect(screen.queryByText('SOMETHING_NEW')).toBeNull();
        expect(screen.queryByText('alerts.kind.SOMETHING_NEW')).toBeNull();
    });

    it('only kinds this console does not know: still listed, never the empty state', async () => {
        fleet = () =>
            Promise.resolve({
                data: {
                    ...FLEET,
                    counts: {},
                    alerts: [alert({ kind: 'SOMETHING_NEW', severity: 'warn' })],
                },
            });
        renderTab();
        expect(await screen.findByText(en.alerts.kind.other)).toBeInTheDocument();
        expect(screen.getByText(en.alerts.todo.other)).toBeInTheDocument();
        expect(screen.queryByText(en.alerts.empty.title)).toBeNull();
    });
});

describe('email alert setting', () => {
    it('never saved: off, at the default hour, in the admin zone', async () => {
        renderTab();
        const toggle = await screen.findByRole('switch');
        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(screen.getByRole('button', { name: en.alerts.notify.save })).toBeDisabled();
        expect(api.get).toHaveBeenCalledWith(`${SETTING}/get`, {
            params: { instituteId: 'inst-a', settingKey: 'CLASSROOM_NOTIFY_SETTING' },
        });
    });

    it('turning it on saves the stored setting with only that field changed', async () => {
        setting = () =>
            Promise.resolve({
                data: {
                    key: 'CLASSROOM_NOTIFY_SETTING',
                    data: {
                        alerts_email: false,
                        hour: 7,
                        timezone: 'Europe/Paris',
                        whatsapp_weekly: true,
                        recipient_roles: ['ADMIN'],
                    },
                },
            });
        api.post.mockResolvedValueOnce({ data: 'ok' });
        renderTab();
        expect(await screen.findByText('Time zone: Europe/Paris')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('switch'));
        fireEvent.click(screen.getByRole('button', { name: en.alerts.notify.save }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en.alerts.notify.saved));
        const [url, body, config] = api.post.mock.calls[0]!;
        expect(url).toBe(`${SETTING}/save-setting`);
        expect(config).toEqual({
            params: { instituteId: 'inst-a', settingKey: 'CLASSROOM_NOTIFY_SETTING' },
        });
        expect(body.setting_data).toMatchObject({
            alerts_email: true,
            hour: 7,
            timezone: 'Europe/Paris',
            whatsapp_weekly: true,
            recipient_roles: ['ADMIN'],
        });
    });

    it('a failed save says so and keeps the change', async () => {
        api.post.mockRejectedValueOnce({ response: { status: 500, data: {} } });
        renderTab();
        fireEvent.click(await screen.findByRole('switch'));
        fireEvent.click(screen.getByRole('button', { name: en.alerts.notify.save }));
        const failure = (await screen.findAllByRole('alert')).find((node) =>
            node.textContent?.includes(en.alerts.notify.saveError)
        );
        expect(failure).toBeDefined();
        expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    });

    it('a failed read offers a retry', async () => {
        setting = () => reject(500, 'ERROR');
        renderTab();
        const box = await waitFor(() => {
            const found = screen
                .getAllByRole('alert')
                .find((node) => node.textContent?.includes(en.alerts.notify.loadError));
            expect(found).toBeDefined();
            return found!;
        });
        setting = () => Promise.resolve({ data: '' });
        fireEvent.click(within(box).getByRole('button', { name: en.common.retry }));
        expect(await screen.findByRole('switch')).toBeInTheDocument();
    });
});

describe('helpers', () => {
    it('the worst alert of each panel wins', () => {
        const worst = worstAlertByDevice([
            alert({ kind: 'UNUSED', severity: 'warn' }),
            alert({ kind: 'UPDATE_REQUIRED', severity: 'bad' }),
            alert({ kind: 'APP_OUTDATED', severity: 'info' }),
            alert({ kind: 'LICENCE_ENDING', severity: 'warn', device_id: null }),
        ]);
        expect(worst.get('dev-1')?.kind).toBe('UPDATE_REQUIRED');
        expect(worst.size).toBe(1);
    });

    it('a kind this console does not know is grouped and can be a panel worst', () => {
        const unknown = alert({ kind: 'SOMETHING_NEW', severity: 'warn' });
        expect(groupBySeverity([unknown], 'en')).toEqual([{ severity: 'warn', alerts: [unknown] }]);
        expect(worstAlertByDevice([unknown]).get('dev-1')).toBe(unknown);
        // An unknown severity is listed as info, and gives no row chip.
        const odd = alert({ severity: 'odd' as never });
        expect(groupBySeverity([odd], 'en').map((group) => group.severity)).toEqual(['info']);
        expect(worstAlertByDevice([odd]).size).toBe(0);
    });

    it('groups skip empty severities', () => {
        expect(groupBySeverity([alert({})], 'en').map((group) => group.severity)).toEqual(['warn']);
    });

    it('a stored setting in an odd shape falls back to the defaults', () => {
        expect(parseNotifySetting(null).alerts_email).toBe(false);
        expect(parseNotifySetting({ data: { hour: 99, alerts_email: 'yes' } })).toMatchObject({
            hour: 9,
            alerts_email: false,
        });
        expect(parseNotifySetting({ data: [] }).hour).toBe(9);
    });
});
