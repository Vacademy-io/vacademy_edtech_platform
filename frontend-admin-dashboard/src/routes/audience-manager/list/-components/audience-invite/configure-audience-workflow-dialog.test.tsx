import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import dialogStrings from '../../../../../../public/locales/en/audienceManagerConfigureAudienceWorkflowDialog.json';
import variableStrings from '../../../../../../public/locales/en/leadTemplateVariables.json';

/**
 * WhatsApp template variables in the audience "Configure workflow" dialog.
 *
 * Meta rejects a template message outright when any declared placeholder gets
 * no value (Meta error 132000), while the workflow still reports the send as a
 * success — so a node saved without a mapping fails silently for every lead.
 * The dialog must make the admin map each placeholder, from the lead's details
 * or the lead list's own form fields, before the workflow can be created.
 */
const CATALOGUES: Record<string, unknown> = {
    audienceManagerConfigureAudienceWorkflowDialog: dialogStrings,
    leadTemplateVariables: variableStrings,
};
const lookup = (namespace: string, key: string): unknown =>
    key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            CATALOGUES[namespace]
        );
const translate = (namespace: string, key: string, opts?: Record<string, unknown>) => {
    let value = lookup(namespace, key);
    if (value === undefined && typeof opts?.count === 'number') {
        value = lookup(namespace, `${key}_${opts.count === 1 ? 'one' : 'other'}`);
    }
    if (typeof value !== 'string') throw new Error(`Missing translation: ${namespace}:${key}`);
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
};
vi.mock('react-i18next', () => ({
    useTranslation: (namespace: string) => ({
        t: (key: string, opts?: Record<string, unknown>) => translate(namespace, key, opts),
    }),
    Trans: () => null,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/utils/userDetails', () => ({ getUserId: () => 'admin-1' }));
vi.mock('@/services/message-template-service', () => ({
    getMessageTemplates: async () => ({ templates: [] }),
}));

type TemplateRow = { id: string; name: string; content: string; dynamic_parameters?: string };
let waTemplates: TemplateRow[] = [];
const createWorkflow = vi.fn();
vi.mock('@/services/workflow-service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/workflow-service')>()),
    createWorkflow: (...args: unknown[]) => createWorkflow(...args),
    getTemplatesByTypeQuery: () => ({
        queryKey: ['wa-templates-test'],
        queryFn: async () =>
            waTemplates.map((tpl) => ({ ...tpl, status: 'APPROVED', type: 'WHATSAPP' })),
    }),
}));

// The campaign list does not carry the form's fields, so the dialog fetches the
// campaign itself; this stands in for that request.
let fetchedCustomFields: unknown[] = [];
const campaignQuery = vi.fn();
vi.mock('@/routes/audience-manager/list/-hooks/useGetCampaignById', () => ({
    useGetCampaignById: (params: { enabled?: boolean }) => campaignQuery(params),
}));

import { ConfigureAudienceWorkflowDialog } from './configure-audience-workflow-dialog';

const vars = variableStrings;
const WALK_IN_FORM = [
    { custom_field: { id: 'cf-1', fieldName: 'Full Name', formOrder: 1 } },
    { custom_field: { id: 'cf-2', fieldName: 'Phone Number', formOrder: 2 } },
    { custom_field: { id: 'cf-3', fieldName: 'Course Interested', formOrder: 3 } },
];

const renderDialog = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ConfigureAudienceWorkflowDialog
                open
                onOpenChange={() => undefined}
                audienceId="aud-1"
                audienceName="Offline Campus Walk In"
                instituteId="inst-1"
            />
        </QueryClientProvider>
    );
};

const nativeSelects = () => screen.getAllByRole('combobox').filter((el) => el.tagName === 'SELECT');
const createButton = () => screen.getByRole('button', { name: dialogStrings.actions.submit });
const variablePicker = (key: string) =>
    screen.getByRole('combobox', { name: vars.pickerLabel.replace('{{key}}', key) });
const preview = () => screen.getByTestId('whatsapp-message-preview');

/** Switch to WhatsApp-only and pick a template; returns once its option has loaded. */
const pickWhatsappTemplate = async (templateName: string) => {
    fireEvent.change(nativeSelects()[0]!, { target: { value: 'WHATSAPP' } });
    await screen.findByRole('option', { name: templateName });
    fireEvent.change(nativeSelects()[1]!, { target: { value: templateName } });
};

const openPicker = async (key: string) => {
    fireEvent.click(variablePicker(key));
    return screen.findByRole('listbox');
};

const choose = async (key: string, optionName: string) => {
    await openPicker(key);
    fireEvent.click(screen.getByRole('option', { name: optionName }));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
};

const createAndReadWhatsappConfig = async () => {
    expect(createButton()).toBeEnabled();
    fireEvent.click(createButton());
    await waitFor(() => expect(createWorkflow).toHaveBeenCalledTimes(1));
    const dto = createWorkflow.mock.calls[0]![0] as {
        nodes: Array<{ node_type: string; config: Record<string, unknown> }>;
    };
    return dto.nodes.find((n) => n.node_type === 'SEND_WHATSAPP')!.config;
};

beforeEach(() => {
    createWorkflow.mockReset();
    createWorkflow.mockResolvedValue({ id: 'wf-1' });
    fetchedCustomFields = WALK_IN_FORM;
    campaignQuery.mockReset();
    campaignQuery.mockImplementation(({ enabled }: { enabled?: boolean }) => ({
        data: enabled ? { institute_custom_fields: fetchedCustomFields } : undefined,
        isLoading: false,
    }));
    waTemplates = [
        {
            id: 'walk_in_confirmation',
            name: 'walk_in_confirmation',
            content: 'Hi {{1}} 👋 We’ve received your details through the Elevate Walk-in Form.',
            dynamic_parameters: JSON.stringify({ 1: 'Name' }),
        },
        {
            id: 'batch_update',
            name: 'batch_update',
            content:
                'Hi {{1}}, your {{2}} batch starts soon. Reply to this message with questions.',
            dynamic_parameters: JSON.stringify({ 1: '1', 2: '2' }),
        },
        { id: 'plain_hello', name: 'plain_hello', content: 'Thanks for visiting us!' },
    ];
});

describe('ConfigureAudienceWorkflowDialog — WhatsApp template variables', () => {
    it("fills a {{1}} labelled Name with the lead's name and sends the confirmation's key", async () => {
        renderDialog();
        await pickWhatsappTemplate('walk_in_confirmation');

        expect(variablePicker('1')).toHaveTextContent(vars.lead.leadName);
        expect(preview()).toHaveTextContent(`Hi ${vars.lead.leadName} 👋`);
        expect(screen.getByText(vars.allMapped)).toBeInTheDocument();

        const config = await createAndReadWhatsappConfig();
        expect(config.templateName).toBe('walk_in_confirmation');
        // A confirmation iterates the lead's UserDTO, which is snake_case.
        expect(config.templateVars).toEqual({ 1: 'full_name' });
        // Lets the builder show the same pickers when the workflow is opened there.
        expect(config._templateParams).toEqual({ 1: 'Name' });
    });

    it("uses the follow-up row's key for the lead's name in a follow-up", async () => {
        renderDialog();
        fireEvent.click(screen.getByText(dialogStrings.kind.followup.title));
        await pickWhatsappTemplate('walk_in_confirmation');

        const config = await createAndReadWhatsappConfig();
        expect(config.templateVars).toEqual({ 1: 'parentName' });
    });

    it('offers every lead detail and the fetched form fields, grouped', async () => {
        renderDialog();
        await pickWhatsappTemplate('batch_update');
        expect(campaignQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));

        await openPicker('2');
        expect(screen.getByText(vars.groups.lead)).toBeInTheDocument();
        expect(screen.getByText(vars.groups.form)).toBeInTheDocument();
        const options = screen.getAllByRole('option').map((o) => o.textContent);
        expect(options).toEqual([
            vars.lead.leadName,
            vars.lead.email,
            vars.lead.phone,
            vars.lead.listName,
            vars.lead.submittedOn,
            vars.lead.instituteName,
            'Full Name',
            'Phone Number',
            'Course Interested',
            vars.customText,
        ]);
    });

    it('leaves a bare {{2}} unpicked and blocks Create until the admin maps it', async () => {
        renderDialog();
        await pickWhatsappTemplate('batch_update');

        // Nothing names these two, so neither is guessed.
        expect(variablePicker('1')).toHaveTextContent(vars.placeholder);
        expect(variablePicker('2')).toHaveTextContent(vars.placeholder);
        expect(screen.getByText(vars.incomplete)).toBeInTheDocument();
        expect(preview()).toHaveTextContent('Hi {{1}}, your {{2}} batch starts soon.');
        expect(createButton()).toBeDisabled();

        await choose('1', 'Full Name');
        await choose('2', 'Course Interested');
        expect(preview()).toHaveTextContent(
            'Hi Full Name, your Course Interested batch starts soon.'
        );

        const config = await createAndReadWhatsappConfig();
        expect(config.templateVars).toEqual({ 1: 'Full Name', 2: 'Course Interested' });
    });

    it('sends a fixed custom text when the admin chooses one', async () => {
        renderDialog();
        await pickWhatsappTemplate('walk_in_confirmation');

        await choose('1', vars.customText);
        expect(createButton()).toBeDisabled();
        fireEvent.change(screen.getByPlaceholderText(vars.customTextPlaceholder), {
            target: { value: 'Team Elevate' },
        });
        expect(preview()).toHaveTextContent('Hi Team Elevate 👋');

        const config = await createAndReadWhatsappConfig();
        expect(config.templateVars).toEqual({ 1: 'Team Elevate' });
    });

    // A "Custom text" pick on one template's {{1}} must not carry over to the next template's
    // {{1}} — there it would hide the lead detail actually picked and saved.
    it('does not carry a custom-text pick over to another template', async () => {
        renderDialog();
        await pickWhatsappTemplate('batch_update');
        await choose('1', vars.customText);
        expect(screen.getByPlaceholderText(vars.customTextPlaceholder)).toBeInTheDocument();

        fireEvent.change(nativeSelects()[1]!, { target: { value: 'walk_in_confirmation' } });
        await waitFor(() =>
            expect(
                screen.queryByPlaceholderText(vars.customTextPlaceholder)
            ).not.toBeInTheDocument()
        );
        expect(variablePicker('1')).toHaveTextContent(vars.lead.leadName);
    });

    it('sends the lead list name as text in a follow-up, which has no campaign name', async () => {
        renderDialog();
        await pickWhatsappTemplate('walk_in_confirmation');
        await choose('1', vars.lead.listName);
        fireEvent.click(screen.getByText(dialogStrings.kind.followup.title));

        const config = await createAndReadWhatsappConfig();
        expect(config.templateVars).toEqual({ 1: 'Offline Campus Walk In' });
    });

    it('drops a lead detail the follow-up cannot resolve when the kind changes', async () => {
        renderDialog();
        await pickWhatsappTemplate('walk_in_confirmation');
        await choose('1', vars.lead.submittedOn);
        expect(createButton()).toBeEnabled();

        fireEvent.click(screen.getByText(dialogStrings.kind.followup.title));
        expect(variablePicker('1')).toHaveTextContent(vars.placeholder);
        expect(createButton()).toBeDisabled();
    });

    it('says so when the form has no fields', async () => {
        fetchedCustomFields = [];
        renderDialog();
        await pickWhatsappTemplate('batch_update');

        await openPicker('1');
        expect(screen.getByRole('option', { name: vars.noFormFields })).toHaveAttribute(
            'aria-disabled',
            'true'
        );
    });

    it('adds no variables for a template that declares none', async () => {
        renderDialog();
        await pickWhatsappTemplate('plain_hello');

        expect(screen.queryByText(vars.title)).not.toBeInTheDocument();
        const config = await createAndReadWhatsappConfig();
        expect(config).not.toHaveProperty('templateVars');
        expect(config).not.toHaveProperty('_templateParams');
    });
});
