import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Lightning, Clock } from '@phosphor-icons/react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LeadTemplateVariablesMapper } from '@/components/shared/leads/lead-template-variables-mapper';
import {
    defaultLeadVarChoices,
    isLeadVarComplete,
    leadVarStoredValue,
    whatsappTemplateParamSpec,
    type LeadVarChoice,
} from '@/components/shared/leads/lead-template-variables';
import {
    createWorkflow,
    getTemplatesByTypeQuery,
    type TemplateItem,
} from '@/services/workflow-service';
import { getMessageTemplates } from '@/services/message-template-service';
import { getUserId } from '@/utils/userDetails';
import type { WorkflowBuilderDTO, WorkflowBuilderEdge, WorkflowBuilderNode } from '@/types/workflow/workflow-types';
import { useGetCampaignById } from '../../-hooks/useGetCampaignById';
import {
    parseCustomFieldsFromJson,
    type CustomFieldConfig,
} from '../../-utils/lead-bulk-import-utils';

interface ConfigureAudienceWorkflowDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    audienceId: string;
    audienceName: string;
    instituteId: string;
    /**
     * The audience form's fields, offered as sources for WhatsApp template
     * variables. Fetched with the campaign when not passed — the campaign list
     * endpoint does not return them.
     */
    customFields?: CustomFieldConfig[];
}

type WorkflowKind = 'confirmation' | 'followup';
type Channel = 'EMAIL' | 'WHATSAPP' | 'BOTH';

const NO_CUSTOM_FIELDS: CustomFieldConfig[] = [];

/**
 * Placeholder → source-field mappings for a lead. Resolution order in the send
 * handlers is: item field → context field → customFields[<value>] → SpEL →
 * literal, so 'Full Name' here means customFields["Full Name"].
 *
 * Mirrors the wizard's audience_lead_confirmation use case, so the same email
 * templates work without manual mapping. WhatsApp variables are mapped by the
 * admin in the dialog instead — Meta rejects a message whose parameter count
 * is off, so they cannot be guessed wholesale like these.
 */
const LEAD_TEMPLATE_VARS: Record<string, string> = {
    parentName: 'Full Name',
    fullName: 'Full Name',
    // Canonical spelling — the default template scaffold and most hand-written
    // templates use {{name}}. notification-service aliases it too, but mapping
    // it here keeps the config tab's template/variable drift check quiet.
    name: 'Full Name',
    email: 'Email',
    mobileNumber: 'Phone Number',
    instituteName: 'instituteName',
};

/**
 * Inline form for creating a simple audience workflow without taking the user
 * to the full workflow builder. Covers the two most common cases:
 *
 *   1. Confirmation — event-driven, fires on AUDIENCE_LEAD_SUBMISSION
 *      → TRIGGER → SEND_EMAIL and/or SEND_WHATSAPP
 *      (templateVars pre-mapped to standard custom fields)
 *
 *   2. Follow-up after N days — scheduled, runs daily at 9 AM IST
 *      → QUERY (fetch_audience_responses_filtered, daysAgo=N, audienceId=this)
 *      → SEND_EMAIL and/or SEND_WHATSAPP (iterates the leads list)
 *
 * The workflow JSON shape mirrors what the wizard's `audience_lead_confirmation`
 * and `scheduled_audience_followup` use cases produce (in use-case-templates.ts),
 * so the result is interchangeable — an admin can later open the workflow in
 * the builder for further editing without seeing anything unexpected.
 */
export function ConfigureAudienceWorkflowDialog({
    open,
    onOpenChange,
    audienceId,
    audienceName,
    instituteId,
    customFields: customFieldsProp = NO_CUSTOM_FIELDS,
}: ConfigureAudienceWorkflowDialogProps) {
    const { t } = useTranslation('audienceManagerConfigureAudienceWorkflowDialog');
    const queryClient = useQueryClient();

    const [kind, setKind] = useState<WorkflowKind>('confirmation');
    const [channel, setChannel] = useState<Channel>('EMAIL');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [daysAgo, setDaysAgo] = useState<number>(3);
    const [templateName, setTemplateName] = useState('');
    const [waTemplateName, setWaTemplateName] = useState('');
    const [waVarChoices, setWaVarChoices] = useState<Record<string, LeadVarChoice | undefined>>({});
    const [nameTouched, setNameTouched] = useState(false);

    const usesEmail = channel === 'EMAIL' || channel === 'BOTH';
    const usesWhatsapp = channel === 'WHATSAPP' || channel === 'BOTH';

    // Reset when the dialog opens so re-opening for a different campaign starts fresh.
    useEffect(() => {
        if (open) {
            setKind('confirmation');
            setChannel('EMAIL');
            setDescription('');
            setDaysAgo(3);
            setTemplateName('');
            setWaTemplateName('');
            setWaVarChoices({});
            setNameTouched(false);
        }
    }, [open]);

    // Auto-suggest the workflow name from the kind + audience, but only until
    // the admin has typed something themselves (then we leave their value alone).
    useEffect(() => {
        if (nameTouched) return;
        if (kind === 'confirmation') {
            setName(t('nameSuggestion.confirmation', { audienceName }));
        } else {
            setName(t('nameSuggestion.followup', { audienceName, count: daysAgo }));
        }
    }, [kind, daysAgo, audienceName, nameTouched, t]);

    // Load the institute's email templates for the dropdown. Cached for 5 min.
    const { data: templateOptions = [], isLoading: templatesLoading } = useQuery({
        queryKey: ['configure-audience-workflow-templates'],
        queryFn: async () => {
            const result = await getMessageTemplates('EMAIL', 0, 100);
            return (result.templates ?? []).map((tpl: { name?: string; id?: string }) => ({
                value: tpl.name ?? tpl.id ?? '',
                label: tpl.name ?? t('fields.template.untitledFallback'),
            }));
        },
        staleTime: 5 * 60 * 1000,
    });

    // Approved WhatsApp templates. These live in notification-service (synced
    // from Meta), not in admin-core's template table — so they need the
    // workflow-service query rather than getMessageTemplates(). Same query the
    // workflow builder uses, so both offer an identical list.
    const { data: waTemplates, isLoading: waTemplatesLoading } = useQuery({
        ...getTemplatesByTypeQuery(instituteId, 'WHATSAPP'),
        enabled: !!instituteId && usesWhatsapp,
    });
    const waTemplateOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: Array<{ value: string; label: string }> = [];
        for (const tpl of (waTemplates ?? []) as TemplateItem[]) {
            // SEND_WHATSAPP sends by template NAME, so that is the stored value.
            const value = tpl.name ?? tpl.id ?? '';
            if (!value || seen.has(value)) continue;
            seen.add(value);
            options.push({ value, label: tpl.name ?? t('fields.template.untitledFallback') });
        }
        return options;
    }, [waTemplates, t]);

    // Which body placeholders the chosen WhatsApp template declares. Meta
    // rejects the whole send when the parameter count is off, so the generated
    // node must map exactly these — no more, no less.
    const waParamSpec = useMemo(
        () =>
            whatsappTemplateParamSpec(
                ((waTemplates ?? []) as TemplateItem[]).find((tpl) => tpl.name === waTemplateName)
            ),
        [waTemplates, waTemplateName]
    );
    const waParamKeys = useMemo(() => Object.keys(waParamSpec), [waParamSpec]);
    const waTemplateBody = useMemo(
        () =>
            ((waTemplates ?? []) as TemplateItem[]).find((tpl) => tpl.name === waTemplateName)
                ?.content ?? '',
        [waTemplates, waTemplateName]
    );

    // The audience form's own fields. Both the lead-submission context and the
    // follow-up query key a lead's answers by field name, so a field name is a
    // valid variable source in either kind of workflow.
    const { data: fetchedCampaign, isLoading: formFieldsLoading } = useGetCampaignById({
        instituteId,
        audienceId,
        enabled: open && usesWhatsapp && customFieldsProp.length === 0,
    });
    const customFields = useMemo(() => {
        if (customFieldsProp.length > 0) return customFieldsProp;
        if (!fetchedCampaign?.institute_custom_fields) return NO_CUSTOM_FIELDS;
        return parseCustomFieldsFromJson(JSON.stringify(fetchedCampaign.institute_custom_fields));
    }, [customFieldsProp, fetchedCampaign]);
    const formFieldNames = useMemo(
        () => Array.from(new Set(customFields.map((f) => f.fieldName.trim()).filter(Boolean))),
        [customFields]
    );
    const selectKind = (nextKind: WorkflowKind) => {
        setKind(nextKind);
        // Drop lead details the other kind of workflow cannot resolve, so they
        // show as unpicked instead of silently sending nothing.
        setWaVarChoices((prev) =>
            Object.fromEntries(
                Object.entries(prev).filter(
                    ([, choice]) => choice?.source !== 'lead' || isLeadVarComplete(choice, nextKind, audienceName)
                )
            )
        );
    };
    const selectWaTemplate = (nextName: string) => {
        setWaTemplateName(nextName);
        const tpl = ((waTemplates ?? []) as TemplateItem[]).find((item) => item.name === nextName);
        setWaVarChoices(defaultLeadVarChoices(whatsappTemplateParamSpec(tpl), formFieldNames, kind));
    };
    const setWaVarChoice = (key: string, choice: LeadVarChoice | undefined) =>
        setWaVarChoices((prev) => ({ ...prev, [key]: choice }));
    const waVarsIncomplete = waParamKeys.some(
        (key) => !isLeadVarComplete(waVarChoices[key], kind, audienceName)
    );

    const createMutation = useMutation({
        mutationFn: async () => {
            const hasWaVars = waParamKeys.length > 0;
            const common = {
                name,
                description,
                instituteId,
                audienceId,
                audienceName,
                channel,
                templateName,
                waTemplateName,
                waTemplateVars: hasWaVars
                    ? Object.fromEntries(
                          waParamKeys.map((key) => {
                              const choice = waVarChoices[key];
                              return [
                                  key,
                                  choice ? leadVarStoredValue(choice, kind, audienceName) : '',
                              ];
                          })
                      )
                    : undefined,
                waTemplateParams: hasWaVars ? waParamSpec : undefined,
            };
            const dto = kind === 'confirmation'
                ? buildConfirmationDTO(t, common)
                : buildFollowupDTO(t, { ...common, daysAgo });
            return createWorkflow(dto, getUserId());
        },
        onSuccess: () => {
            // Invalidate the workflow list so the count badge on the audience
            // card updates immediately and the LinkedWorkflowsDialog reflects
            // the new entry on next open.
            queryClient.invalidateQueries({
                queryKey: ['GET_ACTIVE_WORKFLOWS_WITH_SCHEDULES'],
                refetchType: 'all',
            });
            toast.success(t('toast.success'));
            onOpenChange(false);
        },
        onError: (err) => {
            const msg = err instanceof Error ? err.message : t('toast.errorFallback');
            toast.error(msg);
        },
    });

    const canSubmit = useMemo(() => {
        if (!name.trim()) return false;
        // Each selected channel needs its own template — "Email + WhatsApp"
        // needs both, and neither dropdown is required when its channel is off.
        if (usesEmail && !templateName.trim()) return false;
        if (usesWhatsapp && !waTemplateName.trim()) return false;
        // Meta rejects the message while any declared variable is empty.
        if (usesWhatsapp && waVarsIncomplete) return false;
        if (kind === 'followup' && (!daysAgo || daysAgo < 1)) return false;
        return !createMutation.isPending;
    }, [
        name,
        templateName,
        waTemplateName,
        waVarsIncomplete,
        usesEmail,
        usesWhatsapp,
        kind,
        daysAgo,
        createMutation.isPending,
    ]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-dialog-tall w-dialog-md overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('dialog.title')}</DialogTitle>
                    <DialogDescription>
                        <Trans
                            i18nKey="audienceManagerConfigureAudienceWorkflowDialog:dialog.description"
                            values={{ audienceName }}
                            components={{ bold: <span className="font-semibold" /> }}
                        />
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Kind picker — two large clickable cards */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-gray-700">
                            {t('kind.label')} <span className="text-red-400">*</span>
                        </Label>
                        <div className="grid grid-cols-2 gap-2">
                            <KindCard
                                selected={kind === 'confirmation'}
                                onClick={() => selectKind('confirmation')}
                                icon={<Lightning size={18} />}
                                title={t('kind.confirmation.title')}
                                description={t('kind.confirmation.description')}
                            />
                            <KindCard
                                selected={kind === 'followup'}
                                onClick={() => selectKind('followup')}
                                icon={<Clock size={18} />}
                                title={t('kind.followup.title')}
                                description={t('kind.followup.description')}
                            />
                        </div>
                    </div>

                    {/* Days input — only for follow-up */}
                    {kind === 'followup' && (
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium text-gray-700">
                                {t('fields.followupDays.label')} <span className="text-red-400">*</span>
                            </Label>
                            <Input
                                type="number"
                                min={1}
                                max={365}
                                value={daysAgo}
                                onChange={(e) => setDaysAgo(parseInt(e.target.value) || 1)}
                                className="w-32"
                            />
                            <p className="text-2xs text-gray-400">
                                {t('fields.followupDays.helper')}
                            </p>
                        </div>
                    )}

                    {/* Name */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-gray-700">
                            {t('fields.name.label')} <span className="text-red-400">*</span>
                        </Label>
                        <Input
                            value={name}
                            onChange={(e) => {
                                setNameTouched(true);
                                setName(e.target.value);
                            }}
                            placeholder={t('fields.name.placeholder')}
                        />
                    </div>

                    {/* Description */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-gray-700">
                            {t('fields.description.label')} <span className="text-gray-400 text-xs">{t('fields.description.optional')}</span>
                        </Label>
                        <Textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                            placeholder={t('fields.description.placeholder')}
                        />
                    </div>

                    {/* Channel */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-gray-700">
                            {t('fields.channel.label')} <span className="text-red-400">*</span>
                        </Label>
                        <select
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                            value={channel}
                            onChange={(e) => setChannel(e.target.value as Channel)}
                        >
                            <option value="EMAIL">{t('fields.channel.email')}</option>
                            <option value="WHATSAPP">{t('fields.channel.whatsapp')}</option>
                            <option value="BOTH">{t('fields.channel.both')}</option>
                        </select>
                        <p className="text-2xs text-gray-400">{t('fields.channel.helper')}</p>
                    </div>

                    {/* Email template */}
                    {usesEmail && (
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium text-gray-700">
                                {t('fields.template.label')} <span className="text-red-400">*</span>
                            </Label>
                            <select
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                            >
                                <option value="">{templatesLoading ? t('fields.template.loading') : t('fields.template.placeholder')}</option>
                                {templateOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                            {templateOptions.length === 0 && !templatesLoading && (
                                <p className="text-2xs text-amber-600">
                                    {t('fields.template.noneFound')}
                                </p>
                            )}
                        </div>
                    )}

                    {/* WhatsApp template */}
                    {usesWhatsapp && (
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium text-gray-700">
                                {t('fields.whatsappTemplate.label')} <span className="text-red-400">*</span>
                            </Label>
                            <select
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                                value={waTemplateName}
                                onChange={(e) => selectWaTemplate(e.target.value)}
                            >
                                <option value="">{waTemplatesLoading ? t('fields.template.loading') : t('fields.whatsappTemplate.placeholder')}</option>
                                {waTemplateOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                            {waTemplateOptions.length === 0 && !waTemplatesLoading ? (
                                <p className="text-2xs text-amber-600">
                                    {t('fields.whatsappTemplate.noneFound')}
                                </p>
                            ) : waParamKeys.length === 0 ? (
                                <p className="text-2xs text-gray-400">
                                    {t('fields.whatsappTemplate.helper')}
                                </p>
                            ) : null}
                        </div>
                    )}

                    {/* WhatsApp template variables — Meta rejects the send unless
                        every declared placeholder gets a value, so the admin maps
                        each one here, against a live preview. */}
                    {usesWhatsapp && (
                        <LeadTemplateVariablesMapper
                            paramSpec={waParamSpec}
                            templateBody={waTemplateBody}
                            choices={waVarChoices}
                            onChoiceChange={setWaVarChoice}
                            kind={kind}
                            audienceName={audienceName}
                            formFieldNames={formFieldNames}
                            formFieldsLoading={formFieldsLoading}
                        />
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={createMutation.isPending}
                    >
                        {t('actions.cancel')}
                    </Button>
                    <Button
                        onClick={() => createMutation.mutate()}
                        disabled={!canSubmit}
                        className="gap-1.5"
                    >
                        {createMutation.isPending ? t('actions.submitting') : t('actions.submit')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ─── Small subcomponents ───

function KindCard({
    selected, onClick, icon, title, description,
}: {
    selected: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    title: string;
    description: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all ${
                selected
                    ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-200'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
        >
            <div className={`flex items-center gap-1.5 ${selected ? 'text-primary-700' : 'text-gray-600'}`}>
                {icon}
                <span className="text-sm font-semibold">{title}</span>
            </div>
            <p className="text-2xs text-gray-500 leading-relaxed">{description}</p>
        </button>
    );
}

// ─── DTO builders ───
// Inline rather than importing the wizard's generators because (a) the wizard
// returns ReactFlow nodes that need conversion to the API's node shape and
// (b) the wizard relies on Zustand state we don't want to touch from here.
// The output shape is identical to what the wizard saves, so workflows created
// here are fully editable in the visual builder afterwards.

interface ConfirmationOpts {
    name: string;
    description: string;
    instituteId: string;
    audienceId: string;
    audienceName: string;
    channel: Channel;
    templateName: string;
    waTemplateName: string;
    /** Admin's pick for every placeholder the WhatsApp template declares. */
    waTemplateVars?: Record<string, string>;
    /** The WhatsApp template's placeholders and labels, stored as _templateParams. */
    waTemplateParams?: Record<string, string>;
}

/**
 * Build the SEND_EMAIL and/or SEND_WHATSAPP nodes for the chosen channel,
 * chained vertically from (x, y) and terminated with `routing: [{type:'end'}]`
 * on the last one. Mirrors makeChannelSendNodes() in use-case-templates.ts,
 * but emits the API DTO node shape instead of ReactFlow nodes.
 *
 * `waOn` matters: the two channels do not always iterate the same list. The
 * confirmation flow's respondentEmailRequests items carry only to/subject/body
 * (no phone), so WhatsApp has to iterate the lead's UserDTO instead.
 *
 * So does the split between `templateVars` and the WhatsApp node's own vars.
 * Email templates ignore placeholders they don't use; Meta counts them and
 * rejects the send outright if the number is wrong, so the WhatsApp node gets
 * exactly the placeholders its template declares, as mapped in the dialog, and
 * none at all when it declares none.
 */
function buildSendNodes(
    t: TFunction,
    opts: {
        channel: Channel;
        templateName: string;
        waTemplateName: string;
        on: string;
        waOn?: string;
        x: number;
        y: number;
        templateVars?: Record<string, string>;
        waTemplateVars?: Record<string, string>;
        waTemplateParams?: Record<string, string>;
    }
): { nodes: WorkflowBuilderNode[]; edges: WorkflowBuilderEdge[] } {
    const nodes: WorkflowBuilderNode[] = [];
    let y = opts.y;

    if (opts.channel === 'EMAIL' || opts.channel === 'BOTH') {
        nodes.push({
            id: uuidv4(),
            name: t('dto.sendNodeName', { templateName: opts.templateName }),
            node_type: 'SEND_EMAIL',
            config: {
                templateName: opts.templateName,
                on: opts.on,
                forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                ...(opts.templateVars ? { templateVars: opts.templateVars } : {}),
            },
            position_x: opts.x,
            position_y: y,
            is_start_node: false,
            is_end_node: false,
        });
        y += 180;
    }

    if (opts.channel === 'WHATSAPP' || opts.channel === 'BOTH') {
        nodes.push({
            id: uuidv4(),
            name: t('dto.sendWhatsappNodeName', { templateName: opts.waTemplateName }),
            node_type: 'SEND_WHATSAPP',
            config: {
                templateName: opts.waTemplateName,
                on: opts.waOn ?? opts.on,
                forEach: { operation: 'SEND_WHATSAPP', eval: "#ctx['item']" },
                ...(opts.waTemplateVars ? { templateVars: opts.waTemplateVars } : {}),
                // Same key the builder writes on template pick: it shows the variable
                // pickers there, and makes the send handler skip (visibly) a lead
                // whose value comes out empty instead of sending what Meta rejects.
                ...(opts.waTemplateParams ? { _templateParams: opts.waTemplateParams } : {}),
            },
            position_x: opts.x,
            position_y: y,
            is_start_node: false,
            is_end_node: false,
        });
    }

    // Chain the sends, then terminate the last one.
    const edges: WorkflowBuilderEdge[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
        const from = nodes[i]!;
        const to = nodes[i + 1]!;
        from.config.routing = [{ type: 'goto', targetNodeId: to.id, label: '' }];
        edges.push({ id: uuidv4(), source_node_id: from.id, target_node_id: to.id, label: '' });
    }
    const last = nodes[nodes.length - 1]!;
    last.config.routing = [{ type: 'end' }];
    last.is_end_node = true;

    return { nodes, edges };
}

function buildConfirmationDTO(t: TFunction, opts: ConfirmationOpts): WorkflowBuilderDTO {
    const triggerId = uuidv4();
    // respondentEmailRequests = list of email requests for the LEAD (always
    // populated by AudienceService for any lead submission). Its items carry
    // only to/subject/body, so WhatsApp iterates the lead's UserDTO instead —
    // that is what carries mobile_number for the handler to extract.
    const send = buildSendNodes(t, {
        channel: opts.channel,
        templateName: opts.templateName,
        waTemplateName: opts.waTemplateName,
        on: "#ctx['respondentEmailRequests']",
        waOn: "{#ctx['user']}",
        x: 250,
        y: 230,
        templateVars: LEAD_TEMPLATE_VARS,
        waTemplateVars: opts.waTemplateVars,
        waTemplateParams: opts.waTemplateParams,
    });
    const firstSend = send.nodes[0]!;
    return {
        name: opts.name,
        description: opts.description || t('dto.confirmation.descriptionFallback', { audienceName: opts.audienceName }),
        status: 'ACTIVE',
        workflow_type: 'EVENT_DRIVEN',
        institute_id: opts.instituteId,
        nodes: [
            {
                id: triggerId,
                name: t('dto.confirmation.triggerNodeName'),
                node_type: 'TRIGGER',
                config: {
                    triggerEvent: 'AUDIENCE_LEAD_SUBMISSION',
                    routing: [{ type: 'goto', targetNodeId: firstSend.id, label: '' }],
                },
                position_x: 250,
                position_y: 50,
                is_start_node: true,
                is_end_node: false,
            },
            ...send.nodes,
        ],
        edges: [
            {
                id: uuidv4(),
                source_node_id: triggerId,
                target_node_id: firstSend.id,
                label: '',
            },
            ...send.edges,
        ],
        trigger: {
            trigger_event_name: 'AUDIENCE_LEAD_SUBMISSION',
            event_applied_type: 'AUDIENCE',
            event_id: opts.audienceId,
        },
    };
}

interface FollowupOpts extends ConfirmationOpts {
    daysAgo: number;
}

function buildFollowupDTO(t: TFunction, opts: FollowupOpts): WorkflowBuilderDTO {
    const queryId = uuidv4();
    // Both channels iterate the same query output here: fetch_audience_responses_filtered
    // emits leads carrying both email and the phone custom field.
    const send = buildSendNodes(t, {
        channel: opts.channel,
        templateName: opts.templateName,
        waTemplateName: opts.waTemplateName,
        on: "#ctx['leads']",
        x: 250,
        y: 230,
        waTemplateVars: opts.waTemplateVars,
        waTemplateParams: opts.waTemplateParams,
    });
    const firstSend = send.nodes[0]!;
    return {
        name: opts.name,
        description:
            opts.description
            || t('dto.followup.descriptionFallback', { audienceName: opts.audienceName, count: opts.daysAgo }),
        status: 'ACTIVE',
        workflow_type: 'SCHEDULED',
        institute_id: opts.instituteId,
        nodes: [
            {
                id: queryId,
                name: t('dto.followup.queryNodeName'),
                node_type: 'QUERY',
                config: {
                    prebuiltKey: 'fetch_audience_responses_filtered',
                    params: {
                        audienceId: opts.audienceId,
                        daysAgo: opts.daysAgo,
                    },
                    routing: [{ type: 'goto', targetNodeId: firstSend.id, label: '' }],
                },
                position_x: 250,
                position_y: 50,
                is_start_node: true,
                is_end_node: false,
            },
            ...send.nodes,
        ],
        edges: [
            {
                id: uuidv4(),
                source_node_id: queryId,
                target_node_id: firstSend.id,
                label: '',
            },
            ...send.edges,
        ],
        schedule: {
            // Daily 9 AM IST — matches what the wizard's scheduled audience
            // followup uses. Admin can edit the cron in the workflow detail
            // page later if they want a different time.
            schedule_type: 'CRON',
            cron_expression: '0 0 9 * * ?',
            timezone: 'Asia/Kolkata',
        },
    };
}
