import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `t` is backed by the REAL en catalog, so a key the dialog renders but the locale never defines
// shows up as the raw key — exactly what an admin would see, and what these assertions catch.
vi.mock('react-i18next', async () => {
    const en = (await import('../../../../../public/locales/en/communicationReplyBox.json'))
        .default as Record<string, unknown>;

    const translate = (key: string, vars?: Record<string, unknown>) => {
        // i18next plural suffixing: `missingValues` + count → `missingValues_one|_other`.
        const count = typeof vars?.count === 'number' ? (vars.count as number) : undefined;
        const candidates =
            count === undefined ? [key] : [`${key}_${count === 1 ? 'one' : 'other'}`, key];
        for (const candidate of candidates) {
            const value = candidate
                .split('.')
                .reduce<unknown>(
                    (acc, part) =>
                        acc && typeof acc === 'object'
                            ? (acc as Record<string, unknown>)[part]
                            : undefined,
                    en
                );
            if (typeof value === 'string') {
                return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? ''));
            }
        }
        return key;
    };

    return { useTranslation: () => ({ t: translate }) };
});

import { TemplateSendDialog, templateVariables } from './template-send-dialog';
import type { WhatsAppTemplateDTO } from '@/routes/communication/whatsapp-templates/-services/template-api';

const brochure =
    'https://cdn.example.com/ADMIN_PUBLIC_UPLOAD/63a5262b-f5e4-4de6-990e-d3296ca5012b-HCCA_Updated_Brochure_1.pdf';

const base: WhatsAppTemplateDTO = {
    instituteId: 'inst-1',
    name: 'missed_on_reply_messages__interested_candidates',
    language: 'en',
    category: 'MARKETING',
    status: 'APPROVED',
    headerType: 'DOCUMENT',
    headerSampleUrl: brochure,
    bodyText:
        'Hi,\nThank you for showing your interest in our course.\nPlease find attached the course brochure.',
    footerText: 'HCCA - A Division of Harp Technologies & Services Pvt Ltd',
    buttons: [{ type: 'QUICK_REPLY', text: 'Book Demo' }],
};

const withVariables: WhatsAppTemplateDTO = {
    ...base,
    name: 'responses_n__hyderabad',
    headerType: 'NONE',
    headerSampleUrl: undefined,
    bodyText: 'Hi {{1}} Looking to start your career in {{2}}? Reply to {{1}}.',
    bodyVariableNames: ['name', 'course'],
    bodySampleValues: ['Asha', 'SAP HCM'],
};

describe('templateVariables', () => {
    it('lists each distinct placeholder once, in order, with its name and sample', () => {
        expect(templateVariables(withVariables)).toEqual([
            { token: '1', name: 'name', sample: 'Asha' },
            { token: '2', name: 'course', sample: 'SAP HCM' },
        ]);
    });

    it('is empty for a body with no placeholders', () => {
        expect(templateVariables(base)).toEqual([]);
    });
});

describe('TemplateSendDialog', () => {
    it('renders nothing while no template is picked', () => {
        render(
            <TemplateSendDialog
                template={null}
                phone="917999873846"
                onClose={() => {}}
                onSend={async () => {}}
            />
        );
        expect(screen.queryByText('Send template')).toBeNull();
    });

    it('shows the whole approved template — document header, body, footer, button — and the recipient', () => {
        render(
            <TemplateSendDialog
                template={base}
                phone="917999873846"
                onClose={() => {}}
                onSend={async () => {}}
            />
        );
        expect(screen.getByText('To 917999873846')).toBeTruthy();
        expect(screen.getByText(/Please find attached the course brochure/)).toBeTruthy();
        expect(screen.getByText(base.footerText as string)).toBeTruthy();
        expect(screen.getByText('Book Demo')).toBeTruthy();
        // The document tile carries the file's name, so the admin can tell WHICH pdf goes out.
        expect(screen.getByText('HCCA_Updated_Brochure_1.pdf')).toBeTruthy();
    });

    it('sends the variables keyed by position, prefilled from the samples and edited live', async () => {
        const onSend = vi.fn<[WhatsAppTemplateDTO, Record<string, string>], Promise<void>>(
            async () => {}
        );
        render(
            <TemplateSendDialog
                template={withVariables}
                phone="917999873846"
                onClose={() => {}}
                onSend={onSend}
            />
        );

        // MyInput's label carries no htmlFor, so find the field by its prefilled sample.
        const nameInput = screen.getByDisplayValue('Asha') as HTMLInputElement;
        expect(nameInput.value).toBe('Asha');
        fireEvent.change(nameInput, { target: { value: 'Ravi' } });
        // The preview follows the field: two chips for the repeated {{1}}, both now "Ravi".
        expect(screen.getAllByText('Ravi')).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: 'Send template' }));
        await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
        expect(onSend.mock.calls[0]?.[1]).toEqual({ '1': 'Ravi', '2': 'SAP HCM' });
    });

    it('keeps Send disabled while a value is empty, and says how many are missing', () => {
        render(
            <TemplateSendDialog
                template={{ ...withVariables, bodySampleValues: ['Asha', ''] }}
                phone="917999873846"
                onClose={() => {}}
                onSend={async () => {}}
            />
        );
        expect(screen.getByText('1 value is still empty')).toBeTruthy();
        const send = screen.getByRole('button', { name: 'Send template' }) as HTMLButtonElement;
        expect(send.disabled).toBe(true);
    });

    it('blocks a media template that has no file saved, and says why', () => {
        render(
            <TemplateSendDialog
                template={{ ...base, headerSampleUrl: '' }}
                phone="917999873846"
                onClose={() => {}}
                onSend={async () => {}}
            />
        );
        expect(screen.getByText(/needs a document in its header/)).toBeTruthy();
        const send = screen.getByRole('button', { name: 'Send template' }) as HTMLButtonElement;
        expect(send.disabled).toBe(true);
    });
});
