import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowBuilderStore } from '../-stores/workflow-builder-store';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Trash, X, Warning } from '@phosphor-icons/react';
import { WORKFLOW_NODE_TYPES } from '@/types/workflow/workflow-types';
import { getNodeIssues } from './workflow-custom-node';
import { VariablePicker } from './variable-picker';
import { ConditionBuilder } from './condition-builder';
import { AggregateBuilder } from './aggregate-builder';
import { KeyValueBuilder } from './key-value-builder';
import { EventEntityPicker } from './event-entity-picker';
import { LeadWhatsappVariables } from './lead-whatsapp-variables';
import { leadMessagingContext } from './lead-messaging-context';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useLeadStatuses } from '@/hooks/use-lead-statuses';
import { useAiCampaignOptions } from '@/hooks/use-ai-campaign-options';
import {
    TemplateSearchableSelect,
    toTemplateOptions,
} from '@/components/templates/TemplateSearchableSelect';
import {
    getQueryKeysQuery,
    getTriggerEventsCatalogQuery,
    getTemplatesByTypeQuery,
} from '@/services/workflow-service';
import { whatsappTemplateParamSpec } from '@/components/shared/leads/lead-template-variables';

/** Handles auto-fill of system params and smart input for required query params */
/**
 * Which entities the trigger actually fires for, editable inline.
 *
 * <p>The scope lives on the workflow's trigger row, not on the TRIGGER node's config, so the
 * node panel used to show only the event name -- an admin opening a saved workflow could see
 * "Audience Lead Submission" but had no way to learn WHICH audience without reopening the
 * setup wizard, and no way to change it from here. Both the names and the editing surface
 * come from EventEntityPicker, the same control the wizard uses.</p>
 */
function TriggerScopeSection({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('workflowNodeConfigPanel');
    const { triggerConfig, setTriggerConfig } = useWorkflowBuilderStore();
    const appliedType = triggerConfig.eventAppliedType;

    // Events that fire institute-wide have nothing to scope -- say so rather than rendering
    // an empty picker that looks broken.
    if (!appliedType || !SCOPED_APPLIED_TYPES.includes(appliedType)) {
        return (
            <p className="mt-2 text-caption text-gray-400">
                {t('triggerScope.noScope')}
            </p>
        );
    }

    const selectedIds = triggerConfig.eventIds?.length
        ? triggerConfig.eventIds
        : triggerConfig.eventId
          ? [triggerConfig.eventId]
          : [];

    return (
        <div className="mt-3 border-t pt-3">
            <EventEntityPicker
                eventAppliedType={appliedType}
                multiValue={selectedIds}
                onMultiChange={(ids) => setTriggerConfig({ eventIds: ids, eventId: undefined })}
                instituteId={instituteId}
            />
        </div>
    );
}

const SCOPED_APPLIED_TYPES = ['PACKAGE_SESSION', 'AUDIENCE', 'LIVE_SESSION', 'ENROLL_INVITE'];

function QueryRequiredParams({ params, config, onConfigChange, nodeId, instituteId, edges, nodes, selectedNodeId }: {
    params: string[];
    config: Record<string, unknown>;
    onConfigChange: (key: string, value: unknown) => void;
    nodeId: string;
    instituteId: string;
    edges: Array<{ source: string; target: string }>;
    nodes: Array<{ id: string; data: Record<string, unknown> }>;
    selectedNodeId: string;
}) {
    const { t } = useTranslation('workflowNodeConfigPanel');
    // Auto-fill instituteId on mount
    useEffect(() => {
        if (params.includes('instituteId') && !config['instituteId']) {
            onConfigChange('instituteId', "#ctx['instituteId']");
        }
    }, [params, config, onConfigChange]);

    if (params.length === 0) return null;

    // Check if this node has upstream connections
    const hasUpstream = edges.some((e) => e.target === selectedNodeId);

    // Entity type map for ID params
    const entityTypeMap: Record<string, string> = {
        audienceId: 'AUDIENCE',
        batchId: 'PACKAGE_SESSION',
        liveSessionId: 'LIVE_SESSION',
        inviteId: 'ENROLL_INVITE',
    };

    return (
        <div className="space-y-2 border-t pt-2 mt-2">
            <Label className="text-[10px] uppercase text-gray-400">{t('common.requiredParameters')}</Label>
            {params.map((param) => {
                const isSystemParam = param === 'instituteId';
                const entityType = entityTypeMap[param];

                return (
                    <div key={param}>
                        <Label className="text-xs">{param}</Label>
                        {isSystemParam ? (
                            <div className="mt-1">
                                <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                                    {t('common.autoFilled')}
                                </div>
                            </div>
                        ) : entityType ? (
                            <div className="mt-1">
                                <EventEntityPicker
                                    eventAppliedType={entityType}
                                    value={(config[param] as string) || undefined}
                                    onChange={(id) => onConfigChange(param, id ?? '')}
                                    instituteId={instituteId}
                                />
                            </div>
                        ) : hasUpstream ? (
                            <VariablePicker
                                value={(config[param] as string) ?? ''}
                                onChange={(v) => onConfigChange(param, v)}
                                placeholder={t('common.pickOrTypeValueFor', { param })}
                                nodeId={nodeId}
                            />
                        ) : (
                            <Input
                                value={(config[param] as string) ?? ''}
                                onChange={(e) => onConfigChange(param, e.target.value)}
                                className="mt-1"
                                placeholder={t('common.enterParam', { param })}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export function NodeConfigPanel() {
    const { t } = useTranslation('workflowNodeConfigPanel');
    const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId);
    const nodes = useWorkflowBuilderStore((s) => s.nodes);
    const edges = useWorkflowBuilderStore((s) => s.edges);
    const updateNodeConfig = useWorkflowBuilderStore((s) => s.updateNodeConfig);
    const updateNodeName = useWorkflowBuilderStore((s) => s.updateNodeName);
    const removeNode = useWorkflowBuilderStore((s) => s.removeNode);
    const selectNode = useWorkflowBuilderStore((s) => s.selectNode);
    const triggerConfig = useWorkflowBuilderStore((s) => s.triggerConfig);

    // Fetch institute data for template queries
    const { data: instituteData } = useSuspenseQuery(useInstituteQuery());
    const instituteId = instituteData?.id ?? '';

    // Fetch catalog data
    const { data: queryKeys } = useQuery(getQueryKeysQuery());
    const { data: triggerEvents } = useQuery(getTriggerEventsCatalogQuery());
    const { data: emailTemplatesUpper } = useQuery(getTemplatesByTypeQuery(instituteId, 'EMAIL'));
    const { data: emailTemplatesLower } = useQuery(getTemplatesByTypeQuery(instituteId, 'email'));
    const emailTemplates = [...(emailTemplatesUpper ?? []), ...(emailTemplatesLower ?? [])];
    const { data: whatsappTemplatesUpper } = useQuery(getTemplatesByTypeQuery(instituteId, 'WHATSAPP'));
    const { data: whatsappTemplatesLower } = useQuery(getTemplatesByTypeQuery(instituteId, 'whatsapp'));
    const whatsappTemplates = [...(whatsappTemplatesUpper ?? []), ...(whatsappTemplatesLower ?? [])];
    const { statuses: leadStatuses } = useLeadStatuses();
    const { campaigns: aiCampaigns, defaultProvider: aiDefaultProvider } = useAiCampaignOptions();

    const selectedNode = nodes.find((n) => n.id === selectedNodeId);

    if (!selectedNode) {
        return (
            <div className="flex h-full items-center justify-center p-4 text-sm text-gray-400">
                {t('common.selectANode')}
            </div>
        );
    }

    const data = selectedNode.data as {
        name: string;
        nodeType: string;
        config: Record<string, unknown>;
    };
    const nodeMeta = WORKFLOW_NODE_TYPES.find((t) => t.type === data.nodeType);

    const handleConfigChange = (key: string, value: unknown) => {
        updateNodeConfig(selectedNode.id, { ...data.config, [key]: value });
    };

    // Derived values for catalog lookups
    const selectedQueryKey = queryKeys?.find((q) => q.key === (data.config.prebuiltKey as string));
    const selectedTriggerEvent = triggerEvents?.find((e) => e.key === (data.config.triggerEvent as string));

    return (
        <div className="flex h-full flex-col overflow-y-auto">
            <div className="flex items-center justify-between border-b p-3">
                <div className="flex items-center gap-2">
                    <span className="text-lg">{nodeMeta?.icon ?? '?'}</span>
                    <span className="text-sm font-semibold">
                        {nodeMeta?.label ?? data.nodeType}
                    </span>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => selectNode(null)}
                >
                    <X size={16} />
                </Button>
            </div>

            <div className="flex flex-col gap-4 p-4">
                {/* Show validation issues */}
                {(() => {
                    const issues = getNodeIssues(data.nodeType, data.config ?? {});
                    return issues.length > 0 ? (
                        <div className="rounded-lg border border-orange-200 bg-orange-50 p-2.5 space-y-1">
                            {issues.map((issue, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-xs text-orange-700">
                                    <Warning size={12} weight="fill" className="shrink-0" />
                                    {issue}
                                </div>
                            ))}
                        </div>
                    ) : null;
                })()}

                <div>
                    <Label className="text-xs">{t('common.nodeName')}</Label>
                    <Input
                        value={data.name}
                        onChange={(e) =>
                            updateNodeName(selectedNode.id, e.target.value)
                        }
                        className="mt-1"
                        placeholder={t('common.nodeNamePlaceholder')}
                    />
                </div>

                {/* Trigger-specific config — upgraded with catalog dropdown */}
                {data.nodeType === 'TRIGGER' && (
                    <div>
                        <Label className="text-xs">{t('trigger.triggerEvent')}</Label>
                        <select
                            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={(data.config.triggerEvent as string) ?? ''}
                            onChange={(e) =>
                                handleConfigChange('triggerEvent', e.target.value)
                            }
                        >
                            <option value="">{t('trigger.selectEvent')}</option>
                            {triggerEvents?.map((ev) => (
                                <option key={ev.key} value={ev.key}>
                                    {ev.label}
                                </option>
                            ))}
                        </select>
                        {selectedTriggerEvent && (
                            <p className="mt-1 text-[10px] text-gray-400">{selectedTriggerEvent.description}</p>
                        )}
                        <TriggerScopeSection instituteId={instituteId} />
                    </div>
                )}

                {/* Email node config — smart UI, no SpEL needed for common cases */}
                {data.nodeType === 'SEND_EMAIL' && (() => {
                    // Auto-detect available data sources from upstream nodes
                    const upstreamNodes = nodes.filter((n) => {
                        // Find nodes that have an edge pointing to this node
                        return edges.some((e) => e.target === selectedNode.id && e.source === n.id);
                    });

                    // Build data source options based on upstream node types
                    const dataSources: Array<{ label: string; value: string; description: string }> = [];

                    for (const upstream of upstreamNodes) {
                        const uType = upstream.data?.nodeType;
                        const uConfig = upstream.data?.config as Record<string, unknown> | undefined;

                        if (uType === 'TRIGGER') {
                            dataSources.push(
                                { label: t('email.respondentEmails'), value: "#ctx['respondentEmailRequests']", description: t('email.respondentEmailsDesc') },
                                { label: t('email.adminEmails'), value: "#ctx['adminEmailRequests']", description: t('email.adminEmailsDesc') },
                            );
                        }
                        if (uType === 'QUERY') {
                            const queryKey = uConfig?.prebuiltKey as string;
                            if (queryKey === 'fetch_audience_responses_filtered') {
                                dataSources.push({ label: t('email.audienceLeads'), value: "#ctx['leads']", description: t('email.audienceLeadsDesc') });
                            } else if (queryKey === 'fetch_batch_attendance_report' || queryKey === 'fetch_students_by_batch') {
                                dataSources.push({ label: t('email.students'), value: "#ctx['students']", description: t('email.studentsDesc') });
                            } else if (queryKey === 'fetch_ssigm_by_package' || queryKey === 'getSSIGMByStatusAndPackageSessionIds') {
                                dataSources.push({ label: t('email.enrolledStudents'), value: "#ctx['ssigm_list']", description: t('email.enrolledStudentsDesc') });
                            } else if (queryKey) {
                                dataSources.push({ label: t('email.queryResults', { queryKey }), value: "#ctx['queryResult']", description: t('email.queryResultsDesc') });
                            }
                        }
                    }

                    // Always offer manual entry as fallback
                    const currentOn = (data.config.on as string) ?? '';

                    return (
                        <>
                            {/* Send to — smart dropdown */}
                            <div>
                                <Label className="text-xs">{t('email.sendEmailsTo')}</Label>
                                {dataSources.length > 0 ? (
                                    <>
                                        <select
                                            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                            value={currentOn}
                                            onChange={(e) => {
                                                // Set both on AND forEach in a single update to avoid race condition
                                                updateNodeConfig(selectedNode.id, {
                                                    ...data.config,
                                                    on: e.target.value,
                                                    forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                                                });
                                            }}
                                        >
                                            <option value="">{t('email.selectDataSource')}</option>
                                            {dataSources.map((ds) => (
                                                <option key={ds.value} value={ds.value}>{ds.label}</option>
                                            ))}
                                        </select>
                                        {/* Show description of selected source */}
                                        {currentOn && (() => {
                                            const selected = dataSources.find((ds) => ds.value === currentOn);
                                            return selected ? (
                                                <p className="mt-1 text-[10px] text-gray-400">{selected.description}</p>
                                            ) : (
                                                <p className="mt-1 text-[10px] text-gray-400 font-mono">{currentOn}</p>
                                            );
                                        })()}
                                    </>
                                ) : (
                                    <>
                                        <p className="mt-1 text-[10px] text-gray-400 mb-1.5">
                                            {t('email.connectUpstreamData')}
                                        </p>
                                        <VariablePicker
                                            value={currentOn}
                                            onChange={(v) => {
                                                updateNodeConfig(selectedNode.id, {
                                                    ...data.config,
                                                    on: v,
                                                    forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
                                                });
                                            }}
                                            placeholder={t('email.pickRecipients')}
                                            nodeId={selectedNode.id}
                                        />
                                    </>
                                )}
                            </div>

                            {/* Email template */}
                            <div>
                                <Label className="text-xs">{t('email.emailTemplate')} <span className="text-gray-300 text-[10px]">{t('email.emailTemplateOptional')}</span></Label>
                                <TemplateSearchableSelect
                                    className="mt-1"
                                    options={toTemplateOptions(emailTemplates ?? [])}
                                    value={(data.config.templateName as string) || '__none__'}
                                    onChange={(selected) => {
                                        const templateName = selected === '__none__' ? '' : selected;
                                        const tmpl = emailTemplates?.find((t) => t.name === templateName);
                                        let templateParams = null;
                                        if (tmpl?.dynamic_parameters) {
                                            try { templateParams = JSON.parse(tmpl.dynamic_parameters); } catch { /* ignore */ }
                                        }
                                        updateNodeConfig(selectedNode.id, {
                                            ...data.config,
                                            templateName,
                                            _templateParams: templateParams,
                                        });
                                    }}
                                    placeholder={t('email.noTemplatePlaceholder')}
                                    emptyText={t('email.noTemplateSearchEmpty')}
                                    noneOption={{
                                        value: '__none__',
                                        label: t('email.noTemplatePlaceholder'),
                                    }}
                                />
                            </div>

                            {/* Recipient email field — for choosing which email to send to */}
                            <div>
                                <Label className="text-xs">{t('email.sendToField')} <span className="text-gray-300 text-[10px]">{t('email.sendToFieldHint')}</span></Label>
                                <select
                                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={(data.config.recipientField as string) ?? ''}
                                    onChange={(e) => handleConfigChange('recipientField', e.target.value)}
                                >
                                    <option value="">{t('email.autoDetectToEmail')}</option>
                                    <option value="email">{t('email.studentEmail')}</option>
                                    <option value="parentsEmail">{t('email.fatherParentEmail')}</option>
                                    <option value="guardianEmail">{t('email.guardianEmail')}</option>
                                    <option value="motherEmail">{t('email.motherEmail')}</option>
                                    <option value="to">{t('email.toPrebuiltRecipient')}</option>
                                </select>
                            </div>

                            {/* Template variables — only shown when a template is selected */}
                            {data.config._templateParams && typeof data.config._templateParams === 'object' && (() => {
                                // Determine available fields based on data source
                                const onExpr = (data.config.on as string) ?? '';
                                const FIELD_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
                                    "#ctx['respondentEmailRequests']": [
                                        { value: 'to', label: t('email.field.recipientEmail') },
                                        { value: 'subject', label: t('email.field.emailSubject') },
                                        // customFields are checked separately
                                    ],
                                    "#ctx['leads']": [
                                        { value: 'email', label: t('email.field.email') },
                                        { value: 'parentEmail', label: t('email.field.parentEmail') },
                                        { value: 'parentName', label: t('email.field.parentName') },
                                        { value: 'mobileNumber', label: t('email.field.mobileNumber') },
                                        { value: 'userId', label: t('email.field.userId') },
                                    ],
                                    "#ctx['students']": [
                                        { value: 'fullName', label: t('email.field.studentName') },
                                        { value: 'email', label: t('email.field.studentEmail') },
                                        { value: 'mobileNumber', label: t('email.field.mobileNumber') },
                                        { value: 'enrollmentNumber', label: t('email.field.enrollmentNumber') },
                                        { value: 'attendancePercentage', label: t('email.field.attendancePercentage') },
                                        { value: 'totalDurationMinutes', label: t('email.field.totalDuration') },
                                        { value: 'totalChats', label: t('email.field.chatCount') },
                                        { value: 'totalHandRaises', label: t('email.field.handRaiseCount') },
                                        { value: 'sessionsAttended', label: t('email.field.sessionsAttended') },
                                        { value: 'parentsEmail', label: t('email.field.parentEmail') },
                                        { value: 'guardianEmail', label: t('email.guardianEmail') },
                                        { value: 'startDate', label: t('email.field.reportStartDate') },
                                        { value: 'endDate', label: t('email.field.reportEndDate') },
                                    ],
                                    "#ctx['ssigm_list']": [
                                        { value: 'full_name', label: t('email.field.fullName') },
                                        { value: 'email', label: t('email.field.email') },
                                        { value: 'mobile_number', label: t('email.field.mobileNumber') },
                                        { value: 'user_id', label: t('email.field.userId') },
                                        { value: 'username', label: t('email.field.username') },
                                        { value: 'package_session_id', label: t('email.field.batchId') },
                                    ],
                                };
                                // SpEL context fields (available for all trigger types).
                                // Grouped by source so the dropdown is readable when there are many.
                                const CONTEXT_FIELDS = [
                                    // Institute (always populated by the engine)
                                    { value: "#ctx['instituteName']", label: t('email.context.instituteName') },
                                    { value: "#ctx['instituteId']", label: t('email.context.instituteId') },

                                    // User fields — populated for LEARNER_BATCH_ENROLLMENT and other
                                    // user-centric triggers. Bracket-style for `user` (it's a UserDTO
                                    // bean, so SpEL bean accessor resolves the property).
                                    { value: "#ctx['user'].username", label: t('email.context.learnerUsername') },
                                    { value: "#ctx['user'].password", label: t('email.context.learnerPassword') },
                                    { value: "#ctx['user'].fullName", label: t('email.context.learnerFullName') },
                                    { value: "#ctx['user'].email", label: t('email.context.learnerEmail') },
                                    { value: "#ctx['user'].mobileNumber", label: t('email.context.learnerMobile') },

                                    // Live session fields (LIVE_SESSION_* triggers)
                                    { value: "#ctx['liveSession'].title", label: t('email.context.liveSessionTitle') },
                                    { value: "#ctx['liveSession'].startTime", label: t('email.context.sessionStartTime') },
                                    { value: "#ctx['liveSession'].defaultMeetLink", label: t('email.context.sessionMeetLink') },

                                    // Audience / campaign fields
                                    { value: "#ctx['campaignName']", label: t('email.context.campaignName') },
                                    { value: "#ctx['submissionTime']", label: t('email.context.submissionTime') },
                                ];

                                const availableFields = FIELD_OPTIONS[onExpr] ?? [];
                                // Also check if any custom field names might apply (from audience triggers)
                                const hasCustomFieldsContext = onExpr.includes('respondentEmailRequests') || onExpr.includes('leads');

                                return (
                                    <div className="space-y-2 border-t pt-2 mt-2">
                                        <Label className="text-[10px] uppercase text-gray-400">{t('common.templateVariables')}</Label>
                                        <p className="text-[10px] text-gray-400">
                                            {t('email.templateVariablesHint')}
                                        </p>
                                        {Object.entries(data.config._templateParams as Record<string, string>).map(([key, label]) => {
                                            const currentValue = ((data.config.templateVars as Record<string, string>)?.[key]) ?? '';
                                            return (
                                                <div key={key}>
                                                    <Label className="text-xs">{`{{${key}}}`} <span className="text-gray-400 text-[10px]">({label || key})</span></Label>
                                                    {/* Always render the dropdown so triggers without a list (e.g. LEARNER_BATCH_ENROLLMENT)
                                                        still get to pick from CONTEXT_FIELDS. The Item Fields optgroup is only
                                                        rendered when the node iterates a list (`on` is set). */}
                                                    <select
                                                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                        value={currentValue}
                                                        onChange={(e) => {
                                                            const vars = { ...(data.config.templateVars as Record<string, string> ?? {}), [key]: e.target.value };
                                                            handleConfigChange('templateVars', vars);
                                                        }}
                                                    >
                                                        <option value="">{t('email.selectAField')}</option>
                                                        {availableFields.length > 0 && (
                                                            <optgroup label={t('email.itemFieldsGroup')}>
                                                                {availableFields.map((f) => (
                                                                    <option key={f.value} value={f.value}>{f.label} ({f.value})</option>
                                                                ))}
                                                            </optgroup>
                                                        )}
                                                        <optgroup label={t('email.contextFieldsGroup')}>
                                                            {CONTEXT_FIELDS.map((f) => (
                                                                <option key={f.value} value={f.value}>{f.label}</option>
                                                            ))}
                                                        </optgroup>
                                                        {hasCustomFieldsContext && (
                                                            <optgroup label={t('email.customFieldsGroup')}>
                                                                <option value="" disabled>{t('email.typeCustomFieldBelow')}</option>
                                                            </optgroup>
                                                        )}
                                                    </select>
                                                    {/* Allow manual override if dropdown value doesn't fit */}
                                                    {availableFields.length > 0 && !availableFields.some((f) => f.value === currentValue) && currentValue && (
                                                        <p className="mt-0.5 text-[10px] text-primary-500">{t('email.customValue', { value: currentValue })}</p>
                                                    )}
                                                    {hasCustomFieldsContext && (
                                                        <Input
                                                            value={currentValue.startsWith('#') || availableFields.some((f) => f.value === currentValue) ? '' : currentValue}
                                                            onChange={(e) => {
                                                                if (e.target.value) {
                                                                    const vars = { ...(data.config.templateVars as Record<string, string> ?? {}), [key]: e.target.value };
                                                                    handleConfigChange('templateVars', vars);
                                                                }
                                                            }}
                                                            className="mt-1"
                                                            placeholder={t('email.customFieldPlaceholder')}
                                                        />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </>
                    );
                })()}

                {/* WhatsApp node config — upgraded with template dropdown + smart recipients */}
                {data.nodeType === 'SEND_WHATSAPP' && (() => {
                    // Auto-detect data sources with a mobile number from upstream nodes
                    const upstreamNodes = nodes.filter((n) =>
                        edges.some((e) => e.target === selectedNode.id && e.source === n.id)
                    );
                    const whatsappDataSources: Array<{ label: string; value: string; description: string }> = [];
                    for (const upstream of upstreamNodes) {
                        const uType = upstream.data?.nodeType;
                        const uConfig = upstream.data?.config as Record<string, unknown> | undefined;
                        if (uType === 'TRIGGER') {
                            whatsappDataSources.push({
                                label: t('whatsapp.leadSubmitter'),
                                value: "{#ctx['user']}",
                                description: t('whatsapp.leadSubmitterDesc'),
                            });
                        }
                        if (uType === 'QUERY') {
                            const queryKey = uConfig?.prebuiltKey as string;
                            if (queryKey === 'fetch_audience_responses_filtered') {
                                whatsappDataSources.push({ label: t('whatsapp.audienceLeads'), value: "#ctx['leads']", description: t('whatsapp.audienceLeadsDesc') });
                            } else if (queryKey === 'fetch_batch_attendance_report' || queryKey === 'fetch_students_by_batch') {
                                whatsappDataSources.push({ label: t('whatsapp.students'), value: "#ctx['students']", description: t('whatsapp.studentsDesc') });
                            } else if (queryKey === 'fetch_ssigm_by_package' || queryKey === 'getSSIGMByStatusAndPackageSessionIds') {
                                whatsappDataSources.push({ label: t('whatsapp.enrolledStudents'), value: "#ctx['ssigm_list']", description: t('whatsapp.enrolledStudentsDesc') });
                            } else if (queryKey) {
                                whatsappDataSources.push({ label: t('whatsapp.queryResults', { queryKey }), value: "#ctx['queryResult']", description: t('whatsapp.queryResultsDesc') });
                            }
                        }
                    }
                    const currentOn = (data.config.on as string) ?? '';
                    // Messaging leads — the lead who just submitted a form, or a follow-up
                    // over a list's leads — gets the same variable pickers as the lead
                    // list's "Configure workflow" dialog: lead details, form fields, text.
                    const leadContext = leadMessagingContext(currentOn, triggerConfig, nodes);
                    // Nodes saved without _templateParams (older dialogs, hand-made) still
                    // show their placeholders — read them off the template itself.
                    const selectedWhatsappTemplate = whatsappTemplates.find(
                        (tpl) => tpl.name === (data.config.templateName as string)
                    );
                    const storedTemplateParams =
                        data.config._templateParams && typeof data.config._templateParams === 'object'
                            ? (data.config._templateParams as Record<string, string>)
                            : null;
                    const templateParams =
                        storedTemplateParams && Object.keys(storedTemplateParams).length > 0
                            ? storedTemplateParams
                            : whatsappTemplateParamSpec(selectedWhatsappTemplate);
                    return (
                    <>
                        <div>
                            <Label className="text-xs">{t('whatsapp.template')}</Label>
                            <TemplateSearchableSelect
                                className="mt-1"
                                options={toTemplateOptions(whatsappTemplates ?? [])}
                                value={(data.config.templateName as string) ?? ''}
                                onChange={(templateName) => {
                                    const tmpl = whatsappTemplates?.find((t) => t.name === templateName);
                                    let templateParams = null;
                                    if (tmpl?.dynamic_parameters) {
                                        try { templateParams = JSON.parse(tmpl.dynamic_parameters); } catch { /* ignore */ }
                                    }
                                    updateNodeConfig(selectedNode.id, {
                                        ...data.config,
                                        templateName,
                                        forEach: { operation: 'SEND_WHATSAPP', eval: "#ctx['item']" },
                                        _templateParams: templateParams,
                                    });
                                }}
                                placeholder={t('whatsapp.selectTemplate')}
                                emptyText={t('whatsapp.noTemplateSearchEmpty')}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('whatsapp.sendTo')}</Label>
                            {whatsappDataSources.length > 0 ? (
                                <>
                                    <select
                                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                        value={currentOn}
                                        onChange={(e) => {
                                            updateNodeConfig(selectedNode.id, {
                                                ...data.config,
                                                on: e.target.value,
                                                forEach: { operation: 'SEND_WHATSAPP', eval: "#ctx['item']" },
                                            });
                                        }}
                                    >
                                        <option value="">{t('whatsapp.selectRecipients')}</option>
                                        {whatsappDataSources.map((ds) => (
                                            <option key={ds.value} value={ds.value}>{ds.label}</option>
                                        ))}
                                    </select>
                                    {currentOn && (() => {
                                        const selected = whatsappDataSources.find((ds) => ds.value === currentOn);
                                        return selected ? (
                                            <p className="mt-1 text-[10px] text-gray-400">{selected.description}</p>
                                        ) : (
                                            <p className="mt-1 text-[10px] text-gray-400 font-mono">{currentOn}</p>
                                        );
                                    })()}
                                </>
                            ) : (
                                <>
                                    <p className="mt-1 text-[10px] text-gray-400 mb-1.5">
                                        {t('whatsapp.connectUpstreamRecipients')}
                                    </p>
                                    <VariablePicker
                                        value={currentOn}
                                        onChange={(v) => {
                                            updateNodeConfig(selectedNode.id, {
                                                ...data.config,
                                                on: v,
                                                forEach: { operation: 'SEND_WHATSAPP', eval: "#ctx['item']" },
                                            });
                                        }}
                                        placeholder={t('email.pickRecipients')}
                                        nodeId={selectedNode.id}
                                    />
                                </>
                            )}
                        </div>
                        {/* Dynamic template parameters */}
                        {leadContext ? (
                            <LeadWhatsappVariables
                                key={selectedNode.id}
                                config={data.config}
                                onConfigChange={(config) => updateNodeConfig(selectedNode.id, config)}
                                kind={leadContext.kind}
                                audienceId={leadContext.audienceId}
                                instituteId={instituteId}
                                templates={whatsappTemplates}
                            />
                        ) : Object.keys(templateParams).length > 0 && (
                            <div className="space-y-2 border-t pt-2 mt-2">
                                <Label className="text-[10px] uppercase text-gray-400">{t('common.templateVariables')}</Label>
                                {Object.entries(templateParams).map(([key, label]) => (
                                    <div key={key}>
                                        <Label className="text-xs">{label || key}</Label>
                                        <VariablePicker
                                            value={((data.config.templateVars as Record<string, string>)?.[key]) ?? ''}
                                            onChange={(v) => {
                                                const vars = { ...(data.config.templateVars as Record<string, string> ?? {}), [key]: v };
                                                handleConfigChange('templateVars', vars);
                                            }}
                                            placeholder={t('whatsapp.valueForField', { field: label || key })}
                                            nodeId={selectedNode.id}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                    );
                })()}

                {/* HTTP Request config */}
                {data.nodeType === 'HTTP_REQUEST' && (() => {
                    // HTTP config is nested under 'config' key for the backend DTO
                    const httpConfig = (data.config.config as Record<string, unknown>) ?? {};
                    const updateHttpConfig = (key: string, value: unknown) => {
                        updateNodeConfig(selectedNode.id, {
                            ...data.config,
                            config: { ...httpConfig, [key]: value },
                        });
                    };

                    return (
                        <>
                            <div>
                                <Label className="text-xs">{t('http.requestType')}</Label>
                                <select
                                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={(httpConfig.requestType as string) ?? 'EXTERNAL'}
                                    onChange={(e) => updateHttpConfig('requestType', e.target.value)}
                                >
                                    <option value="EXTERNAL">{t('http.externalApi')}</option>
                                    <option value="INTERNAL">{t('http.internalService')}</option>
                                </select>
                            </div>
                            <div>
                                <Label className="text-xs">{t('http.url')}</Label>
                                <Input
                                    value={(httpConfig.url as string) ?? ''}
                                    onChange={(e) => updateHttpConfig('url', e.target.value)}
                                    className="mt-1"
                                    placeholder={
                                        (httpConfig.requestType as string) === 'INTERNAL'
                                            ? t('http.internalUrlPlaceholder')
                                            : t('http.externalUrlPlaceholder')
                                    }
                                />
                            </div>
                            <div>
                                <Label className="text-xs">{t('http.method')}</Label>
                                <select
                                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={(httpConfig.method as string) ?? 'GET'}
                                    onChange={(e) => updateHttpConfig('method', e.target.value)}
                                >
                                    <option value="GET">GET</option>
                                    <option value="POST">POST</option>
                                    <option value="PUT">PUT</option>
                                    <option value="DELETE">DELETE</option>
                                </select>
                            </div>

                            {/* Headers */}
                            <div>
                                <Label className="text-xs">{t('http.headers')} <span className="text-gray-300 text-[10px]">{t('http.optional')}</span></Label>
                                <textarea
                                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                                    rows={3}
                                    value={
                                        typeof httpConfig.headers === 'string'
                                            ? httpConfig.headers as string
                                            : JSON.stringify(httpConfig.headers ?? {}, null, 2)
                                    }
                                    onChange={(e) => {
                                        try { updateHttpConfig('headers', JSON.parse(e.target.value)); }
                                        catch { updateHttpConfig('headers', e.target.value); }
                                    }}
                                    placeholder='{"Content-Type": "application/json"}'
                                />
                            </div>

                            {/* Query Params — for GET requests */}
                            {((httpConfig.method as string) ?? 'GET') === 'GET' && (
                                <div>
                                    <Label className="text-xs">{t('http.queryParameters')} <span className="text-gray-300 text-[10px]">{t('http.optional')}</span></Label>
                                    <textarea
                                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                                        rows={3}
                                        value={
                                            typeof httpConfig.queryParams === 'string'
                                                ? httpConfig.queryParams as string
                                                : JSON.stringify(httpConfig.queryParams ?? {}, null, 2)
                                        }
                                        onChange={(e) => {
                                            try { updateHttpConfig('queryParams', JSON.parse(e.target.value)); }
                                            catch { updateHttpConfig('queryParams', e.target.value); }
                                        }}
                                        placeholder='{"userId": "123", "status": "active"}'
                                    />
                                </div>
                            )}

                            {/* Request Body — for POST/PUT */}
                            {['POST', 'PUT'].includes((httpConfig.method as string) ?? 'GET') && (
                                <div>
                                    <Label className="text-xs">{t('http.requestBody')} <span className="text-gray-300 text-[10px]">{t('http.requestBodyJson')}</span></Label>
                                    <textarea
                                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                                        rows={5}
                                        value={
                                            typeof httpConfig.body === 'string'
                                                ? httpConfig.body as string
                                                : JSON.stringify(httpConfig.body ?? {}, null, 2)
                                        }
                                        onChange={(e) => {
                                            try { updateHttpConfig('body', JSON.parse(e.target.value)); }
                                            catch { updateHttpConfig('body', e.target.value); }
                                        }}
                                        placeholder='{"email": "user@example.com"}'
                                    />
                                </div>
                            )}

                            {/* Result Key */}
                            <div>
                                <Label className="text-xs">{t('common.resultKey')}</Label>
                                <Input
                                    value={(data.config.resultKey as string) ?? 'httpResult'}
                                    onChange={(e) => handleConfigChange('resultKey', e.target.value)}
                                    className="mt-1"
                                    placeholder="httpResult"
                                />
                                <p className="mt-1 text-[10px] text-gray-400">
                                    {t('http.resultKeyHint', { resultKey: (data.config.resultKey as string) || 'httpResult' })}
                                </p>
                            </div>

                            {/* Condition — optional */}
                            <div>
                                <Label className="text-xs">{t('http.condition')} <span className="text-gray-300 text-[10px]">{t('http.conditionHint')}</span></Label>
                                <Input
                                    value={(httpConfig.condition as string) ?? ''}
                                    onChange={(e) => updateHttpConfig('condition', e.target.value)}
                                    className="mt-1"
                                    placeholder={t('http.conditionPlaceholder')}
                                />
                            </div>
                        </>
                    );
                })()}

                {/* Query node config — params nested under 'params' key for backend DTO */}
                {data.nodeType === 'QUERY' && (() => {
                    const queryParams = (data.config.params as Record<string, unknown>) ?? {};
                    const handleQueryParamChange = (key: string, value: unknown) => {
                        updateNodeConfig(selectedNode.id, {
                            ...data.config,
                            params: { ...queryParams, [key]: value },
                        });
                    };

                    return (
                    <>
                        <div>
                            <Label className="text-xs">{t('query.query')}</Label>
                            <select
                                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={(data.config.prebuiltKey as string) ?? ''}
                                onChange={(e) => handleConfigChange('prebuiltKey', e.target.value)}
                            >
                                <option value="">{t('query.selectQuery')}</option>
                                {queryKeys?.map((q) => (
                                    <option key={q.key} value={q.key}>
                                        {q.label}
                                    </option>
                                ))}
                            </select>
                            {selectedQueryKey && (
                                <p className="mt-1 text-[10px] text-gray-400">{selectedQueryKey.description}</p>
                            )}
                        </div>
                        {/* Dynamic required params — stored under params.{key} */}
                        <QueryRequiredParams
                            params={selectedQueryKey?.required_params ?? []}
                            config={queryParams}
                            onConfigChange={handleQueryParamChange}
                            nodeId={selectedNode.id}
                            instituteId={instituteId}
                            edges={edges}
                            nodes={nodes}
                            selectedNodeId={selectedNode.id}
                        />
                        {/* Optional params from catalog — also stored under params.{key} */}
                        {selectedQueryKey?.optional_params && selectedQueryKey.optional_params.length > 0 && (
                            <div className="space-y-2 border-t pt-2 mt-2">
                                <Label className="text-[10px] uppercase text-gray-400">{t('query.optionalFilters')}</Label>
                                {selectedQueryKey.optional_params.map((param) => {
                                    const entityTypeMap: Record<string, string> = {
                                        audienceId: 'AUDIENCE',
                                        batchId: 'PACKAGE_SESSION',
                                        liveSessionId: 'LIVE_SESSION',
                                        inviteId: 'ENROLL_INVITE',
                                    };
                                    const entityType = entityTypeMap[param];

                                    return (
                                        <div key={param}>
                                            <Label className="text-xs text-gray-500">{param} <span className="text-gray-300">{t('query.optional')}</span></Label>
                                            {entityType ? (
                                                <div className="mt-1">
                                                    <EventEntityPicker
                                                        eventAppliedType={entityType}
                                                        value={(queryParams[param] as string) || undefined}
                                                        onChange={(id) => handleQueryParamChange(param, id ?? '')}
                                                        instituteId={instituteId}
                                                    />
                                                </div>
                                            ) : (
                                                <Input
                                                    value={(queryParams[param] as string) ?? ''}
                                                    onChange={(e) => handleQueryParamChange(param, e.target.value)}
                                                    className="mt-1"
                                                    placeholder={
                                                        param === 'daysAgo' || param === 'daysBack' ? 'e.g. 5'
                                                        : param === 'daysUntilExpiry' ? 'e.g. 7'
                                                        : param === 'status' ? 'e.g. ACTIVE'
                                                        : param.includes('Date') ? 'YYYY-MM-DD'
                                                        : t('common.enterParam', { param })
                                                    }
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <div>
                            <Label className="text-xs">{t('common.resultKey')}</Label>
                            <Input
                                value={(data.config.resultKey as string) ?? 'queryResult'}
                                onChange={(e) => handleConfigChange('resultKey', e.target.value)}
                                className="mt-1"
                                placeholder="queryResult"
                            />
                        </div>
                    </>
                    );
                })()}

                {/* Delay node config — saves as config.delay.{value,unit} (fixed) or
                    config.delay.{until:NEXT_DAY_OF_WEEK,dayOfWeek,time,timezone} to match backend */}
                {data.nodeType === 'DELAY' && (() => {
                    const delay =
                        (data.config.delay as {
                            value?: number;
                            unit?: string;
                            until?: string;
                            dayOfWeek?: string;
                            time?: string;
                            timezone?: string;
                        }) ?? {};
                    const isUntilWeekday = delay.until === 'NEXT_DAY_OF_WEEK';
                    // Backward compat: read from flat keys if nested doesn't exist
                    const delayValue = delay.value ?? (data.config.delayValue as number) ?? 5;
                    const delayUnit = delay.unit ?? (data.config.delayUnit as string) ?? 'MINUTES';
                    const updateDelay = (field: string, val: unknown) => {
                        handleConfigChange('delay', { ...delay, value: delayValue, unit: delayUnit, [field]: val });
                    };
                    const updateUntil = (field: string, val: unknown) => {
                        handleConfigChange('delay', {
                            until: 'NEXT_DAY_OF_WEEK',
                            dayOfWeek: delay.dayOfWeek ?? 'MONDAY',
                            time: delay.time ?? '09:00',
                            timezone: delay.timezone ?? 'Asia/Kolkata',
                            [field]: val,
                        });
                    };
                    return (
                        <>
                            <div>
                                <Label className="text-xs">{t('delay.waitMode')}</Label>
                                <select
                                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={isUntilWeekday ? 'UNTIL_WEEKDAY' : 'FIXED'}
                                    onChange={(e) => {
                                        if (e.target.value === 'UNTIL_WEEKDAY') {
                                            handleConfigChange('delay', {
                                                until: 'NEXT_DAY_OF_WEEK',
                                                dayOfWeek: delay.dayOfWeek ?? 'MONDAY',
                                                time: delay.time ?? '09:00',
                                                timezone: delay.timezone ?? 'Asia/Kolkata',
                                            });
                                        } else {
                                            handleConfigChange('delay', { value: delayValue, unit: delayUnit });
                                        }
                                    }}
                                >
                                    <option value="FIXED">{t('delay.fixedDuration')}</option>
                                    <option value="UNTIL_WEEKDAY">{t('delay.untilNextWeekday')}</option>
                                </select>
                            </div>
                            {!isUntilWeekday && (
                                <div>
                                    <Label className="text-xs">{t('delay.waitFor')}</Label>
                                    <div className="mt-1 flex items-center gap-2">
                                        <Input
                                            type="number"
                                            value={delayValue}
                                            onChange={(e) => updateDelay('value', parseInt(e.target.value) || 0)}
                                            className="w-20"
                                            min={0}
                                        />
                                        <select
                                            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                            value={delayUnit}
                                            onChange={(e) => updateDelay('unit', e.target.value)}
                                        >
                                            <option value="SECONDS">{t('delay.unit.seconds')}</option>
                                            <option value="MINUTES">{t('delay.unit.minutes')}</option>
                                            <option value="HOURS">{t('delay.unit.hours')}</option>
                                            <option value="DAYS">{t('delay.unit.days')}</option>
                                        </select>
                                    </div>
                                    {delayUnit === 'DAYS' && delayValue > 0 && (
                                        <p className="mt-1.5 text-caption text-primary-500">
                                            {t('delay.pauseResumeAfter', { count: delayValue })}
                                        </p>
                                    )}
                                </div>
                            )}
                            {isUntilWeekday && (
                                <>
                                    <div>
                                        <Label className="text-xs">{t('delay.waitUntilNext')}</Label>
                                        <div className="mt-1 flex items-center gap-2">
                                            <select
                                                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                value={delay.dayOfWeek ?? 'MONDAY'}
                                                onChange={(e) => updateUntil('dayOfWeek', e.target.value)}
                                            >
                                                <option value="MONDAY">{t('delay.day.monday')}</option>
                                                <option value="TUESDAY">{t('delay.day.tuesday')}</option>
                                                <option value="WEDNESDAY">{t('delay.day.wednesday')}</option>
                                                <option value="THURSDAY">{t('delay.day.thursday')}</option>
                                                <option value="FRIDAY">{t('delay.day.friday')}</option>
                                                <option value="SATURDAY">{t('delay.day.saturday')}</option>
                                                <option value="SUNDAY">{t('delay.day.sunday')}</option>
                                            </select>
                                            <Input
                                                type="time"
                                                value={delay.time ?? '09:00'}
                                                onChange={(e) => updateUntil('time', e.target.value)}
                                                className="w-28"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <Label className="text-xs">{t('delay.timezone')}</Label>
                                        <Input
                                            value={delay.timezone ?? 'Asia/Kolkata'}
                                            onChange={(e) => updateUntil('timezone', e.target.value)}
                                            className="mt-1"
                                            placeholder="Asia/Kolkata"
                                        />
                                        <p className="mt-1.5 text-caption text-primary-500">
                                            {t('delay.pausesUntil', {
                                                day: t(`delay.day.${(delay.dayOfWeek ?? 'MONDAY').toLowerCase()}`),
                                                time: delay.time ?? '09:00',
                                            })}
                                        </p>
                                    </div>
                                </>
                            )}
                        </>
                    );
                })()}

                {/* Filter node config — Visual Condition Builder in item mode */}
                {data.nodeType === 'FILTER' && (
                    <>
                        <div>
                            <Label className="text-xs">{t('common.sourceList')}</Label>
                            <VariablePicker
                                value={(data.config.source as string) ?? ''}
                                onChange={(v) => handleConfigChange('source', v)}
                                placeholder={t('filter.pickListToFilter')}
                                nodeId={selectedNode.id}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('filter.keepItemsWhere')}</Label>
                            <div className="mt-1.5">
                                <ConditionBuilder
                                    value={(data.config.condition as string) ?? ''}
                                    onChange={(v) => handleConfigChange('condition', v)}
                                    nodeId={selectedNode.id}
                                    itemMode
                                />
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs">{t('filter.saveFilteredListAs')}</Label>
                            <Input
                                value={(data.config.outputKey as string) ?? 'filteredList'}
                                onChange={(e) => handleConfigChange('outputKey', e.target.value)}
                                className="mt-1"
                                placeholder="filteredList"
                            />
                        </div>
                    </>
                )}

                {/* Aggregate node config — Visual Operation Builder */}
                {data.nodeType === 'AGGREGATE' && (
                    <>
                        <div>
                            <Label className="text-xs">{t('common.sourceList')}</Label>
                            <VariablePicker
                                value={(data.config.source as string) ?? ''}
                                onChange={(v) => handleConfigChange('source', v)}
                                placeholder={t('aggregate.pickListToAggregate')}
                                nodeId={selectedNode.id}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('aggregate.operations')}</Label>
                            <div className="mt-1.5">
                                <AggregateBuilder
                                    value={(data.config.operations as Array<{ type: string; field?: string; outputKey: string }>) ?? []}
                                    onChange={(ops) => handleConfigChange('operations', ops)}
                                />
                            </div>
                        </div>
                    </>
                )}

                {/* Condition (If/Else) node config — Visual Condition Builder */}
                {data.nodeType === 'CONDITION' && (
                    <>
                        <div>
                            <Label className="text-xs">{t('http.condition')}</Label>
                            <div className="mt-1.5">
                                <ConditionBuilder
                                    value={(data.config.condition as string) ?? ''}
                                    onChange={(v) => handleConfigChange('condition', v)}
                                    nodeId={selectedNode.id}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <Label className="text-xs">{t('condition.trueLabel')}</Label>
                                <Input
                                    value={(data.config.trueLabel as string) ?? 'Yes'}
                                    onChange={(e) => handleConfigChange('trueLabel', e.target.value)}
                                    className="mt-1"
                                    placeholder="Yes"
                                />
                            </div>
                            <div>
                                <Label className="text-xs">{t('condition.falseLabel')}</Label>
                                <Input
                                    value={(data.config.falseLabel as string) ?? 'No'}
                                    onChange={(e) => handleConfigChange('falseLabel', e.target.value)}
                                    className="mt-1"
                                    placeholder="No"
                                />
                            </div>
                        </div>
                    </>
                )}

                {/* Loop (forEach) node config */}
                {data.nodeType === 'LOOP' && (
                    <>
                        <div>
                            <Label className="text-xs">{t('loop.sourceExpression')}</Label>
                            <VariablePicker
                                value={(data.config.source as string) ?? ''}
                                onChange={(v) => handleConfigChange('source', v)}
                                placeholder={t('loop.pickListVariable')}
                                nodeId={selectedNode.id}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('loop.itemVariableName')}</Label>
                            <Input
                                value={(data.config.itemVariable as string) ?? 'item'}
                                onChange={(e) => handleConfigChange('itemVariable', e.target.value)}
                                className="mt-1"
                                placeholder="item"
                            />
                            <p className="mt-1 text-[10px] text-gray-400">
                                {t('loop.itemVariableHint')}
                            </p>
                        </div>
                        <div>
                            <Label className="text-xs">{t('loop.outputKey')}</Label>
                            <Input
                                value={(data.config.outputKey as string) ?? 'loopResults'}
                                onChange={(e) => handleConfigChange('outputKey', e.target.value)}
                                className="mt-1"
                                placeholder="loopResults"
                            />
                        </div>
                    </>
                )}

                {/* Merge node config */}
                {data.nodeType === 'MERGE' && (
                    <>
                        <div>
                            <Label className="text-xs">{t('merge.waitForNodeIds')}</Label>
                            <Input
                                value={(data.config.waitFor as string) ?? ''}
                                onChange={(e) => handleConfigChange('waitFor', e.target.value)}
                                className="mt-1"
                                placeholder="node-id-1, node-id-2"
                            />
                            <p className="mt-1 text-[10px] text-gray-400">
                                {t('merge.waitForHint')}
                            </p>
                        </div>
                        <div>
                            <Label className="text-xs">{t('merge.strategy')}</Label>
                            <select
                                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={(data.config.strategy as string) ?? 'ALL'}
                                onChange={(e) => handleConfigChange('strategy', e.target.value)}
                            >
                                <option value="ALL">{t('merge.waitAll')}</option>
                                <option value="ANY">{t('merge.waitAny')}</option>
                            </select>
                        </div>
                    </>
                )}

                {/* Schedule Task node config */}
                {data.nodeType === 'SCHEDULE_TASK' && (
                    <>
                        <div>
                            <Label className="text-xs">{t('scheduleTask.delayDuration')}</Label>
                            <Input
                                value={(data.config.delayDuration as string) ?? 'PT1H'}
                                onChange={(e) => handleConfigChange('delayDuration', e.target.value)}
                                className="mt-1"
                                placeholder="PT1H, P3D, PT30M"
                            />
                            <p className="mt-1 text-[10px] text-gray-400">
                                {t('scheduleTask.delayDurationHint')}
                            </p>
                        </div>
                        <div>
                            <Label className="text-xs">{t('scheduleTask.targetWorkflowId')}</Label>
                            <Input
                                value={(data.config.workflowId as string) ?? ''}
                                onChange={(e) => handleConfigChange('workflowId', e.target.value)}
                                className="mt-1"
                                placeholder={t('scheduleTask.targetWorkflowIdPlaceholder')}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('scheduleTask.contextKeysToForward')}</Label>
                            <Input
                                value={(data.config.contextForward as string) ?? ''}
                                onChange={(e) => handleConfigChange('contextForward', e.target.value)}
                                className="mt-1"
                                placeholder="userList, instituteId"
                            />
                        </div>
                    </>
                )}

                {/* Update Record node config — Visual Key-Value Builder */}
                {data.nodeType === 'UPDATE_RECORD' && (
                    <>
                        <div>
                            <Label className="text-xs">{t('updateRecord.table')}</Label>
                            <select
                                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={(data.config.table as string) ?? ''}
                                onChange={(e) => handleConfigChange('table', e.target.value)}
                            >
                                <option value="">{t('updateRecord.selectTable')}</option>
                                <option value="enrollment">enrollment</option>
                                <option value="payment">payment</option>
                                <option value="student_session">student_session</option>
                                <option value="learner">learner</option>
                                <option value="batch_enrollment">batch_enrollment</option>
                                <option value="institute_learner">institute_learner</option>
                                <option value="sub_org_member">sub_org_member</option>
                            </select>
                        </div>
                        <div>
                            <Label className="text-xs">{t('updateRecord.findRecordsWhere')}</Label>
                            <div className="mt-1.5">
                                <KeyValueBuilder
                                    value={(data.config.where as Record<string, string>) ?? {}}
                                    onChange={(kv) => handleConfigChange('where', kv)}
                                    nodeId={selectedNode.id}
                                    keyPlaceholder={t('updateRecord.columnPlaceholder')}
                                    valuePlaceholder={t('updateRecord.matchValuePlaceholder')}
                                />
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs">{t('updateRecord.setValuesTo')}</Label>
                            <div className="mt-1.5">
                                <KeyValueBuilder
                                    value={(data.config.set as Record<string, string>) ?? {}}
                                    onChange={(kv) => handleConfigChange('set', kv)}
                                    nodeId={selectedNode.id}
                                    keyPlaceholder={t('updateRecord.columnPlaceholder')}
                                    valuePlaceholder={t('updateRecord.newValuePlaceholder')}
                                />
                            </div>
                        </div>
                    </>
                )}

                {/* Send Push Notification node config */}
                {data.nodeType === 'SEND_PUSH_NOTIFICATION' && (
                    <>
                        <div>
                            <Label className="text-xs">{t('pushNotification.title')}</Label>
                            <Input
                                value={(data.config.title as string) ?? ''}
                                onChange={(e) => handleConfigChange('title', e.target.value)}
                                className="mt-1"
                                placeholder={t('pushNotification.titlePlaceholder')}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('pushNotification.body')}</Label>
                            <textarea
                                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                rows={2}
                                value={(data.config.body as string) ?? ''}
                                onChange={(e) => handleConfigChange('body', e.target.value)}
                                placeholder={t('pushNotification.bodyPlaceholder')}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('pushNotification.recipientTokens')}</Label>
                            <VariablePicker
                                value={(data.config.recipientTokenExpression as string) ?? ''}
                                onChange={(v) => handleConfigChange('recipientTokenExpression', v)}
                                placeholder={t('pushNotification.recipientTokensPlaceholder')}
                                nodeId={selectedNode.id}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('pushNotification.dataPayload')}</Label>
                            <textarea
                                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                                rows={3}
                                value={
                                    typeof data.config.data === 'string'
                                        ? data.config.data
                                        : JSON.stringify(data.config.data ?? {}, null, 2)
                                }
                                onChange={(e) => {
                                    try {
                                        handleConfigChange('data', JSON.parse(e.target.value));
                                    } catch {
                                        handleConfigChange('data', e.target.value);
                                    }
                                }}
                            />
                        </div>
                    </>
                )}

                {/* Set Lead Status node config */}
                {data.nodeType === 'SET_LEAD_STATUS' && (
                    <div>
                        <Label className="text-xs">{t('leadStatus.label')}</Label>
                        <select
                            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={(data.config.statusKey as string) ?? ''}
                            onChange={(e) => handleConfigChange('statusKey', e.target.value)}
                        >
                            <option value="">{t('leadStatus.selectStatus')}</option>
                            {leadStatuses.map((s) => (
                                <option key={s.status_key} value={s.status_key}>
                                    {s.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* AI Call node config — pick the agent by NAME; the backend resolves
                    it to the active provider's campaign id at dial time. Vacademy AI
                    agents are authored in Settings → AI Calling → AI Agents. */}
                {data.nodeType === 'CALL_AI' && (
                    <>
                        <div>
                            <Label className="text-xs">{t('callAi.agent')}</Label>
                            <select
                                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={(data.config.campaignName as string) ?? ''}
                                onChange={(e) => handleConfigChange('campaignName', e.target.value)}
                            >
                                <option value="">{t('callAi.selectAgent')}</option>
                                {[
                                    ...new Set(
                                        aiCampaigns
                                            .map((c) => c.name)
                                            .filter(Boolean)
                                            .concat(
                                                (data.config.campaignName as string)
                                                    ? [data.config.campaignName as string]
                                                    : []
                                            )
                                    ),
                                ].map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {t('callAi.infoPrefix')}{' '}
                                <code>#ctx[&apos;callOutcome&apos;]</code> {t('callAi.infoOutcomeSuffix')}{' '}
                                <code>#ctx[&apos;callDisposition&apos;]</code> {t('callAi.infoAnd')}{' '}
                                <code>#ctx[&apos;callAnswers&apos;]</code>.
                            </p>
                        </div>
                        <div>
                            <Label className="text-xs">{t('callAi.provider')}</Label>
                            <select
                                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={(data.config.provider as string) ?? ''}
                                onChange={(e) => handleConfigChange('provider', e.target.value)}
                            >
                                <option value="">
                                    {aiDefaultProvider
                                        ? t('callAi.instituteDefaultWithProvider', { provider: aiDefaultProvider })
                                        : t('callAi.instituteDefault')}
                                </option>
                                {[...new Set(aiCampaigns.map((c) => c.provider).filter(Boolean))].map(
                                    (p) => (
                                        <option key={p} value={p}>
                                            {p}
                                        </option>
                                    )
                                )}
                            </select>
                        </div>
                        <div className="flex items-start gap-2 rounded-md border border-input p-3">
                            <input
                                id="ignore-assigned-guard"
                                type="checkbox"
                                className="mt-0.5"
                                checked={data.config.ignoreAssignedGuard === true}
                                onChange={(e) =>
                                    handleConfigChange('ignoreAssignedGuard', e.target.checked)
                                }
                            />
                            <div>
                                <Label
                                    htmlFor="ignore-assigned-guard"
                                    className="cursor-pointer text-xs"
                                >
                                    {t('callAi.ignoreAssignedGuardLabel')}
                                </Label>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {t('callAi.ignoreAssignedGuardHint')}
                                </p>
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs">{t('callAi.extraMetadata')}</Label>
                            <textarea
                                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                                rows={3}
                                value={
                                    typeof data.config.metadata === 'string'
                                        ? data.config.metadata
                                        : JSON.stringify(data.config.metadata ?? {}, null, 2)
                                }
                                onChange={(e) => {
                                    try {
                                        handleConfigChange('metadata', JSON.parse(e.target.value));
                                    } catch {
                                        handleConfigChange('metadata', e.target.value);
                                    }
                                }}
                            />
                        </div>
                    </>
                )}

                {/* Generic JSON config for other types */}
                {![
                    'TRIGGER',
                    'SEND_EMAIL',
                    'SEND_WHATSAPP',
                    'HTTP_REQUEST',
                    'QUERY',
                    'DELAY',
                    'FILTER',
                    'AGGREGATE',
                    'CONDITION',
                    'LOOP',
                    'MERGE',
                    'SCHEDULE_TASK',
                    'UPDATE_RECORD',
                    'SEND_PUSH_NOTIFICATION',
                    'SET_LEAD_STATUS',
                    'CALL_AI',
                ].includes(data.nodeType) && (
                    <div>
                        <Label className="text-xs">
                            {t('common.configurationJson')}
                        </Label>
                        <textarea
                            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                            rows={6}
                            value={JSON.stringify(data.config, null, 2)}
                            onChange={(e) => {
                                try {
                                    const parsed = JSON.parse(e.target.value);
                                    updateNodeConfig(
                                        selectedNode.id,
                                        parsed
                                    );
                                } catch {
                                    // Invalid JSON, ignore
                                }
                            }}
                        />
                    </div>
                )}

                <div className="mt-4 border-t pt-4">
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                            removeNode(selectedNode.id);
                            selectNode(null);
                        }}
                        className="w-full gap-2"
                    >
                        <Trash size={14} />
                        {t('common.deleteNode')}
                    </Button>
                </div>
            </div>
        </div>
    );
}
