import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import strings from '../../../../../../../../public/locales/en/manageStudentsCommunicationTimeline.json';
import type { CommunicationItem } from '@/services/communication-timeline-service';

/**
 * Resending a WhatsApp template whose first send went out without a variable.
 *
 * A workflow node with no mapping sends `bodyParams: {}`; Meta rejects that, so
 * "resend the same" would fail again. The dialog has to offer the template's
 * variables for editing and refuse to send while any is empty.
 */
const lookup = (key: string): unknown =>
    key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            strings
        );
const translate = (key: string, opts?: Record<string, unknown>) => {
    let value = lookup(key);
    if (value === undefined && typeof opts?.count === 'number') {
        value = lookup(`${key}_${opts.count === 1 ? 'one' : 'other'}`);
    }
    // The shared preview pulls strings of its own; only this dialog's are checked.
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
};
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const resendCommunication = vi.fn();
vi.mock('@/services/communication-resend-service', () => ({
    resendCommunication: (...args: unknown[]) => resendCommunication(...args),
}));
vi.mock('@/routes/communication/whatsapp-templates/-services/template-api', () => ({
    listTemplates: async () => [
        {
            instituteId: 'inst-1',
            name: 'walk_in_confirmation',
            language: 'en',
            category: 'UTILITY',
            status: 'APPROVED',
            headerType: 'NONE',
            bodyText: 'Hi {{1}} 👋 We’ve received your details through the Walk-in Form.',
            bodyVariableNames: ['Name'],
        },
    ],
}));

import { ResendMessageDialog } from './resend-message-dialog';

const whatsappItem = (bodyParams: Record<string, string>): CommunicationItem => ({
    id: 'log-1',
    channel: 'WHATSAPP',
    direction: 'OUTBOUND',
    title: 'walk_in_confirmation',
    bodyPreview: 'Hi …',
    templateName: 'walk_in_confirmation',
    status: 'FAILED',
    statusTimeline: [],
    senderInfo: '918888888888',
    recipientInfo: '919785544401',
    timestamp: '2026-09-24T11:39:19Z',
    source: 'whatsapp-service',
    sourceId: 'walk_in_confirmation',
    metadata: { bodyParams, languageCode: 'en' },
});

const renderDialog = (item: CommunicationItem) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ResendMessageDialog
                open
                onOpenChange={() => undefined}
                item={item}
                instituteId="inst-1"
                emailSubject=""
                onSent={() => undefined}
            />
        </QueryClientProvider>
    );
};

const resend = strings.resend;
const sendButton = (label: string) => screen.getByRole('button', { name: label });

beforeEach(() => {
    resendCommunication.mockReset();
    resendCommunication.mockResolvedValue({ status: 'SUCCESS', failed: 0, results: [] });
});

describe('ResendMessageDialog — WhatsApp variables', () => {
    it('makes the admin fill in a variable the first send went out without', async () => {
        renderDialog(whatsappItem({}));

        // Once the template arrives, its {{1}} shows up as an editable, empty field.
        const input = await screen.findByPlaceholderText('Value for Name');
        expect(input).toHaveValue('');
        expect(screen.getByRole('button', { name: new RegExp(resend.modeSame) })).toBeDisabled();
        expect(screen.getByText(resend.variablesRequired)).toBeInTheDocument();
        expect(sendButton(resend.confirmEdited)).toBeDisabled();

        fireEvent.change(input, { target: { value: 'Nikunj Bindal' } });
        expect(sendButton(resend.confirmEdited)).toBeEnabled();
        fireEvent.click(sendButton(resend.confirmEdited));

        await waitFor(() => expect(resendCommunication).toHaveBeenCalledTimes(1));
        expect(resendCommunication.mock.calls[0]![0]).toEqual(
            expect.objectContaining({
                templateName: 'walk_in_confirmation',
                variables: { '1': 'Nikunj Bindal' },
                variablesChanged: true,
            })
        );
    });

    // A workflow send that stored its variable by name (`Name`, bodyVariableNames ['Name']) was
    // complete — it must still resend as-is.
    it('resends the same when the first send stored the variable by name', async () => {
        renderDialog(whatsappItem({ Name: 'Asha', email: '' }));

        await screen.findByText('Asha');
        await waitFor(() =>
            expect(screen.getByRole('button', { name: new RegExp(resend.modeSame) })).toBeEnabled()
        );
        expect(screen.queryByText(resend.variablesRequired)).not.toBeInTheDocument();
        fireEvent.click(sendButton(resend.confirmSame));

        await waitFor(() => expect(resendCommunication).toHaveBeenCalledTimes(1));
        expect(resendCommunication.mock.calls[0]![0]).toEqual(
            expect.objectContaining({ variables: { Name: 'Asha', email: '' } })
        );
    });

    it('still resends the same values when the first send had them all', async () => {
        renderDialog(whatsappItem({ 1: 'Neeju' }));

        await screen.findByText('Neeju');
        expect(screen.getByRole('button', { name: new RegExp(resend.modeSame) })).toBeEnabled();
        expect(screen.queryByText(resend.variablesRequired)).not.toBeInTheDocument();
        fireEvent.click(sendButton(resend.confirmSame));

        await waitFor(() => expect(resendCommunication).toHaveBeenCalledTimes(1));
        expect(resendCommunication.mock.calls[0]![0]).toEqual(
            expect.objectContaining({ variables: { '1': 'Neeju' }, variablesChanged: false })
        );
    });
});
