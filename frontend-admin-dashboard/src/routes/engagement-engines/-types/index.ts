// Types mirror the admin-core-service engagement DTOs/entities. Field names are the backend's
// (camelCase JSON), so DO NOT rename them.

export type EngineStatus =
    | 'DRAFT'
    | 'TEMPLATES_PENDING'
    | 'DRY_RUN'
    | 'ACTIVE'
    | 'PAUSED'
    | 'ARCHIVED';

export type EngineLanguage = 'en' | 'hi' | 'hinglish';

export type ChannelKey = 'WHATSAPP' | 'EMAIL' | 'IN_APP' | 'AI_CALL';

export interface ChannelConfig {
    enabled?: boolean;
    auto?: boolean;
    autoReply?: boolean; // WhatsApp only
    emailType?: string; // EMAIL only
}

export type ChannelsConfig = Partial<Record<ChannelKey, ChannelConfig>>;

export type AudienceSelectorType = 'PACKAGE_SESSION' | 'AUDIENCE' | 'USER';

export interface AudienceSelector {
    type: AudienceSelectorType;
    id: string;
    /** display-only, not sent to the backend */
    label?: string;
}

export interface QuietHours {
    startHour?: number;
    endHour?: number;
    timezone?: string;
}

/** The engine entity as returned by GET /engines. */
export interface EngagementEngine {
    id: string;
    instituteId: string;
    name: string;
    objective?: string;
    status: EngineStatus;
    language: EngineLanguage;
    dataPoints: string; // jsonb string: ["crm_lead", ...]
    channels: string; // jsonb string: {WHATSAPP:{...},...}
    audience: string; // jsonb string: [{type,id},...]
    quietHours: string; // jsonb string: {startHour,endHour,timezone}
    cadenceHours: number;
    autoSendKilled?: boolean;
    firstN?: number | null;
    holdoutPct?: number;
    nextDueAt?: string;
    lastSweptAt?: string;
    createdBy?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface EngagementPromptVersion {
    id: string;
    engineId: string;
    version: number;
    baseText?: string;
    deltaText?: string;
    compiledText?: string;
    source?: string;
    status?: string;
    createdBy?: string;
    createdAt?: string;
}

export interface EngineDetail {
    engine: EngagementEngine;
    activeMembers: number;
    prompt: EngagementPromptVersion | null;
    approvedSends?: number;
    /** Approved human sends per channel; graduation to auto-send is per channel. */
    approvedSendsByChannel?: Record<string, number>;
    effectiveFirstN?: number;
}

export interface EnrollmentResult {
    audienceSize: number;
    newlyEnrolled: number;
    exited: number;
}

export interface DataPointSpec {
    key: string;
    label: string;
    description?: string;
    sensitivity?: 'LOW' | 'MEDIUM' | 'HIGH';
    cost?: 'IN_PROCESS' | 'HTTP';
    /** Read for every engine; not a choice in the wizard. */
    alwaysOn?: boolean;
}

export interface CreateEngineRequest {
    name: string;
    objective?: string;
    brief: string;
    language: EngineLanguage;
    dataPoints: string[];
    channels: string; // JSON string
    audience: string; // JSON string
    quietHours: string; // JSON string
    cadenceHours?: number;
    holdoutPct?: number;
    firstN?: number;
}

// ---- Task inbox ----
export type ActionKind = 'TASK' | 'REPLY' | 'SEND' | 'NO_OP';
export type ActionStatus =
    | 'OPEN'
    | 'ACKED'
    | 'DISPATCHING'
    | 'SENT'
    | 'FAILED'
    | 'DONE'
    | 'DISMISSED'
    | 'EXPIRED'
    | 'SIMULATED';

export interface EngagementAction {
    id: string;
    engineId: string;
    memberId: string;
    instituteId: string;
    promptVersionId?: string;
    kind: ActionKind;
    actionType?: string;
    channel?: ChannelKey;
    status: ActionStatus;
    assignedTo?: string;
    templateName?: string;
    templateLanguage?: string;
    variablesJson?: string;
    draftBody?: string;
    sentBody?: string;
    rationale?: string;
    priority?: number;
    scheduledFor?: string;
    expiresAt?: string;
    dispatchedAt?: string;
    completedAt?: string;
    outcome?: string;
    errorMessage?: string;
    createdAt?: string;
    updatedAt?: string;
}

/** Spring Page<T> envelope. */
export interface PageResponse<T> {
    content: T[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
}

// ---- Template negotiation ----
export type ProposalStatus =
    | 'AI_PROPOSED'
    | 'USER_REVIEW'
    | 'USER_APPROVED'
    | 'SUBMITTED'
    | 'META_PENDING'
    | 'META_APPROVED'
    | 'META_REJECTED'
    | 'META_RECATEGORISED'
    | 'SUPERSEDED'
    | 'WITHDRAWN';

export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

export interface EngagementTemplateProposal {
    id: string;
    engineId: string;
    instituteId: string;
    notificationTemplateId?: string;
    name?: string;
    language?: string;
    proposedBody: string;
    proposedCategory: TemplateCategory;
    metaCategory?: string;
    status: ProposalStatus;
    rejectionReason?: string;
    round: number;
    variableNames: string; // jsonb string: ["name",...]
    sampleValues: string; // jsonb string: ["Aisha",...]
    footerText?: string;
    rationale?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface TemplateEditRequest {
    body?: string;
    category?: TemplateCategory;
    variableNames?: string[];
    sampleValues?: string[];
    footerText?: string;
}
