/**
 * Use-case templates for the workflow builder.
 * Each template defines:
 *  - which trigger events it applies to
 *  - what questions to ask the user (dropdowns, selects)
 *  - how to generate nodes + edges from the answers
 */

import { v4 as uuidv4 } from 'uuid';
import type { Node, Edge } from 'reactflow';
import i18n from '@/i18n';

// The catalog is built by getUseCaseTemplates() on first use, not at module
// scope: there is no React context here, so per the i18n rollout's
// module-scope-without-t pattern we call the i18next singleton directly rather
// than thread a `t` parameter through every helper — and the singleton has not
// loaded this namespace by the time the module is imported. Callers must be
// inside a component that has subscribed to 'workflowUseCaseTemplates'
// (useTranslation) so the strings exist and a late load re-renders.
function wt(key: string, options?: Record<string, unknown>): string {
    return i18n.t(`workflowUseCaseTemplates:${key}`, options) as string;
}

// ─── Question types for the wizard ───

export interface WizardQuestion {
    id: string;
    label: string;
    helpText?: string;
    type: 'batch_select' | 'batch_multi_select' | 'template_select' | 'whatsapp_template_select' | 'audience_select' | 'live_session_select' | 'invite_select' | 'package_select' | 'number' | 'select' | 'text' | 'json_payload';
    required?: boolean;
    options?: Array<{ value: string; label: string }>; // for 'select' type
    defaultValue?: string | number;
    /** Helper text shown ABOVE the JSON editor for json_payload questions. */
    jsonPayloadHint?: string;
    /** Only show this question if another answer matches */
    showIf?: { questionId: string; values: string[] };
    /**
     * Skip this question when the workflow is built on one of these trigger
     * events, because the event already supplies the answer at run time (and
     * the generator reads it from the context instead). Asking anyway is not
     * just redundant — a hard-coded answer silently overrides whatever scope
     * the admin set on the trigger in the previous step.
     */
    hideForTriggers?: string[];
    /**
     * Optional override for which entry in SAMPLE_TEMPLATES to offer as a
     * "Use sample" button alongside this template_select question. Defaults to
     * the use-case template's id. Set explicitly when a single use-case has
     * multiple template_select questions that need DIFFERENT pre-built samples
     * (e.g., LIVE_SESSION_END recap → one sample for present, one for absent).
     * Only meaningful for type === 'template_select'.
     */
    sampleTemplateKey?: string;
}

export interface UseCaseTemplate {
    id: string;
    name: string;
    description: string;
    icon: string;
    /** Which trigger events this template applies to. Empty = applies to scheduled. */
    triggerEvents: string[];
    /** 'EVENT_DRIVEN' | 'SCHEDULED' | 'BOTH' */
    workflowType: 'EVENT_DRIVEN' | 'SCHEDULED' | 'BOTH';
    /** Questions to ask the user */
    questions: WizardQuestion[];
    /** Generate nodes and edges from answers. Some answer types (e.g., audience_select)
     * can be string[] for multi-select questions. */
    generateWorkflow: (answers: Record<string, string | number | string[]>, triggerEvent?: string) => {
        nodes: Node[];
        edges: Edge[];
        workflowName?: string;
        workflowDescription?: string;
    };
}

// ─── Helper: create a ReactFlow node ───

function makeNode(
    type: string,
    name: string,
    config: Record<string, unknown>,
    x: number,
    y: number,
    isStart = false
): Node {
    return {
        id: `node-${uuidv4()}`,
        type: 'workflowNode',
        position: { x, y },
        data: { name, nodeType: type, config, isStartNode: isStart, isEndNode: false },
    };
}

function makeEdge(source: string, target: string, label = ''): Edge {
    return {
        id: `edge-${uuidv4()}`,
        source,
        target,
        label,
        type: 'smoothstep',
        animated: true,
    };
}

// ─── Channel (Email / WhatsApp / Both) helpers ───
//
// Every messaging use case offers a channel choice. Default stays EMAIL so
// existing behavior is unchanged; picking WhatsApp swaps (or adds) a
// SEND_WHATSAPP node that iterates the same list. The SEND_WHATSAPP handler
// extracts the phone from mobileNumber/mobile_number/phone/parentMobile/etc.
// (plus a phone-shaped fallback scan) and auto-resolves the WhatsApp
// template's variables from each item's fields, the workflow context, and
// customFields — the same resolution order SEND_EMAIL uses.

/** showIf for questions that only apply when email is part of the channel. */
const EMAIL_CHANNEL_SHOWIF = { questionId: 'channel', values: ['EMAIL', 'BOTH'] };

function channelQuestion(): WizardQuestion {
    return {
        id: 'channel',
        label: wt('shared.channel.label'),
        helpText: wt('shared.channel.helpText'),
        type: 'select',
        required: true,
        defaultValue: 'EMAIL',
        options: [
            { value: 'EMAIL', label: wt('shared.channel.options.email') },
            { value: 'WHATSAPP', label: wt('shared.channel.options.whatsapp') },
            { value: 'BOTH', label: wt('shared.channel.options.both') },
        ],
    };
}

function whatsappTemplateQuestion(overrides: Partial<WizardQuestion> = {}): WizardQuestion {
    return {
        id: 'waTemplateName',
        label: wt('shared.whatsappTemplate.label'),
        helpText: wt('shared.whatsappTemplate.helpTextDefault'),
        type: 'whatsapp_template_select',
        required: true,
        showIf: { questionId: 'channel', values: ['WHATSAPP', 'BOTH'] },
        ...overrides,
    };
}

/**
 * Whether a question applies given the current answers and trigger event.
 * The single source of truth for the wizard's "is this question asked?"
 * decision — rendering, the Generate gate, and the preview all go through it
 * so they cannot disagree about which questions are required.
 */
export function isQuestionApplicable(
    question: WizardQuestion,
    answers: Record<string, string | number | string[]>,
    triggerEvent: string | undefined
): boolean {
    if (triggerEvent && question.hideForTriggers?.includes(triggerEvent)) return false;
    if (!question.showIf) return true;
    const depVal = String(answers[question.showIf.questionId] ?? '');
    return question.showIf.values.includes(depVal);
}

// ─── Batch from the trigger ───
//
// Per-enrolment events put the batch the learner just joined on the workflow
// context as `packageSessionIds` (a single id, despite the plural name —
// StudentRegistrationManager.triggerEnrollmentWorkflow and
// SubOrgMemberEnrollmentContext both write it that way). Templates that query
// "students in the batch" read it from there rather than asking the admin to
// pick one: the trigger's own scope (step 3) already decides which batches
// fire, and a batch hard-coded here would override it — three batches selected
// on the trigger, one batch messaged.

/** Trigger events whose context carries the batch as `packageSessionIds`. */
const BATCH_FROM_TRIGGER = ['LEARNER_BATCH_ENROLLMENT', 'SUB_ORG_MEMBER_ENROLLMENT'];

/** SpEL that resolves to the batch from a BATCH_FROM_TRIGGER event's context. */
const BATCH_FROM_CONTEXT = "#ctx['packageSessionIds']";

/**
 * The batch id a "students in batch" QUERY should use: the trigger's own
 * batch when the event supplies one, else whatever the admin picked.
 */
function batchIdFor(
    answers: Record<string, string | number | string[]>,
    triggerEvent: string | undefined
): string {
    if (triggerEvent && BATCH_FROM_TRIGGER.includes(triggerEvent)) return BATCH_FROM_CONTEXT;
    return answers.batchId as string;
}

/**
 * Answer key under which the wizard records the body placeholders a chosen
 * WhatsApp template declares, alongside the template name itself. Kept next to
 * the name so a use-case with two WhatsApp templates keeps them apart.
 */
export function declaredParamsKey(waTemplateAnswerKey: string): string {
    return `${waTemplateAnswerKey}__declaredParams`;
}

/**
 * Narrow placeholder mappings to the ones a WhatsApp template declares.
 * Returns undefined when nothing survives, so the caller omits templateVars
 * entirely (the right config for a template with no body variables).
 *
 * A missing/!array `declared` means the picker never recorded the template's
 * params — fall back to the previous behaviour rather than silently stripping
 * a mapping the admin may be relying on.
 */
function restrictToDeclaredParams(
    vars: Record<string, string> | undefined,
    declared: unknown
): Record<string, string> | undefined {
    if (!Array.isArray(declared)) return vars;
    const mapped: Record<string, string> = {};
    for (const key of declared as string[]) {
        const value = vars?.[key];
        if (value) mapped[key] = value;
    }
    return Object.keys(mapped).length > 0 ? mapped : undefined;
}

/**
 * Build the SEND_EMAIL and/or SEND_WHATSAPP node(s) for the chosen channel,
 * chained vertically starting at (x, y). Connect the upstream node to
 * `nodes[0]`; internal chaining edges are returned in `edges`.
 */
function makeChannelSendNodes(
    answers: Record<string, string | number | string[]>,
    opts: {
        on: string;
        x: number;
        y: number;
        /** Node label prefix for the email node (default 'Send'). */
        emailLabelPrefix?: string;
        /** Placeholder → field/SpEL mapping applied to BOTH channels. */
        templateVars?: Record<string, string>;
        /** Email recipient field override (e.g. parentsEmail). */
        recipientField?: string;
        /** Iterate a different list for WhatsApp (defaults to `on`). */
        waOn?: string;
        /** Answer key holding the email template name (default 'templateName'). */
        emailTemplateAnswerKey?: string;
        /** Answer key holding the WhatsApp template name (default 'waTemplateName'). */
        waTemplateAnswerKey?: string;
    }
): { nodes: Node[]; edges: Edge[] } {
    const channel = String(answers.channel ?? 'EMAIL');
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let y = opts.y;
    if (channel === 'EMAIL' || channel === 'BOTH') {
        const emailTemplate = answers[opts.emailTemplateAnswerKey ?? 'templateName'] as string;
        nodes.push(makeNode('SEND_EMAIL', `${opts.emailLabelPrefix ?? 'Send'}: ${emailTemplate}`, {
            templateName: emailTemplate,
            on: opts.on,
            forEach: { operation: 'SEND_EMAIL', eval: "#ctx['item']" },
            ...(opts.templateVars ? { templateVars: opts.templateVars } : {}),
            ...(opts.recipientField ? { recipientField: opts.recipientField } : {}),
        }, opts.x, y));
        y += 180;
    }
    if (channel === 'WHATSAPP' || channel === 'BOTH') {
        const waAnswerKey = opts.waTemplateAnswerKey ?? 'waTemplateName';
        const waTemplate = answers[waAnswerKey] as string;
        // Email templates ignore placeholders they don't use, but Meta counts
        // them: six params on a template that declares none fails the whole
        // send with "(#132000) number of localizable_params (6) does not match
        // the expected number of params (0)". So pass on only the placeholders
        // this template actually declares — the picker records them alongside
        // the name — and none at all when it declares none.
        const waVars = restrictToDeclaredParams(
            opts.templateVars,
            answers[declaredParamsKey(waAnswerKey)]
        );
        nodes.push(makeNode('SEND_WHATSAPP', `WhatsApp: ${waTemplate}`, {
            templateName: waTemplate,
            on: opts.waOn ?? opts.on,
            forEach: { operation: 'SEND_WHATSAPP', eval: "#ctx['item']" },
            ...(waVars ? { templateVars: waVars } : {}),
        }, opts.x, y));
    }
    for (let i = 0; i < nodes.length - 1; i++) {
        edges.push(makeEdge(nodes[i]!.id, nodes[i + 1]!.id));
    }
    return { nodes, edges };
}

// ═══════════════════════════════════════════════════
// USE CASE DEFINITIONS
//
// VERIFICATION: Each template below has been traced through:
//   SendEmailNodeHandler.handle() → on (List) → forEach (Map) →
//   createEmailRequest() → extractEmailAddress() → template resolution
//
// Requirements for SEND_EMAIL to work:
//   1. `on` must evaluate to a List of Maps (not Strings)
//   2. Each Map must have an `email` (or `to`, `parentsEmail` etc.) field
//   3. `forEach.eval` must evaluate to a Map (the same item)
//   4. DELAY nodes >60s pause and resume via the Quartz resume job, which runs
//      every 2 min (QuartzConfig.workflowResumeTrigger) — it is ENABLED. The same
//      job drives the CALL_AI retry loop.
// ═══════════════════════════════════════════════════

function buildUseCaseTemplates(): UseCaseTemplate[] {
    return [

    // ─── 0. AI-call new leads ───
    // When a lead is submitted, place an AI voice-agent call first. The AI
    // outcome (via the end-of-call webhook → AiCallOutcomeProcessor) decides
    // whether a counsellor is assigned — configured in Settings → AI Calling.
    {
        id: 'ai_call_new_lead',
        name: wt('templates.ai_call_new_lead.name'),
        description: wt('templates.ai_call_new_lead.description'),
        icon: '📞',
        triggerEvents: ['AUDIENCE_LEAD_SUBMISSION'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            {
                id: 'campaignName',
                label: wt('templates.ai_call_new_lead.questions.campaignName.label'),
                helpText: wt('templates.ai_call_new_lead.questions.campaignName.helpText'),
                type: 'text',
                required: false,
            },
        ],
        generateWorkflow: (answers) => {
            const campaignName = ((answers.campaignName as string) || '').trim();

            // CALL_AI (start) — places the AI voice-agent call. Provider-agnostic: the
            // institute's active provider + this agent NAME resolve to the right campaign id
            // downstream (raw ids are never hardcoded here). The end-of-call webhook →
            // AiCallOutcomeProcessor injects #ctx['callOutcome'] (ASSIGN | STOP | RETRY),
            // #ctx['callDisposition'] (raw) and #ctx['callAnswers'] (the extracted data)
            // onto the workflow context before the engine resumes.
            const callNode = makeNode(
                'CALL_AI',
                wt('templates.ai_call_new_lead.nodes.aiCall'),
                campaignName ? { campaignName } : {},
                250,
                80,
                true
            );

            // CONDITION — branch on the AI outcome. The engine's ConditionNodeHandler
            // SpEL-evaluates `config.condition`; ASSIGN means the bot qualified the
            // lead as interested. trueLabel/falseLabel are the builder's display
            // labels for the two branches.
            const conditionNode = makeNode(
                'CONDITION',
                wt('templates.ai_call_new_lead.nodes.interested'),
                {
                    condition: "#ctx['callOutcome'] == 'ASSIGN'",
                    trueLabel: wt('templates.ai_call_new_lead.nodes.trueLabel'),
                    falseLabel: wt('templates.ai_call_new_lead.nodes.falseLabel'),
                },
                250,
                220
            );

            // SET_LEAD_STATUS (true branch) — statusKey left blank on purpose so the
            // builder's validation prompts the admin to pick their own status.
            const assignedNode = makeNode(
                'SET_LEAD_STATUS',
                wt('templates.ai_call_new_lead.nodes.setStatusInterested'),
                { statusKey: '' },
                80,
                360
            );

            // SET_LEAD_STATUS (false branch) — likewise blank for the admin to fill.
            const followupNode = makeNode(
                'SET_LEAD_STATUS',
                wt('templates.ai_call_new_lead.nodes.setStatusFollowup'),
                { statusKey: '' },
                420,
                360
            );

            return {
                nodes: [callNode, conditionNode, assignedNode, followupNode],
                // CONDITION true/false convention (matches WorkflowBuilderService
                // round-trip): the true branch edge is labelled 'true', the false
                // branch edge 'false'. applyEdgesAsRouting pairs them into one
                // `conditional` route (trueNodeId / falseNodeId).
                edges: [
                    makeEdge(callNode.id, conditionNode.id),
                    makeEdge(conditionNode.id, assignedNode.id, 'true'),
                    makeEdge(conditionNode.id, followupNode.id, 'false'),
                ],
                workflowName: wt('templates.ai_call_new_lead.name'),
                workflowDescription: wt('templates.ai_call_new_lead.workflowDescription'),
            };
        },
    },

    // ─── 0b. AI re-call a lead after a manual status change ───
    // The counsellor calls a lead, dispositions it (DNP / not reachable / call back),
    // and the bot picks it up from there. Two things make this work that are easy to
    // miss, so they are baked into the generated graph rather than left to the admin:
    //   * ignoreAssignedGuard — the lead is assigned to the counsellor who just called
    //     it, and CALL_AI refuses assigned leads by default (CallTrigger.AUTOMATION).
    //     Without the flag the node stops with reason="assigned" and never dials.
    //   * the source guard — LEAD_STATUS_CHANGED has no idempotency dedup (strategy
    //     UUID), and the AI's own outcome writes a status back through the same path.
    //     Matching on the status alone re-enters the graph off its own write.
    {
        id: 'ai_recall_on_status',
        name: wt('templates.ai_recall_on_status.name'),
        description: wt('templates.ai_recall_on_status.description'),
        icon: '🔁',
        triggerEvents: ['LEAD_STATUS_CHANGED'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            {
                id: 'statusKey',
                label: wt('templates.ai_recall_on_status.questions.statusKey.label'),
                helpText: wt('templates.ai_recall_on_status.questions.statusKey.helpText'),
                type: 'text',
                required: true,
                defaultValue: 'DNP',
            },
            {
                id: 'campaignName',
                label: wt('templates.ai_recall_on_status.questions.campaignName.label'),
                helpText: wt('templates.ai_recall_on_status.questions.campaignName.helpText'),
                type: 'text',
                required: false,
            },
            {
                id: 'delayMinutes',
                label: wt('templates.ai_recall_on_status.questions.delayMinutes.label'),
                helpText: wt('templates.ai_recall_on_status.questions.delayMinutes.helpText'),
                type: 'number',
                required: false,
                defaultValue: 30,
            },
        ],
        generateWorkflow: (answers) => {
            const statusKey = ((answers.statusKey as string) || 'DNP').trim().toUpperCase();
            const campaignName = ((answers.campaignName as string) || '').trim();
            const delayMinutes = Number(answers.delayMinutes ?? 30) || 0;

            // CONDITION — fire only on the chosen status AND only when a PERSON set it.
            // statusChangeSource carries the same token as lead_status_history.source:
            // MANUAL (leads list) / MANUAL_DISPOSITION (post-call outcome) are human;
            // AI_CALLING / AI_WORKFLOW are this system writing back, and must not
            // re-enter the graph. Written as an explicit allow-list so an unknown future
            // source defaults to NOT calling.
            const gateNode = makeNode(
                'CONDITION',
                wt('templates.ai_recall_on_status.nodes.manuallySetTo', { status: statusKey }),
                {
                    condition:
                        `#ctx['newStatus'] == '${statusKey}' and ` +
                        "(#ctx['statusChangeSource'] == 'MANUAL' or #ctx['statusChangeSource'] == 'MANUAL_DISPOSITION')",
                    trueLabel: wt('templates.ai_recall_on_status.nodes.gateTrueLabel'),
                    falseLabel: wt('templates.ai_recall_on_status.nodes.gateFalseLabel'),
                },
                250,
                80,
                true
            );

            const delayNode = makeNode(
                'DELAY',
                wt('templates.ai_recall_on_status.nodes.waitMinutes', { count: delayMinutes }),
                // The engine reads { delay: { value, unit } } (DelayNodeHandler) — a flat
                // delayMinutes key parses to 0 and silently skips the wait.
                { delay: { value: delayMinutes, unit: 'MINUTES' } },
                250,
                220
            );

            // CALL_AI — ignoreAssignedGuard is the whole point of this template.
            const callNode = makeNode(
                'CALL_AI',
                wt('templates.ai_recall_on_status.nodes.aiCall'),
                campaignName
                    ? { campaignName, ignoreAssignedGuard: true }
                    : { ignoreAssignedGuard: true },
                250,
                360
            );

            // Branch on the AI's verdict. The true branch is left with a blank statusKey
            // on purpose so the builder's validation makes the admin pick their own
            // status — the same convention as the 'AI-call new leads' template.
            const outcomeNode = makeNode(
                'CONDITION',
                wt('templates.ai_recall_on_status.nodes.interested'),
                {
                    condition: "#ctx['callOutcome'] == 'ASSIGN'",
                    trueLabel: wt('templates.ai_recall_on_status.nodes.outcomeTrueLabel'),
                    falseLabel: wt('templates.ai_recall_on_status.nodes.outcomeFalseLabel'),
                },
                250,
                500
            );

            const interestedNode = makeNode(
                'SET_LEAD_STATUS',
                wt('templates.ai_recall_on_status.nodes.setStatusInterested'),
                { statusKey: '' },
                80,
                640
            );

            const nodes = [gateNode, delayNode, callNode, outcomeNode, interestedNode];
            const edges = [
                makeEdge(gateNode.id, delayNode.id, 'true'),
                makeEdge(delayNode.id, callNode.id),
                makeEdge(callNode.id, outcomeNode.id),
                makeEdge(outcomeNode.id, interestedNode.id, 'true'),
            ];

            // A zero-minute wait means "call immediately" — drop the DELAY node rather
            // than persisting a no-op pause the resume job still has to service.
            if (delayMinutes <= 0) {
                nodes.splice(nodes.indexOf(delayNode), 1);
                edges.splice(0, 2, makeEdge(gateNode.id, callNode.id, 'true'));
                callNode.position = { x: 250, y: 220 };
            }

            return {
                nodes,
                edges,
                workflowName: wt('templates.ai_recall_on_status.workflowName', { status: statusKey }),
                workflowDescription: wt('templates.ai_recall_on_status.workflowDescription', {
                    status: statusKey,
                    count: delayMinutes,
                }),
            };
        },
    },

    // ─── 1. Send email to batch students on event ───
    // VERIFIED: fetch_students_by_batch returns {students: [{email, fullName, ...}]}
    //   on="#ctx['students']" → List<Map> ✓, each has email ✓
    {
        id: 'email_batch_students',
        name: wt('templates.email_batch_students.name'),
        description: wt('templates.email_batch_students.description'),
        icon: '📧',
        triggerEvents: ['LIVE_SESSION_CREATE', 'LIVE_SESSION_START', 'LIVE_SESSION_END', 'LEARNER_BATCH_ENROLLMENT', 'SUB_ORG_MEMBER_ENROLLMENT', 'INSTALLMENT_DUE_REMINDER'],
        workflowType: 'BOTH',
        questions: [
            {
                id: 'batchId',
                label: wt('templates.email_batch_students.questions.batchId.label'),
                helpText: wt('templates.email_batch_students.questions.batchId.helpText'),
                type: 'batch_select',
                required: true,
                hideForTriggers: BATCH_FROM_TRIGGER,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.email_batch_students.questions.templateName.label'),
                helpText: wt('templates.email_batch_students.questions.templateName.helpText'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion({
                helpText: wt('templates.email_batch_students.questions.waTemplateName.helpText'),
            }),
            {
                id: 'recipientField',
                label: wt('templates.email_batch_students.questions.recipientField.label'),
                type: 'select',
                showIf: EMAIL_CHANNEL_SHOWIF,
                options: [
                    { value: '', label: wt('templates.email_batch_students.questions.recipientField.options.student') },
                    { value: 'parentsEmail', label: wt('templates.email_batch_students.questions.recipientField.options.parent') },
                    { value: 'guardianEmail', label: wt('templates.email_batch_students.questions.recipientField.options.guardian') },
                ],
            },
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('shared.nodes.triggerGeneric', { event: (triggerEvent ?? 'event').replace(/_/g, ' ').toLowerCase() }), {
                triggerEvent: triggerEvent ?? '',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchBatchStudents'), {
                prebuiltKey: 'fetch_students_by_batch',
                params: { batchId: batchIdFor(answers, triggerEvent) },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 410,
                ...(answers.recipientField ? { recipientField: answers.recipientField as string } : {}),
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
            };
        },
    },

    // ─── 2. Send confirmation email to audience lead ───
    {
        id: 'audience_lead_confirmation',
        name: wt('templates.audience_lead_confirmation.name'),
        description: wt('templates.audience_lead_confirmation.description'),
        icon: '📝',
        triggerEvents: ['AUDIENCE_LEAD_SUBMISSION'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.audience_lead_confirmation.questions.templateName.label'),
                helpText: wt('templates.audience_lead_confirmation.questions.templateName.helpText'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion({
                helpText: wt('templates.audience_lead_confirmation.questions.waTemplateName.helpText'),
            }),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('shared.nodes.triggerAudienceFormSubmitted'), {
                triggerEvent: triggerEvent ?? 'AUDIENCE_LEAD_SUBMISSION',
            }, 250, 50, true);

            // respondentEmailRequests = list of email requests for the LEAD
            // (always populated by AudienceService for any lead submission).
            // adminEmailRequests = list for notifying admins (often empty when
            // audience.toNotify is not configured) — wrong list for "send to lead".
            //
            // templateVars maps the sample template's placeholder names to the
            // actual context fields. Without these, {{parentName}} stays literal.
            // Resolution order in SendEmailNodeHandler (and, since the WhatsApp
            // enrichment, SendWhatsAppNodeHandler too):
            //   item field → context field → customFields[<key>] → SpEL → literal
            //
            // WhatsApp iterates {#ctx['user']} instead — respondentEmailRequests
            // items only carry to/subject/body (no phone), while the lead's
            // UserDTO carries mobile_number (extracted by the handler).
            const send = makeChannelSendNodes(answers, {
                on: "#ctx['respondentEmailRequests']",
                waOn: "{#ctx['user']}",
                x: 250,
                y: 230,
                templateVars: {
                    parentName: 'Full Name',     // resolves from customFields["Full Name"]
                    fullName: 'Full Name',       // alias, in case template uses {{fullName}}
                    name: 'Full Name',           // canonical spelling — the default scaffold uses {{name}}
                    email: 'Email',              // resolves from customFields["Email"]
                    mobileNumber: 'Phone Number',// resolves from customFields["Phone Number"]
                    instituteName: 'instituteName', // resolves from context
                },
            });

            return {
                nodes: [triggerNode, ...send.nodes],
                edges: [makeEdge(triggerNode.id, send.nodes[0]!.id), ...send.edges],
                workflowDescription: wt('templates.audience_lead_confirmation.workflowDescription'),
            };
        },
    },

    // ─── 3. Payment failed retry email ───
    // VERIFIED: PaymentLogService puts packageSessionIds as List<String> in context
    //   fetch_ssigm_by_package natively handles List for packageSessionIds ✓
    //   Output: ssigm_list with email, fullName (camelCase aliases added) ✓
    {
        id: 'payment_failed_email',
        name: wt('templates.payment_failed_email.name'),
        description: wt('templates.payment_failed_email.description'),
        icon: '💳',
        triggerEvents: ['PAYMENT_FAILED'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.payment_failed_email.questions.templateName.label'),
                helpText: wt('templates.payment_failed_email.questions.templateName.helpText'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.payment_failed_email.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'PAYMENT_FAILED',
            }, 250, 50, true);

            // Use fetch_ssigm_by_package because PaymentLogService puts packageSessionIds as List<String>
            // fetch_ssigm_by_package handles List natively, fetch_students_by_batch expects String
            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchStudentDetails'), {
                prebuiltKey: 'fetch_ssigm_by_package',
                params: { packageSessionIds: "#ctx['packageSessionIds']" },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['ssigm_list']",
                x: 250,
                y: 410,
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
            };
        },
    },

    // ─── 4. Abandoned cart reminder ───
    // VERIFIED: fetch_students_by_batch returns students with email ✓
    //   packageSessionId comes from LearnerEnrollmentEntryService context ✓
    {
        id: 'abandoned_cart_reminder',
        name: wt('templates.abandoned_cart_reminder.name'),
        description: wt('templates.abandoned_cart_reminder.description'),
        icon: '🛒',
        triggerEvents: ['ABANDONED_CART'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.abandoned_cart_reminder.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.abandoned_cart_reminder.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'ABANDONED_CART',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchStudentDetails'), {
                prebuiltKey: 'fetch_students_by_batch',
                params: { batchId: "#ctx['packageSessionId']" },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 410,
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
            };
        },
    },

    // ─── 5. Invite-related: Email batch students when invite is created ───
    // VERIFIED: fetch_students_by_batch returns students with email ✓
    //   User selects which batch to notify about the invite ✓
    {
        id: 'invite_notify_batch',
        name: wt('templates.invite_notify_batch.name'),
        description: wt('templates.invite_notify_batch.description'),
        icon: '✉️',
        triggerEvents: ['INVITE_CREATE', 'INVITE_FORM_FILL'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            {
                id: 'batchId',
                label: wt('templates.invite_notify_batch.questions.batchId.label'),
                type: 'batch_select',
                required: true,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.invite_notify_batch.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('shared.nodes.triggerGeneric', { event: (triggerEvent ?? 'invite event').replace(/_/g, ' ').toLowerCase() }), {
                triggerEvent: triggerEvent ?? 'INVITE_CREATE',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchBatchStudents'), {
                prebuiltKey: 'fetch_students_by_batch',
                params: { batchId: answers.batchId as string },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 410,
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
            };
        },
    },

    // ─── 6. Scheduled: Daily batch report email ───
    {
        id: 'scheduled_batch_report',
        name: wt('templates.scheduled_batch_report.name'),
        description: wt('templates.scheduled_batch_report.description'),
        icon: '📊',
        triggerEvents: [],
        workflowType: 'SCHEDULED',
        questions: [
            {
                id: 'batchId',
                label: wt('templates.scheduled_batch_report.questions.batchId.label'),
                helpText: wt('templates.scheduled_batch_report.questions.batchId.helpText'),
                type: 'batch_multi_select',
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.scheduled_batch_report.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
            {
                id: 'daysBack',
                label: wt('shared.questions.daysBack.label'),
                type: 'number',
                defaultValue: 7,
            },
            {
                id: 'excludeToday',
                label: wt('shared.questions.excludeToday.label'),
                helpText: wt('templates.scheduled_batch_report.questions.excludeToday.helpText'),
                type: 'select',
                required: true,
                defaultValue: 'exclude',
                options: [
                    { value: 'exclude', label: wt('templates.scheduled_batch_report.questions.excludeToday.options.exclude') },
                    { value: 'include', label: wt('templates.scheduled_batch_report.questions.excludeToday.options.include') },
                ],
            },
        ],
        generateWorkflow: (answers) => {
            // batchId may be a string (legacy single-select) or string[] (multi-select).
            // Backend QueryServiceImpl.fetchBatchAttendanceReport splits on "," — emit
            // a CSV. Empty value triggers the "all active batches" fallback.
            const batchCsv = Array.isArray(answers.batchId)
                ? (answers.batchId as string[]).filter(Boolean).join(',')
                : (answers.batchId as string | undefined) ?? '';

            const queryNode = makeNode('QUERY', wt('templates.scheduled_batch_report.nodes.fetchAttendanceReport'), {
                prebuiltKey: 'fetch_batch_attendance_report',
                params: {
                    ...(batchCsv ? { batchId: batchCsv } : {}),
                    daysBack: answers.daysBack ?? 7,
                    // Only set excludeToday=true when the admin picked "exclude" (default).
                    // When "include" is picked, omit the param entirely so the backend
                    // uses its original semantics (today + N days back).
                    ...(answers.excludeToday !== 'include' ? { excludeToday: true } : {}),
                },
            }, 250, 50, true);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 230,
            });

            return {
                nodes: [queryNode, ...send.nodes],
                edges: [makeEdge(queryNode.id, send.nodes[0]!.id), ...send.edges],
            };
        },
    },

    // ─── 7. Scheduled: Audience follow-up ───
    {
        id: 'scheduled_audience_followup',
        name: wt('templates.scheduled_audience_followup.name'),
        description: wt('templates.scheduled_audience_followup.description'),
        icon: '🔄',
        triggerEvents: [],
        workflowType: 'SCHEDULED',
        questions: [
            {
                id: 'audienceId',
                label: wt('templates.scheduled_audience_followup.questions.audienceId.label'),
                helpText: wt('templates.scheduled_audience_followup.questions.audienceId.helpText'),
                type: 'audience_select',
            },
            {
                id: 'daysAgo',
                label: wt('templates.scheduled_audience_followup.questions.daysAgo.label'),
                helpText: wt('templates.scheduled_audience_followup.questions.daysAgo.helpText'),
                type: 'number',
                defaultValue: 3,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.scheduled_audience_followup.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion({
                helpText: wt('templates.scheduled_audience_followup.questions.waTemplateName.helpText'),
            }),
        ],
        generateWorkflow: (answers) => {
            // audienceId may be a string (legacy single-select) or string[] (multi-select).
            // Backend QueryServiceImpl splits on "," — emit a CSV. Empty value
            // triggers the institute-wide fallback in fetchAudienceResponsesFiltered.
            const audienceCsv = Array.isArray(answers.audienceId)
                ? (answers.audienceId as string[]).filter(Boolean).join(',')
                : (answers.audienceId as string | undefined) ?? '';

            const queryNode = makeNode('QUERY', wt('templates.scheduled_audience_followup.nodes.fetchRecentLeads'), {
                prebuiltKey: 'fetch_audience_responses_filtered',
                params: {
                    ...(audienceCsv ? { audienceId: audienceCsv } : {}),
                    daysAgo: answers.daysAgo ?? 3,
                },
            }, 250, 50, true);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['leads']",
                x: 250,
                y: 230,
            });

            return {
                nodes: [queryNode, ...send.nodes],
                edges: [makeEdge(queryNode.id, send.nodes[0]!.id), ...send.edges],
            };
        },
    },

    // ─── 8. Scheduled: Fee installment reminders ───
    // VERIFIED: getUpcomingFeeInstallments returns {feePaymentList: [{email, studentName, ...}]}
    //   Items have email (recipient or parent) ✓, has amount/dueDate for template vars ✓
    {
        id: 'scheduled_fee_reminder',
        name: wt('templates.scheduled_fee_reminder.name'),
        description: wt('templates.scheduled_fee_reminder.description'),
        icon: '💰',
        triggerEvents: [],
        workflowType: 'SCHEDULED',
        questions: [
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.scheduled_fee_reminder.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers) => {
            const queryNode = makeNode('QUERY', wt('templates.scheduled_fee_reminder.nodes.fetchUpcomingInstallments'), {
                prebuiltKey: 'getUpcomingFeeInstallments',
                params: {},
            }, 250, 50, true);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['feePaymentList']",
                x: 250,
                y: 230,
            });

            return {
                nodes: [queryNode, ...send.nodes],
                edges: [makeEdge(queryNode.id, send.nodes[0]!.id), ...send.edges],
            };
        },
    },

    // ═══════════════════════════════════════════════════
    // ENROLLMENT & ONBOARDING USE CASES
    // ═══════════════════════════════════════════════════

    // ─── 9. Welcome email to newly enrolled student ───
    {
        id: 'welcome_enrolled_student',
        name: wt('templates.welcome_enrolled_student.name'),
        description: wt('templates.welcome_enrolled_student.description'),
        icon: '🎓',
        triggerEvents: ['LEARNER_BATCH_ENROLLMENT', 'SUB_ORG_MEMBER_ENROLLMENT'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.welcome_enrolled_student.questions.templateName.label'),
                helpText: wt('templates.welcome_enrolled_student.questions.templateName.helpText'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion({
                helpText: wt('templates.welcome_enrolled_student.questions.waTemplateName.helpText'),
            }),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('shared.nodes.triggerStudentEnrolled'), {
                triggerEvent: triggerEvent ?? 'LEARNER_BATCH_ENROLLMENT',
            }, 250, 50, true);

            // Wrap the just-enrolled user in a single-element list so SEND_EMAIL /
            // SEND_WHATSAPP iterate once. We deliberately do NOT fetch batch students
            // here — the welcome message is for the one user who just enrolled, and
            // only the trigger context has their plaintext credentials. Iterating over
            // the whole batch would message everyone the same password (wrong) and
            // would lose access to {{username}}/{{password}} entirely (the
            // students-by-batch query doesn't return those fields).
            //
            // Pre-populate the placeholder → context-field mapping so the user
            // doesn't have to do it manually in the workflow builder. Each value
            // is a SpEL expression evaluated against the workflow context at
            // send time. The user can override any of these in the node config.
            const send = makeChannelSendNodes(answers, {
                on: "{#ctx['user']}",
                x: 250,
                y: 230,
                recipientField: 'email',
                templateVars: {
                    fullName: "#ctx['user'].fullName",
                    username: "#ctx['user'].username",
                    password: "#ctx['user'].password",
                    email: "#ctx['user'].email",
                    instituteName: "#ctx['instituteName']",
                },
            });

            return {
                nodes: [triggerNode, ...send.nodes],
                edges: [makeEdge(triggerNode.id, send.nodes[0]!.id), ...send.edges],
                workflowDescription: wt('templates.welcome_enrolled_student.workflowDescription'),
            };
        },
    },

    // Template #10 REMOVED: SEND_EMAIL requires each item in `on` list to be a Map with `email` field.
    // Static admin email strings are rejected by the handler. Needs backend enhancement to support.

    // ─── 11. Send to parents instead of students ───
    {
        id: 'email_parents_batch',
        name: wt('templates.email_parents_batch.name'),
        description: wt('templates.email_parents_batch.description'),
        icon: '👪',
        triggerEvents: ['LIVE_SESSION_CREATE', 'LIVE_SESSION_START', 'LEARNER_BATCH_ENROLLMENT', 'SUB_ORG_MEMBER_ENROLLMENT', 'INSTALLMENT_DUE_REMINDER'],
        workflowType: 'BOTH',
        questions: [
            {
                id: 'batchId',
                label: wt('shared.questions.batchId.label'),
                type: 'batch_select',
                required: true,
                hideForTriggers: BATCH_FROM_TRIGGER,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('shared.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion({
                helpText: wt('templates.email_parents_batch.questions.waTemplateName.helpText'),
            }),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('shared.nodes.triggerGeneric', { event: (triggerEvent ?? 'event').replace(/_/g, ' ').toLowerCase() }), {
                triggerEvent: triggerEvent ?? '',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchBatchStudents'), {
                prebuiltKey: 'fetch_students_by_batch',
                params: { batchId: batchIdFor(answers, triggerEvent) },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 410,
                emailLabelPrefix: wt('templates.email_parents_batch.nodes.sendToParentsPrefix'),
                recipientField: 'parentsEmail',
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
            };
        },
    },

    // ─── 12. Member termination notice ───
    {
        id: 'termination_notice',
        name: wt('templates.termination_notice.name'),
        description: wt('templates.termination_notice.description'),
        icon: '🚪',
        triggerEvents: ['SUB_ORG_MEMBER_TERMINATION'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('shared.questions.notificationTemplateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.termination_notice.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'SUB_ORG_MEMBER_TERMINATION',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchStudentDetails'), {
                prebuiltKey: 'fetch_students_by_batch',
                params: { batchId: "#ctx['packageSessionIds']" },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 410,
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
            };
        },
    },

    // ═══════════════════════════════════════════════════
    // LIVE SESSION USE CASES
    // ═══════════════════════════════════════════════════

    // ─── 13. Session start reminder ───
    {
        id: 'session_start_reminder',
        name: wt('templates.session_start_reminder.name'),
        description: wt('templates.session_start_reminder.description'),
        icon: '🔴',
        triggerEvents: ['LIVE_SESSION_START'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            {
                id: 'batchId',
                label: wt('shared.questions.batchIdToNotify.label'),
                type: 'batch_select',
                required: true,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.session_start_reminder.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.session_start_reminder.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'LIVE_SESSION_START',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchBatchStudents'), {
                prebuiltKey: 'fetch_students_by_batch',
                params: { batchId: answers.batchId as string },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 410,
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
                workflowDescription: wt('templates.session_start_reminder.workflowDescription'),
            };
        },
    },

    // ─── 14. Post-session follow-up ───
    {
        id: 'post_session_followup',
        name: wt('templates.post_session_followup.name'),
        description: wt('templates.post_session_followup.description'),
        icon: '📹',
        triggerEvents: ['LIVE_SESSION_END'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            {
                id: 'batchId',
                label: wt('templates.post_session_followup.questions.batchId.label'),
                type: 'batch_select',
                required: true,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.post_session_followup.questions.templateName.label'),
                helpText: wt('templates.post_session_followup.questions.templateName.helpText'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.post_session_followup.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'LIVE_SESSION_END',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchBatchStudents'), {
                prebuiltKey: 'fetch_students_by_batch',
                params: { batchId: answers.batchId as string },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 410,
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
                workflowDescription: wt('templates.post_session_followup.workflowDescription'),
            };
        },
    },

    // Template #15 REMOVED: LIVE_SESSION_FORM_SUBMISSION trigger not integrated in any service yet.
    // Context data structure unknown — can't verify template will work.

    // ═══════════════════════════════════════════════════
    // CRM & LEAD NURTURING USE CASES
    // ═══════════════════════════════════════════════════

    // Template #16 REMOVED: Same issue as #10 — static email not supported by SEND_EMAIL handler.

    // ─── 17. Lead follow-up with different template ───
    // VERIFIED: respondentEmailRequests is List<Map> with the lead's email,
    //   always populated by AudienceService for each form submission.
    {
        id: 'lead_followup_email',
        name: wt('templates.lead_followup_email.name'),
        description: wt('templates.lead_followup_email.description'),
        icon: '⏰',
        triggerEvents: ['AUDIENCE_LEAD_SUBMISSION'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.lead_followup_email.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion({
                helpText: wt('templates.audience_lead_confirmation.questions.waTemplateName.helpText'),
            }),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.lead_followup_email.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'AUDIENCE_LEAD_SUBMISSION',
            }, 250, 50, true);

            // WhatsApp iterates {#ctx['user']} — respondentEmailRequests items only
            // carry to/subject/body (no phone); the lead's UserDTO carries mobile_number.
            const send = makeChannelSendNodes(answers, {
                on: "#ctx['respondentEmailRequests']",
                waOn: "{#ctx['user']}",
                x: 250,
                y: 230,
                emailLabelPrefix: wt('templates.lead_followup_email.nodes.followUpPrefix'),
                templateVars: {
                    parentName: 'Full Name',
                    fullName: 'Full Name',
                    email: 'Email',
                    mobileNumber: 'Phone Number',
                    instituteName: 'instituteName',
                },
            });

            return {
                nodes: [triggerNode, ...send.nodes],
                edges: [makeEdge(triggerNode.id, send.nodes[0]!.id), ...send.edges],
            };
        },
    },

    // ─── 18. Membership expiry reminder ───
    {
        id: 'membership_expiry_reminder',
        name: wt('templates.membership_expiry_reminder.name'),
        description: wt('templates.membership_expiry_reminder.description'),
        icon: '⚠️',
        triggerEvents: ['MEMBERSHIP_EXPIRY'],
        workflowType: 'BOTH',
        questions: [
            {
                id: 'daysUntilExpiry',
                label: wt('shared.questions.daysUntilExpiry.label'),
                type: 'number',
                defaultValue: 7,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.membership_expiry_reminder.questions.templateName.label'),
                helpText: wt('templates.membership_expiry_reminder.questions.templateName.helpText'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.membership_expiry_reminder.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'MEMBERSHIP_EXPIRY',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchExpiringMemberships'), {
                prebuiltKey: 'fetch_expiring_memberships',
                params: { daysUntilExpiry: answers.daysUntilExpiry ?? 7 },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['expiringMemberships']",
                x: 250,
                y: 410,
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
                workflowDescription: wt('templates.membership_expiry_reminder.workflowDescription'),
            };
        },
    },

    // ═══════════════════════════════════════════════════
    // ASSESSMENT USE CASES
    // ═══════════════════════════════════════════════════

    // ─── 19. Notify students about new assessment ───
    {
        id: 'assessment_created_notify',
        name: wt('templates.assessment_created_notify.name'),
        description: wt('templates.assessment_created_notify.description'),
        icon: '📝',
        triggerEvents: ['ASSESSMENT_CREATE'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            {
                id: 'batchId',
                label: wt('shared.questions.batchIdToNotify.label'),
                type: 'batch_select',
                required: true,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('shared.questions.notificationTemplateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.assessment_created_notify.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'ASSESSMENT_CREATE',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchBatchStudents'), {
                prebuiltKey: 'fetch_students_by_batch',
                params: { batchId: answers.batchId as string },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 410,
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
                workflowDescription: wt('templates.assessment_created_notify.workflowDescription'),
            };
        },
    },

    // ─── 20. Assessment: email batch students ───
    // VERIFIED: Same pattern as #1 — fetch_students_by_batch returns email ✓
    //   Note: ASSESSMENT triggers are not yet integrated in services
    {
        id: 'assessment_email_batch',
        name: wt('templates.assessment_email_batch.name'),
        description: wt('templates.assessment_email_batch.description'),
        icon: '🏆',
        triggerEvents: ['ASSESSMENT_END', 'ASSESSMENT_FORM_SUBMISSION'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            {
                id: 'batchId',
                label: wt('shared.questions.batchIdToNotify.label'),
                type: 'batch_select',
                required: true,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('shared.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('shared.nodes.triggerGeneric', { event: (triggerEvent ?? 'assessment event').replace(/_/g, ' ').toLowerCase() }), {
                triggerEvent: triggerEvent ?? 'ASSESSMENT_END',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchBatchStudents'), {
                prebuiltKey: 'fetch_students_by_batch',
                params: { batchId: answers.batchId as string },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 410,
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
            };
        },
    },

    // ─── 21. Assessment start reminder ───
    {
        id: 'assessment_start_notify',
        name: wt('templates.assessment_start_notify.name'),
        description: wt('templates.assessment_start_notify.description'),
        icon: '📋',
        triggerEvents: ['ASSESSMENT_START'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            {
                id: 'batchId',
                label: wt('shared.questions.batchIdToNotify.label'),
                type: 'batch_select',
                required: true,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.assessment_start_notify.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.assessment_start_notify.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'ASSESSMENT_START',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchBatchStudents'), {
                prebuiltKey: 'fetch_students_by_batch',
                params: { batchId: answers.batchId as string },
            }, 250, 230);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 410,
            });

            return {
                nodes: [triggerNode, queryNode, ...send.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, send.nodes[0]!.id),
                    ...send.edges,
                ],
            };
        },
    },

    // ═══════════════════════════════════════════════════
    // SCHEDULED REPORTS & AUTOMATION
    // ═══════════════════════════════════════════════════

    // ─── 22. Scheduled: Membership expiry check ───
    {
        id: 'scheduled_expiry_check',
        name: wt('templates.scheduled_expiry_check.name'),
        description: wt('templates.scheduled_expiry_check.description'),
        icon: '🔁',
        triggerEvents: [],
        workflowType: 'SCHEDULED',
        questions: [
            {
                id: 'daysUntilExpiry',
                label: wt('templates.scheduled_expiry_check.questions.daysUntilExpiry.label'),
                type: 'number',
                defaultValue: 7,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.scheduled_expiry_check.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion(),
        ],
        generateWorkflow: (answers) => {
            const queryNode = makeNode('QUERY', wt('shared.nodes.fetchExpiringMemberships'), {
                prebuiltKey: 'fetch_expiring_memberships',
                params: { daysUntilExpiry: answers.daysUntilExpiry ?? 7 },
            }, 250, 50, true);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['expiringMemberships']",
                x: 250,
                y: 230,
            });

            return {
                nodes: [queryNode, ...send.nodes],
                edges: [makeEdge(queryNode.id, send.nodes[0]!.id), ...send.edges],
                workflowDescription: wt('templates.scheduled_expiry_check.workflowDescription', { count: answers.daysUntilExpiry }),
            };
        },
    },

    // ─── 23. Scheduled: Batch engagement summary ───
    {
        id: 'scheduled_engagement_summary',
        name: wt('templates.scheduled_engagement_summary.name'),
        description: wt('templates.scheduled_engagement_summary.description'),
        icon: '📈',
        triggerEvents: [],
        workflowType: 'SCHEDULED',
        questions: [
            {
                id: 'batchId',
                label: wt('shared.questions.batchId.label'),
                type: 'batch_select',
                required: true,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.scheduled_engagement_summary.questions.templateName.label'),
                helpText: wt('templates.scheduled_engagement_summary.questions.templateName.helpText'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion({
                helpText: wt('templates.scheduled_engagement_summary.questions.waTemplateName.helpText'),
            }),
            {
                id: 'daysBack',
                label: wt('shared.questions.daysBack.label'),
                type: 'number',
                defaultValue: 7,
            },
            {
                id: 'excludeToday',
                label: wt('shared.questions.excludeToday.label'),
                helpText: wt('shared.questions.excludeToday.helpTextShort'),
                type: 'select',
                required: true,
                defaultValue: 'exclude',
                options: [
                    { value: 'exclude', label: wt('shared.questions.excludeToday.options.excludeShort') },
                    { value: 'include', label: wt('shared.questions.excludeToday.options.includeShort') },
                ],
            },
        ],
        generateWorkflow: (answers) => {
            const queryNode = makeNode('QUERY', wt('templates.scheduled_engagement_summary.nodes.fetchStudentEngagement'), {
                prebuiltKey: 'fetch_batch_attendance_report',
                params: {
                    batchId: answers.batchId as string,
                    daysBack: answers.daysBack ?? 7,
                    ...(answers.excludeToday !== 'include' ? { excludeToday: true } : {}),
                },
            }, 250, 50, true);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 230,
            });

            return {
                nodes: [queryNode, ...send.nodes],
                edges: [makeEdge(queryNode.id, send.nodes[0]!.id), ...send.edges],
                workflowDescription: wt('templates.scheduled_engagement_summary.workflowDescription', { count: answers.daysBack }),
            };
        },
    },

    // ─── 24. Scheduled: Parents attendance update ───
    {
        id: 'scheduled_parents_attendance',
        name: wt('templates.scheduled_parents_attendance.name'),
        description: wt('templates.scheduled_parents_attendance.description'),
        icon: '👨‍👩‍👧',
        triggerEvents: [],
        workflowType: 'SCHEDULED',
        questions: [
            {
                id: 'batchId',
                label: wt('shared.questions.batchId.label'),
                type: 'batch_select',
                required: true,
            },
            channelQuestion(),
            {
                id: 'templateName',
                label: wt('templates.scheduled_parents_attendance.questions.templateName.label'),
                type: 'template_select',
                required: true,
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion({
                helpText: wt('templates.scheduled_parents_attendance.questions.waTemplateName.helpText'),
            }),
            {
                id: 'daysBack',
                label: wt('shared.questions.daysBack.label'),
                type: 'number',
                defaultValue: 7,
            },
            {
                id: 'excludeToday',
                label: wt('shared.questions.excludeToday.label'),
                helpText: wt('shared.questions.excludeToday.helpTextShort'),
                type: 'select',
                required: true,
                defaultValue: 'exclude',
                options: [
                    { value: 'exclude', label: wt('shared.questions.excludeToday.options.excludeShort') },
                    { value: 'include', label: wt('shared.questions.excludeToday.options.includeShort') },
                ],
            },
        ],
        generateWorkflow: (answers) => {
            const queryNode = makeNode('QUERY', wt('templates.scheduled_parents_attendance.nodes.fetchStudentData'), {
                prebuiltKey: 'fetch_batch_attendance_report',
                params: {
                    batchId: answers.batchId as string,
                    daysBack: answers.daysBack ?? 7,
                    ...(answers.excludeToday !== 'include' ? { excludeToday: true } : {}),
                },
            }, 250, 50, true);

            const send = makeChannelSendNodes(answers, {
                on: "#ctx['students']",
                x: 250,
                y: 230,
                emailLabelPrefix: wt('templates.email_parents_batch.nodes.sendToParentsPrefix'),
                recipientField: 'parentsEmail',
            });

            return {
                nodes: [queryNode, ...send.nodes],
                edges: [makeEdge(queryNode.id, send.nodes[0]!.id), ...send.edges],
                workflowDescription: wt('templates.scheduled_parents_attendance.workflowDescription', { count: answers.daysBack }),
            };
        },
    },

    // Template #25: Onboarding drip REMOVED — uses multi-day delays which require
    // the Quartz resume job (currently disabled). Will be re-added when persistent
    // delay is enabled. For now, create separate scheduled workflows for Day 3 and Day 7.

    // ─── 26. Live class ended: post-class email to present & absent students ───
    // VERIFIED: backend prebuilt query fetch_live_session_attendance returns
    //   { presentStudents: [{email, fullName, sessionTitle, instituteName, ...}],
    //     absentStudents: [...] }
    // Each item is a Map with `email` ✓, so SEND_EMAIL handler iterates correctly.
    // Every key on each item auto-becomes a placeholder via the per-item enrichment
    // in SendEmailNodeHandler — no templateVars mapping needed. Placeholders
    // available in the chosen email template:
    //   {{fullName}}  {{name}}  {{sessionTitle}}  {{instituteName}}
    //   {{date}}  {{time}}  {{attendanceStatus}}  {{mobileNumber}}
    //   Present-only attendance metrics (zeros/blank for absent students):
    //   {{joinTime}}  {{attendedMinutes}}  {{attendancePercentage}}  {{sessionDurationMinutes}}
    //   Pre-rendered HTML snippet — empty string when provider hasn't synced
    //   join-time data, so the email cleanly omits the attendance section:
    //   {{attendanceBlockHtml}}
    {
        id: 'live_session_end_recap',
        name: wt('templates.live_session_end_recap.name'),
        description: wt('templates.live_session_end_recap.description'),
        icon: '📨',
        triggerEvents: ['LIVE_SESSION_END'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            channelQuestion(),
            {
                id: 'presentTemplate',
                label: wt('templates.live_session_end_recap.questions.presentTemplate.label'),
                helpText: wt('templates.live_session_end_recap.questions.presentTemplate.helpText'),
                type: 'template_select',
                required: true,
                sampleTemplateKey: 'live_session_recap_present',
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            {
                id: 'absentTemplate',
                label: wt('templates.live_session_end_recap.questions.absentTemplate.label'),
                helpText: wt('templates.live_session_end_recap.questions.absentTemplate.helpText'),
                type: 'template_select',
                required: true,
                sampleTemplateKey: 'live_session_recap_absent',
                showIf: EMAIL_CHANNEL_SHOWIF,
            },
            whatsappTemplateQuestion({
                id: 'waPresentTemplate',
                label: wt('templates.live_session_end_recap.questions.waPresentTemplate.label'),
                helpText: wt('templates.live_session_end_recap.questions.waPresentTemplate.helpText'),
            }),
            whatsappTemplateQuestion({
                id: 'waAbsentTemplate',
                label: wt('templates.live_session_end_recap.questions.waAbsentTemplate.label'),
                helpText: wt('templates.live_session_end_recap.questions.waAbsentTemplate.helpText'),
            }),
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.live_session_end_recap.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'LIVE_SESSION_END',
            }, 250, 50, true);

            const queryNode = makeNode('QUERY', wt('templates.live_session_end_recap.nodes.fetchAttendance'), {
                prebuiltKey: 'fetch_live_session_attendance',
                params: {
                    sessionId: "#ctx['sessionId']",
                    scheduleId: "#ctx['scheduleId']",
                },
            }, 250, 230);

            const presentSend = makeChannelSendNodes(answers, {
                on: "#ctx['presentStudents']",
                x: 50,
                y: 410,
                emailLabelPrefix: wt('templates.live_session_end_recap.nodes.sendToPresentPrefix'),
                emailTemplateAnswerKey: 'presentTemplate',
                waTemplateAnswerKey: 'waPresentTemplate',
            });

            const absentSend = makeChannelSendNodes(answers, {
                on: "#ctx['absentStudents']",
                x: 450,
                y: 410,
                emailLabelPrefix: wt('templates.live_session_end_recap.nodes.sendToAbsentPrefix'),
                emailTemplateAnswerKey: 'absentTemplate',
                waTemplateAnswerKey: 'waAbsentTemplate',
            });

            return {
                nodes: [triggerNode, queryNode, ...presentSend.nodes, ...absentSend.nodes],
                edges: [
                    makeEdge(triggerNode.id, queryNode.id),
                    makeEdge(queryNode.id, presentSend.nodes[0]!.id, 'present'),
                    makeEdge(queryNode.id, absentSend.nodes[0]!.id, 'absent'),
                    ...presentSend.edges,
                    ...absentSend.edges,
                ],
                workflowDescription: wt('templates.live_session_end_recap.workflowDescription'),
            };
        },
    },

    // ─── 27. Send enrollment data to external webhook (Pabbly / Zapier / n8n / etc.) ───
    // Single HTTP_REQUEST node — no QUERY needed, because LEARNER_BATCH_ENROLLMENT
    // already puts user (UserDTO with fullName/email/mobileNumber) and packageName
    // (added by StudentRegistrationManager) on the workflow context. triggerTime is
    // injected by WorkflowTriggerService.
    //
    // Scoping:
    //   - "institute" → no filter, fires on every enrollment in the institute
    //   - "course"    → prepended CONDITION node that checks #ctx['packageId']
    //                   == <chosen packageId>. Uses CONDITION instead of trigger-level
    //                   scoping because LEARNER_BATCH_ENROLLMENT fires per-batch
    //                   (packageSessionId) and there's no trigger-matching layer for
    //                   packageId today. CONDITION adds one tiny check per enrollment
    //                   globally — negligible overhead.
    //
    // Payload: admin-editable JSON object. Values can be SpEL expressions referencing
    // #ctx['...']. The HTTP_REQUEST body evaluator (HttpHelperUtils.evaluateBodyExpressions)
    // SpEL-evaluates any string containing #ctx or #root; non-SpEL values pass through
    // as literals.
    {
        id: 'webhook_on_enrollment',
        name: wt('templates.webhook_on_enrollment.name'),
        description: wt('templates.webhook_on_enrollment.description'),
        icon: '🔗',
        triggerEvents: ['LEARNER_BATCH_ENROLLMENT'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            {
                id: 'webhookUrl',
                label: wt('shared.questions.webhookUrl.label'),
                helpText: wt('templates.webhook_on_enrollment.questions.webhookUrl.helpText'),
                type: 'text',
                required: true,
            },
            {
                id: 'scope',
                label: wt('shared.questions.scope.label'),
                helpText: wt('templates.webhook_on_enrollment.questions.scope.helpText'),
                type: 'select',
                required: true,
                defaultValue: 'institute',
                options: [
                    { value: 'institute', label: wt('templates.webhook_on_enrollment.questions.scope.options.institute') },
                    { value: 'course', label: wt('templates.webhook_on_enrollment.questions.scope.options.course') },
                ],
            },
            {
                id: 'courseId',
                label: wt('shared.questions.courseId.label'),
                helpText: wt('shared.questions.courseId.helpText'),
                type: 'package_select',
                required: true,
                showIf: { questionId: 'scope', values: ['course'] },
            },
            {
                id: 'payloadJson',
                label: wt('shared.questions.payloadJson.label'),
                type: 'json_payload',
                required: true,
                jsonPayloadHint: wt('templates.webhook_on_enrollment.questions.payloadJson.hint'),
                defaultValue: JSON.stringify(
                    {
                        Timestamp: "#ctx['triggerTime']",
                        Name: "#ctx['user'].fullName",
                        Phone: "#ctx['user'].mobileNumber",
                        Email: "#ctx['user'].email",
                        CourseName: "#ctx['packageName']",
                        EnrollmentStatus: "#ctx['enrollmentStatus']",
                        PaymentStatus: "#ctx['paymentStatus']",
                        PaymentOrderId: "#ctx['paymentOrderId']",
                        PaymentAmount: "#ctx['paymentAmount']",
                        PaymentCurrency: "#ctx['paymentCurrency']",
                    },
                    null,
                    2,
                ),
            },
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('shared.nodes.triggerStudentEnrolled'), {
                triggerEvent: triggerEvent ?? 'LEARNER_BATCH_ENROLLMENT',
            }, 250, 50, true);

            // QUERY node fetches the learner's SSIGM enrollment status + latest
            // PaymentLog and merges them onto the context (enrollmentStatus,
            // paymentStatus, paymentOrderId, paymentAmount, paymentCurrency, etc.).
            // Without this, the trigger context only has user + packageName — payment
            // & enrollment status would render as literal {{...}} in the webhook body.
            // The QUERY auto-injects instituteId; userId and packageSessionId are
            // pulled from the trigger context via SpEL.
            const enrichNode = makeNode('QUERY', wt('templates.webhook_on_enrollment.nodes.fetchEnrollmentPaymentStatus'), {
                prebuiltKey: 'fetch_enrollment_details',
                params: {
                    userId: "#ctx['user'].id",
                    packageSessionId: "#ctx['packageSessionIds']",
                },
            }, 250, 200);

            // Parse the admin-supplied JSON payload. The wizard validates live, but
            // be defensive on generate — fall back to a minimal default if the JSON
            // is somehow unparseable at this point so we don't emit an empty body.
            let body: Record<string, unknown> = {};
            try {
                const raw = (answers.payloadJson as string) ?? '{}';
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    body = parsed as Record<string, unknown>;
                }
            } catch {
                body = {
                    Timestamp: "#ctx['triggerTime']",
                    Email: "#ctx['user'].email",
                    Name: "#ctx['user'].fullName",
                };
            }

            // Course-level scoping uses the HTTP_REQUEST node's built-in `condition`
            // field — the handler evaluates it before firing and skips the request
            // when false. This avoids needing a separate CONDITION node (and avoids
            // the wizard's auto-routing inserting wrong goto entries on a CONDITION).
            // For institute-wide scope, no condition is set.
            const courseCondition =
                answers.scope === 'course' && answers.courseId
                    ? `#ctx['packageId'] == '${String(answers.courseId).replace(/'/g, "\\'")}'`
                    : undefined;

            const webhookNode = makeNode('HTTP_REQUEST', wt('templates.webhook_on_enrollment.nodes.postToWebhook'), {
                // Plain string — the HTTP_REQUEST handler now passes literals through
                // (only invokes SpEL when the value contains #, T(, or '...').
                resultKey: 'webhookResponse',
                config: {
                    requestType: 'EXTERNAL',
                    method: 'POST',
                    url: answers.webhookUrl as string,
                    ...(courseCondition ? { condition: courseCondition } : {}),
                    body,
                },
            }, 250, 380);

            return {
                nodes: [triggerNode, enrichNode, webhookNode],
                edges: [
                    makeEdge(triggerNode.id, enrichNode.id),
                    makeEdge(enrichNode.id, webhookNode.id),
                ],
                workflowDescription:
                    answers.scope === 'course' && answers.courseId
                        ? wt('templates.webhook_on_enrollment.workflowDescription.course')
                        : wt('templates.webhook_on_enrollment.workflowDescription.institute'),
            };
        },
    },

    // ─── 28. Send abandoned-cart data to external webhook ───
    // Mirrors webhook_on_enrollment but fires when a learner starts the enrollment
    // form but hasn't completed payment yet. Backend (LearnerEnrollmentEntryService)
    // now puts the same context shape on this trigger as LEARNER_BATCH_ENROLLMENT
    // (user UserDTO + packageName + packageId + triggerTime), so the webhook
    // payload uses the SAME SpEL — minus payment fields, which don't exist yet
    // at abandoned-cart time.
    //
    // No QUERY enrichment node here. We could fetch the SSIGM row (it's saved
    // before the trigger fires), but adding the same after-commit deferral fix
    // we applied to LEARNER_BATCH_ENROLLMENT is a separate concern — for now
    // the trigger context's direct fields are enough to identify the lead in
    // the CRM/Pabbly.
    {
        id: 'webhook_on_abandoned_cart',
        name: wt('templates.webhook_on_abandoned_cart.name'),
        description: wt('templates.webhook_on_abandoned_cart.description'),
        icon: '🛒',
        triggerEvents: ['ABANDONED_CART'],
        workflowType: 'EVENT_DRIVEN',
        questions: [
            {
                id: 'webhookUrl',
                label: wt('shared.questions.webhookUrl.label'),
                helpText: wt('templates.webhook_on_abandoned_cart.questions.webhookUrl.helpText'),
                type: 'text',
                required: true,
            },
            {
                id: 'scope',
                label: wt('shared.questions.scope.label'),
                helpText: wt('templates.webhook_on_abandoned_cart.questions.scope.helpText'),
                type: 'select',
                required: true,
                defaultValue: 'institute',
                options: [
                    { value: 'institute', label: wt('templates.webhook_on_abandoned_cart.questions.scope.options.institute') },
                    { value: 'course', label: wt('templates.webhook_on_abandoned_cart.questions.scope.options.course') },
                ],
            },
            {
                id: 'courseId',
                label: wt('shared.questions.courseId.label'),
                helpText: wt('templates.webhook_on_abandoned_cart.questions.courseId.helpText'),
                type: 'package_select',
                required: true,
                showIf: { questionId: 'scope', values: ['course'] },
            },
            {
                id: 'payloadJson',
                label: wt('shared.questions.payloadJson.label'),
                type: 'json_payload',
                required: true,
                jsonPayloadHint: wt('templates.webhook_on_abandoned_cart.questions.payloadJson.hint'),
                defaultValue: JSON.stringify(
                    {
                        Timestamp: "#ctx['triggerTime']",
                        Name: "#ctx['user'].fullName",
                        Phone: "#ctx['user'].mobileNumber",
                        Email: "#ctx['user'].email",
                        CourseName: "#ctx['packageName']",
                        Status: 'ABANDONED_CART',
                    },
                    null,
                    2,
                ),
            },
        ],
        generateWorkflow: (answers, triggerEvent) => {
            const triggerNode = makeNode('TRIGGER', wt('templates.webhook_on_abandoned_cart.nodes.trigger'), {
                triggerEvent: triggerEvent ?? 'ABANDONED_CART',
            }, 250, 50, true);

            let body: Record<string, unknown> = {};
            try {
                const raw = (answers.payloadJson as string) ?? '{}';
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    body = parsed as Record<string, unknown>;
                }
            } catch {
                body = {
                    Timestamp: "#ctx['triggerTime']",
                    Email: "#ctx['user'].email",
                    Name: "#ctx['user'].fullName",
                    Status: 'ABANDONED_CART',
                };
            }

            // Course-level scoping via HTTP_REQUEST's `condition` field — same
            // pattern as webhook_on_enrollment. The handler evaluates the
            // condition before firing and skips the request when false.
            const courseCondition =
                answers.scope === 'course' && answers.courseId
                    ? `#ctx['packageId'] == '${String(answers.courseId).replace(/'/g, "\\'")}'`
                    : undefined;

            const webhookNode = makeNode('HTTP_REQUEST', wt('templates.webhook_on_abandoned_cart.nodes.postToWebhook'), {
                resultKey: 'webhookResponse',
                config: {
                    requestType: 'EXTERNAL',
                    method: 'POST',
                    url: answers.webhookUrl as string,
                    ...(courseCondition ? { condition: courseCondition } : {}),
                    body,
                },
            }, 250, 230);

            return {
                nodes: [triggerNode, webhookNode],
                edges: [makeEdge(triggerNode.id, webhookNode.id)],
                workflowDescription:
                    answers.scope === 'course' && answers.courseId
                        ? wt('templates.webhook_on_abandoned_cart.workflowDescription.course')
                        : wt('templates.webhook_on_abandoned_cart.workflowDescription.institute'),
            };
        },
    },
    ];
}

let cache: { language: string; templates: UseCaseTemplate[] } | null = null;

/**
 * The use-case catalog, built on first use rather than at import time.
 *
 * Every label here comes from wt() → the i18next singleton, and this module is
 * imported long before its catalog is fetched: `ns` preloads only 'common',
 * and in dev there is no merged catalog for catalogsReady to seed from. Built
 * at module scope, every title froze as its raw key ("templates.x.name") for
 * the life of the page. Building on call — from a component that has already
 * subscribed to the namespace — gets real strings, and keying the cache on the
 * language means a runtime language switch re-reads them instead of keeping
 * the old locale until remount.
 */
export function getUseCaseTemplates(): UseCaseTemplate[] {
    const language = i18n.language ?? '';
    if (cache && cache.language === language) return cache.templates;
    const templates = buildUseCaseTemplates();
    // Only memoise once the catalog is actually loaded — caching before that
    // would freeze the raw keys back in, which is the bug this replaced.
    if (i18n.hasResourceBundle(language, 'workflowUseCaseTemplates')) {
        cache = { language, templates };
    }
    return templates;
}

/** Get templates matching a trigger event (or scheduled) */
export function getTemplatesForTrigger(
    triggerEvent: string | undefined,
    workflowType: 'EVENT_DRIVEN' | 'SCHEDULED'
): UseCaseTemplate[] {
    const templates = getUseCaseTemplates();
    if (workflowType === 'SCHEDULED') {
        return templates.filter(
            (t) => t.workflowType === 'SCHEDULED' || t.workflowType === 'BOTH'
        );
    }
    if (!triggerEvent) return [];
    return templates.filter(
        (t) =>
            (t.workflowType === 'EVENT_DRIVEN' || t.workflowType === 'BOTH') &&
            t.triggerEvents.includes(triggerEvent)
    );
}
