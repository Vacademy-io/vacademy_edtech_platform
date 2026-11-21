import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

vi.mock('@/routes/manage-custom-teams/-services/custom-team-services', () => ({
    getSubOrgs: vi.fn().mockResolvedValue([]),
    getAllRoles: vi.fn(),
}));

import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getAllRoles } from '@/routes/manage-custom-teams/-services/custom-team-services';
import WhiteLabelSettings from '@/routes/settings/-components/WhiteLabelSettings';

const get = authenticatedAxiosInstance.get as unknown as Mock;
const post = authenticatedAxiosInstance.post as unknown as Mock;
const rolesMock = getAllRoles as unknown as Mock;

const routingEntry = (overrides: Record<string, unknown> = {}) => ({
    id: 'row-1',
    role: 'ADMIN',
    domain: 'myschool.com',
    subdomain: 'admin',
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
        learner_portal_url: null,
        admin_portal_url: 'https://admin.myschool.com',
        teacher_portal_url: null,
        roles_adopted_now: [],
        routing_entries: entries,
    },
});

/** Clicks Apply/Update and returns the role strings the setup API received. */
const savedRoles = async (): Promise<string[]> => {
    post.mockResolvedValue({ data: { setup_complete: true, warnings: [] } });
    fireEvent.click(document.getElementById('white-label-setup-btn') as HTMLElement);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const payload = post.mock.calls[0]?.[1] as { entries: { role: string }[] };
    return payload.entries.map((e) => e.role);
};

describe('White-label: roles allowed to sign in', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        rolesMock.mockResolvedValue([
            { id: 'r1', name: 'ADMIN' },
            { id: 'r2', name: 'TEACHER' },
            { id: 'r3', name: 'COUNSELLOR' },
            { id: 'r4', name: 'STUDENT' },
            { id: 'r5', name: 'Operations' },
        ]);
    });

    it('offers the picker on an admin domain', async () => {
        get.mockResolvedValue(statusResponse([routingEntry()]));

        render(<WhiteLabelSettings />);

        await screen.findByDisplayValue('admin.myschool.com');
        expect(screen.getAllByText('Who can sign in')).toHaveLength(1);
        expect(screen.getAllByText('Only admins')).toHaveLength(1);
    });

    it('does not offer it on a learner domain', async () => {
        get.mockResolvedValue(
            statusResponse([routingEntry({ role: 'LEARNER', subdomain: 'learn' })])
        );

        render(<WhiteLabelSettings />);

        // The blank default form has an admin row; wait for the saved learner row.
        await screen.findByDisplayValue('learn.myschool.com');
        expect(screen.queryByText('Who can sign in')).toBeNull();
    });

    it('keeps the roles saved on a domain, including names with a space, when re-saved', async () => {
        // The shape DB-edited rows have today: unsorted, with seeded role names
        // that carry a space.
        get.mockResolvedValue(
            statusResponse([routingEntry({ role: 'ADMIN,EVALUATOR,COURSE CREATOR,COUNSELLOR' })])
        );

        render(<WhiteLabelSettings />);

        await screen.findByDisplayValue('admin.myschool.com');
        expect(await savedRoles()).toEqual(['ADMIN,EVALUATOR,COURSE CREATOR,COUNSELLOR']);
    });

    it('lists the extra roles next to the domain in the configured list', async () => {
        get.mockResolvedValue(statusResponse([routingEntry({ role: 'ADMIN,COUNSELLOR,TEACHER' })]));

        render(<WhiteLabelSettings />);

        await waitFor(() =>
            expect(screen.getAllByText('+ COUNSELLOR, TEACHER').length).toBeGreaterThan(0)
        );
        // The portal badge reads as the portal, not the raw role string.
        expect(screen.getAllByText('Admin Portal').length).toBeGreaterThan(0);
    });

    it('saves a row that names only custom roles back unchanged', async () => {
        // e.g. a row stored as "ADMIN OPS". Adding ADMIN on a plain save would
        // make it a candidate admin portal URL and change how the host resolves.
        get.mockResolvedValue(
            statusResponse([routingEntry({ role: 'ADMIN OPS', subdomain: 'ops' })])
        );

        render(<WhiteLabelSettings />);

        await screen.findByDisplayValue('ops.myschool.com');
        expect(await savedRoles()).toEqual(['ADMIN OPS']);
    });

    it('restores a draft saved by the previous form version as the admin domain it was', async () => {
        // The old form kept the whole stored role string in its draft.
        sessionStorage.setItem(
            'vacademy:white-label-draft:inst-1',
            JSON.stringify([
                { role: 'ADMIN,EVALUATOR', domain: 'admin.myschool.com', isPrimary: true, config: {} },
            ])
        );
        get.mockResolvedValue(statusResponse([routingEntry({ role: 'ADMIN,EVALUATOR' })]));

        render(<WhiteLabelSettings />);

        await screen.findByDisplayValue('admin.myschool.com');
        expect(await savedRoles()).toEqual(['ADMIN,EVALUATOR']);
        sessionStorage.clear();
    });

    it('saves a ticked role, using the stored (upper-case) name of a custom role', async () => {
        get.mockResolvedValue(statusResponse([routingEntry()]));

        render(<WhiteLabelSettings />);

        // Students and ADMIN are never offered: one can't open a staff portal,
        // the other always can.
        // Wait for the saved domain to replace the blank default rows, or the
        // click lands on a row that is about to be swapped out.
        await screen.findByDisplayValue('admin.myschool.com');
        fireEvent.click(screen.getByText('Only admins').closest('button') as HTMLElement);
        await screen.findByText('Operations');
        expect(screen.queryByText('STUDENT')).toBeNull();
        expect(screen.queryAllByRole('option', { name: /^ADMIN$/ })).toHaveLength(0);

        fireEvent.click(screen.getByText('Operations'));
        expect(await savedRoles()).toEqual(['ADMIN,OPERATIONS']);
    });
});
