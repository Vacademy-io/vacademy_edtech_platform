import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmbedTab } from './EmbedTab';

/**
 * Embed tab: the snippet carries the site tag and the picked publishable key;
 * a saved key only ever appears by its prefix, a key created here in full.
 */

const api = vi.hoisted(() => ({
    fetchCatalogKeys: vi.fn(),
    fetchWebsites: vi.fn(),
    issueCatalogKey: vi.fn(),
}));
vi.mock('@/routes/settings/-services/catalog-api', () => ({
    CATALOG_KEYS_QUERY_KEY: 'CATALOG_API_KEYS',
    CATALOG_WEBSITES_QUERY_KEY: 'CATALOG_API_WEBSITES',
    ...api,
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: (pick: (s: unknown) => unknown) =>
        pick({ instituteDetails: { learner_portal_base_url: 'learning.brahmvarchas.org' } }),
}));
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children: React.ReactNode }) => <a href="#link">{children}</a>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const key = (id: string, name: string, prefix: string, status = 'ACTIVE') => ({
    id,
    name,
    prefix,
    scopes: [],
    status,
    createdByName: null,
    createdById: null,
    createdAt: null,
    lastUsedAt: null,
    expiresAt: null,
});

const renderTab = (embedEnabled = true) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <EmbedTab siteTag="bv-main" embedEnabled={embedEnabled} />
        </QueryClientProvider>
    );
};

const snippet = () => screen.getByTestId('site-assistant-snippet').textContent ?? '';

beforeEach(() => {
    api.fetchCatalogKeys.mockReset();
    api.fetchWebsites.mockReset();
    api.issueCatalogKey.mockReset();
    api.fetchWebsites.mockResolvedValue([]);
});

describe('EmbedTab', () => {
    it('builds the snippet from a saved key by prefix only, and skips revoked keys', async () => {
        api.fetchCatalogKeys.mockResolvedValue([
            key('k0', 'Old', 'vak_pub_old0', 'REVOKED'),
            key('k1', 'Main website', 'vak_pub_ab12'),
        ]);
        renderTab();
        expect(
            await screen.findByRole('option', { name: 'Main website (vak_pub_ab12…)' })
        ).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /Old/ })).not.toBeInTheDocument();
        expect(snippet()).toBe(
            '<script src="https://learning.brahmvarchas.org/site-assistant.js" data-key="vak_pub_ab12…PASTE_YOUR_FULL_KEY" data-site="bv-main" async></script>'
        );
        expect(screen.getByText(/saved keys are never shown in full/)).toBeInTheDocument();
    });

    it('shows a key created here in full, once', async () => {
        api.fetchCatalogKeys.mockResolvedValue([]);
        api.issueCatalogKey.mockResolvedValue({
            id: 'k2',
            name: 'Next.js site',
            key: 'vak_pub_FULLSECRET123',
            prefix: 'vak_pub_FULL',
            scopes: [],
            expiresAt: null,
        });
        renderTab();
        expect(await screen.findByText(/don’t have a website key yet/)).toBeInTheDocument();
        fireEvent.change(screen.getByPlaceholderText('e.g. Main website'), {
            target: { value: 'Next.js site' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Create key/ }));
        await waitFor(() => expect(snippet()).toContain('data-key="vak_pub_FULLSECRET123"'));
        expect(api.issueCatalogKey).toHaveBeenCalledWith('inst-1', 'Next.js site');
        expect(screen.getByText(/only time the full key is shown/)).toBeInTheDocument();
    });

    it('warns when the site does not allow embedding or no website is verified', async () => {
        api.fetchCatalogKeys.mockResolvedValue([]);
        renderTab(false);
        expect(await screen.findByText('Switched off for this site')).toBeInTheDocument();
        expect(await screen.findByText(/No verified website yet/)).toBeInTheDocument();
        expect(
            screen.getByText('Settings → Integrations → Catalogue API & websites')
        ).toBeInTheDocument();
    });
});
