import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Backed by the REAL en locale, so a key the card renders but the locale never
// defines shows up as the raw key path and fails the copy assertions.
vi.mock('react-i18next', async () => {
    const en = (await import('../../../../../../public/locales/en/settingsIntegration.json'))
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

vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenFromCookie: () => 'token',
    getTokenDecodedData: () => ({ user: 'me-0000-0000-0000-000000000000' }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const fetchMock = vi.fn();
const issueMock = vi.fn();
const revokeMock = vi.fn();
vi.mock('@/routes/settings/-services/evaluation-api-keys', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@/routes/settings/-services/evaluation-api-keys')>();
    return {
        ...actual,
        fetchEvaluationApiKeys: (...a: unknown[]) => fetchMock(...a),
        issueEvaluationApiKey: (...a: unknown[]) => issueMock(...a),
        revokeEvaluationApiKey: (...a: unknown[]) => revokeMock(...a),
    };
});

import { EvaluationApiKeysCard } from '@/routes/settings/-components/EvaluationApiKeysCard';

const renderCard = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <EvaluationApiKeysCard />
        </QueryClientProvider>
    );
};

const activeKey = {
    id: 'k1',
    name: 'School ERP',
    prefix: 'vak_eval_1a2b3c4',
    scopes: ['evaluation:read', 'evaluation:write'],
    status: 'ACTIVE',
    createdByName: 'Asha Admin',
    createdById: 'u-1',
    createdAt: '2026-09-30T10:00:00Z',
    lastUsedAt: null,
    expiresAt: null,
    dailyCopyCap: null,
};

describe('EvaluationApiKeysCard', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        issueMock.mockReset();
        revokeMock.mockReset();
    });

    it('is disabled with the contact message when the product is not enabled', async () => {
        fetchMock.mockRejectedValue({
            response: { status: 403, data: { code: 'product_not_enabled' } },
        });
        renderCard();
        expect(
            await screen.findByText('Contact Vacademy to enable the Evaluation API')
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Create key/ })).not.toBeInTheDocument();
    });

    it('also honours an explicit enabled=false in the list response', async () => {
        fetchMock.mockResolvedValue({ enabled: false, keys: [] });
        renderCard();
        expect(
            await screen.findByText('Contact Vacademy to enable the Evaluation API')
        ).toBeInTheDocument();
    });

    it('shows a generic error (not the disabled state) for other failures', async () => {
        fetchMock.mockRejectedValue({
            response: { status: 403, data: { ex: 'Only an institute admin can do this' } },
        });
        renderCard();
        expect(await screen.findByText('Only an institute admin can do this')).toBeInTheDocument();
        expect(
            screen.queryByText('Contact Vacademy to enable the Evaluation API')
        ).not.toBeInTheDocument();
    });

    it('lists keys without any secret, with a revoke action for active ones', async () => {
        fetchMock.mockResolvedValue({ enabled: true, keys: [activeKey] });
        renderCard();
        expect(await screen.findByText('School ERP')).toBeInTheDocument();
        expect(screen.getByText('vak_eval_1a2b3c4…')).toBeInTheDocument();
        expect(screen.getByText('Asha Admin')).toBeInTheDocument();
        expect(screen.getByText('Never')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    });

    it('remembers a "not enabled" refusal from the POST across remounts until Check again', async () => {
        // The list can be a bare array with no access flag (admin_core today).
        fetchMock.mockResolvedValue({ enabled: true, keys: [] });
        issueMock.mockRejectedValue({
            response: {
                status: 403,
                data: {
                    ex: 'The Evaluation API is not enabled for this institute. Contact Vacademy to enable it.',
                },
            },
        });
        const first = renderCard();
        fireEvent.click(await screen.findByRole('button', { name: /Create key/ }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByPlaceholderText('e.g. School ERP'), {
            target: { value: 'Vendor' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
        expect(
            await screen.findByText('Contact Vacademy to enable the Evaluation API')
        ).toBeInTheDocument();
        first.unmount();

        renderCard();
        expect(
            await screen.findByText('Contact Vacademy to enable the Evaluation API')
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Create key/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
        expect(await screen.findByRole('button', { name: /Create key/ })).toBeInTheDocument();
    });

    it('shows an ACTIVE key past its expiry as Expired, without Revoke or an active count', async () => {
        fetchMock.mockResolvedValue({
            enabled: true,
            keys: [
                {
                    ...activeKey,
                    createdByName: null,
                    createdById: 'me-0000-0000-0000-000000000000',
                    expiresAt: '2020-01-01T00:00:00Z',
                },
            ],
        });
        renderCard();
        expect(await screen.findByText('Expired')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
        expect(screen.getByText('Active keys: 0 of 50')).toBeInTheDocument();
        expect(screen.getByText('You')).toBeInTheDocument();
    });

    it('issues a key with read+write by default and shows it exactly once', async () => {
        fetchMock.mockResolvedValue({ enabled: true, keys: [] });
        const plaintext = `vak_eval_${'c'.repeat(48)}`;
        issueMock.mockResolvedValue({
            id: 'k9',
            name: 'Vendor',
            key: plaintext,
            prefix: plaintext.slice(0, 16),
            scopes: ['evaluation:read', 'evaluation:write'],
            expiresAt: null,
        });
        renderCard();
        expect(await screen.findByText('No API keys yet')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Create key/ }));
        const dialog = await screen.findByRole('dialog');
        const readBox = within(dialog).getByRole('checkbox', { name: /evaluation:read/ });
        const reviewBox = within(dialog).getByRole('checkbox', { name: /evaluation:review/ });
        expect(readBox).toHaveAttribute('data-state', 'checked');
        expect(reviewBox).toHaveAttribute('data-state', 'unchecked');

        // Submitting without a name is caught before any request.
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
        expect(await within(dialog).findByText('Enter a name for the key.')).toBeInTheDocument();
        expect(issueMock).not.toHaveBeenCalled();

        fireEvent.change(within(dialog).getByPlaceholderText('e.g. School ERP'), {
            target: { value: 'Vendor' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));

        await waitFor(() => expect(issueMock).toHaveBeenCalledTimes(1));
        expect(issueMock).toHaveBeenCalledWith('inst-1', {
            name: 'Vendor',
            scopes: ['evaluation:read', 'evaluation:write'],
            expiryDate: '',
            dailyCopyCap: '',
        });

        expect(await screen.findByText(plaintext)).toBeInTheDocument();
        expect(screen.getByText(/It is shown only once/)).toBeInTheDocument();

        // A stray Escape before copying warns instead of discarding the key.
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(await screen.findByText(/You have not copied this key yet/)).toBeInTheDocument();
        expect(screen.getByText(plaintext)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'I have stored the key' }));
        await waitFor(() => expect(screen.queryByText(plaintext)).not.toBeInTheDocument());
    });
});
