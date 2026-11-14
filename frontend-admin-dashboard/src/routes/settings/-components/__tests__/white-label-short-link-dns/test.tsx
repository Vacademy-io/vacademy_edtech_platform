import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Backed by the REAL en locale file, so a key this screen renders but the locale
// never defines shows up as the raw `shortLinkDns.title` string — which is
// exactly how it would look to an admin.
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

vi.mock('@/lib/clipboard', () => ({ copyTextToClipboard: vi.fn() }));

// No <Toaster> is mounted here, so the only observable half of a toast is the
// call itself.
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getSubOrgs } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { copyTextToClipboard } from '@/lib/clipboard';
import { toast } from 'sonner';
import WhiteLabelSettings from '@/routes/settings/-components/WhiteLabelSettings';

const get = authenticatedAxiosInstance.get as unknown as Mock;
const subOrgsMock = getSubOrgs as unknown as Mock;
const copyMock = copyTextToClipboard as unknown as Mock;
const toastError = toast.error as unknown as Mock;
const toastSuccess = toast.success as unknown as Mock;

/** The nginx ingress every white-label short domain has to point at. */
const INGRESS_IP = '5.223.55.238';

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

const renderWith = (entries: Record<string, unknown>[]) => {
    get.mockResolvedValue(statusResponse(entries));
    subOrgsMock.mockResolvedValue([]);
    render(<WhiteLabelSettings />);
};

describe('White-label short link DNS record', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        copyMock.mockResolvedValue(true);
    });

    it('shows the A record to hand the customer, next to the portal DNS instructions', async () => {
        renderWith([routingEntry()]);

        // The host, and all three fields a registrar's form asks for.
        await waitFor(() => expect(screen.getByText('u.enarkuplift.in')).toBeInTheDocument());
        expect(screen.getByText('Short Link Domain')).toBeInTheDocument();
        expect(screen.getByText('A')).toBeInTheDocument();
        expect(screen.getByText(INGRESS_IP)).toBeInTheDocument();
        // Type / Name / Value labels resolve from the locale, not as raw keys.
        expect(screen.getAllByText('Type').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Value').length).toBeGreaterThan(0);
    });

    it('emits one record per domain, not one per portal role', async () => {
        // Learner, admin and teacher on the same customer domain is still a
        // single DNS record — three would just confuse whoever receives it.
        renderWith([
            routingEntry({ id: 'r1', role: 'LEARNER', subdomain: 'learn' }),
            routingEntry({ id: 'r2', role: 'ADMIN', subdomain: 'admin' }),
            routingEntry({ id: 'r3', role: 'TEACHER', subdomain: 'teacher' }),
        ]);

        await waitFor(() => expect(screen.getByText('u.enarkuplift.in')).toBeInTheDocument());
        expect(screen.getAllByText(INGRESS_IP)).toHaveLength(1);
    });

    it('asks for nothing when the portal is on a platform subdomain', async () => {
        // *.vacademy.io short links already run on u.vacademy.io, which we own;
        // telling a customer to add a record in our zone would be nonsense.
        renderWith([routingEntry({ domain: 'vacademy.io', subdomain: 'my-school' })]);

        await waitFor(() => expect(get).toHaveBeenCalled());
        expect(screen.queryByText('Short Link Domain')).toBeNull();
        expect(screen.queryByText(INGRESS_IP)).toBeNull();
    });

    it('recovers the real root of an apex domain the backend split badly', async () => {
        // WhiteLabelService.splitDomain cuts on the FIRST dot, so an apex host
        // entered as `aanandham.uk` is stored as domain `uk` / subdomain
        // `aanandham`. Reading entry.domain straight would ask for `u.uk`.
        renderWith([routingEntry({ domain: 'uk', subdomain: 'aanandham' })]);

        await waitFor(() => expect(screen.getByText('u.aanandham.uk')).toBeInTheDocument());
        expect(screen.queryByText('u.uk')).toBeNull();
    });

    it('keeps both labels of a two-part public suffix', async () => {
        // Trimming to the last two labels would name `co.in` — a domain the
        // customer very much does not own.
        renderWith([routingEntry({ domain: 'myschool.co.in', subdomain: 'learn' })]);

        await waitFor(() => expect(screen.getByText('u.myschool.co.in')).toBeInTheDocument());
        expect(screen.queryByText('u.co.in')).toBeNull();
    });

    it('copies a block the admin can paste straight into an email', async () => {
        renderWith([routingEntry()]);
        await waitFor(() => expect(screen.getByText('u.enarkuplift.in')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /copy record/i }));

        await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
        expect(copyMock).toHaveBeenCalledTimes(1);
        const copied = copyMock.mock.calls[0]![0] as string;
        expect(copied).toContain('Type: A');
        expect(copied).toContain('Name: u');
        expect(copied).toContain(`Value: ${INGRESS_IP}`);
        expect(copied).toContain('https://u.enarkuplift.in');
    });

    it('says the copy failed rather than sending the admin off with an empty clipboard', async () => {
        copyMock.mockResolvedValue(false);
        renderWith([routingEntry()]);
        await waitFor(() => expect(screen.getByText('u.enarkuplift.in')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /copy record/i }));

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(toastSuccess).not.toHaveBeenCalled();
        expect(String(toastError.mock.calls[0]![0])).toMatch(/could not copy/i);
    });
});
