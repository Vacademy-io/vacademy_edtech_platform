import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// The `t` here is backed by the REAL en locale file, so a key this screen renders
// but the locale never defines shows up as the raw `subOrg.label` string — which
// is exactly how it would look to an admin, and what an assertion on English copy
// catches.
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

// The page imports signup-services (logo upload), which imports '@/i18n'; its real init
// needs the real react-i18next, which the mock above replaces.
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key, language: 'en' } }));

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

vi.mock('@/routes/manage-custom-teams/-services/custom-team-services', () => ({
    getSubOrgs: vi.fn(),
}));

import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getSubOrgs } from '@/routes/manage-custom-teams/-services/custom-team-services';
import WhiteLabelSettings from '@/routes/settings/-components/WhiteLabelSettings';

const get = authenticatedAxiosInstance.get as unknown as Mock;
const subOrgsMock = getSubOrgs as unknown as Mock;

/** One routing row, with only the fields a case cares about. */
const routingEntry = (overrides: Record<string, unknown> = {}) => ({
    id: 'row-1',
    role: 'LEARNER',
    domain: 'enarkuplift.in',
    subdomain: 'edvancett',
    pages_status: 'active',
    is_primary: true,
    is_portal_url: true,
    sub_org_id: null,
    ...overrides,
});

const statusResponse = (entries: Record<string, unknown>[]) => ({
    data: {
        cloudflare_enabled: true,
        is_configured: true,
        domain_type: 'CUSTOM',
        learner_portal_url: 'https://edvancett.enarkuplift.in',
        admin_portal_url: null,
        teacher_portal_url: null,
        roles_adopted_now: [],
        routing_entries: entries,
    },
});

describe('White-label sub-organization linkage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders a sub-organization picker for every domain when the institute has sub-orgs', async () => {
        get.mockResolvedValue(statusResponse([routingEntry({ sub_org_id: 'sub-edvance' })]));
        subOrgsMock.mockResolvedValue([
            { suborgId: 'sub-edvance', name: 'Edvance' },
            { suborgId: 'sub-vke', name: 'Victorious Kidss' },
        ]);

        render(<WhiteLabelSettings />);

        // The label proves both that the picker rendered and that the locale key
        // resolves — a missing key would surface here as the literal 'subOrg.label'.
        await waitFor(() =>
            expect(screen.getAllByText('Sub-organization').length).toBeGreaterThan(0)
        );
    });

    it('shows the linked sub-org as the selected value, not a raw uuid', async () => {
        get.mockResolvedValue(statusResponse([routingEntry({ sub_org_id: 'sub-edvance' })]));
        subOrgsMock.mockResolvedValue([
            { suborgId: 'sub-edvance', name: 'Edvance' },
            { suborgId: 'sub-vke', name: 'Victorious Kidss' },
        ]);

        render(<WhiteLabelSettings />);

        await waitFor(() => expect(screen.getAllByText('Edvance').length).toBeGreaterThan(0));
        // The uuid must never be what an admin reads.
        expect(screen.queryByText('sub-edvance')).toBeNull();
    });

    it('reads an unlinked domain as the parent institute', async () => {
        get.mockResolvedValue(statusResponse([routingEntry({ sub_org_id: null })]));
        subOrgsMock.mockResolvedValue([{ suborgId: 'sub-edvance', name: 'Edvance' }]);

        render(<WhiteLabelSettings />);

        await waitFor(() =>
            expect(screen.getAllByText('Parent institute').length).toBeGreaterThan(0)
        );
    });

    it('does not render the picker at all for an institute with no sub-orgs', async () => {
        // The overwhelming majority of institutes. Their setup row must look exactly
        // as it did before this feature existed.
        get.mockResolvedValue(statusResponse([routingEntry()]));
        subOrgsMock.mockResolvedValue([]);

        render(<WhiteLabelSettings />);

        await waitFor(() => expect(get).toHaveBeenCalled());
        expect(screen.queryByText('Sub-organization')).toBeNull();
        expect(screen.queryByText('Parent institute')).toBeNull();
    });

    it('survives a sub-org lookup failure rather than blocking white-label setup', async () => {
        get.mockResolvedValue(statusResponse([routingEntry()]));
        subOrgsMock.mockRejectedValue(new Error('403'));

        render(<WhiteLabelSettings />);

        // The page still renders its domain field; only the picker is absent.
        await waitFor(() => expect(screen.getAllByText('Domain').length).toBeGreaterThan(0));
        expect(screen.queryByText('Sub-organization')).toBeNull();
    });

    it('badges the configured-domains list with the sub-org name', async () => {
        get.mockResolvedValue(statusResponse([routingEntry({ sub_org_id: 'sub-vke' })]));
        subOrgsMock.mockResolvedValue([{ suborgId: 'sub-vke', name: 'Victorious Kidss' }]);

        render(<WhiteLabelSettings />);

        await waitFor(() =>
            expect(screen.getAllByText('Victorious Kidss').length).toBeGreaterThan(0)
        );
    });

    it('distinguishes the chosen host from the one actually in use', async () => {
        // A pending primary is the state an admin cannot otherwise explain: they
        // picked it, but outbound links still use the old host.
        get.mockResolvedValue(
            statusResponse([
                routingEntry({
                    id: 'row-pending',
                    subdomain: 'chosen',
                    pages_status: 'pending',
                    is_primary: true,
                    is_portal_url: false,
                }),
            ])
        );
        subOrgsMock.mockResolvedValue([]);

        render(<WhiteLabelSettings />);

        await waitFor(() =>
            expect(screen.getAllByText('Primary · pending').length).toBeGreaterThan(0)
        );
        expect(screen.queryByText('Portal URL')).toBeNull();
    });
});
