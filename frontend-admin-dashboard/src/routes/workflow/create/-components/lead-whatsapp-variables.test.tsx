import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import strings from '../../../../../public/locales/en/leadTemplateVariables.json';

/**
 * The workflow builder's WhatsApp node, when it messages leads, maps template
 * variables with the same pickers as the lead list's "Configure workflow"
 * dialog — including for nodes that dialog saved without `_templateParams`.
 */
const translate = (key: string, opts?: Record<string, unknown>) => {
    const value = key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            strings
        );
    if (typeof value !== 'string') throw new Error(`Missing translation: ${key}`);
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

const getCampaignById = vi.fn();
vi.mock('@/routes/audience-manager/list/-services/get-campaign-by-id', () => ({
    getCampaignById: (...args: unknown[]) => getCampaignById(...args),
}));
const fetchCustomFieldSetup = vi.fn();
vi.mock('@/routes/audience-manager/list/-services/get-custom-field-setup', () => ({
    fetchCustomFieldSetup: (...args: unknown[]) => fetchCustomFieldSetup(...args),
}));

import { LeadWhatsappVariables } from './lead-whatsapp-variables';
import type { TemplateItem } from '@/services/workflow-service';

const TEMPLATES: TemplateItem[] = [
    {
        id: 'walk_in_confirmation',
        name: 'walk_in_confirmation',
        content: 'Hi {{1}} 👋 We’ve received your details.',
        dynamic_parameters: JSON.stringify({ 1: 'Name' }),
        status: 'APPROVED',
        type: 'WHATSAPP',
    },
];

const renderNode = (
    config: Record<string, unknown>,
    props: { kind?: 'confirmation' | 'followup'; audienceId?: string } = {}
) => {
    const onConfigChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <LeadWhatsappVariables
                config={config}
                onConfigChange={onConfigChange}
                kind={props.kind ?? 'confirmation'}
                audienceId={props.audienceId}
                instituteId="inst-1"
                templates={TEMPLATES}
            />
        </QueryClientProvider>
    );
    return onConfigChange;
};

const picker = () =>
    screen.getByRole('combobox', { name: strings.pickerLabel.replace('{{key}}', '1') });

beforeEach(() => {
    getCampaignById.mockReset();
    getCampaignById.mockResolvedValue({
        campaign_name: 'Offline Campus Walk In',
        institute_custom_fields: [
            { custom_field: { id: 'cf-1', fieldName: 'Full Name', formOrder: 1 } },
            { custom_field: { id: 'cf-2', fieldName: 'Course Interested', formOrder: 2 } },
        ],
    });
    fetchCustomFieldSetup.mockReset();
    fetchCustomFieldSetup.mockResolvedValue([
        {
            custom_field_id: 'cf-9',
            field_key: 'city',
            field_name: 'City',
            field_type: 'TEXT',
            form_order: 1,
        },
    ]);
});

describe('LeadWhatsappVariables', () => {
    // The Elevate walk-in node: saved by the dialog with no _templateParams, and
    // {{1}} mapped by hand to the lead's name.
    it('reads a saved node back, with the placeholders taken from the template', async () => {
        renderNode(
            { templateName: 'walk_in_confirmation', templateVars: { 1: 'full_name' } },
            { audienceId: 'aud-1' }
        );

        expect(picker()).toHaveTextContent(strings.lead.leadName);
        expect(screen.getByTestId('whatsapp-message-preview')).toHaveTextContent(
            `Hi ${strings.lead.leadName} 👋`
        );
        expect(screen.getByText(strings.allMapped)).toBeInTheDocument();
    });

    it('writes the pick and the template’s placeholders onto the node', async () => {
        const onConfigChange = renderNode(
            { templateName: 'walk_in_confirmation', on: "{#ctx['user']}" },
            { audienceId: 'aud-1' }
        );
        expect(screen.getByText(strings.incomplete)).toBeInTheDocument();

        fireEvent.click(picker());
        fireEvent.click(await screen.findByRole('option', { name: 'Course Interested' }));

        expect(onConfigChange).toHaveBeenCalledWith({
            templateName: 'walk_in_confirmation',
            on: "{#ctx['user']}",
            templateVars: { 1: 'Course Interested' },
            _templateParams: { 1: 'Name' },
        });
        expect(getCampaignById).toHaveBeenCalledWith('inst-1', 'aud-1');
    });

    it('offers the institute’s custom fields when the workflow is not scoped to one list', async () => {
        renderNode({ templateName: 'walk_in_confirmation' });

        fireEvent.click(picker());
        expect(await screen.findByRole('option', { name: 'City' })).toBeInTheDocument();
        expect(getCampaignById).not.toHaveBeenCalled();
    });

    it('uses the follow-up row’s key for the lead’s name', async () => {
        const onConfigChange = renderNode(
            { templateName: 'walk_in_confirmation', on: "#ctx['leads']" },
            { kind: 'followup', audienceId: 'aud-1' }
        );

        fireEvent.click(picker());
        fireEvent.click(await screen.findByRole('option', { name: strings.lead.leadName }));
        await waitFor(() =>
            expect(onConfigChange).toHaveBeenCalledWith(
                expect.objectContaining({ templateVars: { 1: 'parentName' } })
            )
        );
    });
});
