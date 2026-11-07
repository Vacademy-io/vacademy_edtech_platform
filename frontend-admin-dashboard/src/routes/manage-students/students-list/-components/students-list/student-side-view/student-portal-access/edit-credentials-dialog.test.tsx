import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';

// Real en locale backs `t`, so the generic fallback this test asserts against is
// the exact sentence an admin sees.
vi.mock('react-i18next', async () => {
    const bundle = (
        await import(
            '../../../../../../../../public/locales/en/manageStudentsEditCredentialsDialog.json'
        )
    ).default as Record<string, unknown>;
    const t = (key: string, vars?: Record<string, unknown>) => {
        const value = key
            .split('.')
            .reduce<unknown>(
                (acc, part) =>
                    acc && typeof acc === 'object'
                        ? (acc as Record<string, unknown>)[part]
                        : undefined,
                bundle
            );
        if (typeof value !== 'string') return key;
        return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? ''));
    };
    return { useTranslation: () => ({ t }) };
});

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/services/student-list-section/updateStudentCredentials', () => ({
    updateStudentCredentials: vi.fn(),
    sendLearnerCredentials: vi.fn(),
}));

vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

import { toast } from 'sonner';
import { updateStudentCredentials } from '@/services/student-list-section/updateStudentCredentials';
import { EditCredentialsDialog } from './edit-credentials-dialog';

const update = updateStudentCredentials as unknown as Mock;
const toastError = toast.error as unknown as Mock;
const toastSuccess = toast.success as unknown as Mock;

/**
 * The platform's ErrorInfo envelope: {url, ex, responseCode, date} — no `message`.
 * Reading `message` here is what turned every backend reason into a generic toast.
 */
const errorInfo = (ex: string, status = 510) => {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config as never, {}, {
        status,
        statusText: 'NOT EXTENDED',
        headers: {},
        config: config as never,
        data: {
            url: 'https://backend-stage.vacademy.io/auth-service/v1/user-operation/update-password',
            ex,
            responseCode: `${status} NOT_EXTENDED`,
            date: '2026-09-23T14:50:43.493+00:00',
        },
    });
};

const renderDialog = () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <EditCredentialsDialog
                open
                onOpenChange={vi.fn()}
                userId="3ee17732-0faf-41bf-a714-3c248896480c"
                currentUsername="disha_old"
            />
        </QueryClientProvider>
    );
};

const renameTo = (username: string) => {
    fireEvent.change(screen.getByPlaceholderText('Enter username'), {
        target: { value: username },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
};

describe('EditCredentialsDialog error handling', () => {
    beforeEach(() => {
        update.mockReset();
        toastError.mockReset();
        toastSuccess.mockReset();
    });

    it('shows the taken-username reason on the field instead of a generic failure', async () => {
        update.mockRejectedValue(errorInfo("Username 'Disha' is already taken"));

        renderDialog();
        renameTo('Disha');

        expect(await screen.findByText("Username 'Disha' is already taken")).toBeInTheDocument();
        expect(toastError).not.toHaveBeenCalled();
    });

    it('toasts a 510 that is not about the username rather than pinning it to the field', async () => {
        update.mockRejectedValue(errorInfo('User not found with id 3ee17732'));

        renderDialog();
        renameTo('disha_new');

        await waitFor(() => expect(toastError).toHaveBeenCalledWith('User not found with id 3ee17732'));
        expect(screen.queryByText('User not found with id 3ee17732')).not.toBeInTheDocument();
    });

    it('falls back to the generic message when the failure carries no reason', async () => {
        update.mockRejectedValue(new Error('Network Error'));

        renderDialog();
        renameTo('disha_new');

        await waitFor(() =>
            expect(toastError).toHaveBeenCalledWith(
                'Failed to update credentials. Please try again.'
            )
        );
    });
});
