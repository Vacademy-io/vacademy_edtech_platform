import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Backed by the REAL en locale file, so a key this card renders but the locale never
// defines shows up as the raw `googleSignIn.x` string, exactly as an admin would see it.
vi.mock('react-i18next', async () => {
    const en = (await import('../../../../../../public/locales/en/settingsWhiteLabel.json'))
        .default as Record<string, unknown>;

    const translate = (key: string, vars?: Record<string, unknown>) => {
        const value = key
            .split('.')
            .reduce<unknown>(
                (acc, part) =>
                    acc && typeof acc === 'object'
                        ? (acc as Record<string, unknown>)[part]
                        : undefined,
                en
            );
        if (typeof value !== 'string') return key;
        return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? ''));
    };

    return { useTranslation: () => ({ t: translate }) };
});

vi.mock('@/constants/helper', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/constants/helper')>();
    return { ...actual, getInstituteId: () => 'inst-1' };
});

vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/clipboard', () => ({ copyTextToClipboard: vi.fn() }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { copyTextToClipboard } from '@/lib/clipboard';
import { toast } from 'sonner';
import GoogleSignInBrandingCard from '@/routes/settings/-components/GoogleSignInBrandingCard';

const get = authenticatedAxiosInstance.get as unknown as Mock;
const put = authenticatedAxiosInstance.put as unknown as Mock;
const del = authenticatedAxiosInstance.delete as unknown as Mock;
const copyMock = copyTextToClipboard as unknown as Mock;
const toastSuccess = toast.success as unknown as Mock;
const toastError = toast.error as unknown as Mock;

const URL = expect.stringContaining('/auth-service/v1/institutes/inst-1/oauth-clients/google');
const CALLBACK = 'https://backend-stage.vacademy.io/login/oauth2/code/google';
const CLIENT_ID = '581140538323-brand.apps.googleusercontent.com';

const response = (overrides: Record<string, unknown> = {}) => ({
    institute_id: 'inst-1',
    provider: 'google',
    configured: false,
    client_id: null,
    enabled: false,
    has_secret: false,
    redirect_uri: CALLBACK,
    updated_by: null,
    updated_at: null,
    ...overrides,
});

const configured = response({
    configured: true,
    client_id: CLIENT_ID,
    enabled: true,
    has_secret: true,
    updated_at: '2026-09-29T10:00:00Z',
});

const renderCard = () =>
    render(<GoogleSignInBrandingCard learnerPortalUrl="learn.stemxindia.com" />);

const clientIdInput = () => document.getElementById('google-sign-in-client-id') as HTMLInputElement;
const secretInput = () =>
    document.getElementById('google-sign-in-client-secret') as HTMLInputElement;

describe('GoogleSignInBrandingCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows the callback to whitelist and saves a new client with its secret', async () => {
        get.mockResolvedValue({ data: response() });
        put.mockResolvedValue({ data: configured });
        renderCard();

        expect(await screen.findByText('Not set up')).toBeTruthy();
        expect(screen.getByText(CALLBACK)).toBeTruthy();

        fireEvent.change(clientIdInput(), { target: { value: ` ${CLIENT_ID} ` } });
        fireEvent.change(secretInput(), { target: { value: 'GOCSPX-brand' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
        expect(put).toHaveBeenCalledWith(URL, {
            client_id: CLIENT_ID,
            client_secret: 'GOCSPX-brand',
            enabled: true,
        });
        await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
        expect(await screen.findByText('Active')).toBeTruthy();
        // The secret is write-only: the field is cleared, and nothing echoes it back.
        expect(secretInput().value).toBe('');
        expect(screen.queryByDisplayValue('GOCSPX-brand')).toBeNull();
    });

    it('refuses a non-Google client id and a missing first secret without calling the API', async () => {
        get.mockResolvedValue({ data: response() });
        renderCard();
        await screen.findByText('Not set up');

        fireEvent.change(clientIdInput(), { target: { value: 'not-a-google-id' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(
            await screen.findByText('A Google client ID ends with .apps.googleusercontent.com')
        ).toBeTruthy();

        fireEvent.change(clientIdInput(), { target: { value: CLIENT_ID } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(
            await screen.findByText('Enter the Client secret from your Google OAuth client')
        ).toBeTruthy();
        expect(put).not.toHaveBeenCalled();
    });

    it('keeps the stored secret when the field is left blank on update', async () => {
        get.mockResolvedValue({ data: configured });
        put.mockResolvedValue({ data: { ...configured, enabled: false } });
        renderCard();

        expect(await screen.findByText('Active')).toBeTruthy();
        expect(clientIdInput().value).toBe(CLIENT_ID);
        expect(secretInput().placeholder).toBe('Saved. Leave blank to keep the current secret');

        fireEvent.click(screen.getByRole('switch'));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(put).toHaveBeenCalledWith(URL, {
                client_id: CLIENT_ID,
                client_secret: undefined,
                enabled: false,
            })
        );
        expect(await screen.findByText('Paused')).toBeTruthy();
    });

    it('removes the client only after confirming', async () => {
        get.mockResolvedValue({ data: configured });
        del.mockResolvedValue({ data: { deleted: true } });
        renderCard();
        await screen.findByText('Active');

        fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
        expect(await screen.findByText('Remove your Google client?')).toBeTruthy();
        expect(del).not.toHaveBeenCalled();

        const buttons = screen.getAllByRole('button', { name: /Remove/ });
        fireEvent.click(buttons[buttons.length - 1]!);

        await waitFor(() => expect(del).toHaveBeenCalledWith(URL));
        expect(await screen.findByText('Not set up')).toBeTruthy();
        expect(clientIdInput().value).toBe('');
    });

    it('shows the server message when the admin is not allowed', async () => {
        get.mockRejectedValue({
            response: {
                data: {
                    message: 'Only an admin of this institute can manage its sign-in settings',
                },
            },
        });
        renderCard();

        expect(
            await screen.findByText(
                'Only an admin of this institute can manage its sign-in settings'
            )
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('copies the callback URL', async () => {
        get.mockResolvedValue({ data: response() });
        copyMock.mockResolvedValue(true);
        renderCard();
        await screen.findByText('Not set up');

        fireEvent.click(screen.getByRole('button', { name: /Copy/ }));

        await waitFor(() => expect(copyMock).toHaveBeenCalledWith(CALLBACK));
        expect(toastError).not.toHaveBeenCalled();
    });

    it('renders every guide step with real text and the institute privacy URL', async () => {
        get.mockResolvedValue({ data: response() });
        renderCard();
        await screen.findByText('Not set up');

        fireEvent.click(screen.getByRole('button', { name: 'Step-by-step setup guide' }));

        const steps = await screen.findAllByRole('listitem');
        expect(steps).toHaveLength(11);
        const text = steps.map((s) => s.textContent ?? '').join('\n');
        expect(text).not.toMatch(/googleSignIn\./);
        expect(text).toContain('https://learn.stemxindia.com/privacy-policy');
        expect(text).toContain(CALLBACK);
        expect(text).toContain('developer@vidyayatan.com');
        expect(screen.getByRole('link', { name: /PDF guide/ }).getAttribute('href')).toMatch(
            /^https:\/\/d1om4dxj9e7kkd\.cloudfront\.net\/guides\/google-sign-in-branding-guide-[\d-]+\.pdf$/
        );
    });
});
