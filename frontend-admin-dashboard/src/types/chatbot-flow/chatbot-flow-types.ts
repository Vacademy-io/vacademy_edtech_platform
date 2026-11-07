export type ChatbotNodeType =
    | 'TRIGGER'
    | 'SEND_TEMPLATE'
    | 'SEND_MESSAGE'
    | 'SEND_INTERACTIVE'
    | 'CONDITION'
    | 'WORKFLOW_ACTION'
    | 'DELAY'
    | 'HTTP_WEBHOOK'
    | 'AI_RESPONSE'
    | 'CRM_LEAD_CHECK'
    | 'ASK_FIELD'
    | 'SAVE_TO_CRM';

export type ChatbotFlowStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

/**
 * A dynamic placeholder mapping used by SEND_MESSAGE / SEND_TEMPLATE nodes.
 * Any `{{name}}` in the node body/params is resolved via this list first,
 * then falls back to built-in placeholders ({{phone}}, {{user.x}}, {{session.x}}).
 */
export type VariableMappingSource =
    | 'SYSTEM_FIELD'
    | 'CUSTOM_FIELD'
    | 'SESSION'
    | 'CONTEXT'
    | 'FIXED';

export interface VariableMapping {
    name: string;
    source: VariableMappingSource;
    field: string;
    defaultValue: string;
}

/**
 * Flow-level configuration stored on `ChatbotFlow.settings`.
 *
 * These decide who is told — by email, WhatsApp, or both — when the chatbot hands a conversation
 * to a human ("a learner is waiting for your reply"), and which of the institute's existing
 * notification templates renders that alert. Set them in the flow builder's Settings panel.
 */
export interface ChatbotFlowSettings {
    /** Email addresses that get the "a learner is waiting for your reply" alert. */
    notificationEmails?: string[];
    /** WhatsApp numbers that get the same alert. Requires `escalationWhatsappTemplate`. */
    notificationPhones?: string[];
    /** EMAIL notification_template name. Omitted = a built-in layout is used instead. */
    escalationEmailTemplate?: string;
    /**
     * WHATSAPP notification_template name. Required to alert phones at all — Meta only accepts
     * business-initiated messages built from an approved template.
     */
    escalationWhatsappTemplate?: string;
    /** Language of the WhatsApp template above. Defaults to `en`. */
    escalationWhatsappTemplateLanguage?: string;
    /** Master switch for these alerts on this flow. Defaults to on. */
    notifyOnEscalation?: boolean;
    /** Minimum gap before the SAME unanswered conversation alerts the admins again. */
    escalationRenotifyMinutes?: number;
    [key: string]: unknown;
}

/**
 * Placeholders the escalation alert passes to whichever template renders it. Named, so a WhatsApp
 * template maps them onto its positional params via its stored variable names, and an email
 * template substitutes `{{key}}` directly.
 */
export const ESCALATION_TEMPLATE_VARIABLES: Array<{ key: string; description: string }> = [
    { key: 'contact_name', description: "The learner's name, or their phone if unknown" },
    { key: 'phone', description: "The learner's WhatsApp number" },
    { key: 'question', description: "The message the bot couldn't answer" },
    { key: 'bot_reply', description: 'What the bot said instead' },
    { key: 'reason', description: 'Why it handed over, in plain language' },
    { key: 'institute_name', description: 'Your institute name' },
    { key: 'inbox_url', description: 'Deep link to the WhatsApp Inbox' },
];

export interface ChatbotFlowDTO {
    id?: string;
    instituteId: string;
    name: string;
    description?: string;
    channelType: string;
    status: ChatbotFlowStatus;
    version?: number;
    triggerConfig?: Record<string, unknown>;
    settings?: ChatbotFlowSettings;
    createdBy?: string;
    createdAt?: string;
    updatedAt?: string;
    nodes: ChatbotFlowNodeDTO[];
    edges: ChatbotFlowEdgeDTO[];
}

export interface ChatbotFlowNodeDTO {
    id: string;
    nodeType: ChatbotNodeType;
    name: string;
    config: Record<string, unknown>;
    positionX: number;
    positionY: number;
}

export interface ChatbotFlowEdgeDTO {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    conditionLabel?: string;
    conditionConfig?: Record<string, unknown>;
    sortOrder?: number;
}

// ==================== CRM lead capture nodes ====================

/**
 * The two outputs of a CRM_LEAD_CHECK node. The engine follows the edge whose
 * `conditionConfig.branchId` equals the branch the executor returns, so each output handle's id
 * IS the branchId (the same contract CONDITION branches use). `label` is written to the edge's
 * conditionLabel when it is drawn.
 */
export const CRM_LEAD_CHECK_BRANCHES = [
    { id: 'NEW', label: 'New lead' },
    { id: 'EXISTING', label: 'Existing lead' },
] as const;

export type CrmLeadCheckBranchId = (typeof CRM_LEAD_CHECK_BRANCHES)[number]['id'];

/** CRM_LEAD_CHECK: is this WhatsApp number already a lead anywhere in the institute? */
export interface CrmLeadCheckConfig {
    /** Sent to a returning lead. Blank = send nothing. */
    existingMessage?: string;
    /** Alert the team when an existing lead messages again. */
    notifyTeam: boolean;
}

export type AskFieldSource = 'CUSTOM_FIELD' | 'SYSTEM_FIELD';
export type AskFieldSystemField = 'full_name' | 'email';

export interface AskFieldOption {
    value: string;
    label: string;
}

/**
 * ASK_FIELD: ask one question tied to one CRM field, validate the reply, save it on the lead.
 * fieldName / fieldType / options are snapshots taken when the field is picked, so the engine
 * can ask and validate without looking the field up again.
 */
export interface AskFieldConfig {
    fieldSource: AskFieldSource;
    /** The custom field's id — when fieldSource is CUSTOM_FIELD. */
    customFieldId?: string;
    /** When fieldSource is SYSTEM_FIELD. */
    systemField?: AskFieldSystemField;
    fieldName: string;
    /** Custom field type (text, dropdown, number, email, ...). full_name => text, email => email. */
    fieldType: string;
    /** Choices for dropdown / radio / multi_select; Yes/No for checkbox; empty otherwise. */
    options: AskFieldOption[];
    question: string;
    retryMessage: string;
    maxRetries: number;
    allowSkip: boolean;
    /** Label of the button that opens a WhatsApp list (4-10 choices). */
    listButtonText?: string;
}

/** SAVE_TO_CRM: write every collected answer to the lead (creating it if needed). */
export interface SaveToCrmConfig {
    /** One of the institute's lead status keys. null = don't change the status. */
    statusKey: string | null;
    /** Sent once the lead is saved. Blank = send nothing. */
    successMessage?: string;
    /** Fire the institute's AUDIENCE_LEAD_SUBMISSION workflows for a new lead. Default true. */
    fireWorkflows?: boolean;
}

// Node type metadata for the palette
export interface NodeTypeInfo {
    type: ChatbotNodeType;
    label: string;
    description: string;
    color: string;
    icon: string;
    defaultConfig: Record<string, unknown>;
}

export const NODE_TYPE_REGISTRY: NodeTypeInfo[] = [
    {
        type: 'TRIGGER',
        label: 'Trigger',
        description: 'Starts the flow when a message matches',
        color: '#22c55e',
        icon: '⚡',
        defaultConfig: { triggerType: 'KEYWORD_MATCH', keywords: [], matchType: 'contains' },
    },
    {
        type: 'SEND_MESSAGE',
        label: 'Send Message',
        description: 'Send text, image, video, or document (no template needed)',
        color: '#10b981',
        icon: '💬',
        defaultConfig: {
            messageType: 'text',
            text: '',
            mediaUrl: '',
            mediaCaption: '',
            filename: '',
            variables: [] as VariableMapping[],
        },
    },
    {
        type: 'SEND_TEMPLATE',
        label: 'Send Template',
        description: 'Send a pre-approved WhatsApp template',
        color: '#3b82f6',
        icon: '📄',
        defaultConfig: {
            templateName: '',
            languageCode: 'en',
            bodyParams: [],
            headerConfig: { type: 'none' },
            buttonConfig: [],
            variables: [] as VariableMapping[],
        },
    },
    {
        type: 'SEND_INTERACTIVE',
        label: 'Send Interactive',
        description: 'Send buttons or list (24hr window)',
        color: '#06b6d4',
        icon: '🔘',
        defaultConfig: { interactiveType: 'button', body: '', buttons: [], sections: [] },
    },
    {
        type: 'CONDITION',
        label: 'Condition',
        description: 'Branch based on user reply',
        color: '#eab308',
        icon: '🔀',
        defaultConfig: {
            conditionType: 'USER_RESPONSE',
            branches: [{ id: 'default', label: 'Default', isDefault: true }],
        },
    },
    {
        type: 'WORKFLOW_ACTION',
        label: 'Workflow',
        description: 'Trigger a backend workflow',
        color: '#8b5cf6',
        icon: '⚙️',
        defaultConfig: { workflowId: '', params: {} },
    },
    {
        type: 'DELAY',
        label: 'Delay',
        description: 'Wait before continuing',
        color: '#6b7280',
        icon: '⏱️',
        defaultConfig: { delayType: 'FIXED', delayValue: 5, delayUnit: 'MINUTES' },
    },
    {
        type: 'HTTP_WEBHOOK',
        label: 'HTTP Webhook',
        description: 'Call an external URL',
        color: '#f97316',
        icon: '🌐',
        defaultConfig: { url: '', method: 'POST', headers: {}, body: {} },
    },
    {
        type: 'AI_RESPONSE',
        label: 'AI Response',
        description: 'AI-powered conversation',
        color: '#14b8a6',
        icon: '🤖',
        // No modelId: the node uses the platform default (the 'chatbot_flow' use case).
        defaultConfig: {
            systemPrompt: '',
            maxTokens: 500,
            temperature: 0.7,
            exitKeywords: ['agent', 'human'],
            maxTurns: 10,
            enableInteractive: false,
            escalateWhenUnsure: true,
            escalationMessage: '',
        },
    },
    // ---- CRM: turn a WhatsApp enquiry into a lead ----
    {
        type: 'CRM_LEAD_CHECK',
        label: 'Check CRM Lead',
        description: 'New or returning lead? Branches on a CRM lookup',
        color: '#6366f1', // design-lint-ignore: categorical node accent, inline style needs hex
        icon: '🔎',
        defaultConfig: {
            existingMessage: 'Welcome back! Our team will get in touch with you shortly.',
            notifyTeam: true,
        },
    },
    {
        type: 'ASK_FIELD',
        label: 'Ask & Save Field',
        description: 'Ask one question, save the reply on the lead',
        color: '#818cf8', // design-lint-ignore: categorical node accent, inline style needs hex
        icon: '📝',
        defaultConfig: {
            fieldSource: 'CUSTOM_FIELD',
            customFieldId: '',
            fieldName: '',
            fieldType: 'text',
            options: [],
            question: '',
            retryMessage: "Sorry, that doesn't look right. Please try again.",
            maxRetries: 2,
            allowSkip: false,
            listButtonText: 'Choose',
        },
    },
    {
        type: 'SAVE_TO_CRM',
        label: 'Save Lead to CRM',
        description: 'Save the collected answers on the CRM lead',
        color: '#4f46e5', // design-lint-ignore: categorical node accent, inline style needs hex
        icon: '💾',
        defaultConfig: { statusKey: null, successMessage: '', fireWorkflows: true },
    },
];
