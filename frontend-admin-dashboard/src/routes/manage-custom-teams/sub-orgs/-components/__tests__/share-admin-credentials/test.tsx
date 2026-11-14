import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Real en locale files back `t`, so a key the UI renders but the locale never defines
// shows up as the raw key — exactly what an admin would see.
vi.mock('react-i18next', async () => {
    const dialog = (
        await import(
            '../../../../../../../public/locales/en/manageCustomTeamsShareAdminCredentialsDialog.json'
        )
    ).default as Record<string, unknown>;
    const columns = (
        await import('../../../../../../../public/locales/en/manageCustomTeamsSubOrgColumns.json')
    ).default as Record<string, unknown>;
    const bundles: Record<string, Record<string, unknown>> = {
        manageCustomTeamsShareAdminCredentialsDialog: dialog,
        manageCustomTeamsSubOrgColumns: columns,
    };
    const makeT = (ns: string) => (key: string, vars?: Record<string, unknown>) => {
        const value = key
            .split('.')
            .reduce<unknown>(
                (acc, part) =>
                    acc && typeof acc === 'object'
                        ? (acc as Record<string, unknown>)[part]
                        : undefined,
                bundles[ns]
            );
        if (typeof value !== 'string') return key;
        return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? ''));
    };
    return { useTranslation: (ns: string) => ({ t: makeT(ns) }) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/routes/manage-custom-teams/-services/custom-team-services', () => ({
    resendSubOrgAdminCredentials: vi.fn(),
}));

import { toast } from 'sonner';
import { resendSubOrgAdminCredentials } from '@/routes/manage-custom-teams/-services/custom-team-services';
import type { SubOrgListItem } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { ShareAdminCredentialsDialog } from '@/routes/manage-custom-teams/sub-orgs/-components/share-admin-credentials-dialog';
import { buildSubOrgColumns } from '@/routes/manage-custom-teams/-utils/sub-org-columns';

const resend = resendSubOrgAdminCredentials as unknown as Mock;
const toastSuccess = toast.success as unknown as Mock;
const toastError = toast.error as unknown as Mock;

const row = (overrides: Partial<SubOrgListItem> = {}): SubOrgListItem => ({
    suborg_id: 'so-1',
    name: 'Acme Skills Centre',
    admin_user_id: 'user-1',
    admin_name: 'Acme Admin',
    admin_email: 'admin@acme.example',
    invite_code: 'abc123',
    ...overrides,
});

const renderDialog = (org: SubOrgListItem | null, onOpenChange = vi.fn()) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ShareAdminCredentialsDialog org={org} onOpenChange={onOpenChange} />
        </QueryClientProvider>
    );
    return { onOpenChange };
};

describe('ShareAdminCredentialsDialog', () => {
    beforeEach(() => {
        resend.mockReset();
        toastSuccess.mockReset();
        toastError.mockReset();
    });

    it('names the recipient and their email before anything is sent', () => {
        renderDialog(row());
        expect(screen.getByText('Acme Admin')).toBeInTheDocument();
        expect(screen.getByText('admin@acme.example')).toBeInTheDocument();
        expect(resend).not.toHaveBeenCalled();
    });

    it('sends for the row, reports success and closes when the backend accepted the mail', async () => {
        resend.mockResolvedValue({ sub_org_id: 'so-1', user_id: 'user-1', sent: 1, failed: 0 });
        const { onOpenChange } = renderDialog(row());

        fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

        await waitFor(() => expect(resend).toHaveBeenCalledWith('so-1'));
        await waitFor(() =>
            expect(toastSuccess).toHaveBeenCalledWith('Login details sent to admin@acme.example')
        );
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("surfaces the backend's reason and stays open when a 200 sent nothing", async () => {
        resend.mockResolvedValue({
            sub_org_id: 'so-1',
            user_id: 'user-1',
            sent: 0,
            failed: 1,
            message: 'The institute has no portal URL configured.',
        });
        const { onOpenChange } = renderDialog(row());

        fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

        await waitFor(() =>
            expect(toastError).toHaveBeenCalledWith('The institute has no portal URL configured.')
        );
        expect(toastSuccess).not.toHaveBeenCalled();
        expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it('reports a failed request with the server message', async () => {
        resend.mockRejectedValue({ response: { data: { message: 'Access denied' } } });
        renderDialog(row());

        fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

        await waitFor(() => expect(toastError).toHaveBeenCalledWith('Access denied'));
    });
});

describe('sub-org row actions', () => {
    const t = (key: string) => key;
    const build = () =>
        buildSubOrgColumns({
            t: t as never,
            inviteTerm: 'Invite',
            buildInviteUrl: () => 'https://x/invite',
            copyInviteLink: vi.fn(),
            openSubOrg: vi.fn(),
            shareCredentials: vi.fn(),
        });

    it('offers Share credentials only for rows that have an admin to send to', async () => {
        const actions = build().find((c) => c.id === 'actions')!;

        render(<>{actions.cell(row())}</>);
        fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
        expect(await screen.findByText('actions.shareCredentials')).toBeInTheDocument();
    });

    it('leaves Share credentials out when the caller lacks the permission (no callback)', async () => {
        const actions = buildSubOrgColumns({
            t: t as never,
            inviteTerm: 'Invite',
            buildInviteUrl: () => 'https://x/invite',
            copyInviteLink: vi.fn(),
            openSubOrg: vi.fn(),
        }).find((c) => c.id === 'actions')!;

        render(<>{actions.cell(row())}</>);
        fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
        expect(await screen.findByText('actions.openDetails')).toBeInTheDocument();
        expect(screen.queryByText('actions.shareCredentials')).not.toBeInTheDocument();
    });

    it('still offers Share credentials when only the older admin fields are present', async () => {
        const actions = build().find((c) => c.id === 'actions')!;

        render(<>{actions.cell(row({ admin_user_id: undefined }))}</>);
        fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
        expect(await screen.findByText('actions.shareCredentials')).toBeInTheDocument();
    });

    it('hides Share credentials when the row has no admin', async () => {
        const actions = build().find((c) => c.id === 'actions')!;

        render(
            <>{actions.cell(row({ admin_user_id: null, admin_name: null, admin_email: null }))}</>
        );
        fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
        expect(await screen.findByText('actions.openDetails')).toBeInTheDocument();
        expect(screen.queryByText('actions.shareCredentials')).not.toBeInTheDocument();
    });
});
