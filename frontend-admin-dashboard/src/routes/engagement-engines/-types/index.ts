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
    /** EMAIL only: how drafts are written — see EMAIL_MODES in -types/templates. */
    mode?: 'FREE_WRITE' | 'TEMPLATE_ONLY' | 'TEMPLATE_PLUS_AI_LINE';
    /** EMAIL only: the engine writes to people who never contacted us (unsubscribe line required). */
    coldOutreach?: boolean;
}

export type ChannelsConfig = Partial<Record<ChannelKey, ChannelConfig>>;

export type AudienceSelectorType = 'PACKAGE_SESSION' | 'AUDIENCE' | 'USER';

export interface AudienceSelector {
    type: AudienceSelectorType;
    id: string;
    /** display-only, not sent to the backend */
    label?: string;
}

/**
 * Stored as the engine's quietHours JSON. Besides the quiet hours it carries the send schedule
 * (backend EngagementSendSchedule): planned messages go out in a one-hour window starting at
 * sendHour:sendMinute, on `days` (ISO, 1 = Monday). No sendHour = no fixed time.
 */
export interface QuietHours {
    startHour?: number;
    endHour?: number;
    timezone?: string;
    sendHour?: number | null;
    sendMinute?: number;
    days?: number[];
    /** IMMEDIATE: a person who just joined is reached right away; SCHEDULED: at the next send window. */
    firstTouch?: 'IMMEDIATE' | 'SCHEDULED';
}

/** Root keys of the channels JSON that are not channels. */
export interface ChannelsExtras {
    /** Leave the engine once a meeting is booked with the lead (backend EngagementLeadExitJob). */
    exitOnMeetingBooked?: boolean;
    /** Booking page the engine books a meeting on when a lead asks for one in a reply. */
    bookingPageId?: string;
}

/** GET /engines/channel-readiness: whether the institute has set each channel up. */
export interface ChannelReadiness {
    ready: boolean;
    /** NOT_SET_UP, or SENDER_MISSING when the engine's email sender no longer exists. */
    reason?: 'NOT_SET_UP' | 'SENDER_MISSING' | null;
}
export type ChannelReadinessMap = Partial<Record<ChannelKey, ChannelReadiness>>;

/** The engine entity as returned by GET /engines. */
export interface EngagementEngine {
    id: string;
    /** The per-institute "AI Call Actions" engine; admins can't change it (backend isSystemManaged). */
    systemManaged?: boolean;
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

/** Who a task is for (GET /tasks/people). userId is null for a lead with no account. */
export interface TaskPerson {
    memberId: string;
    userId?: string | null;
    audienceResponseId?: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
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
    | 'WITHDRAWN'
    /** Meta later disabled or paused an approved template; the engine no longer uses it. */
    | 'META_DISABLED'
    /** Waiting for room under Meta's templates-per-hour limit; submitted automatically. */
    | 'QUEUED';

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
    variableSources?: string; // jsonb string: {"name":"profile.firstName",...}
    purpose?: string;
    headerType?: TemplateHeaderType;
    headerText?: string;
    headerMediaUrl?: string;
    buttons?: string; // jsonb string: [{type,text,url?,phoneNumber?}]
    /** This proposal is the edited version of that approved one (it replaces it once Meta approves). */
    replacesId?: string;
    /** Set when this engine took over an already-approved template of another engine. */
    reusedFromId?: string | null;
    submittedAt?: string;
    /** Server warning when a UTILITY template reads as promotion. */
    categoryWarning?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface TemplateEditRequest {
    body?: string;
    category?: TemplateCategory;
    variableNames?: string[];
    sampleValues?: string[];
    footerText?: string;
    variableSources?: Record<string, string>;
    purpose?: string;
    headerType?: TemplateHeaderType;
    headerText?: string;
    headerMediaUrl?: string;
    buttons?: TemplateButton[];
}

export type TemplateHeaderType = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';

export interface TemplateButton {
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
    text: string;
    url?: string;
    phoneNumber?: string;
}
