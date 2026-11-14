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
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const fetchKeysMock = vi.fn();
const issueKeyMock = vi.fn();
const fetchWebsitesMock = vi.fn();
const addWebsiteMock = vi.fn();
const verifyWebsiteMock = vi.fn();
const removeWebsiteMock = vi.fn();
const fetchSettingsMock = vi.fn();
const saveUrlMock = vi.fn();
const resetUrlMock = vi.fn();
const revokeMock = vi.fn();

vi.mock('@/routes/settings/-services/catalog-api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/routes/settings/-services/catalog-api')>();
    return {
        ...actual,
        fetchCatalogKeys: (...a: unknown[]) => fetchKeysMock(...a),
        issueCatalogKey: (...a: unknown[]) => issueKeyMock(...a),
        fetchWebsites: (...a: unknown[]) => fetchWebsitesMock(...a),
        addWebsite: (...a: unknown[]) => addWebsiteMock(...a),
        verifyWebsite: (...a: unknown[]) => verifyWebsiteMock(...a),
        removeWebsite: (...a: unknown[]) => removeWebsiteMock(...a),
        fetchCatalogSettings: (...a: unknown[]) => fetchSettingsMock(...a),
        saveCourseBaseUrl: (...a: unknown[]) => saveUrlMock(...a),
        resetCourseBaseUrl: (...a: unknown[]) => resetUrlMock(...a),
    };
});
vi.mock('@/routes/settings/-services/evaluation-api-keys', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@/routes/settings/-services/evaluation-api-keys')>();
    return { ...actual, revokeEvaluationApiKey: (...a: unknown[]) => revokeMock(...a) };
});

import { CatalogApiCard } from '@/routes/settings/-components/catalog-api/CatalogApiCard';

const renderCard = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <CatalogApiCard />
        </QueryClientProvider>
    );
};

const pendingSite = {
    id: 'w1',
    host: 'learning.school.org',
    status: 'PENDING' as const,
    dnsRecord: {
        type: 'TXT',
        name: '_vacademy-verification.learning.school.org',
        value: 'vacademy-site-verification=abc123',
    },
    verifiedAt: null,
    lastCheckedAt: null,
    lastError: null,
    createdAt: '2026-10-15T07:00:00Z',
    revokedReason: null,
};

const autoSettings = {
    siteTag: null,
    courseBaseUrl: null,
    resolved: {
        siteTag: 'store',
        courseBaseUrl: 'https://learning.brahmvarchas.org/store',
        source: 'domain_routing',
    },
};

describe('CatalogApiCard', () => {
    beforeEach(() => {
        [
            fetchKeysMock,
            issueKeyMock,
            fetchWebsitesMock,
            addWebsiteMock,
            verifyWebsiteMock,
            removeWebsiteMock,
            fetchSettingsMock,
            saveUrlMock,
            resetUrlMock,
            revokeMock,
        ].forEach((m) => m.mockReset());
        fetchKeysMock.mockResolvedValue([]);
        fetchWebsitesMock.mockResolvedValue([]);
        fetchSettingsMock.mockResolvedValue(autoSettings);
    });

    it('shows the empty states, the docs link and the resolved course address', async () => {
        renderCard();
        expect(await screen.findByText('No websites yet')).toBeInTheDocument();
        expect(await screen.findByText(/No keys yet/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Read the API docs/ })).toHaveAttribute(
            'href',
            'https://docs.vacademy.io/catalog'
        );
        expect(
            await screen.findByText('https://learning.brahmvarchas.org/store')
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Set automatically from your course site's domain/)
        ).toBeInTheDocument();
        expect(screen.getByText(/Catalogue site: store/)).toBeInTheDocument();
        // No verified website yet → the keys section says why keys will not work.
        expect(screen.getByText(/Keys only work on verified websites/)).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Reset to automatic' })
        ).not.toBeInTheDocument();
    });

    it('adds a pasted URL as its host and then shows the TXT record to create', async () => {
        addWebsiteMock.mockResolvedValue(pendingSite);
        renderCard();
        fireEvent.click(await screen.findByRole('button', { name: /Add website/ }));
        const dialog = await screen.findByRole('dialog');
        const input = within(dialog).getByPlaceholderText('e.g. www.yourschool.com');

        fireEvent.change(input, { target: { value: 'localhost:3000' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add website' }));
        expect(await within(dialog).findByText(/localhost always works/)).toBeInTheDocument();
        expect(addWebsiteMock).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: 'https://Learning.School.org/store' } });
        expect(within(dialog).getByText('We will add: learning.school.org')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add website' }));

        await waitFor(() =>
            expect(addWebsiteMock).toHaveBeenCalledWith(
                'inst-1',
                'https://Learning.School.org/store'
            )
        );
        const dns = await screen.findByRole('dialog', { name: /Verify learning.school.org/ });
        expect(
            within(dns).getByText('_vacademy-verification.learning.school.org')
        ).toBeInTheDocument();
        expect(within(dns).getByText('vacademy-site-verification=abc123')).toBeInTheDocument();
        expect(within(dns).getByText(/DNS changes can take up to an hour/)).toBeInTheDocument();
    });

    it('verifies a pending website and removes one after confirming', async () => {
        fetchWebsitesMock.mockResolvedValue([pendingSite]);
        verifyWebsiteMock.mockResolvedValue({
            ...pendingSite,
            status: 'VERIFIED',
            verifiedAt: '2026-10-15T09:00:00Z',
        });
        removeWebsiteMock.mockResolvedValue(undefined);
        renderCard();

        expect(await screen.findByText('Pending')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Verify now' }));
        await waitFor(() => expect(verifyWebsiteMock).toHaveBeenCalledWith('inst-1', 'w1'));
        expect(await screen.findByText('Verified')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Verify now' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        const confirm = await screen.findByRole('alertdialog');
        expect(within(confirm).getByText('Remove learning.school.org?')).toBeInTheDocument();
        fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
        await waitFor(() => expect(removeWebsiteMock).toHaveBeenCalledWith('inst-1', 'w1'));
    });

    it('shows a revoked website as blocked, with no verify or remove', async () => {
        fetchWebsitesMock.mockResolvedValue([
            { ...pendingSite, status: 'REVOKED', revokedReason: 'Phishing report' },
        ]);
        renderCard();
        expect(
            await screen.findByText(/Blocked by Vacademy — contact support/)
        ).toBeInTheDocument();
        expect(screen.getByText('Reason: Phishing report')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Verify now' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });

    it('issues a publishable key and shows it once with the safe-to-use note', async () => {
        const plaintext = `vak_pub_${'d'.repeat(40)}`;
        issueKeyMock.mockResolvedValue({
            id: 'k1',
            name: 'School website',
            key: plaintext,
            prefix: plaintext.slice(0, 12),
            scopes: ['catalog:read', 'leads:write'],
            expiresAt: null,
        });
        renderCard();
        fireEvent.click(await screen.findByRole('button', { name: /Create key/ }));
        const dialog = await screen.findByRole('dialog');

        fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
        expect(await within(dialog).findByText('Enter a name for the key.')).toBeInTheDocument();
        expect(issueKeyMock).not.toHaveBeenCalled();

        fireEvent.change(within(dialog).getByPlaceholderText('e.g. School website'), {
            target: { value: 'School website' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
        await waitFor(() => expect(issueKeyMock).toHaveBeenCalledWith('inst-1', 'School website'));

        expect(await screen.findByText(plaintext)).toBeInTheDocument();
        expect(screen.getByText(/Safe to use in your website's code/)).toBeInTheDocument();

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(await screen.findByText(/You have not copied this key yet/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'I have copied the key' }));
        await waitFor(() => expect(screen.queryByText(plaintext)).not.toBeInTheDocument());
    });

    it('lists keys and revokes one after confirming', async () => {
        fetchKeysMock.mockResolvedValue([
            {
                id: 'k1',
                name: 'School website',
                prefix: 'vak_pub_ab12',
                scopes: [],
                status: 'ACTIVE',
                createdByName: null,
                createdById: null,
                createdAt: '2026-10-01T10:00:00Z',
                lastUsedAt: null,
                expiresAt: null,
                dailyCopyCap: null,
            },
        ]);
        revokeMock.mockResolvedValue(null);
        renderCard();
        expect(await screen.findByText('vak_pub_ab12…')).toBeInTheDocument();
        expect(screen.getByText('Never')).toBeInTheDocument();
        expect(screen.getByText('Active')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
        const confirm = await screen.findByRole('alertdialog');
        fireEvent.click(within(confirm).getByRole('button', { name: 'Revoke key' }));
        await waitFor(() => expect(revokeMock).toHaveBeenCalledWith('inst-1', 'k1'));
    });

    it('saves an https override, rejects http, and resets to automatic', async () => {
        const overridden = {
            ...autoSettings,
            courseBaseUrl: 'https://courses.school.org/shop',
            resolved: {
                ...autoSettings.resolved,
                courseBaseUrl: 'https://courses.school.org/shop',
                source: 'settings',
            },
        };
        saveUrlMock.mockResolvedValue(overridden);
        resetUrlMock.mockResolvedValue(autoSettings);
        renderCard();

        const input = await screen.findByPlaceholderText('https://learning.yourschool.com/store');
        fireEvent.change(input, { target: { value: 'http://courses.school.org/shop' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
        expect(
            await screen.findByText('The address must start with https://.')
        ).toBeInTheDocument();
        expect(saveUrlMock).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: 'https://courses.school.org/shop' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
        await waitFor(() =>
            expect(saveUrlMock).toHaveBeenCalledWith('inst-1', 'https://courses.school.org/shop')
        );
        expect(await screen.findByText(/Set by you/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset to automatic' }));
        await waitFor(() => expect(resetUrlMock).toHaveBeenCalledWith('inst-1'));
        expect(
            await screen.findByText(/Set automatically from your course site's domain/)
        ).toBeInTheDocument();
    });

    it('shows the server message with a retry when a section fails to load', async () => {
        fetchWebsitesMock.mockRejectedValue({
            response: { status: 403, data: { ex: 'Only an institute admin can do this' } },
        });
        renderCard();
        expect(await screen.findAllByText('Only an institute admin can do this')).not.toHaveLength(
            0
        );
        expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
    });
});
