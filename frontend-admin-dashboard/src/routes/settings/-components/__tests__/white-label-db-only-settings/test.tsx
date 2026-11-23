import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

// Backed by the REAL en locale file, so a key the screen renders but the locale
// never defines shows up as the raw key — the way an admin would see it.
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

vi.mock('@/i18n', () => ({ default: { t: (key: string) => key, language: 'en' } }));

vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/routes/manage-pages/-services/catalogue-service', () => ({
    getCatalogueTags: vi.fn(),
}));

vi.mock('@/routes/manage-custom-teams/-services/custom-team-services', () => ({
    getSubOrgs: vi.fn().mockResolvedValue([]),
    getAllRoles: vi.fn().mockResolvedValue([]),
}));

import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCatalogueTags } from '@/routes/manage-pages/-services/catalogue-service';
import WhiteLabelSettings from '@/routes/settings/-components/WhiteLabelSettings';

// The settings panel holds cards that read React Query.
const render = (ui: ReactElement) =>
    rtlRender(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            {ui}
        </QueryClientProvider>
    );

const get = authenticatedAxiosInstance.get as unknown as Mock;
const post = authenticatedAxiosInstance.post as unknown as Mock;
const del = authenticatedAxiosInstance.delete as unknown as Mock;
const sitesMock = getCatalogueTags as unknown as Mock;

const routingEntry = (overrides: Record<string, unknown> = {}) => ({
    id: 'row-1',
    role: 'LEARNER',
    domain: 'myschool.com',
    subdomain: 'learn',
    pages_status: 'active',
    is_primary: false,
    is_portal_url: false,
    sub_org_id: null,
    apply_naming_setting: false,
    root_catalogue_tag: null,
    ...overrides,
});

const statusResponse = (entries: Record<string, unknown>[]) => ({
    data: {
        cloudflare_enabled: true,
        is_configured: true,
        domain_type: 'CUSTOM',
        learner_portal_url: 'https://portal.myschool.com',
        admin_portal_url: null,
        teacher_portal_url: null,
        roles_adopted_now: [],
        routing_entries: entries,
    },
});

type SavedEntry = {
    role: string;
    domain: string;
    routing_id?: string;
    routing_config: Record<string, unknown>;
};

const save = async (): Promise<SavedEntry[]> => {
    post.mockResolvedValue({ data: { setup_complete: true, warnings: [] } });
    fireEvent.click(document.getElementById('white-label-setup-btn') as HTMLElement);
    await waitFor(() => expect(post).toHaveBeenCalled());
    return (post.mock.calls[0]?.[1] as { entries: SavedEntry[] }).entries;
};

describe('White-label settings that used to need a database edit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sitesMock.mockResolvedValue([
            { tagName: 'new-website', status: 'ACTIVE', id: 'c1' },
            { tagName: 'spring-offer', status: 'DRAFT', id: 'c2' },
            { tagName: 'old-site', status: 'ARCHIVED', id: 'c3' },
        ]);
    });

    it('sends back the row id, the login-page naming flag and the home-page site', async () => {
        get.mockResolvedValue(
            statusResponse([
                routingEntry({ apply_naming_setting: true, root_catalogue_tag: 'new-website' }),
            ])
        );

        render(<WhiteLabelSettings />);
        await screen.findByDisplayValue('learn.myschool.com');

        const [saved] = await save();
        expect(saved?.routing_id).toBe('row-1');
        expect(saved?.routing_config.apply_naming_setting).toBe(true);
        expect(saved?.routing_config.root_catalogue_tag).toBe('new-website');
    });

    it('offers the Manage Pages sites on a learner domain, skipping archived ones', async () => {
        get.mockResolvedValue(statusResponse([routingEntry()]));

        render(<WhiteLabelSettings />);
        await screen.findByDisplayValue('learn.myschool.com');
        // Not fetched until a learner domain's settings are opened.
        expect(sitesMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getAllByTitle('Toggle settings')[0] as HTMLElement);

        await waitFor(() => expect(sitesMock).toHaveBeenCalledWith('inst-1'));
        expect(screen.getAllByText('Website on the home page (/)').length).toBeGreaterThan(0);
        expect(
            screen.getAllByText('Use custom names on login & sign-up pages').length
        ).toBeGreaterThan(0);
    });

    it('does not offer a home-page site on an admin domain', async () => {
        get.mockResolvedValue(statusResponse([routingEntry({ role: 'ADMIN', subdomain: 'admin' })]));

        render(<WhiteLabelSettings />);
        await screen.findByDisplayValue('admin.myschool.com');
        fireEvent.click(screen.getAllByTitle('Toggle settings')[0] as HTMLElement);

        expect(screen.queryByText('Website on the home page (/)')).toBeNull();
        expect(sitesMock).not.toHaveBeenCalled();
    });

    it('removes a domain after confirmation and drops it from the setup form', async () => {
        // Status reads return whatever is stored; the delete takes row-2 out.
        let rows = [routingEntry(), routingEntry({ id: 'row-2', subdomain: 'old' })];
        get.mockImplementation(async () => statusResponse(rows));
        del.mockImplementation(async () => {
            rows = [routingEntry()];
            return {};
        });

        render(<WhiteLabelSettings />);
        await screen.findByDisplayValue('old.myschool.com');

        const removeButtons = screen.getAllByLabelText('Remove this domain');
        fireEvent.click(removeButtons[1] as HTMLElement);
        fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

        await waitFor(() =>
            expect(del).toHaveBeenCalledWith(expect.stringMatching(/white-label\/v1\/domain$/), {
                params: { instituteId: 'inst-1', routingId: 'row-2' },
            })
        );
        await waitFor(() => expect(screen.queryByDisplayValue('old.myschool.com')).toBeNull());
    });

    it('will not remove the domain outbound links use', async () => {
        get.mockResolvedValue(statusResponse([routingEntry({ is_portal_url: true, is_primary: true })]));

        render(<WhiteLabelSettings />);
        await screen.findByDisplayValue('learn.myschool.com');

        expect(screen.getByLabelText('Remove this domain')).toBeDisabled();
    });
});
