import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PanelPartnerLinkRow } from '@/classroom-shared/apiTypes';
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

import { InstallersTab } from './InstallersTab';
import { formatInviteCode, pendingSummary } from './api';

const ADMIN = 'http://api.test/auth-service/v1/panel/admin';

const reject = (status: number, code: string) =>
    Promise.reject({ response: { status, data: { code, message: 'server text' } } });

const LINK: PanelPartnerLinkRow = {
    link_id: 'link-1',
    partner_name: 'Installer One',
    linked_via: 'SCHOOL_CODE',
    install_until: '2099-01-01T00:00:00Z',
    created_at: '2026-11-01T10:00:00Z',
    installs: 3,
};

let answer: () => Promise<unknown>;

beforeEach(() => {
    vi.clearAllMocks();
    answer = () => Promise.resolve({ data: [LINK] });
    api.get.mockImplementation((url: string) => {
        if (url === `${ADMIN}/partners`) return answer();
        return Promise.reject(new Error(`unexpected GET ${url}`));
    });
});

function renderTab() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <InstallersTab instituteId="inst-a" />
        </QueryClientProvider>
    );
}

describe('Installers tab states', () => {
    it('loading: no empty state flashes while the list is on its way', () => {
        answer = () => new Promise(() => {});
        renderTab();
        expect(screen.queryByText(en.installers.empty.title)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('error: the mapped words, and retry recovers', async () => {
        answer = () => reject(403, 'FORBIDDEN');
        renderTab();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(en.installers.loadError);
        expect(alert).toHaveTextContent(en.errors.FORBIDDEN);
        expect(alert).not.toHaveTextContent('server text');
        answer = () => Promise.resolve({ data: [LINK] });
        fireEvent.click(within(alert).getByRole('button', { name: en.common.retry }));
        expect(await screen.findByText('Installer One')).toBeInTheDocument();
    });

    it('empty: explains the code, with the same invite action', async () => {
        answer = () => Promise.resolve({ data: [] });
        renderTab();
        expect(await screen.findByText(en.installers.empty.title)).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: en.installers.invite.open })).toHaveLength(2);
    });

    it('populated: name, how it was linked, end date and installs', async () => {
        renderTab();
        expect(await screen.findByText('Installer One')).toBeInTheDocument();
        expect(screen.getByText(en.installers.via.SCHOOL_CODE)).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.queryByText(en.installers.ended)).toBeNull();
    });

    it('no end date and a past end date read as such', async () => {
        answer = () =>
            Promise.resolve({
                data: [
                    { ...LINK, link_id: 'a', partner_name: 'A', install_until: null },
                    {
                        ...LINK,
                        link_id: 'b',
                        partner_name: 'B',
                        linked_via: 'SUPER_ADMIN',
                        install_until: '2020-01-01T00:00:00Z',
                    },
                ],
            });
        renderTab();
        expect(await screen.findByText(en.installers.noEnd)).toBeInTheDocument();
        expect(screen.getByText(en.installers.ended)).toBeInTheDocument();
        expect(screen.getByText(en.installers.via.SUPER_ADMIN)).toBeInTheDocument();
    });
});

describe('installer code', () => {
    async function createCode() {
        renderTab();
        await screen.findByText('Installer One');
        fireEvent.click(screen.getByRole('button', { name: en.installers.invite.open }));
        const dialog = await screen.findByRole('dialog');
        api.post.mockResolvedValueOnce({
            status: 200,
            data: { id: 'inv-1', code: 'K7QF2M9X', expires_at: '2026-11-16T10:00:00Z' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: en.installers.invite.create }));
        return dialog;
    }

    it('creates a code for 30 days by default and shows it once, with copy', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
        const dialog = await createCode();
        expect(await within(dialog).findByText('K7QF-2M9X')).toBeInTheDocument();
        expect(within(dialog).getByText(en.installers.invite.shownOnce)).toBeInTheDocument();
        expect(api.post.mock.calls[0]!.slice(0, 2)).toEqual([
            `${ADMIN}/partner-invites`,
            { institute_id: 'inst-a', install_days: 30 },
        ]);

        fireEvent.click(within(dialog).getByRole('button', { name: en.installers.invite.copy }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('K7QF-2M9X'));
        expect(toast.success).toHaveBeenCalledWith(en.installers.invite.copied);

        // Closed and opened again: the form, never the old code.
        fireEvent.click(within(dialog).getByRole('button', { name: en.common.done }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: en.installers.invite.open }));
        const again = await screen.findByRole('dialog');
        expect(within(again).queryByText('K7QF-2M9X')).toBeNull();
        expect(
            within(again).getByRole('button', { name: en.installers.invite.create })
        ).toBeInTheDocument();
    });

    it('a failed copy says to copy it by hand', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
            configurable: true,
        });
        const dialog = await createCode();
        fireEvent.click(
            await within(dialog).findByRole('button', { name: en.installers.invite.copy })
        );
        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith(en.installers.invite.copyFailed)
        );
    });

    it('cancels the code it just showed', async () => {
        const dialog = await createCode();
        await within(dialog).findByText('K7QF-2M9X');
        api.post.mockResolvedValueOnce({ status: 200, data: { status: 'CANCELLED' } });
        fireEvent.click(within(dialog).getByRole('button', { name: en.installers.invite.cancel }));
        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith(en.installers.invite.cancelled)
        );
        expect(api.post.mock.calls[1]!.slice(0, 2)).toEqual([
            `${ADMIN}/partner-invites/inv-1/cancel`,
            {},
        ]);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('a refused create stays on the form with the reason', async () => {
        renderTab();
        await screen.findByText('Installer One');
        fireEvent.click(screen.getByRole('button', { name: en.installers.invite.open }));
        const dialog = await screen.findByRole('dialog');
        api.post.mockImplementationOnce(() => reject(429, 'RATE_LIMITED'));
        fireEvent.click(within(dialog).getByRole('button', { name: en.installers.invite.create }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.errors.RATE_LIMITED);
    });
});

describe('remove an installer', () => {
    it('confirms with the name, posts the revoke and reloads the list', async () => {
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove Installer One' }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText('Remove Installer One?')).toBeInTheDocument();
        api.post.mockResolvedValueOnce({ status: 200, data: { status: 'REVOKED' } });
        answer = () => Promise.resolve({ data: [] });
        fireEvent.click(within(dialog).getByRole('button', { name: en.installers.revoke.confirm }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Installer One removed.'));
        expect(api.post.mock.calls[0]!.slice(0, 2)).toEqual([
            `${ADMIN}/partners/link-1/revoke`,
            {},
        ]);
        expect(await screen.findByText(en.installers.empty.title)).toBeInTheDocument();
    });

    it('a refused revoke stays open with the reason', async () => {
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove Installer One' }));
        const dialog = await screen.findByRole('alertdialog');
        api.post.mockImplementationOnce(() => reject(404, 'NOT_FOUND'));
        fireEvent.click(within(dialog).getByRole('button', { name: en.installers.revoke.confirm }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.errors.NOT_FOUND);
    });
});

describe('helpers', () => {
    it('formats a code like a setup code', () => {
        expect(formatInviteCode('K7QF2M9X')).toBe('K7QF-2M9X');
        expect(formatInviteCode('ABC')).toBe('ABC');
    });

    it('names a single installer in the pending summary, and none for a mix', () => {
        const row = (over: Record<string, unknown>) =>
            ({ status: 'ACTIVE', approval_state: 'PENDING', installed_by: 'X', ...over }) as never;
        expect(pendingSummary([row({}), row({})])).toEqual({ count: 2, installer: 'X' });
        expect(pendingSummary([row({}), row({ installed_by: 'Y' })])).toEqual({
            count: 2,
            installer: null,
        });
        expect(
            pendingSummary([row({ approval_state: 'APPROVED' }), row({ status: 'REVOKED' })])
        ).toEqual({ count: 0, installer: null });
    });
});
